import {
  expect,
  observe,
  screenshot,
  seedTopbarAgentWorkspace,
  seedTopbarSuggestion,
  test,
} from "../support/studio.mjs";

const object = {
  id: "topbar-suggestion-text",
  kind: "text",
  label: "发布卡片原文",
  x: 100,
  y: 130,
  width: 240,
  height: 120,
};

function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}

test("[TOPBAR-OVERLAY-01] 备注列表中的私人建议可预览和清除，未选方案不修改白板", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "顶栏私人建议验收", objects: [object] });
  const initial = studio.edition === "initial";
  const before = await studio.readBoard(board);
  const proposal = initial ? undefined : await seedTopbarSuggestion(studio, board, object.id);

  await page.goto(board.url);
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  await expect(button(page, "私人建议")).toHaveCount(0);
  await button(page, "备注列表").click();
  const panel = page.getByRole("dialog", { name: "所有备注", exact: true });
  await expect(panel).toBeVisible();
  const card = panel.getByRole("article", { name: "私人建议", exact: true });

  if (!proposal) {
    await expect(card).toHaveCount(0);
    await screenshot(page, testInfo, "topbar-initial-no-independent-suggestions");
    await observe(testInfo, "suggestion-entry", {
      separateTopbarTrigger: false,
      scopedPrivateSuggestion: false,
    });

    return;
  }

  await expect(card.getByText(proposal.observation, { exact: true })).toBeVisible();
  const [first, second] = proposal.alternatives;
  await expect(button(card, second.label)).toBeVisible();
  await button(card, first.label).hover();
  const preview = page.getByRole("region", { name: "只读方案预览", exact: true });
  await expect(preview.getByText(first.headline, { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "topbar-suggestion-preview");
  expect((await studio.readBoard(board)).objects[0]?.text).toBe(object.label);

  await button(card, "清除建议，保留已应用内容").click();
  await expect(panel.getByText("已清除建议，保留已应用内容。", { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await screenshot(page, testInfo, "topbar-suggestion-cleared");
  await page.reload();
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  await button(page, "备注列表").click();
  await expect(panel).toBeVisible();
  await expect(card).toHaveCount(0);

  const after = await studio.readBoard(board);
  expect(after.revision).toBe(before.revision);
  expect(after.objects[0]?.text).toBe(object.label);
  await observe(testInfo, "suggestion-entry", {
    separateTopbarTrigger: false,
    scopedPrivateSuggestion: true,
    previewChangedBoard: false,
    clearedAfterReload: true,
  });
});

test("[TOPBAR-OVERLAY-02] Agent 工作区出现后可跟随、停止并由房主结束", async ({
  page,
  studio,
}, testInfo) => {
  const board = await studio.seedBasicBoard({ title: "顶栏 Agent 工作区验收", objects: [object] });
  const initial = studio.edition === "initial";
  await page.goto(board.url);
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  const release = page.getByRole("button", { name: /^结束此工作区/u });
  await expect(release).toHaveCount(0);

  if (initial) {
    await observe(testInfo, "agent-workspace", { verified: "初代未启动 Agent 工作区" });
    return;
  }

  const label = await seedTopbarAgentWorkspace(studio, board, object.id);
  const presence = button(page, "此刻在这里");
  await presence.click();
  const panel = page.getByRole("dialog", { name: "此刻在这里", exact: true });
  await expect(panel.getByText("准备中 · " + label, { exact: true })).toBeVisible();
  await expect(button(panel, "结束此工作区：" + label)).toBeEnabled();
  await screenshot(page, testInfo, "topbar-agent-present");

  await button(panel, "跟随 Agent：" + label).click();
  await expect(page.getByRole("status").filter({ hasText: /正在跟随.*工作区/u })).toBeVisible();
  await screenshot(page, testInfo, "topbar-agent-follow");
  await button(page, "停止跟随").click();
  await expect(page.getByRole("status").filter({ hasText: /正在跟随.*工作区/u })).toHaveCount(0);

  await presence.click();
  await button(panel, "结束此工作区：" + label).click();
  await expect(release).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  await expect(presence).toHaveCount(0);
  await observe(testInfo, "agent-workspace", { followed: true, endedAfterReload: true });
});
