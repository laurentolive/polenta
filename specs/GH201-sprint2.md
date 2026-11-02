# GH201 — Sprint 2 : interface (sous-panneau Produit, page, backlog, passage released)

## Fichiers modifiés

- `renderer/components/sidebar/VersionPanel.tsx` — bouton « Produit » (icône paquet) ; corps
  `ProductVersionsPanel` sur les routes du sous-panneau.
- `renderer/components/sidebar/version/ProductVersionsPanel.tsx` (nouveau) — arbre des repos, versions
  (pastille d'état), « Backlog (n) », « Nouvelle version », case « Afficher les versions abandonnées ».
- `renderer/components/versions/` (nouveau) — `useVersions.ts` (requêtes `['versions', …]`, erreurs,
  `isProductVersionsPath`), `NewVersionDialog`, `ReleaseVersionDialog`, `VersionChangesTable`,
  `VersionElementPicker` (réintroduit depuis `ChangeElementPicker` @ 4e06052).
- Routes (nouvelles) : `versions.tsx` (accueil), `version.$versionId.tsx` (page), `versions_.backlog.tsx`
  (backlog) ; `routeTree.gen.ts` régénéré.
- `renderer/components/layout/AppLayout.tsx` — ces routes ouvrent le panneau Version ; retour sur la
  page quittée.
- `renderer/components/schema/StructureTab.tsx` — « + Version » sur la ligne d'un repo sans type version ;
  `objectTypeEditor.tsx` — statuts par défaut `en_cours` / `released` / `abandonnee` ;
  `ElementConfigModal.tsx` — nom et préfixe d'un type version existant verrouillés.
- `renderer/hooks/useLiveFileSync.ts` — invalidation `versions` (versions, éléments, schéma, dépendances)
  et des widgets Suivi sur `versions/`.
- i18n `versions.*` (fr, en).
- Main (revue) : `versions.service.ts`, `schema.service.ts`, `sync.service.ts`, `schema-delete.service.ts`,
  IPC / api-client (`releasePreview(…, tag)`) — voir `GH201-design.md` § « Ajustements du sprint 2 ».

## Comportement implémenté

Spec §2, §3, §4, §5, §6 côté interface. Vérifié dans l'application (projet de test : un repo, types
exigence / test / version) : création de version, backlog « nouveau », « Tout inclure », page de la
version, passage released (commit `[version] VER-0001 1.0 released`, tag `proj-1.0`, liste des tags en
attente), exigence modifiée → backlog « modifié », « Voir les modifications » (diff base → disque),
seconde version (`basedOn` pré-rempli), sélecteur « Ajouter », tag existant signalé dans le dialogue.

## Divergences par rapport au design

- Version abandonnée définitive (revue) ; aperçu du passage released avec le tag saisi.

## Comment tester manuellement

1. Modèle de données → « + » sur la ligne du repo → « + Version » : type créé avec ses trois statuts.
2. Panneau Version → icône « Produit » : arbre, « Nouvelle version » (label), page de la version.
3. Backlog : « Tout inclure » ou sélection + « Inclure dans … » ; « Voir les modifications ».
4. Page : « Ajouter » (élément inchangé), « Retirer » (✕), composants (projet multi-repo).
5. « Passer released » : tag proposé `<repo>-<label>`, refus si tag existant, élément inclus non
   commité, composant non released ; après passage : page en lecture seule, abandon seul possible.
6. Modifier une exigence livrée : elle revient au backlog « modifié ».
