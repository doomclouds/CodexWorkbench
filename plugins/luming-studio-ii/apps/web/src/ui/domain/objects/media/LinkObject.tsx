import type { LinkObjectProps } from './contracts.js';
import './media-object.css';

export function safeHttpLink(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const url = URL.parse(value);

  return url?.protocol === 'https:' || url?.protocol === 'http:' ? url.href : undefined;
}

export function LinkObject({ label = '链接', href, interactive = true }: LinkObjectProps) {
  const url = safeHttpLink(href);

  return (
    <div className="luming-media-link">
      <div className="luming-media-link__content">
        <strong>{label}</strong>
        {href && <span>{href}</span>}
      </div>
      {url && interactive && (
        <a
          className="luming-media-link__target"
          aria-label="打开链接"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          打开
        </a>
      )}
    </div>
  );
}
