import { createRequire } from "node:module";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { fromBinary } = requireServer("@bufbuild/protobuf");
const { BoardEditService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/edits",
);
const todoEdit = BoardEditService.method.editObjectContent;

function requestBoard(request, initial) {
  if (request.method() !== "POST") {
    return undefined;
  }

  if (initial) {
    const { artifactId, operations } = request.postDataJSON();
    return operations?.some(({ op }) => op === "todo") ? artifactId : undefined;
  }

  const { boardId, edit } = fromBinary(todoEdit.input, request.postDataBuffer());
  return edit.case === "todo" ? boardId : undefined;
}

async function committed(response, initial) {
  if (!response.ok()) {
    return false;
  }
  if (initial) {
    return (await response.json()).ok === true;
  }

  const reply = fromBinary(todoEdit.output, new Uint8Array(await response.body()));
  return reply.receipt?.outcome.case === "applied";
}

export async function controlNextTodoSave(page, studio, { boardId, mode }) {
  if (typeof boardId !== "string" || !boardId || !["reject", "after"].includes(mode)) {
    throw new TypeError("Select a seeded whiteboard and an approved Todo save mode.");
  }

  const initial = studio.edition === "initial";
  const path = initial
    ? "/api/tools/artifact_apply"
    : "/" + todoEdit.parent.typeName + "/" + todoEdit.name;
  const url = new URL(path, studio.url).href;
  const observed = Promise.withResolvers();
  const finished = Promise.withResolvers();
  let intercepted = false;
  await page.route(url, async (route) => {
    if (intercepted || requestBoard(route.request(), initial) !== boardId) {
      await route.continue();
      return;
    }

    intercepted = true;
    try {
      if (mode === "reject") {
        await route.fulfill({
          status: 400,
          json: { ok: false, error: { code: "INVALID_ARGUMENT", message: "本次任务保存未执行。" } },
        });
        observed.resolve();
        return;
      }

      const response = await route.fetch({ timeout: 8_000, maxRedirects: 0 });
      if (!(await committed(response, initial))) {
        throw new Error("The isolated Todo edit was not committed.");
      }

      observed.resolve();
      await route.abort();
    } catch (error) {
      observed.reject(error);
      if (!page.isClosed()) {
        await route.abort();
      }

      throw error;
    } finally {
      finished.resolve();
    }
  });

  return { observed: observed.promise, finished: finished.promise };
}
