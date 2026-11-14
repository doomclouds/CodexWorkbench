export const FILL_COLORS = [
  ['yellow', '黄色', '#F9E56F', '#F5D515'], ['peach', '桃色', '#F9BD85', '#ED953D'], ['pink', '粉色', '#F7ABC9', '#EE7FAC'], ['green', '绿色', '#AEE2AB', '#72D071'], ['blue', '蓝色', '#9DC8F7', '#6AABF1'], ['purple', '紫色', '#C6BDFA', '#A89AF0'], ['white', '白色', '#EFEFEF', '#EFEFEF'],
] as const;
export const INK_COLORS = [
  ['ink', '墨色', '#0B0B0B', '#EFEFEF'], ['terracotta', '陶土色', '#D97757', '#F0A77F'], ['blue', '蓝色', '#2F7CC4', '#9CCDE8'], ['green', '绿色', '#2E8B57', '#B7DFA4'], ['purple', '紫色', '#7C5CBF', '#CDB6EC'],
] as const;
export function nativePaint(value: unknown, theme: 'light' | 'dark'): unknown {
  if (typeof value !== 'string' || theme === 'light') return value;
  const preset = [...INK_COLORS, ...FILL_COLORS].find(color => color[2].toLowerCase() === value.toLowerCase());
  return preset?.[3] ?? value;
}

const penSvg='<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M4 24 6 16 19 3 25 9 12 22Z" fill="white" stroke="white" stroke-width="4" stroke-linejoin="round"/><path d="m4 24 2-8L19 3l6 6-13 13Zm2-8 6 6M16 6l6 6M4 24l4-1-3-3Z" fill="white" stroke="#252525" stroke-width="1.5" stroke-linejoin="round"/></svg>';
export const PEN_CURSOR=`url("data:image/svg+xml,${encodeURIComponent(penSvg)}") 4 24, crosshair`;
