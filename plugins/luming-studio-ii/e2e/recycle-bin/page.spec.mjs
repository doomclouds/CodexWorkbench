import { expect, focused, observe, screenshot, test } from "../support/studio.mjs";

const desktop = { width: 1366, height: 820 };
const narrow = { width: 390, height: 760 };
const alpha = "Alpha 归档样板";
const beta = "Beta 归档样板";

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function recycleRegion(page) {
  return page.getByRole("region", { name: "回收站作品" });
}

function row(page, title) {
  return recycleRegion(page)
    .getByRole("article")
    .filter({ has: button(page, "打开白板：" + title) });
}

function selection(page) {
  return recycleRegion(page).getByRole("group", { name: "回收站选择" });
}

function allCurrent(page) {
  return selection(page).getByRole("checkbox", { name: "全选当前页", exact: true });
}

function enterWorkbenchScope(page, name) {
  return page.getByRole("menuitemradio", { name, exact: true }).click();
}

async function openRecycleBin(page, studio) {
  await page.goto(studio.url);
  await button(page, "筛选作品").click();
  await enterWorkbenchScope(page, "回收站");
  await expect(page.getByRole("heading", { level: 1, name: "回收站" })).toBeVisible();
}

async function searchRecycleBin(page) {
  await button(page, "搜索回收站").click();
  const input = page.getByRole("textbox", { name: "搜索回收站名称" });
  await expect(input).toBeFocused();

  return input;
}

function recyclePair() {
  return [alpha, beta].map((title) => ({ title, trashed: true }));
}

async function positions(page) {
  const one = await row(page, alpha).boundingBox();
  const two = await row(page, beta).boundingBox();
  if (!one || !two) {
    throw new Error("Both recycle-bin entries must have a rendered box");
  }

  return { one, two };
}

async function searchState(input) {
  const expanded = await input.isVisible();
  return { expanded, query: expanded ? await input.inputValue() : "" };
}

async function focusTarget(controls) {
  for (const [name, control] of Object.entries(controls)) {
    if (await focused(control)) {
      return name;
    }
  }

  return "other";
}

