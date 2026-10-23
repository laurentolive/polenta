# GH104 — Sprint 2 : renderer, doc SPEC, e2e

Périmètre : `specs/GH104-design.md` §7, sprint 2 (modale de confirmation, flux de suppression
unifié dans l'onglet Structure, i18n, SPEC, e2e). Sprint final.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `renderer/components/schema/SchemaDeleteConfirmModal.tsx` | nouveau — confirmation à partir de l'aperçu |
| `renderer/components/schema/StructureTab.tsx` | `requestDelete` / `confirmDelete`, corbeilles (composant, type) en simple bouton, `DeleteReportBanner`, `repoLabel` partagé avec GH100 |
| `renderer/components/schema/ElementConfigModal.tsx` | bouton Supprimer sans `ConfirmDelete` (la confirmation vient de StructureTab) |
| `renderer/i18n/locales/{fr,en}.json` | `schema.deleteCascade.*` |
| `packages/types/src/schema.ts`, `main/services/schema-delete.service.ts` | `SchemaDeleteResult.schemaSaved` |
| `main/services/schema-delete.service.test.ts` | assertions `schemaSaved` |
| `e2e-web/gh104-delete-cascade.spec.ts` | nouveau — D11, D12, D14, D15 |
| `specs/SPEC-*.md`, `specs/SPEC-INDEX.md` | cf. § Mises à jour SPEC |

## Comportement implémenté

- Corbeille d'un composant local, corbeille d'un type, bouton Supprimer de la configuration d'un
  type → même flux : `schema:preview-delete` → `SchemaDeleteConfirmModal` → `schema:delete` →
  bannière de compte rendu → invalidation de tout le cache react-query.
- Modale : titre « Supprimer le composant / le type « X » ? », sous-composants (nombre déduit du
  plan), objets par catégorie (5 premiers IDs), liens par repo, types de lien mis à jour, types de
  lien qui deviennent invalides (avertissement), rappel pierres tombales et « rien n'est commité ».
  Erreur de pré-contrôle → message, Supprimer désactivé. Pendant la suppression : ni Échap ni clic
  extérieur.
- Une seule opération à la fois (garde contre deux corbeilles cliquées pendant un aperçu).
- Après une suppression, la sélection (modale du type) est fermée : elle désigne le type par son
  index, que le schéma a pu décaler.
- Compte rendu : objets / liens supprimés ; échecs avec deux messages selon `schemaSaved` —
  faux : « le composant / type est conservé, relancez » ; vrai : « supprimé, fichiers non nettoyés
  à corriger à la main ».

## Divergences par rapport au design

1. **D13 sans objet** : aucun écran du renderer n'affiche les revues (`reviews:*` n'est appelé que
   côté main / MCP). Les fichiers `reviews/*.yaml` sont conservés comme prévu (§2.4).
2. **Type tout juste créé** : le design prévoyait de garder la suppression directe depuis
   `ElementConfigModal` ; le bouton Supprimer n'y est pas affiché pour un type neuf, l'abandon passe
   déjà par `handleCloseElementModal` (inchangé). Branche morte retirée.
3. **`schemaSaved`** ajouté à `SchemaDeleteResult` (non prévu) pour formuler correctement un échec
   survenu après l'enregistrement du schéma (arbre non supprimé, schéma d'un autre repo).
4. **Tests renderer** : pas de tests de composant React dans le repo ; D11, D12, D14 sont couverts
   par l'e2e web avec D15.

## Revue (`/code-review`)

Corrigés : sélection par index périmée après suppression ; Échap / clic extérieur pendant la
suppression ; erreur d'aperçu masquée par la modale du type ; message d'échec faux après
l'enregistrement du schéma ; course entre deux aperçus ; branche morte ; JSDoc déplacée ;
`subCount` recalculé côté client (déduit du plan).
Écarté : nettoyage `afterAll` de l'e2e — chaque fichier e2e clone son propre projet (rien n'est
publié), et le hook de session ferme la page avant tout `afterAll` du fichier.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-REQ-requirements.md` §9 | règle amendée : pas de suppression d'une exigence individuelle ; exception suppression en cascade du composant / type (périmètre, arrêt sur échec, conservé) |
| `SPEC-REQ-requirements.md` §5.1 | liste de refs vide = type de lien invalide (renderer + validation main) |
| `SPEC-ELECTRON-DESKTOP.md` §20.4 | canaux `schema:preview-delete` / `schema:delete`, `ApiClient.schema` |
| `SPEC-ELECTRON-DESKTOP.md` §20.6 | flux de suppression de l'onglet Structure |
| `SPEC-TEMPLATES.md` §3 | suppression d'un composant local / d'un type (et pas d'un composant en repo séparé) |
| `SPEC-TECH-stack.md` §4.4 | pierres tombales posées aussi par la suppression en cascade |
| `SPEC-INDEX.md` | MAJ → GH104 pour REQ §5, ELECTRON §20, TEMPLATES §3, TECH §4 ; nouvelle ligne REQ §9 |
| `SPEC-TESTS.md` §4.1 | inchangé (une entrée de campagne d'un test supprimé est déjà « Indisponible ») |

## Tests

- `pnpm typecheck` : 0 erreur. `pnpm test` : 639 tests verts (desktop), 38 (merge-core).
- `pnpm --filter @polenta/desktop test:e2e:web` : 102 verts + 3 GH104 (relancés après le retrait
  du `afterAll`), 13 ignorés.

## Tester manuellement

1. Modèle de données → Structure : créer un composant local « Essai » avec un type d'exigence et un
   type de test, créer 2 exigences et 1 test, lier le test à une exigence et une exigence à une
   exigence de `root`.
2. Corbeille du composant : la confirmation affiche 2 exigences, 1 test, les liens et le type de
   lien qui devient invalide. Annuler → `git status` propre.
3. Corbeille d'un type (test) : seule la ligne des tests apparaît. Annuler.
4. Corbeille du composant → Supprimer : bannière « Suppression effectuée », composant absent,
   `git status` : fichiers supprimés, `.polenta/tombstones/<ID>`, `links/links.yaml`,
   `.polenta/schema.yaml` modifiés.
