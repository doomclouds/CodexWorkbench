import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { availableParallelism, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { makeCapacityFixture } from './capacity-fixtures.mjs';
import { runTemporaryServer, sha256, verifyRuntime } from './runtime-fingerprint.mjs';
import { frameIntervals, summarizeTiming } from './timing-samples.mjs';

const require = createRequire(import.meta.url);
const [runtimeDirectory, witness, profile = 'near', rawRounds = '1', browserModule = 'playwright'] =
  process.argv.slice(2);
const rounds = Number(rawRounds);
assert(['small', 'near'].includes(profile), 'Choose small or near');
assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 30, 'Choose 1 to 30 rounds');

const title = 'Studio UI synthetic ' + profile;
const viewport = { width: 1440, height: 960 };
const timeoutMs = 8_000;
const steps = 12;
const scenarios = ['fresh-open', 'fresh-drag', 'warm-open', 'warm-drag', 'pan', 'zoom'];
const directory = await mkdtemp(join(tmpdir(), 'luming-studio-ui-'));
const reportPath = join(directory, 'board-ui.json');
const dataRoot = join(directory, 'data');
const report = {
  kind: 'studio-packaged-ui-diagnostic',
  releaseEligible: false,
  observedAt: new Date().toISOString(),
  machine: {
    platform: process.platform,
    architecture: process.arch,
    osRelease: release(),
    node: process.version,
    memoryBytes: totalmem(),
    logicalConcurrency: availableParallelism(),
  },
  settings: { profile, rounds, viewport, timeoutMs, steps, channel: 'chrome', headless: true },
  samples: [],
};

function failure(error) {
  return {
    status: error.name === 'TimeoutError' ? 'timeout' : 'failure',
    code: error.code ?? error.name,
    message: error.message,
  };
}

async function seed(tool) {
  const fixture = makeCapacityFixture(profile);
  const elements = fixture.content.elements;
  const probe = elements.find((element) => element.type === 'text');
  const first = elements[0];
  first.x = probe.x;
  first.y = probe.y;
  for (const element of elements) {
    element.y += 780;
  }

  probe.x = 90;
  probe.y = 80;
  probe.w = 400;
  probe.h = 280;

  for (const image of elements.filter((element) => element.type === 'image')) {
    image.src = 'data:image/png;base64,' + fixture.resourceData.toString('base64');
  }

  const { artifact } = await tool('artifact_manage', {
    action: 'create',
    type: 'whiteboard',
    title,
    elements,
  });
  const board = await tool('artifact_read', { artifactId: artifact.id, mode: 'board' });
  assert.equal(board.elements.length, elements.length, 'Packaged board seed lost elements');
  assert(
    board.elements.some((element) => element.id === probe.id),
    'Probe object is absent',
  );
  const content = JSON.stringify(board.elements);
  report.fixture = {
    seedVersion: fixture.seedVersion,
    sourceSha256: fixture.digest,
    materializedElementsSha256: sha256(content),
    materializedElementsBytes: Buffer.byteLength(content),
    elements: elements.length,
    initialRevision: board.artifact.revision,
    probeId: probe.id,
    inlineSyntheticImages: true,
  };

  return { artifactId: artifact.id, probeId: probe.id };
}

async function recorded(page, sample, run) {
  try {
    await page.evaluate(() => {
      const capture = { timestamps: [], handle: 0, movedAt: null, target: null };
      window.__studioDiagnosticFrames = capture;
      function frame(timestamp) {
        capture.timestamps.push(timestamp);
        const target = capture.target;
        if (target && capture.movedAt === null) {
          const { left, top } = target.element.style;
          if (left !== target.left || top !== target.top) {
            capture.movedAt = performance.now();
          }
        }
        capture.handle = requestAnimationFrame(frame);
      }
      capture.handle = requestAnimationFrame(frame);
    });
    Object.assign(sample, await run(), { status: 'ok' });
  } catch (error) {
    Object.assign(sample, failure(error));
  } finally {
    try {
      sample.frameTimestampsMs = await page.evaluate(() => {
        const capture = window.__studioDiagnosticFrames;
        if (!capture) {
          return [];
        }

        cancelAnimationFrame(capture.handle);
        delete window.__studioDiagnosticFrames;
        return capture.timestamps;
      });
    } catch (error) {
      sample.frameCaptureError = failure(error);
      sample.status = sample.frameCaptureError.status;
    }

    if (sample.status === 'ok' && sample.frameTimestampsMs.length < 2) {
      Object.assign(sample, failure(new Error('No completed animation-frame interval')));
    }
  }
}

