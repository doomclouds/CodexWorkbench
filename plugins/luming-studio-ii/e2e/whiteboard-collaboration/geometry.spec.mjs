import {
  expect,
  observe,
  readCanvas,
  screenshot,
  test,
  workbenchLinkProbe,
} from "../support/studio.mjs";

const editorName = "布局验收编辑者";
const outlines = [
  "rounded",
  "rect",
  "ellipse",
  "diamond",
  "pill",
  "hexagon",
  "parallelogram",
  "database",
  "queue",
  "document",
  "cloud",
  "person",
];

function sample(kind, content = {}) {
  return { id: "collab-" + kind, kind, label: "协作 " + kind, ...content };
}

const outlinesCase = outlines.map((outline) =>
  sample("shape", { id: "outline-" + outline, label: "协作 " + outline, outline }),
);
const authored = [
  sample("text"),
  sample("note", { fill: "#F9E56F" }),
  sample("section", { transparent: true }),
  sample("table", {
    head: true,
    rows: [
      ["栏目一", "栏目二"],
      ["数据一", "数据二"],
    ],
  }),
  sample("document", {
    width: 264,
    height: 162,
    document: { blocks: [{ id: "document-body", type: "paragraph", content: "协作文档段落" }] },
  }),
  sample("todo", { x: 484, items: [{ id: "todo-one", text: "协作任务" }] }),
];
const media = [
  sample("image", { mediaFixture: "board-svg" }),
  sample("video", { x: 390, mediaFixture: "blue-frame" }),
  sample("link", { x: 690, href: "https://example.test/" }),
  sample("sticker", { x: 990, stickerIconId: "heart" }),
];
const embeds = ["html", "diagram", "chart"].map((kind) =>
  sample(kind, {
    html: '<main style="margin:0;background:#deefde"><b>协作图解</b></main>',
  }),
);
const paths = [sample("ink"), sample("connector")];
const cases = [
  { id: "01", title: "十二种流程图轮廓", samples: outlinesCase },
  { id: "02", title: "文字、便签、分区、文档、表格与待办", samples: authored },
  { id: "03", title: "图片、视频、链接与贴纸", samples: media },
  {
    id: "04",
    title: "HTML、图解、图表、笔迹与连接线",
    samples: [...embeds, ...paths],
  },
];
const embeddedKinds = new Set(["html", "diagram", "chart"]);
const gripLabels = new Map([
  ["document", "移动文档"],
  ["todo", "移动任务清单"],
]);

function prepareObject(object, index) {
  const x = object.x ?? 90 + (index % 4) * 262;
  const y = object.y ?? 150 + Math.floor(index / 4) * 195;
  const geometry = { x, y, width: object.width ?? 194, height: object.height ?? 117 };
  if (object.kind === "connector") {
    return {
      ...object,
      ...geometry,
      start: object.start ?? { x, y: y + 14 },
      end: object.end ?? { x: x + geometry.width, y: y + 90 },
    };
  }
  if (object.kind === "ink") {
    return {
      ...object,
      ...geometry,
      points: [0, 18, 45, 45, 122, 72, geometry.width, 96],
      stroke: "#2F7CC4",
      strokeWidth: 5,
    };
  }

  return { ...object, ...geometry };
}

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

function pick(objects, id) {
  const value = objects.find((item) => item.id === id);
  if (!value) {
    throw new Error("Expected the canvas object " + id);
  }

  return value;
}

function point(box, x = 0.5, y = 0.5) {
  if (!box) {
    throw new Error("Expected a rendered control");
  }

  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

function worldBox(frame, id) {
  const { bounds, zoom, pan } = frame;
  const { box } = pick(frame.objects, id);
  if (!box || !bounds || zoom <= 0) {
    throw new Error("Expected a visible board viewport for " + id);
  }

  return {
    x: (box.x - bounds.x - pan.x) / zoom,
    y: (box.y - bounds.y - pan.y) / zoom,
    width: box.width / zoom,
    height: box.height / zoom,
  };
}

function pixelsBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height);
}

