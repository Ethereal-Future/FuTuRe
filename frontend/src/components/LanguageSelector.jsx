import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { SUPPORTED_LANGUAGES, RTL_LANGUAGES } from '../i18n';
import { storeLanguage } from '../utils/detectLanguage';

/**
 * Maps the active route pathname to the i18n key used for the page title.
 * Falls back to the dashboard title for unknown routes.
 */
function getPageTitleKey(pathname = '/') {
  const path = pathname.toLowerCase();

  if (path.startsWith('/settings')) return 'page.settings';
  if (path.startsWith('/transactions') || path.startsWith('/history')) return 'page.transactions';
  if (path.startsWith('/liquidity') || path.startsWith('/pools')) return 'page.liquidityPools';
  if (path.startsWith('/dashboard') || path === '/' || path === '') return 'page.dashboard';

  return 'page.dashboard';
}

/**
 * LanguageSelector — dropdown to switch the active language.
 * Updates <html lang>, <html dir>, document.title, and the meta description.
 */
export function LanguageSelector({ className = '' }) {
  const { i18n, t } = useTranslation();
  const location = useLocation();

  const handleChange = (e) => {
    const lang = e.target.value;
    i18n.changeLanguage(lang).then(() => {
      storeLanguage(lang);
      const htmlRoot = document.documentElement;
      htmlRoot.lang = lang;
      htmlRoot.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
      const titleKey = getPageTitleKey(location?.pathname);
      document.title = i18n.t(titleKey);
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