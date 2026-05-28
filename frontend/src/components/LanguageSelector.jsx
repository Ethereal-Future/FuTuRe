import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, RTL_LANGUAGES } from '../i18n';

/**
 * LanguageSelector — dropdown to switch the active language.
 * Automatically updates <html dir> and <html lang> on change.
 */
export function LanguageSelector({ className = '' }) {
  const { i18n, t } = useTranslation();

  const handleChange = (e) => {
    const lang = e.target.value;
    i18n.changeLanguage(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
  };

  return (
    <select
      className={`lang-selector ${className}`}
      value={i18n.language?.split('-')[0] ?? 'en'}
      onChange={handleChange}
      aria-label={t('language.select')}
      title={t('language.select')}
    >
      {SUPPORTED_LANGUAGES.map(({ code, name }) => (
        <option key={code} value={code}>{name}</option>
      ))}
    </select>
  );
}
