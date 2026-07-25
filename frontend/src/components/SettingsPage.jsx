import { useTheme } from '../contexts/ThemeContext';

/**
 * SettingsPage — user preferences. Theme state is owned by ThemeContext
 * (frontend/src/contexts/ThemeContext.jsx), which already persists to
 * localStorage, falls back to the OS `prefers-color-scheme`, and applies
 * the `theme-dark`/`theme-light` class synchronously on toggle — this
 * component just exposes that as a labelled switch instead of introducing
 * a second, competing theme-storage mechanism.
 */
export function SettingsPage({ onClose }) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="section settings-page">
      <div className="settings-page__header">
        <h3>Settings</h3>
        {onClose && (
          <button type="button" className="qr-close" onClick={onClose} aria-label="Close settings">✕</button>
        )}
      </div>

      <div className="settings-row">
        <span className="settings-row__label">
          {isDark ? '🌙' : '☀️'} Dark mode
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label="Toggle dark mode"
          className={`settings-toggle ${isDark ? 'on' : ''}`}
          onClick={toggleTheme}
        >
          <span className="settings-toggle__thumb" />
        </button>
      </div>
    </div>
  );
}
