import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectLicenses } from './collect-agentero-licenses.mjs';
import { sdkProtocolDebugPlugin } from './app-sdk-debug.mjs';
import { inlineLibraryFaviconPlugin } from './build-agentero-branding.mjs';

const root = fileURLToPath(new URL('../plugins/agentero-library/', import.meta.url));
const packageInfo = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
const manifest = JSON.parse(await readFile(`${root}plugin.json`, 'utf8'));
if (packageInfo.version !== manifest.version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageInfo.version)) {
  throw new Error('Plugin manifests must agree on a valid version.');
}
const pluginRequire = createRequire(`${root}package.json`);
const { build: bundle, transform: transformScript } = await import(pathToFileURL(pluginRequire.resolve('esbuild')).href);
const { build: viteBuild } = await import(pathToFileURL(pluginRequire.resolve('vite')).href);
const { viteSingleFile } = await import(pathToFileURL(pluginRequire.resolve('vite-plugin-singlefile')).href);
const runtime = `${root}runtime`;
await mkdir(runtime, { recursive: true });
const serverResult = await bundle({
  absWorkingDir: root,
  entryPoints: ['src/server/index.ts'],
  outfile: `${runtime}/server.mjs`,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  sourcemap: false,
  metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
let appInputs = [];
await viteBuild({
  configFile: false,
  root: `${root}src/app`,
  plugins: [inlineLibraryFaviconPlugin(`${root}assets/icon64.png`), sdkProtocolDebugPlugin(transformScript), viteSingleFile(), { name: 'record-runtime-inputs', generateBundle() { appInputs = [...this.getModuleIds()]; } }],
  build: { outDir: runtime, emptyOutDir: false, target: 'es2023', minify: true, sourcemap: false, reportCompressedSize: false },
});
const html = await readFile(`${runtime}/index.html`, 'utf8');
await writeFile(`${runtime}/app.html`, html.endsWith('\n') ? html : `${html}\n`);
await unlink(`${runtime}/index.html`);
const validation = fileURLToPath(new URL(`../artifacts/agentero-library/v${packageInfo.version}/validation/`, import.meta.url));
await mkdir(validation, { recursive: true });
await writeFile(`${validation}bundle-inputs.json`, `${JSON.stringify({ server: serverResult.metafile, appInputs }, null, 2)}\n`);
await collectLicenses({ version: packageInfo.version });
console.log('Built marketplace runtime: server.mjs and app.html (no ZIP).');
