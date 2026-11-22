import {
  memo,
  useCallback,
  useMemo,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { BoardElement, StyleProfile } from '../../../../../contracts/studio.js';
import {
  nativeBackdrop,
  nativeFill,
  nativeTableInk,
  nativeTextInk,
  type NativeSurfaceScene,
} from '../../../../../shared/native-surface.js';
import { semanticColor } from '../../../../../shared/theme.js';
import type { ArrowElementIndex } from '../../../../../shared/whiteboard-geometry.js';
import {
  canReadCanvasText,
  mediaControlsFit,
  overviewStrokeWidth,
  projectedSize,
  showHtmlCaption,
} from '../scene/canvas-presentation.js';
import { nativePaint } from '../scene/native-palette.js';
import { useCommittedRef } from '../useCommittedRef.js';
import CanvasArrow from './CanvasArrow.js';
import {
  CanvasObjectContent,
  type CanvasObjectAssets,
  type CanvasSectionTitle,
} from './CanvasObjectContent.js';

export function isHtmlEmbed(element: BoardElement): boolean {
  return (
    element.type === 'html' || (element.type === 'diagram' && typeof element.html === 'string')
  );
}

export function hasCanvasRegion(element: BoardElement): boolean {
  return isHtmlEmbed(element) || ['document', 'todo', 'table'].includes(element.type);
}

export function keepsCanvasObjectMounted(element: BoardElement): boolean {
  return hasCanvasRegion(element) || Boolean(element.video);
}

export interface CanvasObjectScene {
  zoom: number;
  presentationZoom: number;
  theme: 'light' | 'dark';
  style: StyleProfile;
  surfaces: NativeSurfaceScene;
  arrows: ArrowElementIndex;
  assets: CanvasObjectAssets;
  assetRevision: number;
}

export interface CanvasObjectView {
  picked: boolean;
  hidden: boolean;
  expanded: boolean;
  annotationHovered: boolean;
  inlineSelected: boolean;
  htmlMovable: boolean;
  sectionTitle?: CanvasSectionTitle;
}

export interface CanvasRegionView {
  size: { w: number; h: number };
  fontSize: number;
  fill: string;
  ink: string;
  headerInk: string;
}

interface CanvasObjectActions {
  clickCapture(event: MouseEvent): void;
  pointerDown(event: PointerEvent<Element>, element: BoardElement): void;
  doubleClick(event: MouseEvent<HTMLDivElement>, element: BoardElement): void;
  arrowDoubleClick(event: MouseEvent<SVGPathElement>, element: BoardElement): void;
  moveRegion(event: PointerEvent<Element>, element: BoardElement): void;
}

interface CanvasObjectProps {
  element: BoardElement;
  scene: CanvasObjectScene;
  view: CanvasObjectView;
  actions: CanvasObjectActions;
  editor?: ReactNode;
  region?: (view: CanvasRegionView) => ReactNode;
  onRetain?: (id: string) => void;
}

export function useCanvasObjectActions(actions: CanvasObjectActions): CanvasObjectActions {
  const current = useCommittedRef(actions);
  return useMemo<CanvasObjectActions>(
    () => ({
      clickCapture: (event) => current.current.clickCapture(event),
      pointerDown: (event, element) => current.current.pointerDown(event, element),
      doubleClick: (event, element) => current.current.doubleClick(event, element),
      arrowDoubleClick: (event, element) => current.current.arrowDoubleClick(event, element),
      moveRegion: (event, element) => current.current.moveRegion(event, element),
    }),
    [current],
  );
}

function elementInk(
  element: BoardElement,
  color: unknown,
  style: StyleProfile,
  fill: string,
  backdrop: string,
): string {
  if (element.type === 'table') {
    return nativeTableInk(color, style, style.paper);
  }
  if (element.type === 'sticker') {
    return semanticColor(color, style, style.ink);
  }

  return nativeTextInk(color, style, element.type === 'container' ? 'transparent' : fill, backdrop);
}

function CanvasObjectViewImpl({
  element,
  scene,
  view,
  actions,
  editor,
  region,
  onRetain,
}: CanvasObjectProps) {
  const { zoom, presentationZoom, theme, style: viewStyle, arrows } = scene;
  const dash = element.dash && presentationZoom * 5 >= 1 ? '6 5' : undefined;
  const lineColor = semanticColor(
    nativePaint(element.stroke ?? element.color, theme),
    viewStyle,
    viewStyle.muted,
  );

  if (element.type === 'arrow') {
    return (
      <CanvasArrow
        key={element.id}
        element={element}
        elementIndex={arrows}
        hidden={view.hidden}
        selected={view.picked}
        annotationHovered={view.annotationHovered}
        expanded={view.expanded}
        editing={editor !== undefined}
        editLabel={editor}
        color={view.picked ? viewStyle.accent : lineColor}
        paper={viewStyle.paper}
        dash={dash}
        zoom={zoom}
        presentationZoom={presentationZoom}
        onClickCapture={actions.clickCapture}
        onPointerDown={(event) => actions.pointerDown(event, element)}
        onDoubleClick={(event) => actions.arrowDoubleClick(event, element)}
      />
    );
  }

  return (
    <CanvasObjectFrame
      element={element}
      scene={scene}
      view={view}
      actions={actions}
      editor={editor}
      region={region}
      onRetain={onRetain}
      lineColor={lineColor}
      dash={dash}
    />
  );
}

function unchangedView(previous: CanvasObjectView, next: CanvasObjectView) {
  const selection =
    previous.picked === next.picked && previous.inlineSelected === next.inlineSelected;
  const reading = previous.expanded === next.expanded && previous.hidden === next.hidden;
  const annotation = previous.annotationHovered === next.annotationHovered;

  return (
    selection &&
    reading &&
    annotation &&
    previous.htmlMovable === next.htmlMovable &&
    previous.sectionTitle === next.sectionTitle
  );
}

export const CanvasObject = memo(CanvasObjectViewImpl, (previous, next) => {
  const object =
    previous.element === next.element && unchangedScene(previous.scene, next.scene, next.element);
  const controls = previous.actions === next.actions && previous.onRetain === next.onRetain;
  const content = previous.editor === next.editor && previous.region === next.region;

  return object && controls && content && unchangedView(previous.view, next.view);
});

function unchangedScene(
  previous: CanvasObjectScene,
  next: CanvasObjectScene,
  element: BoardElement,
) {
  if (previous === next) {
    return true;
  }

  const liveZoom =
    hasCanvasRegion(element) || ['arrow', 'stroke', 'container'].includes(element.type);

  if (liveZoom && previous.zoom !== next.zoom) {
    return false;
  }

  const palette = previous.style === next.style && previous.theme === next.theme;
  const appearance =
    previous.presentationZoom === next.presentationZoom && previous.surfaces === next.surfaces;
  const media = previous.assets === next.assets || element.type !== 'image';
  const references = previous.arrows === next.arrows || element.type !== 'arrow';
  const mediaRevision = previous.assetRevision === next.assetRevision || element.type !== 'image';

  return palette && appearance && media && references && mediaRevision;
}

interface CanvasObjectFrameProps extends CanvasObjectProps {
  lineColor: string;
  dash?: string;
}

function CanvasObjectFrame({
  element,
  scene,
  view,
  actions,
  editor,
  region,
  onRetain,
  lineColor,
  dash,
}: CanvasObjectFrameProps) {
  const { zoom, presentationZoom, theme, style: viewStyle, surfaces, assets } = scene;
  const { picked, expanded, sectionTitle } = view;
  const isEditing = editor !== undefined;
  const size = projectedSize(element, presentationZoom);
  const fontSize = element.fontSize ?? 17;
  const showText = expanded || isEditing || canReadCanvasText(size, fontSize, presentationZoom);
  const showMediaControls = expanded || mediaControlsFit(size);
  const fill = nativeFill(element, viewStyle, nativePaint(element.fill, theme));
  const color = nativePaint(element.color, theme);
  const backdrop = nativeBackdrop(element, surfaces, fill);
  const ink = elementInk(element, color, viewStyle, fill, backdrop);
  const headerInk = element.type === 'table' ? nativeTableInk(color, viewStyle, fill) : ink;
  const textIsVisible =
    element.type === 'container' ? expanded || isEditing || Boolean(sectionTitle) : showText;
  const retain = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        onRetain?.(element.id);
      }
    },
    [onRetain, element.id],
  );

  return (
    <div
      key={element.id}
      ref={onRetain ? retain : undefined}
      className={`studio-board-element studio-element-${element.type}${picked ? ' is-selected' : ''}${element.locked ? ' is-locked' : ''}${isEditing ? ' is-editing' : ''}`}
      data-element-id={element.id}
      title={!textIsVisible && element.text ? element.text.slice(0, 160) : undefined}
      style={canvasObjectStyle(element, scene, view, { fontSize, ink, fill, lineColor, dash })}
      onClickCapture={actions.clickCapture}
      onPointerDown={(event) => actions.pointerDown(event, element)}
      onDoubleClick={(event) => actions.doubleClick(event, element)}
    >
      {region?.({ size, fontSize, fill, ink, headerInk }) ?? (
        <CanvasObjectContent
          element={element}
          assets={assets}
          zoom={zoom}
          viewStyle={viewStyle}
          editor={editor}
          expanded={expanded}
          showText={showText}
          showMediaControls={showMediaControls}
          sectionTitle={sectionTitle}
          lineColor={lineColor}
          dash={dash}
          fill={fill}
          color={color}
          backdrop={backdrop}
        />
      )}
      {isHtmlEmbed(element) && (
        <CanvasHtmlControls
          element={element}
          zoom={zoom}
          view={view}
          moveRegion={actions.moveRegion}
        />
      )}
    </div>
  );
}

