import { createRequire } from "node:module";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { fromBinary } = requireServer("@bufbuild/protobuf");
const { BoardEditService } = requireServer(
  "@codexworkbench/luming-studio-ii-contracts/whiteboard/edits",
);
const { editObjectContent } = BoardEditService.method;

function documentWrite(request, boardId, initial) {
  if (request.method() !== "POST") {
    return false;
  }

  if (initial) {
    const body = request.postDataJSON();

    return body?.artifactId === boardId && body.operations?.some(({ op }) => op === "document");
  }

  const bytes = request.postDataBuffer();
  const input = bytes && fromBinary(editObjectContent.input, bytes);

  return input?.boardId === boardId && input.edit.case === "document";
}

export async function failNextDocumentSave(page, studio, board) {
  const initial = studio.edition === "initial";
  const path = initial
    ? "/api/tools/artifact_apply"
    : "/" + editObjectContent.parent.typeName + "/" + editObjectContent.name;
  const url = new URL(path, studio.url).href;
  let intercepted = false;

  async function fail(route) {
    if (intercepted || !documentWrite(route.request(), board.id, initial)) {
      await route.fallback();

      return;
    }

    intercepted = true;
    await route.fulfill({
      status: 503,
      ...(initial
        ? { json: { ok: false, error: { code: "UNAVAILABLE", message: "本次文档保存未送达。" } } }
        : {}),
    });
    await page.unroute(url, fail);
  }

  await page.route(url, fail);

  return { intercepted: () => intercepted };
}
