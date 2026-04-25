/**
 * Theme Store — Color scheme switching with localStorage persistence.
 *
 * Applies theme by setting `data-theme` attribute on <html>.
 * Default (no attribute) = Terminal Mint (original).
 * Instant switching — pure CSS variable override, no re-render needed.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

// ── Theme Definitions ───────────────────────────────────

export interface ThemeDef {
  id: string;
  label: string;
  description: string;
  /** CSS preview color (accent of the theme) */
  preview: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'default',
    label: 'Terminal Mint',
    description: 'Mint/Sage on dark blue-grey',
    preview: '#a8d8b9',
  },
  {
    id: 'amber',
    label: 'Amber Console',
    description: 'Warm CRT monitor feel',
    preview: '#d4a24c',
  },
  {
    id: 'arctic',
    label: 'Arctic',
    description: 'Cool blue-white, high readability',
    preview: '#88c8e8',
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    description: 'Maximum readability for tired eyes',
    preview: '#00ff88',
  },
  {
    id: 'lavender',
    label: 'Lavender Dusk',
    description: 'Soft purple evening tones',
    preview: '#c0a0e0',
  },
  {
    id: 'rose',
    label: 'Rose Terminal',
    description: 'Warm pink/rose tones',
    preview: '#e0a0b0',
  },
  {
    id: 'monochrome',
    label: 'Monochrome',
    description: 'Pure black & white, no color',
    preview: '#d0d0d0',
  },
  {
    id: 'norton',
    label: 'Norton Commander',
    description: 'Classic DOS blue with white text',
    preview: '#55ffff',
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Warm off-white, dot-matrix printer',
    preview: '#4a7a5a',
  },
  {
    id: 'frost',
    label: 'Frost',
    description: 'Cool blue-white, morning ice',
    preview: '#4878a8',
  },
];

// ── Context ─────────────────────────────────────────────

interface ThemeContextType {
  themeId: string;
  setTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const STORAGE_KEY = 'huddle-theme';
// Legacy key from the pre-rename "GamingHangout / Hangout" era. Beta
// testers who set a theme before v1.3 stored it under this key. We read
// it once at mount and migrate it into STORAGE_KEY so they don't lose
// their preference, then remove it. Can be dropped once all installs
// are known to have migrated.
const LEGACY_STORAGE_KEY = 'hangout-theme';

function applyTheme(id: string) {
  if (id === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
}

// ── Provider ────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string>(() => {
    // C-001: Wrap localStorage access in try/catch. Safari Private Mode +
    // quota-exceeded errors can throw on getItem/setItem/removeItem and
    // would crash the ThemeProvider mid-render → entire app white-screens.
    // Fallback: 'default' theme + console.warn for diagnostics.
    try {
      // One-time migration: if the new key is empty but the legacy key
      // holds a value, copy it over. Always remove the legacy key so it
      // cannot drift out of sync with subsequent user changes.
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null) {
        if (localStorage.getItem(STORAGE_KEY) === null) {
          localStorage.setItem(STORAGE_KEY, legacy);
        }
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored && THEMES.some((t) => t.id === stored) ? stored : 'default';
    } catch (err) {
      console.warn('[theme] localStorage unavailable, using default', err);
      return 'default';
    }
  });

  // Apply theme on mount and changes
  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);

  const setTheme = useCallback((id: string) => {
    if (!THEMES.some((t) => t.id === id)) return;
    setThemeId(id);
    // C-001: Same Safari Private + quota-exceeded protection as the
    // lazy-init above. Persistence may fail; the in-memory theme still
    // applies for the current session.
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (err) {
      console.warn('[theme] localStorage write failed', err);
    }
    applyTheme(id);
  }, []);

  const value = useMemo(() => ({ themeId, setTheme }), [themeId, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
