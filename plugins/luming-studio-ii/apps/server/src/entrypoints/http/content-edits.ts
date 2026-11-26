import { toJson } from '@bufbuild/protobuf';
import {
  SaveEmbedStateSchema,
  type CropBoardImage,
  type EditObjectContentRequest,
  type TodoEdit,
  type TodoPlacement,
  type UpdateTodoItem,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  DocumentPayloadSchema,
  TablePayloadSchema,
  TextPayloadSchema,
  type TodoSourceRef,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/payload';
import type {
  ContentOperation,
  JsonObject,
  JsonValue,
  TodoContentEdit,
  TodoContentPlacement,
  TodoContentSource,
} from '../../modules/whiteboard/application/index.js';
import { HttpRequestError, requireId } from './request.js';

function readSourceRef(source: TodoSourceRef): TodoContentSource {
  return {
    ...(source.boardId === undefined ? {} : { boardId: requireId(source.boardId) }),
    objectId: requireId(source.objectId),
    ...(source.blockId === undefined ? {} : { blockId: requireId(source.blockId) }),
    ...(source.itemId === undefined ? {} : { itemId: requireId(source.itemId) }),
    ...(source.version === undefined ? {} : { version: source.version.toString() }),
  };
}

function readPlacement(placement: TodoPlacement | undefined): TodoContentPlacement {
  const position = placement?.position;
  switch (position?.case) {
    case 'first':
      if (position.value) {
        return { kind: 'first' };
      }

      break;
    case 'append':
      if (position.value) {
        return { kind: 'append' };
      }

      break;
    case 'afterItemId':
      return { kind: 'after', itemId: requireId(position.value) };
    case undefined:
      break;
  }

  throw new HttpRequestError(400, 'A todo placement is required');
}

function readSourceChange(change: UpdateTodoItem['sourceChange']) {
  switch (change.case) {
    case 'sourceRef':
      return readSourceRef(change.value);
    case 'clearSource':
      if (change.value) {
        return null;
      }

      throw new HttpRequestError(400, 'The todo source clear field must be true');
    case undefined:
      return undefined;
  }
}

function readTodoEdit({ operation }: TodoEdit): TodoContentEdit {
  switch (operation.case) {
    case 'rename':
      return { kind: 'rename', title: operation.value };
    case 'insert': {
      const { item, placement } = operation.value;
      if (!item) {
        throw new HttpRequestError(400, 'A todo row is required');
      }

      return {
        kind: 'insert',
        item: {
          itemId: requireId(item.itemId),
          text: item.text,
          checked: item.checked,
          sourceRef: item.sourceRef && readSourceRef(item.sourceRef),
        },
        placement: readPlacement(placement),
      };
    }
    case 'update': {
      const { itemId, text, checked, sourceChange } = operation.value;

      return {
        kind: 'update',
        itemId: requireId(itemId),
        text,
        checked,
        sourceRef: readSourceChange(sourceChange),
      };
    }
    case 'deleteItemId':
      return { kind: 'delete', itemId: requireId(operation.value) };
    case 'move':
      return {
        kind: 'move',
        itemId: requireId(operation.value.itemId),
        placement: readPlacement(operation.value.placement),
      };
    case undefined:
      throw new HttpRequestError(400, 'A todo operation is required');
  }
}

function contentJson(encode: () => JsonValue): JsonObject {
  try {
    const value = encode();

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Expected a JSON object');
    }

    return value;
  } catch (error) {
    throw new HttpRequestError(400, 'The content cannot be encoded', { cause: error });
  }
}

function readCrop({ crop, naturalSize }: CropBoardImage) {
  if (!crop || !naturalSize) {
    throw new HttpRequestError(400, 'Crop and natural image size are required');
  }

  return {
    crop: { zoom: crop.zoom, x: crop.x, y: crop.y },
    naturalSize: { width: naturalSize.width, height: naturalSize.height },
  };
}

export function readContentOperation({
  objectId,
  expectedPayloadVersion,
  edit,
}: EditObjectContentRequest): ContentOperation {
  if (expectedPayloadVersion === undefined) {
    throw new HttpRequestError(400, 'An expected payload version is required');
  }

  const target = { objectId: requireId(objectId), expectedPayloadVersion };
  switch (edit.case) {
    case 'document': {
      const data = contentJson(() =>
        toJson(DocumentPayloadSchema, edit.value, { alwaysEmitImplicit: true }),
      );

      return { ...target, kind: 'document', data };
    }
    case 'text': {
      const encoded = contentJson(() => toJson(TextPayloadSchema, edit.value));

      return { ...target, kind: 'text', data: { ...encoded, text: edit.value.text } };
    }
    case 'todo':
      return { ...target, kind: 'todo', edits: edit.value.edits.map(readTodoEdit) };
    case 'table': {
      const { table, widthChange } = edit.value;
      if (!table) {
        throw new HttpRequestError(400, 'A table body is required');
      }

      return {
        ...target,
        kind: 'table',
        data: contentJson(() => toJson(TablePayloadSchema, table)),
        widthChange: widthChange && {
          expectedWidth: widthChange.expectedWidth,
          width: widthChange.width,
        },
      };
    }
    case 'embedSource': {
      const { title, html, expectedSourceRevision } = edit.value;
      if (expectedSourceRevision === undefined) {
        throw new HttpRequestError(400, 'An expected HTML source revision is required');
      }

      return { ...target, kind: 'embedSource', title, html, expectedSourceRevision };
    }
    case 'embedState': {
      const { state } = contentJson(() => toJson(SaveEmbedStateSchema, edit.value));
      if (state === undefined) {
        throw new HttpRequestError(400, 'An HTML state is required');
      }

      return { ...target, kind: 'embedState', state };
    }
    case 'sticker': {
      const { stickerId, fallback } = edit.value;
      if (fallback === undefined) {
        return {
          ...target,
          kind: 'sticker',
          selection: { kind: 'icon', id: requireId(stickerId) },
        };
      }
      if (stickerId !== '') {
        throw new HttpRequestError(400, 'Choose either a sticker identifier or legacy text');
      }

      return { ...target, kind: 'sticker', selection: { kind: 'legacy', fallback } };
    }
    case 'crop':
      return { ...target, kind: 'crop', ...readCrop(edit.value) };
    case undefined:
      throw new HttpRequestError(400, 'A content operation is required');
  }
}
