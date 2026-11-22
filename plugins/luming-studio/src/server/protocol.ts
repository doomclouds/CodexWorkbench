import { STUDIO_DISPLAY_NAME, STUDIO_HOME_TITLE } from '../contracts/branding.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { STUDIO_ICON } from '../contracts/brand-icon.js';
import { PLUGIN_VERSION } from '../contracts/version.js';
import { STUDIO_TOOLS, type Connection, type ToolName } from '../contracts/studio.js';
import { TOOL_NAMES } from '../contracts/studio.js';
import {
  APP_TOOL_NAME,
  type AppTransferSpoolFactory,
  type UiRequester,
} from '../contracts/transport.js';
import { appTransportSchema, createAppTransport } from './app-transport.js';
import {
  boundedModelRequest,
  boundedModelResult,
  modelDataFits,
  modelResponseParts,
} from '../core/model-read.js';

export interface StudioExecutionContext {
  clientInfo?: { name: string; version: string; title?: string };
}
export interface StudioExecutor {
  execute(
    name: ToolName,
    args: Record<string, unknown>,
    context?: StudioExecutionContext,
  ): Promise<unknown>;
  connection(): Promise<Connection>;
  requestUi?: UiRequester;
}

const id = z.string().min(1).max(200);
const participant = z
  .object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(60),
    appearanceKey: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      .optional()
      .describe(
        '本聊天首次生成并在每次调用中复用的随机 UUIDv4；各 Agent 携带同一聊天 key 和各自固定 id，以保持重连后的头像。同一连接承载不同聊天时，各聊天使用不同 key。服务只公布派生呈现标识；key 不恢复跨连接作者权限或任务授权。',
      ),
  })
  .optional()
  .describe(
    '仅所有者的 MCP 调用可提供：同一连接中多个 Agent 使用稳定 id/name 区分协作身份；不带 appearanceKey 时，显式 main 与省略 participant 使用同一主身份。id 是不透明标识，可以使用 Agent 的任务路径，不作文件路径解释。同一主代理跨轮次、切换任务和重开面板时复用原 id/name/appearanceKey。身份由服务端按连接命名空间派生，不能用于访客提权。',
  );
const coordinate = z.number().min(-10_000_000).max(10_000_000);
const rect = z.object({
  x: coordinate,
  y: coordinate,
  w: z.number().positive().max(10_000_000),
  h: z.number().positive().max(10_000_000),
});
const pagination = {
  cursor: z.string().max(256).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(200000).optional(),
};
const taskBinding = {
  taskId: id
    .optional()
    .describe('与 generation 成对携带的本次 Agent 工作任务 ID，不从上次任务推断。'),
  generation: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      'artifact_activity 返回的原样任务代次；与 taskId 成对，不能用旧代续写、换号盲重试或绕过人工结束。',
    ),
};
const anchor = z
  .object({
    coordinateSpace: z
      .enum(['board', 'element', 'html', 'document', 'todo'])
      .optional()
      .describe(
        'board 为白板世界坐标；element 为对象相对坐标；html 为区域 CSS 像素；document 用 blockIds，todo 用 itemId 定位同一来源版本的内容。',
      ),
    elementIds: z
      .array(id)
      .optional()
      .describe('已存在对象的稳定 ID；element 坐标以首个对象为基准。'),
    regionId: id.optional().describe('HTML 区域 ID；html 坐标空间必填。'),
    targetIds: z.array(z.string().max(160)).max(100).optional(),
    blockIds: z
      .array(id)
      .min(1)
      .max(100)
      .optional()
      .describe('document 备注选中的实际稳定段落 ID。'),
    itemId: z.string().min(1).max(120).optional().describe('todo 备注对应的稳定任务行 ID。'),
    sourceVersion: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('文档或任务行来源的 element.version；写入仍使用当前 expectedVersions。'),
    sourceRevision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('HTML 原始选区的源码版本，需要 regionId；不能用作对象 CAS 版本。'),
    quote: z.string().max(4000).optional(),
    excerpt: z.string().max(16000).optional(),
    selector: z.string().max(1200).optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    w: coordinate.min(0).optional(),
    h: coordinate.min(0).optional(),
    pin: z
      .discriminatedUnion('coordinateSpace', [
        z.object({ coordinateSpace: z.literal('board'), x: coordinate, y: coordinate }),
        z.object({
          coordinateSpace: z.literal('document'),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        }),
        z.object({
          coordinateSpace: z.literal('todo'),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
        }),
      ])
      .optional()
      .describe(
        '备注气泡尖头的独立显示位置。board 使用白板世界坐标；document 或 todo 分别使用目标段落或任务行内的归一化相对点。',
      ),
  })
  .loose();
