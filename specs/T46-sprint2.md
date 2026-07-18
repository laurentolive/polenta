# T46 — Sprint 2 : édition des statuts + campagne (dernier sprint)

## Test interactif

Testé en conditions réelles (`run-desktop`, app buildée, projet de test avec 2 exigences liées, 2 tests,
deux baselines réelles créées via l'UI — une sur `main`, une sur une branche `dev-test`).

**Vérifié fonctionnel de bout en bout :**
- Création de baseline non bloquée sur une branche hors intégration (`dev-test`), statut "prêt" —
  vérifié deux fois
- Diff exigence-par-exigence : champs changés correctement détectés (`status`, `fields.statement`)
- Arbres d'impact : construction et imbrication correctes (test direct + exigence fille + test de la
  fille, bien imbriqué), arbre montant absent quand pas de parent
- Édition de statut et commentaire : persistée sur disque (vérifié dans le YAML brut), restituée à la
  réouverture de l'analyse
- Bandeau de complétude et déclenchement du bouton "Générer une campagne" dès qu'un élément passe en
  statut "à tester"
- Génération de campagne : résolution correcte du TestCase concerné, "Créer la campagne" fonctionnel

**Bug trouvé et corrigé** (hors du code T46 lui-même, dans une infrastructure partagée) :
`apps/desktop/src/renderer/contexts/SystemViewContext.tsx` — l'effet qui redirige vers `/product`/
`/components` quand l'URL n'a pas de paramètre `repo` s'appliquait à **toute** la famille de routes
"système" au sens de `deducePanel` (`AppLayout.tsx`), qui inclut `/req/$reqId`, `/test/$testId` et
`/campaign/new` — alors que ces routes utilisent `repoPath`/`component`, pas `repo`/`node`/`type`, et
n'ont donc jamais ce paramètre. Résultat : cliquer sur un élément impacté depuis `/impact-analysis` (ou
sur "Créer la campagne") redirigeait systématiquement vers la vue Système vide au lieu d'ouvrir la fiche
ciblée — cassant le critère d'acceptation 7 de `T46.md` en pratique. Le code de navigation de T46
lui-même est correct (même pattern que `SearchPanel.navigateTo`) ; c'est la première fonctionnalité à
sauter directement vers ces routes depuis l'extérieur de la section Système, ce qui a révélé le défaut.

Correctif : garde-fou `if (pathname !== '/product' && pathname !== '/components') return` en tête de
l'effet, `pathname` ajouté aux dépendances. Non-régression vérifiée : ouvrir la section Système
directement (icône activity bar) continue de sélectionner repo/node/type par défaut comme avant.

## Fichiers modifiés

- `apps/desktop/src/renderer/routes/impact-analysis.tsx` — édition du statut/commentaire par élément
  impacté (`ImpactNodeStatusEditor`), bandeau de complétude ouverts/clos, génération de campagne
- `apps/desktop/src/renderer/routes/campaign.new.tsx` — accepte un préremplissage optionnel
  (`title`, `testCaseIds` en recherche d'URL) depuis le flux "Générer une campagne"
- `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` — garde-fou pathname sur l'effet de
  sélection par défaut repo/node/type (cf. section Test interactif ci-dessus)
- `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx`,
  `apps/desktop/src/renderer/components/system/CampaignListView.tsx` — leurs appels `navigate` vers
  `/campaign/new` fournissent désormais explicitement `title: undefined, testCaseIds: undefined`
  (TanStack Router exige toutes les clés du schéma de recherche)
- `TICKETS.md` — statut `[coding sprint 2]`
- `specs/SPEC-TRACEABILITY.md` §4.4, §4.6 (nouvelle) — documente le flux T46 réel
- `specs/SPEC-FORKS-BRANCHES-BASELINES.md` §5.2, §5.6, §5.7 — documente le retrait du verrou branche
  d'intégration et l'implémentation réelle de la comparaison de baselines
- `specs/SPEC-INDEX.md` — colonne MAJ mise à jour (T45→T46, T79→T46) pour les sections concernées
- `specs/T46-sprint2.md` — ce fichier

Le backend (`updateImpactItemStatus`, endpoint IPC, client `impactAnalysis.updateStatus`) était déjà
codé en sprint 1 ; ce sprint le branche dans l'UI.

## Comportement implémenté

- **Statut éditable par élément impacté** : `<select>` des 8 valeurs + commentaire optionnel
  (icône, champ qui apparaît au clic), directement dans l'arbre déplié. Chaque changement persiste
  immédiatement (pas de bouton "Enregistrer" séparé).
- **Bandeau de complétude** : compte ouverts/clos sur l'ensemble de l'analyse (tous les nœuds des deux
  arbres, toutes les exigences changées confondues), bandeau vert "Analyse complète" quand 0 élément
  ouvert reste — informatif, ne bloque rien.
- **Génération de campagne** : bouton actif dès qu'au moins un élément est en statut "à tester" (impact
  ou modification). Résout les exigences vers leurs TestCases approuvés couvrants (réutilise
  `generateTestPlan`), déduplique avec les tests directement sélectionnés, affiche le résumé (nombre de
  TestCases trouvés, exigences non couvertes) puis pré-remplit `/campaign/new` pour la création.

