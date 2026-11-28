import {
  applyDocumentTheme,
  applyHostStyleVariables,
  type App,
} from '@modelcontextprotocol/ext-apps';
import { reportMcpWarning } from './diagnostics.js';

type Theme = 'light' | 'dark';
type Layout = 'grid' | 'list';
type HostContext = ReturnType<App['getHostContext']>;

interface PreferenceValues {
  readonly layout?: Layout;
  readonly theme?: Theme;
  readonly pinnedOnly?: boolean;
}

interface PreferenceStore {
  read(signal: AbortSignal): Promise<PreferenceValues>;
  update(changes: PreferenceValues, signal: AbortSignal): Promise<void>;
}

const requestTimeout = 3_000;
const initializationTimeout = 15_000;
const closeTimeout = 1_500;

export function createMcpPreferences(lifetime: AbortSignal) {
  const listeners = new Set<(theme: Theme) => void>();
  let layout: Layout = 'grid';
  let pinnedOnly = false;
  let selectedTheme: Theme | undefined;
  let hostTheme: Theme = 'light';
  let store: PreferenceStore | undefined;
  let writing: Promise<void> | undefined;

  function applyTheme() {
    const resolvedTheme = selectedTheme ?? hostTheme;
    applyDocumentTheme(resolvedTheme);
    document.documentElement.dataset.theme = resolvedTheme;
    for (const listener of listeners) {
      listener(resolvedTheme);
    }
  }

  function persist(changes: PreferenceValues) {
    const current = store;
    if (!current || lifetime.aborted) {
      return;
    }

    const write = async () => {
      const signal = AbortSignal.any([lifetime, AbortSignal.timeout(requestTimeout)]);
      await current.update(changes, signal);
    };
    const saving = (writing ?? Promise.resolve())
      .then(write)
      .catch((error: unknown) => {
        if (!lifetime.aborted) {
          reportMcpWarning('无法保存工作台偏好。', error);
        }
      })
      .finally(() => {
        if (writing === saving) {
          writing = undefined;
        }
      });
    writing = saving;
  }

  return {
    async initialize(source: PreferenceStore) {
      const signal = AbortSignal.any([lifetime, AbortSignal.timeout(initializationTimeout)]);
      const saved = await source.read(signal).catch((error: unknown) => {
        if (!lifetime.aborted) {
          reportMcpWarning('无法读取已保存的工作台偏好。', error);
        }

        return undefined;
      });

      if (lifetime.aborted) {
        return false;
      }

      store = source;
      layout = saved?.layout ?? layout;
      pinnedOnly = saved?.pinnedOnly ?? pinnedOnly;
      selectedTheme = saved?.theme ?? selectedTheme;
      applyTheme();

      return true;
    },
    read() {
      return { layout, pinnedOnly, resolvedTheme: selectedTheme ?? hostTheme };
    },
    rememberLayout(next: Layout) {
      layout = next;
      persist({ layout });
    },
    rememberPinnedOnly(next: boolean) {
      pinnedOnly = next;
      persist({ pinnedOnly });
    },
    rememberTheme(next: Theme) {
      selectedTheme = next;
      applyTheme();
      persist({ theme: next });
    },
    subscribeTheme(listener: (theme: Theme) => void) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    receive(context: HostContext) {
      if (context?.styles?.variables) {
        applyHostStyleVariables(context.styles.variables);
      }
      if (context?.theme) {
        hostTheme = context.theme;
        applyTheme();
      }
    },
    async flush() {
      if (writing) {
        const timeout = AbortSignal.timeout(closeTimeout);
        await Promise.race([
          writing,
          new Promise<void>((resolve) => {
            timeout.addEventListener('abort', () => resolve(), { once: true });
          }),
        ]);
      }
    },
  };
}
