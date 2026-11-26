import { act } from 'react';
import { WhiteboardApp } from '../../src/app/index.js';
import { createWhiteboardService, type WhiteboardPost } from '../../src/data/whiteboard/index.js';
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

function emitPointer(target: HTMLElement, type: string, { x, y }: Point) {
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
    }),
  );
}

async function update(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

export function createAppMock(post: WhiteboardPost) {
  const restoreLayout = withCanvasLayout();
  const fixture = createControlFixture();
  const service = createWhiteboardService(post);

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
    async open(boardId: string) {
      await update(() =>
        fixture.render(
          <WhiteboardApp
            boardId={boardId}
            service={service}
            createCommandId={() => boardCommandId}
          />,
        ),
      );
    },
    async drag(from: Point, to: Point) {
      const root = canvas();
      await update(() => {
        emitPointer(root, 'pointerdown', from);
        emitPointer(root, 'pointermove', to);
        emitPointer(root, 'pointerup', to);
      });
    },
    async click(label: string) {
      const button = [...fixture.host.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === label,
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
