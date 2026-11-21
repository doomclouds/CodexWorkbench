import { copyFile, mkdir, readFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
console.log('Built Luming Studio runtime: server.mjs, app.html, resvg.wasm');
