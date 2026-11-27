import { useCallback, useMemo, useState } from 'react';
import type {
  CanvasContentLocation,
  CanvasContentLocationRequest,
  CanvasContentTracking,
} from '../../ui/domain/canvas/index.js';

type RequestsById = ReadonlyMap<string, readonly CanvasContentLocationRequest[]>;
type LocationMap = ReadonlyMap<string, CanvasContentLocation>;

interface BoardContentLocations {
  readonly requests?: RequestsById;
  readonly reported: ReadonlyMap<string, LocationMap>;
}

function sameLocations(previous: LocationMap, next: LocationMap) {
  return (
    previous.size === next.size &&
    [...next].every(([id, location]) => {
      const before = previous.get(id);
      return (
        before &&
        before.reveal === location.reveal &&
        before.point?.x === location.point?.x &&
        before.point?.y === location.point?.y
      );
    })
  );
}

export function useBoardContentTracking() {
  const [state, setState] = useState<BoardContentLocations>(() => ({ reported: new Map() }));
  const { requests, reported } = state;
  const requestLocations = useCallback((requests: RequestsById | undefined) => {
    setState((current) =>
      current.requests === requests ? current : { requests, reported: new Map() },
    );
  }, []);
  const tracking = useMemo(() => {
    if (!requests?.size) {
      return undefined;
    }

    return new Map<string, CanvasContentTracking>(
      [...requests].map(([objectId, objectRequests]) => [
        objectId,
        {
          requests: objectRequests,
          report(locations) {
            setState((current) => {
              if (current.requests?.get(objectId) !== objectRequests) {
                return current;
              }

              const before = current.reported.get(objectId);
              if (before && sameLocations(before, locations)) {
                return current;
              }

              const reported = new Map(current.reported).set(objectId, locations);

              return { ...current, reported };
            });
          },
        },
      ]),
    );
  }, [requests]);
  const locations = useMemo(() => {
    const live = new Map<string, CanvasContentLocation>();
    for (const report of reported.values()) {
      for (const [id, location] of report) {
        live.set(id, location);
      }
    }

    return live;
  }, [reported]);

  return { tracking, locations, requestLocations };
}
