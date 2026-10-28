# GH173 — Scénarios de test

Préparation commune (comme GH39) : un repo projet cloné depuis un bare local (`origin` = chemin
local), intégration `main`, et un second clone « collègue » du même bare pour faire avancer
`origin`. Tests unitaires sur de vrais repos git temporaires (modèle :
`integration-branch.service.test.ts`), nouveau fichier `sync.service.gh173.test.ts`.

## Unitaires — `SyncService` (sprint 1)

| # | Scénario | Attendu |
|---|---|---|
| U1 | Sur `main`, un fichier suivi modifié, `settleAutoBranch` | `switched`, branche courante `dev-auto`, fichier intact et toujours modifié, `main` au même SHA |
| U2 | Comme U1 avec un nouveau fichier non suivi seulement | `switched` |
| U3 | Sur `main`, repo propre | `none`, toujours sur `main` |
| U4 | Repo sans remote, modifié | `none`, toujours sur `main` |
| U5 | HEAD détaché, modifié | `none` |
| U6 | Sur `dev-perso` ou une `int-B` non désignée, modifié | `none` |
| U7 | `dev-auto` existe déjà (non fusionnée), sur `main` modifié | `switched` vers `dev-auto-2` |
| U8 | Sur `dev-auto` propre, aucun commit propre | `returned`, sur `main`, `dev-auto` supprimée |
| U9 | Sur `dev-auto` propre avec un commit absent de `main` | `none`, toujours sur `dev-auto` |
| U10 | Sur `dev-auto` modifié | `none` |
| U11 | Branche `dev-auto-3` non checkoutée, fusionnée dans `main` | supprimée ; `dev-auto-notes` (nom libre) jamais supprimée |
| U12 | `autoSync` : sur `main` modifié, collègue a poussé | bascule sur `dev-auto`, `main` = `origin/main`, aucun fichier du WD changé, état `up-to-date` |
| U13 | `autoSync` : sur `dev-auto` propre sans commit, collègue a poussé | retour sur `main`, `main` = `origin/main`, fichiers du collègue présents dans le WD |
| U14 | `autoSync` hors ligne (remote injoignable), `main` modifié | bascule faite, retour `offline` |
| U15 | `autoSync` : sur `dev-perso` (manuelle), collègue a poussé | `main` fast-forwardée, branche courante inchangée |
| U16 | `autoSync` : `main` divergée (commit local non poussé + collègue), sur `dev-auto` | `main` non modifiée, état `diverged` |
| U17 | `resyncIntegration` : sur `main` modifié, `behind` | bascule sur `dev-auto`, `main` fast-forwardée, pas d'erreur `integration-dirty`, WD intact |
| U18 | `resyncIntegration` : repo sans remote, modifié | inchangé (`up-to-date`) |
| U19 | `setAside` (GH39) après extraction de `nextFreeBranchName` | non-régression : `dev-resync`, puis `dev-resync-2` |
| U20 | `isAutoBranch` | vrai : `dev-auto`, `dev-auto-2`, `dev-auto-17` ; faux : `dev-auto-notes`, `dev-autonome`, `dev-auto-`, `main` |

## Nominaux — application (vérification manuelle)

| # | Scénario | Attendu |
|---|---|---|
| N1 | Modifier une exigence sur `main`, attendre un tick (intervalle réglé à 1 min) | panneau Version : branche `dev-auto`, modification toujours listée ; aucun message, aucun popup |
| N2 | N1, collègue publie, tick suivant | WD inchangé ; graphe : `main` au niveau d'`origin/main` |
| N3 | N2 puis « Publier » (fichiers différents) | pas d'avertissement ni de case (#133 si mergée) ; repo sur `main`, `dev-auto` absente, `origin/main` contient les deux modifications |
| N4 | N2 avec la même exigence modifiée des deux côtés, « Publier » | « Résoudre les conflits » ; après finalisation : sur `main`, `dev-auto` supprimée, push fait |
| N5 | N1 puis « Tout annuler » | immédiatement sur `main` (à jour si un tick l'a avancée), `dev-auto` supprimée |
| N6 | N1, annuler le seul fichier modifié (annulation unitaire), tick | retour sur `main`, `dev-auto` supprimée |
| N7 | Multi-repo : modifier racine et un composant, tick, « Publier » | une `dev-auto` par repo modifié, publication enfants puis parent, tous revenus sur leur intégration |
| N8 | N1 puis Resynchroniser (intégration `behind`) | réussite, plus de message « publiez-les ou annulez-les d'abord » |

## Cas limites

| # | Scénario | Attendu |
|---|---|---|
| L1 | Publication en conflit sur `dev-auto`, fermer puis relancer l'application sans résoudre | « Publier » actif (« commits mis de côté »), traité comme éphémère |
| L2 | Publier pendant qu'un tick tourne | aucune erreur ; état final sur `main`, `dev-auto` supprimée (design §4) |
| L3 | L'utilisateur checkoute `main` depuis `dev-auto` modifiée (sans conflit) | modifications suivent ; au tick, l'ancienne `dev-auto` (fusionnée) est supprimée puis nouvelle bascule sur `dev-auto` |
| L4 | Repo sans remote, modification | aucune bascule ; Publier inchangé |
| L5 | Modification d'un fichier ignoré (`.{user}.pref`, GH167) | aucune bascule |
| L6 | Client web (`SPEC-WEB`) : modification, tick | même comportement ; `sync:settle-auto-branch` accepté par la liste blanche |

## Non-régression

- GH39 : scénarios `specs/GH39-tests.md` N1–N7, L1–L9.
- T154/GH38 : Publier depuis `main` avant tout tick (cas nominal `dev-<slug>` inchangé), depuis une
  `dev-*` manuelle (pas supprimée), multi-repo.
- `pnpm typecheck` et suite `vitest` du desktop.
