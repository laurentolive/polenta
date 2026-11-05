# GH206 — Sprint 2 : écrans des contraintes de transition

## Fichiers modifiés

- Nouveaux :
  - `components/schema/TransitionRulesEditor.tsx` : section « Contraintes de transition » de l'éditeur de type ;
  - `components/transitions/TransitionStatusOptions.tsx` : options de statut annotées ;
  - `components/transitions/TransitionNoticeHost.tsx` : notifications, en bas à droite ;
  - `hooks/useTransitionPreview.ts` : contexte `TransitionScopeContext` et pré-contrôle ;
  - `lib/transitionNotices.ts` : émission des notifications, lecture d'un refus `TRANSITION_BLOCKED`.
- Éditeur de schéma : `objectTypeEditor.tsx` (`transitions` dans l'état éditable, `TYPE_EDITOR_KEYS`, renommage des statuts via `withRenamedRequiredWhen`), `ElementConfigModal.tsx`.
- Menus de statut :
  - `ExcelView.tsx` (cellule statut) ;
  - `WordView.tsx` (badge de statut, pré-contrôle chargé au focus) ;
  - `EditView.tsx` (champ statut) ;
  - `routes/test.$testId.tsx` (sélecteur de statut) ;
  - `routes/req.$reqId.tsx` (bouton du statut suivant désactivé avec son motif, ⚠ si notifié).
- Écritures :
  - `SystemView.tsx` : contexte, `workspaceDir` dans les trois appels de statut, notification, refus avec annulation de la saisie optimiste ;
  - `SearchEditPane.tsx` : mêmes points ;
  - `req.$reqId.tsx`, `test.$testId.tsx`.
- `useLiveFileSync.ts` : pré-contrôles invalidés quand un schéma, un élément ou un lien change.
- `routes/__root.tsx` (zone de notification), `fr.json`, `en.json` (`transitions.*`).
- e2e : `e2e-web/gh206-transitions.spec.ts`.
- Specs : voir « Mises à jour SPEC ».

## Comportement implémenté

- **Éditeur** :
  - section affichée pour les types d'exigence, de test et d'issue ;
  - « + Ajouter une règle » vise le statut approuvé, avec la première condition en Notification ;
  - chaque condition se règle en trois positions : Aucun contrôle, Notification, Blocage ;
  - × retire une règle ;
  - erreurs et avertissement de réouverture (D5) s'affichent sous la table.
- **Menus de statut** :
  - option bloquée : désactivée, avec « bloqué : <motif> » dans le libellé et tous les motifs en infobulle ;
  - option notifiée : préfixe ⚠, motifs en infobulle ;
  - statut courant : jamais annoté.
- **Passage notifié** : notification non bloquante qui liste les motifs, fermée au bout de 10 s.
- **Refus** : notification d'erreur qui reste affichée. Dans les vues, la saisie optimiste est annulée et la cellule revient au statut réel.

## Divergences avec le design

- **Notifications** : l'appli n'avait pas de mécanisme de toast. `TransitionNoticeHost`, monté à la racine, en tient lieu ; il n'est pas réutilisé ailleurs.
- **Invalidation** : le pré-contrôle est aussi invalidé par `useLiveFileSync`, comme la matrice. Sans cela, un changement de règle laissait l'ancien résultat en cache ; l'e2e I4 l'a révélé.
- **Page d'issue** : il n'en existe pas. Les issues changent de statut par les vues du panneau Système, couvertes par `SystemView`.
- **e2e** : écrits sur le web plutôt que sur le desktop. Ils couvrent I1, I2, I3 et I4, avec le canal exposé.
  - I5 (refus serveur pendant une saisie optimiste) n'est pas automatisé : l'option bloquée ne peut pas être choisie dans l'interface. La logique d'annulation est à vérifier à la main.
  - Le renommage d'un statut cité (C3) est couvert par un test unitaire (E10), pas en e2e.

## Mises à jour SPEC

- **SPEC-REQ §4.3** : « Toutes les transitions sont autorisées » est remplacé par les contraintes facultatives (règles, niveaux, évaluation, schéma, écrans).
- **SPEC-TEMPLATES** :
  - §3.1 : nouvel attribut `transitions` ;
  - §3.3 : renvoi vers SPEC-REQ §4.3 ;
  - §3.4 : `regex:` désormais contrôlé par `validatorsPass`.
- **SPEC-MCP-SERVER §4.6** : contrôle avant écriture, `TRANSITION_BLOCKED`, `transitionWarnings`, import en masse, mutation de schéma.
- **SPEC-WEB §11** : contraintes de transition disponibles sur le web.
- **SPEC-INDEX** : colonne MAJ → GH206 pour SPEC-REQ §4, SPEC-TEMPLATES, SPEC-MCP-SERVER et SPEC-WEB ; mots-clés ajoutés à SPEC-REQ §4.

## Vérifications

- `pnpm typecheck` : OK.
- Tests unitaires desktop : 1385 OK.
- e2e web `gh206-transitions` : 3 réussis.
- e2e web voisins (`gh243`, `gh214`, `gh136`, `gh195`) : 12 réussis.
- Suite e2e complète : non lancée (au merge sur `main`).
- Constaté en route : `pnpm -s build:web` n'avait pas reconstruit `out/web-server/index.cjs`. `pnpm run build:web-server` lancé seul l'a fait.

## Comment tester manuellement

1. **Créer une règle** : dans l'onglet Structure, ouvrir un type d'exigence. Dans « Contraintes de transition », ajouter une règle vers Approuvé et mettre « Couverte par un test » sur Blocage. Enregistrer.
2. **Blocage** : prendre une exigence sans test lié.
   - Vue Tableau : la cellule statut affiche « Approuvé — bloqué : Aucun test ne couvre … », désactivé.
   - Vue Document et page de l'exigence : même motif.
3. **Notification** : passer la condition en Notification et choisir Approuvé. Le statut change, et une notification liste le motif.
4. **Levée du blocage** : lier un test à l'exigence, depuis le test ou depuis l'exigence. L'option redevient normale.
5. **Réouverture** : dans l'éditeur, une règle en Blocage vers Brouillon affiche l'avertissement de réouverture.
6. **Refus pendant une saisie** (I5) : ouvrir une même exigence dans deux onglets. Dans le premier, garder ouvert le menu de statut d'une option encore permise. Dans le second, retirer le lien de test. Choisir alors Approuvé dans le premier onglet : refus notifié, et la cellule revient au statut réel.
