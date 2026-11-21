import { AlertCircle, Check, Loader2 } from 'lucide-react';
import type { ProductActivity } from '../product-contract';
import type { SessionStatus } from './session-status';
import './save-status.css';

interface Props {
  activity: Pick<ProductActivity, 'dirty' | 'saving' | 'saveError'>;
  sync: 'loading' | 'saved' | 'reconnecting';
  session: SessionStatus;
  canEdit: boolean;
}

const labels = {
  checking: '核对权限中',
  'connection-error': '连接异常',
  readonly: '只读',
  error: '保存异常',
  saving: '保存中…',
  dirty: '未保存',
  loading: '加载中',
  saved: '已保存',
};

function statusFor({ activity, sync, session, canEdit }: Props): keyof typeof labels {
  if (session === 'checking') {
    return 'checking';
  }
  if (session === 'reconnecting') {
    return activity.saveError ? 'error' : 'connection-error';
  }
  if (!canEdit) {
    return 'readonly';
  }
  if (activity.saveError) {
    return 'error';
  }
  if (sync === 'reconnecting') {
    return 'connection-error';
  }
  if (activity.saving) {
    return 'saving';
  }

  return activity.dirty ? 'dirty' : sync;
}

export function SaveStatus(props: Props) {
  const { activity } = props;
  const status = statusFor(props);
  let title = labels[status];
  if (status === 'error') {
    title = activity.saveError || title;
  } else if (status === 'connection-error') {
    title = '连接已中断，未提交的草稿仍保留在本页。';
  } else if (status === 'readonly' && activity.dirty) {
    title = '当前为只读，未提交的草稿仍保留在本页。';
  }

  const pending = ['saving', 'loading', 'checking'].includes(status);
  const hasError = status === 'error' || status === 'connection-error';
  const ResultIcon = hasError ? AlertCircle : Check;

  return (
    <span
      className={`studio-save-status studio-save-${status}`}
      data-save-status={status}
      role="status"
      aria-label={labels[status]}
      title={title}
    >
      {pending ? <Loader2 size={13} className="studio-spin" /> : <ResultIcon size={13} />}
      {labels[status]}
    </span>
  );
}
