import type { CoverageStatus, ObjectTypeDefinition, Requirement, SchemaField } from '@polenta/types'

/**
 * T77 sprint 3 — "Critères de maturité" (`specs/T77.md` § Critères de maturité,
 * grounded in `CLAUDE.md` § "Règles de cohérence — à vérifier systématiquement").
 *
 * Boolean columns + a comma-joined "missing criteria" label added to every
 * `requirements` row of the query-engine dataset — plain SQL-queryable columns,
 * same flattening convention as the rest of `query-engine.service.ts` (no nested
 * object). Field names are prefixed `maturity` to avoid any realistic collision with
 * a project's own custom field names — and even if one did collide, the derived
 * columns are spread onto the row AFTER `r.fields` in `flattenRequirement()`, so the
 * derived value always wins, same rule as the existing system columns.
 *
 * The five criteria are schema-driven (no field literally named "statement" or
 * "acceptanceCriteria" is assumed) since `schema.yaml` is per-project configurable —
 * see each function's doc comment below for the exact heuristic used and why.
 */
export interface MaturityColumns {
  maturityRequiredFieldsOk: boolean
  maturityEarsOk: boolean
  maturityAcceptanceOk: boolean
  maturityVerificationOk: boolean
  maturityNoRevalidation: boolean
  maturityOk: boolean
  /** Comma-joined labels of failed criteria, e.g. "EARS, lien de vérification" — empty
   *  string when maturityOk is true. Meant to be selected as-is by the "Maturité"
   *  pre-configured dashboard's non-conformance table (no array column: AlaSQL rows
   *  are plain JS values, a joined string is simpler to display/filter in SQL than an
   *  array cell). */
  maturityMissingCriteria: string
}

/** Runtime list of `MaturityColumns`' own keys, derived from a `satisfies`-checked
 *  template object rather than hand-duplicated as a separate string array — a
 *  compile error here if this template ever drifts out of sync with the interface
 *  above (missing/extra/mistyped key), instead of a silent runtime mismatch. */
const MATURITY_COLUMN_KEYS = Object.keys({
  maturityRequiredFieldsOk: false,
  maturityEarsOk: false,
  maturityAcceptanceOk: false,
  maturityVerificationOk: false,
  maturityNoRevalidation: false,
  maturityOk: false,
  maturityMissingCriteria: '',
} satisfies MaturityColumns)

/** Query-engine builder allowlist addition (schema-lookup.util.ts's SYSTEM_QUERY_FIELDS
 *  covers only the fixed system columns) — these derived columns exist only on the
 *  `requirements` table, added there so a future builder-mode condition referencing
 *  them (e.g. `coverageStatus = 'validated'`) isn't rejected as an unknown field. Raw
 *  SQL mode needs no such allowlisting: the dataset row already has these keys. */
export const REQUIREMENT_DERIVED_FIELDS = ['coverageStatus', ...MATURITY_COLUMN_KEYS] as const

// ─── Field-value helpers ────────────────────────────────────────────────────────
// Defensive against hand-edited YAML: `Requirement.fields` is typed as always present,
// but requirements-index.service.ts casts raw parsed YAML straight to `Requirement`
// with no runtime normalization — a frontmatter missing its `fields:` key entirely
// (or a value that isn't a string where a richtext field is expected) is a real
// possibility this maturity check must not crash on (T77 sprint 3 explicitly calls
// this out: incomplete requirements are exactly this feature's use case).

function fieldValue(req: Requirement, name: string): unknown {
  return (req.fields ?? {})[name]
}

/**
 * Exported for reuse by `bulk-import-validation.util.ts` (T122 sprint 2) — the
 * "required field is filled" check must use the exact same emptiness rule as the
 * maturity dashboard (empty string / empty array / null / undefined = not filled),
 * so a bulk-import entry that passes dry-run validation is guaranteed to also pass
 * the required-fields maturity criterion.
 */
export function isFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true // number/boolean/object present at all counts as "filled"
}

/**
 * Richtext fields (`statement`, `acceptanceCriteria`…) are persisted as **Markdown**,
 * not HTML — `RichTextField.tsx`/`RichTextViewer.tsx` configure TipTap's `Markdown`
 * extension with `html: false` and serialize via `getMarkdown()`. An earlier version
 * of this file wrongly assumed HTML and stripped `<...>` tags, which is a no-op on
 * real Markdown content and left Markdown syntax (heading `#`, blockquote `>`, list
 * bullets, bold/italic) in place — breaking the "must START with an EARS keyword"
 * anchor below for anything but the plainest text (e.g. "**WHEN** the button..." or
 * "> WHEN the button... SHALL ..." would both wrongly fail). Strips just enough
 * Markdown syntax for that anchor to still find the keyword — not a full Markdown
 * parser, and deliberately NOT reused by `isMeasurableAcceptance()` below, which
 * needs the raw list-bullet syntax (`- [ ]`) intact to detect a checklist.
 */
