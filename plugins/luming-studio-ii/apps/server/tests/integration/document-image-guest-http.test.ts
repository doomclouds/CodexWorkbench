import assert from 'node:assert/strict';
import {
  create,
  fromBinary,
  toBinary,
  type DescMessage,
  type DescMethodUnary,
  type MessageInitShape,
} from '@bufbuild/protobuf';
import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import {
  BoardSharingService,
  SharingRole,
  SharingScope,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import { expect, test } from 'vitest';
import { pngImage } from '../fixtures/board-image-bytes.js';
import { callWhiteboard } from '../support/whiteboard-client.js';
import { useSharingTestServer } from './sharing-test-server.js';

const server = useSharingTestServer();
const share = BoardSharingService.method;
const { uploadBoardDocumentImage } = BoardEditService.method;
const owner = 'document-sharing-owner';
const objectId = 'shared-document';

async function shareDocument() {
  const board = await callWhiteboard(server.owner, owner, BoardCatalogService.method.createBoard, {
    commandId: 'create-shared-document-board',
    title: 'Shared document',
  });
  const created = board.receipt?.outcome;
  assert.equal(created?.case, 'created');
  const { boardId } = created.value;
  const document = await callWhiteboard(
    server.owner,
    owner,
    BoardEditService.method.editBoardGeometry,
    {
      boardId,
      commandId: 'place-shared-document',
      operation: {
        case: 'create',
        value: {
          object: {
            objectId,
            kind: 'document',
            label: 'Notes',
            geometry: { x: 0, y: 0, width: 300, height: 220, rotation: 0 },
          },
        },
      },
    },
  );
  assert.equal(document.receipt?.outcome.case, 'applied');
  const enabled = await callWhiteboard(server.owner, owner, share.updateBoardSharing, {
    boardId,
    commandId: 'enable-document-sharing',
    expectedVersion: 0n,
    operation: { case: 'setScope', value: { scope: SharingScope.LAN } },
  });
  assert.equal(enabled.receipt?.outcome.case, 'applied');

  return boardId;
}

function guest<Input extends DescMessage>(
  method: DescMethodUnary<Input>,
  request: MessageInitShape<Input>,
  cookie?: string,
) {
  const headers = new Headers({ 'content-type': 'application/protobuf' });
  if (cookie) {
    headers.set('cookie', cookie);
  }

  const path = '/' + method.parent.typeName + '/' + method.name;

  return fetch(new URL(path, server.guest('lan')), {
    method: 'POST',
    headers,
    body: new Uint8Array(toBinary(method.input, create(method.input, request))),
    signal: AbortSignal.timeout(5_000),
  });
}

async function join(boardId: string, role: SharingRole, name: string) {
  const response = await callWhiteboard(server.owner, owner, share.getBoardSharing, { boardId });
  const url = response.sharing?.links.find((link) => link.role === role)?.url;
  assert.ok(url);
  const invitationToken = new URLSearchParams(new URL(url).hash.slice(1)).get('invite');
  assert.ok(invitationToken);
  const inspected = await guest(share.inspectBoardInvitation, { boardId, invitationToken });
  const cookie = inspected.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  await inspected.body?.cancel();
  const accepted = await guest(
    share.joinBoardInvitation,
    { boardId, invitationToken, name },
    cookie,
  );
  assert.equal(accepted.status, 200);
  const data = fromBinary(
    share.joinBoardInvitation.output,
    new Uint8Array(await accepted.arrayBuffer()),
  );
  assert.ok(data.session);

  return cookie;
}

test('permits document asset uploads only for guests with edit access to that board', async () => {
  const boardId = await shareDocument();
  const editor = await join(boardId, SharingRole.EDITOR, 'Document editor');
  const viewer = await join(boardId, SharingRole.VIEWER, 'Document viewer');
  const command = { boardId, objectId, commandId: 'shared-document-asset', content: pngImage };

  const allowed = await guest(uploadBoardDocumentImage, command, editor);
  assert.equal(allowed.status, 200);
  const result = fromBinary(
    uploadBoardDocumentImage.output,
    new Uint8Array(await allowed.arrayBuffer()),
  );
  expect(result.receipt?.outcome).toMatchObject({ case: 'applied', value: { boardRevision: 1n } });
  expect(result.assetUrl).toContain('/studio-archive-assets/' + boardId + '/');

  const readOnly = await guest(uploadBoardDocumentImage, command, viewer);
  const differentBoard = await guest(
    uploadBoardDocumentImage,
    { ...command, boardId: 'not-the-shared-board' },
    editor,
  );
  expect(readOnly.status).toBe(403);
  expect(differentBoard.status).toBe(403);
});
