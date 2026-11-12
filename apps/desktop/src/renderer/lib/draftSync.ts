import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * GH342 — brouillon d'un formulaire d'édition face aux modifications faites ailleurs (autre fenêtre,
 * autre onglet du navigateur, pull, MCP, édition hors de l'application).
 *
 * Un formulaire est une table `clé → texte` (`title`, `field:<nom>`…). Trois états :
 * - `base` : dernier état serveur réconcilié avec le brouillon ;
 * - `draft` : ce que l'utilisateur voit et modifie ;
 * - `server` : l'objet tel qu'il vient d'être relu.
 *
 * Un changement extérieur d'une clé non modifiée ici est adopté sans bruit ; sur une clé en cours de
 * saisie, c'est un conflit (bandeau « Recharger » / « Garder ma saisie »). L'enregistrement n'envoie
 * que les clés modifiées ici (`changedKeys`).
 */
export type Draft = Record<string, string>

function keysOf(...maps: Draft[]): string[] {
  return [...new Set(maps.flatMap(m => Object.keys(m)))]
}

const at = (m: Draft, k: string) => m[k] ?? ''

/** Clés modifiées dans le brouillon par rapport à la base. */
export function changedKeys(base: Draft, draft: Draft): string[] {
  return keysOf(base, draft).filter(k => at(draft, k) !== at(base, k))
}

/** Clés changées ailleurs (server ≠ base) alors que le brouillon diverge aussi, autrement. */
export function externalConflicts(base: Draft, draft: Draft, server: Draft): string[] {
  return keysOf(base, draft, server).filter(k =>
    at(server, k) !== at(base, k) && at(draft, k) !== at(base, k) && at(draft, k) !== at(server, k))
}

/** Adopte les changements extérieurs sans conflit ; les clés en conflit gardent base et brouillon. */
export function adoptExternal(base: Draft, draft: Draft, server: Draft): { base: Draft; draft: Draft; conflicts: string[] } {
  const nextBase = { ...base }
  const nextDraft = { ...draft }
  const conflicts: string[] = []
  for (const k of keysOf(base, server)) {
    if (at(server, k) === at(base, k)) continue
    if (at(draft, k) === at(base, k)) {
      nextDraft[k] = at(server, k)
      nextBase[k] = at(server, k)
    } else if (at(draft, k) === at(server, k)) {
      nextBase[k] = at(server, k)
    } else {
      conflicts.push(k)
    }
  }
  return { base: nextBase, draft: nextDraft, conflicts }
}

interface FormState {
  base: Draft
  draft: Draft
  server: Draft
  conflicts: string[]
}

export interface DraftForm {
  /** Le formulaire a été initialisé depuis l'objet. */
  ready: boolean
  draft: Draft
  set(key: string, value: string): void
  setMany(values: Draft): void
  /** Clés modifiées ici (à envoyer). */
  changed: string[]
  /** Clés modifiées ailleurs pendant la saisie. */
  conflicts: string[]
  /** Abandonne la saisie de ces clés : valeur extérieure affichée. */
  reload(keys: string[]): void
  /** Garde la saisie de ces clés : l'enregistrement écrasera la valeur extérieure. */
  keep(keys: string[]): void
  /** Valeurs des clés modifiées ici, à envoyer. */
  changedValues(): Draft
  /** Au lancement d'un enregistrement : ces valeurs (celles envoyées) deviennent la base — l'écho de
   *  notre écriture, relu avant la réponse, n'est pas un changement extérieur. Retourne l'ancienne
   *  base de ces clés, à rendre par `restoreBase` si l'enregistrement échoue. */
  markSaved(values: Draft): Draft
  restoreBase(previous: Draft): void
}

/**
 * Brouillon d'un formulaire alimenté par `server` (instantané de l'objet relu, `undefined` tant
 * qu'il n'est pas chargé). `resetKey` : autre objet → brouillon réinitialisé.
 */
export function useDraftForm(server: Draft | undefined, resetKey: string): DraftForm {
  const [state, setState] = useState<FormState | null>(null)
  const seededFor = useRef<string | null>(null)
  const serverJson = useMemo(() => (server ? JSON.stringify(server) : null), [server])
  const stateRef = useRef<FormState | null>(null)
  stateRef.current = state

  useEffect(() => {
    if (!server) return
    if (seededFor.current !== resetKey) {
      seededFor.current = resetKey
      setState({ base: { ...server }, draft: { ...server }, server: { ...server }, conflicts: [] })
      return
    }
    setState(prev => {
      if (!prev) return { base: { ...server }, draft: { ...server }, server: { ...server }, conflicts: [] }
      const { base, draft, conflicts } = adoptExternal(prev.base, prev.draft, server)
      return { base, draft, server: { ...server }, conflicts }
    })
    // `serverJson` : ne réagir qu'à un vrai changement de contenu, pas à chaque nouvel objet relu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverJson, resetKey])

  const update = useCallback((fn: (s: FormState) => FormState) => {
    setState(prev => (prev ? fn(prev) : prev))
  }, [])

  const setMany = useCallback((values: Draft) => update(s => {
    const draft = { ...s.draft, ...values }
    // Saisie revenue à la valeur extérieure : plus de conflit sur cette clé.
    const conflicts = s.conflicts.filter(k => at(draft, k) !== at(s.server, k))
    return { ...s, draft, conflicts }
  }), [update])
  const set = useCallback((key: string, value: string) => setMany({ [key]: value }), [setMany])

  const reload = useCallback((keys: string[]) => update(s => {
    const base = { ...s.base }
    const draft = { ...s.draft }
    for (const k of keys) { base[k] = at(s.server, k); draft[k] = at(s.server, k) }
    return { ...s, base, draft, conflicts: s.conflicts.filter(k => !keys.includes(k)) }
  }), [update])

  const keep = useCallback((keys: string[]) => update(s => {
    const base = { ...s.base }
    for (const k of keys) base[k] = at(s.server, k)
    return { ...s, base, conflicts: s.conflicts.filter(k => !keys.includes(k)) }
  }), [update])

  const markSaved = useCallback((values: Draft): Draft => {
    const before = stateRef.current?.base ?? {}
    const previous: Draft = Object.fromEntries(Object.keys(values).map(k => [k, at(before, k)]))
    update(s => ({ ...s, base: { ...s.base, ...values }, conflicts: s.conflicts.filter(k => !(k in values)) }))
    return previous
  }, [update])

  const restoreBase = useCallback((previous: Draft) => update(s => ({ ...s, base: { ...s.base, ...previous } })), [update])

  const draft = state?.draft ?? {}
  return {
    ready: state !== null,
    draft,
    set,
    setMany,
    changed: state ? changedKeys(state.base, state.draft) : [],
    conflicts: state?.conflicts ?? [],
    reload,
    keep,
    changedValues: () => Object.fromEntries((state ? changedKeys(state.base, state.draft) : []).map(k => [k, at(draft, k)])),
    markSaved,
    restoreBase,
  }
}

/** `field:<nom>` → valeurs des champs du brouillon. */
export function draftFields(draft: Draft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(draft)) if (k.startsWith('field:')) out[k.slice(6)] = v
  return out
}

/** Champs → clés `field:<nom>`. */
export function fieldKeys(fields: Record<string, string>): Draft {
  const out: Draft = {}
  for (const [k, v] of Object.entries(fields)) out[`field:${k}`] = v
  return out
}
