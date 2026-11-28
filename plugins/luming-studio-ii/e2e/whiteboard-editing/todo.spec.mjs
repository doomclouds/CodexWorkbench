import {
  controlNextTodoSave,
  expect,
  observe,
  readCanvas,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

test.use({ trace: "off", screenshot: "off", video: "off" });

const checklistTitle = "验收清单";
const reviewTasks = ["确认发布范围", "核对白板正文", "验证拖动后保存", "刷新确认保存位置"];
const sourceId = "todo-origin-text";
const taskId = "todo-operations";
const taskTitle = "会签清单";
const sourceTitle = "会签记录来源";
const items = [
  { id: "scope", text: "检查范围", checked: true },
  { id: "notes", text: "确认说明", checked: true },
  { id: "review", text: "复核配图", checked: false },
  { id: "link", text: "确认会签", checked: false, sourceRef: { objectId: sourceId } },
];

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function todo(scope, name) {
  return scope.getByRole("region", { name, exact: true });
}

function taskList(scope) {
  return scope.getByRole("list", { name: "任务", exact: true });
}

function taskText(scope, text) {
  return scope.getByText(text, { exact: true });
}

async function zoomTo60(page) {
  const zoom = button(page, "缩放菜单");
  const menu = page.getByRole("menu", { name: "缩放与视图", exact: true });
  await zoom.click();
  await menu.getByRole("menuitem", { name: "50%", exact: true }).click();
  await zoom.click();
  await button(menu, "放大").click();
  await expect(zoom).toHaveText("60%");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
}

function checklistSeed(title) {
  return {
    title,
    objects: [
      {
        id: taskId,
        kind: "todo",
        label: taskTitle,
        x: 130,
        y: 105,
        width: 360,
        height: 302,
        items,
      },
      {
        id: sourceId,
        kind: "text",
        label: sourceTitle,
        x: 650,
        y: 140,
        width: 200,
        height: 72,
      },
    ],
  };
}

function expandedTodo(page, title) {
  return todo(page, title).filter({ has: taskList(page) });
}

async function expand(page, title) {
  await button(todo(page, title), "展开任务清单").click();
  const scope = expandedTodo(page, title);
  await expect(scope).toBeVisible();
  return scope;
}

function textbox(scope, name) {
  return scope.getByRole("textbox", { name, exact: true });
}

async function enterText(scope, name, value) {
  const editor = textbox(scope, name);
  await editor.fill(value);
  await editor.press("Enter");
}

async function savedTodo(studio, board) {
  const snapshot = await studio.readBoard(board);
  return snapshot.objects.find((object) => object.kind === "todo");
}

async function savedTexts(studio, board) {
  const checklist = await savedTodo(studio, board);
  return checklist?.items.map(({ text }) => text);
}

function taskRow(page, scope, label) {
  return taskList(scope)
    .getByRole("listitem")
    .filter({ has: button(page, "调整顺序：" + label) });
}

async function selectedSource(page, studio) {
  const { objects, selection } = await readCanvas(page, studio);
  const target = objects.find((object) => object.id === sourceId)?.box;
  if (!target || !selection) {
    return false;
  }

  const differenceX = Math.abs(selection.x + selection.width / 2 - target.x - target.width / 2);
  const differenceY = Math.abs(selection.y + selection.height / 2 - target.y - target.height / 2);
  return differenceX <= 5 && differenceY <= 5;
}

test("[EDIT-TODO-01] 60% 缩放保留可读的四条任务和进度，并能展开", async ({
  page,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "任务清单显示样板", withContent: true }]);
  await page.goto(board.url);
  const card = todo(page, checklistTitle);
  await expect(card).toBeVisible();
  await expect(taskList(card).getByRole("listitem")).toHaveCount(4);
  await expect(taskText(card, "2/4 完成")).toBeVisible();

  await zoomTo60(page);
  await expect(taskText(card, "2/4 完成")).toBeVisible();
  await expect(card.getByRole("progressbar", { name: "任务完成进度" })).toBeVisible();
  const rows = [];
  for (const text of reviewTasks) {
    if (await taskText(card, text).isVisible()) {
      rows.push(text);
    }
  }
  expect(rows).toEqual(studio.edition === "ii" ? reviewTasks : []);
  if (studio.edition === "ii") {
    const preview = card.getByRole("list", { name: "任务预览", exact: true });
    await expect(preview.getByRole("listitem")).toHaveCount(4);
    await expect(preview.getByRole("img", { name: "已完成", exact: true })).toHaveCount(2);
    await expect(preview.getByRole("checkbox")).toHaveCount(0);
    for (const text of reviewTasks) {
      await expect(taskText(preview, text)).toBeInViewport({ ratio: 0.9 });
    }
  }
  await observe(testInfo, "todo-60-percent", { rows, complete: 2, total: 4 });
  await screenshot(page, testInfo, "todo-compact-at-60");

  await button(card, "展开任务清单").click();
  const expanded = taskList(page);
  await expect(expanded.getByRole("listitem")).toHaveCount(4);
  for (const text of reviewTasks) {
    await expect(taskText(expanded, text)).toBeInViewport();
  }
  await screenshot(page, testInfo, "todo-expanded-at-60");
});

