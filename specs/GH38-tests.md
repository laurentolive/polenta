# GH38 — Scénarios de test

Prérequis : workspace `root` → `compA` → `compB` (repos séparés, `polenta-repo.yaml`), tous sur
leur branche d'intégration configurée, remotes locaux (bare) ou sans remote.

## Logique pure (`publishWorkspace.ts`)

1. `publishOrder` sur root→compA→compB : `[compB, compA, root]`.
2. `publishOrder` diamant root→{compA, compC}, compA→shared, compC→shared : `shared` émis une
   seule fois, avant `compA` et `compC` ; `root` en dernier.
3. `ancestorRepoPaths({compB})` = `{compA, root}` ; diamant `{shared}` = `{compA, compC, root}`.
4. `isBlockedBranch` : `('', 'main')` → vrai ; `('int-v2', 'int-v1')` → vrai ;
   `('int-v1','int-v1')`, `('dev-x','main')`, `('main','main')` → faux.

## Bout en bout (application)

5. **Composant seul** (CA1) : modifier une exigence de `compA` depuis la vue Exigences → bouton
   actif, popup liste `compA` → Publier → `compA` : commit de merge sur l'intégration ; `root` :
   commit avec `polenta-repo.yaml` (pin = SHA du merge compA) ; plus aucun fichier en attente.
6. **Racine + composant** (CA2) : un commit dans chaque repo, celui de root contient l'exigence
   modifiée + le pin.
7. **Imbriqué** (CA3) : seul `compB` modifié → trois commits, ordre compB, compA, root
   (vérifiable par dates de commit), pins cohérents.
8. **Racine seule** (CA4) : un seul commit dans root, `compA`/`compB` intacts.
9. **Bloqué** (CA5) : checkout `int-autre` sur `compA`, modifier `compB` → popup signale
   `compA`, validation désactivée ; aucune branche `dev-*` créée nulle part.
10. **Réseau** (CA6) : remote de `compA` injoignable, modifier `compB` → message réseau nommant
    `compA`, aucune branche/commit créé.
11. **Conflit** (CA7) : conflit provoqué sur root → popup nomme root, liste compA comme publié ;
    « Résolution manuelle » ouvre le diff de root ; après résolution, "Publier" termine root.
12. **Projet simple** (CA8) : projet sans workspace → comportement T87 inchangé.

## Non-régression

13. Bouton désactivé quand aucun repo n'a de modification.
14. Popup « état modifié » si une modification apparaît/disparaît dans un repo pendant la saisie.
