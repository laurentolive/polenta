import type { BrandInfo } from '../../shared/brand-types'

/**
 * Version courante du gabarit `AGENTS.md` (T122 sprint 4, point 7 du spec — absorbe
 * T121). Le fichier généré embarque ce numéro en tête (marqueur
 * `<!-- polenta:agents-md-version:N -->`) : à l'ouverture d'un projet,
 * `WorkspaceService.ensureAgentFiles()` compare ce marqueur à cette constante — un
 * marqueur absent (fichier écrit avant T122, ou par un humain) ou antérieur déclenche
 * une régénération complète ; un marqueur égal ne réécrit RIEN (pas de comparaison
 * byte à byte du contenu, pour ne pas écraser des notes ajoutées par l'utilisateur en
 * bas du fichier tant que le gabarit n'a pas changé — cf. specs/T122.md point 7).
 * À incrémenter à chaque changement de contenu de `buildAgentsMdTemplate` qui doit se
 * propager aux projets déjà créés.
 *
 * GH49 : le nom du produit vient de la marque du binaire (`productName`, lien `website`) ; les
 * noms de fichiers de format (`.polenta/`, `polenta-repo.yaml`) restent tels quels. Version NON
 * incrémentée : pour la marque polenta le texte est identique à la v3, une régénération réécrirait
 * AGENTS.md dans tous les projets existants pour rien. Le marqueur ne compare pas le nom : un
 * projet garde le nom de la marque qui l'a écrit, quelle que soit la marque qui l'ouvre ensuite.
 *
 * GH60 (v5) : format d'objet YAML pur (et non plus `.md` + frontmatter), champs système complets,
 * exemples d'exigence et de test, `.polenta/trees/` et pierres tombales.
 */
export const AGENTS_MD_TEMPLATE_VERSION = 5

const AGENTS_MD_VERSION_MARKER_RE = /<!--\s*polenta:agents-md-version:(\d+)\s*-->/

/**
 * Extrait le numéro de version du marqueur embarqué dans un `AGENTS.md` existant, ou
 * `undefined` si absent/illisible (fichier pré-T122, ou modifié à la main sans le
 * marqueur). Utilisé par `WorkspaceService.ensureAgentFiles()` pour décider si une
 * régénération est nécessaire.
 */
export function extractAgentsMdVersion(content: string): number | undefined {
  const match = AGENTS_MD_VERSION_MARKER_RE.exec(content)
  if (!match) return undefined
  const version = Number(match[1])
  return Number.isFinite(version) ? version : undefined
}

/**
 * Content written as `AGENTS.md` at the root of every new project (T106), and
 * regenerated at the root of any existing project whose marker is absent or stale
 * (T122 sprint 4). Generic and domain-agnostic — describes Polenta's own file format
 * and mechanisms, not business conventions (those live in `.polenta/schema.yaml`
 * and are read by the agent from there). Any AI agent (Claude Code, Cursor,
 * Codex, Copilot, Gemini CLI…) can use this file — it contains no
 * tool-specific instructions.
 */
