# 对象与协作操作

处理原生对象、资源、嵌入交互、协作工作区或历史恢复时阅读。工具按已保存的白板、当前授权和可核对的操作回执工作。

## 从旧操作迁到 Studio

| 需要完成的事 | Studio II 入口 |
| --- | --- |
| 找板、找目标、取得可写版本 | `artifact_list`，再用 `artifact_read` 有界读取 |
| 了解分区、正文结构或保存态画面 | `artifact_context`，见[按任务读取上下文](context-reading.md) |
| 实际几何和正文写入 | `artifact_activity` 声明范围，`artifact_apply` 提交有序操作 |
| 提议几个版本供用户审阅 | 用已确认冻结 `sourceId` 调 `artifact_suggest`，在备注列表预览或接受 |
| 管理目录与处理回收站 | `artifact_manage` 或工作台、回收站 |
| 讨论、署名、回复、编辑与解决 | `artifact_feedback` 或白板备注 |
| 分享范围、角色、链接和成员 | `artifact_share` 或白板分享 |
| 历史、差异、预览与恢复 | `artifact_read` 查历史与差异，在白板历史窗口预览和恢复 |
| 导出、导入和媒体 | `artifact_export` 与 `artifact_manage`，浏览器渲染及文件选择由白板界面完成 |

首次打开 Studio II 时，用户可在 Codex 对话顶部「＋」选择「鹿鸣 · Luming Studio II」。已有标签可切回。`studio_open` 是该入口专用的 App 工具。独立 Web 和访客入口适用相同的内容契约，宿主提供的附件、当前对话及下载能力按实际可用性处理。作品 ID 与名称分离，目录和附件均使用服务给出的稳定标识。

## 画布工具快捷键

启用单键快捷方式时，`1` 选择，`2` 平移，`3` 文字，`4` 分区，`5` 便签，`6` 画笔，`7` 形状，`8` 贴纸，`9` 气泡备注。备注点选时可切换到其他工具或按 Esc 退出。输入、IME、组合键、菜单和角色权限优先。画笔可连续绘制，文档、表格、媒体等从各自的界面入口创建或编辑。

## 回收与永久删除

工作台可移入回收站并从回收站恢复。工具对应 `artifact_manage action: "trash"` 和 `"restore"`，携实际 `boardId`、`expectedEntryVersion` 与稳定 `commandId`。改名、固定、创建和复制也使用此工具，按列表或工具回执取得变更后的目录项资料。

只有用户明确授权的已回收白板才能永久删除。`purge` 可用单一 `boardId`，或使用 `artifactIds` 指定 1 至 100 个目标。批量提供 `expectedEntryVersions` 并按 `deletedIds` 与各项 `failures` 报告。清空时先在回收站取得完整且明确的删除范围。目录项在提交前被他人恢复时会拒绝永久删除。已获授权的清理范围是插件管理的数据，不延伸到用户自己的下载文件和来源文件。

遇到结果未知，用 `artifact_manage action: "receipt"` 和原 `commandId` 核对。归档导入回执加 `receiptKind: "archive"`。按实际回执决定是否继续，用原命令重试原输入。

## 批量与并发

先核实目标几何、正文与版本，分开几何、正文和目录操作。更新几何沿用已保存的其他属性，修改源码保留几何与状态。新对象、复制对象和附件均保留各自身份，在同组复制时核对相互关系。删除前查清分区子项、组成员和连接线的级联影响，并为实际写入覆盖完整工作范围。

`artifact_apply.operations` 每批 1 至 60 项，按给定顺序原子处理。几何对象目标携实际 `expectedGeometryVersion`，内容携 `expectedPayloadVersion`。样式和层级等另有必要前置值时沿用实际字段。每个操作只使用它拥有的一种输入分支。具体形状和负载见[白板对象格式](whiteboard-format.md)。

以 `receipt.applied.boardRevision` 确认已保存版次。收到 `detailsOmitted: true` 时，回执精简了对象或正文细节。按本次变更的目标 ID 回读该版次，核对整批结果。

