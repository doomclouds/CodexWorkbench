import { expect, test as base } from "@playwright/test";
import { seedBoards } from "./boards.mjs";
import { launchStudio } from "./runtime.mjs";

export const test = base.extend({
  async studio({}, use, testInfo) {
    const edition = testInfo.project.name;
    const runtime = await launchStudio(edition);
    try {
      await use({
        edition,
        url: runtime.url,
        seedBoards: (descriptors) => seedBoards(edition, runtime, descriptors),
        restart: () => runtime.restart(),
      });
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

export async function failNextRecycleBinRead(page, studio) {
  const path =
    studio.edition === "initial"
      ? "/api/tools/artifact_list"
      : "/luming.studio.v1.BoardCatalogService/ListTrashedBoards";
  await page.route(new URL(path, studio.url).href, (route) => route.abort(), { times: 1 });
}
