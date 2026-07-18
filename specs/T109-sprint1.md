# T109 — Sprint 1 (dernier sprint)

## Fichiers modifiés

- `apps/desktop/src/renderer/routes/dashboard.tsx` — logique de redirection vers le
  premier dashboard quand `dashboardId` est absent.
- `apps/desktop/src/renderer/components/sidebar/DashboardPanel.tsx` — correction
  d'une régression trouvée en revue (voir ci-dessous).
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` — extension
  demandée après retour utilisateur en validant le sprint (voir "Extension —
  icône Suivi" ci-dessous).

## Comportement implémenté

Sur `/dashboard?projectId=…` sans `dashboardId` :

- Si au moins un dashboard existe, redirection (`replace: true`) vers le premier
  dans l'ordre du panneau latéral (`orderItems(dashboards, dashboardsOrder)`,
  helper déjà partagé avec `DashboardGrid`/`ReorderableSidebarSection`).
- Si la liste est vide, message d'invite inchangé ("Sélectionnez un dashboard…
  ou créez-en un avec le bouton +").
- Le rendu ne montre jamais l'invite avant d'être certain que la liste est
  réellement vide (état "Chargement…" tant que les requêtes `dashboards`/
  `dashboards-order` n'ont pas résolu, y compris pendant la fenêtre où
  `repoPath` lui-même n'est pas encore connu).

## Divergences par rapport au design

Deux corrections par rapport au design initial (`T109-design.md`), trouvées par
`/code-review` (medium) avant merge — le design décrivait le mécanisme correct
mais deux détails d'implémentation auraient introduit des régressions réelles :

1. **Repli sur une valeur dérivée unique (`firstDashboardId`)** au lieu de
   dépendre de `dashboards`/`dashboardsOrder` (tableaux) dans l'effet de
   redirection. Le design initial utilisait les tableaux comme dépendances de
   `useEffect` ; comme `data: x = []` produit une nouvelle référence de tableau
   à chaque rendu tant que la donnée n'est pas résolue, l'effet aurait tourné à
   chaque rendu (ex. à chaque frappe dans le titre). Corrigé en dérivant un
   `string | undefined` unique (`firstDashboardId`), stable en référence, qui
   sert à la fois de dépendance d'effet et de condition de rendu — corrige
   aussi la duplication relevée par la revue (deux blocs "Chargement…"
   identiques, condition de chargement dupliquée).
2. **Garde `!repoPath`** ajoutée dans `resolvingFirstDashboard`. Sans elle,
   avant que la requête `workspace` (qui résout `repoPath`) n'ait terminé, les
   deux nouvelles requêtes `dashboards`/`dashboards-order` sont `enabled:
   false` — et en React Query v5, une requête désactivée rapporte
   `isLoading: false` (`isLoading = isPending && isFetching`), pas `true`. Sans
   ce garde, le message "Sélectionnez un dashboard…" pouvait s'afficher
   brièvement au démarrage même quand des dashboards existent, avant que
   `repoPath` ne soit connu — contraire au critère d'acceptation "pas de flash
   trompeur" de `T109-tests.md` scénario 8.
3. **Mise à jour synchrone du cache dans `DashboardPanel.tsx`**
   (`deleteDashboardMutation`) — pas dans le design initial. `invalidateQueries`
   seul ne fait que planifier un refetch asynchrone ; entre l'invalidation et sa
   résolution, `dashboard.tsx` (qui lit désormais ce même cache pour rediriger)
   pouvait lire la liste périmée — encore avec le dashboard qu'on venait de
   supprimer — et se rediriger dessus, aboutissant sur "Dashboard introuvable."
   au lieu du dashboard suivant réellement disponible. Corrigé par un
   `qc.setQueryData` synchrone (filtrant l'id supprimé) avant
   `invalidateQueries`, même pattern que celui déjà utilisé pour le changement
   de scope (`dashboard.tsx:104`, préexistant).

Les deux derniers points concernent une combinaison désormais possible entre
deux composants existants (le nouveau lecteur dans `dashboard.tsx` + la
mutation de suppression déjà présente) plutôt qu'un bug pré-existant.

## Extension — icône "Suivi" (retour utilisateur pendant la validation du sprint)

En validant le sprint, retour utilisateur : sortir du panneau "Suivi" (un
dashboard bien affiché) puis y revenir affichait la vue Requêtes vide dans le
contenu principal, avec l'onglet "Dashboards" sélectionné dans le panneau
latéral — incohérence pré-existante (`AppLayout.tsx`, `handleSelectPanel` case
`'dashboard'` navigue inconditionnellement vers `/query`), notée "hors scope"
dans `T109.md` initial, ré-ouverte sur demande explicite plutôt que de créer un
ticket séparé.

Correctif : nouveau `lastDashboardRoute` dans `AppLayout.tsx`, calqué sur le
`lastVersionRoute` déjà existant pour le panneau "Version" (même
`useEffect`/reset-au-changement-de-projet). Le clic sur l'icône "Suivi"
restaure désormais la dernière sous-vue quittée (`/dashboard?dashboardId=…` ou
`/query?queryId=…`) au lieu de toujours retomber sur `/query`. Sans sous-vue
connue, le nouveau défaut est `/dashboard` (bénéficie du redirect vers le
premier dashboard de ce même ticket) — plus jamais `/query` par défaut.

## Mises à jour SPEC

- `SPEC-ELECTRON-DESKTOP.md` §16.3 — ligne `/dashboard?projectId=…` : retrait de
  la mention "invite à en choisir un" (devenue inexacte), remplacée par la
  description du nouveau comportement.
- `SPEC-INDEX.md` — colonne MAJ de la ligne `SPEC-ELECTRON-DESKTOP.md §16` :
  `T108` → `T109`.

## Vérifications

- `pnpm --filter @polenta/desktop run typecheck` : 0 erreur.
- ESLint/Jest : binaires absents de `node_modules/.bin` dans cet environnement
  (même échec pré-existant sur `master`, sans rapport avec ce ticket) — pas de
  script de lint dédié à `@polenta/desktop` de toute façon.
- `/code-review` (medium, 8 angles) : 2 bugs réels confirmés et corrigés (voir
  "Divergences" ci-dessus), plus simplifications mineures (fusion des deux
  branches "Chargement…" identiques, condition de chargement dédupliquée).
- Vérification manuelle via le skill `run-desktop` sur un projet fixture réel
  (3 dashboards seedés) :
  - Démarrage avec projet connu → ouverture directe du premier dashboard
    ("Couverture"), sans clic (confirmé par capture d'écran + URL contenant
    `dashboardId=DASHBOARD-0001`).
  - Suppression du dashboard actif ("Couverture") avec 2 restants → bascule
    automatique sur le nouveau premier ("Avancement", `DASHBOARD-0002`) — pas
    de redirection vers l'id supprimé, pas d'erreur "introuvable".
  - Suppression de tous les dashboards restants → retour au message d'invite
    inchangé, sans boucle ni erreur.
- Vérification manuelle de l'extension "Suivi" (projet fixture à 3
  dashboards + requêtes sauvegardées) :
  - Clic sur "Suivi" en premier (aucune sous-vue connue) → ouvre directement le
    premier dashboard (bénéficie du fix ci-dessus), plus `/query` vide.
  - Sélection d'un dashboard non-premier ("Avancement"), navigation vers
    "Version", retour sur "Suivi" → "Avancement" restauré à l'identique
    (contenu + surbrillance panneau latéral), pas de retour au premier ni à
    `/query`.
  - Ouverture d'une requête sauvegardée, navigation vers "Version", retour sur
    "Suivi" → la même requête (`queryId` inchangé dans l'URL) est restaurée.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev`
2. Ouvrir un projet ayant au moins un dashboard, fermer l'app puis la
   relancer (ou simplement naviguer sur `/dashboard?projectId=…` sans
   `dashboardId`) → le premier dashboard du panneau latéral s'affiche
   directement.
3. Supprimer le dashboard affiché depuis le panneau latéral (icône corbeille au
   survol) → bascule automatique sur le dashboard suivant, s'il en reste.
4. Supprimer tous les dashboards → retour au message d'invite avec "Créer le
   premier".
5. Sélectionner un dashboard (ou une requête sauvegardée), naviguer vers un
   autre panneau (Système, Version…), puis recliquer sur "Suivi" → le même
   dashboard/requête réapparaît, jamais la vue Requêtes vide par défaut.
