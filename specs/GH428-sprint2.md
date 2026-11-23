# GH428 — Sprints 2 et 3 : interface, classeur, vérification

## Livré
- **Éditeur de schéma** : colonne « Campagne » (case « Renseigné en campagne ») sur la liste `runFields` seulement ; écrite seulement si vraie ; jamais sur `stepFields` ni sur les champs du test.
- **Grille des entrées de campagne** (`CampaignEntriesGrid.tsx`) :
  - une colonne `run:<nom>` par champ d'exécution des types de test de la campagne (union par nom) ;
  - champ « renseigné en campagne » : valeur saisie sur l'entrée, éditable (liste pour enum / booléen, texte sinon), via `onCellEdit` → `campaigns:update-run-inputs` ;
  - autre champ : valeur du dernier run de l'entrée, en lecture seule ; indication « dernier run : … » quand elle diffère de la saisie ;
  - colonnes visibles par défaut : champs saisis en campagne et champs `defaultVisible`.
- **Page d'exécution** : les champs « renseigné en campagne » sont prérenseignés depuis l'entrée et désactivés, avec le libellé « Renseigné en campagne ».
- **Classeur d'exécution** : une instance en attente exporte ses valeurs « renseigné en campagne » (`inputFields`) ; la valeur de l'entrée prime sur le dernier run pour ces champs ; un nombre est écrit comme nombre. Format inchangé.
- **Historique** : `useCampaignRunHistory` (un appel par type de test, comme la Vue Exécutions) ; `lastRunFieldsByEntry` prend le run le plus récent par entrée.

## Écart avec la spec
- Q6 (`defaultVisible`) : l'éditeur de schéma ne permet pas de cocher `defaultVisible` sur un champ d'exécution aujourd'hui (il est forcé à faux pour les listes d'exécution). Les colonnes visibles par défaut sont donc les champs saisis en campagne, plus ceux déclarés `defaultVisible` à la main dans le schéma.

## Vérification
- Unitaires : `run-inputs.gh428` (22), `campaignRunFields.gh428` (5), `objectTypeEditor.gh428` (4), `campaign-execution.gh428` (2). Passent.
- Suite complète `pnpm test` : desktop 2307 tests, admin-service 124, merge-core 83. Passent.
- `pnpm typecheck` : 4 paquets OK. Lint des fichiers modifiés : OK.
- E2E `gh428-run-inputs.spec.ts` : voir le compte rendu de validation du ticket.

## Environnement
- Le worktree a dû recevoir `apps/desktop/vendor/git` (Git embarqué, non versionné) depuis le dépôt principal : sans lui, les suites `git-backend.gh337` et `versions.gh201` échouent avec `GitUnavailableError`. Ce n'est pas un problème du ticket.
