import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Feedback } from '../../../contracts/studio.js';
import { EditorPopover } from '../editor-panels/EditorPopover.js';
import { isAttachmentPending } from './attachment.js';
import { CommentAuthorAvatar, commentAuthorKey, commentAuthorName } from './comment-author.js';
import type { CommentPoint } from './comment-target.js';
import './comment-clusters.css';

const hiddenAttribute = 'data-comment-clustered';
const clusterSelector = '[data-studio-comment-clusters]';

type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;
type Pin = { id: string; element: HTMLButtonElement; rect: Box; tip: CommentPoint };
type Cluster = { id: string; x: number; y: number; pins: Pin[] };

interface Props {
  containerRef: RefObject<HTMLElement | null>;
  activities: readonly Feedback[];
  activeFeedbackId?: string;
  onSelect?: (feedback: Feedback, point: CommentPoint) => void;
}

export function overlappingCommentGroups<T extends { rect: Box }>(pins: readonly T[]): T[][] {
  const parent = pins.map((_, index) => index);
  const byLeft = pins
    .map(({ rect }, index) => ({ rect, index }))
    .sort((a, b) => a.rect.left - b.rect.left);
  function find(index: number): number {
    while (index !== parent[index]) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }

    return index;
  }

  for (const [index, current] of byLeft.entries()) {
    for (let other = index + 1; other < byLeft.length; other++) {
      const candidate = byLeft[other]!;
      if (candidate.rect.left >= current.rect.right) {
        break;
      }

      if (candidate.rect.top < current.rect.bottom && current.rect.top < candidate.rect.bottom) {
        parent[find(candidate.index)] = find(current.index);
      }
    }
  }

  const groups = new Map<number, T[]>();
  for (const [index, pin] of pins.entries()) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    if (!group.length) {
      groups.set(root, group);
    }

    group.push(pin);
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

function intersect(a: Box, b: Box): Box | null {
  const result = {
    left: Math.max(a.left, b.left),
    right: Math.min(a.right, b.right),
    top: Math.max(a.top, b.top),
    bottom: Math.min(a.bottom, b.bottom),
  };

  return result.left < result.right && result.top < result.bottom ? result : null;
}

function visiblePins(
  container: HTMLElement,
  entries: ReadonlyMap<string, Feedback>,
  viewport: Box,
): Pin[] {
  const pins = new Map<string, Pin>();
  const scrollBounds = new Map<Element, Box>();
  const view = container.ownerDocument.defaultView;
  for (const element of container.querySelectorAll<HTMLButtonElement>(
    'button[data-feedback-pin]',
  )) {
    const id = element.dataset.feedbackPin;
    if (!id || !entries.has(id) || pins.has(id)) {
      continue;
    }
    if (!element.getClientRects().length) {
      continue;
    }

    const visibilityTarget = element.hasAttribute(hiddenAttribute)
      ? element.parentElement
      : element;
    const visibility = visibilityTarget && view?.getComputedStyle(visibilityTarget).visibility;
    if (visibility === 'hidden' || visibility === 'collapse') {
      continue;
    }

    const actual = element.getBoundingClientRect();
    let rect = intersect(actual, viewport);
    const scroller = element.closest('.studio-document-scroll');
    if (rect && scroller) {
      const bounds = scrollBounds.get(scroller) ?? scroller.getBoundingClientRect();
      scrollBounds.set(scroller, bounds);
      rect = intersect(rect, bounds);
    }
    if (rect) {
      pins.set(id, { id, element, rect, tip: { x: actual.left, y: actual.bottom } });
    }
  }

  return [...pins.values()];
}

function sameClusters(previous: readonly Cluster[], next: readonly Cluster[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((group, index) => {
      const other = next[index]!;

      return (
        group.id === other.id &&
        group.x === other.x &&
        group.y === other.y &&
        group.pins.every((pin, i) => {
          const candidate = other.pins[i]!;

          return (
            pin.element === candidate.element &&
            pin.tip.x === candidate.tip.x &&
            pin.tip.y === candidate.tip.y
          );
        })
      );
    })
  );
}

