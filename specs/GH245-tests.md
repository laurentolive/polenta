# GH245 — Scénarios de test

Auto = `version-analysis.gh245.test.ts` (fonctions pures) / `versions.gh245.test.ts` (repo temporaire).

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| A1 | Version incluant SYS-1, SYS-1 raffinée par SYS-2 (même repo) | ligne SYS-2, source SYS-1 → SYS-2 avec le type de lien | Auto |
| A2 | Élément atteint d'un autre repo | absent des lignes | Auto |
| A3 | Changement d'une version de composant postérieure à `basedOn` | racine (component = composant) ; ses impacts dans le repo produit listés | Auto |
| A4 | Deux racines atteignent le même élément | une ligne, deux sources | Auto |
| A5 | `setImpact` puis élément plus atteint | `impacted` écrit ; ligne `reached: false`, statut conservé | Auto |
| A6 | `setImpact` sur une version released | `NOT_IN_PROGRESS` | Auto |
| A7 | Passage released | `analysis` écrite dans le commit, `frozen: true` ; `analysis()` la renvoie | Auto |
| T1 | Tests à exécuter | racine test, tests couvrant les exigences racines et impactées ; instance par exigence | Auto |
| T2 | Ligne `pas_d_impact_reel` | non source ; un test ainsi marqué jamais proposé | Auto |
| T3 | Exigence sans test | `uncovered` | Auto |
| T4 | Test dans une campagne ouverte / close du repo | `alreadyIn` = l'ouverte seulement | Auto |
| T5 | Version abandonnée | tests refusés | Auto |
| G1 | Graphe | `impacted`, `analysis` (released) | Auto |
| U1 | Page : statuts saisis dans le tableau et sur un nœud | enregistrés, relus | Manuel |
| U2 | « Créer une campagne » | création pré-remplie avec les tests cochés ; aucun lien | Manuel |
| U3 | « Ajouter à … » | sélecteur pré-coché de la campagne | Manuel |
| U4 | Version released | sections en lecture seule, analyse figée | Manuel |