function mutationDistance(before, after, kind, operation) {
  if (operation === "rotate") {
    return Math.abs(after.rotation - before.rotation);
  }
  if (operation === "resize") {
    return Math.hypot(after.width - before.width, after.height - before.height);
  }
  if (kind === "connector") {
    return Math.hypot(after.start.x - before.start.x, after.start.y - before.start.y);
  }

  return Math.hypot(after.x - before.x, after.y - before.y);
}

async function waitForObjects(page, studio, objects) {
  const ids = objects.map(({ id }) => id).sort();
  await expect
    .poll(async () =>
      (await readCanvas(page, studio)).objects
        .map(({ id }) => id)
        .filter((id) => ids.includes(id))
        .sort(),
    )
    .toEqual(ids);
}

async function openPair(page, browser, studio, samples, title) {
  const objects = samples.map(prepareObject);
  const board = await studio.seedBasicBoard({ title, objects });
  const probe = await workbenchLinkProbe({ page, browser, studio });
  try {
    await page.goto(board.url);
    await waitForObjects(page, studio, objects);
    await button(page, "分享").click();
    await button(page, "复制可编辑链接").click();
    await expect.poll(probe.copyCount).toBe(1);
    const guest = await probe.openGuest(board, {
      role: "editor",
      viewport: { width: 1366, height: 820 },
    });
    await guest.getByRole("textbox", { name: /你的名字/u }).fill(editorName);
    await button(guest, "打开白板").click();
    await waitForObjects(guest, studio, objects);
    await page.keyboard.press("Escape");

    return { board, objects, guest, probe };
  } catch (error) {
    await probe.close();
    throw error;
  }
}

async function selectObject(page, studio, id) {
  const view = pick((await readCanvas(page, studio)).objects, id);
  const target = view.pathPoints?.[2] ?? point(view.titleBox ?? view.box);
  await page.mouse.click(target.x, target.y);

  return target;
}

async function gripCenter(page, label) {
  const grip = button(page, label);
  await expect(grip).toBeEnabled();

  return point(await grip.boundingBox());
}

async function selectVideo(page, studio, id) {
  const frame = await readCanvas(page, studio);
  const { x, y, width, height } = pick(frame.objects, id).box;
  const clearing = { x: frame.bounds.x + 35, y: frame.bounds.y + 100 };
  await page.mouse.click(clearing.x, clearing.y);
  await dragPointer(page, { x: x - 14, y: y - 14 }, { x: width + 28, y: height + 28 });
}

async function moveStart(page, studio, object) {
  const view = pick((await readCanvas(page, studio)).objects, object.id);
  if (embeddedKinds.has(object.kind)) {
    if (studio.edition === "ii") {
      const { x, y } = point(view.box);
      await page.mouse.click(x, y);
      return gripCenter(page, object.kind === "html" ? "移动 HTML 图解" : "移动 嵌入对象");
    }

    return point(view.titleBox ?? view.box, 0.45, view.titleBox ? 0.5 : 0.05);
  }
  if (gripLabels.has(object.kind)) {
    return gripCenter(page, gripLabels.get(object.kind));
  }

  if (object.kind === "video") {
    await selectVideo(page, studio, object.id);
    return gripCenter(page, "移动 视频");
  }

  return view.pathPoints?.[2] ?? point(view.titleBox ?? view.box);
}

async function dragPointer(page, start, offset, whileHeld) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + offset.x, start.y + offset.y, { steps: 8 });
    await whileHeld?.();
  } finally {
    await page.mouse.up();
  }
}

async function expectPosition(peer, studio, id, expected) {
  await expect
    .poll(
      async () => {
        const actual = worldBox(await readCanvas(peer, studio), id);

        return pixelsBetween(actual, expected) < 1.5 ? [] : [actual];
      },
      { message: id + " at " + JSON.stringify(expected) },
    )
    .toEqual([]);
}

