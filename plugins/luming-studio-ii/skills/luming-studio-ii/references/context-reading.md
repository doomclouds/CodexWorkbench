# 根据任务读取白板上下文

先确定白板和范围。只有板名时用 `artifact_list` 查找。已有对象、分区或区域时直接使用其 ID 或坐标。收到备注附件时可把其中的 `sourceRef` 原样交给 `artifact_context`，工具会检查当前读权限，并使用备注记录的目标和版次。

## 选择范围与表示

| 用户的问题 | 建议范围与 `include` |
| --- | --- |
| 「这块板在讲什么？」 | 整板，先取 `overview`。从纲要确定相关分区，再取正文 |
| 「这个分区有哪些发布风险？」 | 以 `sectionId` 读取分区与子对象，组合 `overview`、`text`。按需追加 `structure` 核对数据 |
| 「查清表头、事项状态或流程节点关系」 | 限定对象 ID，取 `structure`。表格保留单元格类型，Todo 带事项 ID 和状态，连线带起终点及端口 |
| 「看看保存后布局或颜色」 | 用对象或区域范围请求 `preview`。结果随保存版次固定，区域会选出相交对象，按导出边界呈现 |
| 「查看图片本身」 | 显式选一个图片对象请求 `image`。视频对象有本地封面时可返回保存的封面 |
| 「帮我看这份 HTML 的源代码」 | 显式选一个嵌入对象请求 `source`。`text` 提取已保存标记中的正文。样式和脚本绘制的画面用 `preview` |

`scope.kind` 可为 `board`、`section`、`objects` 或 `region`。分区参数为 `sectionId`，对象参数为 `objectIds`，区域的 `bounds` 包含世界坐标 `x`、`y`、`width`、`height`。省略范围时读取整板，省略 `include` 时只返回概要。

理解一个分区可传入以下参数。把示例 ID 换成当前白板的实际 ID。

```json
{
  "boardId": "launch-board",
  "scope": { "kind": "section", "sectionId": "launch-risks" },
  "include": ["overview", "text", "structure"]
}
```

理解一条备注引用的保存态段落可传入以下参数。

```json
{
  "sourceRef": {
    "kind": "feedback",
    "boardId": "launch-board",
    "feedbackThreadId": "risk-note"
  },
  "include": ["text", "structure"]
}
```

## 读取证据与继续查询

- `structuredContent.data` 提供白板、范围、已保存 `revision`、对象和来源。对照 `returned` 与 `missing` 确认实际得到哪些表示。`content` 承载请求的文字、源码和真实图像。标题和对象名称只用于定位。
- 一页默认 8 项，可以用 `pageSize` 请求 1 至 12 项。继续时沿用白板、范围和 `include`，将 `nextCursor` 放入 `cursor`。游标保持同一保存版次。指定已知版次时用十进制字符串作为 `revision`。使用 `sourceRef` 时由备注自身确定目标与版次。
- 正文、结构和源码有各自的摘要上限。需要完整原文时按对象或内容单元续读。源码给出 `source.revision`，`source.truncated` 说明是否只取得前缀。读到正文版本变化或缺失时先看 `missingPayloadIds`，再按业务需要读取当前或仍保留的版本。
- `browserRequired` 表示该保存态预览需要白板端渲染。若任务确实需要画面，可在白板或对应历史版本中选中目标后导出 PNG。保存版次已被清理时，有冻结摘录的备注仍可用该摘录作当时的证据。需要核对此刻画面时，使用用户指定视图提供的截图能力。该视图缺少截图入口时，请用户附上当前画面。
- `image` 从当前白板授权的存储读取一张源图或视频封面，每张直返图片的上限为 640 KiB。若需要超限的完整本机素材，按[有界读取与局部取图](agent-reading.md#版本权限和来源)核对可用的资源读取路径。外部链接按用户任务另行处理。

用户要求修改时，用对象 ID 定位后调用 `artifact_read` 取得当前原始对象、内容单元及对应版本。提交待审阅建议时使用附件提供的 `sourceId`。备注的 `sourceRef` 用于理解原证据。