interface ObjectPaint {
  fontSize: number;
  ink: string;
  fill: string;
  lineColor: string;
  dash?: string;
}

function canvasObjectStyle(
  element: BoardElement,
  scene: CanvasObjectScene,
  view: CanvasObjectView,
  paint: ObjectPaint,
): CSSProperties {
  const { fontSize, ink, fill, lineColor, dash } = paint;
  const style: CSSProperties = {
    display: view.hidden ? 'none' : undefined,
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    color: ink,
    fontSize,
    fontFamily: element.fontFamily || scene.style.fontFamily,
    fontWeight: element.bold ? 600 : 400,
    fontStyle: element.italic ? 'italic' : 'normal',
    textAlign: element.textAlign ?? (element.type === 'shape' ? 'center' : 'left'),
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
  };

  if (element.type !== 'container') {
    return style;
  }

  return {
    ...style,
    borderColor: lineColor,
    borderStyle: element.dash && (view.expanded || dash) ? 'dashed' : 'solid',
    borderWidth: overviewStrokeWidth(element.strokeWidth ?? 1, scene.zoom),
    background: fill !== 'transparent' ? fill : undefined,
  };
}

interface CanvasHtmlControlsProps {
  element: BoardElement;
  zoom: number;
  view: CanvasObjectView;
  moveRegion: CanvasObjectActions['moveRegion'];
}

function CanvasHtmlControls({ element, zoom, view, moveRegion }: CanvasHtmlControlsProps) {
  const captionScale = Math.min(1 / zoom, 1);

  return (
    <>
      {view.inlineSelected && view.htmlMovable && (
        <div
          className="studio-html-move-edge"
          aria-hidden="true"
          style={{ height: Math.min(6 / zoom, element.h / 4) }}
          onPointerDown={(event) => moveRegion(event, element)}
        />
      )}
      {showHtmlCaption(element, zoom) && (
        <div
          className="studio-html-caption"
          data-canvas-external-title=""
          style={{
            bottom: `calc(100% + ${8 * captionScale}px)`,
            width: element.w / captionScale,
            transform: `scale(${captionScale})`,
          }}
          onPointerDown={view.htmlMovable ? (event) => moveRegion(event, element) : undefined}
        >
          <strong title={element.text}>{element.text || 'HTML 图解'}</strong>
        </div>
      )}
    </>
  );
}
