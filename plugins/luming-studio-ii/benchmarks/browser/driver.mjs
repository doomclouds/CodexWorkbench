import assert from "node:assert/strict";
import {
  beginObservation,
  endMotion,
  finishObservation,
  nextFrame,
  readView,
  waitForObservation,
} from "./observe.mjs";

const editions = {
  initial: {
    root: ".studio-canvas-viewport[aria-label='白板画布']",
    world: ".studio-canvas-world",
    id: "data-element-id",
    status: ".studio-save-status",
    savePath: "/api/tools/artifact_apply",
    back: "返回 Luming Studio",
  },
  ii: {
    root: "[data-canvas-root]:not([data-canvas-presentation])",
    world: ".studio-canvas__world",
    id: "data-canvas-object",
    status: ".whiteboard-chrome__status [role='status']",
    saveParent: ".whiteboard-chrome__status",
    savePath: "/luming.studio.v1.WhiteboardService/MoveObjects",
    back: "返回 Luming Studio II",
  },
};
const timeoutMs = 12_000;
const steps = 18;
const dragOffset = { x: 84, y: 24 };
const overviewDragOffset = { x: 24, y: 8 };
const panOffset = { x: -108, y: 36 };
const responseStatus = { ok: "ok", failure: "failure", timeout: "timeout" };

function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}

function describeFailure(error) {
  return {
    status: error?.name === "TimeoutError" ? responseStatus.timeout : responseStatus.failure,
    error: String(error?.message ?? error).split("\n")[0],
  };
}

function sampleMs(metric, from, to, problem) {
  if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
    return { metric, status: responseStatus.ok, ms: to - from };
  }

  return { metric, ...problem };
}

function sampleFrames(metric, timestamps, problem) {
  const frames = timestamps?.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
  if (frames?.length && !problem) {
    return { metric, status: responseStatus.ok, frames };
  }

  return { metric, ...problem, frames: frames ?? [] };
}

function missing(error) {
  return { status: responseStatus.failure, error };
}

async function observe(page, options, collect) {
  await beginObservation(page, options);
  let problem;
  try {
    await collect();
  } catch (error) {
    problem = describeFailure(error);
  }

  return { data: await finishObservation(page), problem };
}

async function open(page, spec, temperature) {
  const card = button(page, spec.openLabel);
  await card.waitFor({ state: "visible" });
  const { data, problem } = await observe(page, { ...spec, kind: "open" }, async () => {
    await card.click();
    await waitForObservation(page, ["paintAt", "readyAt"], timeoutMs);
  });
  const unresolved = problem ?? missing("No visible canvas or pointer target was observed.");

  return {
    data,
    samples: [
      sampleMs(`${temperature}-paint`, data.startedAt, data.paintAt, unresolved),
      sampleMs(`${temperature}-ready`, data.startedAt, data.readyAt, unresolved),
    ],
  };
}

async function mouseMotion(page, point, offset, mouseButton, count = steps) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: mouseButton });
  try {
    for (let step = 1; step <= count; step += 1) {
      const fraction = step / count;
      await page.mouse.move(point.x + offset.x * fraction, point.y + offset.y * fraction);
      await nextFrame(page);
    }
  } finally {
    await page.mouse.up({ button: mouseButton });
  }
}

async function wheelMotion(page, point, direction) {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  try {
    for (let step = 0; step < steps; step += 1) {
      await page.mouse.wheel(0, -18 * direction);
      await nextFrame(page);
    }
  } finally {
    await page.keyboard.up("Control");
  }
}

function locationOf(state, object) {
  const { viewport, camera } = state;
  return {
    x: viewport.x + camera.x + (object.x + object.width / 2) * camera.zoom,
    y: viewport.y + camera.y + (object.y + object.height / 2) * camera.zoom,
  };
}

async function moveToMiddle(page, state, target) {
  const current = locationOf(state, target);
  const { viewport } = state;
  const center = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height * 0.46 };
  const offset = { x: Math.round(center.x - current.x), y: Math.round(center.y - current.y) };
  if (Math.hypot(offset.x, offset.y) < 2) {
    return;
  }

  const count = Math.max(
    1,
    Math.ceil(Math.abs(offset.x) / (viewport.width * 0.35)),
    Math.ceil(Math.abs(offset.y) / (viewport.height * 0.35)),
  );
  const delta = { x: offset.x / count, y: offset.y / count };
  for (let segment = 0; segment < count; segment += 1) {
    const point = { x: center.x - delta.x * 0.5, y: center.y - delta.y * 0.5 };
    await mouseMotion(page, point, delta, "middle", 2);
  }
}

async function normalize(page, spec, view, target) {
  const zoomControl = button(page, "缩放菜单");
  await zoomControl.click();
  const command = view === "normal" ? "100%" : "适应白板";
  await page
    .getByRole("menu", { name: "缩放与视图", exact: true })
    .getByRole("menuitem", { name: command, exact: true })
    .click();
  await nextFrame(page);
  const state = await readView(page, spec);
  if (view === "normal") {
    assert.ok(Math.abs(state.camera.zoom - 1) < 0.005, "The normal view must start at 100%.");
    await moveToMiddle(page, state, target);
    await nextFrame(page);
  }

  return readView(page, spec);
}

function relativeOffset(offset, direction) {
  return { x: offset.x * direction, y: offset.y * direction };
}

