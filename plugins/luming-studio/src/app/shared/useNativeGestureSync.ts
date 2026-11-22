import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ELEMENT_TYPES,
  type Actor,
  type Board,
  type BoardElement,
  type CollaborationRoom,
  type CollaborationStateEvent,
  type Json,
  type RoomMessage,
} from '../../contracts/studio';
import { newClientId } from './client-id';

export interface NativeGesture {
  id: string;
  kind: 'move' | 'resize' | 'turn' | 'ink' | 'shape' | 'arrow' | 'upload';
  elements: BoardElement[];
  cancelled?: boolean;
  storedIds?: string[];
  operationId?: string;
  origin?: 'create' | 'existing';
  baseRevision?: number;
  epoch?: string;
}
export interface GestureReceipt {
  id: string;
  operationId: string;
  revision: number;
  versions: Record<string, number>;
}
export interface PeerGesture extends NativeGesture {
  peerId: string;
  actor: Actor;
  seq: number;
  expiresAt: number;
  ended?: boolean;
}

const KINDS = ['move', 'resize', 'turn', 'ink', 'shape', 'arrow', 'upload'];
const elementTypes = new Set<string>(ELEMENT_TYPES);
const FIELDS = [
  'id',
  'type',
  'version',
  'x',
  'y',
  'w',
  'h',
  'rotation',
  'kind',
  'fill',
  'stroke',
  'strokeWidth',
  'color',
  'text',
  'fontSize',
  'from',
  'to',
  'fromSide',
  'toSide',
  'heads',
  'dash',
  'head',
  'bends',
  'labelOffset',
  'labelSize',
];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 160;

const geometryOnlyType = (type: BoardElement['type']) => type === 'document' || type === 'todo';

function project(element: BoardElement, compact = false): Record<string, Json> {
  if (geometryOnlyType(element.type)) {
    const { id, type, version, x, y, w, h, rotation } = element;

    return { id, type, version, x, y, w, h, ...(finite(rotation) ? { rotation } : {}) };
  }

  const next: Record<string, Json> = {};
  for (const field of FIELDS) {
    const value = element[field];
    if (value !== undefined) {
      next[field] = (
        field === 'text' ? String(value).slice(0, compact ? 128 : 1000) : value
      ) as Json;
    }
  }
  for (const field of ['hollow', 'bold', 'italic'] as const) {
    if (typeof element[field] === 'boolean') {
      next[field] = element[field]!;
    }
  }
  if (
    typeof element.textAlign === 'string' &&
    ['left', 'center', 'right'].includes(element.textAlign)
  ) {
    next.textAlign = element.textAlign;
  }
  if (typeof element.fontFamily === 'string' && element.fontFamily.length <= 256) {
    next.fontFamily = element.fontFamily;
  }

  const iconId =
    element.type === 'sticker' && object(element.data) ? element.data.stickerIconId : undefined;

  if (typeof iconId === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(iconId)) {
    next.data = { stickerIconId: iconId };
  }
  return next;
}

