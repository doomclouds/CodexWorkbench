import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CanvasFormatToolbar from '../src/app/canvas/CanvasFormatToolbar.js';
import type { BoardElement } from '../src/contracts/studio.js';

type Props = ComponentProps<typeof CanvasFormatToolbar>;

let host: HTMLDivElement;
let root: Root;
let sheet: HTMLStyleElement;
const element = (type: BoardElement['type'], extra: Partial<BoardElement> = {}): BoardElement => ({
  id: type,
  type,
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  version: 1,
  ...extra,
});
const query = <T extends HTMLElement = HTMLElement>(label: string) =>
  host.querySelector<T>(`[aria-label="${label}"]`)!;
const selectionAt = (center: number, toolbarTop: number) => ({
  x: center - 50,
  y: toolbarTop + 50,
  w: 100,
  h: 80,
});

async function click(label: string) {
  await act(async () => query<HTMLButtonElement>(label).click());
}

async function choose(label: string, value: string) {
  await act(async () => {
    const select = query<HTMLSelectElement>(label);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function mount(
  elements: BoardElement[],
  props: Partial<Props> = {},
  withViewControls = false,
) {
  const changed = vi.fn();
  function Harness() {
    const [values, setValues] = useState(elements);

    return (
      <>
        {withViewControls && <div className="studio-canvas-top-tools" />}
        <CanvasFormatToolbar
          elements={values}
          selectionBounds={selectionAt(200, 12)}
          viewport={{ x: 0, y: 0, zoom: 1 }}
          canEdit
          canAnnotate
          saving={false}
          theme="light"
          onEditText={() => {}}
          onTextFormat={() => {}}
          onAnnotate={() => {}}
          onMore={() => {}}
          onAlign={() => {}}
          onChange={(changes) => {
            changed(changes);
            setValues((previous) => previous.map((value) => ({ ...value, ...changes })));
          }}
          {...props}
        />
      </>
    );
  }

  await act(async () => root.render(<Harness />));

  return changed;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sheet = document.createElement('style');
  sheet.textContent = readFileSync(resolve('src/app/canvas/canvas.css'), 'utf8');
  document.head.append(sheet);
  host = document.createElement('div');
  host.className = 'studio-whiteboard';
  host.style.width = '400px';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  sheet.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([800, 300])(
  'measures the real view controls and keeps selection actions clear in a %spx canvas',
  async (width) => {
    const rect = (x: number, y: number, w: number, h: number) => ({
      x,
      y,
      left: x,
      top: y,
      right: x + w,
      bottom: y + h,
      width: w,
      height: h,
      toJSON() {},
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === host) {
        return rect(100, 50, width, 600);
      }
      if (this.classList.contains('studio-canvas-top-tools')) {
        return rect(100 + width - 140, 62, 126, 38);
      }
      if (this.classList.contains('studio-selection-toolbar')) {
        return rect(0, 0, 264, 42);
      }

      return rect(0, 0, 0, 0);
    });
    await mount(
      [element('document')],
      { selectionBounds: { x: 1550, y: -80, w: 100, h: 10 } },
      true,
    );
    const toolbar = query('选区格式');
    const left = parseFloat(toolbar.style.left) - 132;
    const top = parseFloat(toolbar.style.top);
    expect(left + 264 <= width - 148 || top >= 58).toBe(true);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + 264).toBeLessThanOrEqual(width - 12);
  },
);

it('changes a document frame fill through the same palette without offering global text formatting', async () => {
  const changed = await mount([element('document', { fill: '#EFEFEF' })]);
  expect(query('文字颜色')).toBeNull();
  expect(query('文字大小')).toBeNull();
  await click('填充颜色');
  expect(query('填充色板')).not.toBeNull();
  expect(query('无颜色')).toBeNull();
  await click('填充 绿色');
  expect(changed).toHaveBeenLastCalledWith({ fill: '#AEE2AB' });
  expect(query('填充 绿色').getAttribute('aria-pressed')).toBe('true');
  expect(query('填充颜色').style.background).toBe('rgb(174, 226, 171)');
});

it('keeps document operations in its header instead of duplicating interaction, edit and focus-note actions', async () => {
  const annotate = vi.fn();
  await mount([element('document')], { onAnnotate: annotate });
  expect(query('与文档内容交互')).toBeNull();
  expect(query('编辑文档')).toBeNull();
  expect(query('聚焦备注')).toBeNull();
  await click('备注所选元素');
  expect(annotate).toHaveBeenCalledOnce();
});

it('respects edit and annotation permissions for document object actions', async () => {
  await mount([element('document')], { canEdit: false, canAnnotate: false });
  expect(query('填充颜色')).toBeNull();
  expect(query('编辑文档')).toBeNull();
  expect(query('聚焦备注')).toBeNull();
  expect(query('备注所选元素')).toBeNull();
});

it('keeps the existing annotation action for ordinary objects', async () => {
  const annotate = vi.fn();
  await mount([element('container')], { onAnnotate: annotate });
  expect(query('聚焦备注')).toBeNull();
  await click('备注所选元素');
  expect(annotate).toHaveBeenCalledOnce();
});

it('lets a mixed document and container selection share a frame fill', async () => {
  const changed = await mount([element('document'), element('container')]);
  await click('填充颜色');
  await click('填充 蓝色');
  expect(changed.mock.lastCall?.[0]).toMatchObject({ fill: '#9DC8F7' });
  expect(query('文字颜色')).toBeNull();
});

it('keeps both native endpoint choices readable and preserves the opposite endpoint when changed', async () => {
  const changed = await mount([element('arrow', { heads: ['circle', 'arrow'] })]);
  for (const label of ['连接线起点', '连接线终点']) {
    const select = query<HTMLSelectElement>(label);
    const style = getComputedStyle(select);
    expect([...select.options].map((option) => option.text)).toEqual(['无', '箭头', '圆点']);
    expect(parseFloat(style.width)).toBeGreaterThanOrEqual(80);
    expect(parseFloat(style.minWidth)).toBeGreaterThanOrEqual(80);
    expect(style.fontSize).toBe('14px');
    expect(parseFloat(style.paddingRight)).toBeGreaterThanOrEqual(22);
    expect(style.flexShrink).toBe('0');
    select.focus();
    expect(document.activeElement).toBe(select);
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    select.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
  }

  await choose('连接线起点', 'none');
  expect(changed).toHaveBeenLastCalledWith({ heads: ['none', 'arrow'] });
  await choose('连接线终点', 'circle');
  expect(changed).toHaveBeenLastCalledWith({ heads: ['none', 'circle'] });
  expect(query<HTMLSelectElement>('连接线起点').value).toBe('none');
  expect(query<HTMLSelectElement>('连接线终点').value).toBe('circle');
  const scroll = getComputedStyle(host.querySelector('.studio-selection-toolbar-scroll')!);
  expect(scroll.flexWrap).toBe('nowrap');
  expect(scroll.overflowX).toBe('auto');
});

interface PanelLayout {
  canvasWidth: number;
  canvasHeight: number;
  toolbarWidth: number;
  panelWidth: number;
  panelHeight: number;
  triggerOffset: number;
}

function measurePanels(layout: PanelLayout) {
  const rect = (x: number, y: number, w: number, h: number) => ({
    x,
    y,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    width: w,
    height: h,
    toJSON() {},
  });
  const toolbarRect = () => {
    const toolbar = query('选区格式');
    const center = parseFloat(toolbar?.style.left || '460');
    const top = parseFloat(toolbar?.style.top || '100');

    return rect(80 + center - layout.toolbarWidth / 2, 40 + top, layout.toolbarWidth, 42);
  };

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === host) {
      return rect(80, 40, layout.canvasWidth, layout.canvasHeight);
    }

    const bar = toolbarRect();
    if (this.classList.contains('studio-selection-toolbar')) {
      return bar;
    }
    if (this.classList.contains('studio-selection-toolbar-scroll')) {
      return rect(bar.left + 7, bar.top + 5, layout.toolbarWidth - 14, 30);
    }

    if (this.classList.contains('studio-format-popover')) {
      const width = Math.min(
        layout.panelWidth,
        parseFloat(this.style.maxWidth || String(layout.panelWidth)),
      );
      const height = Math.min(
        layout.panelHeight,
        parseFloat(this.style.maxHeight || String(layout.panelHeight)),
      );

      return rect(
        bar.left + parseFloat(this.style.left || '0'),
        bar.top + parseFloat(this.style.top || '0'),
        width,
        height,
      );
    }
    if (this.parentElement?.classList.contains('studio-selection-toolbar-scroll')) {
      return rect(
        bar.left + layout.triggerOffset - this.parentElement.scrollLeft,
        bar.top + 5,
        29,
        30,
      );
    }

    return rect(0, 0, 0, 0);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('studio-format-popover') ? layout.panelHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('studio-format-popover')
      ? this.getBoundingClientRect().height
      : 0;
  });
}

