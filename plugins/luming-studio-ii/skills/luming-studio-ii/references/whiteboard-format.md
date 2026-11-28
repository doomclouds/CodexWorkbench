# 白板对象格式

直接生成或修改原生对象时读本页。专业图解可按任务选用 HTML Region，保留对象及内部节点的稳定身份。复杂图种所需的布局规则见[白板表达与布局](whiteboard-craft.md)。

## 读取和提交

用 `artifact_read mode: "objects", ids` 取得保存态 `items[].object` 和 `items[].payload`。概要用于找 ID 和坐标，`source` 可分段取得较大的 HTML 或 JSON 原文。读取范围、版本和游标见[有界读取](agent-reading.md#先定位再读取)。

实际写入前通过 `artifact_activity` 声明目标工作区。`artifact_apply` 使用 `boardId`、稳定 `taskId`、当前 `generation`、稳定 `commandId` 与有序 `operations`。每项是 II 的 Protobuf JSON，只有 `geometry` 或 `content` 一个分支。外层已给白板和命令 ID，内层沿用该请求上下文。读出的 `geometryVersion` 作为 `expectedGeometryVersion`，读出的 `payloadVersion` 作为 `expectedPayloadVersion`。`uint64` 以十进制字符串传入。收到拒绝或冲突先核对原回执与目标现状。

| 目标 | 当前操作 |
| --- | --- |
| 创建原生对象 | `geometry.create.object` 填对象元数据，`initialPayload` 按需填对应正文。给独立且不冲突的 `objectId`，服务产生版本 |
| 拉伸、旋转、调整连线 | `geometry.transform.kind` 采用 `BOARD_TRANSFORM_KIND_RESIZE`、`BOARD_TRANSFORM_KIND_ROTATE` 或 `BOARD_TRANSFORM_KIND_CONNECT`，`objects[]` 含目标版本和新几何或连线数据 |
| 锁定、删除、复制、分组 | `geometry.changeLock`、`delete`、`duplicate`、`group`、`ungroup`。复制使用新 ID，框内对象和相关端点按实际变更核对范围 |
| 创建分区、排布 | `geometry.createSection` 给所含对象、`sectionId` 和标题。`geometry.arrange` 给 `targets` 及 `BOARD_ARRANGE_PRESET_TIDY` 或对应的六方向对齐枚举 |
| 层级 | `geometry.reorder` 带目标、`direction` 和当前 `expectedBoardRevision`。方向使用 `BOARD_LAYER_DIRECTION_FORWARD`、`BACKWARD`、`FRONT` 或 `BACK` 的完整枚举值 |
| 样式与名称 | `geometry.style.targets[]` 中嵌套目标及适用的 `expectedPayloadVersion`，`patch` 仅填实际变化的样式和 `label` |
| 正文 | `content` 带对象 ID 和正文版本，依类型使用 `text`、`document`、`todo`、`table`、`embedSource`、`embedState`、`sticker`、`crop` 或 `link` |

锁定保护位置、尺寸、旋转、连接和相关结构。解锁须有明确授权，按实际服务支持的操作核对。源文件、状态、视觉填充和正文各自提交。Agent 写入有真实范围校验，跨板粘贴和全局调色板交由白板界面处理。恢复旧版和撤销通过[历史和恢复](operations.md#分享历史与恢复)入口。

下面创建两个节点和一根关联线。先在包含它们的空白区域申请 `scope.bounds`，如 `x: 40, y: 120, width: 640, height: 200`。替换为实际白板 ID 和 `begin` 返回的 `generation`。对象 ID 与命令 ID 供演示，本次运行需按方案查重并替换。

```json
{
  "boardId": "launch-board",
  "taskId": "draw-approval-flow",
  "generation": "actual-generation",
  "commandId": "draw-approval-flow-1",
  "operations": [
    {
      "geometry": {
        "create": {
          "object": {
            "objectId": "request-in", "kind": "shape", "label": "提交申请",
            "geometry": { "x": 80, "y": 160, "width": 220, "height": 100 },
            "shape": { "outline": "rounded" },
            "appearance": { "fill": "#E6EEFF", "stroke": "#345E96" }
          },
          "initialPayload": { "text": { "text": "提交申请" } }
        }
      }
    },
    {
      "geometry": {
        "create": {
          "object": {
            "objectId": "approval", "kind": "shape", "label": "核对审批",
            "geometry": { "x": 400, "y": 160, "width": 220, "height": 100 },
            "shape": { "outline": "rounded" },
            "appearance": { "fill": "#D5EBE4", "stroke": "#256049" }
          },
          "initialPayload": { "text": { "text": "核对审批" } }
        }
      }
    },
    {
      "geometry": {
        "create": {
          "object": {
            "objectId": "approval-flow", "kind": "connector", "label": "送审",
            "geometry": { "x": 300, "y": 210, "width": 100, "height": 1 },
            "connector": {
              "start": { "point": { "x": 300, "y": 210 }, "attachment": { "objectId": "request-in", "port": "CONNECTOR_PORT_RIGHT" } },
              "end": { "point": { "x": 400, "y": 210 }, "attachment": { "objectId": "approval", "port": "CONNECTOR_PORT_LEFT" } },
              "startHead": "CONNECTOR_HEAD_NONE", "endHead": "CONNECTOR_HEAD_ARROW"
            }
          },
          "initialPayload": { "text": { "text": "送审" } }
        }
      }
    }
  ]
}
```

## 通用字段

对象元数据使用 `objectId`、`kind`、`label` 和 `geometry: {x, y, width, height, rotation}`。坐标采用白板世界单位。`parentId` 是包含关系，`groupId` 是共同分组。移动、复制或删除分区及组时，核对相关对象、包含关系和绑定箭头的实际变更。固定方向的分区、文档、待办、表格和嵌入区域保留其支持的朝向。

`appearance` 用于形状填充和边框，字段含 `fill`、`stroke`、`strokeWidth`、`dashed` 和 `hollow`。颜色用实现支持的十六进制值或 `transparent`，省略时沿用对象主题默认。普通文字在 `payload.text` 中使用 `text`、`color`、`fontFamily`、`fontSize`、`bold`、`italic` 和 `align`。对齐使用 `TEXT_ALIGNMENT_LEFT`、`CENTER` 或 `RIGHT` 的完整枚举。正文中可用原生富文本标记，例如粗体、斜体、链接与列表。需要页面布局时使用嵌入区域。链接使用有效 HTTP(S)。详见[配色与可读性](appearance.md)。

## 名称与标题

整板标题由 `artifact_manage` 的 `title` 管理。HTML 区域、文档和分区的外层名称写入对象 `label`。HTML 创建时 `initialPayload.embed.title` 与外层名称保持一致，文档正文使用 `document.title`。正文标题应服从内容的层次，外层名称用于定位对象。采用用户给的名称或有实际含义的简短主题，如「录制入口与路径设置」「验收记录 · 导出与恢复」。

对象已有可辨识标题时可省略重复的独立文字。多个对象公用的章节标题、导语或独立说明按实际换行高度安排。占用范围包含框外标题、分区名和留白。读回 `object.label` 与实际正文标题并检查画面。仅改源码或某段正文时保留原名称。

## 各类对象

### 文字、便签和分区

`text` 为无框文字，`note` 为便签，`section` 为分区。创建分区用 `section: {transparent: true}` 或实际需要的外观。原生标签保留文本宽高、对齐和字号。改变边界前辨识分区内部成员，删除分区时按授权处理其内容与连线。

### 形状

`kind: "shape"` 使用 `shape.outline`。支持 `rect`、`rounded`、`ellipse`、`diamond`、`pill`、`hexagon`、`parallelogram`、`database`、`queue`、`document`、`cloud` 和 `person`。使用等宽高椭圆表达圆形。边框、文字和半透明外观通过各自的字段维护，保证标签留白和视觉对比。

### 笔迹

`kind: "ink"` 的 `ink.width` 是实际笔宽，`initialPayload.ink.points` 是 `{x, y}` 数组，每个坐标归一化到对象框内的 0 到 1。保存原始点和线宽。颜色及虚线由 `appearance.stroke` 和 `appearance.dashed` 表达。保持笔迹与可绑定节点的语义区别。

### 箭头

`kind: "connector"` 的 `connector.start`、`end` 都保留世界坐标 `point`，连接对象时另有 `attachment: {objectId, port}`。侧边用 `CONNECTOR_PORT_TOP`、`BOTTOM`、`LEFT`、`RIGHT` 的完整枚举。`startHead` 和 `endHead` 分别用 `CONNECTOR_HEAD_NONE`、`ARROW` 或 `CIRCLE` 的完整枚举。

优先用清晰的直线或正交折线。`bends` 为实际世界坐标点，`relativeBends` 通过 `firstAxis: "BEND_AXIS_HORIZONTAL"` 或 `"BEND_AXIS_VERTICAL"` 与 `offsets` 表达相对偏移。沿用当前对象所读的路由表示，每条线用同一种。反转关系时一起核对端点、侧边、路由和头部。`labelOffset` 用于留出标签空间。绕开遮挡以实际画面核实。

### 图片和视频

图片保存 `payload.image.src`、`href`、`naturalSize` 与裁剪参数。`crop` 用 `{zoom, x, y}`，x/y 为 0 到 1，`zoom` 至少 1。裁剪保留原资源，提交 `content.crop` 使用实际正文版本和原图尺寸。视频用 `payload.video.src` 和 `poster`。已存在的无封面视频可由支持的导出路径读取实际首帧。独立媒体通过白板「图片」「视频」入口放置。一般 `geometry.create.initialPayload` 当前支持的原生种类不含媒体和独立的图表或图解类型。需要这些专用类型时走相应的白板入口。

### 表格、链接和贴纸

表格 `payload.table.grid` 包含 `rows[].cells`、`rowIds`、`columnIds`、`columnWidths` 和可选 `head`。单元格选择 `text`、`number`、`boolValue` 或 `nullValue`。只改单元格时保留原行列身份，增删行列时同步更新对应 ID 和列宽。`content.table.table` 载入完整表格负载。

链接对象的 `payload.link.href` 指向真实地址，`content.link` 提交标题和地址。贴纸使用已存在的 `stickerId`，如 `heart`，可保留已有字符 `fallback`。贴纸与附着对象的关系由几何元数据管理。统计反馈时保留真实作者、身份和意见，普通表情只按其实际用途计算。

### 任务清单

`todo` 正文含 `title` 和 `items[]`。任务字段是 `itemId`、`text`、`checked` 和可选 `sourceRef`。来源指向真实 `objectId`，可附 `boardId`、`blockId`、`itemId` 或 `version`。用 `artifact_read mode: "tasks", elementId` 读取，可按 `itemIds` 和 `checked` 筛选。

清单创建后使用 `content.todo.edits` 按行操作。可用 `rename`、`insert`、`update`、`deleteItemId`、`move`。插入和移动的 `placement` 用 `first: true`、`append: true` 或 `afterItemId`。勾选一行用 `{"update":{"itemId":"verify-approval","checked":true}}`。保留清单和行 ID，写入附带当前清单的 `expectedPayloadVersion`。

### HTML Region

使用 `kind: "html"`，明确外层 `label` 和区域宽高。创建携带 `initialPayload.embed: {title, html}`。已有 HTML、指定图解和图表对象的源码修改及内部锚点见[HTML 区域与反馈](html-feedback.md)。`sourceRevision` 由服务更新，`embed.state` 独立保存交互数据。宿主与文件系统访问始终使用真实公开能力。

### 文档区域

创建 `kind: "document"` 时可用默认空文档，随后按真实版本保存 `content.document: {title, schemaVersion: 1, blocks}`。块 JSON 是正文的权威数据，局部修改及导出见[文档区域与段落修改](document-regions.md)。

## 资源和备份

本地素材通过 `artifact_manage action: "asset-import"` 和用户授权的绝对 `assetPath` 导入，用返回的 `asset.src`。文档图片、HTML 图解和保存态媒体沿用该资源引用。不要把本机路径当做访客 URL。普通资源路径、局部读取和移除流程见[媒体与绘图](operations.md#媒体与绘图)。

完整 `.studio.zip` 为 `luming-studio-archive` v4，保存作品历史、备注、素材等完整备份。当前整板可由界面或 `artifact_export format: "zip"` 导出。按授权用 `artifact_manage action: "import"` 和绝对 `archivePath` 导入为新白板，结果以返回的新 ID 和当前格式核对。局部和历史版本文件通过相应导出选项处理。