function decodeElement(value: unknown): BoardElement | undefined {
  if (!object(value) || !identifier(value.id)) {
    return;
  }
  if (typeof value.type !== 'string' || !elementTypes.has(value.type)) {
    return;
  }
  if (
    ![value.x, value.y, value.w, value.h].every(finite) ||
    Number(value.w) < 0 ||
    Number(value.h) < 0
  ) {
    return;
  }

  return project({
    ...value,
    version: Number.isInteger(value.version) ? value.version : 1,
  } as BoardElement) as unknown as BoardElement;
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const MAX_PARTS = 24;
const MAX_PACKET_BYTES = 4000;
const MAX_ATOM_BYTES = 2400;

function samplePoints(points: number[], pairs: number): number[] {
  const count = points.length / 2;
  if (count <= pairs) {
    return points;
  }
  if (pairs < 3) {
    return [...points.slice(0, 2), ...points.slice(-2)];
  }

  const result = points.slice(0, 2);
  const width = (count - 2) / (pairs - 2);
  let previous = 0;
  for (let bucket = 0; bucket < pairs - 2; bucket++) {
    const from = Math.floor(bucket * width) + 1;
    const to = Math.min(Math.floor((bucket + 1) * width) + 1, count - 1);
    const nextFrom = to;
    const nextTo = Math.min(Math.floor((bucket + 2) * width) + 1, count);
    let x = 0;
    let y = 0;
    for (let index = nextFrom; index < nextTo; index++) {
      x += points[index * 2]!;
      y += points[index * 2 + 1]!;
    }
    x /= Math.max(1, nextTo - nextFrom);
    y /= Math.max(1, nextTo - nextFrom);
    let best = from;
    let area = -1;
    for (let index = from; index < to; index++) {
      const current = Math.abs(
        (points[previous * 2]! - x) * (points[index * 2 + 1]! - points[previous * 2 + 1]!) -
          (points[previous * 2]! - points[index * 2]!) * (y - points[previous * 2 + 1]!),
      );

      if (current > area) {
        area = current;
        best = index;
      }
    }
    result.push(points[best * 2]!, points[best * 2 + 1]!);
    previous = best;
  }
  result.push(...points.slice(-2));
  return result;
}

function appendStrokeAtoms(id: string, points: number[], append: (atom: Json) => boolean) {
  for (let offset = 0; offset < points.length;) {
    const values: number[] = [];
    const begin = offset;
    while (offset < points.length && values.length < 240) {
      const pair = [points[offset]!, points[offset + 1]!];
      const exceedsBudget =
        values.length &&
        bytes({ points: { id, offset: begin, values: [...values, ...pair] } }) > MAX_ATOM_BYTES;

      if (exceedsBudget) {
        break;
      }

      values.push(...pair);
      offset += 2;
    }
    if (!append({ points: { id, offset: begin, values } })) {
      return false;
    }
  }
  return true;
}

function packFrame(
  header: Record<string, Json>,
  projected: { element: BoardElement; points?: number[] }[],
  compact: boolean,
): Json[][] | undefined {
  const parts: Json[][] = [[]];
  function append(atom: Json): boolean {
    if (bytes(atom) > MAX_ATOM_BYTES) {
      return false;
    }

    const last = parts.at(-1)!;
    const packet = {
      ...header,
      seq: Number.MAX_SAFE_INTEGER,
      phase: 'parts',
      index: MAX_PARTS - 1,
      total: MAX_PARTS,
      atoms: [...last, atom],
    };

    if (bytes(packet) > MAX_PACKET_BYTES) {
      parts.push([atom]);
    } else {
      last.push(atom);
    }
    return parts.length <= MAX_PARTS;
  }
  for (const { element, points } of projected) {
    const hasRoom = append({ element: project(element, compact) });
    if (points && (points.length % 2 || points.some((value) => !finite(value)))) {
      throw new Error('实时笔迹坐标无效。');
    }
    if (!hasRoom || (points && !appendStrokeAtoms(element.id, points, append))) {
      return;
    }
  }
  return parts;
}

export function encodeGestureFrame(
  gesture: NativeGesture,
  frame: number,
  nextSeq: () => number,
): Json[] {
  if (!gesture.elements.length) {
    return [];
  }
  if (gesture.elements.length > 200 || !identifier(gesture.id) || gesture.id.length > 120) {
    throw new Error('实时预览的对象数量或标识超过预算。');
  }

  const sources = gesture.elements.map((element) => ({
    element,
    points: geometryOnlyType(element.type) ? undefined : element.points,
  }));
  const sourceCoordinates = sources.reduce((sum, { points }) => sum + (points?.length ?? 0), 0);
  let pointLimit = Math.max(1, ...sources.map(({ points }) => (points?.length ?? 0) / 2));
  let compact = false;
  while (true) {
    const pairs = pointLimit;
    const projected = sources.map(({ element, points }) => ({
      element,
      points: points ? samplePoints(points, pairs) : undefined,
    }));
    const previewCoordinates = projected.reduce((sum, item) => sum + (item.points?.length ?? 0), 0);
    const sampled = compact || previewCoordinates < sourceCoordinates;
    const header = {
      id: gesture.id,
      operationId: gesture.operationId ?? gesture.id,
      origin: gesture.origin ?? 'existing',
      baseRevision: gesture.baseRevision ?? 0,
      epoch: gesture.epoch ?? 'legacy',
      frame,
      kind: gesture.kind,
      sampled,
      sourceCoordinates,
      previewCoordinates,
    };
    const parts = packFrame(header, projected, compact);
    if (parts) {
      return parts.map((atoms, index) => ({
        ...header,
        seq: nextSeq(),
        phase: index === 0 ? 'start' : 'parts',
        index,
        total: parts.length,
        atoms,
      }));
    }

    if (pointLimit > 2) {
      pointLimit = Math.max(2, Math.floor(pointLimit / 2));
      continue;
    }
    if (!compact) {
      compact = true;
      continue;
    }
    throw new Error('实时预览超过预算，完整内容仍需通过保存通道提交。');
  }
}

interface Assembly {
  frame: number;
  seq: number;
  total: number;
  parts: Map<number, { seq: number; atoms: Json[] }>;
  gesture?: PeerGesture;
  actor: Actor;
  peerId: string;
  topic: string;
  kind: NativeGesture['kind'];
  until: number;
  ended: boolean;
  operationId: string;
  origin: 'create' | 'existing';
  baseRevision: number;
  baseVersions: Map<string, number>;
  epoch: string;
  roomSequence: number;
}
interface Commit {
  revision: number;
  targets: Set<string>;
  versions: Record<string, number>;
  until: number;
}

function isCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readGesturePacket(data: Json) {
  if (!object(data) || !identifier(data.id)) {
    return;
  }
  if (!isCounter(data.seq) || !isCounter(data.frame) || !KINDS.includes(String(data.kind))) {
    return;
  }

  const origin: Assembly['origin'] = data.origin === 'create' ? 'create' : 'existing';
  return {
    data,
    id: data.id,
    seq: data.seq,
    frame: data.frame,
    kind: data.kind as NativeGesture['kind'],
    epoch: typeof data.epoch === 'string' ? data.epoch : 'legacy',
    operationId: identifier(data.operationId) ? data.operationId : data.id,
    origin,
    baseRevision: Number.isSafeInteger(data.baseRevision) ? Number(data.baseRevision) : 0,
  };
}

type GesturePacket = NonNullable<ReturnType<typeof readGesturePacket>>;

function applyStrokeAtom(point: Record<string, unknown>, elements: Map<string, BoardElement>) {
  const element = typeof point.id === 'string' ? elements.get(point.id) : undefined;
  if (element && geometryOnlyType(element.type)) {
    return false;
  }

  const { offset, values } = point;
  if (!element || !isCounter(offset) || offset !== (element.points?.length ?? 0)) {
    return false;
  }
  if (!Array.isArray(values) || values.length % 2 || values.length > 240) {
    return false;
  }
  if (offset + values.length > 40000 || !values.every(finite)) {
    return false;
  }

  element.points ??= [];
  element.points.splice(offset, values.length, ...values);
  return true;
}

function assembleFrame(entry: Assembly, origin: Assembly['origin']) {
  const elements = new Map<string, BoardElement>();
  const existingGeometry =
    origin === 'existing' && (entry.kind === 'move' || entry.kind === 'resize');
  const atoms = Array.from(
    { length: entry.total },
    (_, index) => entry.parts.get(index)?.atoms || [],
  ).flat();

  for (const atom of atoms) {
    if (!object(atom)) {
      continue;
    }

    const element = decodeElement(atom.element);
    if (!element || (geometryOnlyType(element.type) && !existingGeometry)) {
      continue;
    }

    elements.set(element.id, element);
    if (!entry.baseVersions.has(element.id)) {
      entry.baseVersions.set(element.id, origin === 'create' ? 0 : element.version);
    }
    if (elements.size > 200) {
      return;
    }
  }
  for (const atom of atoms) {
    if (!object(atom) || !object(atom.points)) {
      continue;
    }
    if (!applyStrokeAtom(atom.points, elements)) {
      return;
    }
  }
  return elements;
}

function commitSupersedesPreview(
  commit: Commit | undefined,
  id: string,
  actual: BoardElement | undefined,
  base: number,
  revision: number,
): boolean {
  if (!commit || !(revision >= commit.revision) || !commit.targets.has(id)) {
    return false;
  }
  if (!Object.hasOwn(commit.versions, id)) {
    return false;
  }

  const version = commit.versions[id]!;
  if (version === 0) {
    return !actual || (revision > commit.revision && actual.version > base);
  }
  if (!(version > base)) {
    return false;
  }

  return actual ? actual.version >= version : revision > commit.revision;
}

export class NativeGestureReceiver {
  private entries = new Map<string, Assembly>();
  private finished = new Map<string, number>();
  private commits = new Map<string, Commit>();
  private versions = new Map<string, number>();
  private deleted = new Map<string, number>();
  private peers = new Map<string, string | undefined>();
  private wireEpochs = new Map<string, { current: string; retired: Set<string> }>();
  private documentRevision = -1;
  private epoch?: string;
  private retiredEpochs = new Set<string>();
  constructor(private now = Date.now) {}
  private retire(key: string) {
    this.entries.delete(key);
    this.finished.set(key, this.now() + 120000);
    while (this.finished.size > 512) {
      this.finished.delete(this.finished.keys().next().value!);
    }
  }
  private retirePeer(peerId: string) {
    for (const [key, entry] of this.entries) {
      if (entry.peerId === peerId) {
        this.retire(key);
      }
    }
    for (const [key, epoch] of this.wireEpochs) {
      if (key.startsWith(`${peerId}\0`)) {
        epoch.retired.add(epoch.current);
      }
    }
  }
  authority(event: CollaborationStateEvent): boolean {
    if (event.type === 'reset') {
      this.clear();
      return true;
    }
    if (event.type === 'peers') {
      this.updatePeers(event.peers);
      return true;
    }
    if (!this.acceptAuthorityEpoch(event.epoch)) {
      return false;
    }

    const document = event.document as Board;
    if (!Array.isArray(document.elements) || document.artifact.revision < this.documentRevision) {
      return false;
    }

    this.updateDocument(document);
    this.recordCommit(event, document.artifact.revision);
    return true;
  }

  private updatePeers(peers: Extract<CollaborationStateEvent, { type: 'peers' }>['peers']) {
    const next = new Map(peers.map((peer) => [peer.peerId, peer.peerEpoch]));
    for (const [id, epoch] of this.peers) {
      const currentEpoch = next.get(id);
      const changedEpoch = epoch && currentEpoch && epoch !== currentEpoch;
      if (!next.has(id) || changedEpoch) {
        this.retirePeer(id);
      }
    }
    for (const peer of peers) {
      if (!['owner', 'editor'].includes(peer.actor.role)) {
        this.retirePeer(peer.peerId);
      }
    }
    this.peers = next;
  }

  private acceptAuthorityEpoch(epoch: string | undefined): boolean {
    if (!epoch) {
      return true;
    }
    if (this.retiredEpochs.has(epoch)) {
      return false;
    }

    if (this.epoch && epoch !== this.epoch) {
      this.retiredEpochs.add(this.epoch);
      while (this.retiredEpochs.size > 8) {
        this.retiredEpochs.delete(this.retiredEpochs.values().next().value!);
      }
      this.clear();
    }
    this.epoch = epoch;
    return true;
  }

  private updateDocument(document: Board) {
    const next = new Map(document.elements.map((element) => [element.id, element.version]));
    for (const id of this.versions.keys()) {
      if (!next.has(id)) {
        this.deleted.set(id, document.artifact.revision);
      }
    }
    while (this.deleted.size > 4096) {
      this.deleted.delete(this.deleted.keys().next().value!);
    }
    this.versions = next;
    this.documentRevision = document.artifact.revision;
  }

  private recordCommit(
    event: Extract<CollaborationStateEvent, { type: 'document' }>,
    revision: number,
  ) {
    const { operationId, actorId, changedIds, unitVersions, commitRevision } = event;
    if (!operationId || !actorId) {
      return;
    }
    if (!changedIds || !unitVersions) {
      return;
    }
    if (
      typeof commitRevision !== 'number' ||
      !Number.isSafeInteger(commitRevision) ||
      commitRevision > revision
    ) {
      return;
    }

    this.commits.set(actorId + '\0' + operationId, {
      revision: commitRevision,
      targets: new Set(changedIds),
      versions: unitVersions,
      until: this.now() + 120000,
    });

    while (this.commits.size > 256) {
      this.commits.delete(this.commits.keys().next().value!);
    }
  }

  private acceptWireEpoch(message: RoomMessage, channel: string, epoch: string): boolean {
    const wireEpoch = this.wireEpochs.get(channel);
    if (wireEpoch?.retired.has(epoch)) {
      return false;
    }

    if (wireEpoch && wireEpoch.current !== epoch) {
      for (const [key, entry] of this.entries) {
        if (entry.peerId === message.peerId && entry.topic === message.topic) {
          this.retire(key);
        }
      }
      wireEpoch.retired.add(wireEpoch.current);
      wireEpoch.current = epoch;
    } else if (!wireEpoch) {
      this.wireEpochs.set(channel, { current: epoch, retired: new Set() });
    }
    while (this.wireEpochs.size > 256) {
      this.wireEpochs.delete(this.wireEpochs.keys().next().value!);
    }
    const activeEpoch = this.wireEpochs.get(channel)!;
    while (activeEpoch.retired.size > 8) {
      activeEpoch.retired.delete(activeEpoch.retired.values().next().value!);
    }
    return true;
  }

  private frameAssembly(
    message: RoomMessage,
    packet: GesturePacket,
    previous?: Assembly,
  ): Assembly | undefined {
    if (previous) {
      const closedFrame = previous.ended && packet.frame !== previous.frame;
      if (packet.frame < previous.frame || closedFrame) {
        return;
      }

      const sameIntent =
        previous.operationId === packet.operationId && previous.actor.id === message.actor.id;

      if (!sameIntent || previous.baseRevision !== packet.baseRevision) {
        return;
      }
      if (packet.frame === previous.frame) {
        return previous;
      }
    }
    return {
      frame: packet.frame,
      seq: packet.seq,
      total: 0,
      parts: new Map(),
      gesture: previous?.gesture,
      actor: message.actor,
      peerId: message.peerId,
      topic: message.topic,
      kind: packet.kind,
      until: this.now() + 3000,
      ended: false,
      operationId: packet.operationId,
      origin: packet.origin,
      baseRevision: packet.baseRevision,
      baseVersions: previous?.baseVersions ?? new Map(),
      epoch: packet.epoch,
      roomSequence: message.seq,
    };
  }

  private applyPacket(entry: Assembly, packet: GesturePacket): boolean {
    if (packet.data.phase === 'end') {
      if (!entry.ended) {
        entry.until = this.now() + 10000;
      }
      entry.ended = true;
      return true;
    }
    const { index, total, atoms } = packet.data;
    if (!isCounter(index) || !isCounter(total) || !Array.isArray(atoms)) {
      return false;
    }
    if (total < 1 || total > MAX_PARTS || index >= total) {
      return false;
    }
    if (entry.total && entry.total !== total) {
      return false;
    }

    const previous = entry.parts.get(index);
    if (previous && previous.seq >= packet.seq) {
      return false;
    }

    entry.total = total;
    entry.parts.set(index, { seq: packet.seq, atoms });
    if (!entry.ended) {
      entry.until = this.now() + 3000;
    }
    return true;
  }

  private finishFrame(key: string, entry: Assembly, message: RoomMessage, packet: GesturePacket) {
    const elements = assembleFrame(entry, packet.origin);
    if (!elements) {
      return false;
    }

    entry.gesture = {
      id: packet.id,
      operationId: packet.operationId,
      origin: packet.origin,
      baseRevision: packet.baseRevision,
      epoch: packet.epoch,
      kind: entry.kind,
      elements: [...elements.values()],
      peerId: entry.peerId,
      actor: entry.actor,
      seq: entry.seq,
      expiresAt: entry.until,
    };

    for (const [oldKey, other] of this.entries) {
      const sameChannel = other.peerId === message.peerId && other.topic === message.topic;
      if (oldKey === key || !sameChannel || !(other.roomSequence < message.seq)) {
        continue;
      }

      if (other.gesture?.elements.some((element) => elements.has(element.id))) {
        this.retire(oldKey);
      }
    }
    return true;
  }

  receive(message: RoomMessage): boolean {
    const packet = readGesturePacket(message.data);
    if (!packet) {
      return false;
    }

    const { data, epoch, id, seq } = packet;
    const channel = message.peerId + '\0' + message.topic;
    if (!this.acceptWireEpoch(message, channel, epoch)) {
      return false;
    }

    const key = channel + '\0' + id;
    const old = this.entries.get(key);
    for (const [id, until] of this.finished) {
      if (until <= this.now()) {
        this.finished.delete(id);
      }
    }
    if (this.finished.has(key)) {
      return false;
    }

    const cancelled =
      data.cancelled === true || data.outcome === 'cancelled' || data.outcome === 'failed';
    const mayRetire = !old || seq >= old.seq;
    if (data.phase === 'end' && cancelled && mayRetire) {
      this.retire(key);
      return true;
    }
    const entry = this.frameAssembly(message, packet, old);
    if (!entry || !this.applyPacket(entry, packet)) {
      return false;
    }

    entry.seq = Math.max(entry.seq, seq);
    const complete = entry.total && entry.parts.size === entry.total;
    if (complete && !this.finishFrame(key, entry, message, packet)) {
      return false;
    }

    if (entry.gesture) {
      entry.gesture = {
        ...entry.gesture,
        seq: entry.seq,
        expiresAt: entry.until,
        ended: entry.ended,
      };
    }
    this.entries.set(key, entry);
    if (this.entries.size > 64) {
      this.retire(this.entries.keys().next().value!);
    }
    return true;
  }
  read(document: Board): PeerGesture[] {
    const elements = new Map(document.elements.map((element) => [element.id, element]));
    for (const [key, commit] of this.commits) {
      if (commit.until <= this.now()) {
        this.commits.delete(key);
      }
    }
    const next: PeerGesture[] = [];
    for (const [key, entry] of this.entries) {
      const gesture = entry.gesture;
      const commit = this.commits.get(`${entry.actor.id}\0${entry.operationId}`);
      if (entry.until <= this.now()) {
        if (entry.ended) {
          this.retire(key);
        } else {
          this.entries.delete(key);
        }
        continue;
      }
      if (!gesture) {
        continue;
      }

      const retained = gesture.elements.filter((preview) => {
        const actual = elements.get(preview.id);
        const deletedAt = this.deleted.get(preview.id);
        if (
          deletedAt !== undefined &&
          deletedAt > entry.baseRevision &&
          document.artifact.revision >= deletedAt
        ) {
          return false;
        }

        const base = entry.baseVersions.get(preview.id)!;
        if (commitSupersedesPreview(commit, preview.id, actual, base, document.artifact.revision)) {
          return false;
        }

        const authoritative = this.versions.get(preview.id);
        const advanced = authoritative !== undefined && authoritative > base;
        return !(actual && advanced && document.artifact.revision >= this.documentRevision);
      });

      if (!retained.length) {
        this.retire(key);
      } else {
        entry.gesture = { ...gesture, elements: retained };
        const visible = retained.filter(
          (preview) =>
            !geometryOnlyType(preview.type) || elements.get(preview.id)?.type === preview.type,
        );

        if (visible.length) {
          next.push({ ...entry.gesture, elements: visible });
        }
      }
    }
    return next;
  }
  clear() {
    for (const key of this.entries.keys()) {
      this.retire(key);
    }
    this.commits.clear();
    this.versions.clear();
    this.deleted.clear();
    this.peers.clear();
    this.documentRevision = -1;
    this.epoch = undefined;
  }
}

type PreviewOutcome = 'pending' | 'committed' | 'cancelled' | 'failed';

function prepareIntent(
  gesture: NativeGesture,
  previous: NativeGesture | undefined,
  document: Board,
  epoch: string,
): NativeGesture {
  const known = document.elements;
  const origin = previous?.origin ?? gesture.origin;
  const initialRevision = previous?.baseRevision ?? gesture.baseRevision;
  return {
    ...gesture,
    storedIds: gesture.storedIds ?? gesture.elements.map((element) => element.id),
    operationId: previous?.operationId ?? gesture.operationId ?? gesture.id,
    origin:
      origin ??
      (gesture.elements.every((element) => !known.some((item) => item.id === element.id))
        ? 'create'
        : 'existing'),
    baseRevision: initialRevision ?? document.artifact.revision,
    epoch: previous?.epoch ?? epoch,
  };
}

export function useNativeGestureSync({
  room,
  document,
  selfPeerId,
  readOnly = false,
  preview = false,
}: {
  room?: CollaborationRoom;
  document: Board;
  selfPeerId?: string;
  readOnly?: boolean;
  preview?: boolean;
}) {
  const receiver = useRef(new NativeGestureReceiver());
  const source = useRef({ room, document, readOnly, preview });
  useLayoutEffect(() => {
    source.current = { room, document, readOnly, preview };
  }, [room, document, readOnly, preview]);
  const latest = useRef<NativeGesture | undefined>(undefined);
  const sequence = useRef(0);
  const frame = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextSendAt = useRef(0);
  const senderEpoch = useRef(newClientId('gesture'));
  const authorityEpoch = useRef<string | undefined>(undefined);
  const senderGeneration = useRef(0);
  const intents = useRef(new Map<string, NativeGesture>());
  const intentFrames = useRef(new Map<string, number>());
  const ending = useRef(new Map<string, NativeGesture>());
  const frameBusy = useRef(false);
  const lastSent = useRef<NativeGesture | undefined>(undefined);
  const schedule = useRef<() => void>(() => {});
  const [gestures, setGestures] = useState<PeerGesture[]>([]);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const writable = !readOnly && !preview;
  const [wasWritable, setWasWritable] = useState(writable);
  if (wasWritable !== writable) {
    setWasWritable(writable);
    if (!writable) {
      setPreviewStatus(null);
      setPreviewError(null);
    }
  }
  const statusOwner = useRef<string | undefined>(undefined);
  const errorOwner = useRef<string | undefined>(undefined);
  const refresh = useCallback(
    () => setGestures(receiver.current.read(source.current.document)),
    [],
  );
  const encodePublication = useCallback(
    (gesture: NativeGesture, fullFrame: boolean, outcome?: PreviewOutcome, revision?: number) => {
      let messages: Json[] = [];
      let encodingFailed = false;
      if (fullFrame) {
        try {
          intentFrames.current.set(gesture.id, ++frame.current);
          messages = encodeGestureFrame(gesture, frame.current, () => ++sequence.current);
        } catch (error) {
          errorOwner.current = gesture.id;
          setPreviewError(error instanceof Error ? error.message : '实时预览编码失败。');
          encodingFailed = true;
        }
      }
      if (outcome) {
        messages.push({
          id: gesture.id,
          operationId: gesture.operationId ?? gesture.id,
          origin: gesture.origin ?? 'existing',
          baseRevision: gesture.baseRevision ?? 0,
          epoch: gesture.epoch ?? senderEpoch.current,
          seq: ++sequence.current,
          phase: 'end',
          frame: intentFrames.current.get(gesture.id) ?? frame.current,
          kind: gesture.kind,
          outcome,
          cancelled: outcome === 'cancelled',
          ...(revision === undefined ? {} : { commitRevision: revision }),
        });
      }
      return { messages, encodingFailed };
    },
    [],
  );

  const send = useCallback(
    (gesture: NativeGesture, outcome?: PreviewOutcome, revision?: number) => {
      const current = source.current;
      if (!current.room || current.readOnly || current.preview) {
        return;
      }

      const fullFrame = !outcome || outcome === 'pending';
      if (fullFrame && frameBusy.current) {
        if (outcome === 'pending') {
          ending.current.set(gesture.id, gesture);
        }
        return;
      }
      if (fullFrame) {
        frameBusy.current = true;
        lastSent.current = gesture;
      }
      const serial = senderGeneration.current;
      const target = current.room;
      const topic = gesture.kind === 'upload' ? 'upload' : 'gesture';
      const { messages, encodingFailed } = encodePublication(gesture, fullFrame, outcome, revision);
      if (messages.some((value) => object(value) && value.sampled === true)) {
        statusOwner.current = gesture.id;
        setPreviewStatus('实时预览已简化，保存内容保持完整。');
      } else if (!outcome) {
        statusOwner.current = undefined;
        setPreviewStatus(null);
      }
      const currentDelivery = () =>
        senderGeneration.current === serial && source.current.room === target;
      const canClearError = fullFrame && messages.length > 0 && !encodingFailed;
      Promise.all(messages.map(async (message) => target.send(topic, message)))
        .then((accepted) => {
          if (!currentDelivery()) {
            return;
          }

          if (accepted.some((value) => !value)) {
            errorOwner.current = gesture.id;
            setPreviewError('实时预览未送达；内容保存状态请查看保存提示。');
          } else if (canClearError && errorOwner.current === gesture.id) {
            errorOwner.current = undefined;
            setPreviewError(null);
          }
        })
        .catch((error: unknown) => {
          if (currentDelivery()) {
            errorOwner.current = gesture.id;
            setPreviewError(error instanceof Error ? error.message : '实时预览未送达。');
          }
        })
        .finally(() => {
          if (fullFrame && currentDelivery()) {
            frameBusy.current = false;
            schedule.current();
          }
        });

      if (outcome === 'pending' && intents.current.has(gesture.id)) {
        intents.current.set(gesture.id, { ...gesture, elements: [] });
      }
      nextSendAt.current = Date.now() + Math.max(33, (messages.length * 1000) / 30);
    },
    [encodePublication],
  );
  const stopSender = useCallback(() => {
    senderGeneration.current++;
    clearTimeout(pending.current);
    pending.current = undefined;
    nextSendAt.current = 0;
    latest.current = undefined;
    intents.current.clear();
    intentFrames.current.clear();
    ending.current.clear();
    frameBusy.current = false;
    lastSent.current = undefined;
    senderEpoch.current = newClientId('gesture');
    statusOwner.current = errorOwner.current = undefined;
  }, []);
  useLayoutEffect(() => {
    schedule.current = () => {
      const hasNewFrame = latest.current && latest.current !== lastSent.current;
      const readyToSend = ending.current.size > 0 || hasNewFrame;
      if (pending.current || frameBusy.current || !readyToSend) {
        return;
      }

      pending.current = setTimeout(
        () => {
          pending.current = undefined;
          const final = ending.current.entries().next().value;
          if (final) {
            ending.current.delete(final[0]);
            send(final[1], 'pending');
          } else if (latest.current) {
            send(latest.current);
          }
        },
        Math.max(0, nextSendAt.current - Date.now()),
      );
    };
  }, [send]);
  const publish = useCallback(
    (gesture: NativeGesture | undefined) => {
      if (!gesture) {
        clearTimeout(pending.current);
        pending.current = undefined;
        if (latest.current) {
          ending.current.set(latest.current.id, latest.current);
        }
        latest.current = undefined;
        schedule.current();
        return;
      }
      if (source.current.readOnly || source.current.preview) {
        return;
      }

      const next = prepareIntent(
        gesture,
        intents.current.get(gesture.id),
        source.current.document,
        senderEpoch.current,
      );

      if (gesture.cancelled) {
        send(next, 'cancelled');
        ending.current.delete(next.id);
        intents.current.delete(next.id);
        intentFrames.current.delete(next.id);
        if (statusOwner.current === next.id) {
          statusOwner.current = undefined;
          setPreviewStatus(null);
        }
        if (latest.current?.id === next.id) {
          latest.current = undefined;
        }
        return;
      }
      if (latest.current && latest.current.id !== gesture.id) {
        ending.current.set(latest.current.id, latest.current);
      }
      intents.current.set(next.id, next);
      while (intents.current.size > 64) {
        const id = intents.current.keys().next().value!;
        intents.current.delete(id);
        intentFrames.current.delete(id);
        ending.current.delete(id);
      }
      latest.current = next;
      schedule.current();
    },
    [send],
  );
  const confirm = useCallback(
    (receipt: GestureReceipt) => {
      const intent = intents.current.get(receipt.id);
      const validRevision =
        Number.isSafeInteger(receipt.revision) && receipt.revision >= (intent?.baseRevision ?? 0);

      if (!intent || intent.operationId !== receipt.operationId || !validRevision) {
        return;
      }

      if (
        !intent.storedIds?.length ||
        intent.storedIds.some(
          (id) => !Number.isSafeInteger(receipt.versions[id]) || receipt.versions[id]! < 1,
        )
      ) {
        errorOwner.current = receipt.id;
        setPreviewError('保存回执未包含预览对象的有效版本。');
        return;
      }
      send(intent, 'committed', receipt.revision);
      intents.current.delete(receipt.id);
      intentFrames.current.delete(receipt.id);
      ending.current.delete(receipt.id);
      if (statusOwner.current === receipt.id) {
        statusOwner.current = undefined;
        setPreviewStatus(null);
      }
      if (errorOwner.current === receipt.id) {
        errorOwner.current = undefined;
        setPreviewError(null);
      }
      if (latest.current?.id === receipt.id) {
        latest.current = undefined;
        clearTimeout(pending.current);
        pending.current = undefined;
      }
    },
    [send],
  );
  const fail = useCallback(
    ({ id, operationId }: Pick<GestureReceipt, 'id' | 'operationId'>) => {
      const intent = intents.current.get(id);
      if (!intent || intent.operationId !== operationId) {
        return;
      }

      send(intent, 'failed');
      intents.current.delete(id);
      intentFrames.current.delete(id);
      ending.current.delete(id);
      if (statusOwner.current === id) {
        statusOwner.current = undefined;
        setPreviewStatus(null);
      }
      if (latest.current?.id === id) {
        latest.current = undefined;
        clearTimeout(pending.current);
        pending.current = undefined;
      }
    },
    [send],
  );
  useEffect(() => {
    receiver.current.authority({ type: 'document', document });
    refresh();
  }, [document, refresh]);
  useEffect(() => {
    if (!writable) {
      stopSender();
    }
  }, [writable, stopSender]);
  useEffect(() => {
    const activeReceiver = receiver.current;
    activeReceiver.clear();
    activeReceiver.authority({ type: 'document', document: source.current.document });
    refresh();
    if (!room || preview) {
      return;
    }

    const receive = (message: RoomMessage) => {
      if (message.peerId !== selfPeerId && activeReceiver.receive(message)) {
        refresh();
      }
    };
    const resetSender = () => {
      stopSender();
      setPreviewStatus(null);
      setPreviewError(null);
    };
    const unsubscribes = [room.subscribe('gesture', receive), room.subscribe('upload', receive)];
    if (room.subscribeState) {
      unsubscribes.push(
        room.subscribeState((event) => {
          if (!activeReceiver.authority(event)) {
            return;
          }

          if (event.type === 'document' && event.epoch) {
            if (authorityEpoch.current && authorityEpoch.current !== event.epoch) {
              resetSender();
            }
            authorityEpoch.current = event.epoch;
          }
          if (event.type === 'reset') {
            resetSender();
          }
          refresh();
        }),
      );
    }
    const timer = setInterval(() => {
      refresh();
      const idle = !pending.current && !frameBusy.current;
      if (latest.current && idle && Date.now() >= nextSendAt.current) {
        send(latest.current);
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      if (source.current.room === room && latest.current) {
        send(latest.current, 'cancelled');
      }
      stopSender();
      activeReceiver.clear();
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [room, preview, selfPeerId, refresh, send, stopSender]);

  return { gestures, publish, confirm, fail, previewStatus, previewError };
}
