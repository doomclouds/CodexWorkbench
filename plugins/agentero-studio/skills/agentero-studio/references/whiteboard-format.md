# 白板对象格式

直接生成或修改原生对象时读取。本页描述当前白板产品，其他产品由各自适配器定义内容和操作；不要把这些字段当作 Studio 所有产品的公共结构。专业图解优先按任务使用 HTML Region；Diagram Design 可用时读取它的规范，不在此复制图种手册。

## 读取和提交

`artifact_read` 默认返回概要。`mode: "summary"` 提供类型计数、有界对象清单、标签、几何位置及版本；有 `nextOffset` 时继续。需要完整对象用 `mode: "objects", ids: [...]`，需要 HTML 原始源用 `mode: "source", regionId: ...`。源码有 `nextOffset` 时先读完整，不把第一段当完整源码写回。

`artifact_apply` 的 `operations` 是一笔事务：

- `add` 携带新对象 `element`。为新对象提供不冲突的稳定 `id`；不从标题或用户路径猜 ID。
- `update` 携带已有 `id` 和部分 `changes`。已有对象必须提供从实际读取结果取得的 `expectedVersions`，或使用最新整作品 `expectedRevision`。
- `delete` 携带 `id` 或 `ids`；删除节点连带的箭头也在版本检查范围内。
- `layout` 携带 `ids`、`preset: "row" | "column"`，或默认网格；`data.x/y` 指定起点。
- `style` 携带 `style` 中实际改变的语义颜色和字体。整作品操作使用最新 `expectedRevision`。
- `restore` 携带历史 `versionId`，恢复生成新版本；`data.mode: "undo"` 安全撤回这笔修改。

发生错误时整笔操作不半应用。写入重试保留 `operationId`；锁定对象先明确解锁，不能绕过保护覆盖。返回的版本以程序确认值为准，不自行加一后假定其他内容未变。

以下是最小的原生对象组合；示例 ID 仅用于展示，实际使用前查重：

```json
{
  "artifactId": "工具返回的作品ID",
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

原生文字支持不嵌套的 `**粗体**`、`*斜体*`、反引号代码、`[文字](https://...)`，以及行首 `- ` 或 `1. ` 列表。原始 HTML 作为普通文字显示；需要 HTML 排版时用 HTML Region。链接仅 HTTP(S)。

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

链接卡片使用 `type: "link", text: "标题", href: "https://..."`。贴纸使用 `type: "sticker", text: "贴纸字符"`；不要冒充其他成员投票或改掉他们的表达。

贴纸附着对象使用 `parentId`，移动父对象时由白板带动；共同分组使用 `groupId`。已有成员作者、人脸或投票元数据原样保留；统计意见时按明确的原始成员和投票信息计数，不把普通表情贴纸猜成投票，也不替其他成员添加票意。

### HTML Region

使用 `type: "html", html: "完整HTML"`，给明确区域宽高。`state` 保存独立的 JSON 交互状态，`sourceRevision` 由服务管理。改 HTML 只提交 `changes.html`；不要附带旧几何、旧状态或手动设置源码版本。

内部目标提供稳定 `data-studio-id`，反馈读取见 [HTML 区域与反馈](html-feedback.md)。内部没有原生拖拽编辑器，用户通过对象／文字／框选备注让 Codex 修改源。脚本不能直接获得宿主或文件系统能力。

## 资源和备份

生成本机图片后，用 `artifact_manage` 的 `asset-import`，提供作品 ID 和用户明确指定或当前任务生成的绝对 `assetPath`，再用返回的 `asset.src` 新增图片。不要让网页内容指定任意本机文件，也不要把大媒体 base64 塞进模型工具参数。

`artifact_read mode: "assets"` 只向房主分页返回资源元数据；有 `nextOffset` 时继续。`asset-delete` 使用 `assetId`，拒绝删除当前内容、保留历史、冻结反馈或私人建议仍引用的资源；移除后保留内部回收副本，不等于立即释放所有磁盘空间。

整作品备份是 `artifact_export format: "zip"`，包含内容、资源、历史和反馈。`artifact_manage action: "import", archivePath: "用户指定的绝对ZIP路径"` 导入为新 ID；界面用文件选择器和受控上传走同一业务逻辑。普通 JSON/HTML 是数据或画面导出，不能冒充完整可恢复备份。
