import { createRequire } from "node:module";

const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const embeds = new Set(["html", "diagram", "chart"]);
const alignments = [undefined, "left", "center", "right"];

function portableBlock({ id, type, props = {}, content, children = [] }) {
  return { id, type, props, content, children: children.map(portableBlock) };
}

function portableTodoItem({ id, text, checked = false, sourceRef }, sourceBoardId) {
  const source = sourceRef && {
    artifactId: sourceRef.boardId ?? sourceBoardId,
    elementId: sourceRef.objectId,
    blockId: sourceRef.blockId,
    itemId: sourceRef.itemId,
    version: sourceRef.version,
  };

  return { id, text, checked, sourceRef: source };
}

export function portableContent(object, sourceBoardId) {
  const { kind } = object;
  if (embeds.has(kind)) {
    return { html: object.html, state: object.state, sourceRevision: object.sourceRevision ?? 1 };
  }

  switch (kind) {
    case "document":
      return {
        document: { schemaVersion: 1, blocks: (object.document?.blocks ?? []).map(portableBlock) },
      };
    case "todo":
      return {
        data: { items: (object.items ?? []).map((item) => portableTodoItem(item, sourceBoardId)) },
      };
    case "table":
      return {
        data: {
          rows: object.rows,
          rowIds: object.rowIds,
          columnIds: object.columnIds,
          columnWidths: object.columnWidths,
          head: object.head,
        },
      };
    case "image":
      return {
        src: object.src,
        href: object.href,
        crop: object.crop,
        data: {
          naturalWidth: object.naturalSize?.width,
          naturalHeight: object.naturalSize?.height,
        },
      };
    case "video":
      return { src: object.poster, video: object.src };
    case "link":
      return { href: object.href };
    case "sticker":
      return { data: { stickerIconId: object.stickerIconId } };
    case "ink":
      return { points: object.points, strokeWidth: object.strokeWidth };
    default:
      return {
        color: object.color,
        fontFamily: object.fontFamily,
        fontSize: object.fontSize,
        textAlign: object.textAlign,
        bold: object.bold,
        italic: object.italic,
      };
  }
}

function initialTodoItem({ id, text, checked = false, sourceRef }) {
  const source = sourceRef && {
    boardId: sourceRef.artifactId,
    objectId: sourceRef.elementId,
    blockId: sourceRef.blockId,
    itemId: sourceRef.itemId,
    version: sourceRef.version,
  };

  return { id, text, checked, sourceRef: source };
}

export function initialContent(object, kind) {
  const { data = {} } = object;
  if (embeds.has(kind)) {
    return { html: object.html, state: object.state, sourceRevision: object.sourceRevision };
  }

  switch (kind) {
    case "document":
      return {
        document: {
          schemaVersion: object.document.schemaVersion,
          blocks: object.document.blocks.map(portableBlock),
        },
      };
    case "todo":
      return { items: (data.items ?? []).map(initialTodoItem) };
    case "table":
      return { rows: data.rows, rowIds: data.rowIds, columnIds: data.columnIds, head: data.head };
    case "image":
      return {
        src: object.src,
        href: object.href,
        crop: object.crop,
        naturalSize: data.naturalWidth
          ? { width: data.naturalWidth, height: data.naturalHeight }
          : undefined,
      };
    case "video":
      return { src: object.video, poster: object.src };
    case "link":
      return { href: object.href };
    case "sticker":
      return { stickerIconId: data.stickerIconId };
    case "ink":
      return { points: object.points ?? [] };
    default:
      return {
        color: object.color,
        fontFamily: object.fontFamily,
        fontSize: object.fontSize,
        textAlign: object.textAlign,
        bold: object.bold,
        italic: object.italic,
      };
  }
}

function versionNumber(value) {
  return value === undefined ? undefined : Number(value);
}

function iiTodoItem({ itemId: id, text, checked, sourceRef }) {
  const source = sourceRef && {
    boardId: sourceRef.boardId,
    objectId: sourceRef.objectId,
    blockId: sourceRef.blockId,
    itemId: sourceRef.itemId,
    version: versionNumber(sourceRef.version),
  };

  return { id, text, checked, sourceRef: source };
}

function pointValues({ points }, { width, height }) {
  return points.flatMap(({ x, y }) => [x * (width || 1), y * (height || 1)]);
}

export function createIiContentReader() {
  const { toJson } = requireServer("@bufbuild/protobuf");
  const { ValueSchema } = requireServer("@bufbuild/protobuf/wkt");
  function json(schema, value) {
    return value === undefined ? undefined : toJson(schema, value);
  }

  function block({ blockId, type, props, content, children }) {
    return {
      id: blockId,
      type,
      props: props ?? {},
      content: json(ValueSchema, content),
      children: children.map(block),
    };
  }

  function document({ schemaVersion, blocks }) {
    return { schemaVersion, blocks: blocks.map(block) };
  }

  function image({ src, href, crop, naturalSize }) {
    return {
      src,
      href,
      crop: crop && { x: crop.x, y: crop.y, zoom: crop.zoom },
      naturalSize: naturalSize && { width: naturalSize.width, height: naturalSize.height },
    };
  }

  return function content(payload, geometry) {
    const { case: kind, value } = payload?.body ?? {};
    switch (kind) {
      case "document":
        return { document: document(value) };
      case "embed":
        return {
          html: value.html,
          state: json(ValueSchema, value.state),
          sourceRevision: versionNumber(value.sourceRevision),
        };
      case "todo":
        return { items: value.items.map(iiTodoItem) };
      case "table":
        return {
          rows: value.grid?.rows.map(({ cells }) =>
            cells.map(({ value }) => (value.case === "nullValue" ? null : value.value)),
          ),
          rowIds: value.grid?.rowIds,
          columnIds: value.grid?.columnIds,
          head: value.grid?.head,
        };
      case "image":
        return image(value);
      case "video":
        return { src: value.src, poster: value.poster };
      case "link":
        return { href: value.href };
      case "sticker":
        return { stickerIconId: value.stickerId };
      case "ink":
        return { points: pointValues(value, geometry) };
      case "text":
        return {
          text: value.text,
          color: value.color,
          fontFamily: value.fontFamily,
          fontSize: value.fontSize,
          textAlign: alignments[value.align],
          bold: value.bold,
          italic: value.italic,
        };
      default:
        return {};
    }
  };
}
