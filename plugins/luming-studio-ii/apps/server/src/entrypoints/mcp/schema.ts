import { z } from 'zod';

export const bridgeChunkBytes = 128 * 1024;
export const bridgeMaximumBytes = 128 * 1024 * 1024;
export const bridgeMaximumResponseBytes = bridgeMaximumBytes + 32 * 1024;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const base64Chunk = z.string().max(Math.ceil(bridgeChunkBytes / 3) * 4);
const offset = z.number().int().min(0);
const version = z.literal(1);
const sessionId = z.uuid();
const coordinate = z.number().min(-1_000_000_000).max(1_000_000_000);
const panelCamera = z.strictObject({
  x: coordinate,
  y: coordinate,
  zoom: z.number().min(0.05).max(8),
});
const panelState = z.strictObject({
  boardId: id,
  selectedIds: z.array(id).max(40),
  selectedCount: z.number().int().min(0).max(0xffffffff),
  viewport: panelCamera,
  focusedObjectId: id.optional(),
  returnViewport: panelCamera.optional(),
});

export const openSchema = z.object({ boardId: id.optional() }).strict();

export const bridgeSchema = z.discriminatedUnion('action', [
  z.object({ version, action: z.literal('connect'), boardId: id.optional() }).strict(),
  z.strictObject({
    version,
    action: z.literal('view'),
    sessionId,
    viewId: id,
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: panelState.optional(),
  }),
  z
    .object({
      version,
      action: z.literal('request'),
      sessionId,
      service: z.string().max(80),
      method: z.string().max(50),
      body: base64Chunk.optional(),
      uploadId: z.uuid().optional(),
      commandId: id.optional(),
    })
    .strict(),
  z
    .object({
      version,
      action: z.literal('asset'),
      sessionId,
      boardId: id,
      assetId: id,
    })
    .strict(),
  z
    .object({
      version,
      action: z.literal('upload'),
      sessionId,
      transferId: z.uuid().optional(),
      offset: offset.max(bridgeMaximumBytes),
      size: z.number().int().min(1).max(bridgeMaximumBytes),
      data: base64Chunk,
    })
    .strict(),
  z
    .object({
      version,
      action: z.literal('download'),
      sessionId,
      transferId: z.uuid(),
      offset: offset.max(bridgeMaximumResponseBytes),
    })
    .strict(),
  z
    .object({
      version,
      action: z.literal('release'),
      sessionId,
      transferId: z.uuid(),
    })
    .strict(),
  z.object({ version, action: z.literal('close'), sessionId }).strict(),
]);

export type BridgeInput = z.infer<typeof bridgeSchema>;
export type OpenInput = z.infer<typeof openSchema>;
