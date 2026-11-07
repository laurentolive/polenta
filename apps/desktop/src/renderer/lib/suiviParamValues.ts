import type { DashboardSelector, GraphParamValue, QueryParameterDef } from '@polenta/types'
import { labelText, selectorKey } from '@polenta/types'

/**
 * GH93 — valeurs effectives de la barre de paramètres (logique pure, testée sans React) : choix de
 * l'utilisateur, sinon défaut ; une valeur qui ne désigne plus rien (campagne supprimée, composant
 * retiré, valeur d'énumération retirée) est signalée « introuvable » et remplacée par le défaut.
 */

/** Listes d'options du périmètre ; une liste absente (en chargement) n'invalide rien. */
export interface ParamOptions {
  campaigns?: { id: string; title: string; status?: string }[]
  components?: string[]
  objectTypes?: { objectTypeRef: string; label: string; component: string }[]
}

/** La valeur désigne-t-elle quelque chose d'existant ? (`null`, texte, période : toujours.) */
export function isKnownValue(sel: Pick<DashboardSelector, 'kind' | 'values'>, v: GraphParamValue, options: ParamOptions): boolean {
  if (v === null || typeof v !== 'string') return true
  switch (sel.kind) {
    case 'campaign': return !options.campaigns || options.campaigns.some((c) => c.id === v)
    case 'component': return !options.components || options.components.includes(v)
    case 'objectType': return !options.objectTypes || options.objectTypes.some((t) => t.objectTypeRef === v)
    case 'enum': return (sel.values ?? []).some((x) => x.value === v)
    default: return true
  }
}

export interface EffectiveValues {
  /** Valeur appliquée par sélecteur (clé `name:kind`). */
  values: Record<string, GraphParamValue>
  /** Valeurs choisies devenues introuvables (clé → valeur brute), conservées dans le `.pref`. */
  invalid: Record<string, string>
}

export function effectiveValues(selectors: readonly DashboardSelector[], stored: Readonly<Record<string, GraphParamValue>>, options: ParamOptions): EffectiveValues {
  const values: Record<string, GraphParamValue> = {}
  const invalid: Record<string, string> = {}
  for (const s of selectors) {
    const fallback = isKnownValue(s, s.default, options) ? s.default : null
    if (Object.prototype.hasOwnProperty.call(stored, s.key)) {
      const v = stored[s.key]
      if (isKnownValue(s, v, options)) values[s.key] = v
      else {
        invalid[s.key] = String(v)
        values[s.key] = fallback
      }
    } else {
      values[s.key] = fallback
    }
  }
  return { values, invalid }
}

/** Libellés des paramètres obligatoires sans valeur d'une requête (le widget attend un choix). */
export function missingRequired(decls: readonly QueryParameterDef[] | undefined, values: Readonly<Record<string, GraphParamValue>>, locale: 'fr' | 'en'): string[] {
  return (decls ?? []).filter((d) => d.required && (values[selectorKey(d)] ?? null) === null).map((d) => labelText(d.label, locale))
}

/** Choix à mémoriser pour un widget (GH125) : les autres valeurs du widget sont gardées, même celles
 *  qu'une requête ne déclare plus (ignorées à l'exécution, elles reprennent effet si la déclaration
 *  revient). */
export function storedChoices(stored: Readonly<Record<string, GraphParamValue>>, key: string, value: GraphParamValue): Record<string, GraphParamValue> {
  return { ...stored, [key]: value }
}

const sameValue = (a: GraphParamValue, b: GraphParamValue): boolean =>
  a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && (a.from ?? null) === (b.from ?? null) && (a.to ?? null) === (b.to ?? null))

/** GH125 (D1) — « Réinitialiser » proposé : une valeur appliquée diffère du défaut de sa déclaration,
 *  ou une valeur choisie est introuvable (le retour au défaut efface l'avertissement). */
export function differsFromDefault(selectors: readonly DashboardSelector[], eff: EffectiveValues, options: ParamOptions): boolean {
  if (Object.keys(eff.invalid).length) return true
  return selectors.some((s) => {
    const fallback = isKnownValue(s, s.default, options) ? s.default : null
    return !sameValue(eff.values[s.key] ?? null, fallback)
  })
}

/** Libellé d'une campagne / d'un composant / d'un type pour l'affichage d'une valeur. */
export function optionTitle(options: ParamOptions, kind: string, value: string): string | undefined {
  if (kind === 'campaign') {
    const c = options.campaigns?.find((x) => x.id === value)
    return c ? `${c.id} — ${c.title}` : undefined
  }
  if (kind === 'objectType') {
    const t = options.objectTypes?.find((x) => x.objectTypeRef === value)
    return t ? `${t.label} (${t.component})` : undefined
  }
  return undefined
}
