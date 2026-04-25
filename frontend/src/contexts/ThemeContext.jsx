import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

const ThemeContext = createContext({
  theme: 'light',
  isDark: false,
  toggleTheme: () => {},
});

const THEME_KEY = 'theme_preference';
const THEMES = {
  light: 'light',
  dark: 'dark',
};

function getInitialTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === THEMES.dark || saved === THEMES.light) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? THEMES.dark : THEMES.light;
  } catch {
    return THEMES.light;
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', theme === THEMES.dark);
    document.documentElement.classList.toggle('theme-light', theme === THEMES.light);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore localStorage failures in private mode
    }
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event) => {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved !== THEMES.light && saved !== THEMES.dark) {
        setTheme(event.matches ? THEMES.dark : THEMES.light);
      }
    };
    mediaQuery.addEventListener?.('change', handler);
    return () => mediaQuery.removeEventListener?.('change', handler);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === THEMES.dark ? THEMES.light : THEMES.dark));
  }, []);

  const value = useMemo(
    () => ({ theme, isDark: theme === THEMES.dark, toggleTheme }),
    [theme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
