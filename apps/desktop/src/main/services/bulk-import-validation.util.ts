import { initialStatus, isUnknownStatus, prepareFieldsWrite } from '@polenta/types'
import type { ObjectTypeDefinition, ProjectSchema } from '@polenta/types'
import { findObjectTypeDef, findLocalNodeByRefPrefix, findOwningNode } from './schema-lookup.util'
import { isEarsCompliant, isFilled } from './field-checks.util'
import { fieldValuesErrors } from './field-values.util'

/**
 * Couche de validation dry-run des tools `bulk_import_*` (T122 sprint 2 —
 * specs/T122-design.md §3.1). Logique métier pure (pas d'accès disque/git ici — la
 * lecture de `schema.yaml` et le calcul des IDs prévisionnels via `peekNextCounterId`
 * restent à la charge de l'appelant, `mcp-server/tools/bulk-import.tools.ts`) :
 * testable sans MCP, réutilisable si `apps/api` ressuscite un jour (T122.md).
 */

export interface BulkEntryError {
  index: number
  reason: string
  /** Nom du champ en cause, si l'erreur porte sur un champ précis. */
  field?: string
}

export interface BulkValidEntry<TDto> {
  index: number
  dto: TDto
  predictedId: string
}

export interface BulkValidationResult<TDto> {
  valid: Array<BulkValidEntry<TDto>>
  errors: BulkEntryError[]
}

/**
 * Champs communs à `CreateRequirementDto`/`CreateTestCaseDto`/`CreateCampaignDto`
 * nécessaires à cette validation. `objectTypeRef` est optionnel — contrairement à
 * `CreateRequirementDto`/`CreateTestCaseDto` (toujours requis, imposé par leur zod
 * schema), `CreateCampaignDto.objectTypeRef` est explicitement optionnel
 * (`campaign.schema.ts`... en fait `packages/types/src/campaign.ts`) : une campagne
 * n'est pas forcément rattachée à un `ObjectTypeDefinition` de catégorie `campaign`
 * (elle peut n'être catégorisée que par `component`/`level`). Une entrée sans
 * `objectTypeRef` n'a simplement rien à vérifier côté schéma (règles 1-4 ci-dessous
 * toutes vides) — ce n'est pas une erreur.
 */
export interface BulkImportEntryDto {
  objectTypeRef?: string
  /** GH149 — statut demandé (exigences, tests) ; absent = premier statut du type. */
  status?: string
  fields?: Record<string, unknown>
}

/**
 * Valide chaque entrée d'un batch `bulk_import_*` selon les règles suivantes. Les règles 1-2
 * (type, nœud) arrêtent la validation de l'entrée ; les règles 3-6 sont indépendantes et
 * toutes leurs erreurs sont rapportées (GH384 : une erreur par champ en cause, pour corriger
 * un gros import en un seul aller-retour). `prepareFieldsWrite` (liens, `requiredWhen`)
 * n'est contrôlé que si les règles précédentes passent. Une entrée en erreur n'empêche pas
 * la validation des autres entrées du batch ; `errors` peut porter plusieurs erreurs pour un
 * même `index` :
 *
 * 1. `objectTypeRef` résout vers un `ObjectTypeDefinition` existant. `'unresolvable'`
 *    (ref cross-composant non vérifiable localement) est ACCEPTÉ, pas une erreur —
 *    cohérent avec `schema-lookup.util.ts::findObjectTypeDef`. Une entrée sans
 *    `objectTypeRef` du tout (campagnes) saute directement à la validation `null` (=
 *    valide, aucune règle 2-4 applicable).
 * 2. Le nœud propriétaire du type n'est pas `readonly: true`.
 * 3. Tous les champs `required: true` du type sont présents et non vides dans
 *    `dto.fields`.
 * 4. Pour chaque champ `validator: 'EARS'` du type : le texte respecte la syntaxe
 *    EARS (réutilise `field-checks.util.ts::isEarsCompliant`, même heuristique que le
 *    calcul de maturité affiché dans l'UI — pas une seconde regex divergente).
 * 5. GH149 — un `status` fourni fait partie des statuts déclarés par le type.
 * 6. GH372 — valeurs de `fields` (`field-values.util.ts::fieldValuesError`) : champ déclaré, enum /
 *    multi_enum dans la liste, number / boolean / date bien formés.
 *
 * `nextIdPreview` est un callback FOURNI PAR L'APPELANT, appelé une fois par entrée
 * VALIDE (dans l'ordre du batch) pour obtenir son `predictedId` — cette fonction
 * n'a pas accès au disque (`peekNextCounterId` est async), donc ne peut pas calculer
 * elle-même les IDs prévisionnels. Le callback est délibérément stateful (pas de
 * paramètre `countSoFar` explicite) : le compteur "combien d'entrées de ce préfixe
 * ont déjà été prévues dans ce batch" doit être tenu par préfixe résolu, et seul
 * l'appelant connaît la correspondance objectTypeRef → préfixe pour CHAQUE catégorie
 * (ex. les campagnes utilisent toujours le préfixe fixe `CAMP`, indépendamment de
 * `objectTypeRef` — un compteur tenu ici par `objectTypeRef` littéral donnerait des
 * IDs prévisionnels en collision si un batch mélange plusieurs types de campagne).
 */