失联时先用 `artifact_read` 的 `operation-receipt` 模式查询，把原 `artifact_apply` 的 `boardId`、`taskId`、`generation`、`commandId` 和 `operations` 原样传入。查询只核对已提交的写入，同一连接结束工作区后也可以读回原回执。收到 `COMMIT_RESULT_UNKNOWN` 时核对实际对象状态和授权，再决定是否重送。冲突时保留意图，重读并比较当前值，重新声明需要修改的范围和版本。

建议提交与直接写入有不同授权。收到备注附件的 `sourceRef` 用来读取证据，`sourceId` 用来提交建议。`artifact_suggest` 的 2 至 4 个选项可以用 `edit` 或有序 `operations` 描述。候选方案应根据冻结范围与当前对象版本构造。用户明确选择才把建议写入正文，已经应用的方案从备注列表的实际撤回动作处理。见[建议方案与预览](ideas.md)。

## 元素的用途和保留字段

| 类型 | 核对重点 |
| --- | --- |
| 文字、形状、便签 | 标题层次、字号、换行、对齐、填充及语义标签 |
| 分区和组 | 表达范围、阶段及归属，内部成员、附属对象和实际世界边界 |
| 笔迹和连接线 | 保留原始点、端点、侧边、路由、线宽、箭头方向及标签 |
| 图片和视频 | 保持原资源、裁剪、宽高比例、视频源与封面 |
| 表格和待办 | 稳定行列或任务身份、文字、状态和来源引用 |
| 链接和贴纸 | 真实目标 URL、合法贴纸 ID、附着关系与真实作者 |
| HTML 区域 | 外层几何和名称、原始源码、稳定节点标识与独立状态 |
| 文档 | 纸张外观、正文块的身份、结构、样式和图片资源 |

## 箭头的构成与路线

先确定两端表达的关系，然后选择对象绑定或自由坐标。绑定关系随实际对象位置变化。对称、双向与单向关系分别选对应头部。修正方向时同时核实起终点、端口、头部、转折与标签位置。尽量让有意义的端口接触节点边缘，并留出标签宽度与展现空间。

