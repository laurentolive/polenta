/**
 * GH49 — plugin Vite du renderer : applique la marque
 *  - à `index.html` : titre de la page, icône de l'onglet (data: URI, rien à copier dans
 *    `public/`), surcharges de couleurs de la marque (`<style>`, voir brandThemeCss) ;
 *  - au module virtuel `virtual:brand-logo` : logo de la marque en data: URI, ou `null`.
 */
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { themeTokens } from '../src/renderer/theme.config'
import type { LoadedBrand } from './brand'

const TITLE_PLACEHOLDER = '%BRAND_NAME%'
const FAVICON_PLACEHOLDER = '%BRAND_FAVICON%'
const LOGO_MODULE_ID = 'virtual:brand-logo'
const RESOLVED_LOGO_MODULE_ID = '\0' + LOGO_MODULE_ID

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function svgDataUri(file: string): string {
  return `data:image/svg+xml;base64,${readFileSync(file).toString('base64')}`
}

/**
 * Variables CSS surchargées par la marque, ou '' si aucune. Sélecteurs `html:root` / `html.dark`
 * (spécificité 0-1-1) : l'emportent sur `:root` / `.dark` d'index.css (0-1-0) quel que soit
 * l'ordre d'insertion des feuilles. Un token surchargé pour un seul thème garde, dans l'autre,
 * sa valeur de theme.config.ts — sans quoi `html:root` imposerait la valeur claire en sombre.
 */
export function brandThemeCss(brand: LoadedBrand): string {
  const entries = Object.entries(brand.theme)
  if (!entries.length) return ''
  const light = entries.map(([token, v]) => `--${token}: ${v.light ?? themeTokens[token].light};`)
  const dark = entries.map(([token, v]) => `--${token}: ${v.dark ?? themeTokens[token].dark};`)
  return `html:root { ${light.join(' ')} }\nhtml.dark { ${dark.join(' ')} }`
}

export function brandPlugin(brand: LoadedBrand): Plugin {
  const favicon = svgDataUri(brand.faviconPath)
  const themeCss = brandThemeCss(brand)
  const logo = brand.logoPath ? svgDataUri(brand.logoPath) : null
  return {
    name: 'polenta-brand',
    resolveId(id) {
      return id === LOGO_MODULE_ID ? RESOLVED_LOGO_MODULE_ID : undefined
    },
    load(id) {
      return id === RESOLVED_LOGO_MODULE_ID ? `export default ${JSON.stringify(logo)}` : undefined
    },
    // 'pre' : avant le remplacement `%ENV%` interne de Vite, qui vise la même syntaxe.
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes(TITLE_PLACEHOLDER) || !html.includes(FAVICON_PLACEHOLDER)) {
          throw new Error(`[brand] index.html doit contenir ${TITLE_PLACEHOLDER} et ${FAVICON_PLACEHOLDER}`)
        }
        const out = html
          .replaceAll(TITLE_PLACEHOLDER, escapeHtml(brand.info.productName))
          .replaceAll(FAVICON_PLACEHOLDER, favicon)
        if (!themeCss) return out
        return {
          html: out,
          tags: [{ tag: 'style', attrs: { id: 'brand-theme' }, children: themeCss, injectTo: 'head' }],
        }
      },
    },
  }
}
