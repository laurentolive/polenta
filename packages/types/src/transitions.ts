import type { ObjectCategory, ObjectTypeDefinition } from './schema'
import { isFieldRequiredNow, isFieldValueFilled, objectFieldReader } from './required-when'
import { validatorError } from './field-validators'
import type { ValueRename } from './history'

// GH206 — contraintes de transition facultatives, à niveaux (specs/GH206.md). Bloc `transitions` d'un
// type d'objet : chaque règle vise un statut d'arrivée (`to`), éventuellement un statut de départ
// (`from`), et donne un niveau à chaque condition. Fonctions pures : le main ajoute la couverture.

export type TransitionLevel = 'off' | 'warn' | 'block'
export type TransitionCondition = 'fieldsFilled' | 'validatorsPass' | 'hasCoverageLink'

export interface TransitionRule {
  to: string
  /** Absent : depuis n'importe quel statut. */
  from?: string
  /** Condition → niveau, toujours écrit (`warn` compris). */
  requires: Partial<Record<TransitionCondition, TransitionLevel>>
}

/** Condition non remplie, avec son niveau effectif. */
export interface TransitionIssue {
  condition: TransitionCondition
  level: 'warn' | 'block'
  /** Une phrase, avec l'action à faire. */
  message: string
  /** `fieldsFilled`, `validatorsPass` : noms des champs en cause. */
  fields?: string[]
}

export interface TransitionCheck {
  blocked: boolean
  issues: TransitionIssue[]
}

/** Réponse d'une écriture d'objet : notifications d'un passage notifié. Jamais écrit dans le fichier. */
export type WithTransitionWarnings<T> = T & { transitionWarnings?: TransitionIssue[] }

export const TRANSITION_LEVELS: readonly TransitionLevel[] = ['off', 'warn', 'block']
export const TRANSITION_CONDITIONS: readonly TransitionCondition[] = ['fieldsFilled', 'validatorsPass', 'hasCoverageLink']
/** Catégories qui admettent un bloc `transitions` (D1). */
export const TRANSITION_CATEGORIES: readonly ObjectCategory[] = ['requirement', 'test', 'issue']
/** Niveau donné à une condition ajoutée dans l'éditeur (D8). */
export const DEFAULT_TRANSITION_LEVEL: TransitionLevel = 'warn'

/** Conditions admises pour une catégorie. */
export function transitionConditionsFor(category: ObjectCategory): TransitionCondition[] {
  if (!TRANSITION_CATEGORIES.includes(category)) return []
  return category === 'requirement' ? [...TRANSITION_CONDITIONS] : ['fieldsFilled', 'validatorsPass']
}

const RANK: Record<TransitionLevel, number> = { off: 0, warn: 1, block: 2 }

/**
 * Conditions applicables au passage `from` → `to`, avec le niveau le plus fort par condition ; `off` exclus.
 * `from` null = création : toutes les règles vers `to` (D3). Même statut : aucune (D4).
 */
export function matchingConditions(
  typeDef: Pick<ObjectTypeDefinition, 'transitions'> | null | undefined,
  from: string | null,
  to: string,
): Map<TransitionCondition, 'warn' | 'block'> {
  const out = new Map<TransitionCondition, 'warn' | 'block'>()
  if (!typeDef?.transitions?.length || from === to) return out
  for (const rule of typeDef.transitions) {
    if (rule.to !== to) continue
    if (from !== null && rule.from !== undefined && rule.from !== from) continue
    for (const [cond, level] of Object.entries(rule.requires ?? {}) as Array<[TransitionCondition, TransitionLevel]>) {
      if (!TRANSITION_CONDITIONS.includes(cond) || level === 'off' || !(level in RANK)) continue
      const current = out.get(cond)
      if (!current || RANK[level] > RANK[current]) out.set(cond, level)
    }
  }
  return out
}

interface ObjectLike {
  id?: string
  title?: string
  status?: string
  fields?: Record<string, unknown>
}

type TypeDefLike = Pick<ObjectTypeDefinition, 'fields' | 'statuses' | 'transitions' | 'category'>

/** Champs obligatoires vides dans l'état d'arrivée : `required`, ou `requiredWhen` actif (D6). */
export function emptyRequiredFields(typeDef: Pick<ObjectTypeDefinition, 'fields'>, obj: ObjectLike): string[] {
  const read = objectFieldReader(typeDef, obj)
  return typeDef.fields
    .filter(f => isFieldRequiredNow(f, read) && !isFieldValueFilled(obj.fields?.[f.name]))
    .map(f => f.name)
}

/** Champs remplis refusés par leur validateur, avec le message de chacun. */
export function invalidFields(typeDef: Pick<ObjectTypeDefinition, 'fields'>, obj: ObjectLike): Array<{ field: string; message: string }> {
  const out: Array<{ field: string; message: string }> = []
  for (const f of typeDef.fields) {
    const message = validatorError(f, obj.fields?.[f.name])
    if (message) out.push({ field: f.name, message })
  }
  return out
}

/**
 * Évalue un passage de statut. `after` porte le statut d'arrivée et les champs résultants. `covered` :
 * couverture de l'exigence (calculée par le main sur tout le workspace), lue seulement si
 * `hasCoverageLink` s'applique.
 */
