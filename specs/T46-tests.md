# T46 — Scénarios de test

## Scénarios nominaux (golden path)

### GP1 — Créer une analyse et voir les exigences modifiées
1. Ouvrir `/impact-analysis` depuis le panneau Version d'un repo ayant au moins deux baselines existantes
2. Choisir A = `v1.0`, B = `v1.1` dans les deux `BaselineCombobox`
3. **Attendu** : liste des exigences ajoutées/supprimées/modifiées entre les deux baselines ; une exigence
   modifiée affiche ses champs changés (au moins `statement` ou un champ de `fields`)

### GP1bis — Comparer par rapport à l'état courant sans baseline existante
1. Ouvrir `/impact-analysis` sur un repo dont l'état courant de l'intégration n'a encore aucune baseline
2. Dans le sélecteur B, choisir "Créer une baseline sur l'état actuel…"
3. **Attendu** : le flux de création de baseline existant s'ouvre, pré-rempli sur le repo courant ; une
   fois la baseline créée, elle est automatiquement sélectionnée comme borne B, prête à comparer

### GP1ter — Baseliner une branche de travail avant livraison
1. Checkout une branche `dev-*` (pas la branche d'intégration configurée), working tree propre, avec des
   modifications d'exigences déjà committées sur cette branche par rapport à la dernière baseline
2. Ouvrir la page Baseline, tenter de créer une baseline sur l'état actuel
3. **Attendu** : la création n'est plus bloquée par le fait d'être sur `dev-*` (seules des modifications
   en attente staged/unstaged bloqueraient) ; la baseline est créée sur le commit courant de `dev-*`
4. Depuis `/impact-analysis`, comparer cette nouvelle baseline à la précédente baseline sur la branche
   d'intégration
5. **Attendu** : l'analyse d'impact fonctionne normalement, montrant l'impact des modifications de `dev-*`
   avant toute livraison/merge

### GP2 — Déplier les deux arbres d'une exigence modifiée
1. Depuis GP1, déplier une exigence modifiée qui a à la fois une exigence parente et une exigence fille
   dans le projet courant, chacune couverte par un test
2. **Attendu** : un arbre descendant (exigence fille + son test) et un arbre montant (exigence parente +
   son test) sont tous deux affichés, chaque nœud avec son type, son `linkType`, et le statut initial
   `impact_non_verifie`

### GP3 — Faire avancer un statut et rouvrir plus tard
1. Sur un élément impacté de GP2, changer le statut à `impact_a_tester` avec un commentaire
2. Fermer la page, revenir au panneau Version, rouvrir l'analyse depuis la liste
3. **Attendu** : le statut `impact_a_tester` et le commentaire sont restitués à l'identique

### GP4 — Générer une campagne
1. Sur une analyse avec au moins un élément `impact_a_tester` (type test) et un élément
   `modification_a_tester` (type requirement, couvert par 2 TestCases approuvés)
2. Cliquer "Générer une campagne"
3. **Attendu** : la campagne pré-remplie contient le test direct + les 2 TestCases résolus depuis
   l'exigence, sans doublon si un TestCase couvre plusieurs éléments sélectionnés

### GP5 — Une analyse reste figée même si le projet évolue
1. Créer une analyse entre deux baselines existantes, noter le contenu affiché (exigences changées,
   arbres)
2. Ajouter un nouveau lien dans le projet (ex. un test qui vient couvrir une des exigences modifiées de
   l'analyse), sans poser de nouvelle baseline
3. Rouvrir l'analyse déjà créée à l'étape 1
4. **Attendu** : le contenu est identique à l'étape 1 — le nouveau lien n'apparaît pas (aucune notion de
   recalcul, cf. décision D5) ; pour le voir apparaître, il faut poser une nouvelle baseline et créer une
   nouvelle analyse

### GP6 — Indicateur de complétude
1. Faire passer tous les éléments impactés d'une analyse à un statut clos (`pas_d_impact_reel`,
   `impact_teste`, ou `modification_verifiee`)
2. **Attendu** : le bandeau "Analyse complète" apparaît ; le compteur affiche 0 ouvert

## Cas limites

- **Aucune différence entre A et B** : liste d'exigences changées vide, message explicite ("aucune
  exigence modifiée entre ces deux références"), pas d'arbre à afficher
- **Exigence ajoutée dans B** (n'existait pas en A) : listée sans `changedFields`, ses arbres d'impact se
  calculent normalement à partir du snapshot de B (elle y existe bien)
- **Exigence supprimée** (existait en A, absente en B) : listée, aucun sous-arbre (pas d'élément à
  chercher dans le snapshot de B puisque l'exigence n'y existe plus)
- **Exigence modifiée sans aucun lien** (orpheline) : les deux arbres sont vides ; ni l'un ni l'autre ne
  s'affiche (cf. règle "si besoin" étendue à la descendante aussi dans ce cas — rien à déplier)
- **Cycle de liens** (A dérive de B qui dérive de A, cas normalement empêché ailleurs mais à ne pas
  planter dessus) : garde anti-cycle empêche la boucle infinie, l'élément apparaît une seule fois dans le
  premier arbre où il est atteint
- **Parsing frontmatter en échec sur un fichier** (YAML corrompu dans un des deux refs) : l'exigence
  concernée tombe en repli "diff brut" (`changedFields: [{field: '(brut)', ...}]`) plutôt que de faire
  échouer tout le calcul de diff pour les autres exigences
- **Élément impacté par deux exigences modifiées différentes** : apparaît sous chacune, avec son propre
  statut par occurrence (clé `(reqId, direction, elementId)`, pas un statut global à l'élément) — changer
  le statut sous une exigence n'affecte pas son statut sous l'autre
- **Aucune baseline n'a jamais été créée sur le repo** : les deux `BaselineCombobox` sont vides à part
  l'option "Créer une baseline sur l'état actuel…" — pas de plantage, message explicite invitant à en
  créer une première
- **Un tag de baseline a été supprimé après coup** (cf. bug connu T58, hors scope ici mais à ne pas
  aggraver) : si `BaselineService.list()` filtre déjà les tags inexistants (`tagExists`), l'analyse ne
  doit simplement pas apparaître comme sélectionnable — pas de comportement spécifique à ajouter côté T46

## Critères d'acceptation vérifiables

Repris de `T46.md` — chacun doit être démontrable par un scénario ci-dessus :

1. GP1 + GP1bis + GP1ter — bornes toujours des baselines, création forcée d'une baseline pour comparer
   l'état actuel, et possibilité de baseliner une branche de travail quelconque
2. GP2 — deux arbres distincts, montant affiché seulement si non vide
3. GP3 — statut à 8 valeurs, librement modifiable, avec commentaire
4. GP3 + GP5 — persistance, analyse figée (pas de recalcul silencieux)
5. GP4 — génération de campagne dédupliquée
6. GP6 — indicateur ouverts/clos et bandeau de complétude
7. Navigation vers les vues existantes (édition/Système/Excel/Word) depuis un nœud de l'arbre — à vérifier
   manuellement, pas de nouvelle vue créée
8. Le mécanisme `ImpactAcknowledgement`/`getImpactReport` existant (bouton "Analyser l'impact" sur une
   fiche élément) continue de fonctionner sans changement — non-régression à vérifier en sprint 1
   (`traceability:impact` inchangé)
9. GP1ter — création de baseline non bloquée par la branche courante, seules les modifications en attente
   bloquent encore, sur n'importe quelle branche du workspace