async function nextFrame(page) {
  const count = await page.evaluate(() => window.__studioDiagnosticFrames.timestamps.length);
  await page.waitForFunction(
    (previous) => window.__studioDiagnosticFrames.timestamps.length > previous,
    count,
  );
}

async function point(locator, x = 0.5, y = 0.5) {
  const bounds = await locator.boundingBox();
  assert(bounds, 'Target has no rendered bounds');
  return { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y };
}

async function dragMouse(page, at, button, direction, whileDown) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button });
  try {
    for (let step = 1; step <= steps; step++) {
      await page.mouse.move(at.x + 5 * step * direction, at.y + 2 * step * direction);
      await nextFrame(page);
    }

    return await whileDown?.();
  } finally {
    await page.mouse.up({ button });
  }
}

async function receiveSaveReceipt(page, releasedAt) {
  const receipt = await page.waitForFunction(
    (release) => {
      const response = performance
        .getEntriesByType('resource')
        .find(
          (entry) =>
            entry.startTime >= release &&
            new URL(entry.name).pathname.endsWith('/api/tools/artifact_apply'),
        );

      if (response?.responseEnd > release) {
        return { ms: response.responseEnd - release, bytes: response.decodedBodySize };
      }

      return null;
    },
    releasedAt,
    { timeout: timeoutMs },
  );

  return receipt.jsonValue();
}

async function openAndDrag(page, tool, board, round, temperature, direction) {
  const opening = { name: temperature + '-open', round };
  const drag = { name: temperature + '-drag', round };
  report.samples.push(opening, drag);
  try {
    const open = page.getByRole('button', { name: '打开白板：' + title, exact: true });
    await open.evaluate((element) => {
      element.addEventListener(
        'click',
        () => {
          window.__studioDiagnosticOpen = performance.now();
        },
        { capture: true, once: true },
      );
    });
    await open.click();
    const item = page.locator(`[data-element-id="${board.probeId}"]`);
    await item.click();
    await page.locator(`[data-element-id="${board.probeId}"].is-selected`).waitFor();
    const at = await point(item);
    await recorded(page, drag, async () => {
      const previous = await item.evaluate((element) => {
        const { left, top } = element.style;
        const capture = window.__studioDiagnosticFrames;
        capture.target = { element, left, top };
        window.addEventListener(
          'pointerdown',
          () => {
            capture.inputAt = performance.now();
          },
          { capture: true, once: true },
        );
        window.addEventListener(
          'pointerup',
          () => {
            capture.releasedAt = performance.now();
          },
          { capture: true, once: true },
        );

        return { x: parseFloat(left), y: parseFloat(top) };
      });
      const motion = await dragMouse(page, at, 'left', direction, () =>
        page.evaluate(() => {
          const { inputAt, movedAt } = window.__studioDiagnosticFrames;
          return { openAt: window.__studioDiagnosticOpen, inputAt, movedAt };
        }),
      );
      drag.motion = motion;
      assert(
        Number.isFinite(motion.movedAt) &&
          Number.isFinite(motion.inputAt) &&
          motion.movedAt >= motion.inputAt &&
          motion.inputAt >= motion.openAt,
        'Real pointer movement did not move the selected object before release',
      );
      Object.assign(opening, { status: 'ok', ms: motion.movedAt - motion.openAt });
      const position = await item.evaluate((element) => ({
        x: parseFloat(element.style.left),
        y: parseFloat(element.style.top),
      }));
      const releasedAt = await page.evaluate(() => window.__studioDiagnosticFrames.releasedAt);
      assert(Number.isFinite(releasedAt), 'Pointer release was not observed');
      assert.notDeepEqual(position, previous, 'Selected object returned to its original position');
      return {
        before: previous,
        after: position,
        motion,
        releasedAt,
        firstMotionMs: motion.movedAt - motion.inputAt,
      };
    });

    if (drag.status !== 'ok') {
      throw Object.assign(new Error(drag.message), { name: drag.code });
    }

    drag.saveReceipt = await receiveSaveReceipt(page, drag.releasedAt);
    await page.locator('[data-save-status="saved"]').waitFor();
    const saved = await tool('artifact_read', { artifactId: board.artifactId, mode: 'board' });
    const position = saved.elements.find((element) => element.id === board.probeId);
    assert(position, 'Saved object is absent');
    drag.savedRevision = saved.artifact.revision;
    drag.savedPosition = { x: position.x, y: position.y };
    assert(
      Math.abs(position.x - drag.after.x) < 0.01 && Math.abs(position.y - drag.after.y) < 0.01,
      'Backend position differs from the rendered position',
    );
  } catch (error) {
    if (!opening.status) {
      Object.assign(opening, failure(error));
    }

    if (!drag.status || drag.status === 'ok') {
      Object.assign(drag, failure(error));
    }
  }
}

