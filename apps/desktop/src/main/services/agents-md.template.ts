/**
 * Version courante du gabarit `AGENTS.md` (T122 sprint 4, point 7 du spec — absorbe
 * T121). Le fichier généré embarque ce numéro en tête (marqueur
 * `<!-- polenta:agents-md-version:N -->`) : à l'ouverture d'un projet,
 * `WorkspaceService.ensureAgentFiles()` compare ce marqueur à cette constante — un
 * marqueur absent (fichier écrit avant T122, ou par un humain) ou antérieur déclenche
 * une régénération complète ; un marqueur égal ne réécrit RIEN (pas de comparaison
 * byte à byte du contenu, pour ne pas écraser des notes ajoutées par l'utilisateur en
 * bas du fichier tant que le gabarit n'a pas changé — cf. specs/T122.md point 7).
 * À incrémenter à chaque changement de contenu de `AGENTS_MD_TEMPLATE` qui doit se
 * propager aux projets déjà créés.
 */
export const AGENTS_MD_TEMPLATE_VERSION = 2

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
export const AGENTS_MD_TEMPLATE = `<!-- polenta:agents-md-version:${AGENTS_MD_TEMPLATE_VERSION} -->
# AGENTS.md — Repère pour un agent IA sur ce projet Polenta

Ce projet est géré avec [Polenta](https://polenta.dev) : un système de gestion des
exigences et des tests **fichiers d'abord** (pas de base de données) — tout est
versionné dans ce dépôt git, l'application Polenta n'est qu'un viewer/éditeur par-dessus.
Ce fichier donne à n'importe quelle IA (Claude Code, Cursor, Codex, Copilot, Gemini CLI…)
les clés pour respecter l'organisation du dépôt sans avoir accès au code de Polenta.

## Format d'un objet (exigence, test, campagne)

Chaque objet est un fichier \`.md\` avec un frontmatter YAML :

\`\`\`markdown
---
id: SYS-001                     # préfixe défini par le schéma, unique, jamais réutilisé
objectTypeRef: root::exigence   # <nœud>::<type d'objet>, voir .polenta/schema.yaml
status: draft                   # une valeur des statuts définis pour ce type
fields:
  ...                            # champs custom définis par le type dans le schéma
---

Corps libre en Markdown (notes, contraintes, alternatives…).
\`\`\`

- **Champs système fixes** (non configurables) : \`id\`, \`objectTypeRef\`, \`status\`.
- **Champs métier** : tout ce qui est sous \`fields:\`, propre à chaque projet — leur
  liste, type et obligation (\`required\`) sont définis dans le schéma, pas ici.
- **Les liens entre objets** (dérivation, vérification…) ne sont pas dans le
  frontmatter : ce sont des ObjectLinks gérés par Polenta séparément, dans
  \`links/links.yaml\` (à créer/supprimer via les tools MCP \`create_links\`/\`delete_links\`).

## Où trouver les règles propres à CE projet : \`.polenta/schema.yaml\`

Ce fichier est la **source de vérité** du modèle de données du projet — à lire avant
toute création ou modification d'objet :

- \`nodes[].objectTypes[]\` : les types d'objets disponibles (préfixe d'ID, catégorie
  \`requirement\`/\`test\`/\`campaign\`, champs custom, statuts).
- \`objectTypes[].fields[].validator\` : si un champ a \`validator: EARS\`, son énoncé doit
  suivre la syntaxe EARS (WHEN/THE/SHALL…) — ne pas l'imposer si le validateur est
  absent, c'est une convention par projet, pas une règle Polenta globale.
- \`objectTypes[].statuses[]\` : les statuts valides pour ce type, avec \`isApproval\`
  (marque l'objet comme validé) et \`isTerminal\` (masqué des listes par défaut).
- \`linkTypes[]\` : les types de liens autorisés entre objets (\`sourceRefs\`/\`targetRefs\`).

Ne jamais assumer un statut, un champ ou un type qui ne serait pas dans ce fichier —
le modèle est entièrement configurable par projet.

## Serveur MCP — interface programmatique préférée si votre client la supporte

Si votre client (Claude Code, Cursor, ou tout autre client MCP) détecte le fichier
\`.mcp.json\` à la racine de ce projet, un serveur MCP Polenta est disponible : **c'est le
mécanisme préféré** pour créer/importer des objets ou modifier le modèle de données —
il applique automatiquement la génération d'ID (sans collision), la résolution
d'\`objectTypeRef\`, la validation des champs requis et le format des fichiers, au lieu
de réimplémenter cette logique en lisant/écrivant les YAML à la main.

Tools disponibles :

- \`get_schema\` — lit le \`.polenta/schema.yaml\` résolu (nœuds, types, champs, statuts, liens).
- \`list_requirements\` / \`list_tests\` / \`list_campaigns\` — explore l'existant (filtres
  par type/statut/texte) pour éviter les doublons avant un import.
- \`bulk_import_requirements\` / \`bulk_import_tests\` / \`bulk_import_campaigns\` — import
  massif avec \`dryRun\` obligatoire par défaut (aperçu des IDs prévisionnels et des
  erreurs, sans rien écrire) ; \`dryRun: false\` écrit réellement, en série, best-effort.
- \`list_links\` / \`create_links\` / \`delete_links\` — liens entre objets (vérification,
  implémentation…). \`create_links\`/\`delete_links\` ont \`dryRun\` par défaut ; \`create_links\`
  vérifie le type (\`linkTypes\` de \`get_schema\`), l'existence des objets, la compatibilité
  \`sourceRefs\`/\`targetRefs\` et l'absence de doublon.
- \`add_component\` / \`add_object_type\` / \`add_field\` / \`add_status\` / \`add_link_type\` —
  modification ciblée du modèle de données (\`.polenta/schema.yaml\`), avec vérification
  des invariants (nom déjà pris, \`prefix\` unique sur tout le projet, nœud
  \`readonly: true\`) avant toute écriture.

Comme le reste de Polenta, le serveur MCP n'effectue **jamais de commit/push
automatique** — les fichiers créés/modifiés restent en attente, l'utilisateur les
committe/publie explicitement ensuite depuis l'app.

**Si votre client ne supporte pas MCP** (ou si \`.mcp.json\` est absent) : la lecture/
écriture directe des fichiers YAML documentée ci-dessus reste le repli — appliquez
alors vous-même les règles de ce fichier (format, ID jamais réutilisé, \`prefix\` unique,
etc.).

## Invariants à respecter

- \`tree.yaml\` (et \`.polenta/tree.cache.yaml\`) sont **générés** — ne jamais les éditer
  à la main.
- Un ID n'est **jamais réutilisé**, même si l'objet passe en statut terminal/obsolète.
- Une exigence ou un test marqué \`needsRevalidation: true\` signale un impact à vérifier
  (un élément lié a quitté l'approbation) — ne pas lever ce flag sans analyse d'impact.
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
Les dashboards de Polenta reposent sur un moteur de requête **SQL en lecture seule**
exécuté sur trois tables reconstruites en mémoire depuis les fichiers : \`requirements\`,
\`tests\`, \`links\` — une ligne par objet, les champs de \`fields{}\` sont directement
accessibles comme colonnes. Une colonne dérivée \`coverageStatus\` existe déjà sur
\`requirements\` (voir §4). Écrire une requête SQL standard sur ces tables pour
construire un indicateur ou un widget de dashboard.

### 4. Vérification des liens (traçabilité)
La couverture d'une exigence se calcule depuis ses liens vers des tests approuvés et
les résultats de leurs exécutions :

| Statut | Condition |
|---|---|
| \`not_covered\` | aucun test approuvé lié |
| \`covered\` | test(s) approuvé(s) lié(s), mais aucune exécution PASS |
| \`validated\` | au moins une exécution PASS sur un test lié |
| \`failing\` | dernière exécution = FAIL ou BLOCKED |
| \`needs_revalidation\` | un lien est marqué comme nécessitant une revalidation |

Priorité en cas de plusieurs statuts applicables : \`needs_revalidation\` > \`failing\`
> \`covered\` > \`validated\` > \`not_covered\`.

## Aucune dépendance à un outil IA particulier

Ce fichier ne contient aucune instruction propre à un agent donné — l'utilisateur de
ce projet peut travailler avec l'IA de son choix (Claude Code, Cursor, Codex,
Copilot, Gemini CLI, ou tout autre outil qui lit \`AGENTS.md\`).
`
