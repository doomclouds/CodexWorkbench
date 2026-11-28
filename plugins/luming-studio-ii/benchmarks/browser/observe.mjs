export function beginObservation(page, options) {
  return page.evaluate((spec) => {
    window.studioBenchmarkObservation?.stop();
    const state = { frames: [], viewport: null, http: null };
    const unsubscribers = [];
    const root = () => document.querySelector(spec.root);
    const target = () => root()?.querySelector(spec.target);
    const world = () => root()?.querySelector(spec.world);
    const status = () => document.querySelector(spec.status);
    let pendingFrame;
    let prior;
    let started;
    let sawPending;
    let statusObserver;
    let receiptObserver;

    function listen(type, handler) {
      document.addEventListener(type, handler, { capture: true, passive: true });
      unsubscribers.push(() => document.removeEventListener(type, handler, true));
    }

    function motionValue() {
      if (spec.kind === "drag") {
        const style = target()?.style;
        return style ? `${style.left} ${style.top}` : undefined;
      }

      return world()?.style.transform;
    }

    function trackSave(records) {
      const node = status();
      const label = node?.getAttribute("aria-label")?.trim() ?? node?.textContent?.trim();
      sawPending ||= Boolean(label?.startsWith("保存中"));
      sawPending ||= records.some(({ oldValue }) => /^保存中|^saving$/u.test(oldValue ?? ""));
      if (sawPending && label === "已保存") {
        state.savedAt ??= performance.now();
      }
    }

    function startSave() {
      receiptObserver = new PerformanceObserver(trackReceipt);
      receiptObserver.observe({ type: "resource" });
      const node = status();
      const region = spec.saveParent ? document.querySelector(spec.saveParent) : node;
      if (!region) {
        return;
      }

      statusObserver = new MutationObserver(trackSave);
      statusObserver.observe(region, {
        attributeFilter: ["aria-label", "data-save-status"],
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
        childList: true,
        subtree: true,
      });
    }

    function trackReceipt(records) {
      if (state.http) {
        return;
      }

      const result = records.getEntries().find((entry) => {
        if (entry.startTime < state.releasedAt || !entry.responseEnd) {
          return false;
        }

        const address = new URL(entry.name);

        return address.origin === location.origin && address.pathname === spec.savePath;
      });

      if (result) {
        state.http = {
          startAt: result.startTime,
          endAt: result.responseEnd,
          status: result.responseStatus,
          bytes: result.encodedBodySize,
        };
      }
    }

    function visibleSceneObject(viewport, area) {
      for (const element of viewport.querySelectorAll(`[${spec.id}]`)) {
        const box = element.getBoundingClientRect();
        const horizontal = box.right > area.left && box.left < area.right;
        const vertical = box.bottom > area.top && box.top < area.bottom;
        if (horizontal && vertical && box.width * box.height > 0) {
          return true;
        }
      }

      return false;
    }

    function openFrame() {
      if (!started || state.readyAt !== undefined) {
        return;
      }

      const viewport = root();
      if (!viewport || !world()) {
        return;
      }

      if (state.paintAt === undefined) {
        const area = viewport.getBoundingClientRect();
        if (!area.width || !area.height || !visibleSceneObject(viewport, area)) {
          return;
        }

        state.paintAt = performance.now();
      }

      const object = target();
      if (!object) {
        return;
      }

      const box = object.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (object.contains(hit) && viewport.contains(hit)) {
        state.readyAt = performance.now();
        state.viewport = world().style.transform;
      }
    }

    function frame(timestamp) {
      if (spec.kind === "open") {
        openFrame();
      } else if (state.inputAt !== undefined) {
        if (state.motionEndedAt === undefined) {
          state.frames.push(timestamp);
        }

        const next = motionValue();
        if (next && prior !== next) {
          state.changedAt ??= performance.now();
        }
      }

      pendingFrame = requestAnimationFrame(frame);
    }

    function start(event) {
      if (!event.isTrusted) {
        return;
      }

      if (event.target.closest("button")?.getAttribute("aria-label") === spec.openLabel) {
        state.startedAt = performance.now();
        started = true;
      }
    }

    function press(event) {
      if (!event.isTrusted || event.button !== spec.button) {
        return;
      }

      prior = motionValue();
      started = true;
      state.pointerDownAt = performance.now();
      state.pressedOnTarget = target()?.contains(event.target) ?? false;
    }

    function move(event) {
      if (event.isTrusted && started) {
        state.inputAt ??= performance.now();
      }
    }

    function release(event) {
      if (!event.isTrusted || !started || event.button !== spec.button) {
        return;
      }

      started = false;
      state.releasedAt = performance.now();
      if (spec.kind === "drag") {
        startSave();
      }
    }

    function wheel(event) {
      if (!event.isTrusted || !event.ctrlKey) {
        return;
      }

      prior ??= motionValue();
      state.inputAt ??= performance.now();
    }

    if (spec.kind === "open") {
      listen("click", start);
    } else if (spec.kind === "zoom") {
      listen("wheel", wheel);
    } else {
      listen("pointerdown", press);
      listen("pointermove", move);
      listen("pointerup", release);
    }

    pendingFrame = requestAnimationFrame(frame);
    window.studioBenchmarkObservation = {
      state,
      stop() {
        cancelAnimationFrame(pendingFrame);
        statusObserver?.disconnect();
        receiptObserver?.disconnect();
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      },
    };
  }, options);
}

export function waitForObservation(page, fields, timeout) {
  return page.waitForFunction(
    (keys) => keys.every((key) => window.studioBenchmarkObservation?.state[key] != null),
    fields,
    { timeout },
  );
}

export function endMotion(page) {
  return page.evaluate(() => {
    const measurement = window.studioBenchmarkObservation;
    measurement.state.motionEndedAt = performance.now();
  });
}

export function finishObservation(page) {
  return page.evaluate(() => {
    const measurement = window.studioBenchmarkObservation;
    measurement?.stop();
    delete window.studioBenchmarkObservation;

    return measurement?.state ?? {};
  });
}

export function nextFrame(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}

export function readView(page, spec) {
  return page.evaluate(({ root, target, world }) => {
    const viewport = document.querySelector(root);
    const plane = viewport?.querySelector(world);
    if (!plane) {
      throw new Error("The whiteboard viewport is unavailable.");
    }

    const box = viewport.getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(plane).transform);
    const element = viewport.querySelector(target);
    const style = element?.style;
    const object = style
      ? {
          x: Number.parseFloat(style.left),
          y: Number.parseFloat(style.top),
          width: Number.parseFloat(style.width),
          height: Number.parseFloat(style.height),
        }
      : null;
    const point = [];
    for (const [x, y] of [
      [0.82, 0.45],
      [0.73, 0.36],
      [0.61, 0.56],
      [0.88, 0.33],
    ]) {
      const scenePoint = { x: box.x + x * box.width, y: box.y + y * box.height };
      const hit = document.elementFromPoint(scenePoint.x, scenePoint.y);
      if (viewport.contains(hit) && !hit.closest("iframe,video,textarea,input")) {
        point.push(scenePoint);
      }
    }

    return {
      viewport: { x: box.x, y: box.y, width: box.width, height: box.height },
      camera: { x: matrix.e, y: matrix.f, zoom: matrix.a },
      object,
      navigationPoint: point[0] ?? null,
    };
  }, spec);
}
