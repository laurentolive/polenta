# SPEC-TESTS — Module Gestion des Tests

> Référence parent : [SPEC.md](../SPEC.md) §2.2–2.3  
> Voir aussi : [SPEC-REQ-requirements.md](SPEC-REQ-requirements.md) (modèle de référence pour la définition)  
> Voir aussi : [SPEC-TEMPLATES.md](SPEC-TEMPLATES.md) (champs configurables)

---

## 1. Vue d'ensemble

Le module Tests se divise en deux périmètres distincts :

| Périmètre | Objet | Stockage git |
|-----------|-------|--------------|
| **Définition** | Ce qu'on doit tester et comment | `tests/TEST-0001.yaml` |
| **Exécution** | Ce qui s'est passé quand on l'a fait | `executions/TEST-0001/<run-id>.yaml` |

Un cas de test (`TestCase`) peut être exécuté plusieurs fois, dans des contextes différents (versions du produit, environnements, campagnes). Chaque exécution est un `TestRun` indépendant.

```
TestCase (définition versionnée)
  │
  ├── version 1  ← APPROVED
  │     └── TestRun A  (résultat: PASS)
  │     └── TestRun B  (résultat: FAIL)
  │
  └── version 2  ← APPROVED (après correction du test)
        └── TestRun C  (résultat: PASS)

TestCampaign  (runs[] : statut par test, voir §4)
  ├── TestRun A  (TEST-0001 v1)
  ├── TestRun D  (TEST-0002 v1)
  └── TestRun E  (TEST-0003 v1)
```

**Exposition MCP (T122)** : un agent IA peut lister (`list_tests`/`list_campaigns`) et
créer en masse (`bulk_import_tests`/`bulk_import_campaigns`, avec `dryRun` obligatoire
par défaut) des `TestCase`/`TestCampaign` via le serveur MCP, en réutilisant
`TestsService.create`/`CampaignsService.create` tel quel — mêmes DTOs, mêmes règles
d'ID que la création UI. `TestRun`/exécution restent hors périmètre MCP (pas de tool
d'exécution de test). Voir `SPEC-MCP-SERVER.md` §4.

---

## 2. Définition d'un cas de test (TestCase)

### 2.1 Principe

La définition d'un cas de test suit le même modèle que les exigences :
- Cycle de vie **brouillon / version approuvée**
- **Versionnement entier** (1, 2, 3…) — une version = une approbation
- **Champs configurables** via le template de projet
- **Identifiant stable** `TEST-XXXX` (compteur global au projet, jamais réutilisé)

### 2.2 Champs système (toujours présents)

| Champ | Type | Description |
|-------|------|-------------|
| `id` | string | Identifiant stable (ex. `TEST-0042`), préfixe configurable dans le template |
| `title` | TEXT | Titre du cas de test (obligatoire) |
| `type` | ENUM | `manual` / `automated` / `semi-automated` |
| `status` | — | Statut workflow configurable (voir §2.6) |
| `currentVersion` | int \| null | Numéro de la dernière version approuvée |
| `hasDraft` | bool | Vrai si un brouillon est en cours |
| `linkedRequirements` | list | IDs des exigences couvertes par ce test (voir §2.4) |
| `preconditions` | RICHTEXT | État du système requis avant d'exécuter le test |
| `equipment` | list | Matériel requis pour réaliser le test (voir §2.3) |
| `steps` | list | Étapes ordonnées (voir §2.4) |
| `postconditions` | RICHTEXT | Actions de nettoyage / remise en état après le test |
| `createdAt` | DATETIME | — |
| `createdBy` | USER | — |
| `updatedAt` | DATETIME | — |
| `updatedBy` | USER | — |
| `history` | map? | **GH77** — historique des champs suivis (statut par défaut), posé par l'application seule — voir [SPEC-REQ §4.4](SPEC-REQ-requirements.md#44-historique-des-champs-suivis-gh77) |

### 2.3 Matériel requis (EquipmentRequirement)

La liste de matériel décrit ce dont le testeur a besoin pour réaliser le test. Chaque item est une **spécification fonctionnelle** de l'équipement (pas un équipement physique précis — ça, c'est dans l'exécution).

| Attribut | Type | Description |
|----------|------|-------------|
| `id` | string | Identifiant local à la définition (ex. `eq-1`), stable entre les versions |
| `role` | TEXT | Rôle fonctionnel dans le test (ex. `"Produit sous test"`, `"Oscilloscope"`, `"Alimentation réglable"`) |
| `description` | TEXT | Spécifications minimales requises (ex. `"Bande passante ≥ 100 MHz, 4 voies"`) |
| `required` | bool | `true` = indispensable, `false` = optionnel |
| `quantity` | NUMBER | Nombre d'unités nécessaires (défaut 1) |

**Format YAML :**
```yaml
equipment:
  - id: eq-1
    role: "Produit sous test"
    description: "Aspirateur sans fil, révision HW ≥ B"
    required: true
    quantity: 1

  - id: eq-2
    role: "Oscilloscope"
    description: "Bande passante ≥ 100 MHz, 4 voies, sondes 10x"
    required: true
    quantity: 1

  - id: eq-3
    role: "Alimentation réglable"
    description: "18V / 5A minimum, précision ±10mV"
    required: true
    quantity: 1

  - id: eq-4
    role: "Multimètre"
    description: "Classe 1, mesure courant AC/DC"
    required: true
    quantity: 1

  - id: eq-5
    role: "Thermomètre d'ambiance"
    description: "Précision ±0.5°C"
    required: false
    quantity: 1
```

**Règles :**
- L'`id` est stable entre les versions du test — il sert de clé de correspondance dans l'exécution (voir §3.2).
- Ajouter un équipement requis à une version approuvée nécessite un nouveau brouillon (car ça change les conditions d'exécution).

### 2.4 Étapes (TestStep)

Les étapes sont la spécificité du cas de test. Chaque étape est une paire :

| Attribut | Type | Description |
|----------|------|-------------|
| `order` | int | Position (1, 2, 3…) |
| `action` | RICHTEXT | Ce que le testeur doit faire (peut contenir images, schémas de câblage) |
| `expectedResult` | RICHTEXT | Ce qui doit se passer (valeurs, états, mesures attendus) |
| `notes` | RICHTEXT | Précision d'implémentation, conseil au testeur (optionnel) |

**Format YAML :**
```yaml
steps:
  - order: 1
    action: "Mettre la batterie à 50% de charge"
    expectedResult: "Indicateur de charge affiché à 2 barres sur 4"

  - order: 2
    action: "Appuyer sur le bouton démarrage"
    expectedResult: "Le moteur démarre en mode Éco en moins de 500ms. LED verte fixe."

  - order: 3
    action: "Maintenir le bouton démarrage appuyé 3 secondes"
    expectedResult: >
      Le mode passe de Éco à Normal.
      LED verte passe de fixe à clignotante (1 Hz).
      Le bruit moteur monte perceptiblement.

  - order: 4
    action: "Relâcher le bouton"
    expectedResult: "L'aspirateur reste en mode Normal. Aucune transition parasite."
```

**Règles :**
- Les étapes sont toujours **à plat** — pas de sous-étapes. Pour structurer un test long en phases, on utilise une étape de titre (action = `"— Phase 2 : Mesures —"`, expectedResult vide).
- Au moins une étape est requise pour soumettre le test en review.
- Les étapes sont renumérotées automatiquement si on insère ou supprime.
- L'ordre est la seule clé de référence — pas d'identifiant d'étape stable (les étapes ne sont pas versionnées individuellement).

### 2.4a Paramètres de test (T97)

Un test peut être **paramétré** : dans `preconditions`, `postconditions`, `action` ou
`expectedResult` d'une étape, une sous-chaîne `{label}` (alphanumérique, `_`/`-`, pas
d'espace, pas d'accolade imbriquée — ex. `{voltage}`, `{max_current}`) référence un
paramètre. **Il n'existe pas de liste de paramètres déclarée séparément** — la référence
`{label}` dans le texte est elle-même la déclaration ; la liste des paramètres d'un test
est calculée en scannant ces champs, unique par label, dans l'ordre de première
apparition (`preconditions` → étapes triées par `order`, `action` puis `expectedResult`
→ `postconditions`). `TestStep.notes` n'est **pas** scanné : ce champ n'étant affiché
nulle part dans le contexte d'une campagne (ni à l'exécution, ni à la relecture), un
paramètre qui n'y apparaîtrait que là n'aurait aucune valeur substituée visible.

