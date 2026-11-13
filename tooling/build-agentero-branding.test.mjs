import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { inlineLibraryFaviconPlugin } from './build-agentero-branding.mjs';

const require = createRequire(new URL('../plugins/agentero-library/package.json', import.meta.url));
const { build } = await import(pathToFileURL(require.resolve('vite')));
const iconPath = new URL('../plugins/agentero-library/assets/icon64.png', import.meta.url);
const sourceHtml = await readFile(new URL('../plugins/agentero-library/src/app/index.html', import.meta.url), 'utf8');

test('Vite preserves the approved brand favicon inline without emitting an external image', async t => {
  const root = await mkdtemp(join(tmpdir(), 'codex-workbench-favicon-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Exercise the actual entry head while avoiding a full application build.
  await writeFile(join(root, 'index.html'), sourceHtml.replace(/<script\b[^>]*src="\.\/main\.tsx"[^>]*><\/script>/, ''));
  const result = await build({
    configFile: false, root, logLevel: 'silent',
    plugins: [inlineLibraryFaviconPlugin(iconPath)],
    build: { write: false, minify: false, assetsInlineLimit: 0, reportCompressedSize: false },
  });
  const { output } = Array.isArray(result) ? result[0] : result;
  const html = output.find(file => file.fileName === 'index.html').source;
  const expectedUri = `data:image/png;base64,${(await readFile(iconPath)).toString('base64')}`;
  assert.match(html, /<link rel="icon" type="image\/png" sizes="64x64"/);
  assert.ok(html.includes(`href="${expectedUri}"`));
  assert.ok(!html.includes('../../assets/icon64.png'));
  assert.ok(!/href="(?:\/|\.\/)?(?:assets\/)?icon64-/.test(html));
  assert.deepEqual(output.map(file => file.fileName), ['index.html']);
});

test('favicon source changes fail explicitly instead of leaving a broken relative reference', async () => {
  const plugin = inlineLibraryFaviconPlugin(iconPath);
  await assert.rejects(() => plugin.transformIndexHtml.handler('<html><head></head></html>'), /exactly one library favicon/);
  await assert.rejects(() => plugin.transformIndexHtml.handler(`${sourceHtml}${sourceHtml}`), /exactly one library favicon/);
});
