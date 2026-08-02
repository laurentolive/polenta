# T111 — Sprint 1 : infrastructure i18n + coquille applicative

## Fichiers créés

- `apps/desktop/src/renderer/i18n/index.ts` — init `i18next`/`react-i18next`, lit
  `localStorage:polenta:locale` (défaut `fr`).
- `apps/desktop/src/renderer/i18n/useLocale.ts` — hook `{ locale, setLocale }`.
- `apps/desktop/src/renderer/i18n/locales/fr.json` / `en.json` — dictionnaires (107 clés
  chacun, parité vérifiée par script).

## Fichiers modifiés

- `apps/desktop/package.json` (+ `react-i18next` `^17.0.10`, `i18next` `^26.3.6`), `pnpm-lock.yaml`
- `apps/desktop/src/renderer/main.tsx` (import `./i18n`)
- `components/layout/{ActivityBar,TabBar,TabListMenu,ConfirmCloseTabModal,ModificationControl,ViewHeader}.tsx`
- `components/sidebar/AccountPanel.tsx` (+ sélecteur de langue), `components/AccountMenu.tsx`
- `routes/{account,index,login,preferences,workspace}.tsx`
- `contexts/TabsContext.tsx` — **hors périmètre initial du design**, ajouté en cours de
  sprint (cf. Divergences ci-dessous)

## Comportement implémenté

- Sélecteur de langue dans le panneau Compte (`AccountPanel.tsx`), à côté du toggle thème :
  bascule FR ⇄ EN immédiate (pas de rechargement de fenêtre), persistée en `localStorage`.
- Défaut : français si aucun choix n'a jamais été fait.
- Tous les libellés statiques des fichiers listés ci-dessus (boutons, titres, messages
  d'état/erreur, placeholders) passent par `t()`. Convention de clés imbriquées par domaine
  (`common.*`, `layout.*`, `account.*`, `login.*`, `home.*`, `preferences.*`, `workspace.*`).
- Titres d'onglets (`TabBar`/`TabListMenu`, via `TabsContext.tsx`) traduits et **mis à jour
  en direct** sur l'onglet actif quand la langue change (pas seulement les nouveaux onglets).
- `<Trans>` utilisé une fois (`ModificationControl.tsx`, message "branche bloquée") pour
  préserver le style `font-mono` sur les valeurs interpolées — convention documentée dans
  `T111-design.md` pour les sprints suivants.
- Menu natif Electron non touché (hors scope, conforme à la spec).

## Divergences par rapport au design

- **`contexts/TabsContext.tsx` ajouté au périmètre du sprint**, alors que `T111-design.md`
  excluait `contexts/*.tsx` par défaut. Ce fichier construit lui-même les titres d'onglet par
  défaut (`PANEL_LABELS`/`TITLE_OVERRIDES`/`PREFIX_TITLES`, tous en français en dur), avec un
  commentaire affirmant qu'il "mirrors ActivityBar.tsx's PANELS labels" — trouvé lors du
  `/code-review` du sprint (angle cross-file tracer) : sans ce correctif, tout nouvel onglet
  ouvert après bascule vers l'anglais aurait affiché un titre français, alors même que
  `TabBar.tsx`/`TabListMenu.tsx` (qui affichent `tab.title`) étaient déjà dans le périmètre du
  sprint. Corrigé dans le sprint plutôt que reporté — la régression aurait été immédiatement
  visible dès la première utilisation du sélecteur de langue tout juste livré. `T111-design.md`
  a été mis à jour (§ Découpage en sprints, § Convention des clés) pour documenter
  l'exception et les deux patterns réutilisables qui en découlent (config module-scope
  stockant des clés plutôt que des littéraux ; `<Trans>` + composant custom pour du style
  inline sur une valeur interpolée).
- Clé `common.back` retirée du design initial : ajoutée par erreur en doublon de
  `layout.viewHeader.back` (même valeur), jamais référencée — trouvée et supprimée pendant le
  `/code-review` (angle reuse), confirmée par deux vérifications indépendantes.
- Aucune autre divergence de périmètre.

## Revue

`/code-review` (effort medium, 8 angles) exécuté sur le diff complet du sprint. 2 findings
CONFIRMED corrigés (TabsContext non migré, clé `common.back` morte), 2 findings PLAUSIBLE
(altitude — conventions non documentées) traités par ajout de documentation dans
`T111-design.md`, 2 findings PLAUSIBLE jugés non actionnables après examen (duplication
"Compte"/"Préférences" entre panneaux légitimement distincts ; indirection `patHelp` sur du
texte ne variant pas par langue) — laissés tels quels, jugement assumé.

`pnpm typecheck` propre après chaque correctif. Script de contrôle : parité des clés
fr.json/en.json (107/107, aucune divergence) et vérification qu'aucune clé n'est orpheline
(non référencée) ni manquante (référencée mais absente du dictionnaire).

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev` (ou `pnpm build` + lancer l'exécutable packagé).
2. Ouvrir le panneau Compte (icône silhouette dans l'`ActivityBar`).
3. Cliquer le bouton "Langue" (à côté de "Thème") : l'UI entière bascule en anglais
   immédiatement — vérifié visuellement sur la page d'accueil (Ouvrir/Cloner/Créer un projet)
   et le panneau Compte lui-même. Le titre de l'onglet actif passe de "Accueil" à "Home".
4. Recliquer : retour immédiat au français, y compris le titre d'onglet.
5. Fermer et relancer l'app : la langue choisie doit persister (non re-testé
   automatiquement dans ce sprint — persistance `localStorage` déjà utilisée par
   `ThemeContext` sur le même mécanisme, cf. `useLocale.ts`).
