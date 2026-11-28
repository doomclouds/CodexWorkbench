# 文档区域与段落修改

文档是 `kind: "document"` 的白板对象。外层 `object.label`、几何和外观属于画板，正文在 `payload.document`。正文契约包含 `title`、`schemaVersion: 1` 和 `blocks`。HTML、Markdown 与渲染中的 DOM 用于阅读或导出，编辑以保存的块 JSON 为准。

块使用稳定的 `blockId`、`type`、`props`、`content` 与 `children`。支持 paragraph、heading、bulletListItem、numberedListItem、checkListItem、quote、codeBlock、table、image、divider。文字用字符串或受支持的富文本片段，文本和链接片段的格式放 `styles`。代码块保留换行与缩进，表格保留 BlockNote `tableContent` 的行与单元格。图文块使用已保存的素材引用。纸张填充属于对象外观，保留用户选定的正文颜色和纸张配色。

## 读取并局部修改

1. `artifact_read mode: "objects", ids: [文档ID]` 读取外框、标题和当前 `payloadVersion`，大正文用 `blocks`、`elementId` 取页，也可带真实 `blockIds` 精读。`blocks` 保留各返回块的 `children`。全树编辑前通过原文页或未筛选的块页收齐根块及嵌套结构，按原顺序还原。
2. 保留改动之外的块、顺序、子树、属性和样式。在读到的原始 JSON 上按 `blockId` 局部计算新增、修改、移动或删除。新增用唯一的稳定 ID，移动沿用原块和子树身份。部分 `props` 修改也保留该块其余属性。
3. 用 `artifact_activity` 声明该文档对象。将计算出的完整文档负载交给 `artifact_apply.operations[].content.document`，并提供实际读取的 `expectedPayloadVersion`。II 的该工具接收完整负载，段落局部修改体现在所构造的块树差异中。它使用对象级正文 CAS，与其他成员同编时须比较新旧内容，保留各自改动后再提交。

例如当前文档只含下列两个根块，修改第二段只需更改 `paragraph-a.content`。下面是带回其余块的完整正文操作片段，外层工作区绑定和命令 ID 见[批量与并发](operations.md#批量与并发)。

```json
{
  "content": {
    "objectId": "release-document",
    "expectedPayloadVersion": "12",
    "document": {
      "title": "发布验收记录",
      "schemaVersion": 1,
      "blocks": [
        { "blockId": "heading-a", "type": "heading", "props": { "level": 2 }, "content": "验收范围", "children": [] },
        { "blockId": "paragraph-a", "type": "paragraph", "props": {}, "content": "核对审批状态与发布记录。", "children": [] }
      ]
    }
  }
}
```

内容或版本冲突时，先保留修改意图，重读当前树，核对同一块的新版本以及移动、插入和删除结果。外框几何和段落修改分别提交对应操作。完成后读回目标块和标题，确认显示与目录定位。

## 依据段落备注工作

在白板上放置文档后，可通过文档标题栏或专用握柄移动。区内正文可阅读、滚动和选字。区域横向拉伸改变排版宽度，保留已保存段落的字号与对齐。可用「编辑文档」进入编辑，选中文档时也支持 Enter/F2。展开阅读提供搜索与目录，退出后回到画板原来的上下文。

文档工具条的备注可指整个文档，备注模式点正文定位到具体段落。已有文字选区时沿用真实命中的块，可跨多个块。按当前锚点区分对象、单块与跨块选区。模型通过 `artifact_feedback` 创建段落备注时，用 `anchor.coordinateSpace: "document"`、`objectId`、`blockIds`、真实 `geometryVersion` 和 `payloadVersion`，可带 `u/v` 锚点。在阅读页对应段落的显示位置随排版重新定位。

收到已附加备注时，用 `artifact_context` 取得其冻结摘录和段落标识，或用 `artifact_read mode: "context", feedbackId` 核实来源。以 `mode: "blocks", feedbackId, elementId, blockIds` 精读作用范围内的冻结块，不带 `feedbackId` 重读当前同 ID 块。需要从同一版本查看整篇时，使用保存版次 `atRevision` 和该文档已授权的 `source` 或块页。备注提供的段落范围用于核对原引用，当前修改仍取决于用户要求与对象版本。

## 图片、备份与导出

图片块的 `props.url` 指向程序上传或 `artifact_manage action: "asset-import"` 返回的已保存 `asset.src`。完整作品 ZIP 保留媒体、文档、历史与冻结备注。导入作为一个新作品，资源归属随服务迁移。使用程序返回的新 ID 和素材引用。

文档的下载菜单提供「全文 Markdown」「全文 HTML」「块 JSON」。白板工具 `artifact_export` 支持以 `ids: [文档ID]` 导出该区域的白板表示，以及通过白板导出界面生成 PNG、SVG 或整板。需要可编辑的段落或离线完整阅读时，使用对应正文格式，按下载实际文件核对内容和素材。
