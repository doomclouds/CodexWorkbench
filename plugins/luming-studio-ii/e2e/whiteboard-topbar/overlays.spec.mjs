import {
  expect,
  observe,
  readCanvas,
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

async function expectAgentRangeCentered(page, studio, objectId) {
  await expect
    .poll(async () => {
      const { bounds, objects } = await readCanvas(page, studio);
      const area = objects.find(({ id }) => id === objectId);
      if (!area) {
        return Infinity;
      }

      return Math.hypot(
        area.box.x + area.box.width / 2 - (bounds.x + bounds.width / 2),
        area.box.y + area.box.height / 2 - (bounds.y + bounds.height / 2),
      );
    })
    .toBeLessThan(3);
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

  const { label, progress, complete, disconnect } = await seedTopbarAgentWorkspace(
    studio,
    board,
    object.id,
  );
  const presence = button(page, "此刻在这里");
  const working = page.getByRole("status").filter({ hasText: "准备中 · " + label });
  await expect(working).toBeVisible();
  await presence.click();
  const panel = page.getByRole("dialog", { name: "此刻在这里", exact: true });
  await expect(panel.getByText("准备中 · " + label, { exact: true })).toBeVisible();
  await expect(button(panel, "结束此工作区：" + label)).toBeEnabled();
  await screenshot(page, testInfo, "topbar-agent-present");

  await button(panel, "跟随 Agent：" + label).click();
  const following = page.getByRole("status").filter({ hasText: /正在跟随.*工作区/u });
  await expect(following).toBeVisible();
  await expectAgentRangeCentered(page, studio, object.id);
  await screenshot(page, testInfo, "topbar-agent-follow");

  await page.setViewportSize({ width: 640, height: 620 });
  await expectAgentRangeCentered(page, studio, object.id);
  await screenshot(page, testInfo, "topbar-agent-follow-narrow");
  const zoom = button(page, "缩放菜单");
  await zoom.click();
  const viewMenu = page.getByRole("menu", { name: "缩放与视图", exact: true });
  await viewMenu.getByRole("menuitem", { name: "75%", exact: true }).click();
  await expect(zoom).toHaveText("75%");
  await expect(following).toHaveCount(0);
  await screenshot(page, testInfo, "topbar-agent-manual-zoom-detaches");

  await presence.click();
  await button(panel, "跟随 Agent：" + label).click();
  await expect(following).toBeVisible();
  await progress();
  await expect(page.getByRole("status").filter({ hasText: "修改中 · " + label })).toBeVisible();
  await button(page, "停止跟随").click();
  await expect(following).toHaveCount(0);

  await complete();
  await expect(page.getByRole("status").filter({ hasText: "已完成 · " + label })).toBeVisible();
  await expect(release).toHaveCount(0);

  await seedTopbarAgentWorkspace(studio, board, object.id);
  const canvasRelease = button(page, "结束此工作区：" + label);
  await expect(canvasRelease).toBeEnabled();
  await screenshot(page, testInfo, "topbar-agent-canvas-release");
  await canvasRelease.click();
  await expect(release).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "顶栏 Agent 工作区验收", exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(page.getByText(object.label, { exact: true })).toBeVisible();
  await expect(presence).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: label })).toHaveCount(0);
  await expect(release).toHaveCount(0);
  await presence.click();
  await expect(panel.getByText("空闲", { exact: true })).toBeVisible();
  await expect(button(panel, "跟随 Agent")).toBeDisabled();
  await screenshot(page, testInfo, "topbar-agent-idle-after-reload");
  await disconnect();
  await expect(presence).toHaveCount(0);
  await observe(testInfo, "agent-workspace", { followed: true, endedAfterReload: true });
});
