# Milestone D — spec globale consolidée : versions, issues, validation (2026-10-31)

> Refonte des épiques #191 (conformité) et #193 (changement) après les échanges du 2026-10-31.
> **Fait foi** pour le milestone D : remplace `specs/GH193-point.md` §3–§4 et les parties de
> `specs/GH191.md` / `specs/GH193.md` listées au §9. Le détail livré est dans les specs de lot (§9) et dans
> SPEC-REQ §11–§13 ; les décisions du §11 l'emportent sur le texte. Aligné sur les décisions le 2026-11-05 (#270).

## 1. But

Permettre à la **qualité de statuer**, exigence par exigence, sur la **conformité d'une version du
produit**, au regard des tests exécutés, jusqu'au **feu vert final (go production série)**, et de
tracer **sur quelle version** chaque test a été exécuté.

Le **changeset disparaît** : son contenu (éléments changés, analyse d'impact, tests à exécuter,
campagne) est porté par la **version** du composant, calculé entre la version précédente et
celle-ci. Le « pourquoi » d'une modification non tracée dans les exigences est porté par une
**issue**.

## 2. Les quatre statuts d'une exigence

| Statut | Sens | Origine | Saisi / calculé |
|---|---|---|---|
| **Rédaction** | statut actuel (brouillon, review, approuvé…) | `status` | saisi |
| **Design** | première version **released** du composant qui **inclut** l'exigence (`changes`) et dont l'état figé est **identique** à son contenu courant (P1, GH204 §3) | versions (§3) | calculé ; « — » si aucune |
| **Vérification** | statut de couverture actuel (`not_covered`, `covered`, `validated` affiché « Vérifié », `failing`, `needs_revalidation`, SPEC-TRACEABILITY §2.2) ; le détail des exécutions donne la version testée | liens, exécutions | calculé (inchangé) |
| **Validation** | décision qualité pour une version donnée, avec commentaire | validation (§5) | saisi |

Les quatre servent des fonctions de Polenta (vue Validation, reflets) : calculés dans Polenta (GH79).

## 3. La version (composant ou produit)

> **Livré** par #201, #245 et #268 (`specs/GH201.md`, `specs/GH245.md`, `specs/GH268.md` ; SPEC-REQ §11).
> Écarts avec le texte ci-dessous :
> - une version **par repo**, sans version propre pour un composant local ; un élément appartient au composant
>   si son **type est déclaré par le schéma du repo** (`NOT_OWN_ELEMENT`) ;
> - plusieurs versions en cours par repo, ordre des livraisons = `freeze.at` ; abandon définitif ; copie et
>   suppression des versions non figées ; tag `<repo>-<label>`, poussé au prochain push ;
> - **aucun lien version ↔ campagne** (Q9) : « Créer une campagne » est un raccourci, c'est l'exécution qui
>   référence la version (§6) ;
> - analyse en **arbre** (statut et commentaire sur les nœuds), tableau pour une analyse figée ; composant choisi
>   par liste déroulante dans le panneau Produit.

### 3.1 Objet

Nouvelle catégorie d'objet **`version`**, un seul type par repo, déclaré sur le nœud `root` de son
schéma : `prefix` (unique sur le projet), `fields` du projet, `statuses`. IDs système séquentiels
(GH20, pierres tombales) ; le **label** (ex. `1.2.4`) est le `title`.

