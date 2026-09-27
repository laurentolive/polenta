import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { parseParamRefs } from '@polenta/types'
import { useParamRefs } from '../../contexts/ParamRefContext'
import { paramRefTitle } from '../../lib/markdownParamRefs'

/**
 * T171 — texte brut (champs `text` / `textarea`) avec ses références de paramètres rendues :
 * valeur stylée (survol = nom, double-clic = édition du paramètre), ou référence littérale en
 * style « non résolue ». Hors `ParamRefProvider`, ou sans référence, rend `fallback ?? text`.
 * Un clic simple sur une référence n'édite pas le champ : cliquer à côté pour l'éditer.
 */
export function ParamRefText({ text, fallback }: { text: string; fallback?: ReactNode }) {
  const { t } = useTranslation()
  const api = useParamRefs()
  const refs = api ? parseParamRefs(text) : []
  if (!api || refs.length === 0) return <>{fallback ?? text}</>

  const parts: ReactNode[] = []
  let last = 0
  for (const ref of refs) {
    if (ref.index > last) parts.push(text.slice(last, ref.index))
    const r = api.resolve(ref.key)
    parts.push(
      <span
        key={ref.index}
        className={r.status === 'ok' ? 'param-ref' : 'param-ref param-ref--unresolved'}
        data-param-ref={ref.key}
        // T176 — forme brute, pour placer le curseur de l'éditeur (Vue Excel) au bon caractère.
        data-param-raw={ref.raw}
        title={paramRefTitle(api, ref.key, t('parameters.unresolved'))}
        // Comme un lien : le clic simple ne remonte pas au champ (qui passerait sinon en édition
        // avant que le double-clic n'arrive) ; le double-clic ouvre le paramètre.
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); api.openParameter(ref.key) }}
      >
        {r.status === 'ok' ? r.display : ref.raw}
      </span>,
    )
    last = ref.index + ref.raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
