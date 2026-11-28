# 建议方案与预览

用户要比较可选改法、了解下一步或审阅候选方案时使用这份参考。已有明确执行指令时按 [操作语义](operations.md) 处理。

## 从当前白板提出建议

先读取当前白板与相关对象，同版次的已知事实可以直接复用。空白板从用途和标题推导适合的起步内容，遇到会改变结果的用途歧义时再澄清。非空白板的建议应有具体依据，例如流程缺少回路、两组记录难以比较或缺少执行人。先决定读者需要补事实、改善组织还是换表达方式。

通常给两到四个可以独立判断的选项，把最合适的一项放前面。每项应有清楚的行动名称、目标对象或区域、简短收益和代价，以及支持它的观察。先区分事实和假设，再安排新增、修改或删除所影响的关系。流程、分区、比较表和实物图可以是有意义的表达选择。配色是问题本身时，可以把色彩作为比较维度。

## 冻结来源和私有入口

在 Codex 面板打开白板，从具体备注使用「附加到 Codex 对话」，检查对话草稿后发送。建议使用该附件中的白板 ID 和 `sourceId`。`sourceRef` 用于追溯冻结备注的内容，`sourceId` 用于提交可审阅方案。需要补读冻结摘录时按 [上下文读取指引](context-reading.md) 操作。

房主在白板「备注列表」查看与备注关联的私人建议。其他分享角色使用普通备注流程。暂时缺少支持的宿主、冻结来源、所需方案能力或权限时，可在聊天中给出完整选项，说明建议会在哪里看到。用户选定可执行的方案后，再读取当前对象并按授权范围实施。

## 公开操作

| 操作 | 使用方式 |
| --- | --- |
| 提交 | `artifact_suggest` 接受 `boardId`、`sourceId`、稳定的 `commandId`、`observation` 和两至四项 `options`。观察简短具体。`artifact_feedback` 的 `action:"suggest"` 使用 `text` 提供观察，其余建议字段相同。 |
| 预览 | 悬停或键盘聚焦未应用的选项可查看效果。房主端也可调用 `artifact_feedback` 的 `action:"preview"`，提供 `boardId`、`proposalId`、`optionId`、`expectedProposalVersion`，取得只读变更投影。 |
| 应用或撤回选项 | 房主点击选项，或在用户明确确认后用 `artifact_feedback` 的 `action:"choose"` 加同一组标识、版本和独立 `commandId`。再次明确选择已应用项会尝试安全撤回。 |
| 清除 | 「清除建议，保留已应用内容」或 `artifact_feedback` 的 `action:"withdraw"` 加 `boardId`、`proposalId`、`expectedProposalVersion`、`commandId`。该操作关闭提案。 |
| 查阅 | 房主从备注列表查阅当前建议。`artifact_feedback` 的 `action:"list"` 分页列出备注线程。 |

每个候选需要唯一的 `optionId`、`label`、可选 `description`。单个操作用 `edit`，需要多步时用有序的 `operations`，每项接受 1 至 60 步；两者选择其中一个。每步按 II Protobuf JSON 表达为 `geometry` 或 `content`。内层省略白板和命令 ID。传输结果待确认时，原样重试同一命令。版本冲突时重新读取，必要时重新附加来源并形成新提案。

## 示例

假设用户的冻结备注包含对象 `handoff-card`，它的几何版本为 `5`、正文版本为 `3`，表述缺少验收方。下面是 `artifact_suggest` 的完整请求示例。运行时用附件和实际读取值替换示例中的 ID、版本与文字。

```json
{
  "boardId": "release-board",
  "sourceId": "review-source",
  "commandId": "handoff-options",
  "observation": "交付卡片只说明提交，验收方需要另找出处。",
  "options": [
    {
      "optionId": "clarify-handoff",
      "label": "补清交接双方",
      "description": "把提交与验收的职责写在现有卡片里。",
      "edit": {
        "content": {
          "objectId": "handoff-card",
          "expectedPayloadVersion": "3",
          "text": { "text": "交付方提交，验收方确认" }
        }
      }
    },
    {
      "optionId": "highlight-handoff",
      "label": "把交付卡片标成核对点",
      "description": "先让读者定位待确认的步骤，保持现有文案。",
      "edit": {
        "geometry": {
          "style": {
            "targets": [{ "target": { "objectId": "handoff-card", "expectedGeometryVersion": "5" } }],
            "patch": { "stroke": "#d97757", "strokeWidth": 3 }
          }
        }
      }
    }
  ]
}
```

## 应用与版本边界

预览仅影响查看者的临时画面。正式应用根据来源范围及实际对象版本一次提交，其他成员看见已应用的变更。多个不相交的选项可以并用，触及相同对象的选项按服务端核对切换。安全撤回会先检查已应用结果与当前对象状态，后续用户改动保留。

II 将建议的写入范围限制在冻结来源的对象内。服务端也检查实际受影响的对象、正文和关系。新对象 ID、粘贴或画板色板写入超出这套提案边界。需要加入新内容时，可先提出聊天方案，经用户确认后使用覆盖对应区域的编辑工作区执行。表格、源码和媒体变化须使用与对象匹配的操作，若当前方案无法完整预览，就保留为聊天方案直到用户选择。

建议约有 30 分钟可见期，以服务器返回的到期时间为准。同一区域优先维护当前一批选项，清理到期或过时的建议时保留已应用的正式内容。用户说「就用第一种」时，核实对应批次和方案状态，已应用的方案直接说明结果。成功创建可见建议时，告诉用户白板、备注及预览位置即可。
