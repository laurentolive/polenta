# GH67 — Scénarios de test

[U] unitaire (`suivi-scope.service.test.ts`), [E] e2e web (`e2e-web/gh67-scope.spec.ts`),
[M] manuel. Les numéros entre parenthèses renvoient aux critères de `specs/GH67.md` §4.

## Nominal

| # | Scénario | Attendu | Type |
|---|---|---|---|
| N1 | Dashboard privé, 3 widgets sur 2 requêtes privées (dont une utilisée 2 fois) : aperçu | 2 requêtes, la double avec 2 widgets, aucun bloquant (1, 2) | [U] |
| N2 | Partage groupé de N1 | 2 dossiers `queries/QUERY-NNNN/`, 1 `dashboards/DASHBOARD-NNNN/`, `.pref` sans ces objets, widgets sur `QUERY-NNNN` (1, 2) | [U] |
| N3 | Requête privée aussi utilisée par un autre dashboard privé | aperçu : `remapped` = widget de l'autre ; après partage, l'autre reste privé, widget remappé (3) | [U] |
| N4 | Dashboard privé sans requête privée : **Partagé** | partagé directement, pas de confirmation (4) | [E] |
| N5 | UI : dashboard privé à requêtes privées, **Partagé** → confirmation → **Partager** | liste affichée, URL sur `DASHBOARD-NNNN`, icône partagée dans le panneau, widgets affichés (1) | [E] |
| N6 | `/query`, requête privée : **Partagée** → confirmation → confirmer | dossier écrit, URL sur `QUERY-NNNN`, texte de l'éditeur modifié non enregistré conservé (12) | [E] |
| N7 | Panneau, requête privée : bouton de portée → confirmer | requête partagée, même position dans la section (13) | [E] |
| N8 | Rétrogradation d'une requête partagée non utilisée avec colonne | aperçu `columnRemoved` ; après : dans le `.pref` sans colonne, dossier retiré (15) | [U] [E] |
| N9 | Préférences par dashboard (ordre, valeurs de paramètres) après partage groupé | mêmes positions, mêmes valeurs sous le nouvel id (9) | [U] |
| N10 | Partager une requête puis ouvrir le partage du dashboard qui l'utilisait | la requête n'est plus listée (18) | [U] |

## Cas limites

| # | Scénario | Attendu | Type |
|---|---|---|---|
| L1 | Annuler la confirmation du dashboard | aucun fichier, `.pref` inchangé (5) | [E] |
| L2 | Requête privée `legacy-sql` dans le dashboard | aperçu bloquant `read-only` ; `shareWithQueries` refuse `SCOPE_BLOCKED`, rien d'écrit (6) | [U] |
| L3 | Paramètres invalides (`.pref` édité à la main) | bloquant `params`, rien d'écrit (6) | [U] |
| L4 | Widget sur id privé introuvable | `missing`, refus, rien d'écrit (6) | [U] |
| L5 | UI : confirmation avec bloquant | pas de bouton de confirmation, cause affichée (6) | [E] |
| L6 | Requête partagée de même titre (casse / espaces différents) | `titleTakenBy` renseigné, partage possible, titres inchangés (7) | [U] ; avertissement affiché [E] |
| L7 | Échec simulé à la 2e promotion sur 3 | `SCOPE_PARTIAL` « 1 requête(s) sur 3 » ; 1 partagée + remappée, 2 privées, dashboard privé ; relance → 2 requêtes listées, succès, aucun doublon (8) | [U] |
| L8 | Requête partagée utilisée par un widget : rétrogradation | aperçu `dependents` listant le widget ; UI sans bouton de confirmation (14) | [U] [E] |
| L9 | Requête `legacy-sql` / non enregistrée dans `/query` ; ligne en lecture seule dans le panneau | pas de sélecteur, pas de bouton (16) | [E] (non enregistrée) / [M] (`legacy-sql` dans le panneau) |
| L10 | Annuler la confirmation d'une requête | rien d'écrit (17) | [E] |
| L11 | Même portée demandée | aperçu sans bloquant, listes vides | [U] |
| L12 | Dashboard en lecture seule : aperçu | erreur `SUIVI_READ_ONLY` | [U] |
| L13 | Client web : nouveaux canaux classés | `channel-policy.test.ts` vert (10) | [U] |

## Manuel

- M1 — Libellés en anglais des deux confirmations (11).
- M2 — Desktop Electron : même parcours que N5 / N6 (les e2e tournent sur le client web).
- M3 — Seed « Campagnes » réel (6 requêtes) : partage groupé, résultats des 6 widgets identiques.
