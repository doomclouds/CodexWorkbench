import { useId, type ChangeEvent } from 'react';
import './ChoiceGroup.css';

export interface ChoiceGroupOption {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface ChoiceGroupProps {
  label: string;
  value: string;
  options: readonly ChoiceGroupOption[];
  disabled?: boolean;
  onValueChange: (id: string) => void;
}

export function ChoiceGroup({ label, value, options, disabled, onValueChange }: ChoiceGroupProps) {
  const groupName = useId();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.currentTarget.checked) {
      onValueChange(event.currentTarget.value);
    }
  }

  return (
    <fieldset className="studio-ui-choice-group" disabled={disabled}>
      <legend className="studio-ui-choice-group__legend">{label}</legend>
      <div className="studio-ui-choice-group__options">
        {options.map((option) => (
          <label key={option.id} className="studio-ui-choice-group__option">
            <input
              className="studio-ui-choice-group__input"
              type="radio"
              name={groupName}
              value={option.id}
              checked={option.id === value}
              disabled={option.disabled}
              onChange={handleChange}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
