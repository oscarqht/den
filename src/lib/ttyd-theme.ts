export type ThemeMode = 'auto' | 'light' | 'dark';
export type TerminalTheme = Record<string, string>;

export const THEME_MODE_STORAGE_KEY = 'viba:theme-mode';
export const THEME_REFRESH_EVENT = 'viba:theme-refresh';

export const TERMINAL_THEME_LIGHT: TerminalTheme = {
  background: '#ffffff',
  foreground: '#0f172a',
  cursor: '#0f172a',
  selectionBackground: 'rgba(59, 130, 246, 0.4)',
  black: '#000000',
  red: '#cd3131',
  green: '#00BC00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14CE14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

export const TERMINAL_THEME_DARK: TerminalTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#e6edf3',
  selectionBackground: 'rgba(59, 130, 246, 0.4)',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#ffffff',
};

type StorageLike = Pick<Storage, 'getItem'>;
type TtydWindow = Window & {
  term?: {
    options?: {
      theme?: TerminalTheme;
      [key: string]: unknown;
    };
  };
};

export function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'auto') {
    return value;
  }
  return 'auto';
}

export function readThemeModeFromStorage(storage: StorageLike | null | undefined): ThemeMode {
  if (!storage) return 'auto';
  try {
    return normalizeThemeMode(storage.getItem(THEME_MODE_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function resolveShouldUseDarkTheme(themeMode: ThemeMode, prefersDark: boolean): boolean {
  return themeMode === 'dark' || (themeMode === 'auto' && prefersDark);
}

export function resolveTerminalTheme(themeMode: ThemeMode, prefersDark: boolean): TerminalTheme {
  return resolveShouldUseDarkTheme(themeMode, prefersDark) ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT;
}

export function resolveTerminalThemeFromBrowser(): TerminalTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return TERMINAL_THEME_LIGHT;
  }
  const mode = readThemeModeFromStorage(window.localStorage);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveTerminalTheme(mode, prefersDark);
}

export function applyThemeToTerminalWindow(
  terminalWindow: Window | null | undefined,
  theme: TerminalTheme = resolveTerminalThemeFromBrowser(),
): boolean {
  const ttydWindow = terminalWindow as TtydWindow | null | undefined;
  const term = ttydWindow?.term;
  if (!term?.options) return false;

  term.options.theme = {
    ...(term.options.theme || {}),
    ...theme,
  };
  return true;
}

export function applyThemeToTerminalIframe(
  iframe: HTMLIFrameElement | null | undefined,
  theme: TerminalTheme = resolveTerminalThemeFromBrowser(),
): boolean {
  if (!iframe) return false;
  try {
    return applyThemeToTerminalWindow(iframe.contentWindow, theme);
  } catch {
    return false;
  }
}
