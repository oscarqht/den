import type { Metadata } from "next";
import "./globals.css";

const THEME_MODE_STORAGE_KEY = "viba:theme-mode";
const THEME_SYNC_RUNTIME_KEY = "__vibaThemeSyncInstalled";
const themeBootstrapScript = `
(() => {
  const storageKey = '${THEME_MODE_STORAGE_KEY}';
  const runtimeKey = '${THEME_SYNC_RUNTIME_KEY}';
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const resolveThemeMode = () => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === 'light' || stored === 'dark' || stored === 'auto') {
        return stored;
      }
    } catch {
      // Ignore localStorage access errors and fall back to auto mode.
    }
    return 'auto';
  };
  const applyThemeMode = () => {
    const mode = resolveThemeMode();
    const shouldUseDark = mode === 'dark' || (mode === 'auto' && mediaQuery.matches);
    document.documentElement.classList.toggle('dark', shouldUseDark);
    document.documentElement.dataset.themeMode = mode;
  };

  applyThemeMode();

  if (window[runtimeKey]) {
    return;
  }
  window[runtimeKey] = true;

  const handleMediaChange = () => {
    if (resolveThemeMode() === 'auto') {
      applyThemeMode();
    }
  };
  const handleStorageChange = (event) => {
    if (!event || !event.key || event.key === storageKey) {
      applyThemeMode();
    }
  };
  const handleThemeRefresh = () => {
    applyThemeMode();
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleMediaChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleMediaChange);
  }

  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('viba:theme-refresh', handleThemeRefresh);
})();
`;

export const metadata: Metadata = {
  title: {
    default: "Den",
    template: "%s | Den",
  },
  description: "Den is a local control center for AI coding work. It gives every task its own isolated workspace, so agents can work in parallel, stay organized, and make changes you can review with confidence.",
};

import { Providers } from './providers';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/iconoir-icons/iconoir@main/css/iconoir.css" />
        <script
          dangerouslySetInnerHTML={{
            __html: themeBootstrapScript,
          }}
        />
      </head>
      <body
        className="antialiased"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
