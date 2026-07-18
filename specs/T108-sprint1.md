# T108 — Sprint 1 (dernier sprint)

## Fichiers modifiés

- `apps/desktop/src/renderer/components/sidebar/ProjectPanel.tsx` (`NoProjectPanel`) : suppression des 3 boutons redondants ("Ouvrir un projet existant", "Ouvrir depuis un repo existant", "Créer un nouveau projet") et du `useNavigate()` devenu inutile dans cette fonction. Le panel ne rend plus que le header "Projet" + la liste "Récents" (inchangée).
- `apps/desktop/src/renderer/routes/index.tsx` (`HomePage`) : suppression du bloc "Récents" (colonne gauche), de l'état `recents`/`setRecents`, de l'appel `api.workspace.listRecents()` dans `init()`, et de l'import `ProjectRecent`/`Link` devenus inutiles. Le layout passe systématiquement en colonne unique centrée (`max-w-lg mx-auto`) — la logique conditionnelle `grid-cols-2` a disparu avec la colonne. Les 3 formulaires (Ouvrir / Ouvrir depuis repo / Créer) et leur logique (`handleOpen`, `handleCreateFromClone`, `handleCreateNew`) sont inchangés.

## Comportement implémenté

Conforme à `specs/T108.md` — aucune divergence.

- Sidebar sans projet ouvert : "Projet" + "Récents" (masqué si vide) uniquement.
- Page `/` sans projet ouvert : uniquement les 3 formulaires, toujours en colonne unique centrée (avec ou sans projets récents par ailleurs).
- Le seul point d'entrée vers un projet récent reste la sidebar (`Link` vers `/schema`, comportement inchangé).

## Vérifications effectuées

- `tsc --noEmit` (apps/desktop) : aucune erreur.
- `/code-review medium` sur le diff (2 fichiers, changement purement soustractif/réindentation) : aucun finding.
- Test manuel via `run-desktop` (build de prod + driver Playwright, worktree `../polenta-T108`) :
  - Screenshot sidebar sans projet, avec un projet récent seedé dans `workspace.json` → confirme visuellement l'absence des 3 boutons, header "Projet" + "Récents" seuls.
  - Clic sur l'entrée "Récents" de la sidebar → navigation correcte vers `/schema` (`WithProjectPanel` affiché, "Modèle de données"/"Préférences" présents) : le flux existant n'est pas cassé.
  - Comparaison avec le code d'avant-sprint (via `git stash`) sur le même harnais : confirme qu'un glitch pré-existant et non lié à ce ticket ("Not Found" au tout premier rendu, avant toute navigation réelle — documenté dans `main.tsx` et dans `.claude/skills/run-desktop/SKILL.md`) se reproduit à l'identique avant et après le changement. Ce glitch n'est **pas** introduit par T108.

## Point d'attention (hors scope, signalé pour information)

Sur une installation neuve (aucun projet récent) qui rencontre ce glitch pré-existant au tout premier lancement, les 3 boutons supprimés fournissaient — incidemment — un moyen de déclencher une navigation réelle qui le contournait. Sans eux, et sans aucun projet récent à cliquer, la sidebar ne propose plus aucun élément cliquable dans cet état précis ; le menu natif "Fichier → Ouvrir un projet…" (Ctrl+O) reste cependant toujours disponible comme porte de sortie, lui aussi indépendant de la sidebar. Comme le glitch lui-même est pré-existant et hors du périmètre du ticket, aucune action n'est prise ici — signalé pour trace, à reprendre séparément si jugé utile.

## Comment tester manuellement

1. Lancer l'app (`pnpm --filter @polenta/desktop dev`), aucun projet ouvert.
2. Vérifier la sidebar : uniquement "Projet" en header, puis "Récents" si des projets ont déjà été ouverts — plus aucun bouton "Ouvrir…"/"Créer…".
3. Vérifier la page principale : les 3 formulaires ("Ouvrir un projet existant", "Ouvrir un projet depuis un repo existant", "Créer un nouveau projet"), toujours en colonne unique centrée, plus de bloc "Récents" à gauche.
4. Si des projets récents existent, cliquer une entrée dans la sidebar → doit ouvrir le projet normalement (`/schema`).
