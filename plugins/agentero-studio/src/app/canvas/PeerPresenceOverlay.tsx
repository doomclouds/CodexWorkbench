import { useEffect, useRef, useState } from 'react';
import type { BoardElement, Presence } from '../../contracts/studio.js';
import { readableText } from '../../core/theme.js';
import { participantColor } from '../shared/presence-members.js';
import { elementBounds } from './canvas-model.js';

interface Props {
  peers: Presence[];
  elements: BoardElement[];
  artifactId: string;
  selfActorId: string;
  zoom: number;
  clockOffsetMs?: number;
  preview?: boolean;
}
const IDLE_AFTER = 60_000, EXPIRE_AFTER = 15 * 60_000, CHAT_FADE = 600;

export default function PeerPresenceOverlay({ peers, elements, artifactId, selfActorId, zoom, clockOffsetMs = 0, preview = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [, tick] = useState(0);
  useEffect(() => {
    const update = () => { setVisible(document.visibilityState !== 'hidden' && !root.current?.closest('[hidden]')); tick(value => value + 1); };
    update();
    const observer = new MutationObserver(update);
    for (let node = root.current?.parentElement; node; node = node.parentElement) observer.observe(node, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const now = Date.now() + clockOffsetMs;
  let deadline = Infinity;
  const schedule = (at: number) => { if (at > now) deadline = Math.min(deadline, at); };
  const active = preview || !visible ? [] : peers.filter(peer => {
    if (peer.actor.id === selfActorId || peer.visible === false || peer.context && peer.context.artifactId !== artifactId) return false;
    const expiry = Date.parse(peer.updatedAt) + EXPIRE_AFTER;
    if (!Number.isFinite(expiry) || expiry <= now) return false;
    return true;
  });
  const cursors = new Map<string, { peer: Presence; at: number }>();
  for (const peer of active) {
    const cursor = peer.cursor;
    if (!cursor || cursor.surface && cursor.surface !== 'board' || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) continue;
    const at = cursor.t ?? Date.parse(peer.updatedAt);
    if (!Number.isFinite(at) || at + EXPIRE_AFTER <= now) continue;
    const previous = cursors.get(peer.actor.id);
    if (!previous || previous.at < at || previous.at === at && previous.peer.updatedAt < peer.updatedAt) cursors.set(peer.actor.id, { peer, at });
  }
  const byId = new Map(elements.map(element => [element.id, element]));
  const edits = new Map<string, { peer: Presence; element: BoardElement; moving: boolean }>();
  for (const peer of active) {
    const editing = peer.context?.editingIds ?? [], moving = Array.isArray(peer.context?.movingIds) ? peer.context.movingIds as string[] : [];
    for (const id of new Set([...editing, ...moving])) {
      const element = byId.get(id);
      if (!element) continue;
      const key = `${peer.actor.id}:${id}`, previous = edits.get(key), changing = moving.includes(id);
      if (!previous || changing && !previous.moving || changing === previous.moving && previous.peer.updatedAt < peer.updatedAt) edits.set(key, { peer, element, moving: changing });
      schedule(Date.parse(peer.updatedAt) + EXPIRE_AFTER);
    }
  }
  for (const { peer, at } of cursors.values()) {
    schedule(at + IDLE_AFTER); schedule(at + EXPIRE_AFTER); schedule(Date.parse(peer.updatedAt) + EXPIRE_AFTER);
    if (peer.chat) { const expiry = peer.chatExpiresAt ?? at + 5000; schedule(expiry); if (!reducedMotion) schedule(expiry + CHAT_FADE); }
  }
  useEffect(() => {
    if (!visible || preview || !Number.isFinite(deadline)) return;
    const timeout = setTimeout(() => tick(value => value + 1), Math.max(1, deadline - (Date.now() + clockOffsetMs)));
    return () => clearTimeout(timeout);
  }, [deadline, clockOffsetMs, visible, preview]);

  const slots = new Map<string, number>();
  const targetCounts = new Map<string, number>();
  for (const { element } of edits.values()) targetCounts.set(element.id, (targetCounts.get(element.id) ?? 0) + 1);
  return <div ref={root} className="studio-peer-presence-overlay" aria-label="协作者在画布上的位置" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    {[...edits.entries()].map(([key, { peer, element, moving }]) => {
      const box = elementBounds(element, elements), color = participantColor(peer.actor, peer.color), slot = slots.get(element.id) ?? 0;
      slots.set(element.id, slot + 1);
      if (slot >= 3) return null;
      const extra = slot === 2 ? (targetCounts.get(element.id) ?? 0) - 3 : 0;
      const padding = (3 + slot * 3) / zoom, rotation = element.type === 'arrow' ? 0 : element.rotation ?? 0;
      const action = moving || peer.actor.kind === 'agent' ? '正在修改' : '正在编辑';
      return <div key={key} data-peer-target={element.id} data-peer-actor={peer.actor.id} role="status" aria-label={`${peer.actor.name} ${action}此对象`} style={{ position: 'absolute', left: box.x - padding, top: box.y - padding, width: box.w + 2 * padding, height: box.h + 2 * padding, border: `${1.5 / zoom}px ${moving ? 'dashed' : 'solid'} ${color}`, borderRadius: 5 / zoom, transform: rotation ? `rotate(${rotation}deg)` : undefined, pointerEvents: 'none', zIndex: 72 }}>
        <span style={{ position: 'absolute', left: 0, bottom: `calc(100% + ${(4 + slot * 20) / zoom}px)`, padding: '3px 6px', borderRadius: 4, background: color, color: readableText(color), font: '11px/1.4 Arial,"Microsoft YaHei",sans-serif', whiteSpace: 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', transform: `scale(${1 / zoom})${rotation ? ` rotate(${-rotation}deg)` : ''}`, transformOrigin: 'left bottom' }}>{peer.actor.name} · {action}{extra > 0 && ` · 另 ${extra} 人`}</span>
      </div>;
    })}
    {[...cursors.values()].map(({ peer, at }) => {
      const color = participantColor(peer.actor, peer.color), idle = now >= at + IDLE_AFTER;
      const chatExpiry = peer.chatExpiresAt ?? at + 5000, showChat = peer.chat && now < chatExpiry + (reducedMotion ? 0 : CHAT_FADE);
      return <div key={peer.actor.id} className={`studio-remote-cursor${idle ? ' is-idle' : ''}`} data-peer-actor={peer.actor.id} data-peer-id={peer.peerId} style={{ left: peer.cursor!.x, top: peer.cursor!.y, opacity: idle ? .35 : 1, transform: `scale(${1 / zoom})`, pointerEvents: 'none' }}><svg width="18" height="23" viewBox="0 0 18 23" aria-hidden="true"><path d="M2 1 16 14 10 15 7 21 2 1Z" fill={color} stroke="#fff" strokeWidth="1.4" /></svg><span style={{ background: color, color: readableText(color) }}>{peer.actor.name}</span>{showChat && <p style={{ opacity: now >= chatExpiry ? 0 : 1, transition: reducedMotion ? 'none' : 'opacity 600ms linear' }}>{peer.chat}</p>}</div>;
    })}
  </div>;
}
