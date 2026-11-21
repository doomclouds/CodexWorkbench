import { lstat, realpath } from 'node:fs/promises';
import { StudioError } from '../../shared/studio-error.js';

export const samePath = (left: string, right: string) =>
  process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
export const resourceScope = () =>
  new StudioError(
    'RESOURCE_SCOPE',
    '资源路径必须位于当前作品的真实目录中，不能通过符号链接访问其他位置。',
  );

export async function regularFile(path: string) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile() || !samePath(await realpath(path), path)) {
    throw resourceScope();
  }

  return info;
}
