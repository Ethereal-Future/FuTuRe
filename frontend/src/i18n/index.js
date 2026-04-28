import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import ar from './locales/ar.json';
import he from './locales/he.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import zh from './locales/zh.json';
import pt from './locales/pt.json';

/** Languages that use right-to-left text direction */
export const RTL_LANGUAGES = new Set(['ar', 'he']);

/** All supported locales with their display metadata */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English',    dir: 'ltr' },
  { code: 'ar', name: 'العربية',    dir: 'rtl' },
  { code: 'he', name: 'עברית',      dir: 'rtl' },
  { code: 'fr', name: 'Français',   dir: 'ltr' },
  { code: 'es', name: 'Español',    dir: 'ltr' },
  { code: 'zh', name: '中文',        dir: 'ltr' },
  { code: 'pt', name: 'Português',  dir: 'ltr' },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en, ar, he, fr, es, zh, pt },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18n_language',
    },
  })
  .then(() => {
    const lang = i18n.language?.split('-')[0] ?? 'en';
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
  });

export default i18n;
