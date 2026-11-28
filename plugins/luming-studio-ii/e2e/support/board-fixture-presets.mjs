const count = 24;
const entries = Array.from({ length: count }, (_, index) => index + 1);

const mixedHtml =
  '<main style="padding:8px;color:#192832;background:#f7fcff;font:16px system-ui">' +
  '<button type="button">HTML 操作</button><ol>' +
  entries.map((index) => `<li style="margin:8px 0">HTML 内容 ${index}</li>`).join("") +
  "</ol></main>";

const mixedDocument = {
  schemaVersion: 1,
  blocks: entries.map((index) => ({
    id: "mixed-block-" + index,
    type: "paragraph",
    content: "文档段落 " + index,
  })),
};

const mixedItems = entries.map((index) => ({
  id: "mixed-item-" + index,
  text: "待办任务 " + index,
  checked: index % 2 === 0,
}));

const card = { y: 100, width: 360, height: 300 };

export const mixedBoard = {
  title: "混合内容白板",
  objects: [
    { id: "mixed-html", kind: "html", label: "HTML 区域", x: 80, html: mixedHtml, ...card },
    {
      id: "mixed-document",
      kind: "document",
      label: "原生文档",
      x: 500,
      document: mixedDocument,
      ...card,
    },
    { id: "mixed-todo", kind: "todo", label: "待办清单", x: 920, items: mixedItems, ...card },
  ],
};
