# GH305 — Design

Spec : `specs/GH305.md` (décisions du 2026-11-06 : Q1 migration documentée, Q2 deux points d'entrée,
Q3 `ghcr.io/laurentolive/polenta-web` public). **Un sprint.**

## Fichiers

| Fichier | Changement |
|---------|------------|
| `.github/workflows/release.yml` | Job `web-image` (ubuntu, `if: push`, `packages: write`) : version du tag, build `Dockerfile.web` chargé localement, contrôle `/healthz` (configuration OIDC factice), puis `docker push` du seul tag `X.Y.Z`. Indépendant du job desktop. |
| `deploy/lib/common.sh` | `DEFAULT_POLENTA_WEB_IMAGE=ghcr.io/laurentolive/polenta-web`, défaut de `POLENTA_WEB_IMAGE_DEFAULT`. |
| `deploy/polenta-host.sh` | Sous-commande `instance web update <nom> --version <v>` ; `webVersion` dans `instances_json` ; `enable` : image introuvable → code 14. |
| `apps/admin-service/src/jobs/registry.ts`, `packages/types/src/admin.ts` | Opération `web.update`. |
| `apps/desktop/src/renderer/components/layout/WebReleaseUpdate.tsx` (nouveau), `UpdateBadge.tsx` | Bouton W2 + confirmation + suivi du travail. |
| `apps/desktop/src/renderer/components/admin/InstancesPanel.tsx`, `useLaunch.ts`, `lib/adminApi.ts` | Formulaire « Client web », `webVersion`, `launch` renvoie l'identifiant du travail. |
| `apps/desktop/src/shared/version-compare.ts` (nouveau), `web-server/release-check.ts` | `isNewer` partagé (préremplissage sans retour en arrière). |
| i18n `fr.json` / `en.json` | Libellés ; `update.popover.releaseAdmin` retiré (plus de commande affichée). |
| `deploy/RUNBOOK.md` A15, A17 | Image publiée, visibilité du paquet, `web update`, migration, interface. |

## Décisions techniques

- **Sous-commande `web update` plutôt que `web enable --version`** (écart avec la spec initiale, mise à
  jour) : `enable` rejoue tout le chemin d'activation — contrôle DNS, application OAuth2, page de
  consentement (redémarrage possible de la forge), site Caddy — et écrit la nouvelle version avant de
  vérifier la santé, sans retour arrière. `update` ne change que `POLENTA_WEB_VERSION`, recrée le
  conteneur, contrôle santé + HTTPS, et rétablit la version précédente en cas d'échec (code 17 →
  travail `rolled-back`, comme `instance update` de la forge). Refus explicite sans client web (code 6).
- **Image chargée puis contrôlée avant envoi** dans la CI : une image qui ne démarre pas n'est jamais
  publiée. Le serveur refuse le mode `dev` en production : configuration OIDC factice (aucune
  connexion à la forge au démarrage, vérifié sur le VPS avec l'image `gh44-s4`).
- **Visibilité du paquet** : GitHub crée un paquet privé à la première publication ; passage public
  manuel unique (RUNBOOK A15). Pas d'automatisation (API de visibilité des paquets non exposée au
  `GITHUB_TOKEN`).
- **Pas d'étapes affichées** pour `web.update` : le kit n'émet pas de marqueurs d'étape et le runner
  n'en ferait passer que la première en « en cours » (une étape fausse serait signalée en échec).
- **Suivi du travail** dans `UpdateBadge` (identifiant gardé hors du popover) : fermer le popover ne
  perd pas le suivi ; quand le serveur redémarré sert la nouvelle version, la vue passe à
  « Recharger » et le suivi y reste affiché (échec tardif visible).
- **Préremplissage** : release W2 seulement si `isNewer(release, webVersion)` et sur le client web
  (sur le desktop, l'état de mise à jour est celui de l'installeur).

## Alternatives rejetées

- `web.enable` avec version depuis l'interface : effets de bord (forge, DNS) et pas de retour arrière.
- Bascule automatique des instances à image locale (Q1 b) : décision de l'humain.
- Tag `latest` : contraire aux versions épinglées (GH63 §3.2).
