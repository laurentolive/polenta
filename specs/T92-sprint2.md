# T92 — Sprint 2 : rollout mécanique de `ViewHeader`

## Fichiers modifiés

17 routes migrées vers `ViewHeader`, suivant le pattern validé au Sprint 1 : `requirements.tsx`,
`tests.tsx`, `dashboard.tsx`, `query.tsx`, `schema.tsx`, `baseline.tsx`, `req.$reqId.tsx`,
`req.new.tsx`, `test.$testId.tsx`, `test.new.tsx`, `campaign.$campaignId.tsx`, `campaign.new.tsx`,
`campaign.$campaignId.execute.$testId.tsx`, `campaign.$campaignId.run.$testId.tsx`,
`compliance.tsx`, `diff.tsx`, `account.tsx`. `RichTextToolbar` déplacée dans le slot `actions`
sur les 6 vues qui l'utilisaient (Système migré au Sprint 1, + les 5 ci-dessus : test détail/
nouveau, campagne détail/nouvelle, exécution de test).

## Divergence par rapport au design

- **`version-diff.tsx` non migrée**, contrairement à la liste de `T92-design.md` §2.7. En
  l'examinant, cette route n'a pas de barre de titre "premier niveau" séparée comme supposé dans
  le design — c'est un layout à deux colonnes (panneau `w-64` "Comparer" en `section-label`, déjà
  conforme à la convention **panneau latéral**, pas vue principale + zone de diff). Il n'y a rien
  d'équivalent à un `<h1>`/titre de vue à remplacer par `ViewHeader` sans casser la mise en page.
  Laissée inchangée — écart constaté et documenté ici plutôt que forcé.

## Comportement implémenté

Conforme à `specs/T92-design.md` §2.7 pour les 16 vues effectivement migrées (17 fichiers,
`req.$reqId`/`req.new` et `test.$testId`/`test.new` comptés séparément). Aucune action existante
(Enregistrer, Ajouter un widget, bascule Privé/Partagé, statut, undo/redo, retour…) n'a changé de
comportement — seuls le conteneur d'en-tête et la taille du titre changent, suivant le pattern
`ViewHeader` (`back`/`title`/`subtitle`/`actions`).

## Bug trouvé et corrigé pendant la review

`routes/campaign.$campaignId.tsx` — une édition mal formée avait dupliqué la ligne
`{typeDef && typeDef.fields.length > 0 && (` (le remplacement avait réintroduit la condition
existante en plus de la nouvelle). Repéré en relisant le diff avant le typecheck ; corrigé (une
seule occurrence de la condition, wrapper `<div className="mt-4">` correctement refermé en fin de
composant).

## Vérifications effectuées

- `turbo typecheck --filter=@polenta/desktop` : 0 erreur (validé après le sprint complet, y
  compris après correction du bug ci-dessus).
- Revue de code manuelle : diff scan ligne à ligne sur les 18 fichiers, vérification des imports
  d'icônes désormais inutilisés (`ChevronLeft` dans `baseline.tsx` et
  `campaign.$campaignId.run.$testId.tsx`, `ArrowLeft` dans
  `campaign.$campaignId.execute.$testId.tsx`) — tous retirés. Vérification de l'équilibrage JSX
  (confirmé aussi par le typecheck, qui échouerait sur un JSX mal formé).

## Comment tester manuellement

1. Parcourir chacune des 16 vues migrées avec un projet ouvert — vérifier une barre de titre de
   même taille/padding partout, aucune action perdue (Enregistrer sur Schéma, Ajouter un widget
   sur Suivi, retour sur Baselines/Exécution de test/Conformité/Diff, statut+richtext sur
   Test/Campagne).
2. Vérifier que le bouton Publier apparaît de façon cohérente sur les vues où un projet est ouvert
   (pas seulement Système/Version).
3. Vérifier `/account` (panneau Compte, pas de `projectId`) : barre de titre présente, pas de
   bouton Publier, pas d'espace vide anormal.
4. Vérifier `/version-diff` : inchangée, panneau "Comparer" toujours en l'état.
