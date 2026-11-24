import { useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Button, Select, ToggleButton, Toolbar } from '../../../src/ui/base/index.js';
import {
  Canvas,
  type CanvasHandle,
  type CanvasPlacement,
  type CanvasTool,
  type CanvasViewport,
} from '../../../src/ui/domain/canvas/index.js';
import { useFixtureContent } from './contents.js';
import { initialReceiptState, reduceReceipts } from './receipts.js';
import './style.css';

const initialViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 };
const placementPresets: readonly CanvasPlacement[] = [
  { kind: 'shape', label: '菱形', shape: 'diamond', width: 144, height: 100 },
  { kind: 'section', label: '透明分区', transparent: true, width: 268, height: 170 },
  { kind: 'note', label: '便签', width: 140, height: 116 },
  { kind: 'html', label: 'HTML 预览', width: 288, height: 220 },
  { kind: 'document', label: '文档', width: 280, height: 220 },
  { kind: 'todo', label: '待办', width: 228, height: 156 },
  { kind: 'table', label: '表格', width: 288, height: 212 },
];
const placementOptions = placementPresets.map(({ kind, label }) => ({ id: kind, label }));

function CanvasFixture() {
  const handle = useRef<CanvasHandle>(null);
  const placementSequence = useRef(0);
  const [model, dispatch] = useReducer(reduceReceipts, initialReceiptState);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [placement, setPlacement] = useState('shape');
  const [readOnly, setReadOnly] = useState(false);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [visible, setVisible] = useState<readonly string[]>([]);
  const [viewport, setViewport] = useState(initialViewport);
  const content = useFixtureContent(readOnly);
  const activeEdit = model.pending[0];
  const lastRejectedId = model.lastRejectedId;

  function handlePlacementToggle(pressed: boolean) {
    if (!pressed) {
      setTool('select');
      return;
    }

    const object = placementPresets.find(({ kind }) => kind === placement);
    if (object) {
      placementSequence.current += 1;
      setTool({ kind: 'place', requestId: String(placementSequence.current), object });
    }
  }

  function handleFitSelection() {
    const ids = selection.length > 0 ? selection : model.scene.objects.map(({ id }) => id);
    handle.current?.fitToObjects(ids);
  }

  function releaseReceipt(accepted: boolean) {
    if (!activeEdit) {
      return;
    }

    dispatch({ type: 'receipt', interactionId: activeEdit.interactionId, accepted });
    if (accepted && activeEdit.kind === 'create') {
      setSelection([activeEdit.interactionId]);
    }
  }

  function handleLateReceipt() {
    if (lastRejectedId) {
      dispatch({ type: 'receipt', interactionId: lastRejectedId, accepted: true });
    }
  }

  return (
    <main className="canvas-fixture">
      <header>
        <h1>画布交互验收</h1>
        <p>拖动检查命中、吸附和变形。按住 Alt 拖动复制，按 Esc 取消。操作完成后模拟确认或拒绝。</p>
      </header>

      <div className="canvas-fixture-actions">
        <Toolbar label="画布工具">
          <ToggleButton
            label="选择"
            pressed={tool === 'select'}
            onPressedChange={() => setTool('select')}
          />
          <ToggleButton
            label="平移"
            pressed={tool === 'pan'}
            onPressedChange={() => setTool('pan')}
          />
          <ToggleButton
            label="画笔"
            pressed={tool === 'pen'}
            disabled={readOnly}
            onPressedChange={() => setTool('pen')}
          />
          <ToggleButton
            label="连线"
            pressed={tool === 'connector'}
            disabled={readOnly}
            onPressedChange={() => setTool('connector')}
          />
          <ToggleButton label="只读" pressed={readOnly} onPressedChange={setReadOnly} />
          <Button label="适配选区" onActivate={handleFitSelection} />
          <Button label="聚焦画布" onActivate={() => handle.current?.focus()} />
        </Toolbar>
        <div className="canvas-fixture-placement">
          <Select
            label="对象类型"
            value={placement}
            options={placementOptions}
            disabled={readOnly || typeof tool !== 'string'}
            onValueChange={setPlacement}
          />
          <ToggleButton
            label="放置对象"
            pressed={typeof tool !== 'string'}
            disabled={readOnly}
            onPressedChange={handlePlacementToggle}
          />
        </div>
        <Toolbar label="模拟回执">
          <Button label="确认当前" disabled={!activeEdit} onActivate={() => releaseReceipt(true)} />
          <Button
            label="拒绝当前"
            disabled={!activeEdit}
            onActivate={() => releaseReceipt(false)}
          />
          <Button label="补发迟到确认" disabled={!lastRejectedId} onActivate={handleLateReceipt} />
        </Toolbar>
      </div>

      <div className="canvas-fixture-stage">
        <Canvas
          ref={handle}
          viewId="canvas-fixture"
          label="验收画布"
          scene={model.scene}
          selection={selection}
          tool={tool}
          canEdit={!readOnly}
          initialViewport={initialViewport}
          pendingEdits={model.pending}
          contentById={content}
          onSelectionChange={setSelection}
          onToolChange={setTool}
          onEditIntent={(intent) => dispatch({ type: 'edit', intent })}
          onViewportChange={setViewport}
          onVisibleObjectsChange={setVisible}
        />
      </div>

      <dl className="canvas-fixture-status">
        <div>
          <dt>选择对象</dt>
          <dd id="selection">{selection.join(' · ') || '无'}</dd>
        </div>
        <div>
          <dt>可见对象</dt>
          <dd id="visible">{visible.join(' · ') || '无'}</dd>
        </div>
        <div>
          <dt>画布视口</dt>
          <dd id="viewport">
            {Math.round(viewport.zoom * 100)}% · {Math.round(viewport.x)}, {Math.round(viewport.y)}
          </dd>
        </div>
        <div>
          <dt>操作意图</dt>
          <dd id="intents">{model.intentCount}</dd>
        </div>
        <div>
          <dt>待确认</dt>
          <dd id="pending">{model.pending.length}</dd>
        </div>
        <div>
          <dt>确认版次</dt>
          <dd id="revision">{model.scene.revision}</dd>
        </div>
        <div>
          <dt>收到回执</dt>
          <dd id="receipts">
            {model.receiptCount} · {model.lastReceipt}
          </dd>
        </div>
        <div>
          <dt>最近操作</dt>
          <dd id="last-intent">{model.lastIntent?.kind ?? '无'}</dd>
        </div>
      </dl>

      <div className="canvas-fixture-versions" aria-label="对象版本">
        {model.scene.objects.map(({ id, label, version }) => (
          <span key={id} data-object-version={id}>
            {label} v{version}
          </span>
        ))}
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Canvas fixture root is missing.');
}

createRoot(root).render(<CanvasFixture />);
