# GH199 — Scénarios de test

**[U]** unitaire, **[E]** e2e web, **[M]** manuel.

1. [U] `computeChangeAnalysis` : racines = listes ; arbres montant / descendant ; un élément atteint
   depuis deux racines = une ligne ; statut d'une ligne reporté sur tous ses nœuds.
2. [U] listes vides → racines = exigences du composant.
3. [U] ligne calculée persistée non atteinte → `reached: false` ; ligne calculée par défaut non atteinte → absente.
4. [U] `pruneImpacted` : calculées par défaut sans commentaire retirées ; déclarées gardées.
5. [U] campagnes non closes contenant un test impacté listées ; campagne close ignorée.
6. [U] `ChangesService` : passage terminal → `analysis` figée écrite ; `analysis()` la renvoie sans
   recalcul ; retour non terminal → `analysis` retirée.
7. [U] change `range` : bornes tag / SHA résolues, `toModify` = éléments changés (`modified`),
   snapshot à `to` ; borne inconnue refusée.
8. [U] `diffElementsBetweenRefs` : exigences et tests ajoutés / modifiés / supprimés.
9. [E] U1–U2 : change avec une exigence à modifier → impactés calculés ; statut changé → ligne écrite.
10. [E] U5 : clore le change → « figée » ; rouvrir → live.
11. [E] U11 : panneau Changements : « Impact à vérifier », « Modifications locales », Constellation ;
    plus d'entrée « Analyse d'impact » dans la barre d'activité.
12. [E] t173 / gh83 / gh145 / gh183 portés sur la vue Changements.
13. [M] nouveau change sur l'existant entre une baseline et un commit ; export de l'analyse.
