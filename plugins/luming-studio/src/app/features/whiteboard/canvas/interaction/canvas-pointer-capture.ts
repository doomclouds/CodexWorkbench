import type { MouseEvent, PointerEvent } from 'react';

type NavigationStart = { kind: 'pan' } | { kind: 'document-control'; id: string };

export function createCanvasPointerCapture() {
  let navigationClick = false;
  let placementClick: 'released' | 'clicked' | null = null;

  function prepareNavigation(
    event: PointerEvent<HTMLDivElement>,
    primaryPanEnabled: boolean,
    reading: boolean,
  ): NavigationStart | undefined {
    navigationClick = false;
    const leftButtonPan = event.button === 0 && primaryPanEnabled;
    if (event.button !== 1 && !leftButtonPan) {
      if (event.button === 0 && !reading) {
        const target = event.target as HTMLElement;
        const id = target.closest('[data-element-id]')?.getAttribute('data-element-id');
        if (id && target.closest('[data-document-controls]')) {
          return { kind: 'document-control', id };
        }
      }
      return;
    }

    navigationClick = event.button === 0;
    const target = event.target as HTMLElement;
    const reader = target.closest<HTMLElement>('.studio-document-scroll');
    if (reader && !target.closest('input,textarea,select,[contenteditable="true"]')) {
      reader.focus({ preventScroll: true });
    }

    return { kind: 'pan' };
  }

  function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (placementClick === 'released') {
      placementClick = 'clicked';
    } else if (event.detail === 1) {
      placementClick = null;
    }

    const blocked = navigationClick;
    navigationClick = false;
    if (blocked && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleDoubleClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (placementClick === 'clicked') {
      placementClick = null;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleAuxClick(event: MouseEvent<HTMLDivElement>) {
    if (event.button === 1) {
      event.preventDefault();
    }
  }

  return {
    prepareNavigation,
    beginPrimaryPointer() {
      if (placementClick === 'released') {
        placementClick = null;
      }
    },
    suppressNavigationClick() {
      navigationClick = true;
    },
    documentPlaced() {
      placementClick = 'released';
    },
    handleClickCapture,
    handleDoubleClickCapture,
    handleAuxClick,
  };
}
