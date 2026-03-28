import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RTL_LANGUAGES } from '../i18n';

/**
 * Syncs <html dir> and <html lang> whenever the active language changes.
 * Mount once near the app root (inside I18nextProvider).
 */
export function useRTL() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const lang = i18n.language?.split('-')[0] ?? 'en';
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
  }, [i18n.language]);
}
