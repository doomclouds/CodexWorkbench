import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function fingerprintRuntime(runtimeDirectory) {
  if (typeof runtimeDirectory !== 'string' || !isAbsolute(runtimeDirectory)) {
    throw new Error('An absolute frozen runtime directory is required');
  }

  const directory = await realpath(runtimeDirectory);
  const files = [];
  for (const file of ['server.mjs', 'app.html', 'resvg.wasm']) {
    const bytes = await readFile(join(directory, file));
    files.push({ file, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return { directory, files };
}

export async function verifyRuntime(runtimeDirectory, witnessPath) {
  if (!witnessPath || !isAbsolute(witnessPath)) {
    throw new Error('An absolute frozen runtime fingerprint JSON is required');
  }

  const expected = JSON.parse((await readFile(witnessPath, 'utf8')).trim());
  const actual = await fingerprintRuntime(runtimeDirectory);
  assert.deepEqual(actual.files, expected.files, 'Frozen runtime bytes changed');
  return actual;
}

async function waitForRecord(child, directory) {
  for (let attempt = 0; attempt < 140; attempt++) {
    if (child.exitCode !== null) {
      throw new Error('Temporary packaged server exited before readiness');
    }

    try {
      const candidate = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'));
      if (candidate.pid === child.pid) {
        return candidate;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    await delay(50);
  }

  throw new Error('The runtime did not publish a service record owned by the temporary process');
}

export async function runTemporaryServer(runtime, dataRoot, execute) {
  const parent = await realpath(tmpdir());
  const directory = await realpath(dataRoot);
  const connectionPath = relative(parent, directory);
  assert(connectionPath && connectionPath !== '..' && !connectionPath.startsWith('..' + sep));
  assert(!isAbsolute(connectionPath));
  const child = spawn(
    process.execPath,
    [join(runtime.directory, 'server.mjs'), '--serve', '--data-root', directory],
    { cwd: runtime.directory, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4096);
  });

  try {
    const record = await waitForRecord(child, directory).catch((error) => {
      if (stderr.trim()) {
        throw new Error(error.message + '\n' + stderr.trim(), { cause: error });
      }

      throw error;
    });
    const origin = new URL(record.origin);
    assert(new Set(['127.0.0.1', 'localhost', '[::1]']).has(origin.hostname));
    async function request(path, options = {}) {
      const { headers, signal = AbortSignal.timeout(60_000), ...rest } = options;
      const response = await fetch(new URL(path, origin), {
        ...rest,
        signal,
        headers: { ...headers, Authorization: 'Bearer ' + record.token },
      });

      if (!response.ok) {
        const message = await response.json();
        const description =
          message.error?.message || 'Temporary service returned HTTP ' + response.status;

        throw Object.assign(new Error(description), {
          code: message.error?.code || 'HTTP_' + response.status,
          status: response.status,
        });
      }
      return response;
    }
    async function tool(name, args) {
      const response = await request('/api/tools/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const message = await response.json();
      if (message.ok !== true) {
        throw Object.assign(new Error(name + ' returned an application error'), {
          code: message.error?.code,
        });
      }

      return message.data;
    }
    const session = await (await request('/api/session')).json();
    assert.equal(session.owner, true);
    return await execute({
      request,
      tool,
      session,
      browser: { origin: origin.origin, authorization: 'Bearer ' + record.token },
    });
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
    }
    await exited;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const runtime = await fingerprintRuntime(process.argv[2]);
  console.log(JSON.stringify(runtime, null, 2));
}
