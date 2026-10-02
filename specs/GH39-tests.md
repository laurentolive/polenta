# GH39 — Scénarios de test

Préparation commune : un repo projet cloné depuis un bare local (`origin` = chemin local) et un
second clone « collègue » du même bare pour faire avancer `origin`.

## Nominaux

| # | Scénario | Attendu |
|---|---|---|
| N1 | 1 commit local non poussé sur l'intégration, origin inchangé | `integrationState` = `ahead` (1/0) ; sprint 2 : pastille + `↑1` |
| N2 | N1 puis tick d'auto-pull | push relancé, état `up-to-date`, `sync:last-error` vide |
| N3 | Collègue pousse, repo local propre, tick | intégration fast-forwardée, fichiers à jour |
| N4 | Divergence sans conflit (fichiers différents), "Publier" d'une modification | merge d'origin puis merge de la modif sur l'intégration, push OK, `up-to-date` |
| N5 | Divergence sans conflit, Resynchroniser (intégration checkoutée, propre) | merge + checkout, fichiers du collègue visibles, push, `up-to-date` |
| N6 | Divergence en conflit, Resynchroniser | `dev-resync` créée sur l'ancien local, intégration = origin, HEAD sur `dev-resync`, aucun fichier changé |
| N7 | N6 puis "Publier" (sans modification) | bouton actif ; conflit §2.4 standard ; après résolution + Publier : merge, retour intégration, `dev-resync` supprimée, push |

## Cas limites

| # | Scénario | Attendu |
|---|---|---|
| L1 | Divergence en conflit, "Publier" | refus avant écriture : aucune branche `dev-*`, aucun commit, message repo + fichiers |
| L2 | `behind`/`diverged`, intégration checkoutée avec modifications en attente, Resynchroniser | erreur `integration-dirty`, rien de modifié |
| L3 | Tick d'auto-pull sur repo sale | fetch fait (état mis à jour), aucun fichier de travail modifié |
| L4 | Repo sans remote | `no-remote`, `autoSync`/`resync` no-op, Publier inchangé |
| L5 | Branche d'intégration jamais poussée (pas de `origin/<int>`) | `no-remote`, pas d'alerte |
| L6 | Origin injoignable pendant le tick | erreur mémorisée dans `sync:last-error`, rien d'autre |
| L7 | `dev-resync` déjà existante | nouvelle branche `dev-resync-2` |
| L8 | Retry "Publier" sur branche éphémère sans nouvelle modification | aucun commit vide créé |
| L9 | Non-régression T154/GH38 : `behind` + Publier, échec réseau, multi-repo | comportement inchangé |
