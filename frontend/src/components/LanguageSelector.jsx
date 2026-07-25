import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, RTL_LANGUAGES } from '../i18n';

/**
 * LanguageSelector — dropdown to switch the active language.
 * Updates <html lang>, <html dir>, document.title, and the meta description.
 */
export function LanguageSelector({ className = '' }) {
  const { i18n, t } = useTranslation();

  const handleChange = (e) => {
    const lang = e.target.value;
    i18n.changeLanguage(lang).then(() => {
      const htmlRoot = document.documentElement;
      htmlRoot.lang = lang;
      htmlRoot.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
      document.title = i18n.t('page.dashboard');
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) metaDesc.setAttribute('content', i18n.t('app.description'));
    });
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
        <option key={code} value={code}>
          {name}
        </option>
      ))}
    </select>
  );
}
