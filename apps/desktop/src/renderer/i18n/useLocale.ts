import { useTranslation } from 'react-i18next'
import { LOCALE_STORAGE_KEY } from './index'

export type Locale = 'fr' | 'en'

export function useLocale() {
  const { i18n } = useTranslation()
  const locale: Locale = i18n.language === 'en' ? 'en' : 'fr'

  function setLocale(next: Locale) {
    i18n.changeLanguage(next)
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
  }

  return { locale, setLocale }
}

/** Maps an i18next language code to the `Intl`/`toLocaleDateString` tag it needs —
 *  centralized so a third supported language only requires one change. */
export function toIntlLocale(language: string): string {
  return language === 'en' ? 'en-US' : 'fr-FR'
}
