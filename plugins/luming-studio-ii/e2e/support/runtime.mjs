import { spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const loopback = "127.0.0.1";
const initialEntry = fileURLToPath(
  new URL("../../../luming-studio/runtime/server.mjs", import.meta.url),
);
const iiEntry = fileURLToPath(new URL("../../runtime/backend.mjs", import.meta.url));
const iiWeb = fileURLToPath(new URL("../../runtime/web/", import.meta.url));
const directoryPrefix = "luming-studio-e2e-";
const startupMs = 15_000;
const proxyBindAttempts = 12;
const proxyPortStart = 20_000;
const proxyPortEnd = 40_000;
const retryableBindErrors = new Set(["EADDRINUSE", "EACCES"]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const emptyBodyStatuses = new Set([204, 205, 304]);
const legacyPlaceholder = "isolated-e2e-owner";
const legacyTools =
  /^\/api\/tools\/artifact_(?:list|manage|read|apply|feedback|share|export|activity)$/u;
const legacyBoardId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const studioRpc =
  /^\/luming\.studio\.v1\.(?:Whiteboard|BoardCatalog|BoardRoom|BoardEdit|BoardHistory|BoardSharing|BoardSuggestion|BoardArchive|Feedback)Service\/[A-Za-z][A-Za-z0-9]*$/u;
const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const assetTypes = new Map([
  [".css", "text/css"],
  [".js", "text/javascript"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".woff2", "font/woff2"],
]);

function localOrigin(value) {
  const url = new URL(value);
  const isLoopbackHttp = url.protocol === "http:" && url.hostname === loopback;
  if (!isLoopbackHttp || !url.port || url.href !== url.origin + "/") {
    throw new Error("Studio did not return a private loopback address.");
  }

  return url;
}

function relativeUrl(path, origin) {
  const hasLocalPrefix = typeof path === "string" && path.startsWith("/");
  if (!hasLocalPrefix || path.startsWith("//") || path.includes("\\")) {
    throw new TypeError("Studio request must use a relative path.");
  }

  const target = new URL(path, origin);
  if (target.origin !== origin.origin) {
    throw new TypeError("Studio request must use the current origin.");
  }

  return target;
}

async function legacyRecord(path, pid) {
  try {
    const record = JSON.parse(await readFile(path, "utf8"));
    const validToken = typeof record?.token === "string" && record.token.length >= 24;
    if (record?.pid !== pid || !validToken) {
      throw new Error("Studio returned an invalid isolated service record.");
    }

    return { origin: localOrigin(record.origin), token: record.token };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function iiRecord(output, token) {
  if (output.includes("\n")) {
    return { origin: localOrigin(output.split("\n", 1)[0].trim()), token };
  }
}

async function stopChild(service) {
  if (!service?.child.pid) {
    return;
  }

  service.child.kill();
  if (await Promise.race([service.closed.then(() => true), delay(5000, false, { ref: false })])) {
    return;
  }

  service.child.kill("SIGKILL");
  if (
    !(await Promise.race([service.closed.then(() => true), delay(3000, false, { ref: false })]))
  ) {
    throw new Error("The isolated Studio process did not stop.");
  }
}

async function startChild(edition, directory) {
  const legacy = edition === "initial";
  const entry = legacy ? initialEntry : iiEntry;
  await access(entry);
  const recordPath = join(directory, "service.json");
  const token = randomBytes(32).toString("base64url");
  if (legacy) {
    await rm(recordPath, { force: true });
  }
  const args = legacy ? ["--serve", "--data-root", directory, "--port", "0"] : [];
  const env = legacy
    ? process.env
    : {
        ...process.env,
        LUMING_STUDIO_II_DB: join(directory, "studio.sqlite"),
        LUMING_STUDIO_II_ACTOR: "e2e-owner",
        LUMING_STUDIO_II_TOKEN: token,
        LUMING_STUDIO_II_AGENT_TOKEN: "",
        LUMING_STUDIO_II_PORT: "0",
        LUMING_STUDIO_II_LAN_HOST: loopback,
        LUMING_STUDIO_II_LAN_PORT: "0",
        LUMING_STUDIO_II_WEB_ROOT: iiWeb,
      };
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: directory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const closed = new Promise((resolve) => {
    child.once("close", resolve);
  });
  let launchError;
  child.on("error", (error) => {
    launchError = error;
  });
  let output = "";
  let diagnostics = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output = (output + chunk).slice(0, 1024);
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-8192);
  });

  try {
    const deadline = Date.now() + startupMs;
    while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
      if (launchError) {
        throw launchError;
      }

      const record = legacy ? await legacyRecord(recordPath, child.pid) : iiRecord(output, token);
      if (record) {
        return { child, closed, ...record };
      }

      await delay(50);
    }

    throw new Error(`Studio ${edition} failed to start. ${diagnostics.trim()}`);
  } catch (error) {
    await stopChild({ child, closed });
    throw error;
  }
}

function removeHopHeaders(headers) {
  for (const name of String(headers.connection ?? "").split(",")) {
    delete headers[name.trim().toLowerCase()];
  }
  for (const name of hopHeaders) {
    delete headers[name];
  }
}

