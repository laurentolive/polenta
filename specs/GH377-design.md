# GH377 — Design : `add_object_type` crée un type version ou validation

Spec : `specs/GH377.md` (D1–D5 validées). Un seul sprint.

## 1. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/schema-defaults.ts` (nouveau, exporté par `index.ts`) | Source unique des défauts : `DEFAULT_VERSION_STATUSES`, `DEFAULT_VALIDATION_STATUSES` (`SchemaStatus[]`), `DEFAULT_VALIDATION_DECISIONS` (`ValidationDecisionDef[]`) |
| `packages/types/src/validation.ts` | `entryFieldsError(typeDef)` : contrôle strict des `entryFields` (D3) — `{ code: 'FIELD_NAME_TAKEN' \| 'REQUIRED_WHEN_INVALID', message } \| null` |
| `apps/desktop/src/renderer/components/schema/objectTypeEditor.tsx` | Les constantes `DEFAULT_VERSION_STATUSES` / `DEFAULT_VALIDATION_STATUSES` / `DEFAULT_VALIDATION_DECISIONS` deviennent dérivées des constantes partagées (même nom, même forme `EditableStatus` / `ValidationDecisionDef`) |
| `apps/desktop/src/main/services/schema.service.ts` | `addObjectType` : `prepareNewObjectType(dto.objectType)` — défauts (D1) et contrôles (D2–D5) avant les contrôles existants ; `save` inchangé |
| `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` | zod : catégories `version` / `validation`, `decisions`, `entryFields` ; description de l'outil |
| `apps/desktop/src/main/services/agents-md.template.ts` | Mention des types version / validation dans la ligne des outils de schéma |
| `specs/SPEC-MCP-SERVER.md` §4.3, `specs/SPEC-INDEX.md` | Documentation |

## 2. Décisions techniques

- **Défauts dans `SchemaService.addObjectType`, pas dans le handler MCP** : `addObjectType` n'a qu'un appelant (le
  MCP ; l'éditeur passe par `save`), et la règle « pas d'écriture si refus » y est déjà tenue. Les contrôles D2, D4,
  D5 et D3 strict y sont donc propres au MCP sans toucher `save` (l'éditeur reste permissif : `requiredWhen`
  inconnu = avertissement, GH195).
- **Ordre** : nœud / readonly / nom / préfixe pris (existants) → `prepareNewObjectType` → `save` (garde-fous
  communs : un seul type, sur `root`, `validationTypeError`). Le type préparé (défauts appliqués) est celui écrit.
- **`prepareNewObjectType`** (fonction pure, module `schema.service.ts`) :
  1. `decisions` / `entryFields` présents hors `validation` → `VALIDATION_TYPE_INVALID` (D5) ;
  2. `version` / `validation` : `prefix` vide → `VERSION_TYPE_INVALID` / `VALIDATION_TYPE_INVALID` (D2) ;
  3. `statuses === undefined` → copie des défauts ; `decisions === undefined` (validation) → copie des défauts
     (D1) ;
  4. version : nombre de statuts `isApproval` ≠ 1 → `VERSION_TYPE_INVALID` (D4) ;
  5. validation : `entryFields` normalisés (`trackHistory`, `defaultVisible` retirés), puis `entryFieldsError`
     (D3) ; `validationTypeError` est laissé à `save` (même message que l'éditeur).
- **`entryFieldsError`** : noms uniques et ≠ `decision` (`FIELD_NAME_TAKEN`) ; `requiredWhenIssues({ fields:
  entryFields }, { key: 'decision', values: decisions.map(d => d.name) })` — **erreur ou avertissement** →
  `REQUIRED_WHEN_INVALID` (strict à la déclaration MCP). Placé dans `@polenta/types` pour que #371
  (`add_field { list: 'entryFields' }`) le réutilise.
- **Copies** des défauts (`map(s => ({ ...s }))`) : jamais l'objet partagé dans le schéma (le cache de
  `SchemaService` garde le schéma).

Alternative rejetée : appliquer les défauts dans le handler zod (`.default(...)`) — le contrôle du préfixe et de
la catégorie y aurait été éclaté entre zod et le service, et `addObjectType` appelé hors MCP n'en aurait pas
bénéficié.

## 3. Sprints

Un sprint : défauts partagés, contrôles, zod, tests, documentation.
