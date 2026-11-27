import { expect, failNextWorkbenchRead, observe, screenshot, test } from "../support/studio.mjs";

const alpha = "Alpha 项目工作台";
const beta = "Beta 项目工作台";

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function workbench(page) {
  return page.getByRole("region", { name: "作品管理", exact: true });
}

function works(page) {
  return workbench(page).getByRole("article");
}

function board(page, title) {
  return button(workbench(page), "打开白板：" + title);
}

function titleOfBoard(page) {
  return page.getByRole("textbox", { name: "白板名称", exact: true });
}

function searchInput(page) {
  return page.getByRole("textbox", { name: "搜索作品名称", exact: true });
}

async function openSearch(page) {
  await button(page, "搜索作品").click();
  const input = searchInput(page);
  await expect(input).toBeFocused();
  return input;
}

async function pickScope(page, scope) {
  await button(page, "筛选作品").click();
  await page.getByRole("menuitemradio", { name: scope, exact: true }).click();
}

async function displayedTitles(page) {
  return works(page).getByRole("heading", { level: 3 }).allTextContents();
}

async function expectHome(page, studio) {
  await expect(
    page.getByRole("heading", { level: 1, name: studio.workbenchTitle, exact: true }),
  ).toBeVisible();
}

async function visibleDirectoryState(page, studio) {
  const input = searchInput(page);
  const expanded = await input.isVisible();
  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  expect([studio.workbenchTitle, "已固定"]).toContain(heading);
  return {
    scope: heading === studio.workbenchTitle ? "recent" : "pinned",
    expanded,
    query: expanded ? await input.inputValue() : "",
    visibleTitles: await displayedTitles(page),
  };
}

