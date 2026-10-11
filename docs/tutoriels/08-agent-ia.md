# 8. Travailler avec un agent IA

[English](../tutorials/08-ai-agent.md) | **Français**

Un projet Polenta est fait de fichiers texte dans des dépôts git : un agent IA de développement
(Claude Code, Cursor, Codex…) peut le lire directement. Polenta lui fournit en plus un mode
d'emploi et un **serveur MCP** qui applique les mêmes règles que l'application.

## Ce que Polenta prépare

À chaque ouverture d'un projet, Polenta écrit à la racine du dépôt produit :

| Fichier | Rôle |
|---|---|
| `AGENTS.md` | le guide de l'agent : organisation des fichiers, IDs, liens, règles à respecter |
| `.mcp.json` | la déclaration du serveur MCP de Polenta, qui pointe vers l'application installée (ignoré par git, propre à chaque poste) |

Un agent lancé dans le dossier `ll800-produit` de la démo trouve les deux fichiers. Claude Code,
par exemple, propose d'activer le serveur `polenta` déclaré dans `.mcp.json` au premier
lancement.

## Ce que fait le serveur MCP

Le serveur passe par les mêmes services que l'interface : il attribue les IDs, résout les types,
vérifie les champs obligatoires, la syntaxe EARS et les types de liens autorisés.

| Outils | Usage |
|---|---|
| `get_schema` | le modèle de données : composants, types, champs, statuts, types de liens |
| `list_requirements`, `list_tests`, `list_campaigns` | lire les éléments |
| `bulk_import_requirements`, `bulk_import_tests`, `bulk_import_campaigns` | créer des éléments en masse |
| `list_links`, `create_links`, `delete_links` | gérer la traçabilité |
| `add_component`, `add_object_type`, `add_field`, `add_status`, `add_link_type` | faire évoluer le modèle de données |
| `run_query`, `create_query`, `add_widget`… | lire et construire les requêtes et dashboards du Suivi |

Deux garde-fous :

- les écritures se font **à blanc par défaut** (`dryRun`) : l'agent voit ce qui serait créé et les
  erreurs, et doit demander explicitement l'écriture réelle ;
- le serveur **ne publie jamais** : ce que l'agent écrit apparaît dans les modifications en attente
  du panneau Version. Vous relisez dans Polenta, puis vous publiez.

## Exemples sur la démo

Quelques demandes à faire à l'agent, dans le dossier `ll800-produit` :

- « Liste les exigences approuvées qui ne sont vérifiées par aucun test. »
- « Réécris l'énoncé de PRD-0012 en EARS et propose un critère d'acceptance mesurable. »
- « Crée les exigences du module Wi-Fi à partir de ce cahier des charges, puis les liens vers les
  exigences système concernées. » (import à blanc, relecture, puis import réel)
- « Rédige un cas de test pour SYS-0008 avec ses étapes et lie-le à l'exigence. »
- « Ajoute au dashboard Pilotage un widget avec le nombre d'exigences par statut de couverture. »

Revenir ensuite dans Polenta : les nouveaux éléments sont dans les vues Exigences et Tests, les
fichiers dans **Version > Modifications**.
