# SPEC-REQ — Module Gestion des Exigences

> Spec détaillée du périmètre "Exigences" de Polenta.  
> Voir aussi : [SPEC-TEMPLATES.md](SPEC-TEMPLATES.md) pour la configuration métier par domaine.  
> Dernière révision : 2026-10-11 (GH45 S4 — autocomplétion du champ `user`)

---

## 1. Vue d'ensemble

Le module Exigences gère :
- des **types d'objets configurables** par projet et par composant (`ObjectTypeDefinition` avec `category: requirement`),
- des **champs personnalisés** par type (`SchemaField` : text, richtext, enum, number, date…),
- un **cycle de vie par statuts** librement configurables (pas de graphe de transitions imposé),
- un **versionnement natif Git** — les fichiers sont la source de vérité, l'historique Git est l'historique des versions,
- des **liens typés entre objets** (`ObjectLink`), gérés comme une entité séparée.

---

## 2. Modèle de données

### 2.1 Type d'objet (`ObjectTypeDefinition`)

Chaque composant (nœud) du projet définit ses propres types d'objets. Pour la catégorie `requirement`, un type correspond à une catégorie sémantique ou à un niveau de décomposition.

**Exemples typiques :**

| Nœud | Type | Préfixe |
|------|------|---------|
| root | Exigence Système | SYS |
| root | Exigence Logicielle | SW |
| bms | Exigence BMS | BMS |
| motor-control | Exigence Firmware Moteur | MCU |

Un type est défini par :

| Attribut | Type | Description |
|----------|------|-------------|
| `name` | string | Identifiant unique dans le nœud (ex. `"exigence-systeme"`) |
| `label` | string | Nom affiché dans l'UI |
| `prefix` | string | Préfixe des IDs (ex. `"SYS"`) — **unique sur tout le projet** |
| `color` | string | Couleur d'affichage (hex) |
| `category` | enum | Toujours `requirement` pour ce module |
| `fields` | list | Champs personnalisés — voir §3 |
| `statuses` | list | Statuts — voir §4 |
| `trackStatusHistory` | bool? | **GH77** — historiser le statut (`history.status`, §4.4). Absent = `true` ; écrit seulement quand `false`. Vaut aussi pour les campagnes |

**Référence croisée :** un objet exigence se référence par son `objectTypeRef` au format `"nœud::nom-type"` (ex. `"root::exigence-systeme"`).