it.each(['文字对齐', '文字颜色', '文字链接', '填充颜色', '边框与线条', '对齐对象'])(
  'anchors the %s panel at its actual trigger rather than the toolbar origin',
  async (name) => {
    measurePanels({
      canvasWidth: 900,
      canvasHeight: 600,
      toolbarWidth: 660,
      panelWidth: 220,
      panelHeight: 90,
      triggerOffset: 365,
    });
    await mount(
      name === '对齐对象'
        ? [element('shape'), element('shape', { id: 'second' })]
        : [element('shape')],
      { selectionBounds: selectionAt(450, 120) },
    );
    const trigger = query<HTMLButtonElement>(name);
    await click(name);
    const panel = host.querySelector<HTMLElement>('.studio-format-popover')!;
    const anchor = trigger.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const bar = query('选区格式').getBoundingClientRect();
    expect(bounds.left).toBe(anchor.left);
    expect(bounds.top).toBe(bar.bottom + 7);
    expect(bounds.left - bar.left).toBeGreaterThan(300);
    expect(panel.dataset.placement).toBe('below');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.parentElement).toBe(query('选区格式'));
    expect(panel.closest('.studio-selection-toolbar-scroll')).toBeNull();
  },
);

it('flips a panel above a low toolbar and clamps it within the right canvas edge', async () => {
  measurePanels({
    canvasWidth: 600,
    canvasHeight: 330,
    toolbarWidth: 540,
    panelWidth: 220,
    panelHeight: 130,
    triggerOffset: 490,
  });
  await mount([element('shape')], { selectionBounds: selectionAt(500, 265) });
  await click('填充颜色');
  const panel = host.querySelector<HTMLElement>('.studio-format-popover')!;
  const bounds = panel.getBoundingClientRect();
  const bar = query('选区格式').getBoundingClientRect();
  expect(panel.dataset.placement).toBe('above');
  expect(bounds.bottom).toBe(bar.top - 7);
  expect(bounds.left).toBeGreaterThanOrEqual(92);
  expect(bounds.right).toBeLessThanOrEqual(668);
  expect(bounds.top).toBeGreaterThanOrEqual(52);
});