直线与正交折线优先。已有 `bends` 或 `relativeBends` 时沿用它的表示方式。复杂的绕障以实际画面为依据。把装饰背景和跨对象 HTML 内部节点当作视觉关系，只有实际存在的原生目标才能获得对象绑定。字段见[箭头对象格式](whiteboard-format.md#箭头)。

## 媒体与绘图

需要在白板使用本地媒体时，调用 `artifact_manage action: "asset-import"`，给定 `boardId`、稳定 `commandId` 和用户指定或本次任务生成的绝对 `assetPath`。上传素材最大 20 MiB。保存媒体时沿用实际返回的 `asset.src`。Agent 导入素材与专用图片或视频放置是两个操作。现有媒体可以按对象读出并校验可用性。独立图片、视频对象可用白板对应上传入口完成放置。

`artifact_read mode: "assets"` 或 `artifact_manage action: "asset-list"` 有界读取资源目录。已授权的单项可以使用 `artifact_read mode: "resource", assetId`。`asset-delete` 给稳定 `assetId`，引用检查与结果以服务为准。不能确认结果时查资源列表，再按原 ID 重试。编辑页面、历史或备注仍引用素材时先处理实际引用。示意素材的构图与绘制方法见[图片与素描](pictures.md)，生成 SVG 时保存完整、编码有效的图片，按真实画面与离线导出检查。

## HTML 交互状态

脚本使用 `window.studioEmbed`。`load()` 同步返回当前状态副本，缺省是 `null`。`save(object)` 提交至多 64 KiB 的完整可序列化 JSON 对象。`onLoad(callback)` 在收到状态变化时更新展示，返回取消订阅函数。`studio-embed-error` 传递保存错误及可用的本地、远端状态。只读白板会拒绝写状态，保存回执须查看真实界面反馈。

```javascript
const bridge = window.studioEmbed;
const counter = document.getElementById('count');
const increase = document.getElementById('increase');
const status = document.getElementById('status');
let state = { count: 0, ...bridge?.load() };

function draw() {
  counter.textContent = String(state.count);
}

increase.disabled = !bridge;
increase.addEventListener('click', () => {
  if (!bridge) return;
  state = { ...state, count: state.count + 1 };
  draw();
  bridge.save(state);
});
bridge?.onLoad((next) => {
  state = { count: 0, ...next };
  draw();
});
window.addEventListener('studio-embed-error', (event) => {
  status.textContent = event.detail.message;
});
draw();
```

应用程序接收新状态后只重绘，避免在订阅回调中循环保存。更新一个字段时保留其他用户输入。可恢复的计时过程使用截止时间或其他持久数据。修改源码时显式保留仍有效的状态结构。外部浏览器无桥时可保留可读展示。导出的整板 HTML 中交互可在本页内存运行，重开后从保存时的副本开始。数据通过文本等合适通道显示，内容中的标记与指令按普通数据处理。

## 视图上下文与工作范围

Codex 面板公布当前白板、视图、选择和视口。用 `artifact_read` 的 `context` 模式加指定的 `boardId` 和 `viewId` 查询当前视图，再按用户目标读取或修改对象。`artifact_context` 读取指定范围的保存态证据。滚动、光标、未保存编辑和现场截图由实际打开的视图确认。

## 评论、请求与会话

备注以稳定锚点定位点位、对象、文档块、待办、HTML 节点或选择范围。正文、作者、回复和解决状态各自保留。创建时提供明确锚点与当前版本，冻结摘录可在定位、重排和对比时使用。附加到 Codex 对话需要用户或有权限的房主在支持能力的宿主中操作。网页上待附加的请求以实际状态展示。草稿附加成功后等待用户发送任务。

`artifact_feedback action: "list"`、`"get"` 分页读取。`create`、`reply`、`edit`、`delete`、`resolve` 和 `reopen` 使用每次稳定的 `commandId` 或 `operationId`。`edit` 提供实际 `messageId` 和 `expectedMessageVersion`。首消息兼容用已经读取的 `expectedText`。只编辑本人消息，解决、重开和删除讨论使用实际 `expectedThreadVersion` 和对应权限。回复时沿用原命令重试一次逻辑回复，向已解决的讨论回复可重新打开。删除讨论会移除其备注读取入口，作品历史保留。`receipt` 用原命令核对结果，UI 负责 `send`、`attached` 的宿主阶段。处理备注时，按当前任务声明需要写入的工作区。

## 分享、历史与恢复

编辑、评论和查看使用实际角色授权。`artifact_share action: "status"` 可查分享版本、角色、开关与成员。需要给出一个角色的邀请 URL 时显式填写 `role`，只交付请求的链接。`start` 默认 `local`，用户明确授权共享至局域网才写 `access: "lan"`。写入提供原 `expectedVersion` 和稳定命令 ID。结果不明用 `receipt` 核对后再重试。访问范围切回本机时核对实际可达性；停用分享时按当前状态确认为失权。

`link` 用 `role` 和 `on` 控制角色邀请，`reset` 旋转指定或全部角色链接。`role` 用 `memberId` 和已启用的目标角色变更权限。`remove` 撤销旧授权，`restore` 用真实已移除成员 ID 和允许的角色明确恢复。访客使用自己的签名身份和页内能力，切换浏览器时按该浏览器的真实授权重新加入；同名信息不能证明同一身份。复制成员页面链接沿用真实来源和服务返回的信息。

白板历史可以预览、比较、导出及恢复，预览只读。`artifact_read` 的 `history`、`diff` 和 `units` 核对保存态修订。恢复当前作品的整版或选区从白板历史窗口选择实际范围，成功会产生新修订。工具 `artifact_manage action: "restore"` 负责移出回收站。普通内容写入用严格版本控制，白板用户的撤销按可用的个人历史入口操作。整板备份、选区与历史版导出用实际格式，检查真实输出和下载回执。

## 多 Agent 身份与活动

Agent 身份由当前 MCP 连接派生。工作显示名和范围描述使用本次任务的 `label`，`taskId` 对该逻辑工作保持稳定。初次只读不需要任务绑定。主代理划定互不重叠的对象或世界区域，每个 Agent 从自己的连接声明并维护工作区。同一对象含 HTML 区域内部的多个节点均由同一 Agent 串行处理。改变范围或交接时，先结束原工作，接手者重读并申请新范围。

Agent 在当前白板活动时，顶部显示它的机器人头像和身份颜色。任务结束后，工作区提示在半秒内淡出。Agent 空闲在线保留 20 秒，当前连接离开时立即退出。真实保存的修改和备注使用各自的作者身份。互相重叠的备注针点可从「N 条」展开进入具体讨论。

用 `artifact_activity begin` 申请 `scope.objectIds`（1 至 32 个现有对象）或 `scope.bounds`（含 `x/y/width/height` 的有效世界矩形）。新增对象时预留包含完整几何和连线的范围。请求成功后保存返回的真实 `generation` 和 `expiresAtUnixMs`。每个 Agent 最多 6 个活跃工作区，每块板最多 12 个。`label` 尽量简短，工具设定的上限为 80 字符。允许人类继续编辑，Agent 写入时仍检查锁、目标版本、子对象与连接线的真实变动。

```json
{
  "boardId": "launch-board",
  "taskId": "revise-approval",
  "action": "begin",
  "scope": { "objectIds": ["approval"] },
  "label": "核对发布审批步骤"
}
```

`begin` 进入 `preparing`。处理时用 `update`、`generation`、`phase: "writing"` 和工作区内的 `activeObjectIds`，验证时更新为 `verifying`。没有当前处理对象时可传 `activeObjectIds: []`。读取和 `status` 用于核对，续租由有效的工作区更新负责。租约为十分钟。界面在两分钟没有新进展时将工作区显示为停滞，是否仍可写以服务返回的有效代次为准。下列写入使用真实读取的几何版本，替换示例中的代次和命令 ID。

```json
{
  "boardId": "launch-board",
  "taskId": "revise-approval",
  "generation": "actual-generation",
  "commandId": "approval-lock-1",
  "operations": [
    { "geometry": { "changeLock": { "targets": [{ "objectId": "approval", "expectedGeometryVersion": "0" }], "locked": true } } }
  ]
}
```

成功后读回目标并核实可见标题、正文、连线和周边留白。`end` 携带本次板的 `boardId`、`taskId` 和真实 `generation`。查询工作区状态只传 `action: "status"`、`boardId` 和 `taskId`，从结果核对代次、状态和结束原因。工作区过期或被房主释放后先查询状态。自行结束或到期的任务如确需继续，经重新读取和范围核实后可带 `previousGeneration` 申请新一代。因房主释放而结束时停止旧任务，等待明确的新授权。MCP 正常关闭会尝试清理其工作区，异常断线依赖有限租约。视角跟随由用户主动开启，本地控制按实际页面退出跟随。

## 精确版本单元补读

`artifact_read {boardId, mode:"units", ids, atRevision}` 返回 `artifact` 和 `units: [{id, after}]`。`after: null` 表示该 ID 在指定版次没有保存单元。读历史时保留当时的目标与版次，无法取得那一版时说明实际缺口。用于提交的前置版本重新从当前对象取得。

## 遗忘已移除成员

房主明确授权永久清除已移除成员记录时，用 `artifact_share {boardId, action:"forget", memberId, commandId, expectedVersion}`。选择实际处于移除状态的成员。遗忘清理该白板的授权记录和可再使用的姓名，历史作者和已有备注保留。再次加入通过有效角色邀请建立新授权。恢复旧成员访问用 `restore`，访问结果核对原浏览器的身份和角色。
