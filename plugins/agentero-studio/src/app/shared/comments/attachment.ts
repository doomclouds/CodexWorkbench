import type { Feedback } from '../../../contracts/studio.js';

/** Legacy pending comments predate attachment receipts and still need the owner's attention. */
export function attachmentStatus(item: Feedback): 'pending' | 'attached' | null {
  if (item.proposal) return null;
  return item.attachment?.state ?? (item.status === 'pending' ? 'pending' : null);
}
export function isAttachmentPending(item: Feedback): boolean { return attachmentStatus(item) === 'pending'; }