**Depuis T171, la syntaxe `{label}` est celle de la base de paramètres** (SPEC-REQ §3.5) :
`{nom}` désigne le paramètre `nom` du repo du test, `{<nœud>::nom}` celui d'un composant visible.
La grammaire est unique (`packages/types/src/parameter-refs.ts`) et tolère `\_` (échappement du
sérialiseur Markdown) ; une référence écrite dans du code Markdown reste littérale et n'est pas
comptée. À l'ajout en campagne (§4.2) :
1. une référence présente dans la base avec une valeur non vide est **lue automatiquement et
   figée** (`resolvedParams`, non modifiable) ;
2. une référence **locale** absente de la base devient un paramètre **à saisir à la main**,
   exactement comme en T97 (`paramValues`, modifiable ensuite) ;
3. toute autre référence (cross-composant absente, valeur vide, nœud non visible, tag de
   baseline introuvable) reste **non résolue** : littérale, jamais proposée à la saisie,
   enregistrée dans `unresolvedParams` et signalée.

Sur la fiche de définition du test (Word, Excel, Édition, Recherche), la référence affiche la
**valeur courante** de la base avec le style dédié (SPEC-REQ §3.5) ; la valeur réellement
utilisée à l'exécution est celle figée en campagne.

**Champ de l'exigence liée — `{req.<champ>}` (T179).** Dans les mêmes champs d'un test, `{req.<champ>}`
référence un champ de l'exigence pour laquelle l'instance de campagne est générée : tout champ
personnalisé (`fields`), tout champ système (`id`, `title`, `status`, `version`, `objectTypeRef`,
`projectId`, `branchId`, `jiraLinks` — clés Jira —, `needsRevalidation` — absent = `false`) et les
champs dérivés du git log (`createdAt`, `createdBy`, `updatedAt`, `updatedBy`) ; un champ
personnalisé homonyme d'un champ système est masqué. Jamais préfixée d'un nœud (`{x::req.y}` reste
littéral). Un test qui en contient au moins une est **itérant** : à l'ajout en campagne, une instance
par exigence liée (§4.2). Les exigences liées sont celles du **lien de couverture**
(`matchCoverageLink`, deux sens, tout type de lien — SPEC-REQ §5.1), exigences terminales exclues,
liens orphelins ignorés, tri naturel des ID. Valeur substituée : texte brut (Markdown d'un `richtext`
inséré tel quel), nombre/booléen en texte, liste jointe par `, `, objet en JSON compact ; un
paramètre de base imbriqué dans la valeur est résolu dans la base du repo de l'exigence. Une
`{req.…}` n'est **jamais** à saisir à la main. Sur la fiche de définition, elle reste affichée
littéralement avec un style dédié (`param-ref--req`) ; au survol, dans la fiche/l'édition du test,
la valeur du champ pour chaque exigence liée (état courant), ailleurs (Word, Excel, Recherche) un
libellé générique. Le sélecteur d'insertion (saisie de `{` dans une étape) propose les champs de
l'exigence liée. Dans une exigence, `{req.…}` est du texte brut.

### 2.4 Lien vers les exigences couvertes

