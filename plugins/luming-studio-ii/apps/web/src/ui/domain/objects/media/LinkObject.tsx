import type { LinkObjectProps } from './contracts.js';
import './media-object.css';

export function safeHttpLink(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const url = URL.parse(value);
  if (!url || url.username || url.password) {
    return undefined;
  }

  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
}

export function ExternalLinkIcon({ size = 17 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6m0-6-9 9m6 1v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function LinkObject({
  label,
  href,
  interactive = true,
  showDetails = true,
}: LinkObjectProps) {
  const url = safeHttpLink(href);
  const title = label || '链接';

  return (
    <div className="luming-media-link" title={showDetails ? undefined : title}>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="m10 13 4-4m-6 7-1 1a3.5 3.5 0 1 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 7a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 1 0-5-5l-1 1" />
      </svg>
      {showDetails && (
        <div className="luming-media-link__content">
          <strong>{title}</strong>
          {href && <span>{href}</span>}
        </div>
      )}
      {showDetails && url && interactive && (
        <a
          className="luming-media-link__target"
          aria-label="打开链接"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-canvas-native=""
        >
          <ExternalLinkIcon />
        </a>
      )}
    </div>
  );
}