export function evaluateTransition(
  typeDef: TypeDefLike | null | undefined,
  from: string | null,
  after: ObjectLike & { status: string },
  covered: () => boolean,
): TransitionCheck {
  const conditions = matchingConditions(typeDef, from, after.status)
  const issues: TransitionIssue[] = []
  if (!typeDef || conditions.size === 0) return { blocked: false, issues }
  const label = (name: string) => typeDef.fields.find(f => f.name === name)?.label ?? name
  for (const cond of TRANSITION_CONDITIONS) {
    const level = conditions.get(cond)
    if (!level) continue
    if (cond === 'fieldsFilled') {
      const empty = emptyRequiredFields(typeDef, after)
      if (empty.length > 0) {
        issues.push({ condition: cond, level, fields: empty, message: `Champs obligatoires vides : ${empty.map(label).join(', ')} — remplissez-les` })
      }
    } else if (cond === 'validatorsPass') {
      const invalid = invalidFields(typeDef, after)
      if (invalid.length > 0) {
        issues.push({ condition: cond, level, fields: invalid.map(i => i.field), message: `${invalid.map(i => i.message).join(' ; ')} — corrigez la saisie` })
      }
    } else if (typeDef.category === 'requirement' && !covered()) {
      issues.push({ condition: cond, level, message: `Aucun test ne couvre ${after.id ?? 'cette exigence'} — liez un test à cette exigence` })
    }
  }
  // Bloquants d'abord : un refus les cite en tête.
  issues.sort((a, b) => RANK[b.level] - RANK[a.level])
  return { blocked: issues.some(i => i.level === 'block'), issues }
}

/** Le contrôle demande-t-il la couverture ? (évite de lire les liens pour rien). */
export function needsCoverage(typeDef: TypeDefLike | null | undefined, from: string | null, to: string): boolean {
  return typeDef?.category === 'requirement' && matchingConditions(typeDef, from, to).has('hasCoverageLink')
}

export interface TransitionRuleIssue {
  /** Index de la règle dans `transitions`. */
  rule: number
  level: 'error' | 'warning'
  message: string
}

function ruleName(rule: Partial<TransitionRule>): string {
  return `${rule.from ?? '*'} → ${rule.to ?? '?'}`
}

/** Cohérence du bloc `transitions` d'un type (spec §1, design §3). Avertissement : D5. */
export function transitionRuleIssues(typeDef: Pick<ObjectTypeDefinition, 'name' | 'category' | 'statuses' | 'transitions'>): TransitionRuleIssue[] {
  const rules = typeDef.transitions as unknown
  if (rules === undefined) return []
  const issues: TransitionRuleIssue[] = []
  const prefix = `Type "${typeDef.name}"`
  if (!Array.isArray(rules)) return [{ rule: -1, level: 'error', message: `${prefix} : transitions doit être une liste de règles` }]
  if (rules.length > 0 && !TRANSITION_CATEGORIES.includes(typeDef.category)) {
    return [{ rule: -1, level: 'error', message: `${prefix} : les contraintes de transition ne s'appliquent qu'aux exigences, tests et issues` }]
  }
  const statuses = new Map((typeDef.statuses ?? []).map(s => [s.name, s]))
  const allowed = transitionConditionsFor(typeDef.category)
  const seen = new Set<string>()
  rules.forEach((raw: unknown, i: number) => {
    const rule = (raw && typeof raw === 'object' ? raw : {}) as Partial<TransitionRule>
    const at = `${prefix}, règle ${ruleName(rule)}`
    const err = (message: string) => issues.push({ rule: i, level: 'error', message: `${at} : ${message}` })
    if (typeof rule.to !== 'string' || !statuses.has(rule.to)) return err(`statut d'arrivée inconnu "${String(rule.to ?? '')}"`)
    if (rule.from !== undefined && (typeof rule.from !== 'string' || !statuses.has(rule.from))) return err(`statut de départ inconnu "${String(rule.from)}"`)
    if (rule.from === rule.to) return err('le statut de départ et le statut d\'arrivée sont identiques')
    const key = `${rule.from ?? ''}→${rule.to}`
    if (seen.has(key)) return err('une autre règle vise déjà ce passage')
    seen.add(key)
    const requires = rule.requires as unknown
    if (!requires || typeof requires !== 'object' || Array.isArray(requires) || Object.keys(requires).length === 0) {
      return err('aucune condition')
    }
    for (const [cond, level] of Object.entries(requires as Record<string, unknown>)) {
      if (!allowed.includes(cond as TransitionCondition)) return err(`condition "${cond}" non admise pour ce type`)
      if (!TRANSITION_LEVELS.includes(level as TransitionLevel)) return err(`niveau "${String(level)}" inconnu pour "${cond}" (off, warn ou block)`)
    }
    // D5 — blocage qui peut s'appliquer en quittant un statut approuvé (réouverture).
    const toApproval = !!statuses.get(rule.to)?.isApproval
    const leavesApproval = rule.from !== undefined
      ? !!statuses.get(rule.from)?.isApproval && !toApproval
      : !toApproval && [...statuses.values()].some(s => s.isApproval)
    if (leavesApproval && Object.values(requires as Record<string, unknown>).includes('block')) {
      issues.push({ rule: i, level: 'warning', message: `${at} : bloque la réouverture d'un élément approuvé, seul moyen de l'éditer` })
    }
  })
  return issues
}

/** Règles qui citent un statut (retrait refusé tant qu'elles existent). */
export function rulesCitingStatus(typeDef: Pick<ObjectTypeDefinition, 'transitions'>, status: string): string[] {
  return (typeDef.transitions ?? []).filter(r => r.to === status || r.from === status).map(ruleName)
}

/** `from` / `to` suivent les renommages de statut de la même sauvegarde (comme `requiredWhen`, #214). */
export function renameTransitionRefs(rules: TransitionRule[], valueRenames: ValueRename[]): TransitionRule[] {
  const map = new Map(valueRenames.filter(r => r.target.kind === 'status').map(r => [r.from, r.to]))
  if (map.size === 0) return rules
  return rules.map(r => ({
    ...r,
    to: map.get(r.to) ?? r.to,
    ...(r.from !== undefined ? { from: map.get(r.from) ?? r.from } : {}),
  }))
}