async function syncGesture({
  actor,
  peer,
  studio,
  board,
  object,
  start,
  offset,
  record,
  operation,
}) {
  const snapshot = await studio.readBoard(board);
  const before = pick(snapshot.objects, object.id);
  const displayed = worldBox(await readCanvas(peer, studio), object.id);
  const ghost = peer.getByLabel(/正在调整对象$/u);
  await dragPointer(actor, start, offset, async () => {
    if (studio.edition === "initial") {
      await expect(ghost).toBeVisible();
    } else {
      await expect
        .poll(async () =>
          pixelsBetween(worldBox(await readCanvas(peer, studio), object.id), displayed),
        )
        .toBeGreaterThan(12);
    }

    expect((await studio.readBoard(board)).revision).toBe(snapshot.revision);
    await record?.();
  });
  await expect
    .poll(async () =>
      mutationDistance(
        before,
        pick((await studio.readBoard(board)).objects, object.id),
        object.kind,
        operation,
      ),
    )
    .toBeGreaterThan(12);

  if (studio.edition === "initial") {
    await expect(ghost).toHaveCount(0);
  }

  const accepted = worldBox(await readCanvas(actor, studio), object.id);
  await expectPosition(peer, studio, object.id, accepted);

  return accepted;
}

async function moveLegacyVideo({ actor, peer, studio, board, object }) {
  await selectVideo(actor, studio, object.id);
  await expect(button(actor, "调整元素大小 se")).toBeVisible();
  const before = pick((await studio.readBoard(board)).objects, object.id);
  await actor.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(async () => pick((await studio.readBoard(board)).objects, object.id).x)
    .toBeGreaterThan(before.x);
  const accepted = worldBox(await readCanvas(actor, studio), object.id);
  await expectPosition(peer, studio, object.id, accepted);

  return accepted;
}

async function resizeStart(page, studio, { id, kind }) {
  if (kind === "video") {
    await selectVideo(page, studio, id);
  } else {
    await selectObject(page, studio, id);
  }

  const label = studio.edition === "initial" ? "调整元素大小 se" : "缩放右下角";

  return gripCenter(page, label);
}

for (const { id, title, samples } of cases) {
  test(
    "[COLLAB-GEOM-" + id + "] " + title + "的跨会话几何同步",
    async ({ page, browser, studio }, testInfo) => {
      const { board, objects, guest, probe } = await openPair(
        page,
        browser,
        studio,
        samples,
        title,
      );
      const saved = new Map();
      const outcomes = [];
      try {
        for (const [index, object] of objects.entries()) {
          const actor = index % 2 === 0 ? page : guest;
          const peer = actor === page ? guest : page;
          const keyboardMove = studio.edition === "initial" && object.kind === "video";
          await test.step("移动 " + object.label, async () => {
            if (keyboardMove) {
              saved.set(object.id, await moveLegacyVideo({ actor, peer, studio, board, object }));
              return;
            }

            const start = await moveStart(actor, studio, object);
            if (object.kind === "video") {
              await screenshot(actor, testInfo, "geometry-selected-video-drag-handle");
            }

            const record =
              index === 0
                ? () => screenshot(peer, testInfo, "geometry-remote-drag-while-held")
                : undefined;
            saved.set(
              object.id,
              await syncGesture({
                actor,
                peer,
                studio,
                board,
                object,
                start,
                offset: { x: 32, y: 29 },
                record,
              }),
            );
          });
          const legacyFixedCard = studio.edition === "initial" && object.kind === "link";
          const resizeSupported = object.kind !== "connector" && !legacyFixedCard;
          if (resizeSupported) {
            await test.step("缩放 " + object.label, async () => {
              const start = await resizeStart(peer, studio, object);
              saved.set(
                object.id,
                await syncGesture({
                  actor: peer,
                  peer: actor,
                  studio,
                  board,
                  object,
                  start,
                  offset: { x: 29, y: 27 },
                  operation: "resize",
                }),
              );
            });
          }

          outcomes.push({
            kind: object.kind,
            outline: object.outline,
            mover: actor === page ? "owner" : "editor",
            move: keyboardMove ? "keyboard" : "drag",
            liveMovePreview: !keyboardMove,
            resize: resizeSupported,
          });
        }

        await screenshot(page, testInfo, "geometry-owner-after-save");
        await guest.reload();
        await waitForObjects(guest, studio, objects);
        for (const [objectId, box] of saved) {
          await expectPosition(guest, studio, objectId, box);
        }
        await screenshot(guest, testInfo, "geometry-editor-after-reload");
        await observe(testInfo, "geometry-capabilities", outcomes);
      } finally {
        await probe.close();
      }
    },
  );
}