## Divergences par rapport au design

- **Pas de popup de génération de campagne à réutiliser** : le design supposait une "UI de génération de
  plan de test du module Traçabilité" déjà existante à réutiliser — elle n'existe pas (aucune UI n'utilise
  `generateTestPlan` avant T46). `/campaign/new` est une page dédiée, pas une popup. Solution retenue :
  étendre `/campaign/new` avec un préremplissage optionnel (`title`/`testCaseIds` en recherche d'URL)
  plutôt que construire une nouvelle popup — la page existante sert elle-même d'écran de
  revue/confirmation avant création (elle affiche déjà la liste des tests sélectionnés avec cases à
  cocher), ce qui satisfait l'esprit du point 5 de la spec sans dupliquer d'UI.
- **`/code-review high` en trois passes ciblées** plutôt qu'un seul passage à 8 angles : la capacité
  d'agents s'est libérée en cours de sprint après la limite de session du sprint 1, mais j'ai lancé 3
  angles ciblés sur le diff sprint 2 (correctness, cross-file/removed-behavior, reuse/simplification)
  plutôt que de refaire les 8 angles génériques. 12 candidats remontés, dédupliqués et vérifiés
  manuellement (capacité de vérification automatique non disponible) :
  - **Corrigés (7)** : fermeture obsolète sur `activeAnalysisId` dans la mutation de statut (piège
    react-query documenté — `onSuccess` se relie aux options du dernier rendu, pas à celles actives au
    moment de l'appel) ; état local `comment` non resynchronisé avec `node` (commentaire affiché obsolète
    après une mise à jour externe) ; perte de mise à jour croisée entre changement de statut et édition de
    commentaire rapprochés (chaque commit envoyait un mélange de state frais et de prop obsolète) ;
    préremplissage de `/campaign/new` non réinitialisé si on relance "Nouvelle Campagne" sans quitter la
    page (TanStack Router ne remonte pas le composant sur une navigation vers la même route) ;
    débordement visuel possible du panneau latéral (320px) à forte indentation avec le nouvel éditeur de
    statut ; recalcul non mémoïsé de l'arbre aplati à chaque rendu, dupliqué une seconde fois dans la
    génération de campagne ; déduplication simplifiée (`Map` → deux `Set`, la map ne servait qu'à
    ressortir des identifiants).
  - **Non corrigés, acceptés (2)** : `ImpactNodeStatusEditor` réinvente un pattern d'édition de statut
    au lieu de réutiliser des composants existants conçus pour d'autres contextes (champ enum générique,
    résultat de test) — coût de refactor jugé disproportionné à ce stade ; `flattenNodes` alloue via des
    spreads récursifs plutôt qu'un accumulateur — micro-optimisation, déjà largement atténuée par la
    mémoïsation ajoutée.
  - **Écarté après vérification** : un risque de collision de clé React pour un même élément apparaissant
    deux fois dans l'arbre d'une même exigence changée — réfuté, le `visited` partagé entre arbre montant
    et descendant dans `buildImpactTreesFromSnapshot` (backend, sprint 1) garantit qu'un `elementId`
    n'apparaît qu'une fois par exigence changée.

## Mises à jour SPEC (dernier sprint)

- **`SPEC-TRACEABILITY.md`** : nouvelle §4.6 "Analyse d'impact entre deux baselines (T46)" documentant le
  flux complet réel (bornes toujours des baselines, calcul figé au snapshot de B, cycle de statut à 8
  valeurs, indicateur de complétude, génération de campagne, persistance, format de stockage réel en YAML
  pur). Note ajoutée en §4.4 précisant que la règle "défaut niveau 1" ne s'applique pas au flux T46.
- **`SPEC-FORKS-BRANCHES-BASELINES.md`** : §5.2 corrigée (condition "branche d'intégration" retirée du
  verrou T79, seule l'absence de modification en attente reste bloquante) ; §5.6 corrigée pour refléter
  l'implémentation réelle (IPC, pas de REST ; champs réellement produits ; `testCoverageChange`/
  `componentUpdates` non implémentés) ; §5.7 confirmée alignée avec le comportement réel.
- **`SPEC-INDEX.md`** : colonne MAJ mise à jour pour les deux sections ci-dessus (T45→T46, T79→T46).

## Comment tester manuellement

Testé interactivement (cf. section Test interactif ci-dessus). Pour rejouer :

1. Reprendre les scénarios GP1 à GP4 de `T46-tests.md` (déjà couverts en lecture seule au sprint 1)
2. GP3 : changer le statut d'un élément impacté via le menu déroulant, ajouter un commentaire (icône) →
   vérifier la persistance en rouvrant l'analyse
3. GP6 : faire passer tous les éléments à un statut clos → vérifier l'apparition du bandeau "Analyse
   complète"
4. GP4 : avec au moins un élément en "impact à tester"/"modification à tester", cliquer "Générer une
   campagne" → vérifier le résumé (nombre de TestCases, exigences non couvertes), puis "Créer la
   campagne" → vérifier l'arrivée sur `/campaign/new` avec le titre et les tests pré-cochés
5. Vérifier qu'on peut encore créer une baseline depuis une branche `dev-*` (sprint 1, non régressé)