const elementPatch = z
  .object({
    locked: z
      .boolean()
      .optional()
      .describe(
        '仅锁定位置、尺寸、旋转、连接几何和裁剪。锁后文字、样式、HTML 和 state 仍可更新。解锁须单独提交 changes:{locked:false}，且不能在同一事务内继续移动或删除。',
      ),
  })
  .loose();
const operation = z
  .object({
    op: z.string().min(1).max(64),
    id: id.optional(),
    ids: z.array(id).optional(),
    versionId: id
      .optional()
      .describe(
        'restore 的历史版本 ID；附 id 或 ids 时只恢复所选单元，保留未选择的内容、样式与当前标题。',
      ),
    element: elementPatch.optional(),
    changes: elementPatch.optional(),
  })
  .loose();
const mutationOperations = z.array(operation).min(1).max(200);
const schemas = {
  studio_open: z.object({
    view: z.enum(['library', 'editor', 'board', 'trash']).optional(),
    artifactId: id.optional(),
  }),
  artifact_list: z.object({
    ...pagination,
    query: z.string().max(512).optional(),
    trashed: z.boolean().optional(),
    pinned: z.boolean().optional(),
    sort: z.string().optional(),
  }),
  artifact_manage: z.object({
    action: z.enum([
      'create',
      'rename',
      'pin',
      'trash',
      'restore',
      'purge',
      'duplicate',
      'import',
      'asset-import',
      'asset-delete',
    ]),
    artifactId: id.optional(),
    artifactIds: z
      .array(id)
      .min(1)
      .max(100)
      .optional()
      .describe(
        'purge 批量永久删除的作品 ID，1..100 个。与单个 artifactId 二选一；只允许房主删除回收站内作品，返回 deletedIds 和逐项 failures。',
      ),
    type: id.optional(),
    title: z.string().max(200).optional(),
    pinned: z.boolean().optional(),
    archivePath: z.string().max(4096).optional(),
    assetPath: z.string().max(4096).optional(),
    assetId: id.optional(),
  }),
  artifact_read: z
    .object({
      artifactId: id,
      ...taskBinding,
      ...pagination,
      mode: z.string().min(1).max(64).optional(),
      operationId: id.optional().describe('operation-receipt 原操作 ID。'),
      operations: mutationOperations.optional().describe('operation-receipt 原有序操作。'),
      summary: z.string().max(500).optional().describe('operation-receipt 原操作摘要。'),
      merge: z
        .enum(['safe', 'same-generation'])
        .optional()
        .describe('operation-receipt 原合并策略。'),
      ids: z.array(id).optional(),
      atRevision: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('units 同步补读必须指定精确作品版本，配合 1 到 10 个 ids；版本已清理时报错。'),
      regionId: id.optional(),
      elementId: id.optional(),
      feedbackId: id.optional(),
      contextId: id.optional(),
      sourceRevision: z.number().int().positive().optional(),
      versionId: id.optional(),
      fromVersionId: id.optional(),
      toVersionId: id.optional(),
      adjacent: z
        .boolean()
        .optional()
        .describe('diff + versionId + adjacent 读取指定版的相邻差异。仅返回指定 ids。'),
      viewId: id.optional(),
      query: z.string().max(512).optional(),
      rect: rect.optional(),
      type: id.optional(),
      parentId: id.optional(),
      blockIds: z.array(id).optional(),
      itemIds: z.array(id).optional(),
      checked: z.boolean().optional(),
    })
    .loose(),
  artifact_apply: z.object({
    artifactId: id,
    ...taskBinding,
    operationId: id.optional(),
    expectedRevision: z.number().int().optional(),
    expectedVersions: z.record(z.string(), z.number().int()).optional(),
    merge: z
      .enum(['safe', 'same-generation'])
      .optional()
      .describe(
        'safe 安全合并过期的通用 update。same-generation 只用于 document 块和 todo 行，需提供每个区域原本的 expectedVersions，由服务端验证原版本、目标、父块和排位锚点的代次。文档仅自动合并独立修改，Todo 行的独立字段可合并。任一冲突整笔拒绝。缺省保持严格版本检查。',
      ),
    operations: mutationOperations,
    summary: z.string().max(500).optional(),
  }),
  artifact_feedback: z
    .object({
      artifactId: id,
      ...taskBinding,
      action: z.enum([
        'list',
        'get',
        'create',
        'reply',
        'edit',
        'delete',
        'resolve',
        'reopen',
        'send',
        'attached',
        'processing',
        'suggest',
        'preview',
        'choose',
        'withdraw',
      ]),
      feedbackId: id.optional(),
      replyId: id
        .optional()
        .describe(
          'reply 时可传稳定回复 ID，失败重试同 ID 和内容不会追加第二条；edit 时指定回复 ID，省略则编辑首消息。只能编辑自己的消息，delete 删除整个讨论且仅所有者或首作者可用。',
        ),
      expectedText: z
        .string()
        .max(20000)
        .optional()
        .describe(
          'edit 时传打开编辑器时的原始文字；已被同身份另一视图修改则 CONFLICT，保留双方内容，不盲目覆盖。',
        ),
      type: z.enum(['comment', 'request']).optional(),
      text: z.string().max(20000).optional(),
      anchor: anchor.optional(),
      versions: z
        .record(id, z.number().int().positive())
        .optional()
        .describe(
          'create 时提供全部锚点对象在选取时的 element.version；按该版本冻结原始对象/HTML。缺失、歧义或过期版本会拒绝；省略时兼容保存时快照。不同于修改用 expectedVersions。',
        ),
      targetViewId: id.optional(),
      requestId: id
        .optional()
        .describe(
          'attached 时必须提供 send 返回的 attachment.requestId；仅房主界面在宿主确认附加成功后回写，幂等且不解决备注。',
        ),
      operationId: id
        .optional()
        .describe(
          'create/choose 的稳定操作 ID；重试保留同一 ID 与内容。create 返回原 contextId，不重复创建；改变内容或选区版本须使用新 ID。',
        ),
      optionId: id.optional(),
      expectedRevision: z.number().int().optional(),
      expectedVersions: z.record(z.string(), z.number().int()).optional(),
      options: z
        .array(
          z.object({
            id: id.optional(),
            label: z.string().max(60),
            description: z.string().max(160).optional(),
            operations: z.array(operation).max(60),
          }),
        )
        .min(2)
        .max(4)
        .optional(),
    })
    .extend({ ...pagination, status: z.string().max(32).optional() }),
  artifact_share: z.object({
    artifactId: id,
    action: z.enum([
      'status',
      'start',
      'stop',
      'reset',
      'link',
      'role',
      'remove',
      'restore',
      'forget',
    ]),
    access: z
      .enum(['local', 'lan'])
      .optional()
      .describe(
        'start 的访问范围：local 只允许本机角色邀请，lan 允许局域网。省略保持 lan。切换范围保留角色邀请与成员；stop 才撤销全部邀请。',
      ),
    role: z
      .enum(['editor', 'commenter', 'viewer'])
      .optional()
      .describe('role/restore 必填；restore 的目标角色链接必须已启用。'),
    on: z.boolean().optional().describe('link 操作启用或关闭指定角色链接。'),
    memberId: id
      .optional()
      .describe(
        'role/remove 管理已加入成员。restore 按已启用角色恢复原浏览器访问。forget 只删除已移除成员及此板姓名登记；保留历史作者和其他白板，之后凭有效邀请重新输入姓名，新授权不会恢复移除前排队请求。',
      ),
  }),
  artifact_export: z.object({
    artifactId: id,
    format: z.enum(['json', 'html', 'svg', 'png', 'zip']),
    regionId: id.optional(),
    ids: z.array(id).optional(),
    rect: rect.optional(),
    atRevision: z.number().int().nonnegative().optional(),
    viewId: id.optional(),
    includeImage: z
      .boolean()
      .optional()
      .describe('局部 PNG 默认返回一张有大小上限的图像；只需导出引用时用 false。'),
    scale: z.number().min(0.1).max(4).optional(),
  }),
  artifact_activity: z.object({
    artifactId: id,
    action: z.enum(['begin', 'update', 'end', 'status', 'release']),
    ...taskBinding,
    taskId: id
      .optional()
      .describe(
        'begin 指定逻辑任务；status 可省略以列出自己的任务，或只给 taskId 查询本任务；update/end/release 同时需要 generation。',
      ),
    phase: z.enum(['preparing', 'writing', 'verifying']).optional(),
    outcome: z.enum(['completed', 'failed', 'cancelled']).optional(),
    targetActorId: id
      .optional()
      .describe(
        '房主界面 release 的目标 Agent actor.id，不是 participant.id；不能以目标身份冒充调用者。',
      ),
    scope: z
      .object({
        ids: z.array(id).min(1).max(200).optional(),
        rect: z
          .object({
            x: coordinate,
            y: coordinate,
            w: z.number().positive().max(10_000_000),
            h: z.number().positive().max(10_000_000),
          })
          .optional(),
      })
      .optional(),
    label: z.string().trim().min(1).max(80).optional(),
  }),
};
const descriptions: Record<ToolName, string> = {
  studio_open: `${STUDIO_DISPLAY_NAME} 的聊天标签页入口。由用户打开 ${STUDIO_HOME_TITLE} 首页或指定白板。该入口仅负责导航。`,
  artifact_list:
    '按名称、固定或回收状态查找作品。默认返回 10 条摘要，每页最多 20 条；使用 nextCursor 续读。',
  artifact_manage:
    '创建、重命名、固定、回收、恢复或复制数据库作品。旧版 JSON 作品显示 storageStatus:unsupported，仅支持移入回收站与 purge，无法打开、恢复、复制或编辑。purge 由房主永久删除已在回收站的作品，artifactId 或 1..100 个 artifactIds 二选一；先校验全部参数，再逐项返回 deletedIds/failures，不删除活跃作品。import 导入用户指定的本机数据库备份 ZIP；asset-import 导入用户明确指定或当前任务生成的本机媒体绝对路径，返回稳定资源引用；asset-delete 仅移除未被内容、历史或反馈引用的资源并保留内部回收副本。',
  artifact_read:
    '先查概要，再按目标读取。默认 summary；search 按板内 query 查找，region 以白板坐标 rect 查询。常规页默认 10 条、最多 20 条，使用 nextCursor 续页，作品变化后从首页定位。objects/units/diff 必须指定 1 到 10 个 ids；history 只返回提交摘要。文档正文用 blocks+elementId，Todo 用 tasks+elementId，可用 blockIds/itemIds/checked 缩小目标。source 选择具体 elementId 或 regionId，源码按 UTF-8 预算分段。context 指定 viewId、feedbackId 或 contextId，冻结源码再用 source 读取。taskId/generation 成对携带，只有读取命中任务范围才续活动。整板快照通过作品界面查看。operation-receipt 提供原 operationId、operations 和原 summary，只核对授权内的留存回执。缺证据时报告 COMMIT_RESULT_UNKNOWN。',
  artifact_apply:
    '以稳定对象 ID 批量局部修改白板。Agent真实内容写入必须携带有效taskId/generation并在声明范围内；人类界面不需要Agent任务。文档区域用 document 操作：id 指定区域，data.operations 为 insert/update/delete/move 块操作（insert 含 block，update 含 id/changes，move 含 id/parentId/afterId）；沿用区域 expectedVersions。任务清单用 todo 操作：id 指定清单，data.operations 逐行 insert/update/delete/move，insert 携带 item，update 携带 id/changes，move 使用 id/afterId；用 expectedVersions 检查清单版本。文档和任务清单需要显式使用 merge:same-generation 才尝试同代合并，普通请求保留严格版本检查。更改 HTML 使用 update.changes.html 并提供 expectedVersions；冲突后重读，不覆盖。locked 仅锁定几何，允许文字、样式、HTML 和 state 更新；移动、裁剪、删除及改变关联锁线前须独立明确解锁，同批解锁绕过会拒绝。layout preset=front/back/forward/backward 按 ids 调整对象层级。restore 指定 versionId 并形成新版本；附 id 或 ids 时只恢复所选内容单元，保留未选择的内容、样式与当前标题；仍须核对当前 revision 或全部目标版本，恢复不能绕过锁。data.mode=undo 安全撤回所选事务。',
  artifact_feedback:
    '创建或读取带原生对象、白板区域或 HTML 内部锚点的备注，支持回复、编辑自己的消息、删除整讨论、解决及私人建议。回复已解决讨论会重新打开；删除同时移除冻结来源，历史版本保留。create 用 versions 冻结选取时的原始对象/HTML，稳定 operationId 保证重试不重复；contextId 用于读取冻结来源。Agent选择或撤回已应用方案产生内容变化时也需有效taskId/generation。send 请求房主附加到对话；同一内容重试返回原 attachment.requestId，内容变化后生成新请求。attached 仅房主界面在宿主成功后按该请求回写；与备注解决和 Agent 处理状态独立。普通备注不自动授权修改。',
  artifact_share:
    '查询或管理分享及角色链接。start 默认局域网，access:local 只启用本机邀请；切换范围保留成员，stop 撤销全部授权；link 开关角色邀请，reset 使旧链接和对应授权失效；role/remove 管理成员并撤销原连接。restore 按已启用角色恢复原浏览器。forget 仅删除已移除成员和该板姓名登记，旧评论历史不变；之后需有效邀请重新输名，新授权不复活移除前排队请求。仅所有者可管理。',
  artifact_export:
    '局部导出须指定至多 10 个 ids 或一个 regionId，PNG 也可按世界坐标 rect 取图。atRevision 可指定保留的作品修订。图像标明渲染来源、范围和版次。富 HTML PNG 与整板备份请使用作品界面。',
  artifact_activity:
    'Agent声明非重叠白板任务，不锁住人类编辑。begin指定稳定participant/taskId、scope.ids或空地rect，返回generation；活跃同范围幂等，自行结束或过期后须带上一代明确重新申请，不自动续写。update/end带回同代绑定，phase为preparing/writing/verifying，end可标completed/failed/cancelled。status查询自己的active及有界结束记录，不续租，可只给taskId恢复丢失回执。活动租约10分钟，2分钟无实质进展变灰保留；重复心跳不伪造进度。release仅房主界面按targetActorId/taskId/generation结束具体任务，Agent不能抢释放别人或重新申请该被释放任务。范围不授予额外权限，不绕过CAS、锁或正在编辑检查。',
};