test.describe("工作台浏览与导航", () => {
  test("[WB-BROWSE-01] 从根入口查看空目录和固定范围空状态", async ({ page, studio }, testInfo) => {
    await page.goto(studio.url);
    await expectHome(page, studio);
    await expect(workbench(page).getByRole("heading", { name: "从第一块白板开始" })).toBeVisible();
    await expect(works(page)).toHaveCount(0);
    await expect(button(workbench(page), "新建白板")).toBeEnabled();
    await expect(button(page.getByRole("region", { name: "新建作品" }), "新建白板")).toBeEnabled();
    await screenshot(page, testInfo, "workbench-empty");

    await pickScope(page, "已固定");
    await expect(
      page.getByRole("heading", { level: 1, name: "已固定", exact: true }),
    ).toBeVisible();
    await expect(workbench(page).getByRole("heading", { name: "还没有固定作品" })).toBeVisible();
    await expect(button(workbench(page), "新建白板")).toHaveCount(0);
    await screenshot(page, testInfo, "workbench-empty-pinned");

    await button(page, studio.workbenchBackLabel).click();
    await expectHome(page, studio);
    await expect(workbench(page).getByRole("heading", { name: "从第一块白板开始" })).toBeVisible();
  });

  test("[WB-BROWSE-02] 标题搜索忽略大小写与外侧空白，清除和 Esc 恢复列表", async ({
    page,
    studio,
  }, testInfo) => {
    await studio.seedBoards([{ title: alpha }, { title: beta }]);
    await page.goto(studio.url);
    await expect(board(page, alpha)).toBeVisible();
    await expect(board(page, beta)).toBeVisible();

    const input = await openSearch(page);
    await input.fill("  ALPHA  ");
    await expect(board(page, alpha)).toBeVisible();
    await expect(board(page, beta)).toHaveCount(0);
    await screenshot(page, testInfo, "workbench-search-match");

    await input.fill("没有匹配的合成板");
    await expect(
      workbench(page).getByRole("heading", { name: "没有找到匹配的作品" }),
    ).toBeVisible();
    await expect(workbench(page).getByText("试试其他名称。")).toBeVisible();
    await expect(works(page)).toHaveCount(0);
    await screenshot(page, testInfo, "workbench-search-empty");

    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(button(page, "搜索作品")).toBeFocused();
    await expect(board(page, alpha)).toBeVisible();
    await expect(board(page, beta)).toBeVisible();

    await openSearch(page);
    await input.fill("Beta");
    await expect(board(page, alpha)).toHaveCount(0);
    await button(page, "清除搜索").click();
    await expect(input).toHaveCount(0);
    await expect(button(page, "搜索作品")).toBeFocused();
    await expect(board(page, alpha)).toBeVisible();
  });

  test("[WB-BROWSE-03] 最近与固定范围可切换，固定页左上返回清空查询", async ({
    page,
    studio,
  }, testInfo) => {
    await studio.seedBoards([{ title: alpha, pinned: true }, { title: beta }]);
    await page.goto(studio.url);
    await expect(board(page, beta)).toBeVisible();
    await pickScope(page, "已固定");
    await expect(
      page.getByRole("heading", { level: 1, name: "已固定", exact: true }),
    ).toBeVisible();
    await expect(board(page, alpha)).toBeVisible();
    await expect(board(page, beta)).toHaveCount(0);
    await screenshot(page, testInfo, "workbench-pinned");

    const input = await openSearch(page);
    await input.fill("Alpha");
    await pickScope(page, "最近作品");
    await expectHome(page, studio);
    await expect(input).toHaveValue("Alpha");
    await expect(board(page, beta)).toHaveCount(0);

    await pickScope(page, "已固定");
    await expect(board(page, alpha)).toBeVisible();
    await button(page, studio.workbenchBackLabel).click();
    await expectHome(page, studio);
    await expect(board(page, beta)).toBeVisible();
    await observe(testInfo, "browse-pinned-return", {
      expanded: await input.isVisible(),
      query: (await input.isVisible()) ? await input.inputValue() : "",
      visibleTitles: await displayedTitles(page),
    });
    await screenshot(page, testInfo, "workbench-pinned-return");
  });

  test("[WB-BROWSE-04] 最近列表先展示固定作品，再按更新顺序展示普通作品", async ({
    page,
    studio,
  }, testInfo) => {
    const pinned = "早期固定板";
    const old = "早期普通板";
    const newest = "最新普通板";
    await studio.seedBoards([{ title: pinned, pinned: true }, { title: old }]);
    await page.goto(studio.url);
    await expect(board(page, pinned)).toBeVisible();
    await expect(board(page, old)).toBeVisible();
    await studio.seedBoards([{ title: newest }]);
    await page.reload();
    await expect(board(page, newest)).toBeVisible();
    await expect(works(page)).toHaveCount(3);
    await expect(works(page).getByRole("heading", { level: 3 })).toHaveText([pinned, newest, old]);
    await screenshot(page, testInfo, "workbench-recent-order");
  });

  test("[WB-BROWSE-05] 目录满页后读取下一页，最终作品不重不漏", async ({
    page,
    studio,
  }, testInfo) => {
    const titles = Array.from({ length: 62 }, (_, index) => `分页工作板 ${index + 1}`);
    await studio.seedBoards(titles.map((title) => ({ title })));
    await page.goto(studio.url);

    const rows = works(page);
    const more = button(workbench(page), "加载更多");
    await expect(rows.first()).toBeVisible();
    await expect(more).toBeVisible();
    const first = await displayedTitles(page);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(titles.length);
    expect(new Set(first).size).toBe(first.length);
    await screenshot(page, testInfo, "workbench-first-page");

    const pageTotals = [first.length];
    for (let count = first.length; count < titles.length; count = await rows.count()) {
      await more.click();
      await expect.poll(() => rows.count()).toBeGreaterThan(count);
      pageTotals.push(await rows.count());
    }

    await expect(rows).toHaveCount(titles.length);
    await expect(more).toHaveCount(0);
    const all = await displayedTitles(page);
    expect(all.slice(0, first.length)).toEqual(first);
    expect([...all].sort()).toEqual([...titles].sort());
    await observe(testInfo, "browse-page-totals", { pageTotals });
    await screenshot(page, testInfo, "workbench-all-pages");
  });

  test("[WB-BROWSE-06] 从卡片和列表打开白板，浏览器前进后退和顶栏返回可用", async ({
    page,
    studio,
  }, testInfo) => {
    await studio.seedBoards([{ title: alpha }, { title: beta }]);
    await page.goto(studio.url);
    await expectHome(page, studio);
    await expect(button(page, "切换为列表视图")).toBeVisible();

    await board(page, alpha).click();
    await expect(titleOfBoard(page)).toHaveValue(alpha);
    await screenshot(page, testInfo, "workbench-open-from-grid");

    await page.goBack();
    await expectHome(page, studio);
    await expect(board(page, alpha)).toBeVisible();
    await page.goForward();
    await expect(titleOfBoard(page)).toHaveValue(alpha);

    await button(page, studio.workbenchBackLabel).click();
    await expectHome(page, studio);
    await button(page, "切换为列表视图").click();
    await expect(button(page, "切换为卡片视图")).toBeVisible();
    await board(page, beta).press("Enter");
    await expect(titleOfBoard(page)).toHaveValue(beta);
    await button(page, studio.workbenchBackLabel).click();
    await expectHome(page, studio);
    await expect(board(page, beta)).toBeVisible();
    await expect(button(page, "切换为卡片视图")).toBeVisible();
    await screenshot(page, testInfo, "workbench-return-to-list");
  });

  test("[WB-BROWSE-07] 记录从已固定的搜索结果开板后的工作台状态", async ({
    page,
    studio,
  }, testInfo) => {
    await studio.seedBoards([{ title: alpha, pinned: true }, { title: beta }]);
    await page.goto(studio.url);
    await pickScope(page, "已固定");
    const input = await openSearch(page);
    await input.fill("Alpha");
    await board(page, alpha).click();
    await expect(titleOfBoard(page)).toHaveValue(alpha);

    await page.goBack();
    await expect(board(page, alpha)).toBeVisible();
    const browserBack = await visibleDirectoryState(page, studio);
    await screenshot(page, testInfo, "workbench-search-history-back");
    await page.goForward();
    await expect(titleOfBoard(page)).toHaveValue(alpha);

    await button(page, studio.workbenchBackLabel).click();
    await expect(board(page, alpha)).toBeVisible();
    await observe(testInfo, "browse-board-return", {
      browserBack,
      boardBack: await visibleDirectoryState(page, studio),
    });
    await screenshot(page, testInfo, "workbench-search-return");
  });

  test("[WB-BROWSE-08] 续页读取失败保留已加载作品，重试能接回缺失页", async ({
    page,
    studio,
  }, testInfo) => {
    const titles = Array.from({ length: 62 }, (_, index) => `续页重试样板 ${index + 1}`);
    await studio.seedBoards(titles.map((title) => ({ title })));
    await page.goto(studio.url);
    const more = button(workbench(page), "加载更多");
    const retry = button(page, "重试");
    await expect(more).toBeVisible();
    const first = await displayedTitles(page);

    await failNextWorkbenchRead(page, studio);
    await more.click();
    await expect(retry).toBeVisible();
    expect(await displayedTitles(page)).toEqual(first);
    await screenshot(page, testInfo, "workbench-append-failed");

    await retry.click();
    await expect(works(page)).toHaveCount(titles.length);
    await expect(retry).toHaveCount(0);
    await expect(more).toHaveCount(0);
    const all = await displayedTitles(page);
    expect(all.slice(0, first.length)).toEqual(first);
    expect([...all].sort()).toEqual([...titles].sort());
    await screenshot(page, testInfo, "workbench-append-retried");
  });

  test("[WB-BROWSE-09] 用小写重音字母搜索大写重音标题", async ({ page, studio }, testInfo) => {
    const accent = "Élodie 需求板";
    await studio.seedBoards([{ title: accent }, { title: beta }]);
    await page.goto(studio.url);
    await expect(board(page, accent)).toBeVisible();
    const input = await openSearch(page);
    await input.fill("élodie");
    await expect(board(page, beta)).toHaveCount(0);
    const missing = workbench(page).getByRole("heading", { name: "没有找到匹配的作品" });
    await expect
      .poll(async () => (await board(page, accent).isVisible()) || (await missing.isVisible()))
      .toBe(true);
    await observe(testInfo, "browse-unicode-search", {
      visibleTitles: await displayedTitles(page),
    });
    await screenshot(page, testInfo, "workbench-accent-search");
  });
});
