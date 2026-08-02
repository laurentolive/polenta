# T116 — Scénarios de test

Réf : `specs/T116.md`, `specs/T116-design.md`

## Scénarios nominaux (golden path)

1. **Bascule de thème sur un écran migré** — Ouvrir `requirements.tsx` (liste des exigences) en thème clair. Basculer vers le thème sombre via le sélecteur de thème (`ThemeContext`/`toggle`). Vérifier que tous les badges de statut (draft/review/approved/obsolete) changent de palette et restent lisibles (contraste suffisant), sans zone bloquée sur l'ancienne palette.
2. **Génération des tokens** — Modifier une valeur dans `theme.config.ts` (ex. `status-danger-solid`), exécuter `pnpm theme:generate` (ou équivalent défini en sprint 1), vérifier que `index.css` reflète la nouvelle valeur dans le bloc généré (`:root`/`.dark`) et que l'app rebuildée affiche la couleur mise à jour sur un bouton "supprimer".
3. **ActivityBar figée** — Basculer clair ↔ sombre : l'ActivityBar reste visuellement identique (fond `slate-900`/token `activity-bg`) dans les deux thèmes.
4. **Vue d'impression figée** — Ouvrir une route `print.requirements.tsx` en thème sombre : le rendu reste en fond blanc/texte foncé (tokens `print-*`), indépendamment du thème actif de l'app.
5. **Cohérence inter-écrans** — Comparer un badge "approved" dans `requirements.tsx`, `req.$reqId.tsx`, `RequirementEditModal.tsx` : même token `status-success-*`, donc même rendu pixel-identique dans les deux thèmes (avant T116, ces 3 fichiers avaient des nuances légèrement différentes).

## Cas limites

- **Token manquant** — Un développeur utilise par erreur `bg-status-info-bg` sans que `status-info-bg` existe dans `theme.config.ts`/`tailwind.config.js` : la classe Tailwind doit soit ne pas être générée (build CSS sans effet visible, à détecter visuellement), soit provoquer une erreur de build si on type le mapping (`as const` + type strict côté `tailwind.config.js` si techniquement possible) — comportement à documenter en sprint 1.
- **Opacité sur token** — Utilisation de `bg-status-danger-bg/50` (modificateur d'opacité Tailwind sur une classe dérivée d'une variable CSS) : vérifier que Tailwind applique correctement l'opacité sur une couleur définie via `var(--token)` (nécessite le format `rgb(var(--token) / <alpha-value>)` plutôt que `var(--token)` brut pour que le modificateur `/50` fonctionne — point technique à valider en sprint 1, sinon les usages avec opacité actuels ex. `dark:bg-blue-900/5` ne pourront pas être reproduits via simple substitution de classe).
- **Statuts fusionnés (SKIP/BLOCKED)** — Une campagne ayant des tests en état `SKIP` et d'autres en état `BLOCKED` : les deux badges doivent maintenant utiliser la même couleur `status-warning` (harmonisation décidée) — vérifier que le libellé textuel du badge reste distinct (SKIP vs BLOCKED) même si la couleur est désormais identique, pour ne pas perdre l'information.
- **Contraste du token warning** — Bouton solide utilisant `status-warning-solid` (`#d97706`) + `status-warning-fg` (blanc) : vérifier le ratio de contraste WCAG AA (≥ 4.5:1 pour texte normal) ; si insuffisant, ajuster `status-warning-solid` vers une teinte plus foncée (`amber-700` `#b45309`) plutôt que de garder le blanc en `status-warning-fg`.
- **Composant hors périmètre** — `drawio-viewer.min.js` (bibliothèque tierce, contient des couleurs Tailwind brutes dans du code vendorisé) : confirmer qu'il est bien exclu du grep de conformité et qu'aucune régression n'est attendue dessus.
- **Fichier non prévu dans l'audit** — Si un fichier `.tsx` créé après l'audit (par un autre ticket en parallèle, ex. T111/T115/T123) introduit une nouvelle couleur Tailwind brute avant la fin du sprint 4 : le grep de conformité du dernier sprint doit le détecter (le grep porte sur l'état du code au moment du sprint 4, pas sur la liste figée de l'audit).

## Critères d'acceptation vérifiables (repris/détaillés de `T116.md`)

- [ ] `theme.config.ts` existe et est la seule source de valeurs hex/rgba pour les tokens de thème (aucune valeur couleur dupliquée en dur ailleurs, hors le bloc généré de `index.css`).
- [ ] `pnpm --filter @polenta/desktop theme:generate` régénère `index.css` sans diff si `theme.config.ts` est inchangé (idempotence du générateur).
- [ ] Grep de conformité (regex `T116.md` critère 2) : zéro résultat sur `apps/desktop/src/renderer/**/*.tsx` à l'issue du sprint 4.
- [ ] `ActivityBar.tsx` : zéro classe Tailwind brute (vérifiable par le même grep, restreint à ce fichier, dès la fin du sprint 1).
- [ ] Tous les badges de statut d'un même sentiment (draft/planned/pending, review/blocked/skip, approved/passed/completed, obsolete/failed/abandoned) partagent visuellement la même couleur de base à l'issue du sprint 2, vérifiable à l'œil sur les écrans `requirements.tsx`/`tests.tsx`/`CampaignListView.tsx` côte à côte.
- [ ] `pnpm typecheck` (apps/desktop) : zéro nouvelle erreur après chaque sprint.
- [ ] `/code-review` exécuté et corrigé à zéro problème bloquant après chaque sprint (règle standard `WORKFLOW.md`).

## Comment tester manuellement (à détailler par sprint dans `T116-sprintK.md`)

- Lancer l'app desktop (`pnpm --filter @polenta/desktop dev`), naviguer sur les écrans migrés du sprint en cours, basculer le thème via le bouton dédié, comparer visuellement avant/après sur une capture d'écran claire et une sombre.
- Pour le sprint 1 spécifiquement : vérifier `ActivityBar` et au moins 2 routes `print.*` en export réel (bouton "Exporter PDF"/"Imprimer") pour confirmer que le rendu imprimé n'est pas affecté par le thème actif de l'app au moment de l'export.