function ClusterMarker({
  group,
  entries,
  open,
  onToggle,
  onClose,
  onSelect,
}: {
  group: Cluster;
  entries: ReadonlyMap<string, Feedback>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (entry: Feedback, point: CommentPoint) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const authors = new Map<string, Feedback['author']>();
  for (const pin of group.pins) {
    const author = entries.get(pin.id)?.author;
    if (author) {
      authors.set(commentAuthorKey(author), author);
    }
    if (authors.size === 2) {
      break;
    }
  }

  const label = group.pins.length + ' 条备注';

  return (
    <div
      className="studio-comment-cluster-marker"
      style={{
        left: `clamp(0px, ${group.x}px, calc(100% - 104px))`,
        top: `max(28px, ${group.y}px)`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={button}
        type="button"
        className="studio-comment-cluster"
        data-native-interactive="true"
        data-comment-cluster={group.id}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={onToggle}
      >
        <span className="studio-comment-cluster-authors" aria-hidden="true">
          {[...authors].map(([key, author]) => (
            <CommentAuthorAvatar key={key} author={author} />
          ))}
        </span>
        <span>{group.pins.length} 条</span>
      </button>
      {open && (
        <EditorPopover
          id={id}
          title={label}
          anchorRef={button}
          onClose={onClose}
          className="studio-comment-cluster-chooser"
        >
          <ul
            className="studio-comment-cluster-list"
            aria-label="重叠的备注"
            data-native-interactive="true"
          >
            {group.pins.map((pin) => {
              const entry = entries.get(pin.id);
              if (!entry) {
                return null;
              }

              const phase = entry.status === 'processing' ? '处理中' : '';
              const status = [
                entry.status === 'resolved' ? '已解决' : phase,
                isAttachmentPending(entry) ? '待附加' : '',
              ]
                .filter(Boolean)
                .join(' · ');
              const handleSelect = () => {
                const rect = pin.element.getBoundingClientRect();
                const visible = rect.width > 0 && rect.height > 0;
                onSelect(entry, visible ? { x: rect.left, y: rect.bottom } : pin.tip);
              };

              return (
                <li key={pin.id}>
                  <button
                    type="button"
                    className="studio-comment-cluster-row"
                    data-comment-cluster-member={pin.id}
                    onClick={handleSelect}
                  >
                    <CommentAuthorAvatar author={entry.author} />
                    <span className="studio-comment-cluster-summary">
                      <strong>{commentAuthorName(entry.author)}</strong>
                      <span title={entry.text}>{entry.text}</span>
                      {status && <small>{status}</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </EditorPopover>
      )}
    </div>
  );
}

export function CommentClusters({ containerRef, activities, activeFeedbackId, onSelect }: Props) {
  const [groups, setGroups] = useState<Cluster[]>([]);
  const [openId, setOpenId] = useState<string>();
  const entries = useMemo(
    () => new Map(activities.map((entry) => [entry.id, entry])),
    [activities],
  );
  const current = useRef({ entries, activeFeedbackId });
  const queue = useRef<() => void>(() => {});

  useEffect(() => {
    const container = containerRef.current;
    const view = container?.ownerDocument.defaultView;
    if (!container || !view) {
      return;
    }

    const hidden = new Map<HTMLButtonElement, boolean>();
    let frame: number | undefined;

    function restore(pin: HTMLButtonElement, wasInert: boolean) {
      pin.removeAttribute(hiddenAttribute);
      if (!wasInert) {
        pin.removeAttribute('inert');
      }
    }

    const measure = () => {
      frame = undefined;
      const bounds = container.getBoundingClientRect();
      const { entries, activeFeedbackId } = current.current;
      const next: Cluster[] = [];
      const conceal = new Set<HTMLButtonElement>();
      if (bounds.width > 0 && bounds.height > 0 && entries.size > 1) {
        const pins = visiblePins(container, entries, bounds);
        const overlaps = overlappingCommentGroups(pins);
        for (const cluster of overlaps) {
          cluster.forEach((pin) => {
            if (pin.id !== activeFeedbackId) {
              conceal.add(pin.element);
            }
          });

          if (cluster.some((pin) => pin.id === activeFeedbackId)) {
            continue;
          }

          const first = cluster[0]!;
          next.push({
            id: JSON.stringify(cluster.map((pin) => pin.id).sort()),
            x: first.rect.left - bounds.left,
            y: first.rect.bottom - bounds.top,
            pins: cluster,
          });
        }
      }

      for (const [pin, wasInert] of hidden) {
        if (conceal.has(pin)) {
          continue;
        }

        restore(pin, wasInert);
        hidden.delete(pin);
      }

      for (const pin of conceal) {
        if (hidden.has(pin)) {
          continue;
        }

        hidden.set(pin, pin.hasAttribute('inert'));
        pin.setAttribute(hiddenAttribute, '');
        pin.setAttribute('inert', '');
      }

      setGroups((previous) => (sameClusters(previous, next) ? previous : next));
      setOpenId((previous) => (next.some((group) => group.id === previous) ? previous : undefined));
    };

    const schedule = () => {
      if (frame === undefined) {
        frame = view.requestAnimationFrame(measure);
      }
    };

    queue.current = schedule;
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(container);
    const mutations = new MutationObserver((records) => {
      if (
        records.some(({ target }) => {
          const element = target instanceof Element ? target : target.parentElement;

          return !element?.closest(clusterSelector);
        })
      ) {
        schedule();
      }
    });
    mutations.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'data-feedback-pin'],
    });
    const board = container.closest('.studio-whiteboard');
    if (board && board !== container) {
      mutations.observe(board, { attributes: true, attributeFilter: ['class'] });
    }

    container.addEventListener('scroll', schedule, true);
    container.addEventListener('load', schedule, true);
    view.addEventListener('resize', schedule);
    schedule();

    return () => {
      queue.current = () => {};

      if (frame !== undefined) {
        view.cancelAnimationFrame(frame);
      }

      mutations.disconnect();
      resize?.disconnect();
      container.removeEventListener('scroll', schedule, true);
      container.removeEventListener('load', schedule, true);
      view.removeEventListener('resize', schedule);
      for (const [pin, wasInert] of hidden) {
        restore(pin, wasInert);
      }
    };
  }, [containerRef]);

  useLayoutEffect(() => {
    current.current = { entries, activeFeedbackId };
    queue.current();
  }, [entries, activeFeedbackId]);

  const handleToggle = (id: string) => setOpenId((previous) => (previous === id ? undefined : id));
  const handleSelect = (entry: Feedback, point: CommentPoint) => {
    setOpenId(undefined);
    onSelect?.(entry, point);
  };

  return (
    <div className="studio-comment-clusters" data-studio-comment-clusters="">
      {groups.map((group) => (
        <ClusterMarker
          key={group.id}
          group={group}
          entries={entries}
          open={openId === group.id}
          onToggle={() => handleToggle(group.id)}
          onClose={() => setOpenId(undefined)}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}
