import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  fingerprintRuntime,
  runTemporaryServer,
} from '../plugins/luming-studio/benchmarks/runtime-fingerprint.mjs';
import { sdkProtocolDebugPlugin } from './app-sdk-debug.mjs';
import { lintStudio, lintTooling, typecheckStudio } from './lint-luming-studio.mjs';

await lintTooling();
await lintStudio();
typecheckStudio();

const root = fileURLToPath(new URL('../plugins/luming-studio/', import.meta.url));
const requirePlugin = createRequire(`${root}package.json`);
const { build, transform } = await import(pathToFileURL(requirePlugin.resolve('esbuild')).href);
const { build: viteBuild } = await import(pathToFileURL(requirePlugin.resolve('vite')).href);
const { viteSingleFile } = await import(
  pathToFileURL(requirePlugin.resolve('vite-plugin-singlefile')).href
);
const serverBanner =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';
const runtime = `${root}runtime`;

async function verifyPackagedStudio() {
  const tempRoot = await realpath(tmpdir());
  const scratch = await mkdtemp(join(tempRoot, 'luming-packaged-check-'));
  const { Client } = requirePlugin('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = requirePlugin('@modelcontextprotocol/sdk/client/stdio.js');
  try {
    await runTemporaryServer(await fingerprintRuntime(runtime), scratch, async ({ tool }) => {
      const list = await tool('artifact_list', {});
      assert.deepEqual(list.artifacts, []);

      const client = new Client({ name: 'luming-packaged-check', version: '1.0.0' });
      try {
        await client.connect(
          new StdioClientTransport({
            command: process.execPath,
            args: [join(runtime, 'server.mjs'), '--data-root', scratch],
            cwd: runtime,
            stderr: 'pipe',
          }),
        );
        assert.equal(client.getServerVersion()?.name, 'luming-studio');
        assert.notEqual(
          (await client.callTool({ name: 'artifact_list', arguments: {} })).isError,
          true,
        );
      } finally {
        await client.close();
      }
    });
  } finally {
    const owned = await realpath(scratch);
    assert.equal(dirname(owned), tempRoot);
    assert(basename(owned).startsWith('luming-packaged-check-'));
    await rm(owned, { recursive: true, force: true });
  }
}

await mkdir(runtime, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/server/index.ts'],
  outfile: `${runtime}/server.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: serverBanner },
});
await copyFile(requirePlugin.resolve('@resvg/resvg-wasm/index_bg.wasm'), `${runtime}/resvg.wasm`);
await viteBuild({
  configFile: false,
  root: `${root}src/app`,
  plugins: [sdkProtocolDebugPlugin(transform), viteSingleFile()],
  build: {
    outDir: runtime,
    emptyOutDir: false,
    target: 'es2023',
    sourcemap: false,
    reportCompressedSize: false,
  },
});
const html = await readFile(`${runtime}/index.html`, 'utf8');
const closingBody = /<\/body>(?=\s*<\/html>\s*$)/u;
if (!closingBody.test(html)) {
  throw new Error('The built Studio page is missing its closing body tag.');
}

await rename(`${runtime}/index.html`, `${runtime}/app.html`);
await verifyPackagedStudio();
console.log('Built Luming Studio runtime: server.mjs, app.html, resvg.wasm');
