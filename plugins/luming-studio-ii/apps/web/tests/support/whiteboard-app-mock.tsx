import { act } from 'react';
import { WhiteboardApp } from '../../src/app/index.js';
import {
  createWhiteboardService,
  type WhiteboardEditService,
  type WhiteboardPost,
  type WhiteboardService,
} from '../../src/data/whiteboard/index.js';
import { createControlFixture } from './render-control.js';

export const boardCommandId = 'fixture-command';

function withCanvasLayout() {
  const key = 'getBoundingClientRect';
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
  Object.defineProperty(HTMLElement.prototype, key, {
    configurable: true,
    value: () => new DOMRect(0, 0, 900, 600),
  });

  return () => {
    if (original) {
      Object.defineProperty(HTMLElement.prototype, key, original);
      return;
    }

    Reflect.deleteProperty(HTMLElement.prototype, key);
  };
}

interface Point {
  readonly x: number;
  readonly y: number;
}

type PointerModifiers = Pick<PointerEventInit, 'altKey' | 'shiftKey'>;

function emitPointer(
  target: HTMLElement,
  type: string,
  { x, y }: Point,
  modifiers?: PointerModifiers,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      isPrimary: true,
      pointerType: 'mouse',
      pointerId: 1,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: y,
      ...modifiers,
    }),
  );
}

async function update(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

interface AppMockOptions {
  readonly editService?: WhiteboardEditService;
  readonly createCommandId?: () => string;
}

export function createAppMock(
  source: WhiteboardPost | WhiteboardService,
  { editService, createCommandId = () => boardCommandId }: AppMockOptions = {},
) {
  const restoreLayout = withCanvasLayout();
  const fixture = createControlFixture();
  const service = typeof source === 'function' ? createWhiteboardService(source) : source;

  function canvas(): HTMLElement {
    const root = fixture.host.querySelector<HTMLElement>('[data-canvas-root]');
    if (!root) {
      throw new Error('The whiteboard did not mount a Canvas.');
    }

    return root;
  }

  return {
    host: fixture.host,
    canvas,
    update,
    async open(boardId: string, key?: string) {
      await update(() =>
        fixture.render(
          <WhiteboardApp
            key={key}
            boardId={boardId}
            service={service}
            editService={editService}
            createCommandId={createCommandId}
          />,
        ),
      );
    },
    async drag(from: Point, to: Point, target?: HTMLElement, modifiers?: PointerModifiers) {
      const root = canvas();
      await update(() => {
        emitPointer(target ?? root, 'pointerdown', from, modifiers);
        emitPointer(root, 'pointermove', to, modifiers);
        emitPointer(root, 'pointerup', to, modifiers);
      });
    },
    async click(label: string) {
      const button = [...fixture.host.querySelectorAll('button')].find(
        (candidate) =>
          candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label,
      );

      if (!button) {
        throw new Error('Missing whiteboard action: ' + label);
      }

      await update(() => button.click());
    },
    dispose() {
      fixture.dispose();
      restoreLayout();
    },
  };
}
