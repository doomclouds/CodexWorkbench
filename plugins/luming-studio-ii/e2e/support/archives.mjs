import { readFile } from "node:fs/promises";

const archiveFixture = new URL(
  "../../apps/server/tests/fixtures/archives/legacy-v4.studio.zip",
  import.meta.url,
);

async function archiveFiles(fixture) {
  switch (fixture) {
    case "v4":
      return {
        name: "legacy-v4.studio.zip",
        mimeType: "application/zip",
        buffer: await readFile(archiveFixture),
      };
    case "invalid":
      return {
        name: "invalid.studio.zip",
        mimeType: "application/zip",
        buffer: Buffer.from("Synthetic file that is not a ZIP archive"),
      };
    case "cancel":
      return [];
    default:
      throw new Error("Select a registered archive fixture.");
  }
}

export async function chooseArchive(page, action, fixture) {
  const files = await archiveFiles(fixture);
  const [picker] = await Promise.all([page.waitForEvent("filechooser"), action()]);
  if (picker.isMultiple()) {
    throw new Error("Import must use the single-file picker.");
  }

  await picker.setFiles(files);
}

function importUrl(studio) {
  const path =
    studio.edition === "initial"
      ? "/api/import"
      : "/luming.studio.v1.BoardArchiveService/ImportBoardArchive";

  return new URL(path, studio.url).href;
}

async function forwardArchive(route) {
  if (route.request().method() !== "POST") {
    throw new Error("Archive upload must use POST.");
  }

  const response = await route.fetch({ maxRedirects: 0 });
  if (!response.ok()) {
    throw new Error(`The archive upload returned HTTP ${response.status()}.`);
  }

  return response;
}

export async function failNextArchiveImport(page, studio, mode) {
  if (mode !== "before" && mode !== "after") {
    throw new Error("Select an archive failure before or after upload.");
  }

  await page.route(
    importUrl(studio),
    async (route) => {
      if (mode === "after") {
        await forwardArchive(route);
      }
      await route.abort();
    },
    { times: 1 },
  );
}

export async function holdNextArchiveImport(page, studio) {
  const started = Promise.withResolvers();
  const gate = Promise.withResolvers();
  await page.route(
    importUrl(studio),
    async (route) => {
      try {
        const response = await forwardArchive(route);
        started.resolve();
        await gate.promise;
        await route.fulfill({ response });
      } catch (error) {
        started.reject(error);
        if (!page.isClosed()) {
          await route.abort();
        }
      }
    },
    { times: 1 },
  );

  return {
    started: started.promise,
    release: () => gate.resolve(),
  };
}

export function imageLoaded(locator) {
  return locator.evaluate((element) => element.complete && element.naturalWidth > 0);
}