**Modification de configuration :** la modification d'un type n'affecte pas les données existantes (les champs supprimés restent présents dans les fichiers, ils ne sont plus affichés dans l'UI).

**Exposition MCP (T122)** : ce modèle (`ObjectTypeDefinition`, `objectTypeRef`,
`prefix` unique projet-wide) est celui que le serveur MCP manipule tel quel — en
lecture via `get_schema`, en création via `bulk_import_requirements` (résolution
d'`objectTypeRef`, IDs prévisionnels), et en mutation ciblée via `add_object_type`
(même invariant d'unicité de `prefix`, règle 10 CLAUDE.md). Voir `SPEC-MCP-SERVER.md`
§4.

---

## 3. Champs personnalisés (`SchemaField`)

Chaque type possède une liste de `SchemaField` constituant son schéma métier.

### 3.1 Attributs d'un champ

| Attribut | Type | Description |
|----------|------|-------------|
| `name` | string | Identifiant unique dans le type (ex. `"statement"`) |
| `label` | string | Libellé affiché |
| `type` | enum | Nature du champ — voir §3.2 |
| `values` | list | Valeurs possibles (pour `enum` et `multi_enum` uniquement) |
| `required` | bool | Obligatoire à la soumission en review |
| `default` | any | Valeur par défaut à la création |
| `placeholder` | string | Texte indicatif |
| `validator` | string | Validation syntaxique optionnelle : `EARS` ou `regex:<pattern>` |
| `trackHistory` | bool? | **GH77** — historiser ce champ (`history.<name>`, §4.4). Écrit seulement quand vrai. Jamais pour un champ nommé `status` |

**Exposition MCP (T122)** : `validator: EARS` est la seule règle de ce champ **enforcée
en dur** par le serveur MCP (pas seulement documentée) — `bulk_import_requirements`/
`bulk_import_tests` refusent (en `dryRun: true` comme `dryRun: false`) toute entrée
dont un champ `validator: EARS` ne respecte pas l'un des 5 patterns EARS, en réutilisant
`isEarsCompliant` (même heuristique que le calcul de maturité de l'UI). Les autres
règles de cohérence de `CLAUDE.md` restent hors enforcement (statu quo, documentées
dans `AGENTS.md`). Voir `SPEC-MCP-SERVER.md` §4.2.

### 3.2 Types de champs

| Type | Description |
|------|-------------|
| `text` | Texte court, ligne unique |
| `textarea` | Texte court multi-ligne |
| `richtext` | Éditeur riche (markdown, images référencées par fichier du repo ou par URL externe — voir §3.2b, liens internes `[[SW-0042]]`, diagrammes draw.io référencés — voir §3.2a) |
| `number` | Nombre |
| `enum` | Valeur unique parmi une liste |
| `multi_enum` | Valeurs multiples parmi une liste (cases à cocher) — rendu cohérent dans les 4 endroits d'édition : Vue Système (`EditView`), formulaires détail/création req/test/campagne (`DynamicField`), édition inline Vue Tableau et Vue Document (popover ancré sur la cellule/le champ) — T126 |
| `boolean` | Booléen |
| `date` | Date |
| `datetime` | Date et heure |
| `drawio` | Référence à un fichier `.drawio` du repo (chemin) + bouton d'ouverture dans l'application draw.io externe du poste — pas d'éditeur intégré, pas d'iframe réseau |
| `user` | Référence utilisateur : la valeur enregistrée est le **login** (chaîne, format YAML inchangé). GH45 S4 — quand l'`origin` du repo est sur une forge Forgejo/Gitea dont le propriétaire est une organisation, les **membres de l'organisation** (login, nom affiché) sont proposés en autocomplétion (`<datalist>`), chargés une fois par session (`forge:org-members`, SPEC-PROJECT-MANAGEMENT §9.3), dans la Vue Système (`EditView`), les formulaires (`DynamicField`) et l'édition inline de la Vue Tableau. La saisie reste libre (utilisateur externe, hors ligne) ; repo personnel, GitHub ou forge injoignable : texte libre, sans message. |

### 3.2a Diagrammes draw.io dans un champ `richtext` (T47)

Un champ `richtext` peut contenir un ou plusieurs diagrammes draw.io insérés
depuis la toolbar de l'éditeur ("Insérer un diagramme draw.io"). Contrairement
au type de champ `drawio` (référence unique, champ dédié), un richtext peut
référencer plusieurs diagrammes positionnés librement dans le texte.

- **Stockage** : référence à un fichier `.drawio` existant du repo (jamais de
  XML embarqué inline), avec une ancre optionnelle vers une page ou une cellule
  précise (`nodeId`) — cohérent avec la décision D4 de `CONTEXT.md`.
- **Sérialisation Markdown** : bloc de code fenced dédié, contenu JSON
  (`{"path": "...", "nodeId": "..."}`), pas la syntaxe image Markdown :
  ````
  ```drawio
  {"path":"diagrams/foo.drawio","nodeId":"node-PWR-001"}
  ```
  ````
- **Affichage** : rendu via le **viewer officiel draw.io vendoré**
  (`viewer.min.js`, moteur mxGraph réel, licence Apache-2.0), chargé en local —
  **pas d'iframe `embed.diagrams.net`**, aucune requête réseau (les chemins
  réseau par défaut du script vers `viewer.diagrams.net` sont neutralisés au
  chargement). Fidélité de rendu identique à draw.io (styles, connecteurs,
  routage), contrairement à un rendu approximatif maison. Si l'ancre référence
  une page, cette page est affichée ; si elle référence une cellule, la page
  qui la contient est affichée avec la cellule surlignée (coordonnées lues
  directement depuis le graphe du viewer) ; sinon la première page.
- **Rendu en lecture, Vue Word** *(T163)* : le même viewer vendoré est utilisé,
  mais monté **paresseusement** — un diagramme n'est rendu que lorsqu'il entre
  (ou approche) le viewport (`IntersectionObserver`), et une seule fois (pas de
  rafraîchissement au retour de focus, contrairement à l'édition). La Vue Word
  monte tous les éléments du document d'un coup ; sans cette paresse, un viewer
  canvas par champ × N éléments gèle l'onglet. La taille (`width`/`height`) et le
  cadrage (`crop`) stockés sont restitués à l'identique de la Vue Édition. Aucune
  interaction : un clic sur le diagramme passe le champ en édition (où le viewer
  interactif prend le relais). `repoPath` absent, fichier introuvable ou invalide
  → repli sur une étiquette `📐 nom-de-fichier` ou un message d'erreur inline
  discret, jamais de crash. Le rendu s'appuie sur `lib/staticDrawio.ts` /
  `StaticRichTextViewer` (rendu markdown-it sans éditeur Tiptap). Depuis T167,
  `StaticRichTextViewer` accepte une prop optionnelle `highlightRegex` qui
  surligne (`<mark>`) les occurrences dans les nœuds texte du rendu (Vue
  Recherche, `SPEC-ELECTRON-DESKTOP` §19.17) — best effort, ignore
  `pre`/`code`/`.static-drawio` ; inerte sans la prop. Depuis T169, une prop
  `variant?: 'default' | 'compact'` : `compact` = typographie resserrée pour une
  cellule de la Vue Excel (text-xs, titres au corps du texte, sans marges
  verticales, images bornées à la largeur de cellule) ; `default` inchangé
  (Vue Word, Vue Recherche). Côté éditeur, `RichTextField` accepte depuis T176
  `initialCaret?: 'end' | (() => { left, top } | null)` (avec `autoFocus`) :
  position initiale du curseur — `'end'` par défaut, ou coordonnées client lues
  une fois l'éditeur monté (`posAtCoords`), utilisé par la Vue Excel pour placer
  le curseur au point double-cliqué.
- **Édition** : pas d'éditeur draw.io intégré. Double-clic sur le diagramme
  rendu ouvre le fichier dans l'application draw.io externe du poste ; le
  rendu inline se rafraîchit automatiquement au retour de focus sur la fenêtre
  Polenta.
- Fichier introuvable ou XML invalide → état d'erreur explicite inline, jamais
  de crash de l'éditeur.

### 3.2b Redimensionnement, rognage et menu contextuel des blocs média (T75, stockage image T76)

Les images et les diagrammes draw.io insérés dans un champ `richtext` sont
redimensionnables, rognables (crop) et éditables via un menu contextuel clic
droit — uniquement en édition (`RichTextField`), jamais dans le rendu lecture
seule (`RichTextViewer` / `StaticRichTextViewer` restent un affichage statique de
la taille/du cadrage déjà stockés, sans aucune interaction). Cette règle porte
sur **l'interaction d'édition** (poignées, rognage, menu), pas sur la présence du
diagramme : depuis T163 le diagramme draw.io est bien rendu en lecture, y compris
en Vue Word (cf. §3.2a), le cadrage/redimensionnement stockés étant restitués.

- **Stockage image** *(T76)* : une image collée ou insérée via le sélecteur de
  fichier est copiée dans un dossier `images/` à la racine du repo courant
  (miroir de `diagrams/` pour les diagrammes draw.io, cf. D4 de `CONTEXT.md`)
  et référencée par **chemin relatif** — plus de data URI base64 embarqué pour
  les nouvelles insertions. Une image déjà référencée ailleurs dans le repo
  n'est pas recopiée. Le contenu déjà stocké en base64 avant T76 continue de
  s'afficher tel quel (aucune migration automatique, perte assumée si le
  fichier d'origine du collage n'est plus disponible) ; une image référencée
  par URL externe (`![alt](https://...)`) reste rendue directement, sans
  passage par le repo.
- **Redimensionnement** : poignées aux quatre coins du bloc sélectionné,
  ratio largeur/hauteur toujours conservé. La taille choisie est stockée en
  pixels d'affichage (`width`/`height`, `null` = taille native/auto).
- **Rognage image** : rectangle en **fractions [0,1] de la taille native** de
  l'image — robuste à un remplacement ultérieur du fichier par une image de
  dimensions différentes (le même cadrage relatif est réappliqué). Le fichier
  source n'est jamais modifié sur disque.
- **Rognage draw.io** : cadrage du **viewport affiché** (pan/zoom) en unités
  du modèle mxGraph — le fichier `.drawio` référencé n'est jamais modifié.
  Un changement de page/node-id réinitialise le cadrage (les bornes valides
  changent avec la page).
- **Sérialisation Markdown image** : la syntaxe standard `![alt](src)` est
  conservée tant qu'aucune métadonnée (taille/rognage) n'est définie —
  compatibilité ascendante totale, zéro churn sur les images déjà stockées.
  Dès qu'un attribut est défini, sérialisation en bloc fenced dédié (même
  principe que le bloc `drawio` de T47) :
  ````
  ```image
  {"src":"...","width":320,"height":180,"crop":{"x":0.1,"y":0,"width":0.8,"height":1}}
  ```
  ````
  `src` contient un chemin relatif (T76), un data URI (contenu historique
  pré-T76) ou une URL externe — même clé, la distinction se fait au rendu par
  préfixe (`data:`, `http(s)://`, sinon chemin de repo). Le bloc `drawio`
  (T47) est étendu avec les mêmes clés optionnelles `width`/`height`/`crop`
  dans son payload JSON existant.
- **Menu contextuel (clic droit)** : tronc commun aux deux types
  (Redimensionner, Rogner, Remplacer le fichier, Supprimer) complété pour un
  bloc draw.io par Ouvrir dans draw.io et Changer de page/node-id (sans
  ré-insertion). "Rogner" est désactivé si les bornes de cadrage ne sont pas
  disponibles (chargement en cours, ou diagramme/image en état d'erreur).
  "Remplacer le fichier" copie le nouveau fichier dans `images/`/`diagrams/`
  selon le type (T76 pour les images) et affiche un message d'erreur inline
  si la copie échoue.

### 3.2c Tableaux dans un champ `richtext` (T42)

Un champ `richtext` peut contenir des tableaux simples (grille régulière de
lignes/colonnes), insérés depuis la toolbar de l'éditeur ("Insérer un
tableau") ou collés depuis une plage Excel.

- **Insertion** : bouton toolbar ouvrant une grille survolable (façon
  Word/Google Docs, 8×8 max) — le nombre de lignes/colonnes survolé est le
  total inséré, en-tête incluse (`insertTable({ rows, cols, withHeaderRow:
  true })`, nœuds standard `@tiptap/extension-table`/`-row`/`-header`/`-cell`).
  Tout tableau inséré a systématiquement une ligne d'en-tête.
- **Pas de fusion de cellules** (colspan/rowspan) : uniquement des tableaux à
  grille régulière. Un tableau collé depuis Excel contenant des cellules
  fusionnées voit ses attributs de fusion retirés à l'insertion.
- **Édition** : menu contextuel clic droit sur une cellule — ajouter une ligne
  au-dessus/en dessous, supprimer la ligne, ajouter une colonne à
  gauche/droite, supprimer la colonne, supprimer le tableau. Chaque action
  est désactivée quand elle produirait un tableau invalide (ex. supprimer la
  dernière ligne/colonne restante), cohérent avec le comportement natif de
  `@tiptap/extension-table`. Menu disponible uniquement en édition
  (`RichTextField`), jamais dans `RichTextViewer` (lecture seule).
- **Collage Excel** : une plage de cellules Excel copiée est insérée comme un
  tableau structuré (pas une image) — le HTML du presse-papiers est détecté
  et sa première ligne promue en en-tête avant insertion (le HTML exporté par
  Excel ne contient que des cellules simples, jamais de cellule d'en-tête
  distincte).
- **Sérialisation Markdown** : syntaxe GFM standard (`| a | b |` + ligne
  séparateur `| --- | --- |`), supportée nativement par le moteur Markdown de
  l'éditeur — pas de bloc fenced JSON custom (contrairement aux blocs
  `image`/`drawioEmbed` de §3.2a/§3.2b). Un tableau dont la première ligne
  n'est pas entièrement composée de cellules d'en-tête, ou qui contient une
  fusion, ne peut pas être représenté dans ce format — cette contrainte est ce
  qui impose l'absence de fusion et la promotion systématique de la première
  ligne en en-tête ci-dessus.

### 3.2d Champ `multi_enum` nommé `roles` — source unique avec le catalogue d'interface (T110, complété T126)

Un champ de type `multi_enum` dont le `name` vaut exactement `roles` est spécialisé : ses options affichées en édition proviennent du catalogue de rôles du repo courant (`ProjectSchema.roles`, voir `SPEC-TEMPLATES.md` §3a) plutôt que de `values:` codées en dur dans le `SchemaField`, dès que ce catalogue est non vide. Spécialisation par nom de champ (`resolveMultiEnumOptions`, `@polenta/types`), pas un `SchemaFieldType` dédié — pas de migration de projets existants.

> **Limite connue (T123)** : `roles`/`implements` vivent désormais sur `SystemNode` (root compris,
> cf. `SPEC-TEMPLATES.md` §3a), `ProjectSchema.roles` n'en reste qu'un miroir maintenu à jour pour
> le node `root` uniquement (`SchemaService.save()`). Ce mécanisme de sourcing lit encore
> exclusivement `ProjectSchema.roles` — il source donc correctement le catalogue d'un composant
> `root` marqué interface, mais **pas encore** celui d'un composant local marqué interface (son
> catalogue vit sur son propre `SystemNode`, jamais mirroré au niveau fichier). Un composant local
> interface expose bien son catalogue dans sa popup d'édition (Structure) et dans la matrice de
> conformité — seul ce sourcing du champ `roles` d'une exigence en reste au niveau `root`. À
> traiter dans un ticket dédié, en cohérence avec T126 (support `multi_enum` dans
> `DynamicField.tsx`), qui touche le même mécanisme.

- Résolution : une requête (`['schema', repoPath]`, via `useProjectSchema`, une seule par montage de vue) charge le schéma du repo de l'objet édité ; `schema.roles` non vide → ses `name` remplacent `field.values` pour ce champ précis. Tout autre champ `multi_enum` (ou un champ nommé `roles` dans un repo sans catalogue) garde le comportement générique (`field.values`).
- Fallback : si le catalogue est vide (repo pas encore marqué interface, ou projet créé avant T110), les `values:` du `SchemaField` restent utilisées telles quelles — aucune réécriture de fichiers existants requise.
- Le format de stockage ne change pas (CSV dans le fichier YAML de l'objet, ex. `"a, b, c"`, comme tout `multi_enum` — fonctions partagées `parseMultiEnumValue`/`serializeMultiEnumValue`, `@polenta/types`) — seule la source des *options proposées* change.
- **T126** — ce comportement, initialement présent uniquement dans `EditView` (Vue Système), est désormais cohérent dans les 4 endroits d'édition d'un champ `multi_enum` : Vue Système (cases à cocher inline), formulaires détail/création req/test/campagne (`DynamicField`, composant partagé `MultiEnumCheckboxes`), édition inline en Vue Tableau et en Vue Document (`ExcelView`/`WordView`, popover à cases à cocher ancré sur la cellule/le champ, composant partagé `MultiEnumPopover`).

### 3.2e Raccourci de validation dans un champ `richtext` — `Ctrl/Cmd+Entrée` (T158)

Depuis l'intérieur d'un champ `richtext` en édition (`RichTextField`, éditeur TipTap),
`Ctrl+Entrée` (`Cmd+Entrée` sur macOS) **valide la saisie du contexte d'édition courant**
au lieu d'insérer un saut de ligne :

| Contexte | Effet |
|---|---|
| Popover richtext, Vue Tableau (`ExcelView`) | Ferme le popover, valeur conservée |
| Champ inline, Vue Document (`WordView`) | `commit` : enregistre et sort du mode édition |
| `EditView` (Vue Système) | Flush/valide le champ (comme le blur des autres types) |
| Formulaires de création req/test/campagne | Soumet le formulaire (action du bouton primaire) |
| Pages détail req/test | Déclenche « Enregistrer » (si modifications) |
| Cellules d'un `StepsTable` | Câblé à l'action du conteneur (« Enregistrer » le test) ; à défaut, sort du champ — n'ajoute jamais d'étape |

- `Maj+Entrée` reste le saut de ligne dur ; `Entrée` seul reste le nouveau paragraphe / item de liste.
- Mécanique : extension TipTap `submitOnModEnter` (`priority: 1000`, capte `Mod-Enter`) +
  prop `RichTextField.onSubmit` (passe-plat via `DynamicField` / `StepsTable`). Sans
  `onSubmit` fourni, `Ctrl+Entrée` garde le comportement TipTap par défaut (saut de ligne) —
  champs en lecture seule inclus.
- `Ctrl+Entrée` prend le pas sur la sortie de bloc de code (`CodeBlock`) quand un `onSubmit`
  est câblé (sortie de bloc de code = flèche bas).

### 3.2f Références de paramètres dans le texte (T171)

Chaque repo (produit ou composant) porte une **base de paramètres** : `parameters/parameters.yaml`,
un dictionnaire `nom → { value, unit?, description? }` (valeur toujours chaîne, clés triées à
chaque écriture, nom `[A-Za-z0-9_-]+` non modifiable). Le texte des exigences (champs `text`,
`textarea`, `richtext` ; pas le titre) et des tests (preconditions, étapes, postconditions)
référence un paramètre par `{nom}` (base du repo de l'élément) ou `{<nœud>::nom}` (base du
composant `<nœud>`, déclaré dans les dépendances `polenta-repo.yaml` du repo de l'élément),
indépendamment des liens.

- **Affichage** : en lecture, la valeur (`value unit`) avec un style dédié ; survol = nom et
  description ; double-clic = édition du paramètre (lecture seule sur un repo readonly), ou
  création pour une référence locale inconnue. Dans l'éditeur, la référence reste `{nom}`
  stylée (valeur au survol) ; le Markdown stocké reste `{nom}`. Une référence non résolue
  (paramètre absent, valeur vide, nœud inconnu) reste littérale, barrée. Une référence écrite
  dans du code Markdown reste littérale et n'est ni comptée ni substituée.
- **Insertion** : bouton `{x}` de la barre d'outils ou saisie de `{` → sélecteur (paramètres du
  repo et des composants visibles, création).
- **Vue Paramètres** (barre d'activité) : bases par repo, recherche, nombre d'utilisations,
  « Utilisé par » (liens vers les éléments), création / modification / suppression (refusée tant
  qu'un élément non terminal utilise le paramètre).
- **Modification** (`value`, `unit`, ou création résolvant des références) d'un paramètre
  utilisé par un élément approuvé : confirmation, puis marquage `needsRevalidation` (§5.3).
- **Exports** exigences / tests : mêmes valeurs qu'à l'écran.
- *(T179)* `{req.<champ>}` (champ de l'exigence liée, résolu par instance en campagne — SPEC-TESTS
  §2.4a) n'a de sens que dans un test : dans une exigence, c'est du texte brut (ni style, ni
  « Utilisé par », ni résolution).

### 3.3 Validation (`validator`)

| Valeur | Comportement |
|--------|-------------|
| `EARS` | La première ligne non vide doit correspondre à un pattern EARS |
| `regex:<pattern>` | Expression régulière custom |
| *(absent)* | Pas de validation syntaxique |

Évalué : en temps réel (avertissement non bloquant), à la soumission en review (bloquant si `required: true`), et en CI via `scripts/check.py`.

### 3.4 Champs système (non configurables, toujours présents)

| Champ | Type | Description |
|-------|------|-------------|
| `id` | string | Identifiant unique stable (ex. `SW-0042`), jamais réassigné |
| `title` | text | Titre de l'exigence (obligatoire) |
| `objectTypeRef` | string | Référence au type : `"nœud::nom-type"` |
| `status` | string | Statut courant (parmi les statuts configurés du type) |
| `createdAt` | datetime | Date de création |
| `createdBy` | user | Auteur |
| `updatedAt` | datetime | Date de dernière modification |
| `updatedBy` | user | Auteur de la dernière modification |
| `needsRevalidation` | bool? | **T172** — impact à vérifier : un élément lié a quitté un statut d'approbation (§5.3). Persisté uniquement quand vrai (absent = `false`), indépendant du statut. Aussi présent sur les cas de test |
| `history` | map? | **GH77** — historique des champs suivis (§4.4) : une liste par champ, posée par l'application seule, absente tant que vide. Aussi sur les tests et les campagnes |

---

## 4. Cycle de vie et versionnement

### 4.1 Principe

Le versionnement est **natif Git**. Polenta ne gère pas de numéros de version internes — chaque commit Git représente un état de l'exigence. L'historique, les diffs, et les restaurations passent par `git log` / `git diff` / `git checkout`.

Il n'existe pas de concept de "brouillon" distinct d'une "version approuvée" — l'état courant du fichier est l'état de l'exigence. Le statut (`status`) exprime la maturité sémantique.

### 4.2 Statuts

Les statuts sont **entièrement configurables** par type d'objet (voir §4.3). Polenta n'impose aucun label ni aucune transition.

Exemple de cycle type pour une exigence :

```
draft ──[soumettre]──► review ──[approuver]──► approved
  ▲                       │
  └──────[rejeter]────────┘

approved ──[rendre obsolète]──► obsolete (isTerminal)
```

### 4.3 Définition d'un statut (`SchemaStatus`)

| Attribut | Type | Description |
|----------|------|-------------|
| `name` | string | Identifiant (ex. `"approved"`) |
| `label` | string | Libellé affiché |
| `color` | string | Couleur badge (hex) |
| `isApproval` | bool | Ce statut marque la validation formelle de l'objet |
| `isTerminal` | bool | L'objet est masqué des listes par défaut (soft-archive) |

**Toutes les transitions sont autorisées** — il n'y a pas de graphe de transitions à définir.

### 4.4 Historique des champs suivis (GH77)

Donnée brute : Polenta enregistre, fusionne et affiche l'historique, sans en calculer d'indicateur
(état à une date, durées, courbes : bibliothèque projet, #74, principe #79).

**Configuration** (`schema.yaml`) : le statut est suivi par défaut (`trackStatusHistory: false`
pour le désactiver) ; un champ l'est avec `trackHistory: true`. Éditeur de schéma (onglet
Structure) : colonne « Hist. » des champs, case « Historiser le statut ». MCP : `add_object_type`,
`add_field`.

**Stockage** — champ système `history` de l'objet (exigence, test, campagne) :

```yaml
history:
  status:
    - { value: draft, at: '2026-09-02T08:10:00Z', by: lolive }
    - { value: review, at: '2026-09-20T14:02:00Z', by: lolive, source: mcp }
  statement:
    - { at: '2026-10-02T11:00:00Z', by: lolive }   # richtext : événement seul
```

- `value` : clé technique (nom de statut, valeur d'enum, valeur brute ; `null` = vidé). Absente
  pour `textarea`, `richtext`, `drawio` (le contenu est dans git). Date YAML → `YYYY-MM-DD` pour
  un champ `date` ; nombre saisi en texte → nombre pour un champ `number`.
- `by` : login du compte du projet (desktop), de la session (client web), `--user` / `local`
  (MCP) ; nom de l'auteur du commit pour une entrée datée d'un commit (reprise, écart comblé).
- `source` : `mcp`, `git` (reprise), `schema` (valeur constatée au démarrage du suivi) ; absent =
  saisie dans l'application.

**Alimentation** : toute écriture d'objet passe par `HistoryService.stamp`, depuis la méthode
d'écriture unique de chaque service (`persist`) — une entrée par champ suivi dont la valeur change,
aucune sinon (autosave sans effet). Un test garde-fou (`history.write-paths.test.ts`) échoue si un
fichier d'objet est écrit ailleurs.

**La valeur courante fait foi** : si elle diffère de la dernière entrée (YAML édité à la main,
ancienne version, `git revert`, fusion), la lecture (`history:get`, tool MCP `get_history`) ajoute
une entrée `implicit: true` datée du dernier commit (jamais avant la dernière entrée) ; la prochaine
écriture l'enregistre (`source: schema` si la liste était vide).

**Évolution du schéma** : désactiver le suivi n'efface rien ; renommer un champ dans l'éditeur migre
`fields` et `history` de tous les objets du type (`schema:rename-fields`, compte rendu des objets
non migrés quand une donnée existe déjà sous le nouveau nom).

**Renommer un statut ou une valeur d'enum (GH82)** : statut détecté par son nom d'origine (ligne
de l'éditeur) ; valeur d'enum / multi_enum détectée par position, seulement si la liste garde sa
longueur, que l'ancienne valeur en a disparu et que la nouvelle n'y figurait pas (réordonner ou
échanger ne propose rien). Une confirmation **avant** l'enregistrement liste les renommages
(décochables), le nombre d'objets concernés (`schema:preview-value-renames`) et les collisions
(objets portant déjà la nouvelle valeur : confondus). Migration (`schema:rename-values`), écriture
brute — ni entrée d'historique, ni revalidation, ni `version` : `status` / `fields.<f>` (élément de
la liste pour multi_enum, séparateurs conservés), valeurs de `history`, copies `testSnapshot` des
campagnes du repo, `default` du champ. Requêtes et dashboards du Suivi non modifiés.

**Renommer un type (nom / préfixe, GH100)** : détecté à l'enregistrement d'un type existant dont le
nom ou le préfixe diffère de celui chargé. Aperçu sans écriture (`schema:preview-type-rename`) :
pré-contrôles tout ou rien — un repo du workspace absent du disque (`REPO_MISSING`), un nouvel ID
déjà présent comme fichier ou pierre tombale dans un repo du workspace (`ID_COLLISION`) → refus,
rien n'est enregistré. Sinon confirmation (objets renommés, objets rattachés au nouveau nom,
fichiers réécrits par repo, types de lien mis à jour), puis enregistrement du schéma et migration
(`schema:rename-type`, après GH77 / GH82, qui cherchent sous l'ancien `objectTypeRef`) :
- **préfixe** (exigences, tests ; les campagnes sont toujours `CAMP-NNNN`) : `OLD-n` → `NEW-n`
  (même numéro), ID entier réécrit dans le contenu et les chemins des dossiers de données de tous
  les repos du workspace (`requirements/ tests/ campaigns/ test-runs/ links/ reviews/
  impact-analyses/ impact-acks/ .polenta/trees/`, texte des champs compris ; jamais `diagrams/`,
  `images/`, dashboards, requêtes ni scripts) ; pierre tombale pour chaque ancien ID ;
- **nom** : `objectTypeRef` des objets du type, `testSnapshot.objectTypeRef` des copies de ses tests
  (campagnes de tous les repos), fichier d'ordre `.polenta/trees/<nœud>/<nom>.yaml`, refs
  `<nœud>::<nom>` des `linkTypes` du repo et des autres repos (sauf si l'un d'eux déclare encore un
  type `<nœud>::<ancien nom>`).
Écriture brute, au mieux par fichier (échecs listés dans le compte rendu). Limite : la date de
création (git) d'un objet renommé est celle du renommage (pas de suivi des renommages de fichier).

**Reprise depuis git** (Préférences du projet, par repo, `history:backfill`) : une entrée
`source: git` par changement de valeur le long de la chaîne des premiers parents de la branche
courante, datée du commit (date de commit) et signée de son auteur — les changements d'une branche
fusionnée sont datés et signés du commit de fusion ; fusion sans doublon avec les entrées de
l'application, entrées « début du suivi » redondantes retirées ; rejouable. Historique antérieur à
un renommage de champ non repris. Mesure : 2 000 objets ×
200 commits ≈ 1 min.

**Affichage** : section repliable « Historique » en lecture seule (détail d'exigence, de test, de
campagne, Vue Système › Édition), libellés lus dans le schéma, badges `MCP`, `git`, « début du
suivi », « déduite ».

---

## 5. Liens entre objets (`ObjectLink`)

Les liens sont une **entité séparée**, indépendante du schéma de champs.

### 5.1 Types de liens

Les types de liens sont définis dans `schema.yaml > linkTypes`. Exemples courants :

| Nom | Sens | Description |
|-----|------|-------------|
| `derives-from` | A → B | A découle de B (ex. exigence SW dérive d'une SYS) |
| `satisfies` | A → B | A satisfait B |
| `depends-on` | A → B | A ne peut être réalisée sans B |
| `conflicts-with` | A ↔ B | Contradiction entre A et B |
| `verified-by` | A → B | A (le test) vérifie l'exigence B |

Il n'existe pas de lien `PARENT_CHILD` implicite — toute relation entre objets passe par un `ObjectLink` typé.

`sourceRefs` / `targetRefs` d'un type de lien : une liste **vide** rend le type invalide — il
n'accepte aucun objet (masqué des éditeurs de liens, refusé par `validateLinkEntries` côté main /
serveur MCP). C'est l'état d'un type de lien dont le dernier type source ou cible a été supprimé
(GH104, §9). Une liste absente reste non contrainte pour le main.

**Sens d'un lien de couverture** : le calcul de couverture (`matchCoverageLink`, voir
[SPEC-TRACEABILITY.md](SPEC-TRACEABILITY.md) §2.2) apparie le lien à sa paire
test/exigence quel que soit le côté — `sourceId`/`targetId` — sur lequel se trouve
chacun. Une contrainte antérieure imposait le test en `sourceId` ; retirée volontairement
pour ne pas exposer cette convention technique à l'utilisateur, qui peut créer le lien
depuis l'éditeur du test ou celui de l'exigence indifféremment.

La même définition du lien de couverture détermine les **exigences liées** d'un test pour les
références `{req.<champ>}` (T179, SPEC-TESTS §2.4a) : une instance de campagne par exigence liée.

### 5.2 Structure d'un lien (`ObjectLink`)

| Attribut | Type | Description |
|----------|------|-------------|
| `id` | string | Identifiant unique du lien |
| `type` | string | Nom du `LinkTypeDefinition` dans `schema.yaml` |
| `sourceId` | string | ID de l'objet source |
| `targetId` | string | ID de l'objet cible |
| `targetCommitHash` | string? | Hash Git de la version cible au moment de la création du lien (non utilisé pour la revalidation) |
| `needsRevalidation` | bool? | **Déprécié (T172)** — ni lu ni écrit ; l'impact est porté par les éléments (§5.3). Toléré dans les `links.yaml` existants |
| `coverageType` | enum? | `full` \| `partial` (pour les liens de couverture test) |
| `createdAt` | datetime | Date de création |
| `createdBy` | user | Auteur |

### 5.2a Liens entre repos du workspace (GH105)

Un lien peut relier deux objets de **repos différents** du workspace (repo racine et composants
en repo séparé, `polenta-repo.yaml`) dès que le composant est ajouté, y compris pour des objets non
commités.

- **Stockage unique, côté source** : le lien est écrit dans `links/links.yaml` du repo de l'objet
  côté `sourceRefs` de son type (si le sens fourni n'est accepté qu'à l'envers, il est conservé et
  le lien reste stocké chez l'objet côté `sourceRefs`). Jamais recopié dans le repo de la cible.
  Repo de stockage en lecture seule (composant épinglé sur un tag / SHA, monté sous un nœud
  `readonly`) ou objet source dans un nœud `readonly` → refus `READONLY_REPO`.
- **Affichage des deux côtés** : un objet affiche tous les liens dont il est la source ou la
  cible, stockés dans n'importe quel repo du workspace (vues Édition, Excel, Word, volet de la
  recherche, couverture). Suppression possible depuis les deux objets, écrite dans le repo qui
  stocke le lien ; désactivée (infobulle) si ce repo est en lecture seule. Un composant ouvert
  seul, sans le produit, ne voit pas les liens stockés dans le produit.
- **Types de lien** : union par nom des `linkTypes` des schémas du workspace (repo racine
  prioritaire) — un composant sans `linkTypes` affiche les liens d'un type défini par le produit.
- **Résolution des refs** : chaque repo a un nœud `root` ; une ref `<nœud>::<type>` d'un type de
  lien vise les objets du repo qui définit le type de lien s'il déclare lui-même ce type, sinon
  ceux des repos qui le déclarent (`link-validation.util.ts::matchesRefs`, dupliquée dans
  `linkUtils.ts::filterCandidatesByRefs`).
- **Candidats** : exigences et tests de tous les repos, avec le libellé de leur repo ; les objets
  d'un repo en lecture seule ne sont proposés qu'en cible. Pair introuvable dans le workspace :
  pastille « introuvable ». Doublon (même type, même paire, quel que soit le sens) refusé sur tout
  le workspace (`DUPLICATE_LINK`).
- **Navigation** : clic sur un objet lié d'un autre repo → la Vue Système bascule sur son repo,
  « ← Retour » revient au repo de départ (`SPEC-SYSTEM-VIEW.md`).

Implémentation : `WorkspaceLinksService` (main), channels `links:objects` / `links:list` /
`links:types`, `requirements:link-create` / `link-delete` avec `workspaceDir` ;
`useWorkspaceLinks` + `LinkTypeEditor` (renderer).

### 5.3 Revalidation (T172)

Le flag `needsRevalidation` est porté par les **éléments** (exigences, cas de test), pas par
les liens : les liens servent à trouver les éléments impactés et ne sont jamais modifiés.

**Déclencheur** — un élément X **quitte un statut d'approbation** (`isApproval`) vers un statut
qui ne l'est pas : « Rouvrir en brouillon » ou changement de statut direct (colonne Statut de
la vue Excel). Un élément approuvé étant verrouillé, c'est le seul chemin par lequel son contenu
peut changer. L'édition d'un élément non approuvé, la réapprobation et les transitions entre
statuts non approuvés ne déclenchent rien. T171 réutilise le même point d'entrée
(`RevalidationService.markImpactedBy`) pour la modification d'un paramètre.

**Éléments marqués** — l'élément à l'autre bout de **chaque** lien touchant X, quel que soit
le sens et le type du lien, dans tous les repos du workspace (même agrégation que la matrice) ;
le flag est écrit dans le YAML de l'élément, dans son propre repo. Un seul niveau (pas de
cascade). Non marqués : X lui-même, les éléments en statut terminal (`isTerminal`), ceux d'un
nœud `readonly` (nœud local du repo ouvert, ou repo composant monté sous un nœud submodule
`readonly`), les liens orphelins. Le statut, la version et le verrouillage des éléments marqués
ne changent pas (un élément `approved` peut être marqué).

**Notification** — icône ⚠ à côté du statut (vues Excel, Word, Édition), infobulle « Impact à
vérifier ». Pas d'action « Revalider » par lien : le flag est levé depuis la vue Analyse
d'impact (**T173**, SPEC-TRACEABILITY §4.8) — sur les nœuds des arbres d'analyse ou dans la liste
« Impact à vérifier » ; la clé est retirée du YAML (statut, version et liens inchangés), sans commit
ni trace hors git.

**Second déclencheur — paramètre modifié (T171)** : modifier `value`/`unit` d'un paramètre (ou
créer un paramètre résolvant des références jusque-là littérales) utilisé par un élément
approuvé non terminal appelle `markImpactedBy(…, { includeSelf: true })` pour chacun de ces
éléments : l'élément **lui-même** est marqué (son texte affiché a changé sans relecture), ainsi
que ses éléments liés, avec les mêmes exclusions. Le statut ne change pas. Un changement de
`description` seule, ou des valeurs arrivées par git (branche, pull, merge), ne marque rien.

---

## 6. Identifiants des exigences

### 6.1 Format

```
<PREFIX>-<NUMERO>
Exemples : SYS-0001, SW-0005, BMS-0012
```

- Le **préfixe** est défini dans `ObjectTypeDefinition.prefix`.
- Le **numéro** est calculé **par préfixe** à partir du disque (GH20) : plus haut numéro
  existant ou marqué d'une pierre tombale, + 1 — cf. `SPEC-TECH-stack.md` §4.4. La séquence
  peut présenter des trous — c'est attendu et acceptable.
- L'identifiant est attribué à la **création** et n'est **jamais modifié ni réutilisé**.

**Exposition MCP (T122)** : `bulk_import_requirements` (`dryRun: true`) prévisualise
les IDs qui seraient attribués sans les consommer (`peekNextCounterId`, lecture seule
du disque — cf. `SPEC-TECH-stack.md` §4.4) ; `dryRun: false` attribue
les IDs réels en série via le même mécanisme sérialisé que l'UI (T118), garantissant
l'absence de collision même pour des créations rapprochées au sein d'un même batch.

---

## 7. Liens Jira

Un lien Jira peut être ajouté à n'importe quel moment — il est optionnel.

**Structure d'un lien Jira (`JiraLink`) :**

| Attribut | Type | Description |
|----------|------|-------------|
| `jiraIssueKey` | string | Clé du ticket (ex. `PROJ-1234`) |
| `jiraSummary` | string | Résumé du ticket (mis en cache au moment du lien) |
| `jiraStatus` | string | Statut Jira (mis en cache, rafraîchissable) |
| `jiraUrl` | string | URL directe vers le ticket |
| `linkType` | enum | `IMPLEMENTS` / `RELATED_TO` / `ORIGINATED_FROM` / `BLOCKS` |
| `linkedAt` | datetime | Date de création du lien |
| `linkedBy` | user | Auteur du lien |

---

## 8. Recherche et filtrage

- Recherche plein texte sur tous les champs `text` et `richtext`.
- Filtres combinables : type, statut, auteur, date, champ personnalisé, `needsRevalidation`.
- Sauvegarde de filtres nommés (vues permanentes par utilisateur).
- Export des résultats filtrés en CSV / Excel.

---

## 9. Suppression d'une exigence

- **Pas de suppression physique d'une exigence individuelle** : elle est désactivée en la passant dans un statut `isTerminal: true` (ex. `obsolete`).
- L'objet reste lisible dans l'historique et dans les liens entrants (marqués "cible obsolète").
- **Exception — suppression du composant local ou du type qui la porte** (GH104, onglet
  Structure) : après une confirmation qui affiche les comptes (objets par catégorie, liens par
  repo, types de lien modifiés ou rendus invalides), les exigences, tests (avec `test-runs/<ID>/`)
  et campagnes du type sont supprimés physiquement, chacun avec sa pierre tombale ; avec eux, les
  `impact-acks/<ID>/` des exigences, les `ObjectLink` qui les citent dans le `links/links.yaml`
  de **chaque repo du workspace**, les arbres `.polenta/trees/<nœud>/<type>.yaml` et les refs
  `<nœud>::<type>` des `linkTypes` (dans les autres repos, sauf s'ils déclarent eux-mêmes un type
  de même ref — collision `root::`, GH100). Un type de lien dont une liste devient vide est
  conservé, invalide (masqué des éditeurs, refusé par la validation du main — §5.1). Restent :
  analyses d'impact, revues, références textuelles `[[ID]]`, scripts du Suivi. Si un objet ne peut
  être supprimé, la suppression s'arrête avant les arbres et le schéma : le composant / type reste
  visible et la relancer termine. Rien n'est commité.
- Son identifiant n'est **jamais réutilisé** : une exigence supprimée par l'application (cas
  ci-dessus) laisse sa pierre tombale ; un fichier supprimé hors application (explorateur,
  `git rm`) n'en laisse pas (GH20).