const organizationShapes = [
  sample("shape", { id: "layer-a", x: 160, y: 200, label: "第一张卡片" }),
  sample("shape", { id: "layer-b", x: 236, y: 250, label: "第二张卡片" }),
  sample("shape", { id: "layer-c", x: 680, y: 360, label: "独立卡片" }),
];

async function paintedPoint(page, studio, id, x, y) {
  const view = pick((await readCanvas(page, studio)).objects, id);

  return point(view.box, x, y);
}

async function contextAction(page, target, name) {
  await page.mouse.click(target.x, target.y, { button: "right" });
  const menu = page.getByRole("menu", { name: "白板操作", exact: true });
  const item = menu.getByRole("menuitem", { name, exact: typeof name === "string" });
  await expect(item).toBeEnabled();
  await item.click();
}

async function selectOrganizationPair(page, studio) {
  const a = await paintedPoint(page, studio, "layer-a", 0.2, 0.2);
  const b = await paintedPoint(page, studio, "layer-b", 0.8, 0.8);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down("Shift");
  try {
    await page.mouse.click(b.x, b.y);
  } finally {
    await page.keyboard.up("Shift");
  }

  return a;
}

function organizationPair(snapshot) {
  return [pick(snapshot.objects, "layer-a"), pick(snapshot.objects, "layer-b")];
}

async function groupToken(studio, board) {
  const [a, b] = organizationPair(await studio.readBoard(board));

  return a.groupId === b.groupId ? a.groupId : undefined;
}

test("[COLLAB-GEOM-05] 跨会话图层、组合移动及位置锁定", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const { board, objects, guest, probe } = await openPair(
    page,
    browser,
    studio,
    organizationShapes,
    "布局协作与锁定",
  );
  const selectA = (tab) => paintedPoint(tab, studio, "layer-a", 0.2, 0.2);
  try {
    await contextAction(guest, await selectA(guest), "置于顶层");
    const expectedOrder = ["layer-b", "layer-c", "layer-a"];
    await expect
      .poll(async () => (await readCanvas(page, studio)).objects.map(({ id }) => id))
      .toEqual(expectedOrder);
    expect((await studio.readBoard(board)).objects.map(({ id }) => id)).toEqual(expectedOrder);

    await contextAction(page, await selectOrganizationPair(page, studio), "组合");
    await expect.poll(() => groupToken(studio, board)).toBeTruthy();
    const grouped = organizationPair(await studio.readBoard(board));
    const secondBox = worldBox(await readCanvas(page, studio), "layer-b");
    await syncGesture({
      actor: guest,
      peer: page,
      studio,
      board,
      object: objects[0],
      start: await selectA(guest),
      offset: { x: 36, y: 42 },
    });
    const moved = organizationPair(await studio.readBoard(board));
    expect(moved[0].x - grouped[0].x).toBeCloseTo(moved[1].x - grouped[1].x, 1);
    expect(moved[0].y - grouped[0].y).toBeCloseTo(moved[1].y - grouped[1].y, 1);
    await expect
      .poll(async () =>
        pixelsBetween(worldBox(await readCanvas(page, studio), "layer-b"), secondBox),
      )
      .toBeGreaterThan(12);
    await screenshot(page, testInfo, "geometry-remote-group-and-layer");

    await contextAction(guest, await selectA(guest), "取消组合");
    await expect.poll(() => groupToken(studio, board)).toBeFalsy();
    await contextAction(page, await selectA(page), /^锁定位置与尺寸/u);
    await expect
      .poll(async () => organizationPair(await studio.readBoard(board))[0].locked)
      .toBe(true);
    await guest.reload();
    await waitForObjects(guest, studio, objects);
    const locked = await studio.readBoard(board);
    await dragPointer(guest, await selectA(guest), { x: -38, y: 38 });
    expect((await studio.readBoard(board)).revision).toBe(locked.revision);
    await screenshot(guest, testInfo, "geometry-editor-respects-remote-lock");

    await contextAction(page, await selectA(page), /^解锁位置与尺寸/u);
    await expect
      .poll(async () => organizationPair(await studio.readBoard(board))[0].locked)
      .toBe(false);
    await syncGesture({
      actor: guest,
      peer: page,
      studio,
      board,
      object: objects[0],
      start: await selectA(guest),
      offset: { x: -33, y: 35 },
    });
    const final = organizationPair(await studio.readBoard(board));
    expect(final[1].x).toBe(moved[1].x);
    expect(final[1].y).toBe(moved[1].y);
    await observe(testInfo, "geometry-layout-authorization", {
      layer: true,
      group: true,
      lock: true,
      separateAfterUngroup: true,
    });
  } finally {
    await probe.close();
  }
});