export function validateBulkEntries<TDto extends BulkImportEntryDto>(
  schema: ProjectSchema,
  entries: TDto[],
  nextIdPreview: (objectTypeRef: string | undefined) => string,
): BulkValidationResult<TDto> {
  const valid: Array<BulkValidEntry<TDto>> = []
  const errors: BulkEntryError[] = []

  entries.forEach((dto, index) => {
    const entryErrors = validateEntry(schema, dto)
    if (entryErrors.length > 0) {
      errors.push(...entryErrors.map((e) => ({ index, ...e })))
      return
    }
    valid.push({ index, dto, predictedId: nextIdPreview(dto.objectTypeRef) })
  })

  return { valid, errors }
}

function validateEntry(
  schema: ProjectSchema,
  dto: BulkImportEntryDto,
): Array<{ reason: string; field?: string }> {
  if (!dto.objectTypeRef) return [] // ex. campagne sans type — rien à vérifier côté schéma

  const resolved = findObjectTypeDef(schema, dto.objectTypeRef)
  if (resolved === null) {
    return [{ reason: `objectTypeRef inconnu : "${dto.objectTypeRef}" ne correspond à aucun type déclaré dans schema.yaml` }]
  }

  // Le nœud propriétaire peut être connu localement (déclaré dans schema.nodes, avec
  // son propre `readonly`) MÊME quand le TYPE lui-même est `'unresolvable'` — c'est
  // précisément la forme d'un nœud de composant en repo séparé, nommé d'après son nom de montage (T69/CLAUDE.md : "objectTypes absent →
  // le schéma du composant fait foi") : findObjectTypeDef renvoie 'unresolvable' dès
  // que `node.objectTypes === undefined`, mais le `SystemNode` (donc son `readonly`)
  // est bien présent dans `schema.nodes`. Vérifier le readonly AVANT de traiter
  // 'unresolvable' comme "rien à vérifier" — sinon un import ciblant un composant
  // readonly correctement configuré en workspace (résolu par
  // `resolveComponentRepoPath` → écriture réelle dans le repo du composant) passerait
  // la validation sans jamais être refusé (trouvé en revue de code).
  const node = resolved === 'unresolvable'
    ? findLocalNodeByRefPrefix(schema, dto.objectTypeRef)
    : findOwningNode(schema, dto.objectTypeRef, resolved)
  if (node?.readonly) {
    return [{ reason: `nœud '${node.name}' en lecture seule — écriture refusée` }]
  }

  if (resolved === 'unresolvable') return [] // type non vérifiable localement (ref cross-composant), nœud pas readonly (ou lui-même inconnu localement) — accepté, cf. schema-lookup.util.ts

  const errors: Array<{ reason: string; field?: string }> = []
  for (const f of resolved.fields.filter((f) => f.required && !isFilled(dto.fields?.[f.name]))) {
    errors.push({ reason: `champ requis manquant : ${f.name}`, field: f.name })
  }

  // Champ requis absent : déjà signalé, pas une seconde erreur EARS sur le même champ.
  for (const f of resolved.fields.filter((f) => f.validator === 'EARS' && !(f.required && !isFilled(dto.fields?.[f.name])))) {
    if (isEarsCompliant(dto.fields?.[f.name])) continue
    errors.push({
      reason: `le champ '${f.name}' ne respecte pas la syntaxe EARS (WHEN/WHILE/WHERE/IF...THEN/THE ... SHALL ...)`,
      field: f.name,
    })
  }

  if (dto.status && isUnknownStatus(resolved, dto.status)) {
    errors.push({
      reason: `statut inconnu : "${dto.status}" (statuts du type : ${resolved.statuses!.map((s) => s.name).join(', ')})`,
      field: 'status',
    })
  }

  // GH372 — valeurs des champs : même règle que update_requirements / update_tests.
  errors.push(...fieldValuesErrors(schema, resolved, dto.objectTypeRef, dto.fields))
  if (errors.length > 0) return errors

  // GH195 — liens (forme texte `libellé | URL` acceptée, URL contrôlées) et `requiredWhen`.
  const prepared = prepareFieldsWrite(resolved, null, { status: dto.status ?? initialStatus(resolved), fields: dto.fields })
  if (!prepared.ok) return [{ reason: prepared.reason, field: prepared.field }]

  return []
}

/**
 * Résout le préfixe d'ID pour un `objectTypeRef` — mirroir exact du fallback déjà
 * dupliqué entre `requirements.service.ts::nextId()` et `tests.service.ts::nextTestId()`
 * (type résolu → `prefix` du schéma ; sinon 6 premiers caractères du nom de type en
 * majuscules). Une 3e copie ici plutôt qu'une extraction partagée dans ces deux
 * services : ce sprint ne les modifie pas (hors périmètre, cf. specs/T122-design.md
 * §7 — seuls `id-counter.util.ts`, ce fichier et les tools MCP sont touchés), et le
 * mirroring est indispensable pour que l'ID prévisionnel du dry-run corresponde
 * exactement à celui que `RequirementsService.create`/`TestsService.create`
 * produiront réellement.
 */
export function resolveIdPrefix(schema: ProjectSchema, objectTypeRef: string): string {
  const typeName = objectTypeRef.split('::').pop() ?? objectTypeRef
  const resolved = findObjectTypeDef(schema, objectTypeRef)
  const fallback = typeName.slice(0, 6).toUpperCase()
  // Défensif : un `objectTypeRef` vide (actuellement inatteignable via les tools MCP
  // — `CreateRequirementSchema`/`CreateTestCaseSchema` imposent `min(1)`, seul
  // `makeCampaignIdPreview` gère l'absence de type, sans jamais appeler cette
  // fonction) donnerait sinon un préfixe vide et un ID malformé du type `-0007`.
  return (resolved && resolved !== 'unresolvable' ? resolved.prefix : undefined) ?? (fallback || 'OBJ')
}
