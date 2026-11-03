# GH244 — Sprint 3 : proposition de création, SPEC

## Fichiers modifiés

- `components/issues/IssueProposalDialog.tsx` (nouveau) : créer, lier, ignorer.
- `routes/campaign.$campaignId_.execute.$testId.tsx` : popup après `FAIL` ou `BLOCKED`, retour à la campagne à la fermeture.
- `ExecutionImportModal.tsx` : bilan avec une proposition par échec.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-REQ-requirements.md` §11.3, §11.4, §12 (nouvelle) | issues |
| `SPEC-MCP-SERVER.md` §4.9 (nouvelle) | outils issues |
| `SPEC-DASHBOARDS.md` §2 | `GraphIssue`, manifeste v13 |
| `SPEC-ELECTRON-DESKTOP.md` §19.2 | panneau Issues |
| `SPEC-TEMPLATES.md` §1–4 | catégorie `issue` |
| `SPEC-TESTS.md` §4 | proposition après un échec |
| `specs/MILESTONE-D.md` §4 | livraison |
| `CLAUDE.md`, `SPEC-INDEX.md` | catégorie, dossier, MAJ `GH244` |

## Revue de code

Corrigé après revue : renommage de type et de préfixe (garde IPC, `ID_DATA_DIRS`), déplacement d'un type
vers un autre nœud, enregistrement depuis le diff par le service (statut contrôlé, `origin` refusé),
historique sur la fiche et `get_history`, rafraîchissement live et index MCP, graphe (historique effectif,
libellés, ouverture depuis la vue Suivi), brouillon de l'onglet Liens, popup sans double création.

## Comment tester manuellement

Voir `GH244-tests.md`, scénarios M1 à M10.
