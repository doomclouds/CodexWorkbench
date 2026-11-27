import { useEffect, useRef, useState } from 'react';

import type { CatalogThumbnailRequest, ReadCatalogThumbnail } from '../data/catalog/index.js';
import './catalog-thumbnails.css';

const cacheSize = 32;

interface CatalogThumbnailProps {
  readonly request: CatalogThumbnailRequest;
  readonly read: ReadCatalogThumbnail;
}

function VisibleThumbnail({
  request: { boardId, revision, trashed },
  read,
}: CatalogThumbnailProps) {
  const mount = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState<string>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    const element = mount.current;
    if (!element) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    const Observer = element.ownerDocument.defaultView?.IntersectionObserver;
    const observer = Observer ? new Observer(onIntersection) : undefined;
    let started = false;

    function load() {
      if (started || signal.aborted) {
        return;
      }

      started = true;
      read({ boardId, revision, trashed }, signal)
        .then((next) => {
          if (!signal.aborted) {
            setSource(next);
          }
        })
        .catch((error: unknown) => {
          if (!signal.aborted) {
            setFailure(error instanceof Error ? error.message : '读取缩略图失败。');
          }
        });
    }

    function onIntersection(entries: IntersectionObserverEntry[]) {
      if (entries.some(({ isIntersecting }) => isIntersecting)) {
        observer?.disconnect();
        load();
      }
    }

    if (observer) {
      observer.observe(element);
    } else {
      load();
    }

    return () => {
      observer?.disconnect();
      controller.abort();
    };
  }, [boardId, revision, trashed, read]);

  return (
    <span
      ref={mount}
      className="studio-catalog-thumbnail"
      aria-hidden="true"
      title={failure}
      data-preview-failed={Boolean(failure) || undefined}
    >
      {source && !failure && (
        <img src={source} alt="" draggable={false} onError={() => setFailure('缩略图无法显示。')} />
      )}
      {failure && <small>预览暂不可用</small>}
    </span>
  );
}

function thumbnailKey({ boardId, revision, trashed }: CatalogThumbnailRequest) {
  return JSON.stringify([boardId, revision.toString(), trashed]);
}

export function createCatalogThumbnailRenderer(read: ReadCatalogThumbnail) {
  const cache = new Map<string, string>();

  const readCached: ReadCatalogThumbnail = async (request, signal) => {
    signal?.throwIfAborted();
    const key = thumbnailKey(request);
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }

    const source = await read(request, signal);
    signal?.throwIfAborted();
    if (source) {
      cache.set(key, source);
      if (cache.size > cacheSize) {
        const first = cache.keys().next().value;
        if (first !== undefined) {
          cache.delete(first);
        }
      }
    }

    return source;
  };

  return (request: CatalogThumbnailRequest) => (
    <VisibleThumbnail key={thumbnailKey(request)} request={request} read={readCached} />
  );
}
