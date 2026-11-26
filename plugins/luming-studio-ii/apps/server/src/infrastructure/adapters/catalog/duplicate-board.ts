import type { CatalogDuplicateFailure } from '../../../modules/catalog/ports/index.js';
import type { SqliteConnection, SqliteRow } from '../../platform/index.js';
import {
  CopyPayloadError,
  rewriteCopyPayload,
  type CopyPayloadScope,
} from './duplicate-payload.js';

const maximumCopiedPayloadBytes = 32n * 1024n * 1024n;

interface CopyPlan {
  readonly scope: CopyPayloadScope;
  readonly changedPayloadIds: readonly string[];
  readonly assetIds: readonly string[];
}

function payloadSize(connection: SqliteConnection, boardId: string): bigint {
  const query = connection.prepare(
    'SELECT COALESCE(SUM(length(CAST(body_json AS BLOB))), 0) AS bytes FROM object_payloads WHERE board_id = ?',
  );
  query.setReadBigInts(true);
  const row = query.get(boardId);
  if (typeof row?.bytes !== 'bigint') {
    throw new Error('The source board payload size is unavailable.');
  }

  return row.bytes;
}

function payloadText(row: SqliteRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new CopyPayloadError();
  }

  return value;
}

function inspectCopy(
  connection: SqliteConnection,
  sourceBoardId: string,
  destinationBoardId: string,
): CopyPlan | CatalogDuplicateFailure {
  if (payloadSize(connection, sourceBoardId) > maximumCopiedPayloadBytes) {
    return 'invalidCommand';
  }

  const assetIds = new Set<string>();
  const changedPayloadIds: string[] = [];
  const scope: CopyPayloadScope = {
    sourceBoardId,
    destinationBoardId,
    onAsset(assetId) {
      assetIds.add(assetId);
    },
  };
  const candidates = connection.prepare(
    "SELECT object_id, body_kind, body_json FROM object_payloads WHERE board_id = ? AND body_kind IN ('image', 'video', 'link', 'document', 'embed', 'todo')",
  );

  try {
    for (const row of candidates.iterate(sourceBoardId)) {
      const kind = payloadText(row, 'body_kind');
      const json = payloadText(row, 'body_json');
      if (rewriteCopyPayload(kind, json, scope) !== undefined) {
        changedPayloadIds.push(payloadText(row, 'object_id'));
      }
    }
  } catch (error) {
    if (error instanceof CopyPayloadError) {
      return 'stateChanged';
    }

    throw error;
  }

  const present = connection.prepare(
    'SELECT 1 FROM board_archive_assets WHERE board_id = ? AND asset_id = ?',
  );

  for (const id of assetIds) {
    if (present.get(sourceBoardId, id) === undefined) {
      return 'stateChanged';
    }
  }

  return { scope, changedPayloadIds, assetIds: [...assetIds] };
}

function copyCurrentScene(connection: SqliteConnection, scope: CopyPayloadScope): void {
  const { sourceBoardId, destinationBoardId } = scope;
  connection
    .prepare(
      'INSERT INTO board_objects (board_id, object_id, kind, label, layer_index, x, y, width, height, rotation, geometry_version, locked, parent_id, group_id, appearance_json, detail_json) SELECT ?, object_id, kind, label, layer_index, x, y, width, height, rotation, 0, locked, parent_id, group_id, appearance_json, detail_json FROM board_objects WHERE board_id = ?',
    )
    .run(destinationBoardId, sourceBoardId);
  connection
    .prepare(
      'INSERT INTO object_payloads (board_id, object_id, payload_version, body_kind, body_json) SELECT ?, object_id, 0, body_kind, body_json FROM object_payloads WHERE board_id = ?',
    )
    .run(destinationBoardId, sourceBoardId);
}

function applyPayloadRewrites(connection: SqliteConnection, plan: CopyPlan): void {
  const { scope, changedPayloadIds } = plan;
  const source = connection.prepare(
    'SELECT body_kind, body_json FROM object_payloads WHERE board_id = ? AND object_id = ?',
  );
  const update = connection.prepare(
    'UPDATE object_payloads SET body_json = ? WHERE board_id = ? AND object_id = ?',
  );

  for (const objectId of changedPayloadIds) {
    const row = source.get(scope.sourceBoardId, objectId);
    if (!row) {
      throw new Error('The source board payload disappeared during copying.');
    }

    const body = rewriteCopyPayload(
      payloadText(row, 'body_kind'),
      payloadText(row, 'body_json'),
      scope,
    );

    if (body === undefined) {
      throw new Error('The source board payload changed during copying.');
    }

    update.run(body, scope.destinationBoardId, objectId);
  }
}

function copyAssets(connection: SqliteConnection, plan: CopyPlan): void {
  const { assetIds, scope } = plan;
  if (!assetIds.length) {
    return;
  }

  const result = connection
    .prepare(
      'INSERT INTO board_archive_assets (board_id, asset_id, mime_type, bytes) SELECT ?, a.asset_id, a.mime_type, a.bytes FROM board_archive_assets AS a JOIN json_each(?) AS requested ON requested.value = a.asset_id WHERE a.board_id = ?',
    )
    .run(scope.destinationBoardId, JSON.stringify(assetIds), scope.sourceBoardId);

  if (Number(result.changes) !== assetIds.length) {
    throw new Error('Some source board assets disappeared during copying.');
  }
}

export function duplicateBoard(
  connection: SqliteConnection,
  sourceBoardId: string,
  destinationBoardId: string,
  publish: () => void,
): CatalogDuplicateFailure | undefined {
  const plan = inspectCopy(connection, sourceBoardId, destinationBoardId);
  if (typeof plan === 'string') {
    return plan;
  }

  publish();
  copyCurrentScene(connection, plan.scope);
  applyPayloadRewrites(connection, plan);
  copyAssets(connection, plan);

  return undefined;
}
