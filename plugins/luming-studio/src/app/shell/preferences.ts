import { useEffect, useState } from 'react';
import { reportStudioWarning } from '../shared/studio-warning';

type Theme = 'system' | 'light' | 'dark';

function savedPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key) as T;

    return allowed.includes(value) ? value : fallback;
  } catch (cause) {
    reportStudioWarning('无法读取 Studio 偏好设置。', cause);

    return fallback;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (cause) {
    reportStudioWarning('无法保存 Studio 偏好设置。', cause);
  }
}

function systemTheme(
  media = window.matchMedia?.('(prefers-color-scheme: dark)'),
): 'light' | 'dark' {
  const host = document.documentElement.dataset.theme;
  if (host === 'dark' || host === 'light') {
    return host;
  }

  return media?.matches ? 'dark' : 'light';
}

export function useStudioPreferences() {
  const [layout, updateLayout] = useState<'grid' | 'list'>(() =>
    savedPreference('luming-studio-view', 'grid', ['grid', 'list']),
  );
  const [theme, setTheme] = useState<Theme>(() =>
    savedPreference('luming-studio-theme', 'system', ['system', 'light', 'dark']),
  );
  const [preferredSystemTheme, setPreferredSystemTheme] = useState(systemTheme);
  const resolvedTheme = theme === 'system' ? preferredSystemTheme : theme;
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => setPreferredSystemTheme(systemTheme(media));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    media?.addEventListener?.('change', update);

    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    savePreference('luming-studio-theme', theme);
  }, [theme]);

  function handleLayoutChange(value: 'grid' | 'list') {
    updateLayout(value);
    savePreference('luming-studio-view', value);
  }

  return { layout, handleLayoutChange, setTheme, resolvedTheme };
}
