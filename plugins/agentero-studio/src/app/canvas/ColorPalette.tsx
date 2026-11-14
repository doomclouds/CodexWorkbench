import { Check, Plus } from 'lucide-react';
import { FILL_COLORS, INK_COLORS } from './native-palette.js';

export default function ColorPalette({ value, onChange, kind = 'ink', theme, custom = [], onCustomChange, none, presetOnly = false }: { value?: string; onChange: (value: string) => void; kind?: 'fill' | 'ink'; theme: 'light' | 'dark'; custom?: string[]; onCustomChange?: (colors: string[]) => void; none?: () => void; presetOnly?: boolean }) {
  const colors = kind === 'fill' ? FILL_COLORS : INK_COLORS;
  return <div className="studio-native-colors" role="group" aria-label={kind === 'fill' ? '填充色板' : '墨色色板'}>
    {colors.map(color => <button type="button" key={color[0]} aria-label={`${kind === 'fill' ? '填充' : '墨色'} ${color[1]}`} title={color[1]} aria-pressed={value?.toLowerCase() === color[2].toLowerCase()} style={{ background: color[theme === 'dark' ? 3 : 2] }} onClick={() => onChange(color[2])}>{value?.toLowerCase() === color[2].toLowerCase() && <Check size={13} />}</button>)}
    {custom.map(color => <button type="button" key={color} style={{ background: color }} aria-label={`自定义颜色 ${color}`} aria-pressed={value === color} title={`${color} · 右键移除`} onClick={() => onChange(color)} onContextMenu={event => { event.preventDefault(); onCustomChange?.(custom.filter(item => item !== color)); }} />)}
    {!presetOnly && <label className="studio-custom-color" title="添加自定义颜色"><Plus size={15} /><input aria-label="自定义颜色" type="color" value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#D97757'} onChange={event => { const color = event.target.value; onChange(color); if (!custom.includes(color)) onCustomChange?.([...custom, color]); }} /></label>}
    {none && <button type="button" className="studio-no-color" aria-label="无颜色" title="无颜色" onClick={none}>∅</button>}
  </div>;
}
