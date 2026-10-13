import type { TFunction } from 'i18next'
import type { ProjectSchema } from '@polenta/types'
import { PROGRESS_READY, compareProgressKeys, flattenSystemNodes, isProgressKey, prepStatusOf, prepStatusOrder } from '@polenta/types'

// GH71 — présentation des étapes d'avancement de campagne (`prep:<statut>`, `ready`, résultats) :
// ordre canonique, libellé, couleur. Partagée par le préréglage du widget barre et les pastilles de
// la page campagne. Les couleurs sont des jetons de thème (`--chart-progress-*`, clair + sombre).

const RESULT_LABEL_KEY: Record<string, string> = {
  INCOMPLETE: 'campaignPage.runStatus.incomplete',
  BLOCKED: 'campaignPage.runStatus.blocked',
  FAIL: 'campaignPage.runStatus.fail',
  PASS: 'campaignPage.runStatus.pass',
}
const RESULT_COLOR: Record<string, string> = {
  [PROGRESS_READY]: 'ready', INCOMPLETE: 'incomplete', BLOCKED: 'blocked', FAIL: 'fail', PASS: 'pass',
}
const PREP_SHADES = 4

export interface ProgressStep {
  key: string
  label: string
  /** `rgb(var(--chart-progress-…))` */
  color: string
}

/** Libellé d'un statut de test : `label` du premier type de test qui le déclare, sinon son nom. */
function statusLabels(schema: ProjectSchema | undefined): Map<string, string> {
  const labels = new Map<string, string>()
  for (const { node } of flattenSystemNodes(schema?.nodes ?? [])) {
    for (const type of node.objectTypes ?? []) {
      if (type.category !== 'test') continue
      for (const st of type.statuses ?? []) if (st.label && !labels.has(st.name)) labels.set(st.name, st.label)
    }
  }
  return labels
}

export function progressPresenter(schema: ProjectSchema | undefined, t: TFunction) {
  const order = prepStatusOrder(schema)
  const labels = statusLabels(schema)
  const compare = compareProgressKeys(order)

  const label = (key: string): string => {
    const status = prepStatusOf(key)
    if (status !== null) return labels.get(status) ?? status
    if (key === PROGRESS_READY) return t('campaignProgress.ready')
    return RESULT_LABEL_KEY[key] ? t(RESULT_LABEL_KEY[key]) : key
  }

  /** Étapes ordonnées ; `prepShade` : rang parmi les étapes de préparation présentes. */
  const present = (keys: string[]): ProgressStep[] => {
    const steps = keys.filter(isProgressKey).sort(compare)
    let prep = 0
    return steps.map(key => {
      const token = prepStatusOf(key) !== null ? `prep-${Math.min(++prep, PREP_SHADES)}` : RESULT_COLOR[key]
      return { key, label: label(key), color: `rgb(var(--chart-progress-${token}))` }
    })
  }

  return { order, compare, label, present }
}