async function performMotion(page, { kind, direction, scene, view }) {
  if (kind === "drag") {
    assert.ok(scene.object, "The move target is outside the live viewport.");
    const offset = view === "overview" ? overviewDragOffset : dragOffset;
    await mouseMotion(
      page,
      locationOf(scene, scene.object),
      relativeOffset(offset, direction),
      "left",
    );

    return;
  }

  assert.ok(scene.navigationPoint, "No unobscured point was found for camera input.");
  if (kind === "pan") {
    await mouseMotion(page, scene.navigationPoint, relativeOffset(panOffset, direction), "middle");
    return;
  }

  assert.equal(kind, "zoom");
  await wheelMotion(page, scene.navigationPoint, 1);
}

function verifyMotion(kind, before, after, data, direction) {
  if (kind === "pan") {
    assert.equal(Math.sign(after.camera.x - before.camera.x), -direction);
    assert.equal(after.camera.zoom, before.camera.zoom);
    return;
  }

  if (kind === "zoom") {
    assert.ok(after.camera.zoom > before.camera.zoom, "The wheel did not zoom in.");
    return;
  }

  assert.ok(data.pressedOnTarget, "The browser input did not hit the designated synthetic object.");
  assert.ok(after.object, "The dragged object is not visible after release.");
  assert.equal(Math.sign(after.object.x - before.object.x), direction);
}

function motionSamples(kind, { data, problem }, verified) {
  const unresolved =
    problem ?? missing("No observed content or viewport change followed the input.");
  const framesMeasured = verified && data.frames?.length > 1;

  return [
    verified
      ? sampleMs(`${kind}-latency`, data.inputAt, data.changedAt, unresolved)
      : { metric: `${kind}-latency`, ...unresolved },
    sampleFrames(`${kind}-frames`, data.frames, framesMeasured ? undefined : unresolved),
  ];
}

function saveSamples({ data, problem }) {
  const unresolved = problem ?? missing("A new save confirmation did not follow the move.");
  const endpoint = data.http;
  const success =
    endpoint?.status === undefined || (endpoint.status >= 200 && endpoint.status < 300);

  return [
    sampleMs("save-ui", data.releasedAt, data.savedAt, unresolved),
    success
      ? sampleMs("save-http", data.releasedAt, endpoint?.endAt, unresolved)
      : { metric: "save-http", ...missing(`The save returned HTTP ${endpoint.status}.`) },
  ];
}

async function motion(page, spec, view, target, kind, direction) {
  const before = await normalize(page, spec, view, target);
  const mouseButton = kind === "pan" ? 1 : 0;
  let after;
  let verification;
  const observed = await observe(page, { ...spec, kind, button: mouseButton }, async () => {
    await performMotion(page, { kind, scene: before, direction, view });
    await waitForObservation(page, ["changedAt"], timeoutMs);
    await nextFrame(page);
    await endMotion(page);
    after = await readView(page, spec);
    if (kind === "drag") {
      await waitForObservation(page, ["http", "savedAt"], timeoutMs);
    }
  });

  try {
    verifyMotion(kind, before, after, observed.data, direction);
  } catch (error) {
    verification = describeFailure(error);
  }

  const outcome = verification ? { ...observed, problem: verification } : observed;
  const samples = motionSamples(kind, outcome, !verification);
  if (kind === "drag") {
    samples.push(...saveSamples(verification ? { data: {}, problem: verification } : outcome));
  }

  return {
    samples,
    before,
    after,
    http: observed.data.http,
    pressedOnTarget: observed.data.pressedOnTarget,
  };
}

function openOptions(edition, board) {
  const config = editions[edition];
  assert.ok(config, "Unknown browser benchmark edition.");
  assert.match(board.targetId, /^[a-zA-Z0-9_-]+$/u, "Expected a synthetic move target ID.");

  return {
    ...config,
    target: `[${config.id}="${board.targetId}"]`,
    openLabel: `打开白板：${board.title}`,
  };
}

async function measureGesture(page, spec, view, target, kind, direction) {
  try {
    return await motion(page, spec, view, target, kind, direction);
  } catch (error) {
    const problem = describeFailure(error);
    const keys = [`${kind}-latency`, `${kind}-frames`];
    if (kind === "drag") {
      keys.push("save-ui", "save-http");
    }

    return { samples: keys.map((metric) => ({ metric, ...problem })) };
  }
}

function deltaFor(before, after) {
  return before?.object && after?.object
    ? { x: after.object.x - before.object.x, y: after.object.y - before.object.y }
    : undefined;
}

export async function measureRound({ page, homeUrl, board, edition, view, direction }) {
  const spec = openOptions(edition, board);
  const samples = [];
  const observation = { viewportMode: view, direction };
  page.setDefaultTimeout(timeoutMs);
  await page.goto(homeUrl);
  const cold = await open(page, spec, "cold");
  samples.push(...cold.samples);
  observation.coldCamera = cold.data.viewport;
  const back = button(page, spec.back);
  if (!(await back.isVisible())) {
    return { samples, observation };
  }

  await back.click();
  const warm = await open(page, spec, "warm");
  samples.push(...warm.samples);
  observation.warmCamera = warm.data.viewport;
  const target = (await readView(page, spec)).object;
  if (!target) {
    return { samples, observation };
  }

  for (const kind of ["pan", "zoom", "drag"]) {
    const outcome = await measureGesture(page, spec, view, target, kind, direction);
    samples.push(...outcome.samples);
    observation[kind] = { before: outcome.before, after: outcome.after, http: outcome.http };
  }

  observation.dragDelta = deltaFor(observation.drag.before, observation.drag.after);

  return { samples, observation };
}
