import { useEffect, useState } from 'react';
import { StatusText } from '../../../base/index.js';
import type { DocumentBlock, DocumentObjectProps } from './contracts.js';
import {
  isPrivateDocumentAssetSource,
  safeDocumentImage,
  safeResolvedDocumentImage,
} from './model.js';

interface DocumentImageProps {
  readonly block: DocumentBlock;
  readonly resolveImage?: DocumentObjectProps['resolveImage'];
}

interface ImageResolution {
  readonly requested: string;
  readonly url?: string;
  readonly failure?: string;
}

const unavailableImage = '图片尚未加载或已不可用';

function readImageLabel(block: DocumentBlock) {
  const { caption, name } = block.props;
  if (typeof caption === 'string') {
    return caption;
  }

  return typeof name === 'string' ? name : '';
}

export function DocumentImage({ block, resolveImage }: DocumentImageProps) {
  const props = block.props;
  const source = typeof props.url === 'string' ? props.url : '';
  const needsAuthority = resolveImage && isPrivateDocumentAssetSource(source);
  const direct = needsAuthority ? undefined : safeDocumentImage(source);
  const [resolved, setResolved] = useState<ImageResolution>();
  const needResolve = Boolean(source) && !direct && Boolean(resolveImage);
  const current = resolved?.requested === source ? resolved : undefined;
  const url = direct ?? current?.url;
  const caption = readImageLabel(block);
  const previewWidth = Number(props.previewWidth);

  useEffect(() => {
    if (!needResolve || !resolveImage) {
      return;
    }

    const controller = new AbortController();
    Promise.resolve()
      .then(() => (controller.signal.aborted ? undefined : resolveImage(source, controller.signal)))
      .then((reply) => {
        const url = safeResolvedDocumentImage(reply);
        if (!controller.signal.aborted) {
          setResolved({ requested: source, url });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const failure = error instanceof Error ? error.message : unavailableImage;
          setResolved({ requested: source, failure });
        }
      });

    return () => controller.abort();
  }, [needResolve, resolveImage, source]);

  if (!url) {
    const loading = needResolve && !current;

    return (
      <StatusText
        message={loading ? '正在加载图片' : current?.failure || unavailableImage}
        busy={loading}
        tone={current?.failure ? 'error' : 'neutral'}
        announcement="polite"
      />
    );
  }

  return (
    <figure className="studio-document-image">
      <img
        alt={caption}
        src={url}
        loading="lazy"
        style={{ inlineSize: previewWidth || undefined }}
      />
      {typeof props.caption === 'string' && props.caption && (
        <figcaption>{props.caption}</figcaption>
      )}
    </figure>
  );
}
