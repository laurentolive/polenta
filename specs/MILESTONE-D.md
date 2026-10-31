# Milestone D — spec globale consolidée : versions, issues, validation (2026-10-31)

> Refonte des épiques #191 (conformité) et #193 (changement) après les échanges du 2026-10-31.
> Remplace, pour la suite du milestone, `specs/GH193-point.md` §3–§4 et les parties de
> `specs/GH191.md` / `specs/GH193.md` listées au §9. Une fois validée, ses décisions sont reportées
> dans ces deux specs et dans les issues (§10) ; ce document reste comme trace.

## 1. But

Permettre à la **qualité de statuer**, exigence par exigence, sur la **conformité d'une version du
produit**, au regard des tests exécutés, et de tracer **sur quelle version** chaque test a été
exécuté.

Le **changeset disparaît** : son contenu (éléments changés, analyse d'impact, tests à exécuter,
campagne) est porté par la **version** du composant, calculé entre la version précédente et
celle-ci. Le « pourquoi » d'une modification non tracée dans les exigences est porté par une
**issue**.

## 2. Les quatre statuts d'une exigence

| Statut | Sens | Origine | Saisi / calculé |
|---|---|---|---|
| **Rédaction** | statut actuel (brouillon, review, approuvé…) | `status` | saisi |
| **Design** | première version **released** du composant de l'exigence dont l'état figé contient l'exigence **dans sa version courante** (`version`) | versions (§3) | calculé ; « — » si aucune |
| **Vérification** | statut de couverture actuel (`not_covered`, `covered`, `validated`, `failing`, `needs_revalidation`, SPEC-TRACEABILITY §2.2) ; le détail des exécutions donne la version prévue et la version testée | liens, exécutions | calculé (inchangé) |
| **Validation** | décision qualité pour une version donnée, avec commentaire | validation (§5) | saisi |

Les quatre servent des fonctions de Polenta (vue Validation, reflets) : calculés dans Polenta (GH79).

## 3. La version (composant ou produit)

### 3.1 Objet

Nouvelle catégorie d'objet **`version`**, déclarée dans le schéma de chaque nœud comme les autres
types : `prefix` (unique sur le projet), `fields` du projet, `statuses`. IDs système séquentiels
(GH20, pierres tombales) ; le **label** (ex. `1.2.4`) est le `title`.

