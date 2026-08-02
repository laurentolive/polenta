# T130 — sprint 1 (final)

## Addendum — suite à la relecture humaine

Deux changements demandés après la première relecture, **hors périmètre doc-only initial** :
1. `templates/electro-domestic-battery.yaml` **supprimé** (pas réécrit) — décision de l'humain,
   faute de mécanisme d'application de template dans l'app.
2. **Support Gitea retiré du code**, sur demande explicite (pas une simple correction de doc cette
   fois) : `resolveGiteaIdentity()` supprimée d'`auth.service.ts`, host non-GitHub retombe sur une
   identité minimale ; retiré des listes de remotes suggérés dans `login.tsx`, `account.tsx`,
   `AccountMenu.tsx`, `AccountPanel.tsx`. Docs mises à jour en conséquence (`SPEC-ACCOUNTS-AUTH.md`,
   `SPEC-ELECTRON-DESKTOP.md`, `SPEC-TECH-stack.md`, `SPEC-PROJECT-MANAGEMENT.md`,
   `SPEC-TEMPLATES.md`). Commit séparé `7b23d87` (le sprint restant décrit ci-dessous, commit
   `f5b4a76`, est resté doc-only).

## Décision de périmètre (donnée par l'humain après lecture de `specs/T130.md`)

Aucune correction de code — l'application est jugée prête pour une première version. Ce sprint
est **exclusivement documentaire** : chaque écart confirmé dans `specs/T130.md` est corrigé en
alignant le texte des `specs/SPEC-*.md` sur le comportement réel du code, y compris les 3 items
initialement mis de côté comme "décision produit" (`milestoneTag`, `objectVersion`, commentaires de
review) — traités eux aussi comme des corrections directes de `SPEC-REVIEWS.md`.

## Fichiers modifiés

- `specs/SPEC-ELECTRON-DESKTOP.md` — le plus gros du volume :
  - §2-19, §21 : ~25 corrections ponctuelles (services à plat au lieu de sous-dossiers, IPC
    consolidée dans `ipc/index.ts`, pas de `BranchService`, `WorkspaceService` réécrit pour le
    workspace plat T69, channels IPC réels — `workspace:*`/`sync:*`/`baseline:*` au lieu de
    `branches:*`/anciens noms, container à 22 services, fenêtre 1280×800, menu natif désactivé,
    pas de route `/branch/new`).
  - Renumérotation complète §18-23 (l'ancien §21 "Design system" apparaissait avant l'ancien §19,
    qui dupliquait lui-même §19.3/§19.4 ; §20.6/§20.7 étaient physiquement égarées après tout le
    §21) — séquence 1-23 propre, sans doublon, vérifiée par grep des en-têtes.
  - §20 et §22 réécrits intégralement — c'était le principal écart lourd déjà pressenti par le
    ticket, plus large que prévu : §20 (format `.polenta/schema.yaml`) décrivait un modèle
    `requirementTypes`/`ComponentDefinition` avec génération de `.gitmodules` entièrement fictif
    (0 occurrence dans le code) ; §22 décrivait des submodules Git single-niveau avec `tree.yaml`
    unique et hook pre-commit Python, remplacés depuis T69/T123 par `polenta-repo.yaml` + workspace
    plat + imbrication de composants locaux à profondeur illimitée + `.polenta/trees/<nœud>/<type>.yaml`
    maintenu par l'app.
