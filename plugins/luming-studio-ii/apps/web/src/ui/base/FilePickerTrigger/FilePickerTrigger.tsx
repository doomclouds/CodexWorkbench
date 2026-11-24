import { Button } from '../Button/Button.js';
import './FilePickerTrigger.css';

export interface FilePickerTriggerOptions {
  accept?: string;
  multiple: boolean;
}

export interface FilePickerTriggerProps {
  label: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onRequestPick: (options: FilePickerTriggerOptions) => void;
}

export function FilePickerTrigger({
  label,
  accept,
  multiple = false,
  disabled,
  busy,
  onRequestPick,
}: FilePickerTriggerProps) {
  return (
    <span className="studio-ui-file-picker-trigger">
      <Button
        label={label}
        disabled={disabled}
        busy={busy}
        onActivate={() => onRequestPick({ accept, multiple })}
      />
    </span>
  );
}