function respond(response, status) {
  if (response.destroyed) {
    return;
  }

  response.writeHead(status, { "cache-control": "no-store" }).end();
}

function rewriteLegacyApp(reply, response, headers, token) {
  const chunks = [];
  reply.on("data", (chunk) => {
    chunks.push(chunk);
  });
  reply.on("end", () => {
    if (response.destroyed) {
      return;
    }

    const source = Buffer.concat(chunks).toString("utf8");
    const body = Buffer.from(source.replaceAll(token, legacyPlaceholder));
    headers["content-length"] = body.byteLength;
    response.writeHead(reply.statusCode ?? 502, headers).end(body);
  });
}

function relay(incoming, response, path, service, front, legacy) {
  const headers = { ...incoming.headers };
  removeHopHeaders(headers);
  for (const name of Object.keys(headers)) {
    if (
      name === "forwarded" ||
      name.startsWith("x-forwarded-") ||
      name.startsWith("x-studio-agent-")
    ) {
      delete headers[name];
    }
  }
  delete headers.cookie;
  delete headers["x-studio-actor"];
  headers.host = legacy ? front.host : service.origin.host;
  headers.authorization = "Bearer " + service.token;
  headers["accept-encoding"] = "identity";
  if (headers.origin) {
    headers.origin = service.origin.origin;
  }

  const upstream = httpRequest(
    relativeUrl(path.pathname + path.search, service.origin),
    {
      method: incoming.method,
      headers,
    },
    (reply) => {
      const outgoing = { ...reply.headers, "cache-control": "no-store" };
      removeHopHeaders(outgoing);
      for (const name of Object.keys(outgoing)) {
        if (name.startsWith("access-control-")) {
          delete outgoing[name];
        }
      }
      delete outgoing["set-cookie"];
      if (outgoing.location) {
        const location = new URL(outgoing.location, service.origin);
        if (location.origin !== service.origin.origin && location.origin !== front.origin) {
          reply.resume();
          respond(response, 502);
          return;
        }
        outgoing.location =
          location.pathname +
          location.search.replaceAll(service.token, legacyPlaceholder) +
          location.hash;
      }
      reply.on("error", () => response.destroy());
      const legacyApp = legacy && ["/", "/index.html"].includes(path.pathname);
      if (legacyApp && String(outgoing["content-type"]).startsWith("text/html")) {
        rewriteLegacyApp(reply, response, outgoing, service.token);
        return;
      }

      response.writeHead(reply.statusCode ?? 502, outgoing);
      response.flushHeaders();
      reply.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (response.headersSent) {
      response.destroy();
    } else {
      respond(response, 502);
    }
  });
  response.once("close", () => upstream.destroy());
  incoming.once("error", () => upstream.destroy());
  incoming.pipe(upstream);
}

async function serveAsset(request, response, path) {
  const name = /^\/assets\/([A-Za-z0-9_.-]+)$/u.exec(path.pathname)?.[1];
  const entry = path.pathname === "/" || path.pathname === "/index.html";
  const type = entry ? "text/html" : assetTypes.get(extname(name ?? ""));
  if ((!entry && !name) || !type) {
    return respond(response, 404);
  }

  try {
    const file = entry ? join(iiWeb, "index.html") : join(iiWeb, "assets", name);
    const bytes = await readFile(file);
    if (response.destroyed) {
      return;
    }

    response
      .writeHead(200, {
        "content-type": type,
        "content-length": bytes.byteLength,
        "cache-control": "no-store",
      })
      .end(request.method === "HEAD" ? undefined : bytes);
  } catch (error) {
    respond(response, error.code === "ENOENT" ? 404 : 500);
  }
}

function allowedRoute({ pathname, searchParams }, method, legacy) {
  if (legacy) {
    if (method === "GET") {
      return (
        ["/", "/index.html", "/api/session", "/api/sync", "/api/events", "/api/presence"].includes(
          pathname,
        ) ||
        pathname.startsWith("/api/thumbnails/") ||
        pathname.startsWith("/assets/")
      );
    }

    const mediaUpload =
      pathname === "/api/assets" &&
      searchParams.size === 1 &&
      legacyBoardId.test(searchParams.get("artifactId") ?? "");

    return (
      method === "POST" &&
      (mediaUpload ||
        legacyTools.test(pathname) ||
        ["/api/presence", "/api/room", "/api/import"].includes(pathname))
    );
  }
  if (method === "GET" || method === "HEAD") {
    return pathname === "/studio-room-events" || pathname.startsWith("/studio-archive-assets/");
  }

  return method === "POST" && studioRpc.test(pathname);
}

function listenProxy(server, port) {
  return new Promise((resolve, reject) => {
    function fail(error) {
      server.off("listening", ready);
      reject(error);
    }

    function ready() {
      server.off("error", fail);
      resolve();
    }

    server.once("error", fail);
    server.once("listening", ready);
    server.listen(port, loopback);
  });
}

