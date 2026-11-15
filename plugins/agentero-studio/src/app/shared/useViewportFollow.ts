import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CollaborationRoom, Presence } from '../../contracts/studio';
import type { StudioDocument, Viewport } from '../products';
import { ParticipantActivity } from './presence-members';
import { activeAgentTasks, agentPeerBounds, documentElements, type ActivityBounds } from './agent-activity';

export function fitFollowViewport(viewport: Viewport, remote: { w: number; h: number }, local: { w: number; h: number }): Viewport | undefined {
  if (![viewport.x, viewport.y, viewport.zoom, remote.w, remote.h, local.w, local.h].every(Number.isFinite) || viewport.zoom <= 0 || remote.w <= 0 || remote.h <= 0 || local.w <= 0 || local.h <= 0) return;
  const width = remote.w / viewport.zoom, height = remote.h / viewport.zoom;
  const x = -viewport.x / viewport.zoom + width / 2, y = -viewport.y / viewport.zoom + height / 2;
  const zoom = Math.max(.1, Math.min(4, local.w / width, local.h / height));
  return { x: local.w / 2 - x * zoom, y: local.h / 2 - y * zoom, zoom };
}
export function fitAgentArea(bounds: ActivityBounds, local: { w: number; h: number }): Viewport {
  const margin = Math.min(48, local.w / 6, local.h / 6), zoom = Math.max(.1, Math.min(1, (local.w - margin * 2) / bounds.w, (local.h - margin * 2) / bounds.h));
  return { x: local.w / 2 - (bounds.x + bounds.w / 2) * zoom, y: local.h / 2 - (bounds.y + bounds.h / 2) * zoom, zoom };
}
export function useViewportFollow({ actorId, peerId, peers, following, room, area, busy, onStop, currentViewport, document, clockOffsetMs = 0 }: { actorId: string; peerId: string; peers: Presence[]; following: string; room: CollaborationRoom; area: RefObject<HTMLElement | null>; busy: boolean; onStop: () => void; currentViewport?: Viewport; document?: StudioDocument | null; clockOffsetMs?: number }) {
  const tracker = useRef(new ParticipantActivity()), [viewport, setViewport] = useState<Viewport>(), seq = useRef(0), began = useRef(0);
  const ownView = useRef(currentViewport); ownView.current = currentViewport;
  const rendered = useRef<Viewport | undefined>(undefined), target = useRef<Viewport | undefined>(undefined), animation = useRef<number | undefined>(undefined);
  const deadline = useRef<number | undefined>(undefined), lastPeer = useRef<Presence | undefined>(undefined);
  const agentEnded = useRef(false);
  const request = (frame: FrameRequestCallback) => window.requestAnimationFrame ? window.requestAnimationFrame(frame) : window.setTimeout(() => frame(performance.now()), 16);
  const cancelMotion = useCallback(() => { if (animation.current !== undefined) { if (window.cancelAnimationFrame) window.cancelAnimationFrame(animation.current); else window.clearTimeout(animation.current); animation.current = undefined; } }, []);
  const stop = useCallback(() => { cancelMotion(); target.current = undefined; rendered.current = undefined; setViewport(undefined); }, [cancelMotion]);
  const [sizeRevision, resize] = useState(0), [clockRevision, tick] = useState(0);
  const now = Date.now() + clockOffsetMs, elements = documentElements(document);
  const member = tracker.current.read(peers, actorId).find(item => item.actor.id === following);
  const agent = member?.actor.kind === 'agent';
  const peer = member?.peers.find(page => page.visible !== false && (agent ? !!agentPeerBounds(page, elements, now) : !!page.context?.viewport));
  const taskExpiry = agent ? Math.min(...(member?.peers.flatMap(page => activeAgentTasks(page, now).map(task => task.expiresAt)) ?? [])) : Infinity;
  useEffect(() => { if (!Number.isFinite(taskExpiry)) return; const timer = setTimeout(() => tick(value => value + 1), Math.max(1, taskExpiry - (Date.now() + clockOffsetMs))); return () => clearTimeout(timer); }, [taskExpiry, clockOffsetMs]);
  useEffect(() => { began.current = Date.now(); deadline.current = undefined; agentEnded.current = false; }, [following]);
  useEffect(() => () => cancelMotion(), [cancelMotion]);
  useEffect(() => {
    const node = area.current; if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => resize(value => value + 1)); observer.observe(node); return () => observer.disconnect();
  }, [area, following]);
  useEffect(() => {
    if (!following) { stop(); lastPeer.current = undefined; return; }
    if (!peer) {
      if (agent || lastPeer.current?.actor.kind === 'agent') { if (!agentEnded.current) { agentEnded.current = true; stop(); onStop(); } return; }
      cancelMotion(); deadline.current ??= Date.now() + 1000;
      const timeout = setTimeout(onStop, Math.max(0, deadline.current - Date.now()));
      return () => clearTimeout(timeout);
    }
    deadline.current = undefined; agentEnded.current = false; lastPeer.current = peer;
    const ownPeers = new Set(peers.filter(page => page.actor.id === actorId).map(page => page.peerId)); ownPeers.add(peerId);
    if (peer.following && ownPeers.has(peer.following)) {
      const timer = setTimeout(onStop, Math.max(0, 1500 - (Date.now() - began.current))); return () => clearTimeout(timer);
    }
    if (busy) { cancelMotion(); return; }
    const remote = peer.context?.surface as { w?: number; h?: number } | undefined;
    const local = { w: area.current?.clientWidth || window.innerWidth, h: area.current?.clientHeight || window.innerHeight };
    const bounds = agent ? agentPeerBounds(peer, elements, now) : undefined;
    const next = bounds ? fitAgentArea(bounds, local) : fitFollowViewport(peer.context!.viewport!, { w: remote?.w || local.w, h: remote?.h || local.h }, local);
    if (!next) return;
    const same = (a: Viewport | undefined, b: Viewport) => !!a && Math.abs(a.x - b.x) < .1 && Math.abs(a.y - b.y) < .1 && Math.abs(a.zoom - b.zoom) < .001;
    if (same(target.current, next) && (animation.current !== undefined || same(rendered.current, next))) return;
    cancelMotion(); target.current = next;
    const from = rendered.current || ownView.current;
    if (!from || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { rendered.current = next; setViewport(next); return; }
    const start = performance.now();
    const frame = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - start) / 90)), eased = progress * progress * (3 - 2 * progress);
      const value = { x: from.x + (next.x - from.x) * eased, y: from.y + (next.y - from.y) * eased, zoom: from.zoom + (next.zoom - from.zoom) * eased };
      rendered.current = value; setViewport(value);
      animation.current = progress < 1 ? request(frame) : undefined;
    };
    animation.current = request(frame);
  }, [following, peer, peers, actorId, peerId, area, busy, onStop, sizeRevision, clockRevision, document, clockOffsetMs, cancelMotion, stop, agent]);
  useEffect(() => { void room.send('follow', { id: `follow-${peerId}`, seq: ++seq.current, phase: peer ? 'step' : 'end', of: peer?.peerId || null }); }, [room, peer?.peerId, peerId]);
  return { viewport, peer: peer || (lastPeer.current?.actor.id === following ? lastPeer.current : undefined), stop };
}
