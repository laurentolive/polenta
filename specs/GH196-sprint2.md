# GH196 — Sprint 2 : page d'exécution et consultation d'un run

## Fichiers modifiés

- `routes/campaign.$campaignId_.execute.$testId.tsx` : champs d'exécution sous le verdict global,
  champs d'étape sous le commentaire de chaque étape exécutée (Q3), défauts pré-remplis (Q7),
  astérisque dynamique (`isFieldRequiredNow` + `runFieldReader` sur le verdict choisi), envoi de
  `fields` dans `tests.execute` ; le refus du main s'affiche sous le formulaire.
- `routes/campaign.$campaignId_.run.$testId.tsx` + **`components/runs/RunFieldValues.tsx`** :
  valeurs en lecture seule (liens cliquables, booléen Oui / Non, ⚠ valeur d'enum inconnue,
  « hors schéma » pour un champ retiré).
- i18n : `campaignPage.runFields`, `campaignPage.outOfSchema`.
- e2e : `e2e-web/gh196-run-fields.spec.ts`.

## Divergence

Test d'un composant dont le type n'est pas résolu dans le schéma du repo ouvert : la page n'affiche
pas les champs (le main les contrôle quand même avec le schéma du composant et refuse avec un
message). Évolution possible : lecture du schéma du composant côté renderer.
