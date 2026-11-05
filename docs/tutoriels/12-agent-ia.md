# 12. Travailler avec un agent IA

[English](../tutorials/12-ai-agent.md) | **Français**

Un projet Polenta est fait de fichiers texte dans des dépôts git : un agent IA de développement
(Claude Code, Cursor, Codex…) peut le lire directement. Polenta lui fournit en plus un mode
d'emploi et un **serveur MCP** qui applique les mêmes règles que l'application.

## Ce que Polenta prépare

À chaque ouverture d'un projet, Polenta écrit à la racine du dépôt produit :

| Fichier | Rôle |
|---|---|
| `AGENTS.md` | le guide de l'agent : organisation des fichiers, IDs, liens, règles à respecter |
| `.mcp.json` | la déclaration du serveur MCP de Polenta, qui pointe vers l'application installée (ignoré par git, propre à chaque poste) |

Un agent lancé dans le dossier `demo-ll800-produit` de la démo trouve les deux fichiers. Claude Code,
par exemple, propose d'activer le serveur `polenta` déclaré dans `.mcp.json` au premier
lancement.

## Ce que fait le serveur MCP

Le serveur passe par les mêmes services que l'interface : il attribue les IDs, résout les types,
vérifie les champs obligatoires, la syntaxe EARS et les types de liens autorisés.

| Outils | Usage |
|---|---|
| `get_schema` | le modèle de données : composants, types, champs, statuts, types de liens |
| `list_requirements`, `list_tests`, `list_campaigns`, `get_history` | lire les éléments et l'historique de leurs champs suivis |
| `bulk_import_requirements`, `bulk_import_tests`, `bulk_import_campaigns` | créer des éléments en masse |
| `update_requirements`, `update_tests` | modifier des éléments existants (aperçu avant / après, commentaire de modification) |
| `list_parameters`, `set_parameters`, `delete_parameter` | gérer la base de paramètres |
| `list_links`, `create_links`, `delete_links` | gérer la traçabilité |
| `add_component`, `add_object_type`, `add_field`, `add_status`, `add_link_type` | faire évoluer le modèle de données |
| `list_versions`, `get_version`, `get_version_backlog`, `get_version_impact`, `get_version_tests` | lire les versions, leur backlog, leur analyse d'impact et les tests à exécuter |
| `list_issues`, `get_issue`, `create_issue`, `update_issue` | lire et tenir les issues |
| `list_validations`, `get_validation`, `propose_validation_decision` | lire les validations et **proposer** une décision, qu'un humain confirme ou rejette |
| `run_query`, `create_query`, `add_widget`, `test_script`… | lire et construire les requêtes, dashboards et scripts du Suivi |

Deux garde-fous :

- les écritures se font **à blanc par défaut** (`dryRun`) : l'agent voit ce qui serait créé et les
  erreurs, et doit demander explicitement l'écriture réelle ;
- le serveur **ne publie jamais** : ce que l'agent écrit apparaît dans les modifications en attente
  du panneau Version. Vous relisez dans Polenta, puis vous publiez.

Un agent ne signe pas non plus une validation : ses décisions restent *Proposée par …* jusqu'à ce
qu'un humain les **Confirme** ou les **Rejette** ([tutoriel 10](10-issues-validation.md)).

## Exemples sur la démo

Quelques demandes à faire à l'agent, dans le dossier `demo-ll800-produit` :

- « Liste les exigences approuvées qui ne sont vérifiées par aucun test. »
- « Réécris l'énoncé de PRD-0012 en EARS et propose un critère d'acceptance mesurable. »
- « Crée les exigences du module Wi-Fi à partir de ce cahier des charges, puis les liens vers les
  exigences système concernées. » (import à blanc, relecture, puis import réel)
- « Rédige un cas de test pour SYS-0008 avec ses étapes et lie-le à l'exigence. »
- « Ajoute au dashboard Pilotage un widget avec le nombre d'exigences par statut de couverture. »
- « Passe la valeur du paramètre `vitesse_essorage` à 1600 tr/min et montre-moi ce que ça change. »
- « Résume l'analyse d'impact de la version 2.0 (LLV-0002) et liste les tests à exécuter. »
- « Propose une décision pour SYS-0004 dans la validation VAL-0002. » (la décision reste *Proposée
  par …* jusqu'à sa confirmation dans Polenta)

Revenir ensuite dans Polenta : les nouveaux éléments sont dans les vues Exigences et Tests, les
fichiers dans **Version > Modifications**.

## Exercices

**Interroger les versions et les issues.**
1. Lancer un agent dans le dossier `demo-ll800-produit` et activer le serveur `polenta`.
2. Lui demander : « Liste les versions du projet avec leur statut, puis les exigences impactées par
   ISS-0003. »

Résultat : l'agent utilise `list_versions` et `get_issue`. Il cite LLV-0001 `1.0` (released),
LLV-0002 `2.0` (en cours), LLV-0003 `1.1` (abandonnée), les versions des composants, et PRD-0002
comme exigence impactée par ISS-0003.
