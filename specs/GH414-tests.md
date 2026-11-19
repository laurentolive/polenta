# GH414 — Scénarios de test

Tests unitaires sur de vrais dépôts git temporaires (`sync.service.gh414.test.ts`,
`merge-resolution.gh414.test.ts`) ; tests e2e navigateur (`e2e-web/gh414-refresh.spec.ts`).

## Compteur (`refreshState`)

| Id | Scénario | Attendu |
|----|----------|---------|
| G1 | Branche de travail, un commit de l'équipe après fetch | `behind` = 1 |
| G2 | Sur l'intégration | `onIntegration`, `behind` = 0 |
| G3 | À jour, modif en cours | `behind` = 0, `dirty` = true |
| G4 | Appel du compteur | aucun appel réseau |

## Clic — sans modif locale (`refreshBranch`)

| Id | Scénario | Attendu |
|----|----------|---------|
| R1 | Merge propre | `merged`, `pulled` = 1 ; commits de la branche conservés ; intégration locale = origin ; arbre propre |
| R2 | Rien à récupérer | `up-to-date`, HEAD inchangé |
| R3 | Hors-ligne | `offline`, rien écrit |
| R4 | Sur l'intégration | `integration-updated`, fast-forward seulement, pas de WIP ni de merge |

## Clic — avec modifs en cours

| Id | Scénario | Attendu |
|----|----------|---------|
| R5 | Modifs modifiées et nouvelles | WIP créé, merge, modifs identiques, arbre propre |
| R10 | Modif sur l'intégration (déplacée sur `dev-auto` par l'auto-pull) | `merged` sur `dev-auto`, le fichier de l'équipe est dans l'arbre |

## Clic — conflit et résolution

| Id | Scénario | Attendu |
|----|----------|---------|
| R6 | Conflit avec modifs en cours | `conflicts` renvoyés ; aucun merge écrit ; HEAD = WIP ; contenu de l'utilisateur intact |
| R6b | Conflit sans modif en cours | pas de WIP ; branche intacte |
| R7 | « Abandonner » | branche, HEAD et contenu identiques à avant ; modifs non indexées |
| R7b | « Abandonner » après un commit par-dessus | refusé (`undone: false`), rien touché |
| R7c | « Abandonner » sur un commit qui n'est pas un WIP | refusé : un commit de l'utilisateur n'est jamais défait |
| M1 | « Terminer » (`merge-resolution.gh414.test.ts`) | merge à deux parents, premier parent = WIP, sur la branche de travail |

## Intégration divergée (GH39)

| Id | Scénario | Attendu |
|----|----------|---------|
| R8 | Divergence sans conflit | resynchronisation (merge, poussé), puis merge dans la branche |
| R9 | Divergence avec conflit | commits locaux mis de côté sur `dev-resync` ; intégration recalée sur origin ; merge dans la branche |

## e2e navigateur (`e2e-web/gh414-refresh.spec.ts`)

| Id | Scénario | Attendu |
|----|----------|---------|
| GH414-1 | Collègue pousse sur l'intégration, clic sur Rafraîchir | fichier de l'équipe dans l'arbre ; message de résultat |
| GH414-2 | Tick d'auto-pull après un push, puis clic | compteur à 1 ; après clic, « 1 commit(s) récupéré(s) », modifs en cours conservées, branche de travail inchangée |

## Hors de ce ticket

- Suite e2e complète (niveau 3) : au merge sur `main`, après « Validé ».
- Comportement avec `core.autocrlf=true` : les tests unitaires désactivent autocrlf pour rester déterministes.
