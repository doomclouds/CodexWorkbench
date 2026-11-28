import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardSharingService,
  SharingRejectionReason,
  SharingRole,
  SharingScope,
  type BoardSharing,
  type SharingCommandReceipt,
  type UpdateBoardSharingRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  artifactVersion,
  modelBoardId,
  modelCommandId,
  modelVersion,
} from './artifact-tool-input.js';
import { BridgeError, invalidArgument } from './errors.js';
import { callModelRpc, modelToolFailure, type ModelToolOptions } from './model-tool.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const inputSchema = z
  .object({
    artifactId: id.optional(),
    boardId: id.optional(),
    action: z
      .enum([
        'status',
        'start',
        'stop',
        'reset',
        'link',
        'role',
        'remove',
        'restore',
        'forget',
        'receipt',
      ])
      .default('status'),
    access: z
      .enum(['local', 'lan'])
      .optional()
      .describe('开始分享时省略为仅本机。显式选择 lan 才允许局域网。'),
    role: z.enum(['editor', 'commenter', 'viewer', 'all']).optional(),
    on: z.boolean().optional(),
    memberId: id.optional(),
    commandId: id.optional(),
    operationId: id.optional(),
    expectedVersion: artifactVersion
      .optional()
      .describe('分享配置版本。调用方提供 commandId 时同时填写，重试沿用原值。'),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type WireCommand = MessageInitShape<typeof UpdateBoardSharingRequestSchema>;
type Operation = NonNullable<WireCommand['operation']>;
type GuestRole = Exclude<NonNullable<Input['role']>, 'all'>;
type Command = WireCommand & { boardId: string; commandId: string; expectedVersion: bigint };
type Rejection = readonly [code: string, message: string];

const methods = BoardSharingService.method;
const wireRole: Readonly<Record<GuestRole, SharingRole>> = {
  editor: SharingRole.EDITOR,
  commenter: SharingRole.COMMENTER,
  viewer: SharingRole.VIEWER,
};
const roleName = new Map([
  [SharingRole.OWNER, 'owner'],
  [SharingRole.EDITOR, 'editor'],
  [SharingRole.COMMENTER, 'commenter'],
  [SharingRole.VIEWER, 'viewer'],
]);
const scopeName = new Map([
  [SharingScope.LOCAL, 'local'],
  [SharingScope.LAN, 'lan'],
]);
const rejection = new Map<SharingRejectionReason, Rejection>([
  [SharingRejectionReason.FORBIDDEN, ['FORBIDDEN', '只有白板所有者可以更改分享设置。']],
  [SharingRejectionReason.VERSION_CHANGED, ['CONFLICT', '分享配置已变化，请重新读取状态后操作。']],
  [
    SharingRejectionReason.COMMAND_ID_REUSE,
    ['COMMAND_ID_REUSE', '此命令 ID 已用于不同的分享请求。'],
  ],
  [SharingRejectionReason.INVALID_COMMAND, ['INVALID_ARGUMENT', '当前分享状态不允许此操作。']],
  [SharingRejectionReason.LAN_UNAVAILABLE, ['LAN_UNAVAILABLE', '局域网分享服务当前无法启动。']],
  [SharingRejectionReason.INVITATION_UNAVAILABLE, ['INVITATION_UNAVAILABLE', '邀请当前不可用。']],
  [SharingRejectionReason.NAME_TAKEN, ['NAME_TAKEN', '成员名称已被使用。']],
  [SharingRejectionReason.MEMBER_UNAVAILABLE, ['MEMBER_UNAVAILABLE', '成员记录当前不可用。']],
  [SharingRejectionReason.ROLE_DISABLED, ['ROLE_DISABLED', '请先启用目标角色的邀请链接。']],
]);
const definitive = new Set<string>(['INVALID_ARGUMENT', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT']);
const fields = ['access', 'role', 'on', 'memberId'] as const;

type ActionField = (typeof fields)[number];

const fieldsByAction: Readonly<Record<Input['action'], readonly ActionField[]>> = {
  status: ['role'],
  start: ['access', 'role'],
  stop: [],
  reset: ['role'],
  link: ['role', 'on'],
  role: ['role', 'memberId'],
  remove: ['memberId'],
  restore: ['role', 'memberId'],
  forget: ['memberId'],
  receipt: [],
};

function validateAction(input: Input) {
  const { action, role } = input;
  for (const field of fields) {
    if (input[field] !== undefined && !fieldsByAction[action].includes(field)) {
      throw invalidArgument('所选动作不接受参数 ' + field + '。');
    }
  }
  if (role === 'all' && action !== 'reset') {
    throw invalidArgument('只有重置邀请时可以指定全部角色。');
  }
}

function required(value: string | undefined, label: string) {
  if (value === undefined) {
    throw invalidArgument('请填写' + label + '。');
  }

  return value;
}

function guestRole(role: Input['role']) {
  if (role === undefined || role === 'all') {
    throw invalidArgument('请选择 editor、commenter 或 viewer 角色。');
  }

  return role;
}

function change(input: Input): Operation {
  const { action, access, role, on, memberId } = input;
  switch (action) {
    case 'start':
      return {
        case: 'setScope',
        value: { scope: access === 'lan' ? SharingScope.LAN : SharingScope.LOCAL },
      };
    case 'stop':
      return { case: 'stop', value: {} };
    case 'link':
      if (on === undefined) {
        throw invalidArgument('请填写 on 以启用或关闭邀请链接。');
      }

      return { case: 'setInvitation', value: { role: wireRole[guestRole(role)], enabled: on } };
    case 'reset':
      return {
        case: 'resetInvitation',
        value: { role: role && role !== 'all' ? wireRole[role] : SharingRole.UNSPECIFIED },
      };
    case 'role':
      return {
        case: 'changeMemberRole',
        value: { actorId: required(memberId, '成员 ID'), role: wireRole[guestRole(role)] },
      };
    case 'restore':
      return {
        case: 'restoreMember',
        value: { actorId: required(memberId, '成员 ID'), role: wireRole[guestRole(role)] },
      };
    case 'remove':
      return { case: 'removeMember', value: { actorId: required(memberId, '成员 ID') } };
    case 'forget':
      return { case: 'forgetMember', value: { actorId: required(memberId, '成员 ID') } };
    case 'status':
    case 'receipt':
      throw invalidArgument('此动作不修改分享设置。');
  }
}

async function readState(options: ModelToolOptions, boardId: string, signal: AbortSignal) {
  const { sharing } = await callModelRpc(options, methods.getBoardSharing, { boardId }, signal);
  if (sharing?.boardId !== boardId || sharing.version === undefined) {
    throw new BridgeError('UNAVAILABLE', '本机分享服务返回的状态不完整。');
  }

  return { ...sharing, version: sharing.version };
}

function presentState(sharing: BoardSharing, invitationRole?: GuestRole) {
  const requested =
    invitationRole && sharing.links.find(({ role }) => role === wireRole[invitationRole]);
  const invitation =
    requested && requested.enabled && requested.url
      ? { role: invitationRole, url: requested.url }
      : undefined;

  return {
    artifactId: sharing.boardId,
    boardId: sharing.boardId,
    enabled: sharing.enabled,
    access: scopeName.get(sharing.scope),
    role: roleName.get(sharing.role),
    version: sharing.version?.toString(),
    canEdit: sharing.canEdit,
    canComment: sharing.canComment,
    links: sharing.links.map(({ role, enabled }) => ({ role: roleName.get(role), enabled })),
    members: sharing.members.map(
      ({ actorId, name, role, removed, active, online, lastSeenAtMillis }) => ({
        id: actorId,
        name,
        role: roleName.get(role),
        removed,
        active,
        online,
        lastSeenAtMillis: lastSeenAtMillis?.toString(),
      }),
    ),
    invitation,
  };
}

async function readReceipt(
  options: ModelToolOptions,
  boardId: string,
  commandId: string,
  signal: AbortSignal,
) {
  const { receipt } = await callModelRpc(
    options,
    methods.getBoardSharingReceipt,
    { boardId, commandId },
    signal,
  );
  assertReceipt(receipt, boardId, commandId);

  return receipt;
}

function assertReceipt(
  receipt: SharingCommandReceipt | undefined,
  boardId: string,
  commandId: string,
) {
  if (!receipt) {
    return;
  }

  const outcome = receipt.outcome;
  const applied = outcome.case === 'applied' && outcome.value.version !== undefined;
  const matches = receipt.boardId === boardId && receipt.commandId === commandId;
  const complete = applied || outcome.case === 'rejected';
  if (!matches || !complete) {
    throw new BridgeError('UNAVAILABLE', '本机分享服务返回的回执与请求不匹配。');
  }
}

function missingConfirmation(options: ModelToolOptions, error: unknown): undefined {
  if (!(error instanceof BridgeError)) {
    options.onError(error);
  }

  return undefined;
}

async function submit(options: ModelToolOptions, command: Command, signal: AbortSignal) {
  try {
    const { receipt } = await callModelRpc(options, methods.updateBoardSharing, command, signal);
    assertReceipt(receipt, command.boardId, command.commandId);
    if (receipt) {
      return receipt;
    }
  } catch (error) {
    if (error instanceof BridgeError && definitive.has(error.code)) {
      throw error;
    }
  }

  signal.throwIfAborted();

  return readReceipt(options, command.boardId, command.commandId, signal).catch((error: unknown) =>
    missingConfirmation(options, error),
  );
}

function ok(data: Record<string, unknown>) {
  return { content: [], structuredContent: { ok: true, data } };
}

function fail(code: string, message: string, details: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
    structuredContent: { ok: false, error: { code, message, details } },
  };
}

function showOutcome(receipt: SharingCommandReceipt, details: Record<string, unknown>) {
  if (receipt.outcome.case === 'rejected') {
    const [code, message] = rejection.get(receipt.outcome.value.reason) ?? [
      'UNAVAILABLE',
      '本机分享服务拒绝了此次操作。',
    ];

    return fail(code, message, details);
  }

  return ok({ ...details, version: receipt.outcome.value?.version?.toString(), state: 'applied' });
}

function invitationFor(input: Input) {
  const { action, role, on } = input;
  const requestsInvitation =
    action === 'status' || action === 'reset' || action === 'start' || (action === 'link' && on);

  return requestsInvitation && role !== 'all' ? role : undefined;
}

async function share(input: Input, options: ModelToolOptions, signal: AbortSignal) {
  validateAction(input);
  const boardId = modelBoardId(input);
  const invite = invitationFor(input);
  if (input.action === 'status') {
    return ok(presentState(await readState(options, boardId, signal), invite));
  }

  if (input.action === 'receipt') {
    const commandId = modelCommandId(input);
    const receipt = await readReceipt(options, boardId, commandId, signal);
    const details = { boardId, commandId, recorded: Boolean(receipt) };

    return receipt ? showOutcome(receipt, details) : ok(details);
  }

  const operation = change(input);
  const supplied = input.commandId || input.operationId ? modelCommandId(input) : undefined;
  const requestedVersion = modelVersion(input.expectedVersion);
  if (supplied !== undefined && requestedVersion === undefined) {
    throw invalidArgument('提供命令 ID 时请同时填写原分享版本 expectedVersion。');
  }

  const commandId = supplied ?? options.allocateId();
  const expectedVersion = requestedVersion ?? (await readState(options, boardId, signal)).version;
  const command = { boardId, commandId, expectedVersion, operation };
  const receipt = await submit(options, command, signal);
  const details = { boardId, commandId, expectedVersion: expectedVersion.toString() };
  if (!receipt) {
    return fail(
      'COMMIT_RESULT_UNKNOWN',
      '未能确认分享操作结果。请先查询回执，重试时使用同一命令 ID、原版本和参数。',
      details,
    );
  }
  if (receipt.outcome.case !== 'applied') {
    return showOutcome(receipt, details);
  }

  const current = await readState(options, boardId, signal).catch((error: unknown) =>
    missingConfirmation(options, error),
  );
  const appliedVersion = receipt.outcome.value.version;
  const matchingInvitation = current?.version === appliedVersion ? invite : undefined;

  return ok({
    ...details,
    version: appliedVersion?.toString(),
    state: 'applied',
    sharing: current && presentState(current, matchingInvitation),
  });
}

export function registerArtifactShareTool(server: McpServer, options: ModelToolOptions): void {
  server.registerTool(
    'artifact_share',
    {
      title: '管理白板分享',
      description:
        '查询状态、开启或停止分享、重置邀请、启用或关闭角色链接、修改或移除成员，以及恢复访问或删除已移除成员记录。status 指定 role 可读取该邀请链接。start 缺省仅本机，只有指定 access=lan 才开启局域网。reset 不指定 role 时重置全部邀请。写操作须由所有者调用。可用 receipt 和原命令 ID 查询回执。',
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { ui: { visibility: ['model'] } },
    },
    async (input, { signal }) => {
      try {
        return await share(input, options, signal);
      } catch (error) {
        return modelToolFailure(error, options.onError);
      }
    },
  );
}
