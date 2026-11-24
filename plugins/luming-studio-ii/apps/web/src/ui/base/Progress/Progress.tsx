import './Progress.css';

export interface ProgressProps {
  value?: number;
  max?: number;
  label: string;
}

export function Progress({ value, max, label }: ProgressProps) {
  const maximum = max !== undefined && Number.isFinite(max) && max > 0 ? max : undefined;
  const position =
    value !== undefined && Number.isFinite(value)
      ? Math.max(0, Math.min(value, maximum ?? 1))
      : undefined;

  return (
    <progress className="studio-ui-progress" aria-label={label} max={maximum} value={position} />
  );
}
