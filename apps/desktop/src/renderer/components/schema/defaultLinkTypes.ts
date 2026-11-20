import type { LinkTypeDefinition, ObjectCategory, ObjectTypeDefinition, SystemNode } from '@polenta/types'
import { slugifyComponentName } from './objectTypeEditor'

/** GH373 — types de liens proposés à l'ajout d'un composant, dans l'ordre des cases et de création.
 *  `issue-impact` n'en fait pas partie : `SchemaService.save` l'ajoute avec le premier type issue. */
export type DefaultLinkKind = 'verification' | 'implementation' | 'implementation-parent'
export const DEFAULT_LINK_KINDS: readonly DefaultLinkKind[] = ['verification', 'implementation', 'implementation-parent']

/** Liens dont les extrémités sont cochées (le lien parent exige aussi un type exigence chez le parent). */
export function offeredDefaultLinks(categories: readonly ObjectCategory[], parentHasRequirementTypes: boolean): DefaultLinkKind[] {
  const has = (c: ObjectCategory) => categories.includes(c)
  if (!has('requirement')) return []
  return DEFAULT_LINK_KINDS.filter(kind =>
    kind === 'verification' ? has('test')
    : kind === 'implementation-parent' ? parentHasRequirementTypes
    : true)
}

/** `issue-impact` affiché (case cochée, grisée) quand Issues et Exigences sont cochées. */
export function showsIssueImpact(categories: readonly ObjectCategory[]): boolean {
  return categories.includes('issue') && categories.includes('requirement')
}

/** Racine des noms de types de liens : celle des types d'objets (GH365), en minuscules, `_` → `-`. */
export function linkTypeNamingRoot(root: string): string {
  return slugifyComponentName(root).toLowerCase().replace(/_/g, '-')
}

/** Refs `<nœud>::<type>` des types exigence d'un nœud — source du lien parent. */
export function requirementRefs(node: SystemNode | undefined): string[] {
  return (node?.objectTypes ?? []).filter(ot => ot.category === 'requirement' && ot.name).map(ot => `${node!.name}::${ot.name}`)
}

export interface DefaultLinkTypesInput {
  kinds: readonly DefaultLinkKind[]
  /** Racine GH365 du composant (`typeNamingRoot`). */
  root: string
  /** Nœud des refs du composant : son nom (composant local) ou `root` (repo séparé). */
  node: string
  /** Types créés pour le composant (un par catégorie). */
  objectTypes: readonly ObjectTypeDefinition[]
  /** Refs des types exigence du parent (`requirementRefs`). */
  parentRefs: readonly string[]
  labels: (kind: DefaultLinkKind) => { labelSourceToTarget: string; labelTargetToSource: string }
  /** Noms de types de liens déjà pris dans le workspace. */
  taken: Iterable<string>
}

/** GH373 — types de liens propres au composant. `own` va dans le schéma du composant, `parent`
 *  dans celui du parent (le même schéma pour un composant local). Même forme que l'onglet Liens
 *  (`defaultVisible` écrit seulement s'il est vrai). Un lien dont une extrémité manque est omis ;
 *  nom `<racine>-<kind>`, premier suffixe libre `-2`, `-3`… (GH97). */
export function defaultLinkTypes(input: DefaultLinkTypesInput): { own: LinkTypeDefinition[]; parent: LinkTypeDefinition[] } {
  const used = new Set(input.taken)
  const refOf = (category: ObjectCategory) => {
    const type = input.objectTypes.find(ot => ot.category === category && ot.name)
    return type ? `${input.node}::${type.name}` : undefined
  }
  const req = refOf('requirement')
  const test = refOf('test')
  const base = linkTypeNamingRoot(input.root)
  const own: LinkTypeDefinition[] = []
  const parent: LinkTypeDefinition[] = []
  for (const kind of DEFAULT_LINK_KINDS) {
    if (!input.kinds.includes(kind) || !req) continue
    const sourceRefs = kind === 'verification' ? (test ? [test] : [])
      : kind === 'implementation-parent' ? [...input.parentRefs]
      : [req]
    if (sourceRefs.length === 0) continue
    const wanted = base ? `${base}-${kind}` : kind
    let name = wanted
    for (let n = 2; used.has(name); n++) name = `${wanted}-${n}`
    used.add(name)
    const linkType: LinkTypeDefinition = { name, ...input.labels(kind), sourceRefs, targetRefs: [req] }
    if (kind === 'verification') linkType.defaultVisible = true
    ;(kind === 'implementation-parent' ? parent : own).push(linkType)
  }
  return { own, parent }
}