export function createStudioServer(
  executor: StudioExecutor,
  html: string,
  createSpool?: AppTransferSpoolFactory,
) {
  const server = new McpServer({
    name: 'luming-studio',
    title: STUDIO_DISPLAY_NAME,
    version: PLUGIN_VERSION,
    icons: [STUDIO_ICON],
  });
  const uri = 'ui://luming-studio/app';
  const readOnlyTools: readonly ToolName[] = [
    STUDIO_TOOLS.open,
    STUDIO_TOOLS.list,
    STUDIO_TOOLS.read,
  ];

  for (const name of TOOL_NAMES) {
    server.registerTool(
      name,
      {
        title: name === STUDIO_TOOLS.open ? STUDIO_DISPLAY_NAME : descriptions[name].split('。')[0],
        description: descriptions[name],
        inputSchema: schemas[name].extend({ participant }),
        annotations: {
          readOnlyHint: readOnlyTools.includes(name),
          destructiveHint: name === STUDIO_TOOLS.manage,
          openWorldHint: name === STUDIO_TOOLS.share,
        },

        ...(name === STUDIO_TOOLS.open
          ? {
              _meta: {
                ui: { resourceUri: uri, visibility: ['app'] },
                'openai/ui': { entrypoints: [{ type: 'thread' }] },
              },
            }
          : {}),
      },
      async (input: unknown) => {
        try {
          const request = boundedModelRequest(name, input as Record<string, unknown>);
          const response = await executor.execute(name, request, {
            clientInfo: server.server.getClientVersion(),
          });
          const { data, image } = modelResponseParts(name, request, response);
          return {
            content: image ? [{ type: 'image' as const, ...image }] : [],
            structuredContent: { ok: true, data: boundedModelResult(name, request, data) },
            ...(name === STUDIO_TOOLS.open
              ? { _meta: { connection: await executor.connection() } }
              : {}),
          };
        } catch (error) {
          const failure = error as Error & { code?: string; details?: unknown };
          const message = Array.from(failure.message || 'Studio 操作失败')
            .slice(0, 512)
            .join('');
          const details =
            failure.details && modelDataFits(failure.details, 8 * 1024)
              ? { details: failure.details }
              : {};

          return {
            isError: true,
            content: [{ type: 'text' as const, text: message }],
            structuredContent: {
              ok: false,
              error: { code: failure.code || 'STUDIO_ERROR', message, ...details },
            },
          };
        }
      },
    );
  }
  const appTransport = createAppTransport((request, signal) => {
    if (!executor.requestUi) {
      throw Object.assign(new Error('作品界面传输不可用，请更新插件后重试。'), {
        code: 'UNAVAILABLE',
      });
    }

    return executor.requestUi(request, signal);
  }, createSpool);
  server.registerTool(
    APP_TOOL_NAME,
    {
      title: '作品界面传输',
      description: '仅供作品界面访问当前本机作品服务；完整文档和文件字节不进入模型内容。',
      inputSchema: z.union([
        appTransportSchema,
        z.object({ action: z.literal('connect') }).strict(),
      ]),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ['app'] } },
    },
    async (input, extra) => {
      try {
        extra.signal.throwIfAborted();
        if (input.action === 'connect') {
          return {
            content: [],
            structuredContent: { ok: true },
            _meta: { connection: await executor.connection() },
          };
        }

        return {
          content: [],
          structuredContent: { ok: true },
          _meta: { response: await appTransport.execute(input, extra.signal) },
        };
      } catch (error) {
        const failure = error as Error & { code?: string };
        return {
          isError: true,
          content: [],
          structuredContent: {
            ok: false,
            error: { code: failure.code || 'STUDIO_TRANSPORT_ERROR', message: failure.message },
          },
        };
      }
    },
  );
  server.registerResource(
    'studio-ui',
    uri,
    { title: STUDIO_DISPLAY_NAME, icons: [STUDIO_ICON], mimeType: 'text/html;profile=mcp-app' },
    async () => ({
      contents: [
        {
          uri,
          mimeType: 'text/html;profile=mcp-app',
          text: html,
          _meta: {
            ui: {
              permissions: { clipboardWrite: {} },
              csp: {
                connectDomains: [],
                resourceDomains: ['data:', 'blob:'],
                frameDomains: ["'self'", 'blob:', 'data:'],
              },
              prefersBorder: false,
            },
            'openai/ui': {
              preferredDisplayMode: 'fullscreen',
              availableDisplayModes: ['inline', 'fullscreen'],
            },
          },
        },
      ],
    }),
  );
  const originalClose = server.close.bind(server);
  server.close = async () => {
    await appTransport.close();
    await originalClose();
  };

  return server;
}
