# GH196 — Scénarios de test

**[U]** unitaire, **[E]** e2e web, **[M]** manuel.

## Nominal
1. [U] `convertFieldValue` : number `23,5` → 23.5 ; boolean `Oui` → true ; enum hors valeurs refusé ; link `l | https://x` → objet.
2. [U] `execute` : verdict FAIL, `reportNumber` (`requiredWhen: {result:[FAIL]}`) vide → refus nommant le champ, aucun fichier de run écrit.
3. [U] `execute` : champs remplis → run avec `fields`, étape 3 avec `fields.measured` (nombre).
4. [U] étape `NOT_EXECUTED` avec champ d'étape requis vide → accepté ; étape exécutée → refus « Étape 3 : … ».
5. [U] verdict calculé depuis les étapes (non forcé) utilisé pour `requiredWhen`.
6. [U] clé inconnue refusée.
7. [U] `schema:save` : même nom dans deux types de test avec types différents → refus ; même nom en `runFields` et `stepFields` → refus ; même nom, même type → accepté.
8. [U] `add_field` MCP `list: runFields` sur un type d'exigence → refus.
9. [U] graphe : `runs[].fields`, `notes`, `stepResults[].fields` ; `runFields` sur le type.
10. [U] classeur v3 : export d'une campagne à deux types → colonnes union après Commentaire, cellules sans objet verrouillées ; aller-retour import → valeurs typées, lien hypertexte reconnu.
11. [U] import v3 : instance FAIL sans n° de rapport → `required_field_missing`, autres instances importées ; valeur `abc` dans un nombre → `invalid_field_value`.
12. [U] import d'un classeur v2 → inchangé.
13. [E] éditeur de schéma : section « Champs d'exécution » d'un type de test, ajout d'un champ.
14. [E] page d'exécution : champ d'exécution requis sur FAIL, astérisque, refus puis enregistrement ; consultation du run.

## Cas limites
15. [U] champ retiré du schéma : run ancien lisible, valeur exposée (graphe) ; rendu « hors schéma » [M].
16. [U] campagne sans aucun champ d'exécution : classeur sans colonne supplémentaire, version 3.
17. [U] test de composant : `runFields` lus dans le schéma du composant.

## Manuel
18. [M] Excel : listes déroulantes, commentaires d'en-tête, cellules grisées non modifiables.
19. [M] consultation d'un run : liens cliquables, « hors schéma ».