test("[COLLAB-GEOM-06] 编辑者旋转图形，房主看到连线随端口更新", async ({
  page,
  browser,
  studio,
}, testInfo) => {
  const endpoints = [
    sample("shape", { id: "turning", x: 150, y: 225, label: "旋转起点" }),
    sample("shape", { id: "fixed", x: 580, y: 360, label: "固定终点" }),
    sample("connector", {
      id: "attached",
      start: { objectId: "turning", port: "right" },
      end: { objectId: "fixed", port: "left" },
    }),
  ];
  const { board, objects, guest, probe } = await openPair(
    page,
    browser,
    studio,
    endpoints,
    "旋转与连接端口",
  );

  try {
    const prior = worldBox(await readCanvas(page, studio), "attached");
    await selectObject(guest, studio, "turning");
    const rotationLabel = studio.edition === "initial" ? "旋转所选元素 ne" : "旋转所选对象 ne";
    const start = await gripCenter(guest, rotationLabel);
    const pivot = await paintedPoint(guest, studio, "turning", 0.5, 0.5);
    const angle = (31 * Math.PI) / 180;
    const x = start.x - pivot.x;
    const y = start.y - pivot.y;
    const offset = {
      x: Math.cos(angle) * x - Math.sin(angle) * y - x,
      y: Math.sin(angle) * x + Math.cos(angle) * y - y,
    };
    await syncGesture({
      actor: guest,
      peer: page,
      studio,
      board,
      object: objects[0],
      start,
      offset,
      operation: "rotate",
    });
    const persisted = (await studio.readBoard(board)).objects;
    expect(pick(persisted, "turning").rotation).toBeCloseTo(31, 0);
    expect(pick(persisted, "attached").start).toEqual(endpoints[2].start);
    expect(pick(persisted, "attached").end).toEqual(endpoints[2].end);
    await expect
      .poll(async () => pixelsBetween(worldBox(await readCanvas(page, studio), "attached"), prior))
      .toBeGreaterThan(12);
    const wire = worldBox(await readCanvas(page, studio), "attached");
    await expectPosition(guest, studio, "attached", wire);
    await screenshot(page, testInfo, "geometry-remote-rotation-connected-port");
    await page.reload();
    await waitForObjects(page, studio, objects);
    await expectPosition(page, studio, "attached", wire);
  } finally {
    await probe.close();
  }
});
