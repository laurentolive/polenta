# GH207 — Scénarios de test

## Unitaires

| # | Scénario | Attendu |
|---|---|---|
| T1 | `toModify` SW-0042 couvert par TEST-0007 ; TEST-0009 impacté `impact_a_tester` | tests TEST-0007 (instances [SW-0042]), TEST-0009 (lui-même) |
| T2 | impacté `impact_non_verifie` / `impact_teste` | ne contribue pas |
| T3 | exigence `modification_a_tester` sans test | `uncovered` |
| T4 | lien de couverture créé dans un sens ou l'autre | même résultat |
| T5 | création de campagne avec `changeset` | `changeset` écrit, changeset `campaigns` contient l'ID ; changeset clos ou inconnu : refus avant l'ID |
| T6 | `toAdd` : test déjà dans une campagne liée ouverte → absent ; liée `completed` → présent | |

## E2E (`e2e-web/gh207-campaigns.spec.ts`)

| # | Scénario |
|---|---|
| C1/C2 | changeset avec une exigence à modifier couverte → « Créer une campagne » → formulaire pré-rempli → campagne créée liée des deux côtés, listée dans la section |
| C4 | nouvel impacté test « à tester » → « 1 test à ajouter » → « Ajouter à … » ouvre le sélecteur pré-coché |
| C5 | campagne liée close → seul « Créer une campagne » |

## Manuel

- Test itérant couvrant deux exigences dont une seule concernée : seule son instance pré-cochée.
