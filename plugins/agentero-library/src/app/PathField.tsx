import { useEffect, useRef, useState } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import type { FilePickerFilter, FilePickerInput, FilePickerMode, FilePickerResult } from '../contracts/picker';
import { callTool } from './api';
import { messageOf } from './model';
import './path-field.css';

interface Props {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  mode: FilePickerMode;
  title?: string;
  filters?: FilePickerFilter[];
  disabled?: boolean;
  pickerDisabled?: boolean;
  placeholder?: string;
  buttonLabel?: string;
  onPickingChange?(picking: boolean): void;
}

export function PathField({ id, label, value, onChange, mode, title, filters, disabled, pickerDisabled, placeholder, buttonLabel, onPickingChange }: Props) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  async function choose() {
    if (disabled || pickerDisabled || picking) return;
    controller.current = new AbortController();
    setPicking(true); setError(''); onPickingChange?.(true);
    try {
      const input: FilePickerInput = { mode, title: title ?? label, ...(value ? { defaultPath: value } : {}), ...(filters?.length ? { filters } : {}) };
      const result = await callTool<FilePickerResult>('file_picker', { ...input }, { signal: controller.current.signal });
      if (!mounted.current || result.cancelled) return;
      if (!result.paths?.[0]) throw new Error('选择器未返回路径，请重新选择。');
      onChange(result.paths[0]);
    } catch (reason) { if (mounted.current && !controller.current.signal.aborted) setError(messageOf(reason)); }
    finally { if (mounted.current) { setPicking(false); onPickingChange?.(false); } controller.current = null; }
  }

  return <div className="path-field">
    <label htmlFor={id}>{label}</label>
    <div className="path-field-row">
      <input id={id} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} disabled={disabled || picking} aria-describedby={error ? `${id}-picker-error` : undefined} />
      <button type="button" className="path-field-browse" disabled={disabled || pickerDisabled || picking} onClick={() => void choose()} aria-label={buttonLabel ?? (mode === 'open-directory' ? `选择${label}目录` : `选择${label}文件`)}>
        {picking ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}<span>{buttonLabel ?? (mode === 'open-directory' ? '选择目录…' : mode === 'save-file' ? '选择位置…' : '选择文件…')}</span>
      </button>
    </div>
    {picking && <p className="field-help" role="status">请在系统选择器中完成选择；取消会保留原值。</p>}
    {error && <p className="field-help warning-text" id={`${id}-picker-error`} role="alert">{error}</p>}
  </div>;
}
