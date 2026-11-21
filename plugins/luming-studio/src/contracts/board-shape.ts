import { z } from 'zod';
import { DOCUMENT_BLOCK_TYPES, type DocumentBlock } from './document.js';
import { ELEMENT_TYPES, type Board, type BoardElement } from './studio.js';

const text = z.string();
const number = z.number();
const revision = z.int().nonnegative();
const fields = z.record(text, z.unknown());
const json = z.json();

const artifact = z.looseObject({
  id: text.min(1),
  type: text,
  title: text,
  revision,
  createdAt: text,
  updatedAt: text,
  pinned: z.boolean(),
  trashedAt: text.optional(),
  thumbnail: text.optional(),
  sharing: z.boolean().optional(),
  storageStatus: z.literal('unsupported').optional(),
  importedFrom: z
    .looseObject({
      artifactId: text,
      title: text,
      createdAt: text,
      importedAt: text,
    })
    .optional(),
});
const style = z
  .object({
    name: text,
    paper: text,
    ink: text,
    muted: text,
    accent: text,
    link: text,
    fontFamily: text,
    titleFont: text,
    monoFont: text,
  })
  .catchall(text);
const block: z.ZodType<DocumentBlock> = z.lazy(() =>
  z.looseObject({
    id: text,
    type: z.enum(DOCUMENT_BLOCK_TYPES),
    props: z.record(text, json),
    content: json.optional(),
    children: z.array(block).optional(),
  }),
);
const documentContent = z.looseObject({ schemaVersion: z.literal(1), blocks: z.array(block) });
const point = z.looseObject({ x: number, y: number });
const endpoint = z.union([text, z.tuple([number, number])]);
const element = z.looseObject({
  id: text.min(1),
  type: z.enum(ELEMENT_TYPES),
  x: number,
  y: number,
  w: number,
  h: number,
  version: revision,
  text: text.optional(),
  kind: text.optional(),
  color: text.optional(),
  stroke: text.optional(),
  fill: text.optional(),
  fontSize: number.optional(),
  fontFamily: text.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  rotation: number.optional(),
  parentId: text.optional(),
  groupId: text.optional(),
  locked: z.boolean().optional(),
  hollow: z.boolean().optional(),
  strokeWidth: number.optional(),
  heads: z.array(z.enum(['none', 'arrow', 'circle'])).optional(),
  crop: point.extend({ zoom: number }).optional(),
  from: endpoint.optional(),
  to: endpoint.optional(),
  fromSide: text.optional(),
  toSide: text.optional(),
  label: text.optional(),
  dash: z.boolean().optional(),
  head: text.optional(),
  points: z.array(number).optional(),
  bends: z.array(z.union([number, z.enum(['h', 'v'])])).optional(),
  labelOffset: point.optional(),
  labelSize: z.looseObject({ w: number, h: number }).optional(),
  src: text.optional(),
  video: text.optional(),
  html: text.optional(),
  sourceRevision: revision.optional(),
  state: json.optional(),
  href: text.optional(),
  document: documentContent.optional(),
  data: fields.optional(),
});
const board = z.looseObject({
  artifact,
  style,
  elements: z.array(element),
  motion: fields.optional(),
  orderVersion: revision.optional(),
});

export {
  artifact as studioArtifactSchema,
  board as studioBoardSchema,
  documentContent as studioDocumentSchema,
};

const elementFields = element.partial();

export function isBoardElementFields(value: unknown): value is Partial<BoardElement> {
  return elementFields.safeParse(value).success;
}

export function isBoardElementProjection(value: unknown): value is BoardElement {
  return element.safeParse(value).success;
}

export function isBoardProjection(value: unknown): value is Board {
  return board.safeParse(value).success;
}
