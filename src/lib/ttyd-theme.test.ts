import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  normalizeThemeMode,
  readThemeModeFromStorage,
  resolveShouldUseDarkTheme,
  resolveTerminalTheme,
  TERMINAL_THEME_DARK,
  TERMINAL_THEME_LIGHT,
} from './ttyd-theme.ts';

describe('normalizeThemeMode', () => {
  it('returns auto for missing or invalid values', () => {
    assert.strictEqual(normalizeThemeMode(undefined), 'auto');
    assert.strictEqual(normalizeThemeMode(null), 'auto');
    assert.strictEqual(normalizeThemeMode('invalid'), 'auto');
  });

  it('returns known values as-is', () => {
    assert.strictEqual(normalizeThemeMode('auto'), 'auto');
    assert.strictEqual(normalizeThemeMode('light'), 'light');
    assert.strictEqual(normalizeThemeMode('dark'), 'dark');
  });
});

describe('readThemeModeFromStorage', () => {
  it('reads valid mode values from storage', () => {
    const storage = {
      getItem: () => 'dark',
    };
    assert.strictEqual(readThemeModeFromStorage(storage), 'dark');
  });

  it('falls back to auto when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('unavailable');
      },
    };
    assert.strictEqual(readThemeModeFromStorage(storage), 'auto');
  });
});

describe('resolveShouldUseDarkTheme', () => {
  it('always honors explicit modes', () => {
    assert.strictEqual(resolveShouldUseDarkTheme('dark', false), true);
    assert.strictEqual(resolveShouldUseDarkTheme('light', true), false);
  });

  it('follows prefers-color-scheme in auto mode', () => {
    assert.strictEqual(resolveShouldUseDarkTheme('auto', true), true);
    assert.strictEqual(resolveShouldUseDarkTheme('auto', false), false);
  });
});

describe('resolveTerminalTheme', () => {
  it('returns dark or light palette from resolved mode', () => {
    assert.strictEqual(resolveTerminalTheme('auto', true), TERMINAL_THEME_DARK);
    assert.strictEqual(resolveTerminalTheme('auto', false), TERMINAL_THEME_LIGHT);
  });
});
