# GH343 — Sprint 1 : deux projets différents dans deux fenêtres

Spec : `specs/GH343.md` §2–§3 (D3, D4). Design : `specs/GH343-design.md` §Sprint 1.

## Comportement implémenté

- **Saut vers le dernier projet au lancement seulement** (`renderer/lib/startupJump.ts`) : le main
  passe `__jump=1` à la fenêtre de lancement (fenêtre par défaut d'un premier lancement, première
  fenêtre rouverte) ; web : premier chargement de `/` sauf `?__home=1`. L'accueil (`routes/index.tsx`)
  ne saute que si la fenêtre y a droit, une fois. Une fenêtre qui revient à l'accueil en cours de
  session (fermeture du projet, nouvelle fenêtre, Ctrl+T sans projet) y reste.
- **Fenêtre à l'accueil rouverte à l'accueil** : `/` est une route mémorisée (`isRestorableRoute`).
- **Fenêtre vide** : bouton « Nouvelle fenêtre » (icône) dans l'en-tête du panneau Projet, avec ou
  sans projet ; Ctrl+Shift+N depuis l'accueil ouvre `/` sans saut. Web : nouvel onglet `/?__home=1`.
- **Projet récent dans une nouvelle fenêtre** : clic droit sur un récent du panneau Projet →
  « Ouvrir dans une nouvelle fenêtre ».
- **Fermer le projet** : n'efface le dernier projet ouvert que s'il désigne ce projet et qu'aucune
  autre fenêtre ne l'affiche (`app:project-shown-elsewhere`, `workspace:clear-last-opened(dir)`).
- **Compte de la forge du projet** (`auth:current-account(remoteUrl)`, `useCurrentAccount`) : panneau
  et menu Compte d'une fenêtre sur un projet = compte connecté de l'hôte d'`origin`, sinon compte
  par défaut ; « Se déconnecter » déconnecte ce compte (`auth:logout(key)` ; clé déjà déconnectée →
  rien, jamais un autre compte).
- **`repo:file-changed` filtré** (`useLiveFileSync`, `lib/pathScope.ts`) : une fenêtre sur un projet
  ignore les changements des repos situés hors du dossier de son workspace.
- **Correctif découvert en test** : `/schema` et `/preferences` re-marquaient le projet comme dernier
  ouvert à chaque montage — y compris au remontage parasite du routeur au moment de « Fermer le
  projet » : le projet fermé redevenait le dernier ouvert (relance → retour dans ce projet). Marquage
  désormais une fois par projet et par fenêtre (`lib/recentProject.ts`), réarmé quand l'accueil est
  atteint.

## Fichiers modifiés

Main : `host/app-windows.ts` (option `jump`, `projectShownElsewhere`), `host/window-placement.ts`
(+ test), `ipc/channels.ts`, `ipc/desktop-only.handlers.ts`, `ipc/index.ts`,
`services/auth.service.ts` (+ test), `services/workspace.service.ts` (+ test
`workspace.last-opened.gh343.test.ts`), `web-server/channel-policy.ts` (`ROOT_ARGS`).
API : `packages/api-client/src/{types,ipc-client}.ts`.
Renderer : `main.tsx`, `routes/index.tsx`, `routes/schema.tsx`, `routes/preferences.tsx`,
`components/sidebar/ProjectPanel.tsx`, `hooks/useCurrentAccount.ts`, `hooks/useLiveFileSync.ts`,
`lib/startupJump.ts` (+ test), `lib/pathScope.ts` (+ test), `lib/recentProject.ts`,
`web/bridge.ts`, i18n fr/en.
e2e : `e2e-desktop/gh343-projects.spec.ts` (T8–T16, T19 affichage), `e2e-web/gh343-projects.spec.ts`
(T17, T18).

## Divergences par rapport au design

- Les projets récents ne sont listés que dans le panneau Projet (l'accueil n'en a pas) ; « Ouvrir
  dans une nouvelle fenêtre » y ouvre `/schema`, comme le clic sur le récent (pas de
  `projectLandingHref` / page d'équipe : même destination que le clic).
- Filtre `repo:file-changed` : préfixe du dossier du workspace seulement — les repos d'un projet sont
  toujours clonés à plat dedans (`localParent` est un rangement logique), la liste de l'arbre est
  inutile.
- Restauration : seule la **première** fenêtre rouverte peut sauter (spec §3 mise à jour au design).

## Revue de code (PR #382) — suites données

Corrigés : déconnexion d'un compte déjà retiré (ne déconnecte plus un autre compte), compte remis à
zéro au changement de projet (pas de déconnexion du compte du projet précédent), `decodeProjectId`
protégé à la fermeture, marquage réarmé après fermeture, `deriveCurrentProjectId` réutilisé.
Laissés, assumés :
- projet dont la forge n'a pas de compte connecté : la fenêtre affiche le compte par défaut, comme
  avant GH343 (spec D4 « comme aujourd'hui ») ;
- page `/account` (sans `projectId` dans l'URL) : compte par défaut ; le panneau Compte, lui, suit le
  projet ;
- « Fermer le projet » juste après qu'une autre fenêtre a ouvert ce projet (route remontée au main
  après 300 ms) : le pointeur peut être effacé — sans effet sur l'affichage des fenêtres ;
- filtrage côté renderer plutôt que diffusion ciblée par le main : suffisant, sans changer le
  contrat de `platform.broadcast` (partagé avec le serveur web).

## Vérifications

- `pnpm typecheck`, `pnpm lint` : OK.
- Unitaires : `pnpm test` — 1 échec lié (ROOT_ARGS, corrigé) ; un second échec au premier passage non
  reproduit ensuite (instable, sans rapport).
- e2e desktop `-g "GH343|GH342"` : 20/20 (GH342 compris) ; GH343 relancé après la revue : 8/8.
- e2e web `gh343-`, `gh342-`, `gh338-` : 15/15 (ports décalés 8936–8939, ceux par défaut étant pris
  par un autre worktree).

## Comment tester manuellement

1. Deux projets sur deux forges différentes, un compte connecté sur chacune ; ouvrir A, panneau
   Projet → icône « Nouvelle fenêtre » → la fenêtre reste sur l'accueil ; y ouvrir B (récents).
2. Panneau Compte de chaque fenêtre : compte de sa forge. Publier / tirer dans les deux (T19).
3. Fermer le projet dans une fenêtre : l'autre ne bouge pas.
4. Quitter avec A, B et une fenêtre à l'accueil ; relancer : chacune à sa place, l'accueil reste
   l'accueil.
