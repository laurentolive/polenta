# T72-sprint1 — Vue système multi-repo (sprint unique)

## Fichiers modifiés

```
apps/desktop/src/renderer/
  contexts/SystemViewContext.tsx     — dimension repo ajoutée (repoOptions, selectedRepoName,
                                        handleRepoChange, isRepoReadonly), repoPath résolu par repo
                                        sélectionné au lieu de project.localPath fixe
  components/sidebar/SystemPanel.tsx — combobox Composant itère repoOptions, bandeau lecture seule
  routes/product.tsx                 — validateSearch + `repo`
  routes/components.tsx              — validateSearch + `repo`
  components/layout/AppLayout.tsx    — navigate vers /product complété avec `repo: undefined`

specs/SPEC-SYSTEM-VIEW.md            — §Combobox Composant, §Persistance de l'état (voir plus bas)
specs/SPEC-INDEX.md                  — ligne SPEC-SYSTEM-VIEW.md → MAJ T72
```

## Comportement implémenté

- Le combobox **Composant** liste tous les repos du workspace (`useWorkspaceStructure`, réutilisé
  tel quel depuis T70), racine comprise, avec le label du premier `SystemNode` de chaque repo.
- Sélectionner un repo recharge schéma / arbre / index requirements-tests / liens sur son
  `repoPath` propre — création d'un élément écrit bien dans le repo sélectionné, pas dans la
  racine.
- Nouveau paramètre d'URL `repo` (persistance de la sélection), rétro-compatible : son absence
  (lien pré-T72) retombe silencieusement sur le repo racine.
- Lecture seule dynamique par repo : `api.sync.status(repoPath).branch === ''` (HEAD détaché —
  pin sur tag/SHA) désactive création/édition pour ce repo, avec bandeau explicite dans le panel.
  Le repo racine n'est jamais concerné par cette règle (couvert séparément par
  `VersioningContext`).
- Mono-repo (pas de workspace) : combobox à une seule entrée, comportement identique à avant T72.

## Divergence par rapport au design

Aucune divergence fonctionnelle. Une correction a été apportée **pendant** l'implémentation
(auto-review avant commit, pas un changement de périmètre) :

**Bug corrigé — écriture de `repo=''` dans l'URL en cas de course entre deux requêtes async.**
L'effet qui écrit les valeurs par défaut dans l'URL (`repo`/`node`/`type` au premier chargement)
ne dépendait que de `[schema]`. Or `schema` (fetch du repo racine, via son fallback
`project.localPath`) peut se résoudre **avant** que `useWorkspaceStructure` ait fini de peupler
`repoOptions`. Dans cette fenêtre, `selectedRepoName` vaut `''`, et l'effet écrivait
`repo=''` dans l'URL — une valeur non-nullish qui bloque ensuite en permanence le fallback
`urlRepo ?? repoOptions[0]?.name` (qui ne se déclenche que sur `null`/`undefined`, pas sur une
chaîne vide), même une fois `repoOptions` peuplé. Corrigé en ajoutant `repoOptions.length === 0`
à la garde de sortie anticipée de l'effet. Documenté en commentaire dans le code.

## Mises à jour SPEC effectuées

- **`SPEC-SYSTEM-VIEW.md` §Combobox Composant** : remplacé "Liste les composants (SystemNodes) du
  projet" par la définition repo-du-workspace (T72), ajout de la règle lecture seule sur pin
  figé.
- **`SPEC-SYSTEM-VIEW.md` §Persistance de l'état** : ajout de la ligne `repo`, correction des noms
  de paramètres d'URL réels (`node`/`type` vs `component`/`type` selon la route — la table
  précédente utilisait des noms conceptuels `componentId`/`typeId` qui ne correspondaient pas au
  code), note sur le fallback racine si `repo` absent.
- **`SPEC-INDEX.md`** : colonne `MAJ` de la ligne `SPEC-SYSTEM-VIEW.md` → `T72`, mots-clés
  enrichis (repo, workspace, lecture seule).
- **`T72.md` §4 (Refs SPEC)** : pas de changement au fichier lui-même — la divergence
  `api.sync.status` vs `git.listBranches` était déjà anticipée et documentée dans
  `T72-design.md` §4.1 lors de la phase Design, donc rien à corriger rétroactivement dans le spec
  d'origine.

## Comment tester manuellement

Utiliser le workspace `C:\Dev\polenta-prj2` (racine + `HMI`, `BMS`, `iface-bus-uart`,
`comp-controller`, `comp-sensor`) comme fixture — voir `T72-tests.md` pour le détail scénario par
scénario. Résumé rapide :

1. Ouvrir `polenta-prj2` → Vue Système. Le combobox Composant doit lister les 6 repos.
2. Sélectionner `comp-controller` → l'arbre doit afficher `CTRL-001`…`CTRL-004`, pas les
   exigences de la racine.
3. Créer un élément → vérifier qu'il apparaît dans `comp-controller/requirements/`, pas
   `polenta-prj2/requirements/`.
4. Ouvrir `CTRL-001` en édition → section Liens doit afficher `implémente → ITF-005` (ID brut).
5. Copier l'URL (doit contenir `repo=comp-controller`), naviguer ailleurs, y revenir → la
   sélection doit être restaurée.
6. Retirer manuellement `repo=` de l'URL et recharger → doit retomber sur le repo racine sans
   erreur.
7. Sélectionner `BMS` (pas de `.polenta/schema.yaml`) → `Aucun élément configuré`, pas de crash.