```yaml
# versions/MCV-0004.yaml   (repo du composant motor-control)
id: MCV-0004
objectTypeRef: root::version
title: "1.2.4"                       # label
status: released                     # statuts du type ; isApproval = released
basedOn: MCV-0003                    # version précédente (sert à établir les changements)
components:                          # versions des sous-composants (nœuds enfants du schéma)
  bms: BMSV-0002
  turbine: TRBV-0001
freeze: { tag: motor-control-1.2.4, sha: a91c3d2, at: 2026-11-02T10:00:00Z }   # posé au passage released
changes:                             # changements inclus (§3.3), alimentés depuis le backlog (§3.4)
  - id: SW-0042
    base: { sha: 4be1f09, version: 3 }   # état dans la dernière version released qui l'incluait (§3.4) ; absent = nouveau
  - id: ISS-0007
impacted: […]                        # saisies de l'analyse d'impact (ex-Changeset.impacted)
analysis: …                          # analyse figée au passage released (ex-ChangeAnalysis)
fields:
  description: <p>…</p>              # commentaires, actions
history: …                           # GH77
```

- La **version produit** est la version du **nœud racine** ; ses `components` listent les versions
  des composants de la structure. Même objet, récursif comme l'arbre des composants : la
  « configuration produit » de GH193 §6.2 disparaît en tant qu'objet séparé.
- Stockage dans le repo du composant (`versions/`). **Composant en lecture seule** : aucune version
  créée depuis le produit (READONLY_REPO) ; on la crée dans le repo du composant.
- Cycle de vie par défaut : `en_cours` → `released` (`isApproval`) ; `abandonnee` (`isTerminal`).

### 3.2 En cours, released, tag

- **En cours** : état vivant ; les changements inclus sont lus à `HEAD` (+ disque) du repo, et
  l'analyse est recalculée.
- **Passage `released`** : Polenta commite, pose le **tag** `freeze.tag` (pré-rempli, modifiable)
  sur le repo du composant et enregistre `freeze.sha`. L'analyse est figée dans le fichier ; la
  liste `changes` n'est plus modifiable.
  Une version released est **verrouillée** comme un élément approuvé.
- Les `components` d'une version released doivent être released (contrôle au passage).

### 3.3 Page d'une version