- `templates/electro-domestic-battery.yaml` — réécrit intégralement au format
  `nodes[].objectTypes[]`/`linkTypes[]` (`packages/types/src/schema.ts`), validé par parsing
  effectif avec le `js-yaml` réel de l'app (`node -e "require('js-yaml').load(...)"` depuis le repo
  principal). Contenu métier préservé (6 types d'exigence SYS/SW/HW/MECA/BAT/PRD + 1 type de test,
  champs communs EARS/priorité/tags/diagrammes, statuts avec `isApproval`/`isTerminal`) ; le
  concept `transitions`/`roles` d'accès (RBAC) a été abandonné car sans équivalent dans le modèle
  actuel (`SchemaStatus` n'a pas de `requiredRoles`).
- `specs/SPEC-TEMPLATES.md` §5-6 — marqués "non implémenté" (aucun channel `templates:*`, aucun
  sélecteur UI trouvé) plutôt que réécrits comme s'ils décrivaient l'existant ; template `generic`
  retiré du tableau (fichier inexistant) ; §7 exemple CI corrigé (`update-tree.py` retiré).
- `specs/SPEC-TECH-stack.md` — stack desktop réel (pas de shadcn/ui/react-hook-form, réservés à
  `apps/web`), `config/project.yaml` réel (seul `integrationBranch`).
- `specs/SPEC-MCP-SERVER.md` — `TreeService` retiré de la liste "hors périmètre" (il est construit
  depuis T138).
- `specs/SPEC-PROJECT-MANAGEMENT.md` — menu natif marqué désactivé, channels réels
  (`workspace:clear-last-opened`/`mark-recent`, pas `mark-last-opened`), création de projet réelle
  (local uniquement, pas d'appel API GitHub/Gitea ni de notion Privé/Public).
- `specs/SPEC-TESTS.md` — 5 occurrences fantômes `attachments: []` retirées des exemples YAML
  (contredisaient le texte de §3.4, qui documente déjà l'absence de ce champ).
- `specs/SPEC-REVIEWS.md` — `milestoneTag` marqué non implémenté (§2.2, §2.6, exemple YAML, table
  §8) ; `objectVersion` sur `ReviewObject` confirmé persisté en pratique mais absent du type
  TypeScript (nuance ajoutée, pas retiré) ; `objectVersion` fantôme retiré de l'exemple
  `ReviewApproval` (n'existe pas sur ce type) ; commentaires de review (§3.3-3.4) et index mémoire
  dédié (§6) marqués non implémentés.
- `specs/SPEC-AUDIT.md` — entrée `§2.2` (inversion `covered`/`validated`) marquée résolue (corrigée
  par T63, vérifié par lecture directe de `traceability.service.ts`) ; note ajoutée expliquant que
  ce fichier a servi de référence plutôt que d'être ré-audité en double.
- `specs/SPEC-INDEX.md` — colonne `MAJ` → `T130` pour toutes les sections listées ci-dessus, entrée
  ajoutée pour `SPEC-AUDIT.md` (absent de l'index jusqu'ici), nouvelles lignes pour
  `SPEC-TEMPLATES.md` §5-7 et `SPEC-ELECTRON-DESKTOP.md` §20/§22.

## Découvertes en cours de route (au-delà du périmètre initial du ticket)

- §20 de `SPEC-ELECTRON-DESKTOP.md` était au moins aussi obsolète que le §22 déjà identifié par le
  ticket, mais n'avait pas été repéré comme tel initialement.
- L'application d'un template n'est pas juste un fichier obsolète : la fonctionnalité entière
  (§5 de `SPEC-TEMPLATES.md`) n'a pas de channel IPC ni d'UI. Marquée non implémentée plutôt que
  simplement "corrigée".
- Le template `generic` mentionné dans `SPEC-TEMPLATES.md` §6 n'existe pas comme fichier.
- `SPEC-PROJECT-MANAGEMENT.md` §9 décrivait une création de projet avec appel API GitHub/Gitea
  (`POST /user/repos`) et notion de visibilité — le code réel (`createNewProject`) fait un simple
  `git init` local, sans remote.
- `specs/SPEC-AUDIT.md`, document d'audit préexistant (2026-06-24) couvrant `SPEC-TESTS`/
  `SPEC-TRACEABILITY`/`SPEC-SYSTEM-VIEW`/baselines, n'était référencé nulle part dans
  `SPEC-INDEX.md` — trouvé en cours d'audit, pas mentionné dans le ticket initial.

## Comment vérifier

- Lecture directe : chaque affirmation corrigée cite un fichier:ligne du code source réel (voir le
  détail dans `specs/T130.md`).
- Le template réécrit a été validé par parsing effectif :
  `node -e "require('<repo>/apps/desktop/node_modules/js-yaml').load(require('fs').readFileSync('templates/electro-domestic-battery.yaml','utf-8'))"`
  — 0 erreur, structure `nodes[].objectTypes[]` avec 7 préfixes uniques (SYS/SW/HW/MECA/BAT/PRD/TEST).
- Aucun fichier sous `apps/` ou `packages/` n'a été modifié — seuls `specs/` et `templates/`.
- `git diff --stat` dans `../polenta-T130` : 10 fichiers modifiés (+890/-1330 lignes), 1 fichier
  créé (`specs/T130.md`).

## Divergences par rapport au design

Pas de phase Design formelle distincte pour ce ticket (périmètre entièrement énuméré dans
`specs/T130.md`, phase Spec) — ce sprint applique directement les corrections listées dans ce
fichier, sans écart par rapport à ce qui y était annoncé, sauf les découvertes ci-dessus (qui
étaient elles-mêmes anticipées comme probables par la remarque finale du ticket original : "ce type
de dérive doc/code n'est probablement pas isolé aux deux points ci-dessus").

## [STOP HUMAIN]

Prêt pour relecture. Si validé : archiver le ticket dans `TICKETS.md` et proposer le merge de la
branche `T130` vers `main`.
