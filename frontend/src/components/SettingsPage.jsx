import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="section settings-page">
      <div className="settings-page__header">
        <h3>{t('settingsPage.title')}</h3>
        {onClose && (
          <button type="button" className="qr-close" onClick={onClose} aria-label={t('settingsPage.close')}>✕</button>
        )}
      </div>

      <div className="settings-row">
        <span className="settings-row__label">
          {isDark ? '🌙' : '☀️'} {t('settingsPage.darkMode')}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label={t('settingsPage.toggleDarkMode')}
          className={`settings-toggle ${isDark ? 'on' : ''}`}
          onClick={toggleTheme}
        >
          <span className="settings-toggle__thumb" />
        </button>
      </div>
    </div>
  );
}