it('constrains a tall panel and closes it when its trigger scrolls out of the toolbar', async () => {
  const layout = {
    canvasWidth: 320,
    canvasHeight: 260,
    toolbarWidth: 296,
    panelWidth: 420,
    panelHeight: 600,
    triggerOffset: 150,
  };
  measurePanels(layout);
  await mount([element('shape')], { selectionBounds: selectionAt(160, 110) });
  await click('文字颜色');
  const panel = host.querySelector<HTMLElement>('.studio-format-popover')!;
  const bounds = panel.getBoundingClientRect();
  expect(parseFloat(panel.style.maxWidth)).toBe(296);
  expect(bounds.left).toBeGreaterThanOrEqual(92);
  expect(bounds.right).toBeLessThanOrEqual(388);
  expect(bounds.top).toBeGreaterThanOrEqual(52);
  expect(bounds.bottom).toBeLessThanOrEqual(288);
  expect(getComputedStyle(panel).overflow).toBe('auto');
  const scroller = host.querySelector<HTMLElement>('.studio-selection-toolbar-scroll')!;
  await act(async () => {
    scroller.scrollLeft = 400;
    scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
  });
  expect(host.querySelector('.studio-format-popover')).toBeNull();
});

it('repositions an open panel after toolbar scrolling and after its content grows', async () => {
  const layout = {
    canvasWidth: 900,
    canvasHeight: 480,
    toolbarWidth: 660,
    panelWidth: 220,
    panelHeight: 70,
    triggerOffset: 365,
  };
  measurePanels(layout);
  await mount([element('shape')], { selectionBounds: selectionAt(450, 240) });
  await click('文字颜色');
  const panel = host.querySelector<HTMLElement>('.studio-format-popover')!;
  const before = panel.getBoundingClientRect();
  const scroller = host.querySelector<HTMLElement>('.studio-selection-toolbar-scroll')!;
  await act(async () => {
    scroller.scrollLeft = 80;
    scroller.dispatchEvent(new Event('scroll'));
  });
  expect(panel.getBoundingClientRect().left).toBe(before.left - 80);
  layout.panelHeight = 250;
  await act(async () => window.dispatchEvent(new Event('resize')));
  expect(panel.dataset.placement).toBe('above');
  expect(panel.getBoundingClientRect().bottom).toBe(
    query('选区格式').getBoundingClientRect().top - 7,
  );
});

