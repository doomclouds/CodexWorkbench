import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import lockfile from 'proper-lockfile';

interface RuntimeOptions {
  readonly runtimeDirectory: string;
  readonly dataRoot: string;
  readonly actorId: string;
}

interface LocalService {
  readonly origin: string;
  readonly token: string;
  readonly agentToken: string;
  readonly pid: number;
  readonly actorId: string;
  readonly version: string;
}

interface RuntimeRequest {
  readonly route: string;
  readonly method: 'GET' | 'POST';
  readonly mediaType?: string;
  readonly commandId?: string;
  readonly body?: Uint8Array | Blob;
}

const readyTimeoutMillis = 15_000;
const requestTimeoutMillis = 90_000;
const privateToken = /^[A-Za-z0-9_-]{43}$/u;
const loopbackOrigin = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u;
const healthRoute = '/luming.studio.v1.WhiteboardService/GetBoardScene';
const suggestionAgentRoute = '/luming.studio.v1.BoardSuggestionService/SubmitBoardSuggestion';
const choiceAgentRoute = '/luming.studio.v1.BoardSuggestionService/ChooseAgentBoardSuggestion';
const activityAgentRoute = '/luming.studio.v1.BoardRoomService/ChangeAgentActivity';
const createBoardRoute = '/luming.studio.v1.BoardCatalogService/CreateBoard';
const writeAgentRoute = '/luming.studio.v1.BoardAgentWriteService/ApplyAgentBoardEdit';
const receiptAgentRoute = '/luming.studio.v1.BoardAgentWriteService/GetAgentBoardEditReceipt';
const agentFeedbackRoutes = new Set(
  ['ListThreads', 'GetThread', 'ApplyFeedback', 'GetFeedbackReceipt'].map(
    (method) => '/luming.studio.v1.FeedbackService/' + method,
  ),
);

function systemCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateOrigin(value: unknown): string {
  if (typeof value !== 'string' || !loopbackOrigin.test(value)) {
    throw new Error('Studio must listen on a private loopback port.');
  }

  const parsed = new URL(value);
  if (parsed.origin !== value) {
    throw new Error('Invalid Studio loopback service address.');
  }

  return value;
}

function readVersion(value: unknown): string {
  if (!isRecord(value) || value.name !== 'luming-studio-ii') {
    throw new Error('The Studio runtime plugin manifest is missing or incompatible.');
  }
  if (typeof value.version !== 'string' || !value.version) {
    throw new Error('The Studio plugin manifest has no version.');
  }

  return value.version;
}

async function readService(path: string): Promise<LocalService | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (systemCode(error) === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
  if (!isRecord(value)) {
    throw new Error('Invalid Studio service record.');
  }

  const { token, agentToken, pid, actorId, version } = value;
  const validProcess = typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0;
  const validIdentity = typeof actorId === 'string' && typeof version === 'string';
  if (!validProcess || !validIdentity || typeof token !== 'string') {
    throw new Error('Invalid Studio service record.');
  }
  if (!privateToken.test(token) || typeof agentToken !== 'string') {
    throw new Error('Invalid Studio service credential.');
  }
  if (!privateToken.test(agentToken) || agentToken === token) {
    throw new Error('Invalid Studio service credential.');
  }

  return { origin: validateOrigin(value.origin), token, agentToken, pid, actorId, version };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    if (systemCode(error) === 'ESRCH') {
      return false;
    }
    if (systemCode(error) === 'EPERM') {
      return true;
    }

    throw error;
  }
}

async function probe(service: LocalService) {
  const response = await fetch(new URL(healthRoute, service.origin), {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + service.token,
      'content-type': 'application/protobuf',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  await response.body?.cancel();
  if (response.status !== 400) {
    throw new Error('The existing Studio service did not confirm its loopback connection.');
  }
}

async function releaseFile(path: string) {
  try {
    await unlink(path);
  } catch (error) {
    if (systemCode(error) !== 'ENOENT') {
      throw error;
    }
  }
}

async function writeService(path: string, record: LocalService) {
  const temp = path + '.' + randomUUID();
  try {
    await writeFile(temp, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await releaseFile(temp);
  }
}

function waitForOrigin(child: ChildProcess): Promise<string> {
  const output = child.stdout;
  if (!output) {
    throw new Error('Studio background service has no readiness channel.');
  }

  const reader = createInterface({ input: output });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Studio background service did not become ready.'));
    }, readyTimeoutMillis);

    function finish() {
      clearTimeout(timer);
      child.off('error', handleError);
      child.off('exit', handleExit);
      reader.off('line', handleLine);
      reader.close();
    }

    function handleError(error: Error) {
      finish();
      reject(error);
    }

    function handleExit() {
      finish();
      reject(new Error('Studio background service exited before listening.'));
    }

    function handleLine(line: string) {
      finish();
      try {
        resolve(validateOrigin(line));
      } catch (error) {
        reject(error);
      }
    }

    child.once('error', handleError);
    child.once('exit', handleExit);
    reader.once('line', handleLine);
  });
}

