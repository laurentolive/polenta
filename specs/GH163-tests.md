# GH163 — Scénarios de test

Automatique : `main/services/history-comment.gh163.test.ts`.

1. Exigence `approved` → `draft` avec commentaire (`transition`) : `history.status` (dernière entrée) porte `comment`.
2. MCP, commentaire sans changement suivi : pas d'erreur, `warning` sur l'entrée.
3. MCP, statut + champ suivi avec `modificationComment` : commentaire sur les deux entrées, `source: mcp`.
4. `openDraft` et `TestsService.update({ status, modificationComment })` : commentaire conservé.
5. Sans commentaire (ou blanc) : aucune clé `comment` écrite.

Manuel : formulaire d'une exigence, saisir un commentaire puis changer le statut ; la section
Historique affiche « « commentaire » » sur la nouvelle ligne ; le champ est vidé.
