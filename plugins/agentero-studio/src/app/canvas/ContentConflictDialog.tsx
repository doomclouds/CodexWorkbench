import type { Board } from '../../contracts/studio.js';
import { StudioDialog } from '../products/dialog.js';
import type { ContentTask } from './content-queue.js';

const names: Record<string, string> = { text: '文字', label: '连接线文字', fill: '填充颜色', color: '文字颜色', stroke: '线条颜色', data: '表格或对象内容', html: 'HTML 源码', state: '交互状态', crop: '图片裁剪', x: '横向位置', y: '纵向位置', w: '宽度', h: '高度', rotation: '旋转角度' };
function readable(value: unknown): string { return typeof value === 'string' ? value : value === undefined ? '（无）' : JSON.stringify(value, null, 2); }
export default function ContentConflictDialog({ task, current, onKeep, onRemote, onOverwrite, onCopy, disabled }: {
  task: ContentTask; current: Board; onKeep: () => void; onRemote: () => void; onOverwrite: () => void; onCopy: () => void; disabled: boolean;
}) {
  const removed = task.keys.some(id => id !== '$board' && task.sources.some(element => element.id === id) && !current.elements.some(element => element.id === id));
  return <StudioDialog title={removed ? '对象已被删除，草稿仍可恢复' : '比较未保存的修改'} onClose={onKeep} wide>
    <p>{removed ? '其他人已删除此对象。可以复制草稿，或将它另存为新对象。' : '同一处内容有了新修改。请比较双方内容，再决定采用哪一份；保留草稿不会覆盖对方。'}</p>
    {task.operations.map((operation, index) => {
      const base = task.sources.find(element => element.id === operation.id), remote = current.elements.find(element => element.id === operation.id);
      const fields = operation.changes ? Object.keys(operation.changes).filter(field => JSON.stringify(base?.[field]) !== JSON.stringify(operation.changes?.[field])) : [];
      return <div key={index}><h4>{base?.text || base?.label || task.summary}</h4>{fields.length ? fields.map(field => <div key={field}>
        <strong>{names[field] ?? field}</strong><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {([['开始编辑时', base?.[field]], ['我的草稿', operation.changes?.[field]], ['当前已保存', remote?.[field]]] as const).map(([title, value]) => <label key={title} className="studio-field-label">{title}<textarea className="studio-source-editor" style={{ minHeight: 120, maxHeight: 280 }} readOnly value={readable(value)} /></label>)}
        </div></div>) : <pre style={{ whiteSpace: 'pre-wrap' }}>{readable(operation)}</pre>}</div>;
    })}
    <div className="studio-modal-footer"><button type="button" className="studio-button" onClick={onCopy}>复制我的草稿</button><button type="button" className="studio-button" onClick={onKeep}>保留草稿</button><button type="button" className="studio-button" onClick={onRemote}>采用当前已保存内容</button><button type="button" className="studio-button studio-primary" disabled={disabled} onClick={onOverwrite}>{removed ? '另存为新对象' : '明确用我的草稿覆盖此处'}</button></div>
  </StudioDialog>;
}
