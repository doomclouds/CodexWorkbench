import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { openMcpFileFixture } from '../support/mcp-file-fixture.js';

const bytes = new Uint8Array([12, 34, 56, 78]);

test('reads named regular files and writes a unique export beneath the configured data root', async () => {
  const { root, access, close } = await openMcpFileFixture();
  try {
    const input = join(root, '媒体.zip');
    const signal = new AbortController().signal;
    await writeFile(input, bytes);
    expect(new Uint8Array(await access.readArchiveFile(input, signal))).toEqual(bytes);
    expect(new Uint8Array(await access.readAssetFile(input, signal))).toEqual(bytes);
    const first = await access.writeExportFile('白板.svg', bytes, signal);
    const second = await access.writeExportFile('白板.svg', bytes, signal);
    expect(first).not.toBe(second);
    expect(dirname(dirname(first))).toBe(join(root, 'exports'));
    expect(new Uint8Array(await readFile(first))).toEqual(bytes);
  } finally {
    await close();
  }
});

test('rejects relative or redirected sources, directories, and oversized reads', async () => {
  const { root, access, close } = await openMcpFileFixture();
  try {
    const contents = join(root, 'media');
    const alias = join(root, 'alias');
    const signal = new AbortController().signal;
    await mkdir(contents);
    await writeFile(join(contents, 'file.zip'), new Uint8Array(33));
    await symlink(contents, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(access.readAssetFile('relative.png', signal)).rejects.toThrow(/绝对路径/u);
    await expect(access.readAssetFile(contents, signal)).rejects.toThrow(/常规文件/u);
    await expect(access.readAssetFile(join(alias, 'file.zip'), signal)).rejects.toThrow(
      /符号链接/u,
    );
    await expect(access.readArchiveFile(join(contents, 'file.zip'), signal)).rejects.toThrow(
      /大小/u,
    );

    if (process.platform !== 'win32') {
      await expect(access.readAssetFile('/dev/null', signal)).rejects.toThrow(/常规文件/u);
    }
  } finally {
    await close();
  }
});

test('keeps export names portable and rejects a redirected exports directory', async () => {
  const { root, access, close } = await openMcpFileFixture();
  try {
    const signal = new AbortController().signal;
    for (const name of [
      '../outside.svg',
      'C:\\outside.svg',
      'board.svg:stream',
      'NUL.png',
      'board.svg.',
    ]) {
      await expect(access.writeExportFile(name, bytes, signal)).rejects.toThrow(/名称/u);
    }
    const sibling = join(root, 'other-directory');
    await mkdir(sibling);
    await symlink(
      sibling,
      join(root, 'exports'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(access.writeExportFile('board.svg', bytes, signal)).rejects.toThrow(/导出目录/u);
  } finally {
    await close();
  }
});
