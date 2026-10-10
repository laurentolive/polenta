import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import fr from './locales/fr.json'
import en from './locales/en.json'
import { BRAND } from '../../shared/brand'

export const LOCALE_STORAGE_KEY = 'polenta:locale'

const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
const initialLng = stored === 'en' ? 'en' : 'fr'

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: initialLng,
  fallbackLng: 'fr',
  // GH49 — {{appName}} disponible dans toutes les chaînes : nom de la marque du binaire. Aucune
  // chaîne traduite ne contient « Polenta » en dur (vérifié par scripts/check-gh49.ts).
  interpolation: { escapeValue: false, defaultVariables: { appName: BRAND.productName } },
})

export default i18n
