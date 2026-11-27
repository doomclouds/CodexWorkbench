import { expect, test as base } from "@playwright/test";
import { seedBoards } from "./boards.mjs";
import { launchStudio } from "./runtime.mjs";
import { registerWorkbenchLinkRuntime } from "./workbench-link.mjs";

export { workbenchLinkProbe } from "./workbench-link.mjs";

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
    const runtime = await launchStudio(edition);
    try {
      await use(
        registerWorkbenchLinkRuntime(
          {
            edition,
            url: runtime.url,
            workbenchTitle,
            workbenchBackLabel: "返回 " + workbenchTitle,
            seedBoards: (descriptors) => seedBoards(edition, runtime, descriptors),
            restart: () => runtime.restart(),
          },
          runtime,
        ),
      );
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
