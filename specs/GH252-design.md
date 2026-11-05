# GH252 — Design technique : versions, impact et validation sur le client web

> Spec : `specs/GH252.md` (validée le 2026-11-05, D1–D4 acceptées).

## Découpage

Un sprint. Le code des écrans et des services est partagé : `registerHandlers` sert le desktop et le web, avec un
conteneur de services par utilisateur.

## Changements

| Zone | Fichier | Changement |
|---|---|---|
| Canaux | `web-server/channel-policy.ts` | Les 27 canaux passent de `WEB_HIDDEN` à `WEB_EXPOSED`. `ROOT_ARGS` les déclare déjà ; `channel-policy.test.ts` vérifie la synchronisation avec les handlers |
| Garde | `web-server/path-guard.test.ts` | Refus d'un chemin hors de l'espace de l'utilisateur, sur tous les canaux exposés (U9) |
| Interface | `platform.ts`, `ActivityBar.tsx`, `ReflectionCell.tsx` | `capabilities.productValidation` retirée (D3) : entrée Validation et lien de version sur le web |
| e2e | `e2e-web/gh252-versions.spec.ts` (nouveau), `gh243-changeset-removal.spec.ts` | Scénarios U1 à U8 ; tolérance des 404 retirée (D4) |
| Specs | SPEC-WEB §11, SPEC-INDEX | Écarts restants : terminal, zoom (D1) |

## Décisions et alternatives rejetées

- **Pas de code serveur dédié** : tag, commit et auteur passent par `SyncService` et `AuthService` du conteneur de
  l'utilisateur, comme les autres opérations git du web. Le scénario e2e vérifie l'auteur et le tag sur la forge de test.
- **Exposition d'un bloc** plutôt que par étapes : l'écran Validation dépend des versions, et un état partiel
  réintroduirait des 404.

## Fichiers de test

Voir `specs/GH252-tests.md`.
