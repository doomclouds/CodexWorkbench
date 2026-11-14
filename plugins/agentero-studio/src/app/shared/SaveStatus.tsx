import { AlertCircle, Check, Loader2 } from 'lucide-react';
import type { ProductActivity } from '../products';
import type { SessionStatus } from './useStudioSession';
import './save-status.css';

export function SaveStatus({ activity, sync, session, canEdit }: { activity: Pick<ProductActivity, 'dirty' | 'saving' | 'saveError'>; sync: 'loading' | 'saved' | 'reconnecting'; session: SessionStatus; canEdit: boolean }) {
  const status = session === 'checking' ? 'checking' : session === 'reconnecting' ? activity.saveError ? 'error' : 'connection-error' : !canEdit ? 'readonly' : activity.saveError ? 'error' : sync === 'reconnecting' ? 'connection-error' : activity.saving ? 'saving' : activity.dirty ? 'dirty' : sync === 'loading' ? 'loading' : 'saved';
  const labels = { checking: '核对权限中', 'connection-error': '连接异常', readonly: '只读', error: '保存异常', saving: '保存中…', dirty: '未保存', loading: '加载中', saved: '已保存' };
  const title = status === 'error' ? activity.saveError : status === 'connection-error' ? '连接已中断，未提交的草稿仍保留在本页。' : status === 'readonly' && activity.dirty ? '当前为只读，未提交的草稿仍保留在本页。' : undefined;
  return <span className={`studio-save-status studio-save-${status}`} data-save-status={status} role="status" aria-label={labels[status]} title={title || labels[status]}>{['saving', 'loading', 'checking'].includes(status) ? <Loader2 size={13} className="studio-spin" /> : ['error', 'connection-error'].includes(status) ? <AlertCircle size={13} /> : <Check size={13} />}{labels[status]}</span>;
}
