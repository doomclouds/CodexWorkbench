import {
  expect,
  observe,
  observeWorkbenchCatalog,
  screenshot,
  test,
  trackWorkbenchCard,
} from "../support/studio.mjs";

const button = (page, name) => page.getByRole("button", { name, exact: true });
const card = (page, title) => button(page, "打开白板：" + title);
const blank = "未命名白板";
const newTitle = "实时目录新增";

async function createAndRename(peer, observer, studio) {
  await peer.goto(studio.url);
  await button(peer, "新建白板").click();
  const title = peer.getByRole("textbox", { name: "白板名称", exact: true });
  await expect(title).toHaveValue(blank);
  await expect(card(observer, blank)).toBeVisible();
  await title.fill(newTitle);
  await title.press("Enter");
  await expect(card(observer, newTitle)).toBeVisible();
  await expect(card(observer, blank)).toHaveCount(0);
}

async function editContent(peer, board) {
  await peer.goto(board.url);
  await peer.getByText(board.contentText, { exact: true }).dblclick();
  const editor = peer.getByRole("textbox", { name: "编辑文字", exact: true });
  await editor.fill("实时目录正文已经保存");
  await editor.press("Escape");
  await expect(peer.getByText("实时目录正文已经保存", { exact: true })).toBeVisible();
}

async function trashAndRestore(peer, observer, studio, testInfo) {
  await button(peer, studio.workbenchBackLabel).click();
  await card(peer, newTitle).hover();
  await button(peer, "管理作品：" + newTitle).click();
  await peer.getByRole("menuitem", { name: "移入回收站", exact: true }).click();
  await expect(card(observer, newTitle)).toHaveCount(0);
  await screenshot(observer, testInfo, "live-workbench-after-trash");
  await button(peer, "筛选作品").click();
  await peer.getByRole("menuitemradio", { name: "回收站", exact: true }).click();
  await button(peer, "恢复作品：" + newTitle).click();
  await expect(card(observer, newTitle)).toBeVisible();
}

test("[WB-LIVE-01] 外部新建、改名、保存及回收恢复自动更新同一工作台", async ({
  page,
  studio,
}, testInfo) => {
  if (studio.edition === "initial") {
    await page.goto(studio.url);
    await expect(
      page.getByRole("heading", { name: studio.workbenchTitle, exact: true }),
    ).toBeVisible();

    return;
  }

  const [edited, stable] = await studio.seedBoards([
    { title: "实时目录正文", withContent: true },
    { title: "实时目录参照" },
  ]);
  const requests = observeWorkbenchCatalog(page, studio);
  await page.goto(studio.url);
  await expect(card(page, edited.title)).toBeVisible();
  await expect(card(page, stable.title)).toBeVisible();
  const initialCard = await trackWorkbenchCard(card(page, stable.title));
  await expect.poll(() => requests.read().wait).toBeGreaterThan(0);
  const beforeIdle = requests.read();
  const idle = await requests.idle();
  expect(idle).toMatchObject({ list: beforeIdle.list, scene: 0, pageLoads: 1 });
  await screenshot(page, testInfo, "live-workbench-before-external-changes");

  const peer = await page.context().newPage();
  try {
    await createAndRename(peer, page, studio);
    expect((await initialCard.read()).sameElement).toBe(true);
    await button(page, "搜索作品").click();
    const search = page.getByRole("textbox", { name: "搜索作品名称" });
    await search.fill("实时目录");
    await expect(card(page, edited.title)).toBeVisible();
    const stableCard = await trackWorkbenchCard(card(page, stable.title));
    const editedCard = await trackWorkbenchCard(card(page, edited.title));
    await expect.poll(async () => (await editedCard.read()).preview).toBeTruthy();
    const initialPreview = (await editedCard.read()).preview;
    expect(initialPreview).toBeTruthy();
    await editContent(peer, edited);
    await expect
      .poll(async () => {
        const current = await editedCard.read();
        return Boolean(current.preview && current.preview !== initialPreview);
      })
      .toBe(true);
    await trashAndRestore(peer, page, studio, testInfo);
    await expect(search).toHaveValue("实时目录");
    expect((await stableCard.read()).sameElement).toBe(true);
    expect((await editedCard.read()).sameElement).toBe(true);
    expect(requests.read()).toMatchObject({ scene: 0, pageLoads: 1 });
    await screenshot(page, testInfo, "live-workbench-after-restore-and-save");
    await observe(testInfo, "workbench-external-changes", {
      static: idle,
      afterChanges: requests.read(),
      originalCardsMounted: true,
      previewUpdated: true,
      searchRetained: true,
    });
  } finally {
    await peer.close();
  }
});
