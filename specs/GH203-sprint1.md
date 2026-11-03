# GH203 — Sprint 1 : vues enregistrées nommées du ⚙️

## Fichiers

- **Nouveaux** : `packages/types/src/saved-views.ts` ; `main/services/saved-views.service.ts` ;
  `renderer/components/system/SavedViewsMenu.tsx`, `savedViewSettings.ts` ; tests unitaires associés ;
  `e2e-web/gh203-saved-views.spec.ts`.
- **Modifiés** : `SystemView.tsx`, `useLiveFileSync.ts`, locales ; `main/ipc/index.ts`, `container.ts`,
  `pref.handlers.ts`, `pref-store.util.ts` ; `field-rename`, `type-rename`, `element-move`,
  `schema-delete.service.ts` ; `agents-md.template.ts` (v9) ; `web-server/channel-policy.ts` ;
  `packages/api-client` ; `packages/types/src/merge-resolution.ts` ; `CLAUDE.md`.

## Comportement

Conforme à `specs/GH203.md`. Types concernés : exigences, tests, issues (Tableau et Document). La vue
Validation réutilisera `SavedViewsMenu` et le service dans #204.

## Divergences par rapport au design

- **Déplacement d'un type vers un autre nœud** : non prévu, ajouté après la revue de code (les vues
  d'équipe auraient disparu de la liste). `ElementMoveService` déplace le fichier ; échec listé dans
  `failed`, de genre `views`.
- **Arrivée déjà occupée** : un renommage ou un déplacement n'écrase pas un fichier présent
  (`VIEWS_TARGET_EXISTS`, listé dans `failed`).
- **`views:*` en `CONTENT_ARGS`** : la clé de type et le nom sont du texte libre, sinon la garde de
  chemins du web refusait « A: revue » ou « ../x ».
- **Verrou par fichier** (`withKeyLock`) sur les écritures d'équipe, et `updateFieldVisibilityEntry`
  partagé avec `pref:set-field-visibility`.

## Défaut trouvé par les e2e

Vue active disparue : l'effet qui l'oublie se relançait à chaque rendu (React #185). Corrigé par un
callback stable dans `SystemView` et une garde « une seule fois par vue » dans le menu.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-SYSTEM-VIEW.md` §Configuration des champs | vues enregistrées nommées |
| `SPEC-SYSTEM-VIEW.md` §Persistance de l'état | ligne `savedViews`, `activeView`, `.polenta/views/` |
| `GH191.md` §5.1 | stockage remplacé |
| `SPEC-INDEX.md` | ligne §Configuration des champs, MAJ GH203 |

`SPEC-ACCOUNTS-AUTH.md` §7 : sans changement, `polenta-config` ne porte pas les vues.

## Comment tester à la main

1. Exigences, vue Tableau : régler des colonnes, liste « Vues » à côté de l'œil, « Enregistrer sous… »,
   Personnelle. Recommencer avec d'autres colonnes, puis passer d'une vue à l'autre.
2. Cocher une colonne : « modifiée » apparaît ; « Enregistrer » la retire.
3. « Enregistrer sous… », Équipe : le fichier apparaît dans Publier. Publier, puis vérifier depuis un
   autre compte après un pull.
4. Refaire le point 1 sur Issues.
