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

## Avenant §8bis (sprint 4)

14. [U] `backlog` : brouillon non assigné listé ; approuvé, terminal ou dans `toModify` d'un change
    ouvert absent ; change clos → l'élément revient ; regroupement par composant.
15. [U] `assign` / `move` : ajout `planned` sans doublon, état conservé au déplacement, change
    terminal refusé.
16. [U] `approvalCheck` : vers `isApproval` non assigné → `needsAssignment` ; assigné, déjà
    approuvé ou vers un statut non approuvé → non.
17. [E] B1–B2 : entrée « Backlog (N) », « Assigner à… » un change ouvert → l'élément quitte le
    backlog et apparaît dans « À modifier ».
18. [E] B3 : « Déplacer vers… » d'un change à l'autre.
19. [E] B5 : approuver un brouillon non assigné → dialogue ; Annuler → statut inchangé ; choisir un
    change → approuvé et assigné.
20. [E] B6 : élément à traiter atteint par l'analyse → badge « à traiter », « Passer en à
    modifier ».
21. [M] « Nouveau change » depuis le dialogue (approbation et backlog) ; plusieurs composants
    dans un repo : un backlog par composant.