```yaml
# versions/MCV-0004.yaml   (repo du composant motor-control)
id: MCV-0004
objectTypeRef: motor-control::version
title: "1.2.4"                       # label
status: released                     # statuts du type ; isApproval = released
basedOn: MCV-0003                    # version précédente (sert à établir les changements)
components:                          # versions des sous-composants (nœuds enfants du schéma)
  bms: BMSV-0002
  turbine: TRBV-0001
freeze: { tag: version/motor-control/1.2.4, sha: a91c3d2 }   # posé au passage released
changes:                             # changements inclus (§3.3), alimentés depuis le backlog (§3.4)
  - id: SW-0042
    base: { sha: 4be1f09, version: 3 }   # état dans la dernière version qui l'incluait ; absent = nouveau
  - id: ISS-0007
campaigns: [CAMP-0009]               # campagnes associées (§3.3)
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
  - lignes affichées = éléments impactés **de ce composant seulement** (les sous-composants ont la
    leur) ; chaque ligne porte sa **source** (racine et chemin qui l'amènent) ;
  - statuts d'impact sur les nœuds (8 valeurs, GH199) inchangés ;
  - un élément impacté est **signalé dans la vue Validation** de cette version (§5.3).
- **Tests à exécuter** (#207, inchangé dans son calcul et sa présentation) : liste cochable, élément
  qui amène chaque test, « Déjà dans » ; **Créer une campagne** / **Ajouter à …** associent la
  campagne à la version (`campaigns` ↔ `version` de la campagne).

### 3.4 Backlog des changements

- Repris du backlog de #199 / #200, par composant : tous les éléments (exigences, tests, issues) dont
  un changement **n'a jamais été inclus dans une version** — créés depuis, ou modifiés depuis l'état
  de la dernière version qui les incluait. Les modifications hors interface d'un élément approuvé
  (#200 §5) y restent signalées.
- Depuis le backlog : « Inclure dans <version en cours> » (une ou plusieurs lignes), « Voir les
  modifications ». Calculé, pas stocké (comme aujourd'hui).
- À l'inclusion, `base` = état de l'élément dans la dernière version released qui l'incluait
  (commit et `version`), absent sinon.

### 3.5 Navigation

Sous-panneau **« Produit »** dans le panneau **Version** existant : arbre des composants, versions de
chacun (statut, label), backlog de chaque composant, « Nouvelle version », ouverture de la page.

## 4. L'issue

### 4.1 Objet

Nouvelle catégorie **`issue`** : types configurables (bug, non-conformité, demande d'évolution…),
`prefix`, `fields`, `statuses`. Une issue représente une **modification du produit non tracée dans
les exigences** (ex. correction de bug), ou un constat à traiter. Elle est **associée à un
composant** (celui du nœud de son type) et stockée dans son repo.

```yaml
# issues/ISS-0007.yaml   (repo du composant bms)
id: ISS-0007
objectTypeRef: bms::issue
title: Coupure intempestive à -10 °C
status: corrigee
origin: { runs: [RUN-20261030-004], decisions: [] }   # ex-Changeset.origin
fields: { … }
history: …
```

- **Exigences impactées** : liens `links.yaml` d'un type **`issue-impact`** déclaré par défaut
  (issue → exigence). Une issue ne peut impacter que des exigences **de son composant** (contrôle
  à la création du lien, `sourceRefs` / `targetRefs` limités au nœud).
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
| Exécution sur une **version testée différente** de la version prévue | `origin.runs`, écart dans la description |

La popup propose « Créer une issue », « Lier à une issue existante », « Ignorer ».

## 5. La validation (ex-revue de conformité, #191 §3)

### 5.1 Objet

Catégorie `conformity` de GH191 §3.1, renommée **validation** dans l'interface. Une validation porte
sur **une version** (`version: <ID>`) et a une description. Le reste de GH191 §3 s'applique, avec
les écarts suivants :

- **Décisions configurables** dans le type de validation, avec un **commentaire / justificatif**
  (`entryFields` du projet en plus). Jeu par défaut : `en_attente`, `conforme`, `non_conforme`,
  `hors_scope`, `derogation`. Polenta ne lit que deux marques posées sur les valeurs :
  `isPending` (valeur par défaut d'une entrée ; bloque la signature — `en_attente`) et
  `proposesIssue` (popup §4.3 — `non_conforme`, `derogation`).
- Le **jalon** reste un champ du projet ; `configurationRef` est remplacé par `version`.

### 5.2 Vue Validation

- **Liste déroulante de composant**, puis version à valider (version produit = nœud racine).
- Une ligne par **exigence du composant choisi** (pas celles de ses sous-composants, qui ont leur
  propre validation) :
  - **en écriture** : décision, commentaire ;
  - **en lecture seule** : statut de rédaction, statut de design (version première dispo, lien),
    statut de vérification (couverture), signal d'impact (§5.3).
- Sous chaque exigence, **ses tests** avec les infos de leur dernière exécution ; sous chaque test,
  **ses exécutions** : version prévue (campagne), version effectivement testée (run), résultat,
  commentaire. Écarts prévue / testée surlignés.

### 5.3 Signal d'impact

Une exigence impactée ou changée dans la version validée affiche « impactée » avec sa source
(§3.3) ; sa décision part de la valeur `isPending`.

### 5.4 Reprise

À la création, les décisions de la validation signée de la version `basedOn` sont **reprises**
pour les exigences ni changées ni impactées (sans mention particulière) ; les autres partent de
la valeur `isPending`.

### 5.5 Signature

GH191 §3.7 inchangé : refus tant qu'une décision est `isPending`, proposée (MCP) ou « modifiée
depuis la décision » ; commit et baseline documentaire posés sur le commit de la validation.

## 6. Exécutions : version prévue, version testée (#191 §2.5 adapté)

- **Une campagne ne teste plus une baseline** : `baselineRef` de la campagne et le choix
  correspondant du formulaire (T46, GH207 Q4) sont **retirés**. Ce sont les **exécutions** qui
  testent une version produit.
- Campagne : `version: <ID de version>` = **version prévue**, qui sert à pré-remplir les exécutions
  (remplace `changeset` de GH207 et `configurationRef`).
- Run : `testedConfig` = version produit effectivement testée (`ref`) + versions effectives par
  composant + écarts non documentés ; copié et figé, pré-rempli depuis la campagne.

## 7. Ce qui est retiré, conservé, déplacé

| | Éléments |
|---|---|
| **Retiré** | objet changeset (`changesets/`, `packages/types/src/change.ts`, `ChangesService`, IPC `changesets:*`), vue et routes `changeset*`, assignation à la création / réouverture (`ApprovalGateContext` côté changeset, `AssignToChangeDialog`, `CreateChangeButton`), dialogue d'assignation à l'approbation, préférence `changeTracking`, MCP `changes.tools`, `changesetId` / `unassigned`, champ `changeset` et `baselineRef` de la campagne, `GraphChangeset` (manifeste du graphe +1). Pas de migration : les fichiers `changesets/` existants sont ignorés (données de test) |
| **Conservé** | verrou de l'approuvé (services, MCP, vues) ; réouverture par changement de statut, **uniforme** dans toutes les vues (version + 1) ; **backlog** (`useBacklog`, détection hors interface) et sélecteur d'éléments (`ChangeElementPicker`) ; trace `base` (`change-tracking.service`) ; moteur d'analyse (`change-analysis.util`), statuts d'impact ; calcul des tests à exécuter (`change-tests.util`) ; diff par élément (`sync:diff-element`) ; section campagnes (`ChangeCampaignsSection`) — rattachés à la version |
| **Déplacé** | backlog (`changesets_.backlog`), analyse des modifications locales (`changesets_.local`, T175) et liste « Impact à vérifier » (`changesets_.revalidation`) → panneau Version ; Constellation → panneau Exigences |

## 8. Graphe et MCP

- Graphe : collections `versions` (`basedOn`, `components`, `freeze`, `changes`, `campaigns`),
  `issues` (`origin` ; impacts dans `links`), `validations` (entrées, décisions) ; `GraphCampaign.version`,
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
| 13 | #207 | livré ; tests à exécuter et campagne rattachés à la version |
| 7 | #201 | **réécrit** : objet version (§3) |
| 8 | #202 | **amendé** : version prévue / testée (§6) |
| 9 | #203 | inchangé (vues enregistrées ⚙️) |
| 10, 11 | #204, #205 | **amendés** : validation (§5) |
| 12 | #206 | **amendé** : conditions changeset retirées ; restent `fieldsFilled`, `hasCoverageLink`, `allDecided` (+ éventuellement conditions de version) |
| 14 | #208 | **caduc** : la version produit couvre le multi-composant |
| 15 | #209 | **caduc** : remplacé par l'issue et ses popups (§4.3) |
| 16 | #210 | **amendé** : reflets = les quatre statuts (§2) dans les vues exigence |
| — | #214 | inchangé |

### Nouveau découpage proposé

| Ordre | Lot | Contenu | Dépend de |
|---|---|---|---|
| 1 | **Retrait du changeset** | §7 (retirer, conserver, déplacer) ; réouverture uniforme par le statut ; `baselineRef` de la campagne retiré | — |
| 2 | **Version** (#201) | objet, sous-panneau Produit, page (composants, changements, diff), backlog et « Ajouter », tag au passage released, verrou | 1 |
| 3 | **Impact et tests de la version** | analyse, source d'impact, tests à exécuter, campagne ↔ version | 2 |
| 4 | **Issue** (nouveau) | objet, vue Issues, racines d'impact, popup sur échec | 2 |
| 5 | **Version prévue / testée** (#202) | §6, popup version différente | 2, 4 |
| 6 | **Validation** (#204 + #205) | objet, vue, quatre statuts, signal d'impact, reprise, signature, popup NC / dérogation | 3, 4, 5 |
| 7 | Contraintes de transition (#206) | §9 | — |
| 8 | Vues enregistrées (#203) | inchangé | — |
| 9 | Reflets (#210) | quatre statuts dans les vues exigence | 6 |

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
| Q8 | Campagne et baseline | une campagne ne teste plus une baseline : `baselineRef` retiré ; les exécutions testent une version produit (§6) |

## Refs

`specs/GH191.md` (§2.5, §3), `specs/GH193.md`, `specs/GH193-point.md`, `specs/GH199.md`,
`specs/GH200.md`, `specs/GH207.md`, `specs/MODELE-OBJETS.md` ; `SPEC-TRACEABILITY.md §2.2, §4` ;
issues #191, #193, #195–#210, #214.
