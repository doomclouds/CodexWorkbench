import {
  McpPanelViewService,
  type McpPanelCamera,
  type McpPanelView,
  type UpdatePanelViewRequest,
} from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { RoomCapacityError } from '../../modules/rooms/application/index.js';
import {
  WhiteboardAccessError,
  type WhiteboardApplication,
} from '../../modules/whiteboard/application/index.js';
import { HttpRequestError } from './request.js';
import { unaryRoute, type HttpActor } from './unary-route.js';

const validId = /^[A-Za-z0-9_-]{1,128}$/u;
const validSession = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu;
const leaseLifetime = 30 * 60_000;
const viewLifetime = 60_000;
const maximumViews = 256;
const maximumSelectedIds = 40;
const maximumCoordinate = 1_000_000_000;
const { readPanelView, updatePanelView } = McpPanelViewService.method;

interface LiveViewEntry {
  readonly sessionId: string;
  readonly sequence: bigint;
  readonly visibleUntil: number;
  readonly forgetAfter: number;
  readonly updatedAt: number;
  readonly state?: McpPanelView;
}

function requireLocalActor(actor: HttpActor) {
  if (actor.guestScope !== undefined || actor.kind === 'agent') {
    throw new WhiteboardAccessError();
  }
}

function cameraValid(camera: McpPanelCamera | undefined) {
  if (!camera) {
    return false;
  }

  const { x, y, zoom } = camera;
  const coordinates = Math.abs(x) <= maximumCoordinate && Math.abs(y) <= maximumCoordinate;

  return coordinates && zoom >= 0.05 && zoom <= 8;
}

function validateState(state: McpPanelView) {
  const { boardId, selectedIds, selectedCount, viewport, focusedObjectId, returnViewport } = state;
  const validSelection =
    selectedIds.length <= maximumSelectedIds &&
    selectedCount >= selectedIds.length &&
    new Set(selectedIds).size === selectedIds.length;
  const validFocus = focusedObjectId === undefined || validId.test(focusedObjectId);
  const validReturn = !returnViewport || Boolean(focusedObjectId && cameraValid(returnViewport));
  if (!validId.test(boardId) || !validSelection || !selectedIds.every((id) => validId.test(id))) {
    throw new HttpRequestError(400, 'Invalid panel board or selection.');
  }
  if (!cameraValid(viewport) || !validFocus || !validReturn) {
    throw new HttpRequestError(400, 'Invalid panel camera or focus.');
  }
}

function entryKey(actor: HttpActor, viewId: string) {
  if (!validId.test(viewId)) {
    throw new HttpRequestError(400, 'Invalid panel view identity.');
  }

  return JSON.stringify([actor.id, viewId]);
}

function makeEntry(
  request: UpdatePanelViewRequest,
  now: number,
  state?: McpPanelView,
): LiveViewEntry {
  const { sessionId, sequence, sessionExpiresAtMillis } = request;
  const visibleUntil = Math.min(Number(sessionExpiresAtMillis), now + viewLifetime);
  const forgetAfter = now + viewLifetime;

  return { sessionId, sequence, visibleUntil, forgetAfter, updatedAt: now, state };
}

function publishLease(request: UpdatePanelViewRequest, now: number) {
  const expiry = Number(request.sessionExpiresAtMillis);
  if (expiry <= now || expiry > now + leaseLifetime) {
    throw new HttpRequestError(400, 'Panel session has expired or is invalid.');
  }
}

export function createMcpPanelViewRoutes(application: WhiteboardApplication, now: () => number) {
  const entries = new Map<string, LiveViewEntry>();

  function forgetOld(time: number) {
    for (const [key, entry] of entries) {
      if (entry.forgetAfter <= time) {
        entries.delete(key);
      }
    }
  }

  function update(actor: HttpActor, request: UpdatePanelViewRequest) {
    requireLocalActor(actor);
    const key = entryKey(actor, request.viewId);
    if (!validSession.test(request.sessionId) || request.sequence === 0n) {
      throw new HttpRequestError(400, 'Invalid panel session sequence.');
    }

    const time = now();
    forgetOld(time);
    const previous = entries.get(key);
    if (!previous && entries.size >= maximumViews) {
      throw new RoomCapacityError('Too many local panel views.');
    }

    if (request.update.case === 'clear' && request.update.value) {
      if (
        !previous ||
        (previous.sessionId === request.sessionId && request.sequence >= previous.sequence)
      ) {
        entries.set(key, makeEntry(request, time));
      }

      return {};
    }
    if (request.update.case !== 'state') {
      throw new HttpRequestError(400, 'Panel update must publish a view or clear it.');
    }

    const state = request.update.value;
    validateState(state);
    publishLease(request, time);
    application.getObjectPayloads(actor, state.boardId, []);
    if (!previous || request.sequence > previous.sequence) {
      entries.set(key, makeEntry(request, time, state));
    }

    return {};
  }

  return [
    unaryRoute(updatePanelView, update),
    unaryRoute(readPanelView, (actor, { boardId, viewId }) => {
      requireLocalActor(actor);
      const key = entryKey(actor, viewId);
      const time = now();
      forgetOld(time);
      const result = entries.get(key);
      if (result?.state?.boardId !== boardId || result.visibleUntil <= time) {
        return {};
      }

      application.getObjectPayloads(actor, boardId, []);

      return { state: result.state, updatedAtMillis: BigInt(result.updatedAt) };
    }),
  ];
}