it('preserves the active text selection for quick colors and restores its focus on Escape', async () => {
  await mount([element('text')]);
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.tabIndex = 0;
  editor.textContent = 'Selected words';
  document.body.append(editor);
  try {
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 0);
    range.setEnd(editor.firstChild!, 8);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    await act(async () => query('文字颜色').dispatchEvent(pointer));
    expect(pointer.defaultPrevented).toBe(true);
    await click('文字颜色');
    expect(document.activeElement).toBe(editor);
    expect(document.getSelection()!.toString()).toBe('Selected');
    await click('墨色 蓝色');
    expect(document.getSelection()!.toString()).toBe('Selected');
    await act(async () =>
      editor.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('.studio-format-popover')).toBeNull();
    expect(document.activeElement).toBe(editor);
  } finally {
    editor.remove();
  }
});

it('focuses the link field and restores the invoking button after applying', async () => {
  const format = vi.fn();
  await mount([element('text')], { onTextFormat: format });
  await click('文字链接');
  const input = query<HTMLInputElement>('文字链接地址');
  expect(document.activeElement).toBe(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'https://example.com',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(format).toHaveBeenCalledWith('link', 'https://example.com');
  expect(host.querySelector('.studio-format-popover')).toBeNull();
  expect(document.activeElement).toBe(query('文字链接'));
});

it('anchors a keyboard-requested link at its link button and focuses the existing address', async () => {
  measurePanels({
    canvasWidth: 900,
    canvasHeight: 600,
    toolbarWidth: 660,
    panelWidth: 220,
    panelHeight: 90,
    triggerOffset: 365,
  });
  await mount([element('text')], {
    selectionBounds: selectionAt(450, 120),
    requestLink: { key: 'link-request', value: 'https://example.com' },
  });
  const input = query<HTMLInputElement>('文字链接地址');
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('https://example.com');
  expect(host.querySelector('.studio-format-popover')!.getBoundingClientRect().left).toBe(
    query('文字链接').getBoundingClientRect().left,
  );
});

it('avoids actual section text and its focused editor while measuring only neighboring candidates', async () => {
  const section = element('container', {
    id: 'section',
    x: 220,
    y: 250,
    w: 260,
    text: '数据架构',
    fontSize: 32,
  });
  const neighbor = element('container', {
    id: 'neighbor',
    x: 390,
    y: 200,
    w: 120,
    text: '推进计划',
    fontSize: 32,
  });
  const unrelated = element('container', {
    id: 'unrelated',
    x: 652,
    y: 380,
    w: 120,
    text: '其它',
    fontSize: 17,
  });
  const titles = [section, neighbor, unrelated];
  const measured = new Set<string>();
  let cameraY = 0;
  const barRect = () => {
    const toolbar = query('选区格式');
    const w = Math.min(420, parseFloat(toolbar?.style.maxWidth || '420'));

    return new DOMRect(
      parseFloat(toolbar?.style.left || '350') - w / 2,
      parseFloat(toolbar?.style.top || '100'),
      w,
      42,
    );
  };

  if (!globalThis.CSS?.escape) {
    vi.stubGlobal('CSS', { escape: (id: string) => id });
  }

  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    range.getBoundingClientRect = () =>
      (range.commonAncestorContainer as Element).querySelector('span')!.getBoundingClientRect();

    return range;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === host) {
      return new DOMRect(0, 0, 800, 600);
    }
    if (this.classList.contains('studio-selection-toolbar')) {
      return barRect();
    }
    if (this.classList.contains('studio-selection-toolbar-scroll')) {
      return barRect();
    }
    if (this.parentElement?.classList.contains('studio-selection-toolbar-scroll')) {
      return new DOMRect(barRect().left + 110, barRect().top + 5, 29, 30);
    }
    if (this.classList.contains('studio-format-popover')) {
      return new DOMRect(
        barRect().left + parseFloat(this.style.left || '0'),
        barRect().top + parseFloat(this.style.top || '0'),
        220,
        Math.min(130, parseFloat(this.style.maxHeight || '130')),
      );
    }

    const object = this.closest<HTMLElement>('[data-element-id]');
    if (!object) {
      return new DOMRect();
    }

    const id = object.dataset.elementId!;
    measured.add(id);
    if (id === neighbor.id) {
      return new DOMRect(390, 150 + cameraY, 120, 40);
    }
    if (id === unrelated.id) {
      return new DOMRect(652, 347 + cameraY, 80, 22);
    }
    if (this.getAttribute('contenteditable') === 'true') {
      return new DOMRect(220, 145 + cameraY, 260, 69);
    }
    if (this.matches('span')) {
      return new DOMRect(220, 200 + cameraY, 130, 32);
    }

    return new DOMRect(220, 200 + cameraY, 260, 40);
  });
  function Scene({ editing }: { editing: boolean }) {
    return (
      <>
        {titles.map((title) => (
          <div key={title.id} data-element-id={title.id}>
            <div data-canvas-external-title="">
              {editing && title.id === section.id ? (
                <div contentEditable suppressContentEditableWarning aria-label="编辑标题">
                  {title.text}
                </div>
              ) : (
                <span>{title.text}</span>
              )}
            </div>
          </div>
        ))}
        <CanvasFormatToolbar
          elements={[section]}
          selectionBounds={section}
          viewport={{ x: 0, y: cameraY, zoom: 1 }}
          titles={titles}
          editingTitle={editing ? section.id : undefined}
          canEdit
          canAnnotate
          saving={false}
          theme="light"
          onChange={() => {}}
          onEditText={() => {}}
          onTextFormat={() => {}}
          onAnnotate={() => {}}
          onMore={() => {}}
          onAlign={() => {}}
        />
      </>
    );
  }

  await act(async () => root.render(<Scene editing={false} />));
  expect(barRect().top).toBe(358);
  expect(measured).toEqual(new Set(['section', 'neighbor']));
  await act(async () => root.render(<Scene editing />));
  const editor = query('编辑标题');
  editor.focus();
  expect(barRect().bottom).toBeLessThan(editor.getBoundingClientRect().top);
  cameraY = 24;
  await act(async () => root.render(<Scene editing />));
  expect(document.activeElement).toBe(editor);
  expect(barRect().bottom).toBe(editor.getBoundingClientRect().top - 8);
  await click('文字链接');
  const dialog = host.querySelector<HTMLElement>('.studio-format-popover')!;
  expect(dialog.dataset.placement).toBe('above');
  expect(dialog.getBoundingClientRect().bottom).toBeLessThan(editor.getBoundingClientRect().top);
  await act(async () =>
    query('文字链接地址').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    ),
  );
  expect(document.activeElement).toBe(editor);
});

