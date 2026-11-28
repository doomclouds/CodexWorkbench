import { Button, StatusText } from '../../ui/base/index.js';
import type { FeedbackAttachment } from './use-feedback-attachment.js';

export function FeedbackAttachmentNotice({
  attachment,
}: {
  readonly attachment: FeedbackAttachment;
}) {
  const { busy, failure, pending, retry, cancel } = attachment;
  if (busy) {
    return <StatusText message="正在附加到 Codex 对话…" announcement="polite" />;
  }
  if (!failure) {
    return null;
  }

  return (
    <div className="whiteboard-feedback__notice">
      {pending?.saved && (
        <StatusText message="备注已保存，附加失败后可直接重试。" announcement="polite" />
      )}
      <StatusText message={failure} tone="error" announcement="assertive" />
      {pending && (
        <div className="whiteboard-feedback__actions">
          <Button label="重试附加" onActivate={retry} />
          <Button label="放弃附加" onActivate={cancel} />
        </div>
      )}
    </div>
  );
}