export function buildAgentsMdTemplate(brand: Pick<BrandInfo, 'productName' | 'website'>): string {
  const name = brand.productName
  const productLink = brand.website ? `[${name}](${brand.website})` : name
  return `<!-- polenta:agents-md-version:${AGENTS_MD_TEMPLATE_VERSION} -->
# AGENTS.md — Repère pour un agent IA sur ce projet ${name}

Ce projet est géré avec ${productLink} : un système de gestion des
exigences et des tests **fichiers d'abord** (pas de base de données) — tout est
versionné dans ce dépôt git, l'application ${name} n'est qu'un viewer/éditeur par-dessus.
Ce fichier donne à n'importe quelle IA (Claude Code, Cursor, Codex, Copilot, Gemini CLI…)
les clés pour respecter l'organisation du dépôt sans avoir accès au code de ${name}.

## Format d'un objet (exigence, test, campagne)

Chaque objet est un fichier **YAML pur**, nommé d'après son ID — pas de frontmatter
(pas de délimiteurs \`---\`), pas de corps Markdown libre : le texte long (énoncé,
justification, critères d'acceptance…) vit dans des champs de \`fields:\`, typiquement de
type \`richtext\` (contenu en Markdown).

| Objet | Fichier |
|---|---|
| Exigence | \`requirements/<ID>.yaml\` |
| Cas de test | \`tests/<ID>.yaml\` |
| Campagne de test | \`campaigns/<ID>.yaml\` |
| Exécution d'un test | \`test-runs/<ID du test>/<ID du run>.yaml\` |
| Liens entre objets | \`links/links.yaml\` (un seul fichier pour tout le projet) |

Exemple d'exigence (\`requirements/SYS-0001.yaml\`) :

\`\`\`yaml
id: SYS-0001                    # <prefix>-NNNN, préfixe défini par le type dans le schéma
projectId: ''
branchId: ''
objectTypeRef: root::exigence   # <nœud>::<type d'objet>, voir .polenta/schema.yaml
title: Démarrage rapide
status: draft                   # une valeur des statuts définis pour ce type
version: 1
fields:                         # champs définis par le type dans le schéma
  priority: high
  statement: |
    WHEN the user presses the power button
    THE system SHALL start within 500 ms
  acceptanceCriteria: |
    - [ ] Démarrage mesuré < 500 ms
jiraLinks: []
\`\`\`

Exemple de cas de test (\`tests/TEST-0001.yaml\`) — mêmes champs système, plus des
champs de structure fixes (\`preconditions\`, \`equipment\`, \`steps\`, \`postconditions\`) :

\`\`\`yaml
id: TEST-0001
projectId: ''
branchId: ''
objectTypeRef: root::test
title: Mesure du temps de démarrage
status: draft
version: 1
preconditions: Batterie chargée à plus de 20 %
equipment:
  - id: EQ-1
    role: chronomètre
    description: Mesure du temps entre l'appui et la mise en route
    required: true
    quantity: 1
steps:
  - order: 1
    action: Appuyer sur le bouton marche
    expectedResult: Le moteur démarre en moins de 500 ms
    notes: null
postconditions: ''
fields: {}
\`\`\`

- **Champs système fixes** (non configurables) : \`id\`, \`projectId\`, \`branchId\`,
  \`objectTypeRef\`, \`title\`, \`status\`, \`version\`, \`jiraLinks\` (exigences) ; pour un test,
  \`preconditions\`, \`equipment\`, \`steps\` (\`{ order, action, expectedResult, notes }\`),
  \`postconditions\`. Posés par ${name} uniquement, jamais à la main : \`needsRevalidation\`
  (écrit seulement quand vrai) et \`history\` (absent tant que vide) — voir « Invariants ».
- **Champs métier** : tout ce qui est sous \`fields:\`, propre à chaque projet — leur
  liste, type et obligation (\`required\`) sont définis dans le schéma, pas ici.
- **Non stockés** : \`createdAt\`, \`createdBy\`, \`updatedAt\`, \`updatedBy\` d'une exigence ou
  d'un test sont lus depuis l'historique git du fichier — ne pas les écrire dans le YAML.
- **Campagnes et exécutions** : leur structure (instances de test avec copie figée du test,
  résultats…) est gérée par ${name} — les créer via l'application ou les tools MCP
  (\`bulk_import_campaigns\`), pas à la main.
- **Les liens entre objets** (dérivation, vérification…) ne sont pas dans le fichier de
  l'objet : ce sont des ObjectLinks gérés par ${name} séparément, dans
  \`links/links.yaml\` (à créer/supprimer via les tools MCP \`create_links\`/\`delete_links\`).

## Où trouver les règles propres à CE projet : \`.polenta/schema.yaml\`

Ce fichier est la **source de vérité** du modèle de données du projet — à lire avant
toute création ou modification d'objet :

- \`nodes[].objectTypes[]\` : les types d'objets disponibles (préfixe d'ID, catégorie
  \`requirement\`/\`test\`/\`campaign\`, champs custom, statuts).
- \`objectTypes[].fields[].validator\` : si un champ a \`validator: EARS\`, son énoncé doit
  suivre la syntaxe EARS (WHEN/THE/SHALL…) — ne pas l'imposer si le validateur est
  absent, c'est une convention par projet, pas une règle ${name} globale.
- \`objectTypes[].statuses[]\` : les statuts valides pour ce type, avec \`isApproval\`
  (marque l'objet comme validé) et \`isTerminal\` (masqué des listes par défaut).
- \`linkTypes[]\` : les types de liens autorisés entre objets (\`sourceRefs\`/\`targetRefs\`).

Ne jamais assumer un statut, un champ ou un type qui ne serait pas dans ce fichier —
le modèle est entièrement configurable par projet.

## Serveur MCP — interface programmatique préférée si votre client la supporte

Si votre client (Claude Code, Cursor, ou tout autre client MCP) détecte le fichier
\`.mcp.json\` à la racine de ce projet, un serveur MCP ${name} est disponible : **c'est le
mécanisme préféré** pour créer/importer des objets ou modifier le modèle de données —
il applique automatiquement la génération d'ID (sans collision), la résolution
d'\`objectTypeRef\`, la validation des champs requis et le format des fichiers, au lieu
de réimplémenter cette logique en lisant/écrivant les YAML à la main.

Tools disponibles :

- \`get_schema\` — lit le \`.polenta/schema.yaml\` résolu (nœuds, types, champs, statuts, liens).
- \`list_requirements\` / \`list_tests\` / \`list_campaigns\` — explore l'existant (filtres
  par type/statut/texte) pour éviter les doublons avant un import.
- \`get_history\` — historique des champs suivis d'un objet (statut par défaut), avec les
  entrées déduites (\`implicit: true\`) quand la valeur courante diffère de la dernière entrée.
- \`bulk_import_requirements\` / \`bulk_import_tests\` / \`bulk_import_campaigns\` — import
  massif avec \`dryRun\` obligatoire par défaut (aperçu des IDs prévisionnels et des
  erreurs, sans rien écrire) ; \`dryRun: false\` écrit réellement, en série, best-effort.
- \`list_links\` / \`create_links\` / \`delete_links\` — liens entre objets (vérification,
  implémentation…). \`create_links\`/\`delete_links\` ont \`dryRun\` par défaut ; \`create_links\`
  vérifie le type (\`linkTypes\` de \`get_schema\`), l'existence des objets, la compatibilité
  \`sourceRefs\`/\`targetRefs\` et l'absence de doublon.
- \`get_data_contract\` / \`list_templates\` / \`test_script\` — vue Suivi : une requête est un
  **script de données** JS (\`export default (data, polenta) => rows\`) sur le graphe du projet.
  \`get_data_contract\` donne les types du graphe et les conventions (\`_ids\`, agrégation en JS,
  drill-down, jetons de couleur) ; \`list_templates\` les modèles (requête, widget) et leurs
  paramètres ; \`test_script\` exécute un script (et une transformation) sur les données réelles,
  sans rien enregistrer — itérer avec lui avant de créer une requête.
- \`list_queries\` / \`run_query\` / \`create_query\` / \`update_query\` / \`delete_query\` —
  requêtes : \`script\` écrit à la main, ou \`template: { id, params }\` (code généré). \`run_query\`
  retourne colonnes + lignes : à appeler avant de créer un widget pour connaître les colonnes.
  Une requête SQL d'avant GH74 est en lecture seule (à réécrire en script).
- \`list_dashboards\` / \`create_dashboard\` / \`update_dashboard\` / \`delete_dashboard\` /
  \`add_widget\` / \`update_widget\` / \`delete_widget\` / \`reorder_widgets\` — dashboards. Un widget
  référence une requête sauvegardée et porte soit \`template: { id, params }\` (paramètres = colonnes
  du résultat), soit \`transform\` (JS facultatif, \`(rows, polenta) => rows\`) + \`spec\` Vega-Lite
  (\`"data": { "name": "rows" }\`, pas d'\`aggregate\`). Toutes les écritures ont \`dryRun\` par
  défaut. Les objets **privés** ne sont accessibles que si le serveur est lancé avec
  \`--user <login>\` (ou \`POLENTA_USER\`) ; sinon seul le scope partagé est visible et modifiable.
- \`list_library\` / \`read_library_module\` / \`write_library_module\` — bibliothèque JS du projet
  (\`dashboards/lib/\`), importable par les scripts (\`import { … } from 'lib/campaign.js'\`).
  \`write_library_module\` a \`dryRun\` par défaut.
- \`add_component\` / \`add_object_type\` / \`add_field\` / \`add_status\` / \`add_link_type\` —
  modification ciblée du modèle de données (\`.polenta/schema.yaml\`), avec vérification
  des invariants (nom déjà pris, \`prefix\` unique sur tout le projet, nœud
  \`readonly: true\`) avant toute écriture.

Comme le reste de ${name}, le serveur MCP n'effectue **jamais de commit/push
automatique** — les fichiers créés/modifiés restent en attente, l'utilisateur les
committe/publie explicitement ensuite depuis l'app.

**Si votre client ne supporte pas MCP** (ou si \`.mcp.json\` est absent) : la lecture/
écriture directe des fichiers YAML documentée ci-dessus reste le repli — appliquez
alors vous-même les règles de ce fichier (format, ID jamais réutilisé, \`prefix\` unique,
etc.).

## Invariants à respecter

- \`.polenta/trees/<nœud>/<type>.yaml\` (ordre d'affichage des objets) est **maintenu par
  ${name}** — ne jamais l'éditer à la main.
- Un ID n'est **jamais réutilisé**, même si l'objet passe en statut terminal/obsolète. Il
  n'y a pas de compteur : le prochain numéro d'un préfixe est le plus grand numéro trouvé
  dans les fichiers **et** dans \`.polenta/tombstones/\` (un fichier vide par ID supprimé),
  plus un. Ne jamais supprimer une pierre tombale, ni supprimer à la main le fichier d'un
  objet (${name} pose la pierre tombale à la suppression).
- Une exigence ou un test marqué \`needsRevalidation: true\` signale un impact à vérifier
  (un élément lié a quitté l'approbation) — ne pas lever ce flag sans analyse d'impact. Il
  se lève depuis la vue Analyse d'impact (bouton « Lever le flag »), jamais à la main dans le YAML.
- Le champ \`history\` d'un objet (exigence, test, campagne) est l'historique daté des champs
  suivis — le statut par défaut (\`trackStatusHistory\` du type), et les champs
  \`trackHistory: true\` du schéma : une liste par champ, entrées \`{ value, at, by, source }\`.
  Il est alimenté par ${name} à chaque écriture : **ne jamais l'écrire ni le corriger à la main**.
  Modifier la valeur d'un champ suivi hors de l'application crée un écart, comblé à la prochaine
  écriture par l'application (entrée datée du dernier commit).
- Le \`prefix\` de chaque type d'objet est unique sur l'ensemble du projet.

## System engineering assisté par IA — les 4 usages visés

### 1. Review d'exigence
Vérifier : statut cohérent avec l'avancement réel, énoncé conforme au \`validator\` du
champ (si défini), au moins un critère d'acceptance mesurable, cohérence avec les
exigences liées (pas de contradiction), lien vers au moins un test si le statut a
\`isApproval: true\`.

### 2. Review de test
Vérifier : le test couvre bien l'exigence qu'il référence, les étapes/critères de
passage sont mesurables, le résultat de la dernière exécution (\`TestRun\`) est à jour.

### 3. Construction d'indicateurs (requêtes / dashboards)
Les dashboards de ${name} reposent sur un moteur de requête **SQL en lecture seule**
exécuté sur trois tables reconstruites en mémoire depuis les fichiers : \`requirements\`,
\`tests\`, \`links\` — une ligne par objet, les champs de \`fields{}\` sont directement
accessibles comme colonnes. Une colonne dérivée \`coverageStatus\` existe déjà sur
\`requirements\` (voir §4). Écrire une requête SQL standard sur ces tables pour
construire un indicateur, puis l'enregistrer et l'afficher via les tools MCP
(\`create_query\` puis \`add_widget\`) si votre client les supporte.

### 4. Vérification des liens (traçabilité)
La couverture d'une exigence se calcule depuis ses liens vers des tests approuvés et
les résultats de leurs exécutions :

| Statut | Condition |
|---|---|
| \`not_covered\` | aucun test approuvé lié |
| \`covered\` | test(s) approuvé(s) lié(s), mais aucune exécution PASS |
| \`validated\` | au moins une exécution PASS sur un test lié |
| \`failing\` | dernière exécution = FAIL ou BLOCKED |
| \`needs_revalidation\` | l'exigence ou un test lié porte \`needsRevalidation: true\` |

Priorité en cas de plusieurs statuts applicables : \`needs_revalidation\` > \`failing\`
> \`covered\` > \`validated\` > \`not_covered\`.

## Aucune dépendance à un outil IA particulier

Ce fichier ne contient aucune instruction propre à un agent donné — l'utilisateur de
ce projet peut travailler avec l'IA de son choix (Claude Code, Cursor, Codex,
Copilot, Gemini CLI, ou tout autre outil qui lit \`AGENTS.md\`).
`
}
