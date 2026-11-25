export function createFrameChannel() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isFrameVisible(frame: HTMLIFrameElement) {
  if (!frame.isConnected || frame.closest('[hidden],[inert],[aria-hidden="true"]')) {
    return false;
  }

  const view = frame.ownerDocument.defaultView;
  for (let node: HTMLElement | null = frame; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') {
      return false;
    }
  }

  return true;
}
