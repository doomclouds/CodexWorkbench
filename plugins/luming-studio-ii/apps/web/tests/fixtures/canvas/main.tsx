import { useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  Button,
  ScrollRegion,
  TextArea,
  ToggleButton,
  Toolbar,
} from '../../../src/ui/base/index.js';
import {
  Canvas,
  type CanvasHandle,
  type CanvasTool,
  type CanvasViewport,
} from '../../../src/ui/domain/canvas/index.js';
import { initialReceiptState, reduceReceipts } from './receipts.js';
import './style.css';

const initialViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 };
const previewRows = [
  '检查滚动是否停留在原生内容内。',
  '拖动选中文字时，应保留文本选择。',
  '在文本框中输入并按方向键，检查光标移动。',
  '从这个区域移出后，用滚轮平移画布。',
  '按住 Ctrl 或 ⌘ 滚轮缩放画布。',
  '切换平移工具后，拖动原生内容可平移画布。',
  '切换只读后，检查移动与缩放手柄的限制。',
];

interface NativeContentProps {
  readOnly: boolean;
  text: string;
  onTextChange: (text: string) => void;
}

function NativeContent({ readOnly, text, onTextChange }: NativeContentProps) {
  return (
    <div className="canvas-fixture-native">
      <TextArea
        label="原生文本框"
        value={text}
        onValueChange={onTextChange}
        readOnly={readOnly}
        rows={2}
      />
      <ScrollRegion axis="vertical" label="原生滚动区" contain>
        <ul>
          {previewRows.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      </ScrollRegion>
    </div>
  );
}

function CanvasFixture() {
  const handle = useRef<CanvasHandle>(null);
  const [model, dispatch] = useReducer(reduceReceipts, initialReceiptState);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [readOnly, setReadOnly] = useState(false);
  const [text, setText] = useState('在这里输入文字或拖选文本。');
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [visible, setVisible] = useState<readonly string[]>([]);
  const [viewport, setViewport] = useState(initialViewport);
  const content = useMemo(() => {
    const native = <NativeContent readOnly={readOnly} text={text} onTextChange={setText} />;

    return new Map<string, ReactNode>([['native', native]]);
  }, [readOnly, text]);
  const activeEdit = model.pending[0];
  const lastRejectedId = model.lastRejectedId;

  function handleFitSelection() {
    const ids = selection.length > 0 ? selection : model.scene.objects.map(({ id }) => id);
    handle.current?.fitToObjects(ids);
  }

  function releaseReceipt(accepted: boolean) {
    if (activeEdit) {
      dispatch({ type: 'receipt', interactionId: activeEdit.interactionId, accepted });
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
        <p>拖动重叠图形检查命中顺序。松开后用回执按钮确认或拒绝位置变化。</p>
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
          <ToggleButton label="只读" pressed={readOnly} onPressedChange={setReadOnly} />
          <Button label="适配选区" onActivate={handleFitSelection} />
          <Button label="聚焦画布" onActivate={() => handle.current?.focus()} />
        </Toolbar>
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
