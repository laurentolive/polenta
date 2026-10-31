# GH200 — Sprint 2 : renderer (porte, verrou, préférence)

## Fichiers modifiés

- `renderer/contexts/ApprovalGateContext.tsx` : porte unique `useModificationGate()` —
  `status` (approbation §8bis, puis réouverture / passage terminal GH200) et `create` ; notice
  « Ajouté à … » (assignation automatique) ; création en lot (P2) : un changeset choisi est repris
  sans question pour les créations du même repo dans les 3 s.
- `renderer/components/changes/AssignToChangeDialog.tsx` : modes `create` / `reopen` (choix seul,
  l'écriture de l'élément reçoit `changesetId`).
- `components/layout/AppLayout.tsx` : le provider de la porte englobe `SystemViewProvider`.
- Points d'appel : `SystemView` (statut, réouverture Word, création inline / à la saisie),
  `SystemViewContext.createItemObject` (Annuler retire le nœud inséré), `SearchEditPane`,
  `req.$reqId`, `test.$testId`, `req.new`, `test.new`.
- Verrou : `ExcelView` (cellules, renommage, étapes ; colonne Statut éditable), `EditView`
  (bandeau, champs hors statut en lecture seule), tableau des étapes de l'onglet Édition, pages de
  détail (bandeau, champs en lecture seule ; test : déverrouillé quand le statut du formulaire
  quitte l'approbation).
- `routes/preferences.tsx` : case `changeTracking` (écrit `off` seulement).
- Main : `ChangeTrackingService.check` lit le statut courant pour un changement de statut
  (`toStatus`) ; le verrou compare les **valeurs** du contenu (un formulaire qui renvoie tout le
  contenu inchangé passe).
- i18n fr / en : `changes.modify.*`, `system.editView.approvedLocked`, `preferences.changeTracking*`.

## Divergences avec le design

- Pas de bouton « Rouvrir en brouillon » ajouté hors vue Word : la colonne / le champ Statut, qui
  restent éditables, font la réouverture partout (passent par la porte).
- Le toast d'assignation automatique est une notice du provider de la porte (pas de système de
  toast existant).

## Tests

- E2E `e2e-web/gh200-assign.spec.ts` : A1 (verrou page + refus main), A4/A10 (dialogue, Annuler,
  choix, base), A3/A6 (assignation automatique signalée, déjà assigné), A14 (préférence).
- GH199 e2e (backlog, analyse) : inchangés et verts.
- Unitaires : suites complètes vertes.

## Comment tester manuellement

1. Modèle de données : ajouter un type de catégorie changeset ; créer deux changesets ouverts.
2. Approuver une exigence, puis la rouvrir (vue Word ou colonne Statut) : dialogue « Dans quel
   changeset ? » ; Annuler la laisse approuvée.
3. Clore un des deux changesets, rouvrir une autre exigence : notice « Ajouté à … ».
4. Vue Excel / onglet Édition sur une exigence approuvée : cellules et champs verrouillés.
5. Préférences : décocher « Toute modification passe par un changeset » → plus de dialogue.