async function bindProxy(server) {
  let bindError;
  for (let attempt = 0; attempt < proxyBindAttempts; attempt++) {
    try {
      await listenProxy(server, randomInt(proxyPortStart, proxyPortEnd + 1));
      return server;
    } catch (error) {
      if (!retryableBindErrors.has(error.code)) {
        throw error;
      }

      bindError = error;
    }
  }

  throw new Error("Could not bind the isolated Studio browser proxy.", { cause: bindError });
}

function openProxy(edition, readService) {
  const legacy = edition === "initial";
  const server = createServer((incoming, response) => {
    const front = new URL(`http://${loopback}:${server.address().port}/`);
    const { host, origin, "sec-fetch-site": site } = incoming.headers;
    const direct = incoming.socket.remoteAddress === loopback && host === front.host;
    const allowedOrigin = !origin || origin === front.origin;
    const allowedSite = !site || ["none", "same-origin"].includes(site);
    if (!direct || !allowedOrigin || !allowedSite) {
      respond(response, 403);
      return;
    }
    let path;
    try {
      path = relativeUrl(incoming.url, front);
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }

      respond(response, 400);
      return;
    }
    if (
      incoming.headers["x-luming-guest"] ||
      path.searchParams.get("guest") === "1" ||
      path.searchParams.has("share")
    ) {
      respond(response, 403);
      return;
    }
    const read = ["GET", "HEAD"].includes(incoming.method);
    const staticAsset =
      ["/", "/index.html"].includes(path.pathname) || path.pathname.startsWith("/assets/");

    if (!legacy && read && staticAsset) {
      void serveAsset(incoming, response, path);
      return;
    }
    if (!allowedRoute(path, incoming.method, legacy)) {
      respond(response, 404);
      return;
    }
    const service = readService();
    if (!service) {
      respond(response, 503);
      return;
    }
    path.searchParams.delete("token");
    relay(incoming, response, path, service, front, legacy);
  });

  return bindProxy(server);
}

function closeProxy(server) {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    server.closeAllConnections();
  });
}

async function removeDirectory(directory, parent) {
  const target = await realpath(directory);
  if (
    target !== directory ||
    dirname(target) !== parent ||
    !basename(target).startsWith(directoryPrefix)
  ) {
    throw new Error("Refusing to remove a directory outside the isolated Studio fixture.");
  }

  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function seedResponse(reply, method) {
  const status = reply.statusCode ?? 502;
  if (redirectStatuses.has(status) && reply.headers.location) {
    reply.resume();
    throw new Error("The isolated Studio seed request redirected.");
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(reply.headers)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) {
        headers.append(name, entry);
      }
    }
  }

  const empty = method === "HEAD" || emptyBodyStatuses.has(status);
  if (empty) {
    reply.resume();
  }

  return new Response(empty ? null : Readable.toWeb(reply), { headers, status });
}

function privateRequest(service, path, init) {
  const headers = new Headers(init.headers);
  headers.set("authorization", "Bearer " + service.token);
  const timeout = AbortSignal.timeout(startupMs);
  const input = new Request(relativeUrl(path, service.origin), {
    ...init,
    headers,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });

  return new Promise((resolve, reject) => {
    const upstream = httpRequest(
      input.url,
      {
        method: input.method,
        headers: Object.fromEntries(input.headers),
        signal: input.signal,
      },
      (reply) => {
        try {
          resolve(seedResponse(reply, input.method));
        } catch (error) {
          reply.destroy();
          reject(error);
        }
      },
    );
    upstream.once("error", reject);
    if (input.body) {
      Readable.fromWeb(input.body)
        .once("error", (error) => upstream.destroy(error))
        .pipe(upstream);
    } else {
      upstream.end();
    }
  });
}

export async function launchStudio(edition) {
  if (edition !== "initial" && edition !== "ii") {
    throw new Error("Unknown Studio test edition: " + edition);
  }

  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, directoryPrefix));
  let service;
  let proxy;
  let restarting;
  let closing;
  try {
    service = await startChild(edition, directory);
    proxy = await openProxy(edition, () => service);
  } catch (error) {
    await stopChild(service);
    await removeDirectory(directory, parent);
    throw error;
  }

  async function replaceChild() {
    await stopChild(service);
    service = undefined;
    service = await startChild(edition, directory);
  }

  async function shutdown() {
    if (restarting) {
      await Promise.allSettled([restarting]);
    }
    try {
      await closeProxy(proxy);
    } finally {
      await stopChild(service);
      await removeDirectory(directory, parent);
    }
  }

  return {
    url: `http://${loopback}:${proxy.address().port}/`,
    async request(path, init = {}) {
      if (!service || closing || restarting) {
        throw new Error("The isolated Studio service is unavailable.");
      }

      return privateRequest(service, path, init);
    },
    restart() {
      if (closing) {
        return Promise.reject(new Error("The isolated Studio service has closed."));
      }

      restarting ??= replaceChild().finally(() => {
        restarting = undefined;
      });

      return restarting;
    },
    close() {
      closing ??= shutdown();

      return closing;
    },
  };
}
