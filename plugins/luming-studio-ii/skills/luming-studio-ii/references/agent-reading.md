# Agent 有界读取与局部取图

## 先定位再读取

1. 优先沿用用户明确给出的白板、对象、内容单元或备注 ID。只有板名时，用 `artifact_list` 的 `query` 查找。用返回的 `nextCursor` 继续原查询。出现多个实质不同的候选时先定位正确作品。
2. 用 `artifact_read` 的 `summary` 看保存态的对象标签、版本和世界坐标。按内容找目标用 `mode: "search"` 和 `query`，已知范围用 `mode: "region"` 和 `rect: {x, y, w, h}`。概要、搜索和区域页都可加 `type`、`parentId` 或 `ids` 缩小范围。搜索摘要只用于定位。
3. 用 `mode: "objects"` 和 `ids` 读取真正要修改的对象。`items[]` 含 `id`、`object` 元数据和 `payload`。检查 `missingIds`。文档用 `blocks` 和 `elementId`，待办用 `tasks` 和 `elementId`，可用 `blockIds`、`itemIds` 或 `checked` 精读。HTML 原始源码用 `source` 和 `regionId`。已知那一版源码时可加 `sourceRevision` 核对。
4. 本次确需直接写入时，按[工作区流程](operations.md#多-agent-身份与活动)声明对象或区域。读取当前对象的 `geometryVersion`、`payloadVersion` 及所需源码修订后提交。保存后按目标 ID 读回实际效果。读取调用本身不接受任务绑定，也不续租。

`artifact_read` 用 `boardId` 定位白板，`artifactId` 是同值别名。`elementId` 和 `regionId`、`feedbackId` 和 `contextId` 也分别为同值别名。每次具体对象、差异单元、段落或任务 ID 至多 10 个。普通页默认 10 项，`limit` 最多 20 项。用 `nextCursor` 继续时保留原范围、模式、版本和页大小，只有 `cursor` 改为上次返回值。遇到 `CURSOR_STALE` 时从明确目标的第一页重定位。需要追溯时填写仍保留的 `atRevision`。若特定保存版次不可用，确认是否允许使用其他版次。

```json
{
  "boardId": "launch-board",
  "mode": "objects",
  "ids": ["release-flow"],
  "limit": 1
}
```

工具对返回 JSON 按 UTF-8 字节限制。搜索最多 8 KiB，概要、区域、历史与资源列表最多 16 KiB，多数原文或对象结果最多 32 KiB。长 HTML 或 JSON 原文使用 `source`。按 `offset` 顺序拼接返回的 `html` 或 `json` 字符串片段，使用 `nextCursor` 继续到末页，并核对同一 `length` 与版本。`offset` 和 `length` 是字符串位置。大单项对象响应超限时，改读对应 `source`、`blocks` 或 `tasks`。搜索不会执行网页脚本，运行后生成的文字以用户实际画面为准。

需要理解整板、分区关系、文本或预览时，使用[按任务理解白板](context-reading.md)。`artifact_context` 的 `sourceRef` 可以来自 Codex 附件，`include` 用于选择所需表示。用于修改的完整原始对象、块和版本从 `artifact_read` 获得。

## 版本、权限和来源

- `history` 从最新一页返回修订摘要。读取差异用 `mode: "diff"`，指定 `fromVersionId`、可选 `toVersionId` 与 `ids`。不填终点时对照当前已保存版次。相邻差异用 `adjacent: true`、`versionId` 和 `ids`。版本 ID 可取历史结果返回的值。
- `mode: "units"`、`ids` 和 `atRevision` 读取确切修订的局部内容。`units[].after: null` 表示该 ID 在该版不存在。差异以 `units[].before` 和 `after` 返回有变动的单元。整板历史预览与恢复使用白板界面。
- 备注冻结锚点用 `mode: "context", feedbackId`。后续 `blocks`、`tasks`、`source` 可以沿用 `feedbackId`，并显式指定该锚点所属对象。对象或内容单元超出备注冻结范围时会被拒绝。冻结摘录保留当时证据，当前正文与版本需要另读。
- 房主可用 `mode: "assets"` 查询素材元数据。以返回的 `assetId` 用 `mode: "resource"` 分页读取已授权素材字节，响应 `base64` 按 `offset` 拼接。用 `nextCursor` 继续同一素材。需要理解图片时先在 `artifact_context` 范围内请求 `image`。
- `artifact.revision` 属于整板，`geometryVersion` 属于对象几何和相关元数据，`payloadVersion` 属于正文，`sourceRevision` 属于 HTML 源码。`entryVersion` 属于工作台目录项，`generation` 属于工作区。用各自的真实版本核对对应操作。

## 取图

- **已保存版次的图像**可用 `artifact_export` 的 `format: "png"`。局部取图任选 `ids`、单个 `regionId` 或世界坐标 `rect: {x, y, w, h}`。用 `scale` 设置 0.1 至 4 倍输出像素。对照历史时用 `atRevision`，固定当下可用 `expectedRevision`。小于或等于 768 KiB 的局部 PNG 默认可随 `content` 返回图像，`includeImage: false` 只需要文件回执。实际已有文件时 `structuredContent.data.kind` 为 `file`，带版次、文件名和 `downloadPath`。
- **需要浏览器渲染的保存内容**会返回 `browserRenderRequired`，并给出渲染所需的范围和尺寸。脚本图解、媒体和表格要检查实际图像或文件。`artifact_context` 的区域 `preview` 会按碰到的对象选取保存态内容，输出范围随实际对象导出边界确定。
- **用户当前画面的真实像素**包含当前缩放、滚动、选择和工具状态。用 `artifact_read` 的 `context` 模式加明确的 `boardId` 和 `viewId` 读取已同步视图的相机、选区及聚焦对象。视图关闭、过期或尚未同步时会返回 `LIVE_CONTEXT_REQUIRED`。需要现场像素时，使用该视图明确提供的截图能力。
