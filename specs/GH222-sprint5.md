# GH222 — Sprint 5 : édition depuis la vue de diff (spec §12, ex-#232)

Spec : `specs/GH222.md` §12 · Design : `specs/GH222-design.md` §9. Décisions du 2026-10-29 :
enregistrement explicite, exigence / test par le service de l'objet, ajout aussi en Rendu.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `main/services/diff-edit.service.ts` | **nouveau** — `saveWorkingFile` : garde de chemin (y compris lien symbolique), fichiers maintenus par l'app refusés, contenu du disque comparé au texte de départ (BOM ignoré), exigence / test par `requirements.update` + `transition` / `tests.update` (seulement pour `requirements/<id>.yaml` / `tests/<id>.yaml`), campagne refusée, autre fichier écrit tel quel |
| `main/ipc/index.ts`, `main/container.ts`, `web-server/channel-policy.ts` | canal `diff:save-working-file` (écriture du graphe Suivi, liste blanche web, texte et texte de départ déclarés comme contenu) |
| `packages/types/src/merge-resolution.ts`, `packages/api-client` | `DiffSaveResult`, `isAppMaintainedFile`, `api.diffEdit.saveWorkingFile` |
| `renderer/components/diff/FileDiffView.tsx` | brouillon du côté Après (avec son texte de départ), barre « Modifiable — working tree », « Enregistrer » / `Ctrl+S`, onglet marqué modifié, erreurs, « Recharger » |
| `renderer/components/diff/RawDiffView.tsx` | côté Après éditable, « ← Rétablir » entre les colonnes (côte à côte) ou par bloc (en ligne) |
| `renderer/components/treediff/TreeDiffView.tsx`, `draftEdit.ts` | **nouveau** `draftEdit.ts` ; vue générique éditable : valeurs, « ← Rétablir » par rangée, « + Ajouter » (liste, mapping) |
| `renderer/index.css`, `i18n` | bouton « Rétablir » ; libellés |
| tests | `diff-edit.gh222.test.ts` (8), `draftEdit.test.ts` (3), `e2e-web/gh222-diff-edit.spec.ts` |

## Comportement implémenté

Voir spec §12. Un diff entre commits, un fichier supprimé, un fichier maintenu par l'app (`.git/`,
schéma, arbres, pierres tombales, `.gitmodules`) ne sont pas modifiables. L'édition en Rendu n'est
proposée que pour un YAML écrit comme l'app l'écrit (une réécriture ne doit pas effacer de
commentaire) ; le Raw reste éditable.

## Divergences par rapport au design

- Fichiers maintenus par l'app et campagnes : refusés (le design prévoyait une écriture brute) —
  revue de code : `schema:save` régénère `.gitmodules`, une campagne garde son `history` (GH77).
- Une exigence / un test hors de `requirements/<id>.yaml` / `tests/<id>.yaml` : refusé (le service
  écrit toujours ce fichier-là).
- Clés qu'un service ne sait pas écrire ou retirer (`projectId`, `branchId`, `jiraLinks`, retrait des
  étapes d'un test…) : refus explicite avec la liste des clés, plutôt qu'un enregistrement partiel.

## Revue de code

`/code-review` (medium) : 10 constats, corrigés — brouillon réinjecté après un enregistrement,
texte pris pour un chemin par la garde du client web, BOM, fichier écrit ailleurs par le service,
modifications acceptées sans être écrites, YAML cassé sur le disque impossible à réparer, fichiers
maintenus par l'app et liens symboliques, `Ctrl+S` déjà traité, ajout d'une clé annulé par
`Échap` puis ajouté au blur, rafraîchissement de toute l'app après un enregistrement.

Le build web a d'abord échoué sur un `@apply bg-surface-hover` (classe absente du thème : `bg-hover`).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TECH-stack.md` §6.6 | édition depuis le diff (service, canal, garde, règles) |
| `SPEC-ELECTRON-DESKTOP.md` §19.8b | vues de diff : modification locale éditable |
| `SPEC-INDEX.md` | mots-clés |

## Comment tester manuellement

1. Modifier un fichier YAML suivi, l'ouvrir depuis la section Modifications du panneau Version :
   barre « Modifiable — working tree ». Raw : « ← Rétablir » sur un bloc, saisie, `Ctrl+S`.
2. Rendu : changer une valeur, « + Ajouter » sous une liste, « ← Rétablir » sur une rangée,
   « Enregistrer » ; le panneau Version se met à jour.
3. Une exigence modifiée localement : changer son titre ou un champ depuis le diff, enregistrer —
   l'éditeur de l'exigence montre la modification.
4. Le diff d'un commit (vue graphe) n'a pas de barre d'édition.
