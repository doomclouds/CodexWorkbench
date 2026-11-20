# Agent 有界读取与局部取图

## 先定位再读取

1. 有用户提供的白板、对象、选区或反馈引用时，沿用其 ID。只有作品名称时，通过 `artifact_list` 的 `query` 定位。
2. 用 `artifact_read` 的 `summary` 看对象标签、版本和世界坐标。需要找板内文字时，用 `mode:"search",query:...`。已有世界坐标时，用 `mode:"region",rect:{x,y,w,h}`。两者均可再用 `type`、`parentId` 或 `ids` 缩小范围。
3. 找到目标后，用 `mode:"objects",ids:[...]` 读对象字段。大字段会给出 `omittedFields` 或 `readWith`。文档用 `blocks+elementId`，Todo 用 `tasks+elementId`。用 `blockIds`、`itemIds` 或 Todo 的 `checked` 过滤。HTML 源码用 `source+regionId`，已知源码版本时带 `sourceRevision`。
4. 只为本次变更读取所需内容。编辑前声明任务范围，提交范围内的对象变更与预期版本，随后按变更 ID 回读。草稿、焦点和滚动不参与后台取数。

普通页默认 10 项，最多 20 项。具体对象、内容单元、段落或任务 ID 每次最多 10 个。继续读取时传上页 `nextCursor`，保持原查询范围。收到 `CURSOR_STALE` 后，从第一页重新定位；有明确 `atRevision` 时可读取该仍在保留期内的版本。收到 `VERSION_NOT_FOUND` 时确认新版，避免自动用最新内容替代旧版。

返回上限按 UTF-8 字节计量。作品列表和板内搜索最多 8 KiB，概要、区域、历史和资源页最多 16 KiB，其余结构化结果最多 32 KiB。源码单页另有硬上限；有 `nextCursor` 就按需要继续。涉及整段源码替换时，先获得目标版本的完整原始源码再构造修改。

## 版本、权限和来源

- `history` 从最新一页返回提交摘要，每页最多 20 条。查看两个版本的局部差异，传 `mode:"diff"`、`fromVersionId`、`toVersionId` 与目标 `ids`。查看指定提交前后的相邻差异，用 `adjacent:true`、`versionId` 与同样的 `ids`。
- 需要核对特定修订的内容单元时，传 `mode:"units"`、`atRevision` 和 `ids`。整板快照与完整 ZIP 备份从作品界面查看和导出。
- 反馈的冻结来源通过指定的 `feedbackId` 或 `contextId` 读取。资源元数据仅房主可查。已保存内容和实时视图都按当前调用权限读取。

## 取图

读取**已保存版本的局部渲染**时，调用 `artifact_export`，选择 `format:"png"`，并在 `ids`、`regionId`、`rect:{x,y,w,h}` 中指定一项。需要对照时用 `atRevision` 固定保存版本。响应中 `source:"saved-render"` 指明来源，并带 `revision`、`bounds`、像素尺寸及下载引用。图像最多 1 MP 和 1 MiB。仅需要下载引用时用 `includeImage:false`。

后台渲染使用白板保存的数据和本地资源。遇到 `EXPORT_BROWSER_REQUIRED` 时，用户可从作品界面查看或导出富 HTML 的显示结果。自动取图只走允许的现有视图能力，按目标缩小范围。

读取**用户当前画面的真实像素**时，先从用户提供的宿主上下文拿到明确的 `viewId`，用 `context+viewId` 核对作品和目标视图，再在用户已经打开、允许截图的宿主或浏览器表面确认同一视图。可检查页面上的 `data-studio-view-id`。当前视图快照可能包含临时选择、实际滚动和界面状态。单靠已保存渲染无法证明这些信息。

模型导出带 `viewId` 会提示 `LIVE_CAPTURE_REQUIRED`。Studio 不会为查看或取图把标签切到前台。实际宿主工具如不支持目标页面的截图或裁剪，说明缺口，并按任务选择已有界面查看、局部已保存图像或对象数据核验。
