import { Buffer } from 'node:buffer';
import type {
  Geometry,
  ObjectMetadata,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/scene';
import { z } from 'zod';
import { contextRepresentations } from './artifact-context-content.js';
import { BridgeError } from './errors.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const uint64 = /^(?:0|[1-9]\d{0,19})$/u;
const maximumRevision = 18_446_744_073_709_551_615n;
const revision = z
  .string()
  .refine((value) => uint64.test(value) && BigInt(value) <= maximumRevision);
const coordinate = z.number().min(-1_000_000).max(1_000_000);
const dimension = z.number().positive().max(1_000_000);
const region = z
  .object({ x: coordinate, y: coordinate, width: dimension, height: dimension })
  .strict();
const scope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('board') }).strict(),
  z.object({ kind: z.literal('objects'), objectIds: z.array(id).min(1).max(50) }).strict(),
  z.object({ kind: z.literal('section'), sectionId: id }).strict(),
  z.object({ kind: z.literal('region'), bounds: region }).strict(),
]);
const sourceRef = z
  .object({
    kind: z.literal('feedback'),
    boardId: id,
    feedbackThreadId: id,
  })
  .strict();
const cursorSchema = z
  .object({
    key: z.string().max(12_000),
    revision,
    offset: z.number().int().positive().max(100_000),
  })
  .strict();

export const contextSchema = z
  .object({
    boardId: id.optional().describe('白板 ID。使用备注 sourceRef 时可以省略。'),
    scope: scope.optional().describe('范围默认为整板，所选对象只取指定 ID。'),
    sourceRef: sourceRef
      .optional()
      .describe('备注附件提供的来源引用，按备注记录的保存版次和目标读取。'),
    revision: revision.optional().describe('指定已保存版次，使用十进制字符串。'),
    include: z
      .array(z.enum(contextRepresentations))
      .min(1)
      .max(6)
      .optional()
      .describe('首次建议只取 overview，按任务加正文、结构、保存态图、原图或源码。'),
    pageSize: z.number().int().min(1).max(12).optional(),
    cursor: z
      .string()
      .max(16_384)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .optional(),
  })
  .strict();

export type ContextInput = z.infer<typeof contextSchema>;
export type ContextScope = z.infer<typeof scope>;
export type ContextRegion = z.infer<typeof region>;

export function contextCursor(input?: string) {
  if (!input) {
    return;
  }

  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(input, 'base64url').toString('utf8')));
  } catch (error) {
    throw new BridgeError('INVALID_ARGUMENT', '续读游标无效，请从第一页重新读取。', {
      cause: error,
    });
  }
}

export function nextContextCursor(key: string, version: bigint, offset: number): string {
  return Buffer.from(JSON.stringify({ key, revision: version.toString(), offset })).toString(
    'base64url',
  );
}

function inRegion(geometry: Geometry | undefined, bounds: ContextRegion): boolean {
  if (!geometry) {
    return false;
  }

  const { x, y, width, height, rotation } = geometry;
  const radians = (rotation * Math.PI) / 180;
  const sine = Math.abs(Math.sin(radians));
  const cosine = Math.abs(Math.cos(radians));
  const halfWidth = (cosine * width + sine * height) / 2;
  const halfHeight = (sine * width + cosine * height) / 2;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const overlappingX =
    centerX + halfWidth >= bounds.x && centerX - halfWidth <= bounds.x + bounds.width;
  const overlappingY =
    centerY + halfHeight >= bounds.y && centerY - halfHeight <= bounds.y + bounds.height;

  return overlappingX && overlappingY;
}

function sectionObjects(objects: readonly ObjectMetadata[], sectionId: string) {
  const children = new Map<string, string[]>();
  for (const { objectId, parentId } of objects) {
    if (parentId) {
      const siblings = children.get(parentId) ?? [];
      siblings.push(objectId);
      children.set(parentId, siblings);
    }
  }

  const selected = new Set([sectionId]);
  for (const parent of selected) {
    for (const child of children.get(parent) ?? []) {
      selected.add(child);
    }
  }

  return objects.filter(({ objectId }) => selected.has(objectId));
}

export function selectContextObjects(objects: readonly ObjectMetadata[], scope: ContextScope) {
  switch (scope.kind) {
    case 'board':
      return { objects, missing: [] };
    case 'region':
      return {
        objects: objects.filter(({ geometry }) => inRegion(geometry, scope.bounds)),
        missing: [],
      };
    case 'objects': {
      const ids = new Set(scope.objectIds);
      const selected = objects.filter(({ objectId }) => ids.delete(objectId));
      return { objects: selected, missing: [...ids] };
    }
    case 'section': {
      const found = objects.find(({ objectId }) => objectId === scope.sectionId);
      if (!found || found.kind !== 'section') {
        return { objects: [], missing: [scope.sectionId] };
      }

      return { objects: sectionObjects(objects, scope.sectionId), missing: [] };
    }
  }
}
