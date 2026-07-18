# T101 — Sprint 1 : cœur de la fonctionnalité onglets

## Fichiers modifiés

- `apps/desktop/src/main/menu.ts` — retrait de l'accélérateur `CmdOrCtrl+W` sur "Fermer le
  projet" (le menu reste cliquable, sans raccourci clavier dédié).
- `apps/desktop/src/renderer/components/layout/AppLayout.tsx` — `deducePanel` et une nouvelle
  fonction `deriveCurrentProjectId` sont exportées pour être réutilisées par `TabsContext.tsx` ;
  le conteneur racine passe de `h-screen` à `h-full` (c'est désormais `AppChrome`, dans
  `__root.tsx`, qui possède le `h-screen`).
- `apps/desktop/src/renderer/routes/__root.tsx` — nouveau composant local `AppChrome`
  (`TabBar` + `AppLayout` dans un conteneur `flex-col h-screen`), monté dans un nouveau
  `<TabsProvider>` à la place du rendu direct de `<AppLayout/>`.

## Fichiers créés

- `apps/desktop/src/renderer/contexts/TabsContext.tsx` — modèle d'onglet (`Tab`), `TabsProvider`,
  `useTabs()`. Un onglet = une URL complète (pathname + search params). L'onglet actif suit la
  navigation normale de l'app ; changer d'onglet fait un `navigate()` vers l'URL mémorisée.
- `apps/desktop/src/renderer/components/layout/TabBar.tsx` — barre horizontale (croix par
  onglet, bouton "+", bouton flèche vers le bas).
- `apps/desktop/src/renderer/components/layout/TabListMenu.tsx` — popover listant tous les
  onglets ouverts + section "Récemment fermés", avec filtre texte.
- `apps/desktop/src/renderer/hooks/useTabShortcuts.ts` — Ctrl+T (nouvel onglet) / Ctrl+W
  (fermer l'onglet actif), raccourcis globaux à la fenêtre.

## Comportement implémenté

Périmètre sprint 1 complet selon `specs/T101-design.md` §2 : ouverture/fermeture/activation
d'onglet, bouton "+", menu déroulant avec filtre et onglets récemment fermés (limite 10, en
mémoire), Ctrl+T/Ctrl+W, dernier onglet toujours présent (son contenu est réinitialisé sur la
page d'accueil plutôt que l'onglet supprimé), reset des onglets à la fermeture/changement de
projet, scoping par fenêtre (gratuit, un `TabsProvider` par `BrowserWindow`), titres par défaut
(table statique par route + repli sur le libellé de panneau).

## Divergences par rapport au design — corrections issues de `/code-review high`

Le design (`T101-design.md`) a été suivi tel quel pour la structure ; la revue de code (8 angles,
findings vérifiés un par un) a fait remonter deux défauts de comportement corrigés avant
commit, plus deux petits ajustements de qualité :

1. **Reset d'onglets trop agressif (bug corrigé).** L'effet de reset (`TabsContext.tsx`)
   déclenchait sur *tout* changement de `currentProjectId`, y compris un simple passage
   transitoire par une route qui ne porte jamais `projectId` dans son URL (ex. `/workspace`,
   page de redirection pour les anciens liens `?dir=...` — voir son propre commentaire "Legacy
   route"). Conséquence vérifiée : cliquer "Structure" depuis `/compliance` sur un lien
   pré-T70 (sans `repoPath`) traverse `/workspace` avant de retomber sur `/schema`, et ce
   passage transitoire remettait à zéro tous les onglets ouverts + l'historique "récemment
   fermés", sans qu'aucun projet n'ait réellement été fermé. Correctif : le reset ne se
   déclenche plus que sur un changement réel — nouveau `projectId` non nul différent du
   dernier connu (vrai changement de projet), ou retour sur `/` avec `projectId` nul (seule
   route d'atterrissage "aucun projet" non ambiguë). `AppLayout.tsx`/`TabsContext.tsx`
   dérivent maintenant `currentProjectId` via la même fonction partagée
   (`deriveCurrentProjectId`, exportée d'`AppLayout.tsx`) pour éviter que les deux calculs
   divergent un jour.
2. **Fermeture du dernier onglet non récupérable (bug corrigé).** Fermer le dernier onglet
   réinitialisait son contenu sur la page d'accueil sans jamais pousser l'ancien contenu dans
   "Récemment fermés" — contrairement à la fermeture de n'importe quel autre onglet. Vérifié
   manuellement après correction : fermer successivement 3 onglets (y compris le dernier) fait
   apparaître les 3 dans le menu "Récemment fermés", tous réouvrables.
3. Petite simplification : les 5 endroits qui appelaient `navigate({ to: tab.pathname as
   never, search: tab.searchParams as never })` utilisent désormais un helper interne `goTo`.
4. Trouvé/évalué mais **non corrigé**, jugé hors périmètre proportionné pour ce sprint : le
   flag de "modification en cours" est explicitement prévu au sprint 2 (`useRegisterTabDirty`,
   filet de sécurité focus/blur) — jusque-là, Ctrl+W ferme/réinitialise un onglet sans avertir
   même en cas d'édition non enregistrée, comportement attendu et déjà documenté comme tel
   dans `T101-design.md` §3. La remontée en doublon lors de la revue ("pas de garde tant que
   le sprint 2 n'est pas là") ne change pas le séquencement déjà validé avec l'utilisateur.
   Autre point relevé et volontairement non traité : Ctrl+W ne fait plus rien sur `/login`
   (l'ancien accélérateur Electron fonctionnait globalement, le nouveau raccourci renderer
   n'est monté que sur les routes non "bare") — impact nul en pratique (aucun état à fermer
   sur l'écran de connexion), corrigible plus tard si besoin.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev`, ouvrir un projet.
2. Vérifier la barre d'onglets au-dessus d'ActivityBar/Sidebar/main frame.
3. "+" / Ctrl+T : nouvel onglet sur la page d'accueil (Modèle de données si projet chargé).
4. Naviguer dans un onglet (cliquer une exigence, changer de panneau) : un seul onglet dans la
   barre, son titre suit la navigation.
5. Ouvrir 2-3 onglets sur des vues différentes, cliquer entre eux : chaque onglet restitue son
   URL exacte et le panneau ActivityBar associé.
6. Croix / Ctrl+W sur l'onglet actif : ferme et active un onglet voisin.
7. Fermer tous les onglets jusqu'au dernier : il ne disparaît jamais, son contenu retombe sur
   la page d'accueil, et il apparaît dans "Récemment fermés" (bouton flèche vers le bas).
8. Menu déroulant : filtre texte, réouverture d'un onglet "Récemment fermés".
9. Ctrl+W ne déclenche plus "Fermer le projet" (le projet reste chargé, sidebar inchangée).
10. `tsc --noEmit` : 0 erreur. `/code-review high` : 8 angles, 2 bugs corrigés (ci-dessus),
    1 simplification appliquée, reste noté ci-dessus comme accepté/différé.

Voir `specs/T101-tests.md` pour les scénarios détaillés N1-N10, L1-L3, L6 (couverts par ce
sprint) ; N11-N14, L4-L5 dépendent du sprint 2 (dirty state).
