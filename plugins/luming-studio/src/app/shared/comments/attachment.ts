import type { Feedback } from '../../../contracts/studio.js';

export function attachmentStatus(item: Feedback): 'pending' | 'attached' | null {
  if (item.proposal) {
    return null;
  }

  return item.attachment?.state ?? (item.status === 'pending' ? 'pending' : null);
}

export function isAttachmentPending(item: Feedback): boolean {
  return attachmentStatus(item) === 'pending';
}