async function startBackend(
  options: RuntimeOptions,
  version: string,
  servicePath: string,
  log: number,
) {
  const { dataRoot, runtimeDirectory, actorId } = options;
  const token = randomBytes(32).toString('base64url');
  const agentToken = randomBytes(32).toString('base64url');
  const child = spawn(process.execPath, [join(runtimeDirectory, 'backend.mjs')], {
    cwd: runtimeDirectory,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', log],
    env: {
      ...process.env,
      LUMING_STUDIO_II_DB: join(dataRoot, 'studio.sqlite'),
      LUMING_STUDIO_II_ACTOR: actorId,
      LUMING_STUDIO_II_TOKEN: token,
      LUMING_STUDIO_II_AGENT_TOKEN: agentToken,
      LUMING_STUDIO_II_PORT: '0',
      LUMING_STUDIO_II_WEB_ROOT: join(runtimeDirectory, 'web'),
    },
  });

  try {
    const origin = await waitForOrigin(child);
    if (child.pid === undefined) {
      throw new Error('Studio background service has no process identity.');
    }

    const record = { origin, token, agentToken, pid: child.pid, actorId, version };
    await probe(record);
    await writeService(servicePath, record);

    return record;
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    child.stdout?.destroy();
    child.unref();
  }
}

async function launch(options: RuntimeOptions, version: string, servicePath: string) {
  const log = await open(join(options.dataRoot, 'backend.log'), 'a', 0o600);
  try {
    return await startBackend(options, version, servicePath, log.fd);
  } finally {
    await log.close();
  }
}

async function acquireService(options: RuntimeOptions, version: string): Promise<LocalService> {
  const { dataRoot, actorId } = options;
  const state = join(dataRoot, 'service.json');
  const unlock = await lockfile.lock(dataRoot, {
    realpath: false,
    lockfilePath: join(dataRoot, 'service-start.lock'),
    retries: { retries: 110, factor: 1, minTimeout: 150, maxTimeout: 150 },
  });

  try {
    const existing = await readService(state);
    if (existing && isAlive(existing.pid)) {
      if (existing.actorId !== actorId || existing.version !== version) {
        throw new Error('The selected data root already serves another Studio version or owner.');
      }

      await probe(existing);

      return existing;
    }

    return await launch(options, version, state);
  } finally {
    await unlock();
  }
}

export async function loadMcpRuntime(input: RuntimeOptions) {
  await mkdir(input.dataRoot, { recursive: true, mode: 0o700 });
  const options = { ...input, dataRoot: await realpath(input.dataRoot) };
  const [html, manifest] = await Promise.all([
    readFile(join(options.runtimeDirectory, 'app.html'), 'utf8'),
    readFile(join(options.runtimeDirectory, '..', 'plugin.json'), 'utf8'),
  ]);
  const pluginVersion = readVersion(JSON.parse(manifest) as unknown);
  let pending: Promise<LocalService> | undefined;

  async function forward(
    request: RuntimeRequest,
    signal: AbortSignal,
    role: 'owner' | 'agent',
    author?: { readonly purpose: 'feedback' | 'boardCreation'; readonly id: string },
  ) {
    signal.throwIfAborted();
    try {
      const service = await (pending ??= acquireService(options, pluginVersion));
      signal.throwIfAborted();
      const endpoint = new URL(request.route, service.origin);
      if (endpoint.origin !== service.origin) {
        throw new Error('Invalid Studio loopback operation.');
      }

      const credential = role === 'agent' ? service.agentToken : service.token;
      const headers = new Headers({ authorization: 'Bearer ' + credential });
      if (request.mediaType) {
        headers.set('content-type', request.mediaType);
      }
      if (request.commandId) {
        headers.set('x-studio-command-id', request.commandId);
      }
      if (author) {
        const header =
          author.purpose === 'feedback'
            ? 'x-studio-feedback-agent-id'
            : 'x-studio-agent-creator-id';
        headers.set(header, author.id);
      }

      const response = await fetch(endpoint, {
        method: request.method,
        headers,
        body: request.body instanceof Uint8Array ? new Uint8Array(request.body) : request.body,
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMillis)]),
      });

      if (response.status === 401) {
        pending = undefined;
      }

      return response;
    } catch (error) {
      if (!signal.aborted || error !== signal.reason) {
        pending = undefined;
      }
      throw error;
    }
  }

  function forwardAgent(route: string, body: Uint8Array, signal: AbortSignal) {
    return forward(
      { route, method: 'POST', mediaType: 'application/protobuf', body },
      signal,
      'agent',
    );
  }

  return {
    html,
    pluginVersion,
    dispatch: (request: RuntimeRequest, signal: AbortSignal) => forward(request, signal, 'owner'),
    dispatchAgentSuggestion: (body: Uint8Array, signal: AbortSignal) =>
      forwardAgent(suggestionAgentRoute, body, signal),
    dispatchAgentChoice: (body: Uint8Array, signal: AbortSignal) =>
      forwardAgent(choiceAgentRoute, body, signal),
    dispatchAgentActivity: (body: Uint8Array, signal: AbortSignal) =>
      forwardAgent(activityAgentRoute, body, signal),
    dispatchAgentWrite: (body: Uint8Array, signal: AbortSignal) =>
      forwardAgent(writeAgentRoute, body, signal),
    dispatchAgentReceipt: (body: Uint8Array, signal: AbortSignal) =>
      forwardAgent(receiptAgentRoute, body, signal),
    dispatchAgentCreateBoard: (agentId: string, request: RuntimeRequest, signal: AbortSignal) => {
      if (request.method !== 'POST' || request.route !== createBoardRoute) {
        throw new Error('Invalid Studio Agent board creation operation.');
      }

      return forward(request, signal, 'agent', { purpose: 'boardCreation', id: agentId });
    },
    dispatchAgentFeedback: (agentId: string, request: RuntimeRequest, signal: AbortSignal) => {
      if (request.method !== 'POST' || !agentFeedbackRoutes.has(request.route)) {
        throw new Error('Invalid Studio Agent feedback operation.');
      }

      return forward(request, signal, 'agent', { purpose: 'feedback', id: agentId });
    },
  };
}