Un cas de test peut couvrir **une ou plusieurs exigences**. Le lien est bidirectionnel :
- Depuis la fiche test : liste des exigences couvertes
- Depuis la fiche exigence : liste des tests qui la couvrent (déduite par l'index)

**Structure d'un lien de couverture :**

```yaml
linkedRequirements:
  - reqId: SW-0042
    reqVersion: 2       # version de l'exigence couverte (null = version courante)
    coverageType: full  # full | partial
```

| `coverageType` | Signification |
|----------------|--------------|
| `full` | Le test vérifie l'intégralité de l'exigence |
| `partial` | Le test ne vérifie qu'un aspect de l'exigence |

Quand l'exigence cible évolue (nouvelle version approuvée), le lien est marqué **"à revalider"** (même mécanique que les liens inter-exigences).

### 2.5 Champs configurables (via template)

En plus des champs système, le template peut ajouter des champs supplémentaires (même système que les exigences — voir [SPEC-REQ §3](SPEC-REQ-requirements.md#3-définition-des-champs-fielddefinition)) :

Exemples typiques dans le template `electro-domestic-battery` :

| ID | Type | Usage |
|----|------|-------|
| `environment` | ENUM | Environnement cible : `lab` / `bench` / `field` |
| `equipmentRequired` | RICHTEXT | Matériel nécessaire (multimètre, charge réglable…) |
| `duration` | NUMBER | Durée estimée en minutes |
| `tags` | MULTI_ENUM | `safety` / `regression` / `smoke` / `performance` |
| `automationId` | TEXT | Identifiant dans le framework de test automatisé |

### 2.6 Versionnement

**Identique au modèle des exigences :**
- Brouillon → Approuvé (version N, immuable)
- Clic "Modifier" sur une version approuvée → nouveau brouillon + commentaire
- Chaque version approuvée est taggée dans git : `TEST-0042/v2`
- Un `TestRun` est toujours lié à une version précise du test

### 2.7 Workflow de statut (configurable)

Workflow recommandé dans le template (configurable par projet) :

```
Brouillon ──[Soumettre]──► En révision ──[Approuver]──► Approuvé ★
   ▲                            │
   └──────────[Rejeter]─────────┘
                                            ▼
                                        Obsolète ⊘
```

`★` = `isApproved: true` — gèle le test, toute nouvelle modification passe par un brouillon  
`⊘` = `isArchived: true` — soft-delete, lecture seule

---

## 3. Exécution d'un cas de test (TestRun)

### 3.1 Principe

Un `TestRun` représente **une exécution concrète** d'un cas de test à un instant T, dans un contexte précis. Il est **immuable** une fois clôturé.

**Retest :** quand un TestRun échoue et qu'on veut retester (après correction), on crée simplement un **nouveau TestRun** indépendant. Pas de lien structurel entre runs — la séquence chronologique et le filtre par `testCaseId` suffisent pour voir l'évolution des résultats.

**Pièces jointes :** il n'y a pas de stockage de fichiers dans Polenta. Toute pièce jointe (capture oscilloscope, log, photo de banc) est partagée via la GED du client (OneDrive…). La voie **structurée** est un champ de type `link` (GH195, SPEC-REQ §3.2) : colonne, champ obligatoire (`requiredWhen`), hyperlien d'export. Coller le lien dans un `richtext` (`comment` de l'étape, `notes` du run) reste possible.

### 3.2 Attributs d'un TestRun

| Attribut | Type | Description |
|----------|------|-------------|
| `id` | string | Identifiant unique (ex. `RUN-20260601-001`) |
| `testCaseId` | string | Référence au cas de test |
| `testCaseVersion` | int | Version du test exécutée |
| `campaignEntry` | `{ campaignId, entryId }` | *(GH73)* Entrée de campagne dont le run est l'exécution — posée par la page d'exécution et l'import Excel (§4.5), jamais réécrite (run immuable). Absente : exécution isolée, ou run antérieur à GH73 (ces fichiers portent `campaignRunId: null`, ignoré — champ retiré). Sans chemin de repo : un run d'un test de composant vit dans le repo du composant et désigne une campagne du repo produit. Limite connue : « Garder les deux » (GH37) renumérote les références du repo fusionné seulement, pas celles d'un run écrit dans un autre repo |
| `result` | ENUM | Résultat global (voir §3.3) |
| `executedAt` | DATETIME | Date/heure de début |
| `executedBy` | USER | Testeur |
| `duration` | NUMBER | Durée en secondes |
| `equipmentUsed` | list | Identification physique de chaque équipement (voir §3.2) |
| `stepResults` | list | Résultat par étape (voir §3.4) |
| `notes` | RICHTEXT | Observations générales, contexte global de l'exécution. Liens OneDrive pour les fichiers annexes (logs, exports CSV). |
| `origin` | `'excel-import'` | *(GH36)* Origine du résultat : absent = saisi dans l'outil ; `excel-import` = réimporté depuis le classeur d'exécution (§4.5), avec testeur et date lus dans le fichier |
| `fields` | map? | *(GH196)* Valeurs des **champs d'exécution** (`runFields` du type de test), typées comme des champs d'objet ; absent tant que vide. Chaque `stepResults[]` porte de même `fields` (champs d'étape, `stepFields`), sur une étape exécutée seulement |

**Champs d'exécution et d'étape (GH196)** — déclarés sur un type de **test** : `runFields` (saisis à
chaque exécution : n° de rapport, température, lien vers le rapport…) et `stepFields` (saisis sur
chaque étape exécutée : valeur mesurée…). Tous les types de champ sauf `drawio`. `requiredWhen` y
référence le pseudo-champ `result` (verdict global pour `runFields`, verdict de l'étape pour
`stepFields`) ou un champ enum / multi_enum / boolean de la même liste. **Nom unique dans le projet** :
deux types de test peuvent partager un nom (même colonne dans le classeur) avec le même type de champ
et dans la même liste ; refusé à l'enregistrement du schéma sinon. Écriture : `TestsService.execute`
(point unique : page d'exécution et import du classeur) convertit les saisies, refuse clé inconnue /
valeur illisible et contrôle `required` / `requiredWhen` sur le verdict final ; rien n'est écrit en cas
de refus. Saisie sur la page d'exécution (champs d'exécution sous le verdict global, champs d'étape sur
les étapes exécutées, défauts pré-remplis, astérisque dynamique) ; consultation d'un run en lecture
seule (« hors schéma » pour un champ retiré, ⚠ pour une valeur d'enum disparue). Un run n'est jamais
réécrit, y compris au renommage d'un champ (limite). Éditeur de schéma : sections repliables « Champs
d'exécution » / « Champs d'étape » ; MCP `add_field` `list`.

### 3.2 Identification du matériel utilisé (EquipmentUsed)

Pour chaque item de la liste `equipment` de la définition du test, le testeur renseigne l'équipement physique réellement utilisé. La correspondance se fait via l'`id` de l'équipement requis.

| Attribut | Type | Description |
|----------|------|-------------|
| `equipmentId` | string | Référence à l'`id` de l'`EquipmentRequirement` dans la définition |
| `role` | TEXT | Repris de la définition (dénormalisé pour lisibilité du run) |
| `identification` | TEXT | Identification physique précise : marque, modèle, numéro de série, révision |
| `calibrationDate` | DATE | Date de dernière calibration (optionnel, pertinent pour instruments de mesure) |
| `notes` | TEXT | Remarque sur l'état ou la configuration de l'équipement |

**Format YAML :**
```yaml
equipmentUsed:
  - equipmentId: eq-1
    role: "Produit sous test"
    identification: "Aspirateur Polenta rev C, SN: ASP-2026-00142, FW: 1.4.2, HW: C"
    calibrationDate: null
    notes: "Unité de pré-série, reçue le 2026-05-28"

  - equipmentId: eq-2
    role: "Oscilloscope"
    identification: "Tektronix MSO44, SN: C012345"
    calibrationDate: "2026-01-15"
    notes: null

  - equipmentId: eq-3
    role: "Alimentation réglable"
    identification: "Keysight E3645A, SN: MY48001234"
    calibrationDate: "2025-11-01"
    notes: "Réglée à 18.0V avant démarrage du test"

  - equipmentId: eq-4
    role: "Multimètre"
    identification: "Fluke 87V, SN: 27540492"
    calibrationDate: "2026-03-10"
    notes: null
```

**Règles :**
- Tous les équipements `required: true` de la définition doivent avoir une entrée dans `equipmentUsed` avant de clôturer le TestRun.
- Les équipements optionnels (`required: false`) peuvent être omis.
- L'`identification` est un champ libre — pas de base de données d'équipements en V1.

### 3.3 Résultats possibles

**Résultat global du TestRun :**

| Valeur | Signification |
|--------|--------------|
| `PASS` | Toutes les étapes passent |
| `FAIL` | Au moins une étape échoue |
| `BLOCKED` | Le test n'a pas pu démarrer (prérequis non rempli) |
| `INCOMPLETE` | Test interrompu (toutes les étapes ne sont pas exécutées) |

**Résultat par étape (StepResult) :**

| Valeur | Signification |
|--------|--------------|
| `PASS` | Le résultat observé correspond au résultat attendu |
| `FAIL` | Le résultat observé ne correspond pas |
| `BLOCKED` | L'étape n'a pas pu être exécutée (bug bloquant) |
| `SKIP` | Étape volontairement sautée (avec justification) |
| `NOT_EXECUTED` | L'étape n'a pas encore été traitée (test en cours) |

### 3.4 Structure d'un StepResult

| Attribut | Type | Description |
|----------|------|-------------|
| `order` | int | Référence à l'étape de la définition |
| `result` | ENUM | PASS / FAIL / BLOCKED / SKIP / NOT_EXECUTED |
| `comment` | RICHTEXT | Commentaire libre du testeur : résultat observé, mesures relevées, liens OneDrive vers captures oscilloscope/photos, hypothèses de cause. |
| `executedAt` | DATETIME | Horodatage de l'exécution de cette étape (optionnel) |

Le champ `comment` est en **RICHTEXT** : le testeur y colle des liens OneDrive (images rendues inline, fichiers cliquables) et rédige ses observations. Pas d'upload dans Polenta — tout passe par OneDrive.

**Format YAML :**
```yaml
stepResults:
  - order: 1
    result: PASS
    comment: "<p>2 barres affichées, conforme.</p>"
    executedAt: "2026-06-01T09:05:00Z"

  - order: 2
    result: FAIL
    comment: |
      <p>Le moteur démarre mais avec un <strong>délai de 800ms</strong> (attendu &lt; 500ms).</p>
      <p>Reproductible à froid uniquement. Mesure relevée sur CH1 de l'oscilloscope :</p>
      <img src="https://onedrive.live.com/embed?resid=XXX&amp;authkey=YYY" />
      <p>Hypothèse : initialisation du driver moteur trop longue en dessous de 15°C.
      Température ambiante au moment du test : 18°C.</p>
    executedAt: "2026-06-01T09:08:00Z"

  - order: 3
    result: NOT_EXECUTED
    comment: "<p>Test interrompu après échec étape 2. À reprendre après correction FW.</p>"
    executedAt: null
```

**Règle de calcul du résultat global :**
- Au moins un `FAIL` → global `FAIL`
- Aucun `FAIL`, au moins un `BLOCKED` → global `BLOCKED`
- Aucun `FAIL`, aucun `BLOCKED`, au moins un `NOT_EXECUTED` → global `INCOMPLETE`
- Tous `PASS` ou `SKIP` → global `PASS`

### 3.5 Import de résultats automatisés

Pour les tests automatisés, les résultats sont importés depuis un fichier externe.

**Formats supportés :**

| Format | Usage |
|--------|-------|
| JUnit XML | Frameworks Java/Python/JS (pytest, Jest, JUnit) |
| JSON Polenta | Format natif, mapping explicite |

**Correspondance test automatisé → TestCase :**  
Le champ `automationId` du TestCase (champ configurable) est la clé de mapping. L'import recherche ce champ pour associer chaque résultat automatisé au bon TestCase.

```xml
<!-- JUnit XML -->
<testcase name="test_motor_startup_eco_mode" classname="FirmwareTests" time="0.45">
  <!-- automationId = "test_motor_startup_eco_mode" → TEST-0042 -->
</testcase>
```

**Comportement à l'import :**
- Un **TestRun isolé** est créé pour chaque test mappé (pas de rattachement automatique à une campagne).
- Le rattachement à une campagne se fait manuellement depuis l'UI si besoin.
- Les tests non mappés (aucun TestCase avec cet `automationId`) sont listés en warning, pas bloquants.
- L'import est idempotent : réimporter le même fichier ne crée pas de doublon (clé = `automationId` + `productVersion` + `executedAt`).

---

## 4. Campagnes de tests

### 4.1 TestCampaign — plan et exécution fusionnés

*(T66 : la spec distinguait initialement un `TestCampaign` (plan) et un `CampaignRun` (exécution)
séparés. Le code n'a jamais implémenté cette séparation — une campagne embarque directement ses
statuts d'exécution par test. T66 aligne la spec sur ce modèle plutôt que d'ajouter la séparation :
pas de notion de ré-exécution multi-environnement d'une même campagne — relancer une campagne dans
un autre contexte se fait en créant une nouvelle campagne.)*

Une `TestCampaign` est à la fois le plan de test (sélection de cas à exécuter) et le suivi de son
exécution (statut par test).

| Attribut | Description |
|----------|-------------|
| `id` | Ex. `CAMP-0001` |
| `title` | Ex. "Validation release v2.0" |
| `objectTypeRef` | Référence au type de campagne défini dans `schema.yaml` (format `component::typeName`), optionnel |
| `fields` | Champs personnalisés du type (même mécanisme que `requirement`/`test`, voir [SPEC-REQ §3](SPEC-REQ-requirements.md#3-définition-des-champs-fielddefinition)) — un projet qui veut une description de campagne l'ajoute ici comme champ `richtext` |
| `baselineRef` | Baseline sur laquelle la campagne a été constituée, optionnel |
| `component` / `level` | Filtres d'appartenance (composant, niveau), optionnels |
| `testCaseIds` | Liste des `TestCase.id` inclus dans la campagne — un même id peut apparaître plusieurs fois si le test a des paramètres (voir §4.2, T97 sprint 2) |
| `runs` | `CampaignTestRun[]` — une entrée par *inclusion* du test dans la campagne, chacune avec sa propre copie figée du test (`testSnapshot`, voir §4.2, T49) |
| `removedRuns` | *(GH73)* `CampaignTestRun[]` — entrées retirées (`removeEntries`), conservées complètes avec `removedAt`, dans l'ordre des retraits. Absent tant que rien n'a été retiré. Aucun écran ni export ne les lit (voir §4.2 « Retirer un test ») |
| `status` | `planned` / `in_progress` / `completed` / `abandoned` |
| `createdAt` | — |
| `completedAt` | Renseigné à la fermeture (`completed` ou `abandoned`) |
| `history` | **GH77** — historique du statut (`planned` à la création, `in_progress` au premier résultat, `completed` / `abandoned` à la clôture) et des champs personnalisés suivis — voir [SPEC-REQ §4.4](SPEC-REQ-requirements.md#44-historique-des-champs-suivis-gh77). Les entrées de `runs` n'ont pas d'historique propre : leur chronologie est portée par `addedAt`, `removedAt` et les runs rattachés (GH73, §4.2 « Historique daté ») |

**Statut de campagne :** `planned` à la création. Passe automatiquement à `in_progress` dès la
première saisie de résultat sur un test (`updateRun()`). Le passage à `completed` ou `abandoned` est
manuel (fermeture explicite par le testeur) — il n'y a pas de clôture automatique même quand tous
les tests ont un résultat, le testeur peut maintenir une campagne ouverte (ex. en attente de
validation externe).

**Génération automatique de campagne :**
À partir d'une sélection d'exigences (ex. "tous les tests couvrant les exigences BAT"), Polenta génère une campagne pré-remplie. Voir [SPEC-TRACEABILITY.md](SPEC-TRACEABILITY.md) §génération de plan de test.

### 4.2 CampaignTestRun — une entrée par inclusion du test dans la campagne

Chaque entrée de `runs` représente une **inclusion** d'un test dans la campagne — pas
nécessairement unique par `testCaseId` (T97 sprint 2) :

| Attribut | Description |
|----------|-------------|
| `entryId` | *(T97 sprint 2)* Identifiant unique de cette inclusion (ex. `TEST-0042-2` pour la 2ᵉ instance de TEST-0042 dans cette campagne) — clé de référence pour l'exécution/la relecture, distincte de `testCaseId` |
| `testCaseId` | Référence au cas de test — **pas unique** au sein de `runs[]`, un test paramétré peut être inclus plusieurs fois |
| `testSnapshot` | *(T49)* Copie complète du `TestCase` (contenu, statut, `fields`, `version`…) telle que résolue au moment de l'inclusion — voir "Snapshot à l'inclusion" ci-dessous. Optionnel : absent sur les entrées créées avant T49 (pas de backfill rétroactif). |
| `status` | `pending` / `PASS` / `FAIL` / `BLOCKED` / `INCOMPLETE` |
| `addedAt` | *(GH73)* Instant d'ajout dans la campagne — posé par la sélection initiale de `create()` (= `createdAt`), `addTests()`, `duplicateTest()` et le report GH64 (date du report, pas celle de la source) ; jamais modifié. Absent sur les entrées antérieures à GH73 (pas de backfill) |
| `runId` | Référence au **dernier** `TestRun` de l'entrée, optionnel tant que `pending` ; les runs précédents se retrouvent par `TestRun.campaignEntry` (GH73) |
| `executedAt` | Horodatage de la dernière saisie de résultat |
| `executedBy` | Testeur ayant saisi le résultat, optionnel |
| `paramValues` | *(T97)* `Record<label, valeur>` — valeurs **saisies à la main** des références à saisir (§2.4a cas 2), modifiables après l'ajout. Depuis T171, toute référence à saisir y figure (vide si aucune valeur n'a été fournie) ; une référence n'est jamais à la fois ici et dans `resolvedParams`. |
| `resolvedParams` | *(T171)* `Record<référence, valeur>` — valeurs lues dans la base de paramètres et **figées** à l'ajout (clé telle qu'écrite : `nom` ou `<nœud>::nom` ; valeur déjà formatée `value unit`). Aucune API ne les modifie. |
| `paramSourceRef` | *(T171)* Tag git auquel les paramètres ont été lus (= `baselineRef` de la campagne) ; absent = état courant au moment de l'ajout. |
| `unresolvedParams` | *(T171)* `{ ref, reason: 'tag_not_found' \| 'missing' \| 'empty' \| 'unknown_node' \| 'no_linked_requirement' }[]` — références restées non résolues à l'ajout (`no_linked_requirement` : T179, `{req.…}` d'un test sans exigence liée). |
| `requirementId` | *(T179)* Exigence pour laquelle l'instance a été générée (test itérant, §2.4a). Absent pour un test sans `{req.…}` ou sans exigence liée. Les valeurs `{req.<champ>}` sont figées dans `resolvedParams` sous la clé `req.<champ>`. |
| `carriedFrom` | *(GH64)* `{ campaignId, entryId }` — entrée d'une autre campagne dont l'instance a été reportée (voir « Report depuis une autre campagne » ci-dessous). Absent pour un ajout normal. |
| `removedAt` | *(GH73)* Instant du retrait — uniquement sur les entrées de `TestCampaign.removedRuns` |

Ajouter des tests à une campagne déjà démarrée (`addTests()`) est possible tant qu'elle n'est pas
`completed`/`abandoned` ; les nouveaux tests entrent avec le statut `pending`. Si le test ajouté a
des références **à saisir** (§2.4a cas 2), l'ajout exige une valeur pour chacune — même règle à la
création d'une campagne avec une sélection initiale de tests. Les références lues dans la base ne
sont pas demandées.

**Sélecteur de tests (GH33)** : à la création (`/campaign/new`, bouton « Sélectionner des
tests… » puis récapitulatif de la sélection) comme à l'ajout (« + Ajouter des tests » d'une
campagne active), les tests se choisissent dans une **modale à deux étapes**
(`TestPickerModal`) — c'est ce que désignent ci-dessous « le panneau d'ajout » et « le
formulaire de création » :
1. **Sélection** dans la Vue Excel du type de test choisi (combobox des types `test` du repo,
   un type à la fois, sélection conservée d'un type à l'autre), en mode sélection
   ([SPEC-SYSTEM-VIEW §Vue Excel](SPEC-SYSTEM-VIEW.md#vue-excel)) : repli des dossiers et
   colonnes figées repris des préférences Vue Excel de l'utilisateur (lus, jamais réécrits) ;
   **colonnes et titres de dossiers configurables** par le bouton ⚙️ de la barre d'outils (GH176 —
   même panneau que l'onglet Tableau de la Vue Excel, sans onglets, Statut coché et verrouillé),
   enregistrés comme préférence **propre au sélecteur** (par utilisateur et par type, clés
   `picker` / `showFoldersPicker`, cf. [SPEC-SYSTEM-VIEW §Persistance](SPEC-SYSTEM-VIEW.md#persistance-de-létat)) :
   tant qu'elle est absente, le sélecteur suit la Vue Excel ; « Réinitialiser » la supprime ; la
   Vue Excel n'est jamais modifiée. Changer une colonne conserve sélection, filtres, repli et
   colonnes figées ; `Échap` ferme le panneau sans fermer la modale ; changer de type, d'onglet ou
   d'étape le ferme. Lecture seule, cases à cocher (ligne, dossier, en-tête), Ctrl/Maj, filtre global et filtres
   colonne (T51). Compteur « N sélectionnés, dont M non affichés ». Un test présent dans
   `tests/` mais absent de l'arbre du type est listé en fin de grille.
2. **Paramètres** — seulement si un test sélectionné est itérant ou a des références à saisir
   (sinon sautée) : `ReqInstancePicker` / `TestParamFields`, mêmes règles de complétude.
Annuler une sélection modifiée demande confirmation ; à la création, la modale ne fait que
mettre à jour la sélection du formulaire (la campagne est créée par « Créer »). Tests proposés :
tous les tests **quel que soit leur statut** (GH68 — permet de construire une campagne en amont) ;
filtre composant/niveau à la création ; à l'ajout, dédoublonnés comme décrit ci-dessous. La
colonne Statut de la grille est toujours affichée (insérée après `id` si les préférences Vue Excel
la masquent, sans les réécrire ; jamais écrite dans `picker` par le sélecteur).

**Report depuis une autre campagne (GH64)** : l'étape 1 du sélecteur (création comme ajout) a deux
onglets, « Tests » (Vue Excel ci-dessus, inchangée) et « Depuis une campagne ». Ce dernier liste
toutes les campagnes du repo sauf la cible, quel que soit leur statut (plus récente d'abord, sélection
multiple, aucune cochée par défaut), un filtre par statut d'entrée (`pending` / `BLOCKED` /
`INCOMPLETE` cochés par défaut, `FAIL` / `PASS` disponibles) et les entrées correspondantes (test,
exigence, valeurs saisies, statut, exécution, campagne source, remarque). Une entrée disponible est
cochée à sa première apparition ; décochée, elle le reste quand les campagnes ou le filtre changent.
Les sélections des deux onglets se cumulent.
- **Doublon** : clé `carryKey(test, exigence, valeurs saisies normalisées)` (`@polenta/types`). Une
  même clé dans plusieurs campagnes source n'est proposée qu'une fois (entrée la plus récente :
  `executedAt`, à défaut création de sa campagne ; les autres citées en remarque) ; une clé déjà
  présente dans la cible est grisée « Déjà présent ».
- **Indisponible** (grisé, motif) : test supprimé ; hors du filtre composant/niveau (création) —
  mêmes règles que l'onglet Tests ; instance T179 dont l'exigence n'est plus liée (lue à la
  baseline de la cible). Version du test changée depuis la copie de la source : simple
  avertissement. Test non approuvé : disponible, pastille « Non approuvé » (GH68).
- **Instance créée** : une par entrée retenue (deux entrées d'un test à paramètres saisis aux
  valeurs différentes → deux instances), `pending`, copie du test dans son **état actuel** (T49),
  paramètres de base relus selon la baseline de la **cible** (T171), valeurs saisies pré-remplies
  depuis la source et modifiables à l'étape 2, `requirementId` de la source conservé (pas de choix
  d'exigence) ; entrée sans exigence d'un test devenu itérant : `ReqInstancePicker`, sans les
  exigences déjà prises par une autre entrée reportée. `carriedFrom` renseigné.
- **Priorité sur l'onglet Tests** : un test sans paramètre à saisir coché dans les deux onglets, ou
  une exigence reportée d'un test itérant, ne donne qu'une instance — la reportée. Appliquée à
  l'envoi (`withCarryPrecedence`), sans modifier la sélection de l'onglet Tests.
- **Main** (`create()` / `addTests(…, carried)`) : ne reçoit que des références
  `(campaignId, entryId)` et les saisies, relit la source (id de campagne sans chemin), ignore
  silencieusement une sélection invalide (source ou entrée absente, cible elle-même, test supprimé,
  exigence plus liée, doublon) ; une source illisible (YAML invalide) est une erreur. Instances
  reportées placées après celles de l'onglet Tests. La campagne source n'est **jamais modifiée**.
- Liste des tests de la campagne : mention `↩ <CAMP-ID>` (lien vers la source, infobulle avec
  l'entrée) sur une instance reportée ; exports inchangés.

**Résolution des paramètres à l'ajout (T171)** : `create()`, `addTests()` et `duplicateTest()`
résolvent côté main (`ParametersService.previewForTests`) les références de chaque test ajouté,
dans la base du repo du test (déduit de son `objectTypeRef`) et des composants visibles depuis ce
repo (dépendances `polenta-repo.yaml`). Source : le tag `baselineRef` de la campagne s'il existe
(lu dans chaque repo au tag du même nom — `GitService.readYamlAtTag`, tag léger ou annoté),
**sans repli** sur l'état courant ; sinon l'état courant. Tag introuvable : ajout autorisé,
références du repo concerné non remplacées (`tag_not_found`), non proposées à la saisie. Le canal
`campaigns:preview-params` expose la même résolution sans écriture : le panneau d'ajout et le
formulaire de création affichent les références résolues en lecture seule, les non résolues avec
leur raison (avant validation), et ne demandent que les références à saisir. Après l'ajout, un
bandeau dans la page campagne liste les instances ayant des références non résolues (et un
indicateur ⚠ sur chaque instance concernée). Une modification ultérieure de la base ne change
pas une campagne existante.
`addTests()` reste limité à une instance par test à l'ajout groupé (dédoublonné par `testCaseId`,
comme avant T97 sprint 2) — sauf pour un test itérant (T179, ci-dessous).

**Une instance par exigence liée (T179)** : pour un test itérant (§2.4a), `create()` et `addTests()`
créent une instance par exigence retenue, chacune avec son `requirementId`, ses valeurs
`{req.<champ>}` figées et ses propres références à saisir. Le panneau d'ajout et le formulaire de
création listent sous le test ses exigences liées, **cochées par défaut, décochables**, avec leurs
valeurs en lecture seule ; `reqInstances` (par test : exigences retenues et saisies par instance)
est transmis au main, absent = toutes les exigences liées. La **déduplication** porte sur le couple
(test, exigence) : un test déjà présent reste proposé tant qu'une de ses exigences liées n'a pas
d'instance (les exigences déjà instanciées sont grisées « déjà présente »). Test itérant sans
exigence liée : une seule instance, `{req.…}` non résolues (`no_linked_requirement`). Avec
`baselineRef`, exigences, liens et champs dérivés sont lus **au tag** (un lien créé après le tag ne
génère pas d'instance), sans repli sur l'état courant. « Dupliquer » une instance générée crée une
instance pour **la même exigence** (valeurs relues à la source ; erreur si l'exigence n'est plus
liée) ; « Dupliquer » une instance sans exigence crée une seule instance. La liste des tests de la
campagne affiche l'ID de l'exigence de chaque instance (lien vers sa fiche, cherchée dans les repos
du workspace).

**Retirer un test (T99)** : `removeEntries()` retire une ou plusieurs instances (`entryId`) d'une
campagne (refusé si `completed`/`abandoned`, même garde que `addTests()`) — ne retire que
l'instance ciblée : si un test paramétré est inclus plusieurs fois (T97 sprint 2), les autres
instances ne sont pas affectées. Une seule occurrence du `testCaseId` correspondant est retirée de
`testCaseIds` par instance supprimée. **GH73** : l'instance n'est plus supprimée du fichier — elle
passe, complète (statut, `runId`, copie…), de `runs` à la fin de `removedRuns` avec `removedAt`. Un
`entryId` absent de `runs` (inconnu ou déjà retiré) est ignoré ; pas de restauration (on ré-ajoute le
test). Les lecteurs de `runs` (page campagne, exécution/relecture, exports, classeur GH36, report
GH64, déduplication, traçabilité) ne voient donc pas les entrées retirées — le graphe de la vue Suivi
les expose à part (`removedEntries`, GH74) : une
entrée retirée ne bloque pas le ré-ajout du même test et n'est pas reportable. Les **`entryId`** des
nouvelles instances sont numérotés après le plus grand suffixe de `runs` **et** `removedRuns` (GH66,
GH73) : un `entryId` n'est jamais réutilisé dans une campagne.

**Saisie d'un résultat (GH73)** : `updateRun()` exige le `runId` du `TestRun` qui porte le résultat
et un résultat de run (`PASS` / `FAIL` / `BLOCKED` / `INCOMPLETE`) ; sans run, ou avec `pending`,
l'appel est refusé sans écriture. Les deux chemins de saisie (page d'exécution, import Excel §4.5)
créent le run, rattaché à l'entrée (`campaignEntry`), puis mettent à jour l'entrée.

**Historique daté (GH73)** : Polenta enregistre des faits bruts ; l'état d'une campagne à une date
est calculé **côté projet** (bibliothèque projet, `campaignTimeline`, #74 — principe GH79). Faits
disponibles pour une entrée `e` de la campagne `c` (dans `runs` ou `removedRuns`) :
- présence sur `[e.addedAt, e.removedAt)` (`removedAt` absent : toujours présente) ;
- runs de l'entrée : les `TestRun` dont `campaignEntry = { c.id, e.entryId }`, datés par
  `executedAt` (date saisie par le testeur pour un import Excel) ; statut à une date `d` = résultat
  du dernier run tel que `executedAt ≤ d`, aucun → `pending` ;
- statut de la campagne : `history.status` (GH77).

Polenta stocke des instants ISO 8601 et ne découpe pas par jour (fuseau = paramètre du script).
Données antérieures à GH73 (règle de repli du script projet, approximative et signalée comme telle) :
`addedAt` absent → `c.createdAt` ; entrée retirée avant GH73 : perdue ; run sans `campaignEntry` →
le run `e.runId` est rattaché à `e`, un autre run l'est s'il porte sur le même test et la même
exigence avec `c.createdAt ≤ executedAt ≤` date du run `e.runId`, et seulement si une seule entrée
est candidate (sinon non rattaché). Étapes de préparation dans le temps : interprétation côté
projet, depuis `history.status` du test live, `addedAt`, les runs rattachés et la règle GH68 (la
date des resynchronisations de copie n'est pas nécessaire).

**Instances multiples (T97 sprint 2)** : un test **avec au moins une référence à saisir** (T171 :
un test dont toutes les références sont résolues depuis la base se comporte comme un test sans
paramètre) peut être inclus
plusieurs fois dans la même campagne — chaque instance a son propre `entryId`, son propre
`paramValues`, sa propre exécution (`status`/`runId`), indépendants des autres instances du même
test. Ajout d'une nouvelle instance via une action dédiée ("Dupliquer" sur une instance déjà
présente), pas via le panneau d'ajout groupé. Un test **sans** paramètre reste limité à une seule
inclusion. La liste des tests d'une campagne affiche les valeurs de paramètres de chaque instance
en regard de son titre.

`paramValues` reste modifiable après l'ajout (édition depuis la liste des tests de la campagne),
y compris après la clôture de la campagne — corriger une valeur sur un test déjà exécuté reste
utile après coup (erreur de saisie constatée a posteriori).

**Compatibilité ascendante** : les campagnes créées avant T97 sprint 2 n'ont pas d'`entryId` dans
leurs `runs[]` existants — backfillé de façon déterministe à la lecture (`${testCaseId}-${n}`,
n = position parmi les instances du même test), sans réécriture du fichier.

**Snapshot à l'inclusion (T49)** : `addTests()`, `duplicateTest()` et la sélection initiale de
`create()` copient l'objet `TestCase` complet dans `testSnapshot` de la nouvelle entrée, au moment
de l'ajout — pas seulement une référence par `testCaseId`. Toute lecture ultérieure (liste des
tests de la campagne, exécution, relecture d'un run, exports plan/rapport xlsx/docx/pdf) utilise
`testSnapshot` en priorité, indépendamment des modifications faites au test source par la suite
(changement de statut, de contenu, y compris après clôture de la campagne) — une campagne fermée
reste un enregistrement figé. **GH77** : la copie ne porte jamais `history` (retiré à l'ajout, au
report et à la resynchronisation GH68) — l'historique reste celui du test source. **GH82** :
renommer un statut ou une valeur d'enum du type de test migre aussi ces clés dans les copies, y compris celles des entrées retirées (`removedRuns`, GH73) (seule
la clé change, pas le contenu figé) — un statut d'approbation renommé reste reconnu (GH68). Un id qui ne résout plus au moment de l'ajout (test supprimé entre
l'affichage du panneau et l'appel) est simplement omis de la copie plutôt que de faire échouer tout
l'ajout groupé ; l'entrée correspondante se comporte alors comme une entrée pré-T49 (voir
compatibilité ascendante ci-dessous).

**Tests non approuvés (GH68)** : aucun statut n'empêche un test d'entrer dans une campagne. Statut
« approuvé » = `statuses[].isApproval` du type, repli sur `approved` (`isApprovalStatus`,
`@polenta/types`). Exception à la copie figée ci-dessus : une instance **`pending` dont la copie
n'est pas approuvée**, d'une campagne ouverte, est *resynchronisable* : sa **version effective**
est l'état actuel du test (sans `history` ; paramètres de l'instance non recalculés), sa copie
sinon (test supprimé, entrée pré-T49 : état live, campagne clôturée : copie) —
`CampaignsService.effectiveTests()`, **lecture seule**. **GH81** : aucune consultation n'écrit la
campagne — ni l'ouverture de la page d'exécution, ni l'export du classeur (§4.5). La copie n'est
remplacée qu'à la saisie du résultat, dans la même écriture : la page d'exécution envoie la
**version affichée** (`campaigns:update-run`, 6ᵉ argument), figée même si le test a changé
depuis l'affichage ; l'import fige la version exportée (§4.5). Le main n'accepte qu'une version
du test de l'instance (`id` = `testCaseId`, sinon refus) et l'ignore si l'instance n'est plus
resynchronisable. Une copie figée sur une version approuvée cesse d'être resynchronisable ; une
instance ajoutée approuvée garde le comportement T49. Signalement :
- liste de la campagne : pastille « Non approuvé » (statut jugé sur l'état live pour une instance
  resynchronisable **d'une campagne ouverte** — GH71 —, sinon sur la copie), bandeau « N instance(s)
  à exécuter… » pour les `pending` ;
- page d'exécution : bandeau d'avertissement, et confirmation « Exécuter quand même » à la
  première saisie (instance `pending`) — pas de blocage. Instance resynchronisable : la page
  affiche le test live, relu à l'ouverture (repli sur la copie si la relecture échoue). La version
  affichée est figée pour la session d'exécution (GH71) : si le test change pendant la saisie
  (modifié ailleurs, GH81), la saisie n'est pas réinitialisée ; un bandeau le signale et propose
  d'afficher la nouvelle version (ce qui efface la saisie) ; sinon c'est la version affichée qui est
  enregistrée avec le résultat ;
- aperçu d'import Excel : avertissement `test_not_approved` (§4.5).
Le passage `planned` → `in_progress` n'est pas conditionné au statut des tests. La génération
depuis l'analyse d'impact (T46) envoie `testCaseFilter: 'include_draft'`.

"Dupliquer" une instance existante (nouvelle instance
paramétrée, T97 sprint 2) capture un nouveau `testSnapshot` sur l'état *live* du test au moment de
la duplication, pas sur le `testSnapshot` (potentiellement plus ancien) de l'instance dupliquée.

**Compatibilité ascendante (`testSnapshot`)** : les entrées créées avant T49 n'ont pas de
`testSnapshot` — **pas de backfill rétroactif** (décision de cadrage), contrairement au backfill
d'`entryId` ci-dessus. Ces entrées continuent de se résoudre contre l'état live du test (même
comportement qu'avant T49, y compris la dégradation silencieuse si le test source a été supprimé
depuis).

### 4.3 Tableau de bord d'une campagne

Métriques calculées à la volée depuis l'index mémoire :

| Métrique | Calcul |
|----------|--------|
| Taux d'exécution | `exécutés / total` (statut de `runs` différent de `pending`) |
| Taux de succès | `PASS / exécutés` |
| Répartition | Nombre d'entrées par **statut brut** (GH74) : Passé, Échoué, Bloqué, Incomplet, En attente |
| Couverture req. | Exigences couvertes par au moins un PASS dans cette campagne |

**Pastilles et filtre (GH65, GH74)** : une pastille par **statut brut** d'entrée présent (Passé,
Échoué, Bloqué, Incomplet, En attente) ; ce sont des boutons bascule — clic = liste des entrées
réduite à ce statut, re-clic = retrait (lien « Filtre : X ✕ »). Filtre porté par le paramètre d'URL
optionnel `status` de `/campaign/$campaignId` (valeur invalide ignorée), posé aussi par la vue Suivi
(entrée non exécutée → page filtrée sur son statut, SPEC-DASHBOARDS §6). Le paramètre `progress` des
étapes d'avancement GH71 est retiré : une URL qui le porte est ignorée (page non filtrée). Les étapes
d'avancement (préparation du test → prêt → résultat) restent disponibles dans la vue Suivi, calculées
par la bibliothèque projet (`entryStep`, widget « Avancement par campagne »), comme le suivi
multi-campagnes (% exécuté, % PASS, exécutions par jour, avancement dans le temps : dashboard
« Campagnes », SPEC-DASHBOARDS §7.1). La pastille « Non approuvé » (GH68, §4.2) est conservée.

### 4.4 Substitution des paramètres à l'exécution (T97, T171)

Sur les pages qui affichent le contenu d'un test dans le contexte d'une campagne (exécution en
cours, relecture d'un run terminé) : chaque référence dans `preconditions`, `postconditions`,
`action`/`expectedResult` d'étape est remplacée par la valeur **figée** de l'instance —
`resolvedParams[ref]` puis `paramValues[ref]` (T171) — avec le style dédié ; le survol indique
l'origine (base ou saisie), sans édition possible. L'en-tête indique la source de résolution
(« Paramètres lus à la baseline `<tag>` » ou « sur l'état courant ») et un bandeau liste les
références non résolues de l'instance. Instances antérieures à T171 (sans champ de résolution) :
substitution T97 d'origine depuis `paramValues`, code Markdown compris, affichage inchangé.
Les exports de campagne (plan, rapport — xlsx, docx, pdf, y compris à partir d'un gabarit client —
GH34, une entrée `entries` par instance avec son `requirementId`) utilisent les mêmes valeurs figées, y
compris les paramètres saisis à la main (non substitués avant T171). Depuis T49,
le texte utilisé est celui de `testSnapshot` (figé à l'ajout) quand il est présent, pas celui de
l'état live du test — cohérent avec le reste de la page.

- Un `{label}` du texte du test (snapshot, ou état live pour une entrée pré-T49) sans valeur
  correspondante dans `paramValues` (le test avait déjà ce paramètre au moment du snapshot, mais
  sans valeur saisie — ou, pour une entrée pré-T49 sans snapshot, le test live a été modifié pour
  introduire un nouveau paramètre depuis l'ajout à la campagne) s'affiche littéralement, non
  substitué, sans bloquer l'affichage.
- Une valeur de `paramValues` dont le `{label}` n'apparaît plus dans le texte (snapshot ou live
  selon le cas — paramètre retiré du test depuis, pour une entrée pré-T49) est simplement ignorée.
- Hors contexte de campagne (fiche de définition du test) : depuis T171, la référence affiche la
  valeur **courante** de la base (SPEC-REQ §3.5), pas une valeur figée.
- *(T179)* Instance générée pour une exigence : les `{req.<champ>}` sont substituées comme les
  autres références figées (`resolvedParams`) ; l'en-tête rappelle « Exigence de cette instance :
  `<ID>` » (et son titre s'il a été figé via `{req.title}`). Le `TestRun` créé à l'exécution porte
  `requirementId` : il ne compte, en couverture, que pour cette exigence (SPEC-TRACEABILITY §2.3).
  Exports de campagne (plan xlsx/docx/pdf, rapport docx/pdf) : une ligne par instance, avec l'ID de
  son exigence (colonne « Exigence » en xlsx, suffixe `· <ID>` ailleurs).
- Les champs concernés étant du Markdown (voir §5, sérialisation `RichTextField`/`RichTextViewer`),
  la substitution n'échappe pas manuellement le HTML — le rendu Markdown (`html: false`) neutralise
  déjà tout caractère spécial présent dans une valeur substituée.

### 4.5 Exécution hors outil : classeur Excel d'exécution (GH36)

Pour les équipes qui n'exécutent pas les campagnes dans Polenta : la campagne est exportée dans un
classeur Excel que les testeurs remplissent, puis le classeur rempli est réimporté. Bouton
**« Excel d'exécution »** dans le header de la page campagne (`ExecutionSheetMenu`), absent sur une
campagne `completed`/`abandoned` (export et import y sont aussi refusés côté main). Format natif
fixe, indépendant des gabarits client (GH34). Code : `CampaignExecutionService`,
`export/campaign-execution.xlsx.ts` (export), `export/campaign-execution-import.ts` (import),
libellés et types partagés dans `@polenta/types` (`campaign-execution-sheet.ts`).

> **Format v3 (GH196)** : une colonne jaune par champ d'exécution (ligne d'instance) puis par champ
> d'étape (lignes d'étape), insérées **après « Commentaire »** ; union des types de la campagne (un
> nom = une colonne) ; cellule sans objet grisée et verrouillée ; en-tête avec `*` (obligatoire) et
> commentaire de cellule (type, valeurs, condition) ; liste déroulante pour enum / boolean ; défaut
> pré-rempli ; lien = hyperlien, URL ou `libellé | URL`. La feuille `_polenta` porte la **carte des
> colonnes** (ligne `columns`) : un v3 est lu par elle, v1 / v2 restent lus par l'ordre fixe (sans
> champs). Import : erreurs par instance `invalid_field_value` / `required_field_missing` (ligne, champ,
> message), les autres instances importées.
>
> **Résultats déjà saisis (GH196)** : une instance déjà exécutée est exportée avec son résultat
> (dernier run de l'entrée : verdicts, testeur, date, commentaires en texte simple, champs). La feuille
> `_polenta` porte, par instance pré-remplie, la signature de ces valeurs (colonne `prefill`) ; au
> réimport, une instance dont les valeurs donnent la même signature est **ignorée** (« N instances déjà
> exécutées, non modifiées »), une instance modifiée crée un nouveau run comme une saisie.

> **Client web (GH44)** : l'export est **téléchargé** (`web:execution-sheet-export`) ; à l'import,
> le classeur est choisi dans le navigateur, envoyé (`POST /upload`) et prévisualisé par
> `web:execution-sheet-preview` ; l'application (`campaigns:execution-sheet-apply`) est inchangée.
> Mêmes règles de contenu, de revalidation et de refus (`SPEC-WEB.md` §7).

**Export** (« Exporter le classeur d'exécution… », nom proposé `<CAMP-ID>_execution_<AAAA-MM-JJ>.xlsx`) :
toutes les instances de la campagne, dans l'ordre de `runs[]`, chacune sur une **ligne d'instance**
suivie d'une **ligne par étape** (niveau de plan 1, repliable). Colonnes, dans l'ordre : Clé
(masquée), Instance, Étape, Test / Action, Résultat attendu, **Verdict, Testeur, Date d'exécution,
Commentaire** (cases de saisie, en jaune), puis Exigence (`requirementId`, T179), Paramètres
(valeurs figées `réf = valeur`), Statut actuel. Le texte des étapes et les pré/postconditions sont
ceux de `testSnapshot` (sinon test live, §4.2), paramètres substitués comme en §4.4, convertis en
texte brut ; images et diagrammes remplacés par `[image]` / `[diagramme]`. Test source introuvable :
ligne d'instance « (test introuvable) » sans étape.
- Seules les cases de saisie sont déverrouillées (Verdict/Testeur/Date/Commentaire sur une ligne
  d'instance, Verdict/Commentaire sur une ligne d'étape) ; feuille protégée **sans mot de passe** ;
  listes déroulantes de verdicts (global : §3.3, étape : §3.3 StepResult) dans la langue de l'UI ;
  filtre automatique et volet figé (en-têtes + colonnes Clé/Instance/Étape). Excel refuse de trier
  une feuille protégée contenant des cellules verrouillées : le tri suppose d'ôter la protection,
  sans effet sur l'import.
- Chaque ligne porte une **clé technique** masquée (`entryId` ou `entryId#order`) ; une feuille
  `_polenta` très masquée porte `formatVersion` (2 depuis GH81), `campaignId`, `exportedAt`,
  `locale` et, par instance, `entryId`, `testCaseId`, `orders`, `testFound`, `fingerprint` (GH81 :
  sha256 de la version exportée, forme canonique sans `history`, champs dérivés du `git log`,
  `needsRevalidation`, `status` ni `version` — `testFingerprint`). Les classeurs v1 restent
  importables.

**Import** (« Importer des résultats… ») : sélection du fichier, **aperçu** (`ExecutionImportModal`,
aucune écriture), puis « Importer N résultats ». À l'application, le main **relit et revalide** le
fichier contre l'état courant de la campagne (l'aperçu n'est qu'indicatif).
- Lignes identifiées par leur clé, jamais par leur position (tri/filtre sans effet). Langue du
  classeur indifférente : verdicts reconnus en code (`FAIL`) ou libellé FR/EN, casse et espaces ignorés.
- Une instance est **remplie** si son verdict global ou au moins un verdict d'étape est renseigné ;
  sinon elle est ignorée (inchangée) — import partiel, import successif de plusieurs fichiers.
- Instance remplie : verdict d'étape vide → `NOT_EXECUTED` ; verdict global saisi → utilisé tel
  quel, sinon calculé (règle §3.3) ; Testeur vide → identité git de l'utilisateur qui importe ;
  Date vide → date de l'import (cellule date, formule, `AAAA-MM-JJ[ HH:mm]` ou `JJ/MM/AAAA[ HH:mm]`,
  heure locale ; sans heure → midi local) ; commentaires en texte brut → Markdown échappé, une ligne
  = un paragraphe.
- **Toute instance remplie écrase** le résultat existant : un nouveau `TestRun` est créé (même
  service que l'exécution dans l'outil, `origin: 'excel-import'`, `requirementId` de l'instance,
  `campaignEntry` de l'instance — GH73 —, testeur et date du fichier), puis l'instance prend son statut, son `runId`, `executedAt` et
  `executedBy` ; campagne `planned` → `in_progress`. L'aperçu signale « remplace le résultat
  existant ». Écriture séquentielle ; une erreur arrête l'import (les instances déjà écrites restent).
- Refus global (rien d'écrit) : fichier illisible, pas de feuille `_polenta`, version inconnue,
  classeur d'une autre campagne, campagne clôturée. Erreur propre à une instance (exclue, les autres
  importées) : instance absente de la campagne, test introuvable, **test modifié depuis l'export**
  (`test_changed_since_export`, GH81 : empreinte de la version effective ≠ `fingerprint` du
  classeur ; contrôlé avant les étapes, classeur v2 seulement), étapes du fichier ≠ étapes
  exportées, verdict non reconnu, date illisible. Ligne sans clé portant une saisie : avertissement.
  Instance importable dont la version effective n'est pas approuvée : avertissement
  `test_not_approved`, import non refusé (GH68).
- Export (GH81) : **aucune écriture** — le classeur porte la version effective de chaque instance
  (§4.2 « Tests non approuvés ») et son empreinte. À l'import d'un classeur v2, une instance
  resynchronisable voit sa copie remplacée par cette version (empreinte vérifiée) dans la même
  écriture que le résultat ; classeur v1 : copie actuelle conservée.
- Relecture d'un run importé : badge « Importé depuis Excel ».

`CampaignTestRun.executedBy` est désormais réécrit à chaque saisie de résultat : renseigné par un
import, retiré par une exécution dans l'outil (qui ne le fournit pas).

---

## 5. Stockage Git

```
<project-git-repo>/
├── tests/
│   ├── TEST-0001.yaml       ← définition du cas de test
│   ├── TEST-0042.yaml
│   └── ...
├── test-versions/
│   ├── TEST-0001/
│   │   ├── v1.yaml          ← snapshot version 1
│   │   └── v2.yaml
│   └── ...
├── executions/
│   ├── TEST-0001/
│   │   ├── RUN-20260601-001.yaml
│   │   └── RUN-20260615-001.yaml
│   └── ...
└── campaigns/
    ├── CAMP-0001.yaml     ← plan + statuts d'exécution (`runs[]`), voir §4.1
    └── ...
```

**Format d'un cas de test YAML complet :**

```yaml
# tests/TEST-0042.yaml
id: TEST-0042
title: "Démarrage moteur — mode Éco, batterie 50%"
type: manual
status: approved
currentVersion: 1
hasDraft: false
linkedRequirements:
  - reqId: SW-0042
    reqVersion: 2
    coverageType: full
  - reqId: SYS-0007
    reqVersion: 1
    coverageType: partial
preconditions: "<p>Batterie chargée à 50% (±5%). Température ambiante 20°C ±3°C. Aspirateur éteint depuis au moins 30 secondes.</p>"
equipment:
  - id: eq-1
    role: "Produit sous test"
    description: "Aspirateur sans fil, révision HW ≥ B"
    required: true
    quantity: 1
  - id: eq-2
    role: "Alimentation réglable"
    description: "18V / 5A minimum, précision ±10mV"
    required: true
    quantity: 1
  - id: eq-3
    role: "Multimètre"
    description: "Classe 1, mesure courant DC, gamme 10A"
    required: true
    quantity: 1
steps:
  - order: 1
    action: "<p>Vérifier l'affichage de charge sur l'aspirateur.</p>"
    expectedResult: "<p>2 barres allumées sur 4.</p>"
    notes: null
  - order: 2
    action: "<p>Appuyer brièvement sur le bouton démarrage (&lt; 1s).</p>"
    expectedResult: "<p>Moteur démarre en mode Éco en <strong>moins de 500ms</strong>. LED verte fixe.</p>"
    notes: "<p>Mesurer le délai avec le chronomètre ou l'oscilloscope sur la ligne d'activation moteur.</p>"
  - order: 3
    action: "<p>Connecter le multimètre en série sur l'alimentation. Relever le courant moteur.</p>"
    expectedResult: "<p>Courant entre <strong>1,8A et 2,2A</strong>.</p>"
    notes: null
postconditions: "<p>Éteindre l'aspirateur. Remettre la batterie en charge.</p>"
fields:
  environment: lab
  duration: 15
  tags: [regression, performance]
  automationId: null
createdAt: "2026-03-01T10:00:00Z"
createdBy: user-123
updatedAt: "2026-04-10T14:30:00Z"
updatedBy: user-456
```

**Format d'un TestRun YAML complet :**

```yaml
# executions/TEST-0042/RUN-20260601-001.yaml
id: RUN-20260601-001
testCaseId: TEST-0042
testCaseVersion: 1
campaignEntry:            # GH73 — absent pour une exécution isolée
  campaignId: CAMP-0003
  entryId: TEST-0042-1
result: FAIL
executedAt: "2026-06-01T09:00:00Z"
executedBy: user-789
duration: 920
equipmentUsed:
  - equipmentId: eq-1
    role: "Produit sous test"
    identification: "Aspirateur Polenta rev C, SN: ASP-2026-00142, FW: 1.4.2"
    calibrationDate: null
    notes: "Unité de pré-série"
  - equipmentId: eq-2
    role: "Alimentation réglable"
    identification: "Keysight E3645A, SN: MY48001234"
    calibrationDate: "2025-11-01"
    notes: "Réglée à 18.0V"
  - equipmentId: eq-3
    role: "Multimètre"
    identification: "Fluke 87V, SN: 27540492"
    calibrationDate: "2026-03-10"
    notes: null
stepResults:
  - order: 1
    result: PASS
    comment: "<p>2 barres affichées, conforme.</p>"
    executedAt: "2026-06-01T09:05:00Z"
  - order: 2
    result: FAIL
    comment: |
      <p>Délai mesuré : <strong>800ms</strong> (attendu &lt; 500ms).</p>
      <p>Reproductible à froid. Température ambiante au test : 18°C.</p>
      <img src="https://onedrive.live.com/embed?...step2-scope.png" />
      <p>Capture CH1 : front montant commande moteur. CH2 : courant moteur. Retard visible.</p>
      <p>Log complet : <a href="https://onedrive.live.com/...step2-log.txt">step2-log.txt</a></p>
    executedAt: "2026-06-01T09:12:00Z"
  - order: 3
    result: NOT_EXECUTED
    comment: "<p>Interrompu après échec étape 2.</p>"
    executedAt: null
notes: "<p>Test réalisé à 18°C (hors spec des 20°C ±3°C). À refaire dans les conditions nominales après correction FW.</p>"
```

---

## 6. Index mémoire — extension

Le `RequirementsIndexService` est étendu (ou un `TestsIndexService` parallèle est créé) pour indexer :

```
TestsIndex (par projet/branche)
  ├── testCases    : Map<id, TestCase>
  ├── testRuns     : Map<testCaseId, TestRun[]>
  ├── campaigns    : Map<id, TestCampaign>   (runs[] embarqué, voir §4.1-4.2)
  └── search       : MiniSearch (title, preconditions)
```

**Requêtes clés pour la traçabilité :**
- `findTestsByRequirement(reqId)` → tous les TestCase couvrant cette exigence
- `findPassingRunsFor(testCaseId, testCaseVersion)` → PASS runs pour une version précise
- `coverageForRequirement(reqId)` → `covered | not_covered | needs_revalidation`

---

## 7. Décisions de conception arrêtées

| Point | Décision |
|-------|----------|
| Étapes hiérarchiques | **Non** — toujours à plat. Structuration par étapes-titre si besoin. |
| Retest | **Nouveau TestRun indépendant** — pas de lien `retestOf`. L'historique chronologique suffit. |
| Pièces jointes | **Champ `link` structuré** (GH195), ou lien collé dans un RICHTEXT — pas de stockage dans Polenta. Pas d'AWS S3. |
| Statut de campagne | **Manuel uniquement** — le testeur décide quand clôturer. Pas d'auto-complete. |
| Import JUnit XML | **TestRun isolés** — pas de rattachement automatique à une campagne. Rattachement manuel si besoin. |
| Paramètres de test | **Détection automatique par `{label}`** — pas de liste déclarée séparément (T97). |
