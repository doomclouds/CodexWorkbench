import { ChevronDown, LoaderCircle } from 'lucide-react';
import { Button } from '../../ui/base/index.js';

interface FeedbackPagerProps {
  readonly label: string;
  readonly pending: boolean;
  readonly onActivate: () => void;
}

export function FeedbackPager({ label, pending, onActivate }: FeedbackPagerProps) {
  return (
    <div className="whiteboard-feedback__pager">
      <Button
        label={pending ? '加载中…' : label}
        variant="ghost"
        icon={pending ? <LoaderCircle size={14} /> : <ChevronDown size={14} />}
        busy={pending}
        onActivate={onActivate}
      />
    </div>
  );
}