it('measures the hit box of a neighboring compact caption beyond its tiny world text projection', async () => {
  const target = element('shape', { x: 3400, y: 2400, w: 500, h: 250 });
  const neighbor = element('container', {
    id: 'neighbor',
    x: 3500,
    y: 2510,
    w: 340,
    h: 270,
    text: '甲',
    fontSize: 17,
  });
  const rect = new DOMRect(350, 231, 30, 16);
  if (!globalThis.CSS?.escape) {
    vi.stubGlobal('CSS', { escape: (id: string) => id });
  }

  const measured = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === host) {
      return new DOMRect(0, 0, 800, 600);
    }

    if (this.dataset.canvasExternalTitle === 'overview') {
      measured();

      return rect;
    }
    if (this.classList.contains('studio-selection-toolbar')) {
      return new DOMRect(0, 0, 420, 42);
    }

    return new DOMRect();
  });
  await act(async () =>
    root.render(
      <>
        <div data-element-id={neighbor.id}>
          <div data-canvas-external-title="overview">甲</div>
        </div>
        <CanvasFormatToolbar
          elements={[target]}
          selectionBounds={target}
          viewport={{ x: 0, y: 0, zoom: 0.1 }}
          titles={[neighbor]}
          canEdit
          canAnnotate
          saving={false}
          theme="light"
          onEditText={() => {}}
          onTextFormat={() => {}}
          onChange={() => {}}
          onAnnotate={() => {}}
          onMore={() => {}}
          onAlign={() => {}}
        />
      </>,
    ),
  );
  const toolbar = query('选区格式');
  const center = parseFloat(toolbar.style.left);
  const top = parseFloat(toolbar.style.top);
  const width = parseFloat(toolbar.style.maxWidth);
  expect(measured).toHaveBeenCalledOnce();
  expect(
    top + 42 <= rect.top ||
      top >= rect.bottom ||
      center + width / 2 <= rect.left ||
      center - width / 2 >= rect.right,
  ).toBe(true);
});
