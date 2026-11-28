import { expect, test as base } from "@playwright/test";
import { createBoardFixtures } from "./board-fixtures.mjs";
import { seedBoards } from "./boards.mjs";
import { recordVersionMoves } from "./history-topbar.mjs";
import { launchStudio } from "./runtime.mjs";
import { registerTopbarOverlayRuntime } from "./topbar-overlays.mjs";
import { registerWorkbenchLinkRuntime } from "./workbench-link.mjs";

export { workbenchLinkProbe } from "./workbench-link.mjs";
export { setRoomConnectionOffline } from "./room-connection.mjs";
export { failNextOlderVersions } from "./history-topbar.mjs";
export { downloadBoardExport, failNextBoardExport, readBoardDownload } from "./board-download.mjs";
export { seedTopbarAgentWorkspace, seedTopbarSuggestion } from "./topbar-overlays.mjs";
export { inspectBoardExport } from "./board-export-fidelity.mjs";
export { readPeerCursors, readPlacementPreview } from "./canvas-peer-observation.mjs";
export { controlNextTextSave } from "./canvas-persistence.mjs";
export { chooseBoardMedia, mediaDisplaySize, mediaPlaying } from "./media.mjs";
export { chooseHtmlFile, controlNextHtmlSave, embedFrame, inspectEmbedPaint } from "./embed.mjs";
export { chooseDocumentImage, readDocumentDownload } from "./document-download.mjs";
export { failNextDocumentSave } from "./document-failure.mjs";
export { controlNextTodoSave } from "./todo-save.mjs";
export { holdNextInlineTextRefresh, holdNextInlineTextWrite } from "./inline-text-refresh.mjs";

export {
  chooseArchive,
  failNextArchiveImport,
  holdNextArchiveImport,
  imageLoaded,
} from "./archives.mjs";

export const test = base.extend({
  async studio({}, use, testInfo) {
    const edition = testInfo.project.name;
    const workbenchTitle = edition === "initial" ? "Luming Studio" : "Luming Studio II";
    const overlays = testInfo.file
      .replaceAll("\\", "/")
      .endsWith("/whiteboard-topbar/overlays.spec.mjs");
    const runtime = await launchStudio(edition, { agentSuggestions: overlays && edition === "ii" });
    try {
      const studio = registerWorkbenchLinkRuntime(
        {
          edition,
          url: runtime.url,
          workbenchTitle,
          workbenchBackLabel: "返回 " + workbenchTitle,
          ...createBoardFixtures(edition, runtime),
          seedBoards: (descriptors) => seedBoards(edition, runtime, descriptors),
          seedVersionMoves: (board, count) => recordVersionMoves(runtime, edition, board, count),
          restart: () => runtime.restart(),
        },
        runtime,
      );
      await use(registerTopbarOverlayRuntime(studio, runtime));
    } finally {
      await runtime.close();
    }
  },
});

export { expect };

function requireCheckpoint(name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
    throw new Error("Evidence checkpoints must have a stable lowercase name.");
  }
}

export async function screenshot(page, testInfo, scene) {
  requireCheckpoint(scene);
  const body = await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" });
  await testInfo.attach("scene-" + scene, { contentType: "image/png", body });
}

export async function observe(testInfo, checkpoint, value) {
  requireCheckpoint(checkpoint);
  await testInfo.attach("parity-" + checkpoint, {
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

export function focused(locator) {
  return locator.evaluate((element) => element.ownerDocument.activeElement === element);
}

function catalogReadUrl(studio, method) {
  const path =
    studio.edition === "initial"
      ? "/api/tools/artifact_list"
      : "/luming.studio.v1.BoardCatalogService/" + method;

  return new URL(path, studio.url).href;
}

export async function failNextRecycleBinRead(page, studio) {
  await page.route(catalogReadUrl(studio, "ListTrashedBoards"), (route) => route.abort(), {
    times: 1,
  });
}

export async function failNextWorkbenchRead(page, studio) {
  await page.route(
    catalogReadUrl(studio, "ListBoards"),
    (route) =>
      route.fulfill({
        status: 500,
        json: { ok: false, error: { code: "INTERNAL", message: "目录读取失败。" } },
      }),
    { times: 1 },
  );
}

export async function interceptNextBoardCreation(page, studio, mode) {
  if (mode !== "hold-reply" && mode !== "reject") {
    throw new TypeError("Unsupported test mode for new board requests.");
  }

  const legacy = studio.edition === "initial";
  const path = legacy
    ? "/api/tools/artifact_manage"
    : "/luming.studio.v1.BoardCatalogService/CreateBoard";
  const received = Promise.withResolvers();
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  await page.route(
    new URL(path, studio.url).href,
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || (legacy && request.postDataJSON()?.action !== "create")) {
        await route.continue();
        received.reject(new Error("Expected the next board request to create a whiteboard."));
        finished.resolve();
        return;
      }
      if (mode === "reject") {
        await route.abort();
        received.resolve();
        finished.resolve();
        return;
      }

      try {
        const response = await route.fetch({ timeout: 8_000, maxRedirects: 0 });
        expect(response.ok()).toBe(true);
        received.resolve();
        await release.promise;
        await route.fulfill({ response });
      } catch (error) {
        received.reject(error);
        await route.abort().catch((abortError) => {
          throw new AggregateError([error, abortError], "The intercepted board request failed.");
        });

        throw error;
      } finally {
        finished.resolve();
      }
    },
    { times: 1 },
  );

  return { received: received.promise, release: release.resolve, finished: finished.promise };
}

export { readCardCover, readControlPresentation } from "./card-presentation.mjs";
export { controlNextThumbnail } from "./thumbnails.mjs";
export { readCanvas } from "./canvas-presentation.mjs";
export { readZoomDetails } from "./zoom-presentation.mjs";
export { readViewingInk } from "./reading-ink.mjs";
export {
  controlNextCanvasSave,
  enableCanvasClipboard,
  holdNextCanvasMove,
} from "./canvas-persistence.mjs";