test("[EDIT-TODO-02] 从形状工具新建清单并用 Enter 连续添加任务", async ({
  page,
  studio,
}, testInfo) => {
  const [board] = await studio.seedBoards([{ title: "新建任务样板" }]);
  await page.goto(board.url);
  await button(page, "形状").click();
  await button(page, "添加任务清单").click();
  const { bounds } = await readCanvas(page, studio);
  await page.mouse.click(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.18);
  await expect.poll(async () => (await savedTodo(studio, board))?.kind).toBe("todo");
  const scope = await expand(page, "任务清单");
  const input = textbox(scope, "新增任务");
  const add = button(scope, "添加任务");
  await expect(add.or(input)).toBeVisible();
  if (await add.isVisible()) {
    await add.click();
  }
  await enterText(scope, "新增任务", "第一件任务");
  await expect.poll(() => savedTexts(studio, board)).toEqual(["第一件任务"]);
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();
  await enterText(scope, "新增任务", "第二件任务");
  await expect.poll(() => savedTexts(studio, board)).toEqual(["第一件任务", "第二件任务"]);
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();
  await input.press("Escape");
  await expect(input).toBeHidden();
  await expect(taskText(scope, "0/2 完成")).toBeVisible();
  await screenshot(page, testInfo, "todo-created-with-keyboard-rows");
});

test("[EDIT-TODO-03] 展开后编辑、勾选、键盘和拖拽排序、删除并跳到来源", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard(checklistSeed("编辑与来源样板"));
  await page.goto(board.url);
  const original = await expand(page, taskTitle);
  const renamed = "会签待完成事项";
  await button(original, "编辑清单标题：" + taskTitle).click();
  await enterText(original, "任务清单标题", renamed);
  await expect.poll(async () => (await savedTodo(studio, board))?.label).toBe(renamed);
  const scope = expandedTodo(page, renamed);

  await button(scope, "编辑任务：复核配图").click();
  const editor = textbox(scope, "任务文字");
  await editor.fill("不会保存的草稿");
  await editor.press("Escape");
  await expect(taskText(scope, "复核配图")).toBeVisible();
  await button(scope, "编辑任务：复核配图").click();
  await enterText(scope, "任务文字", "复核最终配图");
  await expect.poll(() => savedTexts(studio, board)).toContain("复核最终配图");
  const check = scope.getByRole("checkbox", { name: "完成任务：复核最终配图", exact: true });
  await check.check();
  await expect(taskText(scope, "3/4 完成")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await savedTodo(studio, board))?.items.find(({ id }) => id === "review")?.checked,
    )
    .toBe(true);

  const reorder = button(scope, "调整顺序：确认会签");
  await expect(reorder).toBeEnabled();
  await reorder.press("ArrowUp");
  await expect
    .poll(() => savedTexts(studio, board))
    .toEqual(["检查范围", "确认说明", "确认会签", "复核最终配图"]);
  await expect(reorder).toBeEnabled();
  await reorder.dragTo(taskRow(page, scope, "检查范围"), {
    targetPosition: { x: 75, y: 6 },
  });
  await expect
    .poll(() => savedTexts(studio, board))
    .toEqual(["确认会签", "检查范围", "确认说明", "复核最终配图"]);
  await button(scope, "删除任务：确认说明").click();
  await expect
    .poll(() => savedTexts(studio, board))
    .toEqual(["确认会签", "检查范围", "复核最终配图"]);
  await expect(taskText(scope, "2/3 完成")).toBeVisible();
  await screenshot(page, testInfo, "todo-edited-and-reordered");

  await button(scope, "打开任务来源：" + sourceTitle).click();
  await expect.poll(() => selectedSource(page, studio)).toBe(true);
  await screenshot(page, testInfo, "todo-source-selected");
});