function stripMarkdownForEars(v: unknown): string {
  if (typeof v !== 'string') return ''
  let text = v.trimStart()
  let prev: string
  do {
    prev = text
    text = text.replace(/^(#{1,6}|>|[-*+]|\d+\.)\s+/, '')
  } while (text !== prev)
  return text.replace(/[*_`]/g, '').trim()
}

/**
 * Critère 1 — "Tous les champs required: true de son type sont remplis" (CLAUDE.md
 * règle de cohérence, T77.md § Critères de maturité). Only the type's *custom*
 * `fields[]` (schema.yaml) are checked — the fixed system fields (id/objectTypeRef/
 * status) always exist by construction and aren't part of a type's `required:`
 * declarations. An unresolvable type (cross-component ref not declared locally, or a
 * type since deleted from the schema) can't be verified from here — treated as
 * passing rather than flagged immature for something we have no way to check (same
 * "can't verify ≠ invalid" stance already used by schema-lookup.util.ts).
 */
function requiredFieldsOk(req: Requirement, typeDef: ObjectTypeDefinition | null): boolean {
  if (!typeDef) return true
  return typeDef.fields.filter((f) => f.required).every((f) => isFilled(fieldValue(req, f.name)))
}

/**
 * Critère 2 — "Le champ statement respecte la syntaxe EARS" (CLAUDE.md § Syntaxe EARS
 * obligatoire — 5 patterns: ubiquitaire `THE ... SHALL`, événementiel `WHEN ... THE
 * ... SHALL`, conditionnel `WHILE ... THE ... SHALL`, optionnel `WHERE ... THE ...
 * SHALL`, réponse indésirable `IF ... THEN THE ... SHALL`).
 *
 * Applied to EVERY field the project's *own* schema.yaml marks with `validator: EARS`
 * — not hardcoded to a field literally named "statement" (CLAUDE.md's own example
 * schema happens to use that name, but nothing in the data model enforces it; the
 * `validator` flag is schema.yaml's actual mechanism for tagging an EARS-checked
 * field, per `SchemaField.validator`). A type declaring more than one such field
 * (unusual but not forbidden by the schema) must have ALL of them EARS-compliant —
 * "the statement respects EARS" means every EARS-tagged field of this exigence does,
 * not just the first one found. A project with no field declaring `validator: EARS`
 * at all has nothing to check and passes vacuously.
 *
 * Heuristic, not a full grammar parser: after stripping Markdown syntax that would
 * hide the leading keyword (see `stripMarkdownForEars` above), the text must start
 * with one of the 5 EARS keywords and contain the word SHALL somewhere after. All 5
 * patterns above satisfy this (the unwanted-response pattern still starts with IF).
 * Deliberately lenient — this is a coarse structural check, not a semantic
 * validation of the sentence.
 */
const EARS_PATTERN = /^\s*(WHEN|WHILE|WHERE|IF|THE)\b[\s\S]*\bSHALL\b/i

/**
 * Exported for reuse by `bulk-import-validation.util.ts` (T122 sprint 2) — a
 * `bulk_import_requirements` entry with a `validator: EARS` field must be checked
 * against the exact same heuristic as the "Maturité" dashboard, so an entry that
 * passes MCP dry-run validation doesn't later fail the maturity check (or vice
 * versa) due to two divergent regexes.
 */
export function isEarsCompliant(raw: unknown): boolean {
  const text = stripMarkdownForEars(raw)
  return text.length > 0 && EARS_PATTERN.test(text)
}

/**
 * Critère 3 — "Au moins un critère d'acceptance mesurable est présent" (T77.md). Also
 * schema-driven and heuristic: looks for a field whose `name` or `label` contains
 * "accept" (case-insensitive — matches CLAUDE.md's convention field name
 * `acceptanceCriteria` without hardcoding it, same spirit as criterion 2). Unlike
 * EARS, schema.yaml has no dedicated `validator` value for this criterion, so field
 * *name* is the only structural signal available — documented here as the explicit
 * heuristic choice this sprint's instructions call for. If the type declares no such
 * field, the criterion doesn't apply and passes vacuously.
 *
 * "Measurable" is approximated as: non-empty AND containing either a Markdown
 * checklist item (`- [ ]` / `- [x]`, the format used by CLAUDE.md's own
 * `acceptanceCriteria` example: "- [ ] Démarrage mesuré < 500 ms…") or a digit (a
 * bare number/threshold written as prose rather than a checklist, e.g. "< 500 ms").
 * Deliberately simple — not a semantic measurability check. Operates on the RAW
 * Markdown text (unlike `isEarsCompliant`'s `stripMarkdownForEars`): the checklist
 * signal it looks for IS the `- [ ]` list-bullet syntax, so it must not be stripped.
 */
function findAcceptanceField(fields: SchemaField[]): SchemaField | undefined {
  return fields.find((f) => /accept/i.test(f.name) || (f.label != null && /accept/i.test(f.label)))
}

function isMeasurableAcceptance(raw: unknown): boolean {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return false
  return /-\s*\[[ xX]?\]/.test(text) || /\d/.test(text)
}

/**
 * Resolves the status name that means "approved" for this type, from the schema's
 * own `statuses[].isApproval` flag (`SchemaStatus.isApproval`) rather than the
 * literal string `'approved'` — a project whose approval status is named
 * differently (e.g. `valide`) would otherwise never trigger criterion 4 at all,
 * silently treating every one of its approved-equivalent requirements as mature
 * regardless of verification links. Falls back to the literal `'approved'` only
 * when the type can't be resolved or declares no `isApproval` status (schema
 * predates this flag, or genuinely doesn't use one) — matches CLAUDE.md's own
 * example schema, which always declares `approved: { isApproval: true }`.
 */
function isApprovedStatus(req: Requirement, typeDef: ObjectTypeDefinition | null): boolean {
  const approvalStatusName = typeDef?.statuses?.find((s) => s.isApproval)?.name
  return req.status === (approvalStatusName ?? 'approved')
}

export function computeMaturity(
  req: Requirement,
  typeDef: ObjectTypeDefinition | null,
  coverageStatus: CoverageStatus,
  needsRevalidation: boolean,
): MaturityColumns {
  // Défense contre un `objectTypeRef` manquant/malformé (frontmatter édité à la
  // main) — `schema-lookup.util.ts`'s `findObjectTypeDef` ne plante plus dessus
  // (garde ajoutée en revue), mais une exigence sans type résolvable n'est de toute
  // façon jamais "mûre" : signalé explicitement plutôt que de laisser silencieusement
  // passer le critère 1 comme "impossible à vérifier" (le typeDef sera `null` dans ce
  // cas comme dans le cas légitime "type cross-composant non résolvable" — on ne peut
  // pas distinguer les deux ici, mais un objectTypeRef absent est le signal le plus
  // fort d'une exigence incomplète, donc traité comme un critère manquant à part).
  const hasObjectTypeRef = typeof req.objectTypeRef === 'string' && req.objectTypeRef.length > 0

  const fields = typeDef?.fields ?? []

  const reqOk = requiredFieldsOk(req, typeDef)

  const earsFields = fields.filter((f) => f.validator === 'EARS')
  const earsOk = earsFields.every((f) => isEarsCompliant(fieldValue(req, f.name)))

  const acceptField = findAcceptanceField(fields)
  const acceptOk = !acceptField || isMeasurableAcceptance(fieldValue(req, acceptField.name))

  // Critère 4 — "Si status: approved → au moins un lien verification vers un test"
  // (CLAUDE.md règle 3 / T77.md). Reuses `coverageStatus` (computed once per
  // requirement by query-engine.service.ts via TraceabilityService.computeCoverage(),
  // T63-fixed logic) rather than re-deriving test↔requirement link matching a second
  // time: `coverageStatus !== 'not_covered'` is exactly "at least one test case is
  // linked to this requirement" — this criterion only cares that a verification link
  // exists, not whether it passed.
  const verificationOk = !isApprovedStatus(req, typeDef) || coverageStatus !== 'not_covered'

  // Critère 5 — l'exigence n'est pas marquée `needsRevalidation` (T172 : le flag est porté
  // par l'élément, posé quand un élément lié quitte l'approbation — impact à vérifier).
  const noReval = !needsRevalidation

  const criteria: [boolean, string][] = [
    [hasObjectTypeRef, "type d'objet invalide"],
    [reqOk, 'champs requis'],
    [earsOk, 'EARS'],
    [acceptOk, "critère d'acceptance"],
    [verificationOk, 'lien de vérification'],
    [noReval, 'impact à vérifier'],
  ]
  const missing = criteria.filter(([ok]) => !ok).map(([, label]) => label)

  return {
    maturityRequiredFieldsOk: hasObjectTypeRef && reqOk,
    maturityEarsOk: earsOk,
    maturityAcceptanceOk: acceptOk,
    maturityVerificationOk: verificationOk,
    maturityNoRevalidation: noReval,
    maturityOk: missing.length === 0,
    maturityMissingCriteria: missing.join(', '),
  }
}
