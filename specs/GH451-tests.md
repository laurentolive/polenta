# GH451 — Scénarios de test

Unitaires : `apps/desktop/src/main/services/versions.gh451.test.ts` (même montage que `versions.gh201.test.ts`).
E2E : `apps/desktop/e2e-web/gh451-version-based-on.spec.ts`.

## Unitaires (service)

| # | Scénario | Attendu |
|---|---|---|
| U1 | Repo sans release, V1 en cours ; création de V2 avec `basedOn: V1` | acceptée, `basedOn = V1` |
| U2 | Création sans `basedOn` dans un repo sans release | `basedOn` absent (défaut inchangé) |
| U3 | Page de V1 alors que V2 (basée sur V1) et V3 (basée sur V2) existent, V4 abandonnée, V5 en cours | `basedOnOptions` = V5 seule (ni V1, ni V2/V3 descendantes, ni V4) |
| U4 | `update(V1, { basedOn: V3 })` (boucle) | `VERSION_NOT_FOUND`, détail « boucle » ; `update(V1, { basedOn: V1 })` idem |
| U5 | `update(V5, { basedOn: V4 abandonnée })` | `VERSION_NOT_FOUND`, détail « abandonnée » |
| U6 | V2 basée sur V1 puis V1 abandonnée ; `update(V2, { title, basedOn: V1 })` | acceptée (valeur inchangée) ; page de V2 : V1 en tête des options |
| U7 | Passage released de V2 basée sur V1 en cours | aperçu et `release` : `BASE_NOT_RELEASED`, détail `V1 <label>` |
| U8 | V1 released (resp. abandonnée) | V2 n'a plus `BASE_NOT_RELEASED` et peut passer released |
| U9 | Suppression de V1 alors que V2 est basée sur V1 | `VERSION_IS_BASE`, détail nomme V2 ; base de V2 retirée → suppression OK |
| U10 | Section « Exigences » : V1 en cours inclut R1, R2 ; V2 en cours basée sur V1 inclut R3 | V2 : R1, R2, R3 ; V1 abandonnée → V2 : R3 |
| U11 | Non-régression : version released basée sur une released | page, options, release, lignée inchangées (suite gh201/gh439 verte) |

## E2E (web)

| # | Scénario | Attendu |
|---|---|---|
| E1 | Deux versions en cours A, B ; page de B, liste « Basée sur » | A proposée avec « — en cours » ; la choisir → lien vers A affiché après rechargement |
| E2 | Page de A | B (descendante) absente de la liste |
| E3 | Boîte « Nouvelle version » | liste contient A et B avec « — en cours » ; défaut « Aucune » sans release |
| E4 | « Passer released » sur B | motif « La version de base … n'est pas encore released » affiché, bouton désactivé |
