import { contentTitleLimit, type ContentPayloadPlan } from './object-content-edits.js';

const maximumLinkLength = 4096;
const controlCharacter = /\p{Cc}/u;

export function readLink(value: unknown): URL | undefined {
  if (
    typeof value !== 'string' ||
    value.length > maximumLinkLength ||
    controlCharacter.test(value)
  ) {
    return undefined;
  }

  const url = URL.parse(value.trim());
  if (!url || url.username || url.password) {
    return undefined;
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    return url;
  }
}

export function editLinkContent(title: string, href: string): ContentPayloadPlan {
  const url = readLink(href);
  if (!url || title.length > contentTitleLimit || controlCharacter.test(title)) {
    return { kind: 'rejected', reason: 'invalidEdit' };
  }

  return { kind: 'updated', label: title.trim() || url.hostname, data: { href: url.href } };
}