test.describe("回收站界面", () => {
  test("[TRASH-UI-01] 键盘开关筛选菜单和鼠标进入回收站，按钮与浏览器均可返回", async ({
    page,
    studio,
  }) => {
    await studio.seedBoards([{ title: alpha, trashed: true }, { title: "活动白板" }]);
    await page.goto(studio.url);
    const filter = button(page, "筛选作品");
    const menu = page.getByRole("menu", { name: "作品范围" });
    const trash = menu.getByRole("menuitemradio", { name: "回收站" });

    await filter.press("ArrowDown");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(filter).toBeFocused();

    await filter.press("ArrowDown");
    await trash.click();
    await expect(page).toHaveURL(/[?&]view=trash(?:&|$)/u);
    await expect(row(page, alpha)).toBeVisible();
    await expect(button(row(page, alpha), "打开白板：" + alpha)).toBeDisabled();
    await expect(button(row(page, alpha), "恢复作品：" + alpha)).toBeEnabled();
    await expect(recycleRegion(page).getByText("活动白板", { exact: true })).toHaveCount(0);
    await expect(filter).toHaveCount(0);
    await expect(button(page, "新建作品")).toHaveCount(0);

    await page.goBack();
    await expect(button(page, "打开白板：活动白板")).toBeEnabled();
    await page.goForward();
    await expect(row(page, alpha)).toBeVisible();
    await button(page, "返回 Luming Studio").click();
    await expect(button(page, "打开白板：活动白板")).toBeEnabled();
  });

  test("[TRASH-UI-02] 搜索、网格与列表、明暗和窄窗口通过实际布局验证", async ({
    page,
    studio,
  }, testInfo) => {
    await studio.seedBoards(recyclePair());
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize(desktop);
    await openRecycleBin(page, studio);
    await expect(row(page, alpha)).toBeVisible();
    await expect(row(page, beta)).toBeVisible();
    const grid = await positions(page);
    expect(Math.abs(grid.one.y - grid.two.y)).toBeLessThan(2);
    expect(Math.abs(grid.one.x - grid.two.x)).toBeGreaterThan(200);
    const date = row(page, alpha).getByText(/^移入时间 /u);
    await expect(date).toHaveCSS("white-space", "nowrap");
    await expect(date).toHaveCSS("text-overflow", "ellipsis");
    await expect(button(page, "切换为暗色主题")).toBeVisible();
    await screenshot(page, testInfo, "recycle-grid-light");

    await button(page, "切换为列表视图").click();
    await expect(button(page, "切换为卡片视图")).toBeVisible();
    const list = await positions(page);
    expect(Math.abs(list.one.x - list.two.x)).toBeLessThan(2);
    expect(Math.abs(list.one.y - list.two.y)).toBeGreaterThan(15);
    expect(list.one.width).toBeGreaterThan(grid.one.width);

    await button(page, "切换为暗色主题").click();
    await expect(button(page, "切换为明亮主题")).toBeVisible();
    await screenshot(page, testInfo, "recycle-list-dark");

    await page.setViewportSize(narrow);
    const search = await searchRecycleBin(page);
    await search.fill("  ALPHA  ");
    await expect(row(page, alpha)).toBeVisible();
    await expect(row(page, beta)).toHaveCount(0);
    const searchBox = await search.boundingBox();
    const rowBox = await row(page, alpha).boundingBox();
    expect(searchBox.x).toBeGreaterThanOrEqual(0);
    expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(narrow.width);
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(narrow.width);
    await screenshot(page, testInfo, "recycle-narrow-search");

    await search.fill("没有匹配的合成板");
    await expect(page.getByRole("heading", { name: "没有找到匹配的作品" })).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveCount(0);
    await expect(button(page, "搜索回收站")).toBeFocused();
    await expect(row(page, beta)).toBeVisible();

    const reopened = await searchRecycleBin(page);
    await reopened.fill("Beta");
    await expect(row(page, alpha)).toHaveCount(0);
    await button(page, "清除搜索").click();
    await expect(reopened).toHaveCount(0);
    await expect(button(page, "搜索回收站")).toBeFocused();
    await expect(row(page, alpha)).toBeVisible();
  });

  test("[TRASH-UI-03] 支持鼠标和空格选择、全选、取消批量确认和清除选择", async ({
    page,
    studio,
  }, testInfo) => {
    await studio.seedBoards(recyclePair());
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize(desktop);
    await openRecycleBin(page, studio);
    const all = allCurrent(page);
    const first = row(page, alpha).getByRole("checkbox", { name: "选择作品：" + alpha });
    const second = row(page, beta).getByRole("checkbox", { name: "选择作品：" + beta });
    await expect(all).not.toBeChecked();
    await expect(button(selection(page), "永久删除所选作品")).toBeDisabled();

    await first.press("Space");
    await expect(first).toBeChecked();
    await expect(all).toHaveJSProperty("indeterminate", true);
    await expect(selection(page).getByText("1 项已选")).toBeVisible();
    await all.click();
    await expect(all).toBeChecked();
    await expect(second).toBeChecked();
    await expect(selection(page).getByText("2 项已选")).toBeVisible();

    const remove = button(selection(page), "永久删除所选作品");
    await remove.click();
    const dialog = page.getByRole("dialog", { name: "永久删除作品" });
    await expect(dialog.getByText("将永久删除 2 项作品，此操作无法恢复。")).toBeVisible();
    await screenshot(page, testInfo, "recycle-confirm-two");
    await button(dialog, "取消").click();
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();
    await expect(all).toBeChecked();
    await button(selection(page), "清除选择").click();
    await expect(selection(page).getByText("0 项已选")).toBeVisible();
    await expect(first).not.toBeChecked();
    await expect(second).not.toBeChecked();
    await expect(row(page, alpha)).toBeVisible();
    await expect(row(page, beta)).toBeVisible();
  });

  test("[TRASH-UI-04] 单项确认显示标题并支持 Escape 和遮罩取消", async ({ page, studio }) => {
    await studio.seedBoards(recyclePair());
    await page.setViewportSize(desktop);
    await openRecycleBin(page, studio);
    const remove = button(row(page, alpha), "永久删除作品：" + alpha);
    const dialog = page.getByRole("dialog", { name: "永久删除作品" });

    await remove.press("Enter");
    await expect(dialog.getByText("将永久删除 1 项作品，此操作无法恢复。")).toBeVisible();
    await expect(dialog.getByText(alpha, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();

    await remove.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(6, 6);
    await expect(dialog).toHaveCount(0);
    await expect(row(page, alpha)).toBeVisible();
  });
});

test.describe("回收站双版本一致性", () => {
  test("[TRASH-UI-05] 记录进入和返回回收站时的搜索与固定范围", async ({
    page,
    studio,
  }, testInfo) => {
    await studio.seedBoards([
      ...recyclePair(),
      { title: "Alpha 已固定的活动板", pinned: true },
      { title: "Beta 未固定的活动板" },
    ]);
    await page.goto(studio.url);
    const filter = button(page, "筛选作品");
    await filter.click();
    await enterWorkbenchScope(page, "已固定");
    await expect(page.getByRole("heading", { name: "已固定", level: 1 })).toBeVisible();
    await button(page, "搜索作品").click();
    const workbenchSearch = page.getByRole("textbox", { name: "搜索作品名称" });
    await workbenchSearch.fill("Alpha");
    await expect(workbenchSearch).toHaveValue("Alpha");

    await filter.click();
    await enterWorkbenchScope(page, "回收站");
    await expect(row(page, alpha)).toBeVisible();
    const trash = await searchState(page.getByRole("textbox", { name: "搜索回收站名称" }));
    const visibleTrash = await recycleRegion(page)
      .getByRole("heading", { level: 3 })
      .allTextContents();
    await screenshot(page, testInfo, "recycle-navigation-scope");

    await button(page, "返回 Luming Studio").click();
    await expect(button(page, "打开白板：Alpha 已固定的活动板")).toBeEnabled();
    await expect(recycleRegion(page)).toHaveCount(0);
    const navigation = {
      workbench: {
        heading: await page.getByRole("heading", { level: 1 }).textContent(),
        ...(await searchState(workbenchSearch)),
        unpinnedVisible: await button(page, "打开白板：Beta 未固定的活动板").isVisible(),
      },
      trash: { ...trash, visibleTitles: visibleTrash.sort() },
    };
    await observe(testInfo, "navigation-scope", navigation);

    expect(navigation).toEqual({
      workbench: { heading: "Luming Studio", expanded: true, query: "", unpinnedVisible: true },
      trash: { expanded: true, query: "Alpha", visibleTitles: [alpha] },
    });
  });

  test("[TRASH-UI-06] 记录分页边界并验证全选覆盖累计已加载行", async ({
    page,
    studio,
  }, testInfo) => {
    const total = 62;
    await studio.seedBoards(
      Array.from({ length: total }, (_, index) => ({
        title: `分页样板 ${index + 1}`,
        trashed: true,
      })),
    );
    await openRecycleBin(page, studio);
    const region = recycleRegion(page);
    const rows = region.getByRole("article");
    const more = button(region, "加载更多");
    const all = allCurrent(page);
    await expect(rows.first()).toBeVisible();
    await expect(more).toBeVisible();
    const firstPage = await rows.count();
    await all.click();
    await expect(selection(page).getByText(`${firstPage} 项已选`)).toBeVisible();

    await more.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(firstPage);
    const combined = await rows.count();
    await expect(all).toHaveJSProperty("indeterminate", true);
    await all.click();
    await expect(selection(page).getByText(`${combined} 项已选`)).toBeVisible();
    await screenshot(page, testInfo, "recycle-pagination-selection");

    const pageTotals = [firstPage, combined];
    for (let seen = combined; seen < total; seen = await rows.count()) {
      await more.click();
      await expect.poll(() => rows.count()).toBeGreaterThan(seen);
      pageTotals.push(await rows.count());
      await expect(all).toHaveJSProperty("indeterminate", true);
    }

    await expect(rows).toHaveCount(total);
    await expect(more).toHaveCount(0);
    await observe(testInfo, "pagination", { pageTotals, selectedAfterSecondPage: combined });
    expect(pageTotals).toEqual([60, total]);
    expect(combined).toBe(total);
  });

  test("[TRASH-UI-07] 记录单项确认初始焦点及点遮罩后回焦", async ({ page, studio }, testInfo) => {
    await studio.seedBoards([{ title: alpha, trashed: true }]);
    await openRecycleBin(page, studio);
    const remove = button(row(page, alpha), "永久删除作品：" + alpha);
    await remove.click();
    const dialog = page.getByRole("dialog", { name: "永久删除作品" });
    await expect(dialog.getByText(alpha, { exact: true })).toBeVisible();
    const openFocus = await focusTarget({
      close: button(dialog, "关闭弹窗"),
      cancel: button(dialog, "取消"),
      confirm: button(dialog, "永久删除"),
    });
    await screenshot(page, testInfo, "recycle-dialog-focus");
    await page.mouse.click(6, 6);
    await expect(dialog).toHaveCount(0);
    await expect(row(page, alpha)).toBeVisible();
    const afterBackdrop = await focused(remove);
    await observe(testInfo, "dialog-focus", { openFocus, afterBackdrop });
    expect(openFocus).toBe("close");
    expect(afterBackdrop).toBe(false);
  });

  test("[TRASH-UI-08] 记录旧固定条目和新移入条目的显示顺序", async ({ page, studio }, testInfo) => {
    const old = "先移入的固定板";
    const newest = "后移入的普通板";
    await studio.seedBoards([{ title: old, trashed: true, pinned: true }, { title: newest }]);
    await page.goto(studio.url);
    await button(page, "打开白板：" + newest).hover();
    await button(page, "管理作品：" + newest).click();
    await page.getByRole("menuitem", { name: "移入回收站", exact: true }).click();
    await expect(button(page, "打开白板：" + newest)).toHaveCount(0);
    await button(page, "筛选作品").click();
    await enterWorkbenchScope(page, "回收站");

    const rows = recycleRegion(page).getByRole("article");
    await expect(rows).toHaveCount(2);
    await expect(row(page, old)).toBeVisible();
    await expect(row(page, newest)).toBeVisible();
    await screenshot(page, testInfo, "recycle-ordering");
    const titles = await rows.getByRole("heading", { level: 3 }).allTextContents();
    await observe(testInfo, "ordering", { titles });
    expect(titles).toEqual([old, newest]);
  });

  test("[TRASH-UI-09] 记录键盘打开筛选时的焦点和 End 导航", async ({ page, studio }, testInfo) => {
    await studio.seedBoards([{ title: alpha, trashed: true }]);
    await page.goto(studio.url);
    const filter = button(page, "筛选作品");
    const menu = page.getByRole("menu", { name: "作品范围" });
    const recent = menu.getByRole("menuitemradio", { name: "最近作品" });
    const trash = menu.getByRole("menuitemradio", { name: "回收站" });
    await filter.press("ArrowDown");
    await expect(recent).toBeVisible();
    const openFocus = await focusTarget({ filter, recent, trash });
    await page.keyboard.press("End");
    const endFocus = await focusTarget({ filter, recent, trash });
    await screenshot(page, testInfo, "recycle-filter-menu-focus");
    if (endFocus === "trash") {
      await page.keyboard.press("Enter");
      await expect(row(page, alpha)).toBeVisible();
    } else {
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
    }

    await observe(testInfo, "filter-menu-focus", { openFocus, endFocus });
    expect(openFocus).toBe("filter");
    expect(endFocus).toBe("filter");
  });

  test("[TRASH-UI-10] 记录恢复触发刷新后已隐藏作品的批量选择状态", async ({
    page,
    studio,
  }, testInfo) => {
    const restored = "用于触发列表刷新的作品";
    await studio.seedBoards([
      ...Array.from({ length: 64 }, (_, index) => ({
        title: `跨批选择样板 ${index + 1}`,
        trashed: true,
      })),
      { title: restored, trashed: true },
    ]);
    await openRecycleBin(page, studio);
    const region = recycleRegion(page);
    const rows = region.getByRole("article");
    const more = button(region, "加载更多");
    await expect(row(page, restored)).toBeVisible();
    await expect(more).toBeVisible();
    const firstPage = await rows.count();
    await more.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(firstPage);

    const title = await rows.last().getByRole("heading", { level: 3 }).textContent();
    expect(title).toMatch(/^跨批选择样板 \d+$/u);
    const selected = row(page, title);
    await selected.getByRole("checkbox", { name: "选择作品：" + title }).click();
    await expect(selection(page).getByText("1 项已选")).toBeVisible();
    await button(row(page, restored), "恢复作品：" + restored).click();
    await expect(row(page, restored)).toHaveCount(0);
    await expect(rows).toHaveCount(firstPage);
    await expect(selected).toHaveCount(0);

    const group = selection(page);
    const summary = await group.getByText(/^\d+ 项已选$/u).textContent();
    const bulkActionEnabled = await button(group, "永久删除所选作品").isEnabled();
    await screenshot(page, testInfo, "recycle-hidden-selection");
    await observe(testInfo, "hidden-selection-after-refresh", { summary, bulkActionEnabled });

    expect(summary).toBe("0 项已选");
    expect(bulkActionEnabled).toBe(false);
    await more.click();
    await expect(selected).toBeVisible();
    await expect(selected.getByRole("checkbox", { name: "选择作品：" + title })).not.toBeChecked();
  });
});
