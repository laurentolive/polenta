# GH305 — Scénarios de test

## Automatisés

| # | Scénario | Où |
|---|----------|----|
| U1 | `web.update` : confirmation absente → 400 ; version `latest` → 400 ; jeton d'une autre instance → 403 ; sa propre instance → 202, commande `instance web update acme --version 0.4.0`, audit `version` | `apps/admin-service/test/app.test.ts` (GH305) |
| U2 | RUNBOOK A17 couvre tout le catalogue (dont `web.update`) | `apps/admin-service/test/runbook.test.ts` |
| U3 | `isNewer` (déplacé dans `shared/version-compare.ts`) | `release-check.gh302.test.ts` |
| E1 | Popover administrateur : bouton « Mettre à jour vers vX », confirmation annonçant la coupure pour tous ; « Annuler » ne lance rien | `e2e-web/gh305-web-update.spec.ts` |
| E2 | Confirmation → travail `web.update` sur `acme`, version de la release ; suivi jusqu'à « Client web mis à jour » ; popover fermé/rouvert : suivi conservé | idem |
| E3 | Travail en échec : message affiché, « Réessayer » repropose la mise à jour | idem |
| E4 | Administration › Instances (hôte) : formulaire seulement pour les instances avec client web, prérempli avec la release, version `web X` affichée, saisie libre → travail avec la version saisie | idem |
| E5 | Non-administrateur : aucun bouton, `POST /admin/api/jobs` refusé | idem |
| E6 | W2 (#302) : bouton à la place de la commande | `e2e-web/gh302-update.spec.ts` E2 |

## Kit, vérifié sur le VPS de test (2026-11-06, copie temporaire du kit, instance `acme`)

| # | Scénario | Résultat |
|---|----------|----------|
| K1 | `web update gitea-test` (sans client web) | code 6, message explicite |
| K2 | `web update acme --version nope-gh305` | code 14, « rien n'a été modifié », `instance.env` inchangé |
| K3 | `web update acme --version gh305-a` (image retaguée) | 8 s, conteneur sain, HTTPS OK, `instance.env` à jour |
| K5 | retour en `gh44-s4` | OK (état d'origine rétabli) |

## Manuels (non couverts)

- **K4 — retour arrière** : image défaillante → version précédente rétablie, code 17 (`rolled-back`).
  Non lancé (action refusée par le contrôle de permissions de la session).
- **CI — CA1/CA2** : premier tag réel `vX.Y.Z` : job `web-image` vert, paquet rendu public, `docker pull`
  sans authentification ; un `workflow_dispatch` de marque ne publie rien.
- **Bout en bout U2** : sur `acme`, après migration (`web enable --image ghcr.io/laurentolive/polenta-web
  --version X.Y.Z`), mise à jour depuis le popover W2 d'un vrai client web : coupure courte, « Recharger ».
