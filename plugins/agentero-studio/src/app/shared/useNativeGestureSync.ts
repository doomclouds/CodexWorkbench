import { useCallback, useEffect, useRef, useState } from 'react';
import type { Actor, Board, BoardElement, CollaborationRoom, Json, RoomMessage } from '../../contracts/studio';

export interface NativeGesture {
  id: string;
  kind: 'move' | 'resize' | 'turn' | 'ink' | 'shape' | 'arrow' | 'upload';
  elements: BoardElement[];
  cancelled?: boolean;
  storedIds?: string[];
}
export interface PeerGesture extends NativeGesture { peerId: string; actor: Actor; seq: number; expiresAt: number; ended?: boolean }
const KINDS = ['move', 'resize', 'turn', 'ink', 'shape', 'arrow', 'upload'];
const FIELDS = ['id', 'type', 'version', 'x', 'y', 'w', 'h', 'rotation', 'kind', 'fill', 'stroke', 'strokeWidth', 'color', 'text', 'fontSize', 'from', 'to', 'fromSide', 'toSide', 'heads', 'dash', 'head', 'bends'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160;
function project(element: BoardElement): Record<string, Json> {
  const next: Record<string, Json> = {};
  for (const field of FIELDS) {
    const value = element[field];
    if (value !== undefined) next[field] = (field === 'text' ? String(value).slice(0, 1000) : value) as Json;
  }
  return next;
}
function decodeElement(value: unknown): BoardElement | undefined {
  if (!object(value) || !identifier(value.id) || typeof value.type !== 'string' || !['shape', 'container', 'text', 'stroke', 'arrow', 'image', 'html', 'table', 'link', 'note', 'sticker', 'diagram', 'chart'].includes(value.type)) return;
  if (![value.x, value.y, value.w, value.h].every(finite) || Number(value.w) < 0 || Number(value.h) < 0) return;
  return project({ ...value, version: Number.isInteger(value.version) ? value.version : 1 } as BoardElement) as unknown as BoardElement;
}

/** Geometry only: HTML, image bytes, embedded state and frozen sources never enter the ephemeral channel. */
export function encodeGestureFrame(gesture: NativeGesture, frame: number, nextSeq: () => number): Json[] {
  const atoms: Json[] = [];
  for (const element of gesture.elements.slice(0, 200)) {
    atoms.push({ element: project(element) });
    if (element.points) for (let offset = 0; offset < element.points.length; offset += 240) atoms.push({ points: { id: element.id, offset, values: element.points.slice(offset, offset + 240) } });
  }
  const parts: Json[][] = [[]];
  for (const atom of atoms) {
    if (new TextEncoder().encode(JSON.stringify(atom)).length > 3000) return [];
    const last = parts.at(-1)!;
    if (new TextEncoder().encode(JSON.stringify([...last, atom])).length > 3000) parts.push([atom]); else last.push(atom);
  }
  if (parts.length > 24) return [];
  return parts.map((part, index) => ({ id: gesture.id, seq: nextSeq(), phase: index === 0 ? 'start' : 'parts', frame, index, total: parts.length, kind: gesture.kind, atoms: part }));
}

interface Assembly { frame: number; seq: number; total: number; parts: Map<number, Json[]>; gesture?: PeerGesture; actor: Actor; peerId: string; kind: NativeGesture['kind']; until: number; ended: boolean; storedIds?: string[] }
export class NativeGestureReceiver {
  private entries = new Map<string, Assembly>();
  private finished = new Map<string, number>();
  constructor(private now = Date.now) {}
  receive(message: RoomMessage): boolean {
    const data = message.data;
    if (!object(data) || !identifier(data.id) || !Number.isSafeInteger(data.seq) || !Number.isSafeInteger(data.frame) || !KINDS.includes(String(data.kind))) return false;
    const key = `${message.peerId}\0${data.id}`, frame = Number(data.frame), seq = Number(data.seq), old = this.entries.get(key);
    for (const [id, until] of this.finished) if (until <= this.now()) this.finished.delete(id);
    if (this.finished.has(key)) return false;
    if (data.phase === 'end' && data.cancelled === true && (!old || seq >= old.seq)) { this.entries.delete(key); this.finished.set(key, this.now() + 30000); return true; }
    if (old && (frame < old.frame || old.ended && frame !== old.frame)) return false;
    const entry: Assembly = old && frame === old.frame ? old : { frame, seq, total: 0, parts: new Map(), gesture: old?.gesture, actor: message.actor, peerId: message.peerId, kind: data.kind as NativeGesture['kind'], until: this.now() + 3000, ended: false };
    if (data.phase === 'end') {
      entry.ended = true; entry.storedIds = Array.isArray(data.storedIds) ? data.storedIds.filter(identifier).slice(0, 200) : undefined;
      entry.until = this.now() + 10000;
    } else {
      if (!Number.isSafeInteger(data.index) || !Number.isSafeInteger(data.total) || Number(data.total) < 1 || Number(data.total) > 24 || Number(data.index) < 0 || Number(data.index) >= Number(data.total) || !Array.isArray(data.atoms)) return false;
      if (entry.total && entry.total !== data.total) return false;
      entry.total = Number(data.total); entry.parts.set(Number(data.index), data.atoms as Json[]);
      if (!entry.ended) entry.until = this.now() + 3000;
    }
    entry.seq = Math.max(entry.seq, seq);
    if (entry.total && entry.parts.size === entry.total) {
      const elements = new Map<string, BoardElement>();
      const atoms = Array.from({ length: entry.total }, (_, index) => entry.parts.get(index) || []).flat();
      for (const atom of atoms) if (object(atom)) { const element = decodeElement(atom.element); if (element) elements.set(element.id, element); }
      for (const atom of atoms) if (object(atom) && object(atom.points)) {
        const point = atom.points, element = typeof point.id === 'string' ? elements.get(point.id) : undefined;
        if (!element || !Number.isSafeInteger(point.offset) || Number(point.offset) < 0 || Number(point.offset) > 40000 || !Array.isArray(point.values) || point.values.length > 240 || !point.values.every(finite)) continue;
        element.points ??= []; element.points.splice(Number(point.offset), point.values.length, ...point.values as number[]);
      }
      entry.gesture = { id: data.id, kind: entry.kind, elements: [...elements.values()], peerId: entry.peerId, actor: entry.actor, seq: entry.seq, expiresAt: entry.until };
    }
    if (entry.gesture) entry.gesture = { ...entry.gesture, seq: entry.seq, expiresAt: entry.until, ended: entry.ended, storedIds: entry.storedIds };
    this.entries.set(key, entry);
    if (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
    return true;
  }
  read(document: Board): PeerGesture[] {
    const elements = new Map(document.elements.map(element => [element.id, element]));
    const next: PeerGesture[] = [];
    for (const [key, entry] of this.entries) {
      const gesture = entry.gesture;
      const geometriesMatch = gesture && gesture.elements.length > 0 && gesture.elements.every(preview => {
        const element = elements.get(preview.id);
        return element && ['x', 'y', 'w', 'h', 'rotation', 'points', 'from', 'to', 'bends'].every(field => JSON.stringify(element[field]) === JSON.stringify(preview[field]));
      });
      const onlyCreatedIds = entry.storedIds?.length && entry.storedIds.every(id => !gesture?.elements.some(element => element.id === id));
      const landed = entry.ended && (onlyCreatedIds ? entry.storedIds!.every(id => elements.has(id)) : geometriesMatch);
      if (entry.until <= this.now() || landed) { this.entries.delete(key); if (entry.ended) this.finished.set(key, this.now() + 30000); } else if (gesture) next.push(gesture);
    }
    return next;
  }
  clear() { this.entries.clear(); this.finished.clear(); }
}

export function useNativeGestureSync({ room, document, selfPeerId, readOnly = false, preview = false }: { room?: CollaborationRoom; document: Board; selfPeerId?: string; readOnly?: boolean; preview?: boolean }) {
  const receiver = useRef(new NativeGestureReceiver());
  const source = useRef({ room, document, readOnly, preview }); source.current = { room, document, readOnly, preview };
  const latest = useRef<NativeGesture | undefined>(undefined);
  const sequence = useRef(0), frame = useRef(0), pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextSendAt = useRef(0);
  const [gestures, setGestures] = useState<PeerGesture[]>([]);
  const refresh = useCallback(() => setGestures(receiver.current.read(source.current.document)), []);
  const send = useCallback((gesture: NativeGesture, end = false) => {
    const current = source.current; if (!current.room || current.readOnly || current.preview) return;
    const topic = gesture.kind === 'upload' ? 'upload' : 'gesture';
    const messages = gesture.cancelled ? [] : encodeGestureFrame(gesture, ++frame.current, () => ++sequence.current);
    if (end) messages.push({ id: gesture.id, seq: ++sequence.current, phase: 'end', frame: frame.current, kind: gesture.kind, cancelled: !!gesture.cancelled, storedIds: gesture.storedIds || [] });
    for (const message of messages) void current.room.send(topic, message).catch(() => {});
    nextSendAt.current = Date.now() + Math.max(33, messages.length * 1000 / 30);
  }, []);
  const publish = useCallback((gesture: NativeGesture | undefined) => {
    if (!gesture) { clearTimeout(pending.current); pending.current = undefined; if (latest.current) send(latest.current, true); latest.current = undefined; return; }
    if (gesture.cancelled) { clearTimeout(pending.current); pending.current = undefined; send(gesture, true); latest.current = undefined; return; }
    if (latest.current && latest.current.id !== gesture.id) send(latest.current, true);
    latest.current = gesture;
    pending.current ??= setTimeout(() => { pending.current = undefined; if (latest.current) send(latest.current); }, Math.max(0, nextSendAt.current - Date.now()));
  }, [send]);
  useEffect(() => { refresh(); }, [document, refresh]);
  useEffect(() => {
    receiver.current.clear(); refresh();
    if (!room || preview) return;
    const receive = (message: RoomMessage) => { if (message.peerId !== selfPeerId && receiver.current.receive(message)) refresh(); };
    const unsubscribes = [room.subscribe('gesture', receive), room.subscribe('upload', receive)];
    const timer = setInterval(() => { refresh(); if (latest.current && !pending.current && Date.now() >= nextSendAt.current) send(latest.current); }, 1000);
    return () => { clearInterval(timer); clearTimeout(pending.current); if (source.current.room === room) { if (latest.current) send({ ...latest.current, cancelled: true }, true); latest.current = undefined; } receiver.current.clear(); unsubscribes.forEach(unsubscribe => unsubscribe()); };
  }, [room, preview, selfPeerId, refresh, send]);
  return { gestures, publish };
}
