import { Button, StatusText } from '../../ui/base/index.js';
import type { FeedbackAttachment } from './use-feedback-attachment.js';

export function FeedbackAttachmentNotice({
  attachment,
}: {
  readonly attachment: FeedbackAttachment;
}) {
  const { busy, failure, pending, retry, cancel, mode } = attachment;
  const copying = mode === 'copy';
  if (busy) {
    return <StatusText message={copying ? '正在生成批注引用…' : '附加中…'} announcement="polite" />;
  }
  if (!failure) {
    return null;
  }

  return (
    <div className="whiteboard-feedback__notice">
      {pending?.saved && (
        <StatusText
          message={
            copying ? '备注已保存，复制失败后可直接重试。' : '备注已保存，附加失败后可直接重试。'
          }
          announcement="polite"
        />
      )}
      <StatusText message={failure} tone="error" announcement="assertive" />
      {pending && (
        <div className="whiteboard-feedback__actions">
          <Button label={copying ? '重试复制引用' : '重试附加'} onActivate={retry} />
          <Button label={copying ? '放弃复制' : '放弃附加'} onActivate={cancel} />
        </div>
      )}
    </div>
  );
}