async function cameraGesture(page, round, name, interact, index) {
  const sample = { name, round };
  report.samples.push(sample);
  const world = page.locator('.studio-canvas-world');
  const camera = () =>
    world.evaluate((element) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return [matrix.e, matrix.f, matrix.a];
    });
  await recorded(page, sample, async () => {
    const before = await camera();
    await interact();
    await nextFrame(page);
    const after = await camera();
    assert.notEqual(after[index], before[index], 'The viewport transform did not change');
    return { before, after };
  });
}

async function exercise(browser, connection, board, round) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  try {
    const url = connection.browser.origin + '/';
    await context.route(
      url,
      async (route) => {
        const headers = {
          ...route.request().headers(),
          authorization: connection.browser.authorization,
        };
        await route.continue({ headers });
      },
      { times: 1 },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(url);
    await openAndDrag(page, connection.tool, board, round, 'fresh', 1);
    await page.getByRole('button', { name: /^返回 .+Studio/ }).click();
    await openAndDrag(page, connection.tool, board, round, 'warm', -1);
    const canvas = page.locator('.studio-canvas-viewport');
    await cameraGesture(
      page,
      round,
      'pan',
      async () => {
        await dragMouse(page, await point(canvas, 0.7, 0.43), 'middle', 1);
      },
      0,
    );
    await cameraGesture(
      page,
      round,
      'zoom',
      async () => {
        const at = await point(canvas, 0.7, 0.43);
        await page.mouse.move(at.x, at.y);
        await page.keyboard.down('Control');
        try {
          for (let step = 0; step < steps; step++) {
            await page.mouse.wheel(0, 25);
            await nextFrame(page);
          }
        } finally {
          await page.keyboard.up('Control');
        }
      },
      2,
    );
  } finally {
    await context.close();
  }
}

function recordRoundFailure(round, error) {
  const failed = failure(error);
  report.samples.push({ name: 'round-setup', round, ...failed });
  for (const name of scenarios) {
    if (!report.samples.some((sample) => sample.round === round && sample.name === name)) {
      report.samples.push({ name, round, ...failed });
    }
  }
}

try {
  report.runtime = await verifyRuntime(runtimeDirectory, witness);
  await mkdir(dataRoot);
  await runTemporaryServer(report.runtime, dataRoot, async (connection) => {
    report.service = {
      pluginVersion: connection.session.pluginVersion,
      protocol: connection.session.serviceProtocol,
    };
    const board = await seed(connection.tool);
    const { chromium } = require(browserModule);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      report.browserVersion = browser.version();
      for (let round = 1; round <= rounds; round++) {
        try {
          await exercise(browser, connection, board, round);
        } catch (error) {
          recordRoundFailure(round, error);
        }
      }
    } finally {
      await browser.close();
    }
  });
} catch (error) {
  report.samples.push({ name: 'probe-setup', ...failure(error) });
} finally {
  if (report.runtime) {
    try {
      report.runtimeAfter = await verifyRuntime(runtimeDirectory, witness);
    } catch (error) {
      report.samples.push({ name: 'verify-runtime-after', ...failure(error) });
    }
  }

  report.summary = {};
  for (const name of new Set(report.samples.map((sample) => sample.name))) {
    const samples = report.samples.filter((sample) => sample.name === name);
    const opening = name.endsWith('-open');
    const frames = samples.flatMap((sample) =>
      sample.status === 'ok' && sample.frameTimestampsMs
        ? frameIntervals(sample.frameTimestampsMs)
        : [],
    );
    const failures = samples.filter((sample) => sample.status !== 'ok');
    report.summary[name] = {
      attempts: samples.length,
      timing: summarizeTiming(opening ? samples : [...frames, ...failures]),
      framesOver50Ms: frames.filter(({ ms }) => ms > 50).length,
    };

    if (name.endsWith('-drag')) {
      report.summary[name].firstMotion = summarizeTiming(
        samples.map((sample) => ({
          status: sample.status,
          ms: sample.firstMotionMs,
        })),
      );
      report.summary[name].saveReceipt = summarizeTiming(
        samples.map((sample) => ({
          status: sample.status,
          ms: sample.saveReceipt?.ms,
        })),
      );
    }
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(reportPath);
  if (report.samples.some((sample) => sample.status !== 'ok')) {
    process.exitCode = 1;
  }
}
