import assert from "node:assert/strict";
import { createRequire } from "node:module";

const runtimes = new WeakMap();
const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const clipboardBinding = "captureStudioWorkbenchLink";

export function registerWorkbenchLinkRuntime(studio, runtime) {
  runtimes.set(studio, runtime);
  return studio;
}

async function readInitialSharing(runtime, boardId) {
  const response = await runtime.request("/api/tools/artifact_share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifactId: boardId, action: "status" }),
  });
  assert.equal(response.status, 200, "Read initial sharing state");
  const result = await response.json();
  assert.equal(result.ok, true, "Initial sharing state is available");
  const { enabled, access, links } = result.data;

  return { enabled, scope: access, viewerUrl: links?.viewer };
}

async function readCurrentSharing(runtime, boardId) {
  const { create, fromBinary, toBinary } = requireServer("@bufbuild/protobuf");
  const { BoardSharingService, SharingRole, SharingScope } = requireServer(
    "@codexworkbench/luming-studio-ii-contracts/sharing/service",
  );
  const method = BoardSharingService.method.getBoardSharing;
  const response = await runtime.request("/" + method.parent.typeName + "/" + method.name, {
    method: "POST",
    headers: { "content-type": "application/protobuf" },
    body: toBinary(method.input, create(method.input, { boardId })),
  });
  assert.equal(response.status, 200, "Read Studio II sharing state");
  const { sharing } = fromBinary(method.output, new Uint8Array(await response.arrayBuffer()));
  assert.ok(sharing, "Studio II sharing state is available");
  const viewer = sharing.links.find(({ role, enabled }) => role === SharingRole.VIEWER && enabled);

  return {
    enabled: sharing.enabled,
    scope: sharing.scope === SharingScope.LOCAL ? "local" : "lan",
    viewerUrl: viewer?.url,
  };
}

function verifiedViewerLink(copied, state, boardId, edition) {
  assert.ok(
    copied && copied === state.viewerUrl,
    "Clipboard must contain this board's viewer link",
  );
  const url = URL.parse(copied);
  const boardKey = edition === "initial" ? "artifactId" : "board";
  const invite =
    edition === "initial"
      ? url?.searchParams.get("share")
      : new URLSearchParams(url?.hash.slice(1)).get("invite");
  const local = url?.protocol === "http:" && url.hostname === "127.0.0.1" && Boolean(url.port);
  const valid = local && !url.username && !url.password && !url.searchParams.has("token");
  assert.ok(
    valid && invite && url.searchParams.get(boardKey) === boardId,
    "Expected an isolated guest invitation",
  );

  return url;
}

export async function workbenchLinkProbe({ page, browser, studio }) {
  const runtime = runtimes.get(studio);
  assert.ok(runtime, "An isolated Studio fixture is required");
  const copies = [];
  const contexts = new Set();
  await page.exposeBinding(clipboardBinding, ({ frame }, value) => {
    if (frame === page.mainFrame() && typeof value === "string" && value.length <= 4096) {
      copies.push(value);
    }
  });
  await page.addInitScript((binding) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (value) => window[binding](value) },
    });
  }, clipboardBinding);

  function readSharing(board) {
    return studio.edition === "initial"
      ? readInitialSharing(runtime, board.id)
      : readCurrentSharing(runtime, board.id);
  }

  return {
    copyCount: () => copies.length,
    async sharingState(board) {
      const { enabled, scope } = await readSharing(board);
      return { enabled, scope };
    },
    async checkpoint(board) {
      const state = await readSharing(board);
      const copied = copies.at(-1);
      verifiedViewerLink(copied, state, board.id, studio.edition);
      return { scope: state.scope, role: "viewer", sameAsFirst: copied === copies[0] };
    },
    async openGuest(board) {
      const state = await readSharing(board);
      const invite = verifiedViewerLink(copies.at(-1), state, board.id, studio.edition);
      const guestContext = await browser.newContext({ locale: "zh-CN" });
      contexts.add(guestContext);
      const guest = await guestContext.newPage();
      await guest
        .evaluate((url) => {
          window.setTimeout(() => window.location.replace(url), 0);
        }, invite.href)
        .catch((error) => {
          const timedOut = error instanceof Error && error.name === "TimeoutError";
          throw new Error(
            timedOut
              ? "The isolated guest invitation did not open in time."
              : "Unable to open the isolated guest invitation.",
          );
        });

      return guest;
    },
    async close() {
      copies.length = 0;
      await Promise.all([...contexts].map((guestContext) => guestContext.close()));
    },
  };
}
