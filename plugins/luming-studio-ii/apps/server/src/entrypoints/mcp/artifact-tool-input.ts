import { z } from 'zod';
import { invalidArgument } from './errors.js';

export const artifactIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}]+$/u);

export const artifactVersion = z.union([
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/u),
]);

const maximumUint64 = 18_446_744_073_709_551_615n;

export function modelVersion(value: z.infer<typeof artifactVersion> | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const version = BigInt(value);
  if (version > maximumUint64) {
    throw invalidArgument('版本超出服务支持的整数范围。');
  }

  return version;
}

function sharedIdentifier(current: string | undefined, legacy: string | undefined) {
  if (current && legacy && current !== legacy) {
    throw invalidArgument('新旧字段不能指定两个不同的 ID。');
  }

  return current ?? legacy;
}

export function modelBoardId(value: { readonly boardId?: string; readonly artifactId?: string }) {
  const boardId = sharedIdentifier(value.boardId, value.artifactId);
  if (!boardId) {
    throw invalidArgument('请指定白板 artifactId。');
  }

  return boardId;
}

export function modelCommandId(value: {
  readonly commandId?: string;
  readonly operationId?: string;
}) {
  const commandId = sharedIdentifier(value.commandId, value.operationId);
  if (!commandId) {
    throw invalidArgument('请提供稳定的 operationId，重试时使用同一 ID。');
  }

  return commandId;
}
