import type { ComponentType, ReactNode } from 'react';
import type { ResolvedConnection } from '../connectors/geometry.js';
import type { CanvasGeometry, CanvasObjectCapabilities, CanvasObjectDraft } from '../contracts.js';
import type { CanvasPrimitiveFrameProps } from './built-in-frames.js';
import {
  embedCaptionFont,
  embedCaptionGap,
  embedCaptionHeight,
  type EmbedCaptionPlacement,
} from './caption-metrics.js';
import './CanvasObjectContent.css';

interface CanvasObjectContentProps {
  readonly object: CanvasObjectDraft;
  readonly geometry: CanvasGeometry;
  readonly zoom: number;
  readonly content?: ReactNode;
  readonly connectorRoute?: ResolvedConnection;
  readonly interactive: boolean;
  readonly inert: boolean;
  readonly ownsFrame: boolean;
  readonly canEdit: boolean;
  readonly locked: boolean;
  readonly selected: boolean;
  readonly sectionCaptionWidth?: number;
  readonly embedCaption?: EmbedCaptionPlacement;
  readonly mode: CanvasObjectCapabilities['content'];
  readonly Frame?: ComponentType<CanvasPrimitiveFrameProps>;
}

const draggableBodyKinds = new Set<CanvasObjectDraft['kind']>(['link', 'image', 'table']);
const namedFrames = new Map<CanvasObjectDraft['kind'], string>([
  ['html', 'HTML 图解'],
  ['diagram', '图解'],
  ['chart', '图表'],
  ['video', '视频'],
]);

function FrameDragCaption({
  object,
  zoom,
  canEdit,
  locked,
}: Pick<CanvasObjectContentProps, 'object' | 'zoom' | 'canEdit' | 'locked'>) {
  const scale = 1 / zoom;
  const name = namedFrames.get(object.kind) ?? '嵌入对象';

  return (
    <div
      className="studio-ui-canvas-embedded-title"
      data-canvas-external-title=""
      style={{
        bottom: `calc(100% + ${embedCaptionGap * scale}px)`,
        transform: `scale(${scale})`,
      }}
    >
      <button
        className="studio-ui-canvas-embedded-grip"
        data-canvas-drag-surface="title"
        type="button"
        aria-label={`移动 ${name}`}
        title={locked ? `${name}位置已锁定` : `拖动把手移动 ${name}`}
        disabled={!canEdit || locked}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="9" cy="6" r="1" />
          <circle cx="15" cy="6" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="9" cy="18" r="1" />
          <circle cx="15" cy="18" r="1" />
        </svg>
      </button>
    </div>
  );
}

function EmbedCaption({
  label,
  placement,
  zoom,
  grip,
}: {
  readonly label: string;
  readonly placement: EmbedCaptionPlacement;
  readonly zoom: number;
  readonly grip: boolean;
}) {
  const above = placement === 'above';
  const gap = embedCaptionGap / zoom;
  const height = embedCaptionHeight(zoom) / zoom;

  return (
    <strong
      className="studio-ui-canvas-embed-caption"
      data-canvas-embed-caption={placement}
      data-canvas-external-title={above ? '' : undefined}
      style={{
        fontSize: embedCaptionFont(zoom) / zoom,
        lineHeight: `${height}px`,
        insetBlockEnd: above ? `calc(100% + ${gap}px)` : undefined,
        insetInlineStart: above && grip ? 30 / zoom : 0,
        paddingInline: above ? 0 : 4 / zoom,
      }}
      title={label}
    >
      {label}
    </strong>
  );
}

export function CanvasObjectContent({
  object,
  geometry,
  zoom,
  content,
  connectorRoute,
  interactive,
  inert,
  ownsFrame,
  canEdit,
  locked,
  selected,
  sectionCaptionWidth,
  embedCaption,
  mode,
  Frame,
}: CanvasObjectContentProps) {
  const showCaption = mode === 'passive';
  const primitive = Frame && (
    <Frame
      object={object}
      geometry={geometry}
      zoom={zoom}
      connectorRoute={connectorRoute}
      content={showCaption ? content : undefined}
      showCaption={showCaption}
      selected={selected}
      sectionCaptionWidth={sectionCaptionWidth}
    />
  );

  const hasGrip = ownsFrame && selected && (mode === 'embedded' || object.kind === 'video');
  const canDragBody = ownsFrame && draggableBodyKinds.has(object.kind);

  if (showCaption) {
    return (
      primitive ?? <div className="studio-ui-canvas-object-label">{content ?? object.label}</div>
    );
  }

  return (
    <>
      {primitive}
      {!ownsFrame && <div className="studio-ui-canvas-native-title">{object.label}</div>}
      <div
        className="studio-ui-canvas-native-content"
        data-canvas-native={interactive ? '' : undefined}
        data-canvas-owned-frame={ownsFrame ? '' : undefined}
        data-canvas-drag-surface={canDragBody ? 'body' : undefined}
        inert={inert}
      >
        {content}
      </div>
      {hasGrip && (
        <FrameDragCaption object={object} zoom={zoom} canEdit={canEdit} locked={locked} />
      )}
      {embedCaption && ownsFrame && (
        <EmbedCaption label={object.label} placement={embedCaption} zoom={zoom} grip={hasGrip} />
      )}
    </>
  );
}
