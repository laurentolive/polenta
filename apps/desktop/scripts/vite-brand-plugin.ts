/**
 * GH49 — plugin Vite du renderer : applique la marque à `index.html` (titre de la page,
 * icône de l'onglet en data: URI, pour ne rien copier dans `public/`).
 */
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import type { LoadedBrand } from './brand'

const TITLE_PLACEHOLDER = '%BRAND_NAME%'
const FAVICON_PLACEHOLDER = '%BRAND_FAVICON%'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function brandPlugin(brand: LoadedBrand): Plugin {
  const favicon = `data:image/svg+xml;base64,${readFileSync(brand.faviconPath).toString('base64')}`
  return {
    name: 'polenta-brand',
    // 'pre' : avant le remplacement `%ENV%` interne de Vite, qui vise la même syntaxe.
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes(TITLE_PLACEHOLDER) || !html.includes(FAVICON_PLACEHOLDER)) {
          throw new Error(`[brand] index.html doit contenir ${TITLE_PLACEHOLDER} et ${FAVICON_PLACEHOLDER}`)
        }
        return html
          .replaceAll(TITLE_PLACEHOLDER, escapeHtml(brand.info.productName))
          .replaceAll(FAVICON_PLACEHOLDER, favicon)
      },
    },
  }
}
