import type { CanvasObject, CanvasObjectPayload } from '../../../src/ui/domain/canvas/index.js';
import type { DocumentValue } from '../../../src/ui/domain/objects/document/index.js';
import type { EmbedObjectValue } from '../../../src/ui/domain/objects/embed/index.js';
import type { TableObjectValue } from '../../../src/ui/domain/objects/table/index.js';
import type { TodoObjectSnapshot } from '../../../src/ui/domain/objects/todo/index.js';

const sampleImage = new URL('../../../../../assets/icon.png', import.meta.url).href;
const sampleVideo = new URL('./sample.webm', import.meta.url).href;
const embedMarkup = {
  html: '<section><h2>HTML 示例</h2><details><summary>查看说明</summary><p>可以修改源码并保存。</p></details></section>',
  diagram:
    '<section><h2>编辑回执</h2><ol><li>发出意图</li><li>校验版次</li><li>确认投影</li></ol></section>',
  chart:
    '<section><h2>阶段用时</h2><p>读取 <meter max="100" value="44">44</meter></p><p>布局 <meter max="100" value="21">21</meter></p></section>',
};

function documentValue(title: string): DocumentValue {
  return {
    title,
    version: 1,
    document: {
      schemaVersion: 1,
      blocks: [
        { id: 'overview', type: 'heading', props: { level: 2 }, content: '架构评审' },
        {
          id: 'meeting',
          type: 'paragraph',
          props: {},
          content: '打开阅读窗口，可以编辑标题和正文。',
        },
        { id: 'receipt', type: 'bulletListItem', props: {}, content: '保存后更新确认版次' },
      ],
    },
  };
}

function todoValue(object: CanvasObject): TodoObjectSnapshot {
  return {
    id: object.id,
    revision: 1,
    title: object.label,
    items: [
      { id: 'review', text: '核对 Canvas 手势', checked: true },
      { id: 'verify', text: '复核待办编辑和排序', checked: false },
      { id: 'release', text: '确认修改回执', checked: false },
    ],
  };
}

function tableValue(object: CanvasObject): TableObjectValue {
  return {
    id: object.id,
    version: 1,
    width: object.geometry.width,
    data: {
      rows: [
        ['操作', '状态'],
        ['变形', '已验证'],
        ['保存', '待确认'],
      ],
      head: true,
    },
  };
}

function embedValue(object: CanvasObject): EmbedObjectValue {
  const { kind } = object;
  const html = kind === 'diagram' || kind === 'chart' ? embedMarkup[kind] : embedMarkup.html;

  return { id: object.id, title: object.label, html, version: 1, sourceRevision: 1, state: null };
}

function initialBody(object: CanvasObject): unknown {
  switch (object.kind) {
    case 'document':
      return documentValue(object.label);
    case 'todo':
      return todoValue(object);
    case 'table':
      return tableValue(object);
    case 'html':
    case 'diagram':
    case 'chart':
      return embedValue(object);
    case 'image':
      return { src: sampleImage };
    case 'video':
      return { src: sampleVideo, poster: sampleImage };
    case 'link':
      return { href: 'https://example.org' };
    case 'sticker':
      return { id: 'heart', fallback: '★' };
    case 'ink':
    case 'native':
      return undefined;
    case 'shape':
    case 'section':
    case 'connector':
    case 'text':
    case 'note':
      return { text: object.label };
    default:
      return undefined;
  }
}

export function samplePayload(object: CanvasObject): CanvasObjectPayload | undefined {
  const value = initialBody(object);

  return value === undefined ? undefined : { version: 1, value };
}
