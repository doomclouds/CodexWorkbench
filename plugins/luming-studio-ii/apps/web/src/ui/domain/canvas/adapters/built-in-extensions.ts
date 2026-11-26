import type { ComponentType } from 'react';
import type {
  CanvasObjectCapabilities,
  CanvasObjectExtension,
  CanvasObjectKind,
  CanvasPlacement,
} from '../contracts.js';
import {
  CanvasConnectorFrame,
  CanvasInkFrame,
  CanvasSectionFrame,
  CanvasShapeFrame,
} from './built-in-frames.js';
import type { CanvasPrimitiveFrameProps } from './built-in-frames.js';

interface CanvasBuiltInExtension extends CanvasObjectExtension {
  readonly Frame?: ComponentType<CanvasPrimitiveFrameProps>;
  readonly usesZoom?: boolean;
}

const passiveBox: CanvasObjectCapabilities = Object.freeze({
  move: true,
  resize: true,
  rotate: true,
  connect: true,
  content: 'passive',
});
const detachedBox: CanvasObjectCapabilities = Object.freeze({ ...passiveBox, connect: false });
const nativeBox: CanvasObjectCapabilities = Object.freeze({ ...passiveBox, content: 'native' });
const embeddedBox: CanvasObjectCapabilities = Object.freeze({ ...passiveBox, content: 'embedded' });
const connectorCapabilities: CanvasObjectCapabilities = Object.freeze({
  ...detachedBox,
  resize: false,
  rotate: false,
});

function placementDefinition(placement: CanvasPlacement, capabilities: CanvasObjectCapabilities) {
  return { kind: placement.kind, placement, capabilities };
}

const builtInDefinitions: readonly CanvasBuiltInExtension[] = [
  {
    kind: 'shape',
    placement: {
      kind: 'shape',
      shape: 'rounded',
      label: '',
      width: 208,
      height: 112,
      fill: '#EFEFEF',
      stroke: 'transparent',
    },
    capabilities: passiveBox,
    Frame: CanvasShapeFrame,
    portClick: 'connect',
  },
  {
    kind: 'section',
    placement: {
      kind: 'section',
      label: '分区',
      width: 600,
      height: 360,
      fill: '#EFEFEF',
      stroke: '#9ca3af',
    },
    capabilities: detachedBox,
    Frame: CanvasSectionFrame,
    blocksPlacement: false,
    usesZoom: true,
  },
  {
    kind: 'ink',
    capabilities: detachedBox,
    Frame: CanvasInkFrame,
    usesZoom: true,
    blocksPlacement: false,
  },
  {
    kind: 'connector',
    capabilities: connectorCapabilities,
    Frame: CanvasConnectorFrame,
    blocksPlacement: false,
  },
  placementDefinition(
    { kind: 'text', label: '', width: 300, height: 70, fill: 'transparent' },
    passiveBox,
  ),
  {
    ...placementDefinition(
      { kind: 'note', label: '', width: 208, height: 184, fill: '#F9E56F' },
      passiveBox,
    ),
    portClick: 'place',
  },
  {
    ...placementDefinition({ kind: 'sticker', label: '贴纸', width: 120, height: 100 }, passiveBox),
    blocksPlacement: false,
  },
  placementDefinition({ kind: 'native', label: '内容', width: 280, height: 180 }, nativeBox),
  placementDefinition({ kind: 'document', label: '文档', width: 280, height: 220 }, nativeBox),
  placementDefinition({ kind: 'todo', label: '待办', width: 278, height: 180 }, nativeBox),
  placementDefinition({ kind: 'table', label: '表格', width: 288, height: 212 }, nativeBox),
  placementDefinition({ kind: 'image', label: '图片', width: 250, height: 180 }, nativeBox),
  placementDefinition({ kind: 'video', label: '视频', width: 250, height: 180 }, nativeBox),
  placementDefinition({ kind: 'link', label: '链接', width: 240, height: 100 }, nativeBox),
  placementDefinition({ kind: 'html', label: 'HTML', width: 288, height: 220 }, embeddedBox),
  placementDefinition({ kind: 'diagram', label: '图解', width: 288, height: 220 }, embeddedBox),
  placementDefinition({ kind: 'chart', label: '图表', width: 288, height: 220 }, embeddedBox),
];

const defaults = Object.freeze(
  builtInDefinitions.map((definition) =>
    Object.freeze({
      ...definition,
      placement: definition.placement && Object.freeze(definition.placement),
    }),
  ),
);
const defaultsByKind = new Map(defaults.map((definition) => [definition.kind, definition]));

export const builtInObjectExtensions: readonly CanvasObjectExtension[] = defaults;

export function builtInFrame(kind: CanvasObjectKind) {
  return defaultsByKind.get(kind);
}