- En-tête : ID, label, statut, version précédente (`basedOn`), description.
- **Composants** : pour chaque sous-composant de la structure, ID + label de la version (lien).
- **Changements** : les `changes` de cette version et ceux des versions de ses sous-composants
  postérieures à celles de `basedOn`. Une ligne par élément :

  | Composant | Conf (version) | Type | ID (lien) | Label | Diff |
  |---|---|---|---|---|---|
  | motor-control | MCV-0004 | exigence | SW-0042 | Courant max | Voir les modifications |
  | bms | BMSV-0002 | issue | ISS-0007 | Coupure intempestive | Voir les modifications |

  Trois types : **exigence**, **test**, **issue**. Diff (générique GH222) entre `base` et l'état
  figé de la version (ou l'état courant tant qu'elle est en cours) ; sans `base` : contenu complet
  face à « vide ». Une version en cours permet de **retirer** un changement (il retourne au
  backlog) et d'**ajouter** n'importe quel élément du composant (bouton « Ajouter », sélecteur
  d'éléments existant #198), même inchangé.
- **Analyse d'impact** (moteur #199, inchangé) :
  - racines = changements inclus (exigences, tests) **et** exigences impactées par les issues
    incluses (liens `issue-impact`, §4.1), de ce composant et de ses sous-composants ;
  - lignes = éléments impactés **de ce composant seulement** (les sous-composants ont la leur) ;
    chaque ligne porte sa **source** (racine et chemin qui l'amènent), lue dans l'arbre à l'écran ;
  - statuts d'impact sur les nœuds (8 valeurs, GH199) inchangés ;
  - un élément impacté est **signalé dans la vue Validation** de cette version (§5.3).
- **Tests à exécuter** (#207, inchangé dans son calcul et sa présentation) : liste cochable, élément
  qui amène chaque test, « Déjà dans » ; **Créer une campagne** / **Ajouter à …** sont des raccourcis :
  ils pré-remplissent la campagne sans la lier à la version.

### 3.4 Backlog des changements

- Repris du backlog de #199 / #200 (code au commit `4e06052`, retiré par #243), par composant : tous les éléments (exigences, tests, issues) dont
  un changement **n'a jamais été inclus dans une version** — créés depuis, ou modifiés depuis l'état
  de la dernière version qui les incluait. Les modifications hors interface d'un élément approuvé
  (#200 §5) y restent signalées.
- Depuis le backlog : « Inclure dans <version en cours> » (une ou plusieurs lignes), « Voir les
  modifications ». Calculé, pas stocké (comme aujourd'hui).
- `base` = état de l'élément dans la dernière version released qui l'incluait (commit et `version`),
  absent sinon. Calculée à l'inclusion, recalculée au gel (#268).

### 3.5 Navigation

Sous-panneau **« Produit »** dans le panneau **Version** existant : liste déroulante du composant, puis
son backlog et ses versions (statut, label ; dépliées : structure des composants et leur version),
« Nouvelle version », ouverture de la page.

## 4. L'issue

> **Livré par #244** (`specs/GH244.md`, SPEC-REQ §12). Vues Tableau et Document comme les exigences ; import
> Excel : proposition par ligne du bilan ; origine affichée en texte sur la fiche.

### 4.1 Objet

Nouvelle catégorie **`issue`** : types configurables (bug, non-conformité, demande d'évolution…),
`prefix`, `fields`, `statuses`. Une issue représente une **modification du produit non tracée dans
les exigences** (ex. correction de bug), ou un constat à traiter. Elle est **associée à un
composant** (celui du nœud de son type) et stockée dans son repo.

```yaml
# issues/ISS-0007.yaml   (repo du composant bms)
id: ISS-0007
objectTypeRef: root::issue
title: Coupure intempestive à -10 °C
status: corrigee
origin: { runs: [TST-0012-run-0004], decisions: [] }   # ex-Changeset.origin
fields: { … }
history: …
```

- **Exigences impactées** : liens `links.yaml` d'un type **`issue-impact`** déclaré par défaut
  (issue → exigence). Une issue ne peut impacter que des exigences **de son composant** (contrôle
  à la création du lien : même repo, type déclaré par son schéma, `NOT_OWN_ELEMENT` sinon).
- Une issue entre dans une version comme les exigences et tests : par le **backlog** ou « Ajouter »
  (§3.3, §3.4). Ses exigences impactées sont des racines de l'analyse d'impact de la version.
- Pas de verrou d'approbation sur une issue (ce n'est pas de la spec).

### 4.2 Vue Issues

Entrée de la barre d'activité (à la place de « Changesets ») : liste filtrable dans le panneau
latéral, page de création et de modification.

### 4.3 Proposition de création (popup, jamais automatique)

| Déclencheur | Pré-remplissage |
|---|---|
| Exécution enregistrée en **échec** (FAIL / BLOCKED) | `origin.runs`, liens d'impact = exigences du test (instance) |
| Décision portant `proposesIssue` (ex. non conforme, dérogation — vue Validation) | `origin.decisions`, lien d'impact = l'exigence |

La popup propose « Créer une issue », « Lier à une issue existante », « Ignorer ».

## 5. La validation (ex-revue de conformité, #191 §3)

La validation est le **feu vert donné à une version** : sa signature sur la version produit vaut go
production série. Une validation est donc **toujours associée à une version**. Le mot est pris au sens
courant (« valider une version »), pas au sens vérification / validation de la norme.

> **Livré par #204 et #205** (`specs/GH204.md`, SPEC-REQ §13). Écarts tranchés : champ `versionId` ; une seule validation
> non annulée par version, une signée peut être annulée ; `evidence` abandonnée ; « modifié depuis la décision » par
> empreinte du contenu ; version released lue à l'état figé ; validations des composants affichées, non bloquantes.

### 5.1 Objet

Catégorie **`validation`** (nom unique dans le code, le stockage, le graphe et l'interface, à la place du
`conformity` de GH191 §3.1). Une validation porte sur **une version** (`versionId: <ID>`, obligatoire) et a
une description. Détail livré : `specs/GH204.md`, SPEC-REQ §13. Points retenus :

- **Décisions configurables** dans le type de validation, avec un **commentaire / justificatif**
  (`entryFields` du projet en plus). Jeu par défaut : `en_attente`, `conforme`, `non_conforme`,
  `hors_scope`, `derogation`. Polenta ne lit que deux marques posées sur les valeurs :
  `isPending` (valeur par défaut d'une entrée ; bloque la signature — `en_attente`) et
  `proposesIssue` (popup §4.3 — `non_conforme`, `derogation`).
- Le **jalon** reste un champ du projet ; `configurationRef` est remplacé par `versionId`.

### 5.2 Vue Validation

- **Liste déroulante de composant**, puis version à valider (version produit = nœud racine).
- Une ligne par **exigence du composant choisi**, hors statut terminal, sans sélecteur de périmètre :
  `hors_scope` en tient lieu (P2). Les exigences des sous-composants ont leur propre validation :
  - **en écriture** : décision, commentaire ;
  - **en lecture seule** : statut de rédaction, statut de design (version première dispo, lien),
    statut de vérification (couverture), signal d'impact (§5.3).
- Sous chaque exigence, **ses tests** avec les infos de leur dernière exécution ; sous chaque test,
  **ses exécutions** : version testée et sa structure figée (run), résultat, commentaire. Une exécution
  sur une autre version que celle validée, ou dont la structure a évolué depuis, est signalée.
- Une validation signée se lit dans la **copie prise à la signature** (`atSignature`, #267) : liens retirés ou
  nouveaux runs ne la changent plus.

### 5.3 Signal d'impact

Une exigence impactée ou changée dans la version validée affiche « impactée » avec sa source
(§3.3) ; sa décision part de la valeur `isPending`. Un élément marqué **« pas d'impact réel » ne compte
pas comme impacté**.

### 5.4 Reprise

À la création, les décisions de la validation signée de la version `basedOn` sont **reprises**
pour les exigences ni changées ni impactées (sans mention particulière) ; les autres partent de
la valeur `isPending`.

### 5.5 Signature

Réservée aux **versions released** (P3). Refus tant qu'une décision est `isPending`, proposée (MCP) ou
« à revoir ». Signer commite le seul fichier, **sans tag ni baseline** : le tag de la version fige déjà l'état.
La signature copie dans chaque entrée ce qui fondait la décision (#267). Détail : GH204 §4, SPEC-REQ §13.

## 6. Exécutions : version testée (#191 §2.5 adapté)

- **Une campagne ne porte ni baseline ni version** (GH243 ; décision du 2026-11-02). Ce sont les
  **exécutions** qui testent une version.
- **Une campagne ne contient que les tests de son repo** (#255, décision du 2026-11-05 ; `TEST_OTHER_REPO`) :
  un test de composant se teste dans une campagne du composant.
- Run : `testedConfig` = **copie figée de la structure testée** : version testée (`ref`), versions par
  composant, commit, écarts non documentés. La composition d'une version peut évoluer après une exécution :
  la copie permet de **tracer cette évolution** en la comparant à la version courante.
- Une exécution peut porter sur une version **en cours** comme sur une version released.
- Pré-remplissage à la saisie : la version de la dernière exécution de la campagne, sans rien stocker sur
  la campagne.
- **Livré par #202** (`specs/GH202.md`) : version du repo de la campagne, saisie obligatoire dès qu'une version
  est sélectionnable ; la liste des changements n'est pas copiée : elle est historisée dans la version
  (`history.changes`) et le run référence l'entrée en vigueur (`changesAt`).

## 7. Ce qui est retiré, conservé, déplacé

| | Éléments |
|---|---|
| **Retiré** | objet changeset (`changesets/`, `packages/types/src/change.ts`, `ChangesService`, IPC `changesets:*`), vue et routes `changeset*`, assignation à la création / réouverture (`ApprovalGateContext` côté changeset, `AssignToChangeDialog`, `CreateChangeButton`), dialogue d'assignation à l'approbation, préférence `changeTracking`, MCP `changes.tools`, `changesetId` / `unassigned`, champ `changeset` et `baselineRef` de la campagne, `GraphChangeset` (manifeste du graphe +1). Pas de migration : les fichiers `changesets/` existants sont ignorés (données de test) |
| **Conservé dans le code** | verrou de l'approuvé (services, MCP, vues) ; réouverture par changement de statut, **uniforme** dans toutes les vues ; règle de version `versionBump` (version + 1 en quittant `isApproval`) ; diff par élément (`sync:diff-element`, route `/diff?element&baseSha&toSha`) ; moteur d'arbres d'impact (`buildImpactTreesFromSnapshot`, `ImpactTrees`, statuts d'impact) |
| **Conservé dans l'historique git** (commit `4e06052`, retiré par #243) | backlog et détection hors interface (`useBacklog`, `change-tracking.service` : `outsideModifications`, `fileCommits`, calcul de `base`), sélecteur d'éléments (`ChangeElementPicker`), analyse d'un ensemble de changements (`change-analysis.util`, `ChangeAnalysisSection`), tests à exécuter (`change-tests.util`), section campagnes (`ChangeCampaignsSection`) — réintroduits adaptés à la version par #201 (backlog, sélecteur, `base`) et #245 (analyse, tests) ; la section campagnes ne l'est pas (Q9) |
| **Déplacé** | analyse des modifications locales (`changesets_.local`, T175) et liste « Impact à vérifier » (`changesets_.revalidation`) → entrées du panneau Version (`/local-impact`, `/revalidation`) ; Constellation → panneau Exigences ; le backlog a retrouvé un écran avec #201 |

## 8. Graphe et MCP

- Graphe : collections `versions` (`basedOn`, `components`, `freeze` avec `at`, `changes`, `impacted`, `analysis`),
  `issues` (`origin` ; impacts dans `links`), `validations` (entrées, décisions, copie `atSignature` ; la
  signature se lit dans `history.status`) ;
  `GraphTestRun.testedConfig`. `GraphChangeset` retiré.
- MCP : lecture des versions (changements, tests à exécuter), création / mise à jour d'issues,
  décisions **proposées** de validation (GH191 Q6). Le MCP ne passe pas une version `released` et ne
  signe pas.

## 9. Sort des lots

| Lot | Issue | Sort |
|---|---|---|
| 1–3 | #195–#197 | livrés, inchangés |
| 4, 5 | #198, #199 | livrés ; objet changeset retiré, moteur d'analyse conservé (§7) |
| 6 | #200 | livré ; verrou conservé, assignation retirée |
| 13 | #207 | livré ; tests à exécuter repris par la version (#245), sans lien campagne ↔ version (Q9) |
| 7 | #201 | **réécrit** : objet version (§3) |
| 8 | #202 | **réécrit** : version testée, copie de structure dans le run (§6) |
| 9 | #203 | inchangé (vues enregistrées ⚙️) |
| 10, 11 | #204, #205 | **amendés** : validation (§5) |
| 12 | #206 | **amendé** : conditions changeset et `allDecided` (P5) retirées ; restent `fieldsFilled`, `hasCoverageLink` |
| 14 | #208 | **caduc** : la version produit couvre le multi-composant |
| 15 | #209 | **caduc** : remplacé par l'issue et ses popups (§4.3) |
| 16 | #210 | **amendé** : reflets = les quatre statuts (§2) dans les vues exigence |
| — | #214 | traité à part, avant #206 (P6) ; livré |

### Nouveau découpage proposé

| Ordre | Lot | Contenu | Dépend de |
|---|---|---|---|
| 1 | **Retrait du changeset** | §7 (retirer, conserver, déplacer) ; réouverture uniforme par le statut ; `baselineRef` de la campagne retiré | — |
| 2 | **Version** (#201) | objet, sous-panneau Produit, page (composants, changements, diff), backlog et « Ajouter », tag au passage released, verrou | 1 |
| 3 | **Impact et tests de la version** | analyse, source d'impact, tests à exécuter | 2 |
| 4 | **Issue** (nouveau) | objet, vue Issues, racines d'impact, popup sur échec | 2 |
| 5 | **Version testée** (#202) | §6 | 2 |
| 6 | Vues enregistrées (#203) | inchangé ; avant la validation, dont la vue s'en sert | — |
| 7 | **Validation** (#204 + #205) | objet, vue, quatre statuts, signal d'impact, reprise, signature, popup NC / dérogation | 3, 4, 5 |
| 8 | Contraintes de transition (#206) | §9 | — (P5) |
| 9 | Reflets (#210) | quatre statuts dans les vues exigence | 7 |

Lots 1 à 7 livrés sur `main` (PR #248, #249, #259 ; dernier merge le 2026-11-04). Restent les lots 8 et 9, après les
correctifs de la revue du 2026-11-04 (§12). Numéros dans les titres d'issues : #203 = 6/9, #204 + #205 = 7/9, #206 = 8/9,
#210 = 9/9.

## 10. Reports après validation

- `specs/GH193.md`, `specs/GH191.md`, `specs/MODELE-OBJETS.md` : en-tête « remplacé par
  `specs/MILESTONE-D.md` » sur les sections concernées (changeset, configurations, revue).
- Issues : #201, #202, #204, #205, #206, #210 amendées ; #208, #209 fermées (caduques) ; nouvelles
  issues « Retrait du changeset », « Issue », « Impact et tests de la version ».
- `SPEC-REQ §10`, `SPEC-TRACEABILITY §4`, `SPEC-TESTS §4.1`, `SPEC-DASHBOARDS`, `SPEC-MCP-SERVER`,
  `SPEC-TEMPLATES` : à la livraison de chaque lot.

## 11. Questions tranchées (2026-10-31)

| # | Question | Décision |
|---|---|---|
| Q1 | Comment un changement (exigence, test, issue) entre-t-il dans une version ? | par le **backlog** (changements jamais inclus dans une version) et un bouton **« Ajouter »** pour n'importe quel élément (§3.3, §3.4) |
| Q2 | Exigences impactées d'une issue | liens **`links.yaml`** (`issue-impact`) ; une issue est associée à un composant et n'impacte que ses exigences |
| Q3 | Vue Validation d'un composant | **ses exigences seulement** |
| Q4 | Statut de design | **première version du composant** de l'exigence |
| Q5 | Une version released exige des sous-versions released | **oui** |
| Q6 | Valeurs de décision | **configurables** ; marques `isPending` / `proposesIssue` |
| Q7 | Déplacements du §7 | **validés** |
| Q8 | Campagne et baseline | une campagne ne teste plus une baseline : `baselineRef` retiré ; les exécutions testent une version (§6 ; précisé par #202 : une version du repo de la campagne) |

### Revue du 2026-11-02, après les lots 1 à 3

| # | Question | Décision |
|---|---|---|
| Q9 | Version prévue sur la campagne | **abandonnée** : aucun lien campagne ↔ version. La **validation**, elle, est toujours associée à une version : c'est le feu vert (go production série) |
| Q10 | Exécution sur une version en cours | **oui** ; sa composition pouvant évoluer ensuite, le run garde une **copie de la structure testée** pour tracer l'évolution |
| Q11 | « Pas d'impact réel » en validation | **ne compte pas comme impacté** (signal, reprise) |
| Q12 | Nom technique de l'objet | **`validation`** partout, au sens courant de « valider une version » |

### Revue du 2026-11-03, après le lot 4

P1 à P6 : propositions **validées** le 2026-11-03. P7 : #272.

| # | Point | Lot | Décision |
|---|---|---|---|
| P1 | **Statut de design** : le code retient toute version dont le commit figé contient le fichier dans la même `version`. Une exigence jamais incluse (au backlog « nouveau ») a donc déjà un statut de design, et un brouillon modifié après le gel garde le sien (`version` ne monte qu'en quittant l'approbation), alors que le backlog le dit « modifié » | #204, #210 | exiger que la version inclue l'exigence, et comparer le contenu comme le backlog |
| P2 | **Périmètre de la validation** : §5.2 prend toutes les exigences du composant ; #204 et #205 gardent un sélecteur de périmètre, « ajouter / retirer », et des décisions sur les tests | #204, #205 | exigences seulement, sans sélecteur : `hors_scope` joue ce rôle ; exigences terminales exclues |
| P3 | **Signature** : §5.5 pose une baseline, l'issue #204 le laisse à trancher, comme la signature d'une version en cours. L'analyse d'une version en cours reste vivante : le signal d'impact (§5.3) et la reprise (§5.4) peuvent changer après la création de la validation | #204 | signature réservée aux versions released, sans baseline (le tag de version fige déjà l'état) |
| P4 | **Quatrième statut dans les vues exigence** : « décision de la dernière validation » n'est pas définie (dernière signée ? de quelle version ?) | #210 | décision de la dernière validation signée du composant, avec le label de sa version |
| P5 | **`allDecided`** (#206) double le refus de signature de §5.5 | #206 | retirer `allDecided` ; #206 ne dépend alors plus de la validation |
| P6 | **#214** (`requiredWhen` et renommages) est au milestone sans lot ni place dans la PR #249 | — | le traiter à part, avant #206 |
| P7 | **`MODELE-OBJETS.md`** n'a pas été redessiné au lot Version comme annoncé | — | le redessiner à la fin du milestone, une fois la validation livrée |

### Revue du 2026-11-04, après le lot 7

| # | Point | Ticket | Décision |
|---|---|---|---|
| R1 | Une validation signée change encore quand ses liens ou ses runs changent | #267 | **figer à la signature** : copie `atSignature` par entrée (2026-11-05) |
| R2 | Test de composant dans une campagne produit, à moitié pris en charge | #255, #269 | **l'interdire** : une campagne ne contient que les tests de son repo (2026-11-05) |
| R3 | Branches sur lesquelles une version peut passer released | #268 | **ouverte** : la spec ne restreint pas les branches |

## 12. Plan après la revue du 2026-11-04

Plan suivi dans la description du milestone GitHub, repris ici le 2026-11-05.

| Ordre | Priorité | Tickets | État au 2026-11-05 |
|---|---|---|---|
| 1 | P1 | #256 web, exécution bloquée | livré sur `main` |
| 2 | P1 | #266 validation, bloquants | livré sur `milestone-D` |
| 3 | P2 | #267 preuve figée à la signature | livré sur `milestone-D` |
| 4 | P2 | #268 versions ; #254 préfixe ; #255 + #269 composant vu du produit | livrés sur `milestone-D` |
| 5 | P2 | #270 specs alignées, avant les specs de #206 et #210 | ce document |
| 6 | P3 | #206 contraintes de transition ; #210 reflets | à spécifier |
| 7 | P2 / P3 | #253 suite e2e rouge ; #271 tests absents ; #252 rattrapage web | à faire |
| 8 | P3 | #272 `MODELE-OBJETS.md` | à faire |
| 9 | — | Suite e2e complète, validation humaine, merge dans `main` | à faire |

## Refs

`specs/GH191.md` (§2.5, §3), `specs/GH193.md`, `specs/GH193-point.md`, `specs/GH199.md`,
`specs/GH200.md`, `specs/GH207.md`, `specs/MODELE-OBJETS.md` ; `SPEC-TRACEABILITY.md §2.2, §4` ;
issues #191, #193, #195–#210, #214.
