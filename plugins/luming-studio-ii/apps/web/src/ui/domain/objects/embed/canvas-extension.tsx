import { useMemo, useRef, useState } from 'react';

import { StatusText } from '../../../base/index.js';
import type {
  CanvasObjectExtension,
  CanvasObjectOperation,
  CanvasObjectPayload,
  CanvasObjectViewProps,
} from '../../canvas/index.js';
import { EmbedObject } from './EmbedObject.js';
import type {
  EmbedJson,
  EmbedKind,
  EmbedNavigationEvent,
  EmbedObjectProps,
  EmbedObjectValue,
  EmbedSelection,
  EmbedSourceDraft,
} from './contracts.js';
import { isEmbedJson } from './state.js';

interface EmbedProjection {
  version: number;
  value: EmbedObjectValue;
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasOptionalText(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function readProjection(payload: CanvasObjectPayload | undefined, id: string | undefined) {
  if (!payload || !isVersion(payload.version)) {
    return undefined;
  }

  const value = payload.value;
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.id !== id || typeof id !== 'string' || !isVersion(record.version)) {
    return undefined;
  }

  const source = record.sourceRevision === undefined || isVersion(record.sourceRevision);
  const text = hasOptionalText(record.title) && hasOptionalText(record.html);
  const state = record.state === undefined || isEmbedJson(record.state);

  return source && text && state
    ? { version: payload.version, value: value as EmbedObjectValue }
    : undefined;
}

function preferNewer(
  latest: EmbedProjection,
  current: EmbedProjection | undefined,
): EmbedProjection {
  if (!current || current.value.id !== latest.value.id) {
    return latest;
  }
  if (latest.version !== current.version) {
    return latest.version > current.version ? latest : current;
  }

  const latestSource = latest.value.sourceRevision ?? latest.value.version;
  const currentSource = current.value.sourceRevision ?? current.value.version;

  return latestSource >= currentSource ? latest : current;
}

function fraction(value: number, start: number, size: number) {
  return size > 0 ? Math.max(0, Math.min(1, (value - start) / size)) : 0.5;
}

function readAnnotationLocations(
  tracking: CanvasObjectViewProps['contentTracking'],
  sourceRevision: number | undefined,
): EmbedObjectProps['annotationLocations'] {
  if (!tracking || sourceRevision === undefined) {
    return undefined;
  }

  const revision = BigInt(sourceRevision);
  const nodes = new Map<string, (typeof tracking.requests)[number]>();
  for (const request of tracking.requests) {
    const { target } = request;
    const first = target.kind === 'html' && target.sourceRevision === revision && target.nodeIds[0];
    if (first) {
      nodes.set(request.id, request);
    }
  }
  const nodeId = (request: (typeof tracking.requests)[number]) =>
    request.target.kind === 'html' ? request.target.nodeIds[0] : undefined;
  const revealed = [...nodes.values()].find(({ reveal }) => reveal !== undefined);
  const revealId = revealed && nodeId(revealed);
  const ids = [...new Set([...nodes.values()].map(nodeId).filter((id) => id !== undefined))];

  return {
    nodeIds: ids,
    reveal:
      revealId && revealed?.reveal !== undefined
        ? { nodeId: revealId, sequence: revealed.reveal }
        : undefined,
    onChange(points) {
      tracking.report(
        new Map(
          [...nodes].flatMap(([id, request]) => {
            const node = nodeId(request);
            const point = node === undefined ? undefined : points.get(node);

            return point === undefined ? [] : [[id, { point, reveal: request.reveal }]];
          }),
        ),
      );
    },
  };
}

function CanvasEmbedView(props: CanvasObjectViewProps) {
  const {
    object,
    payload,
    id,
    interactive,
    readOnly,
    editRequest,
    readHtmlSource,
    zoom,
    request,
    onNavigation,
    onRetentionChange,
    annotationActive,
    onAnnotateContent,
    contentTracking,
  } = props;
  const known = useMemo(() => readProjection(payload, id), [id, payload]);
  const [accepted, setAccepted] = useState<EmbedProjection>();
  const host = useRef<HTMLDivElement>(null);
  const current = known && preferNewer(known, accepted);
  const revision = current?.value.sourceRevision ?? current?.value.version;
  const annotationLocations = useMemo(
    () => readAnnotationLocations(contentTracking, revision),
    [contentTracking, revision],
  );

  if (!current) {
    return <StatusText message="暂未取得嵌入对象正文" announcement="polite" />;
  }

  const { value, version } = current;
  const kind = object.kind === 'diagram' || object.kind === 'chart' ? object.kind : 'html';

  async function requestValue(operation: CanvasObjectOperation) {
    const receipt = await request(operation);
    if (!receipt.ok) {
      throw new Error(receipt.message);
    }

    const confirmed = readProjection(receipt.payload, id);
    if (!confirmed) {
      throw new Error('嵌入对象回执缺少有效正文。');
    }

    setAccepted((previous) => preferNewer(confirmed, previous));

    return confirmed.value;
  }

  async function saveState(state: EmbedJson, expectedVersion: number) {
    const confirmed = await requestValue({
      name: 'embed.save-state',
      expectedVersion,
      value: { state },
    });

    return { state: confirmed.state ?? null, version: confirmed.version };
  }

  async function saveSource(draft: EmbedSourceDraft, expectedSourceRevision: number) {
    await requestValue({
      name: 'embed.save-source',
      expectedVersion: version,
      value: { ...draft, expectedSourceRevision },
    });
  }

  function handleNavigation(event: EmbedNavigationEvent) {
    if (event.kind !== 'zoom') {
      onNavigation?.(event);
      return;
    }

    const frame = host.current?.querySelector('iframe');
    const bounds = frame?.getBoundingClientRect();
    if (bounds) {
      onNavigation?.({
        ...event,
        x: bounds.left + event.x * bounds.width,
        y: bounds.top + event.y * bounds.height,
      });
    }
  }

  function handleContentSelection(selection: EmbedSelection) {
    if (!onAnnotateContent) {
      return;
    }

    const bounds = host.current?.getBoundingClientRect();
    const { screenPoint, sourceRevision, targetIds } = selection;
    if (targetIds.length === 0 && !screenPoint) {
      return;
    }

    const u = bounds && screenPoint ? fraction(screenPoint.x, bounds.left, bounds.width) : 0.5;
    const v = bounds && screenPoint ? fraction(screenPoint.y, bounds.top, bounds.height) : 0.5;
    const target =
      targetIds.length > 0
        ? { kind: 'html' as const, nodeIds: targetIds, sourceRevision: BigInt(sourceRevision) }
        : { kind: 'object' as const };
    onAnnotateContent({
      target,
      u,
      v,
    });
  }

  return (
    <div className="studio-ui-embed__canvas-view" ref={host}>
      <EmbedObject
        kind={kind}
        value={value}
        interactive={interactive}
        annotation={Boolean(annotationActive && onAnnotateContent)}
        editRequest={editRequest}
        useCanvasTools
        readHtmlSource={readHtmlSource}
        zoom={zoom}
        preserveScroll
        onNavigation={onNavigation ? handleNavigation : undefined}
        onSelection={onAnnotateContent ? handleContentSelection : undefined}
        annotationLocations={annotationLocations}
        onRetentionChange={onRetentionChange}
        onSaveState={readOnly ? undefined : saveState}
        onSaveSource={readOnly ? undefined : saveSource}
      />
    </div>
  );
}

function embedExtension(kind: EmbedKind, label: string, width: number, height: number) {
  return {
    kind,
    activateOnDoubleClick: false,
    capabilities: { content: 'embedded', move: true, resize: true, rotate: false, connect: true },
    placement: { kind, label, width, height },
    View: CanvasEmbedView,
  } satisfies CanvasObjectExtension;
}

export const htmlExtension = embedExtension('html', 'HTML 图解', 1440, 1120);
export const diagramExtension = embedExtension('diagram', '图解', 288, 220);
export const chartExtension = embedExtension('chart', '图表', 288, 220);
