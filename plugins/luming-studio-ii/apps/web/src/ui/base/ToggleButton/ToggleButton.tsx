import './ToggleButton.css';

export interface ToggleButtonProps {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onPressedChange: (next: boolean) => void;
}

export function ToggleButton({ label, pressed, disabled, onPressedChange }: ToggleButtonProps) {
  return (
    <button
      type="button"
      className="studio-ui-toggle-button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
    >
      {label}
    </button>
  );
}
