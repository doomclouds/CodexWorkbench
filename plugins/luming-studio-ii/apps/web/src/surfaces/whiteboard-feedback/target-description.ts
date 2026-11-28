import type { FeedbackTarget } from '../../data/feedback/index.js';
import type { FeedbackCanvasObject } from './contracts.js';

const objectLabels: Readonly<Record<string, string>> = {
  chart: '图表',
  connector: '连接线',
  diagram: '图解',
  document: '文档',
  embed: '网页嵌入',
  html: '网页嵌入',
  image: '图片',
  ink: '笔迹',
  link: '链接',
  note: '便签',
  section: '分区',
  shape: '形状',
  sticker: '贴纸',
  table: '表格',
  text: '文字',
  todo: '任务清单',
  video: '视频',
};

const contentLabels = { document: '文档段落', todo: '待办事项', html: 'HTML 内部选区' };
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function truncate(text: string, max: number) {
  let count = 0;
  let last = 0;
  for (const { index } of graphemes.segment(text)) {
    if (count === max) {
      return text.slice(0, last) + '…';
    }

    count += 1;
    last = index;
  }

  return text;
}

export function feedbackDraftExcerpt(text?: string) {
  return text?.trim() ? truncate(text.trim(), 180) : undefined;
}

export function describeFeedbackTarget(
  target: FeedbackTarget,
  object?: Pick<FeedbackCanvasObject, 'kind' | 'label'>,
) {
  if (target.kind === 'board') {
    return '画板位置';
  }

  const objectKind = object?.kind && Object.hasOwn(objectLabels, object.kind) ? object.kind : '';
  const kind =
    target.kind === 'content'
      ? contentLabels[target.content.kind]
      : (objectLabels[objectKind] ?? '对象');
  const label = truncate(object?.label.replace(/\s+/gu, ' ').trim() ?? '', 40);

  return label && label !== kind ? kind + ' · ' + label : kind;
}
