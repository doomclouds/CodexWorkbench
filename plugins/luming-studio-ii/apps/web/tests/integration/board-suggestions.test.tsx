import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardSuggestionService,
  type BoardSuggestionSchema,
} from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
import { expect, test } from 'vitest';
import {
  createSuggestionService,
  type AttachedReviewSource,
  type SuggestionPost,
} from '../../src/data/suggestions/index.js';
import { createWhiteboardEditService } from '../../src/data/whiteboard/index.js';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { boardCommandId, createAppMock } from '../support/whiteboard-app-mock.js';

const {
  listBoardSuggestions,
  createBoardReviewSource,
  previewBoardSuggestion,
  acceptBoardSuggestion,
} = BoardSuggestionService.method;
const suggestion = {
  proposalId: 'stored-suggestion',
  sourceId: 'frozen-selection',
  observation: '向右移动已选择的矩形。',
  proposalVersion: 0n,
  expiresAtMillis: 1_800_000_000_000n,
  options: [{ optionId: 'move-right', label: '右移矩形' }],
} satisfies MessageInitShape<typeof BoardSuggestionSchema>;
const previewedObject = {
  objectId: 'rectangle',
  kind: 'shape',
  label: '可移动图形',
  geometryVersion: 1n,
  geometry: { x: 140, y: 40, width: 120, height: 80, rotation: 0 },
};
const frozenTarget = {
  objectId: 'rectangle',
  kind: 'shape',
  geometryVersion: 0n,
  geometry: { x: 40, y: 40, width: 120, height: 80, rotation: 0 },
};

function route(method: DescMethodUnary): string {
  return '/' + method.parent.typeName + '/' + method.name;
}

function reply<Output extends DescMessage>(schema: Output, result: MessageInitShape<Output>) {
  return toBinary(schema, create(schema, result));
}

function createSuggestionRpc() {
  const whiteboard = createWhiteboardRpcMock();
  const calls: string[] = [];
  let applied = false;

  const post: SuggestionPost = async (path, bytes) => {
    calls.push(path);
    if (path === route(listBoardSuggestions)) {
      const value = applied
        ? {
            ...suggestion,
            acceptedOptionId: 'move-right',
            acceptedBoardRevision: 1n,
            proposalVersion: 1n,
          }
        : suggestion;

      return reply(listBoardSuggestions.output, { proposals: [value] });
    }
    if (path === route(createBoardReviewSource)) {
      const query = fromBinary(createBoardReviewSource.input, bytes);
      expect(query).toMatchObject({
        boardId: sampleBoardId,
        commandId: boardCommandId,
        expectedBoardRevision: 0n,
        origin: { case: 'selection', value: { objectIds: ['rectangle'] } },
      });

      return reply(createBoardReviewSource.output, {
        source: {
          boardId: sampleBoardId,
          sourceId: suggestion.sourceId,
          capturedBoardRevision: 0n,
          targetsBoardRevision: 0n,
          objectIds: ['rectangle'],
          targets: [frozenTarget],
        },
      });
    }
    if (path === route(previewBoardSuggestion)) {
      const query = fromBinary(previewBoardSuggestion.input, bytes);
      expect(query).toMatchObject({
        boardId: sampleBoardId,
        proposalId: suggestion.proposalId,
        optionId: 'move-right',
        expectedProposalVersion: 0n,
      });

      return reply(previewBoardSuggestion.output, {
        result: {
          case: 'preview',
          value: { boardRevision: 0n, changedObjects: [previewedObject] },
        },
      });
    }
    if (path === route(acceptBoardSuggestion)) {
      const query = fromBinary(acceptBoardSuggestion.input, bytes);
      expect(query).toMatchObject({
        boardId: sampleBoardId,
        commandId: boardCommandId,
        proposalId: suggestion.proposalId,
        optionId: 'move-right',
        expectedProposalVersion: 0n,
      });
      applied = true;

      return reply(acceptBoardSuggestion.output, {
        receipt: {
          boardId: sampleBoardId,
          commandId: boardCommandId,
          outcome: {
            case: 'applied',
            value: { boardRevision: 1n, changedObjects: [previewedObject] },
          },
        },
      });
    }

    return whiteboard.post(path, bytes);
  };

  return { post, calls };
}

function rectangle(stage: ParentNode) {
  const target = stage.querySelector<HTMLElement>('[data-canvas-object="rectangle"]');
  if (!target) {
    throw new Error('The staged board did not render the test rectangle.');
  }

  return target;
}

test('opens review from WhiteboardApp, freezes the chosen source, previews and applies the acknowledged change', async () => {
  const rpc = createSuggestionRpc();
  const editService = createWhiteboardEditService(rpc.post);
  const suggestions = createSuggestionService(rpc.post, editService);
  type Attachment = AttachedReviewSource & { readonly boardId: string };
  const attached: Attachment[] = [];
  const app = createAppMock(rpc.post, {
    suggestions,
    async onAttachReviewSource(reference) {
      attached.push(reference);
    },
  });

  try {
    await app.open(sampleBoardId);
    const shape = rectangle(app.canvas());
    expect(shape.style.left).toBe('40px');
    await app.drag({ x: 55, y: 55 }, { x: 55, y: 55 }, shape);
    await app.click('私人建议');
    expect(rpc.calls).not.toContain(route(createBoardReviewSource));

    await app.click('附加选区');
    expect(attached).toEqual([
      {
        boardId: sampleBoardId,
        sourceId: suggestion.sourceId,
        capturedBoardRevision: 0n,
        targetsBoardRevision: 0n,
        targets: [frozenTarget],
      },
    ]);

    await app.click('右移矩形');
    await app.click('预览所选方案');
    const review = app.host.querySelector('[aria-label="只读方案预览"]');
    expect(review).not.toBeNull();
    expect(rectangle(review ?? app.host).style.left).toBe('140px');
    expect(rectangle(app.canvas()).style.left).toBe('40px');
    expect(app.canvas().closest('[inert]')).not.toBeNull();
    expect(rpc.calls).not.toContain(route(acceptBoardSuggestion));

    await app.click('接受所选方案');
    expect(app.host.querySelector('[aria-label="只读方案预览"]')).toBeNull();
    expect(rectangle(app.canvas()).style.left).toBe('140px');
    expect(rpc.calls.filter((path) => path === route(acceptBoardSuggestion))).toHaveLength(1);
    expect(app.host.textContent).toContain('已采用 右移矩形');
  } finally {
    app.dispose();
  }
});

test('rejects an encoded source reply that adds an object beyond the explicit selection', async () => {
  const post: SuggestionPost = async () =>
    reply(createBoardReviewSource.output, {
      source: {
        boardId: sampleBoardId,
        sourceId: 'unexpected-scope',
        capturedBoardRevision: 0n,
        targetsBoardRevision: 0n,
        objectIds: ['rectangle', 'other-object'],
        targets: [frozenTarget, { ...frozenTarget, objectId: 'other-object' }],
      },
    });
  const service = createSuggestionService(post, createWhiteboardEditService(post));
  await expect(
    service.createReviewSource({
      boardId: sampleBoardId,
      commandId: boardCommandId,
      origin: { kind: 'selection', objectIds: ['rectangle'] },
    }),
  ).rejects.toThrow('冻结来源与原选区不匹配。');
});