test("[EDIT-TODO-04] 任务保存被拒后重试，并在重启后保留勾选", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard(checklistSeed("清单失败恢复样板"));
  await page.goto(board.url);
  const scope = await expand(page, taskTitle);
  const original = await studio.readBoard(board);
  const fault = await controlNextTodoSave(page, studio, { boardId: board.id, mode: "reject" });
  const label = "完成任务：复核配图";
  await scope.getByRole("checkbox", { name: label, exact: true }).check();
  await fault.observed;
  await fault.finished;
  const retry = button(scope, "重试保存");
  await expect(retry).toBeEnabled();
  expect(await studio.readBoard(board)).toEqual(original);
  await screenshot(page, testInfo, "todo-save-failed-before-write");

  await retry.click();
  await expect.poll(async () => (await savedTodo(studio, board))?.items[2]?.checked).toBe(true);
  await expect(retry).toBeHidden();
  const confirmed = await studio.readBoard(board);
  expect(confirmed.revision).toBe(original.revision + 1);
  await page.reload();
  expect(await studio.readBoard(board)).toEqual(confirmed);
  await studio.restart();
  await page.goto(board.url);
  const reopened = await expand(page, taskTitle);
  await expect(reopened.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
  expect(await studio.readBoard(board)).toEqual(confirmed);
  await screenshot(page, testInfo, "todo-retried-and-restarted");
});

test("[EDIT-TODO-05] 本机只读访客可展开全部任务，无写入控件", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard(checklistSeed("只读任务样板"));
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(studio.url);
    await button(page, "打开白板：" + board.title).hover();
    await button(page, "管理作品：" + board.title).click();
    await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
    await expect.poll(probe.copyCount).toBe(1);
    const guest = await probe.openGuest(board);
    await guest.getByRole("textbox", { name: /你的名字/u }).fill("任务清单查看者");
    await button(guest, "打开白板").click();
    await expect(taskText(guest, "只读")).toBeVisible();
    const before = await studio.readBoard(board);

    const scope = await expand(guest, taskTitle);
    await expect(taskList(scope).getByRole("listitem")).toHaveCount(4);
    await expect(taskText(scope, "2/4 完成")).toBeVisible();
    await expect(scope.getByRole("checkbox")).toHaveCount(0);
    await expect(button(scope, "编辑清单标题：" + taskTitle)).toHaveCount(0);
    await expect(button(scope, "添加任务")).toHaveCount(0);
    await expect(taskText(scope, "确认会签")).toBeVisible();
    expect(await studio.readBoard(board)).toEqual(before);
    await screenshot(guest, testInfo, "todo-viewer-read-only");
  } finally {
    await probe.close();
  }
});

test("[EDIT-TODO-06] 丢失已提交的任务回执后确认原勾选，没有重复保存", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard(checklistSeed("任务回执恢复样板"));
  await page.goto(board.url);
  const scope = await expand(page, taskTitle);
  const original = await studio.readBoard(board);
  const fault = await controlNextTodoSave(page, studio, { boardId: board.id, mode: "after" });
  const check = scope.getByRole("checkbox", { name: "完成任务：复核配图", exact: true });
  const retry = button(scope, "重试保存");
  await check.check();
  await fault.observed;
  await fault.finished;
  const committed = await studio.readBoard(board);
  expect(committed.revision).toBe(original.revision + 1);
  await expect.poll(async () => (await retry.isVisible()) || (await check.isEnabled())).toBe(true);
  const manual = await retry.isVisible();
  if (manual) {
    await retry.click();
  }

  await expect(retry).toBeHidden();
  await expect(check).toBeChecked();
  expect(await studio.readBoard(board)).toEqual(committed);
  await observe(testInfo, "todo-lost-receipt", { manual, extraRevisions: 1 });
  await screenshot(page, testInfo, "todo-confirmed-after-lost-receipt");
});
