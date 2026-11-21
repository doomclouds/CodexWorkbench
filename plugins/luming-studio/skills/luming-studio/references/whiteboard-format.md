# 白板对象格式

直接生成或修改原生对象时读取。本页描述当前白板产品，其他产品由各自适配器定义内容和操作；不要把这些字段当作 Studio 所有产品的公共结构。专业图解优先按任务使用 HTML Region；Diagram Design 可用时读取它的规范，不在此复制图种手册。

## 读取和提交

`artifact_read` 默认返回有界概要。用 `mode: "objects", ids: [...]` 读取最多 10 个目标对象的元数据及可用字段。需要 HTML 原始源用 `mode: "source", regionId: ...`。源码替换前通过 `nextCursor` 逐页取得完整目标版本。 [先定位再读取](agent-reading.md#先定位再读取)

首次发现可以不带任务只读；开始修改前，按[对象与协作操作](operations.md#多-agent-身份与活动)声明非重叠范围，保存实际返回的taskId/generation。每笔Agent内容提交都显式携带该绑定，CAS和对象版本仍另行检查；人类界面不需要Agent任务。

`artifact_apply` 的 `operations` 是一笔事务：

- `add` 携带新对象 `element`。为新对象提供不冲突的稳定 `id`；不从标题或用户路径猜 ID。
- `update` 携带已有 `id` 和部分 `changes`。已有对象必须提供从实际读取结果取得的 `expectedVersions`，或使用最新整作品 `expectedRevision`。
- `delete` 携带 `id` 或 `ids`；删除节点连带的箭头也在版本检查范围内。
- `layout` 携带 `ids`、`preset: "row" | "column"`，或默认网格；`data.x/y` 指定起点。
- `style` 携带 `style` 中实际改变的语义颜色和字体。整作品操作使用最新 `expectedRevision`。
- `restore` 携带历史 `versionId`，恢复生成新版本；`data.mode: "undo"` 安全撤回这笔修改。

发生错误时整笔操作不半应用。写入重试保留 `operationId`。`locked` 固定位置、尺寸、旋转、连接几何和裁剪，删除或改变这些字段前需用户明确解锁；文字、样式、HTML 源和交互 `state` 仍可局部更新，不为内容修改解锁。同一事务内先解锁再移动或删除会被拒绝，不能用重建对象绕过。返回的版本以程序确认值为准，不自行加一后假定其他内容未变。

以下是最小的原生对象组合；先begin预留覆盖这些对象的空地（例如x40,y120,w640,h200），再使用返回代次。示例ID仅用于展示，实际使用前查重：

```json
{
  "artifactId": "工具返回的作品ID",
  "taskId": "本次明确申请的任务ID",
  "generation": "begin返回的实际generation",
  "participant": { "id": "flow-builder", "name": "Agent A" },
  "operationId": "本次稳定操作ID",
  "operations": [
    { "op": "add", "element": { "id": "input", "type": "shape", "kind": "rounded", "x": 80, "y": 160, "w": 220, "h": 100, "text": "输入", "fill": "paper", "color": "ink" } },
    { "op": "add", "element": { "id": "output", "type": "shape", "kind": "rounded", "x": 400, "y": 160, "w": 220, "h": 100, "text": "输出", "fill": "paper", "color": "ink" } },
    { "op": "add", "element": { "id": "flow", "type": "arrow", "x": 0, "y": 0, "w": 0, "h": 0, "from": "input", "to": "output", "fromSide": "right", "toSide": "left", "label": "处理", "head": "end", "color": "muted" } }
  ]
}
```

## 通用字段

原生对象使用 `id/type/x/y/w/h`；`version` 由服务管理。几何单位是白板坐标，不是当前屏幕像素。可选的 `rotation`、`parentId`、`groupId`、`locked` 只有在相应对象和操作支持时使用。移动分区或组时读取成员并保持附属内容、自由端点与层次关系。

文字使用 `text`、`fontSize`、`fontFamily`、`bold`、`italic`、`textAlign`（left/center/right）。`color` 是文字或笔迹/箭头颜色，`fill` 是对象填充，`stroke` 是形状边框。支持十六进制色和程序已声明的语义角色，例如 `paper/ink/muted/accent/link`；不要把未知字符串当有效 CSS。明暗要求见 [配色](appearance.md)。

新建普通原生文字时，优先省略 `color` 或使用 `"ink"`，次要说明可用 `"muted"`。十六进制色表达固定颜色，使用时核对文字所在的实际背景；保留用户明确指定的颜色，按[配色与可读性](appearance.md)检查明暗显示。

原生文字支持不嵌套的 `**粗体**`、`*斜体*`、反引号代码、`[文字](https://...)`，以及行首 `- ` 或 `1. ` 列表。原始 HTML 作为普通文字显示；需要 HTML 排版时用 HTML Region。链接仅 HTTP(S)。

## 名称与标题

HTML 区域、文档区域与原生分区（`type: "container"`，用于框住一组内容）的自带标题都写在 **`element.text`**。`artifact_manage.title` 命名整块作品，HTML 内部的 `<title>`／标题与文档正文标题分别保留在各自内容中，外层标题仍需显式设置 `text`。

新增时根据内容主旨设置简短、可辨识的 `text`。优先采用用户提供的名称；未指定时可取 HTML 的正文标题或 `<title>`，原生分区取所含内容的主题。例如“录制入口与路径设置”“批处理结果与异常”，不要留下空白或“HTML 图解”“HTML 内部选区”“分区”“选区”等通用占位名，也不要只加序号掩盖没有主题。多张同主题图可加实际差别，如“录制流程 · 入口设置”“录制流程 · 导出结果”。

对象自带标题已足以识别内容时，省略上方重复的独立 `type:"text"`。跨多个对象的章节标题、导语或用户要求的独立说明可以保留，按其实际字号、宽度和换行后的完整高度安排位置。计算占用范围时包含内容框外的标题栏、分区标题和必要间距；以当前画布实测为准，不能只用对象的 `x/y/w/h` 推断所有文字都在框内。

```json
[
  { "op": "add", "element": { "id": "recording-options", "type": "html", "x": 80, "y": 80, "w": 1440, "h": 1120, "text": "录制入口与路径设置", "html": "<!doctype html><title>录制入口与路径设置</title><h1>录制入口与路径设置</h1>" } },
  { "op": "add", "element": { "id": "batch-results", "type": "container", "x": 1600, "y": 80, "w": 600, "h": 360, "text": "批处理结果与异常" } },
  { "op": "add", "element": { "id": "recording-notes", "type": "document", "x": 2280, "y": 80, "w": 680, "h": 540, "text": "录制验收记录", "document": { "schemaVersion": 1, "blocks": [{ "id": "recording-result", "type": "paragraph", "props": {}, "content": "核对录制状态与导出文件。", "children": [] }] } } }
]
```

上例是 `artifact_apply.operations` 片段；实际提交仍带本次任务绑定、操作标识和必要版本检查，预留范围覆盖全部新增对象。完成后用 `artifact_read mode: "objects", ids: [...]` 读回新增对象，确认 `text` 与预期名称一致；概要中的 `items[].label` 是该字段的摘要。随后查看当前实际画布，确认自带标题、额外文字和相邻内容完整可见；有遮挡或裁切时调整本次范围内的位置、宽高或间距，复查后再交付。只改源码或已有内容时保留既有名称，不因看到默认名就批量改名；用户明确要求命名或本次创建的对象遗留占位名时，再用目标对象的 `update` 和 `changes.text` 修正。

## 各类对象

### 文字、便签和分区

`type: "text"` 是无框文字；`note` 是便签；`container` 是分区。给段落实际宽高，避免用极小框塞长文。分区标题、内部内容和包含关系需要同时考虑；删除分区不是默认删除其中所有信息的授权。

### 形状

`type: "shape"` 的 `kind` 支持 rect、rounded、ellipse、diamond、pill、hexagon、parallelogram、database、queue、document、cloud、person。未知类型会明确拒绝，不会当作矩形假装实现。

`hollow: true` 使用空心处理；`strokeWidth` 定义线宽，`dash: true` 为虚线。标签沿用通用文字字段。圆形使用宽高相同的 ellipse。

### 笔迹

`type: "stroke"` 使用 `points: [x0,y0,x1,y1,...]`，相对对象的 x/y。`strokeWidth` 定义笔宽，`stroke` 定义线色，`dash: true` 使用虚线；未提供前两项时兼用 `width` 和 `color`。保留相对点，不把笔迹当作有边界连接点的节点。

三个及以上点会平滑连接；需要尖角时把该点连续写两次。画布与导出共用同一路径计算，不改写保存的原始点。

### 箭头

`from/to` 为对象 ID 或自由坐标 `[x,y]`；`fromSide/toSide` 可指定 top/right/bottom/left。

`head` 为 end/both/none。更精确时使用 `heads: ["circle", "arrow"]`，两端分别为 none/arrow/circle，优先于 head。

`bends` 支持 `['h'|'v', ...相对偏移]` 的原生折线路由，也兼容已有数值坐标点对。原生格式最多 12 个偏移，交替安排折线路段，前半相对起点中心、后半相对终点中心。不要混用两种格式，也不要假定路由自动避开任意对象。

### 图片和视频

`type: "image"` 的 `src` 是界面／资源导入返回的稳定资源引用或合法 `data:image/...`。生成 SVG 图片时可使用 `data:image/svg+xml,` 加正确编码的完整 SVG；不使用旧 `by: "claude"` 字段或旧 SVG 文字禁令。

视频保留 `video` 引用及 `src` 封面，`data.mimeType` 表达媒体类型。编辑时不要丢掉它们。源文件不是 LAN 可访问 URL，不能把本机绝对路径直接放入 src。

图片 `crop` 为 `{zoom: 1, x: 0.5, y: 0.5}`，zoom 至少 1，x/y 在 0～1。显式裁剪采用 cover 后缩放；保存 `data.naturalWidth/naturalHeight` 供精确导出，缺省仍保持 contain。裁剪不修改原始资源。

图片可用 `href` 关联 HTTP(S) 页面，画布提供打开链接入口，HTML/SVG 导出保留链接。视频仍使用自身播放控件，不套图片跳转链接。

### 表格、链接和贴纸

表格使用 `type: "table", data: {rows: [["项目","结论"],["方案A","待验证"]]}`，首行作为表头。短文本对比使用表格，不堆成形状网格。

链接卡片使用 `type: "link", text: "标题", href: "https://..."`。旧字符贴纸继续使用 `type: "sticker", text: "贴纸字符"`；图形贴纸使用同一类型并设置 `data.stickerIconId`，例如 `heart`、`smile`、`thumbs-up`。优先沿用已有对象读出的稳定图形 ID；未知 ID 不代表可用图形，不把任意 SVG 源码塞进该字段。图形库在画布、选择器和导出间共用。不要冒充其他成员投票或改掉他们的表达。

贴纸附着对象使用 `parentId`，移动父对象时由白板带动；共同分组使用 `groupId`。已有成员作者、人脸或投票元数据原样保留；统计意见时按明确的原始成员和投票信息计数，不把普通表情贴纸猜成投票，也不替其他成员添加票意。

### 任务清单

`type:"todo"` 的标题保存在 `text`，任务保存在 `data.items`。每行有稳定的 `id`、正文 `text`、完成状态 `checked`。可选 `sourceRef` 指定来源 `elementId`，并可补充 `artifactId`、`version` 及 `blockId` 或 `itemId`。用 `artifact_read mode:"tasks",elementId` 读取目标清单，可按 `itemIds` 或 `checked` 过滤。

只改目标行时，提交一项 `op:"todo",id:清单ID,data:{operations:[...]}`。行操作支持 `insert`、`update`、`delete` 和 `move`。例如勾选一行用 `{op:"update",id:任务ID,changes:{checked:true}}`。新增传 `item`；需要插入指定位置或重排行时用 `afterId`，置于第一行用 `null`。保留行与清单各自的 ID，并带清单对象的预期版本。

### HTML Region

使用 `type: "html", text: "内容主题", html: "完整HTML"`，给明确区域宽高；按[名称与标题](#名称与标题)命名外层。`state` 保存独立的 JSON 交互状态，`sourceRevision` 由服务管理。只改 HTML 源码时只提交 `changes.html`；不要附带旧几何、旧状态或手动设置源码版本。确需同步修改外层名称时，另明确提交本次 `changes.text`。

内部目标提供稳定 `data-studio-id`，反馈读取见 [HTML 区域与反馈](html-feedback.md)。内部没有原生拖拽编辑器，用户通过对象／文字／框选备注让 Codex 修改源。脚本不能直接获得宿主或文件系统能力。

### 文档区域

`type:"document",text:"内容主题",document:{schemaVersion:1,blocks:[...]}` 表达白板中的长文区域。块 JSON 是正文权威源，按[文档区域与段落修改](document-regions.md)读取、命名、按稳定块 ID 局部修改和导出；不要用 HTML 替代正文，也不要把文档外框几何混入段落更新。

## 资源和备份

生成本机图片后，用 `artifact_manage` 的 `asset-import`，提供作品 ID 和用户明确指定或当前任务生成的绝对 `assetPath`，再用返回的 `asset.src` 新增图片。不要让网页内容指定任意本机文件，也不要把大媒体 base64 塞进模型工具参数。

`artifact_read mode: "assets"` 只向房主分页返回资源元数据，有 `nextCursor` 时可以继续。`asset-delete` 用 `assetId`，检查当前内容、历史、冻结反馈和私人建议的引用。移除后保留内部回收副本。

整作品 ZIP 在作品界面导出，包含数据库、资源、历史和反馈。当前数据库 ZIP 使用 `luming-studio-archive` 的版本 2 格式。`artifact_manage action: "import", archivePath: "用户指定的绝对ZIP路径"` 导入为新 ID，界面用文件选择器走同一业务逻辑。
