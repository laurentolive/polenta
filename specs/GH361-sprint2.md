# GH361 — Sprint 2 : verrou d'édition côté application

## Fichiers

| Fichier | Changement |
|---|---|
| `apps/desktop/src/main/services/tree-edit-locks.service.ts` | nouveau — baux (acquire / renew / release / purge), fichier de verrou long par arbre |
| `apps/desktop/src/main/container.ts`, `main/ipc/index.ts` | `treeEditLocks` ; canaux `tree:lock`, `tree:lock-renew`, `tree:unlock` |
| `packages/api-client/src/{types,ipc-client}.ts` | `api.tree.lock` / `renewLock` / `unlock` |
| `apps/desktop/src/web-server/channel-policy.ts` | canaux exposés au navigateur, `tree:lock` : repo en argument 0 |
| `apps/desktop/src/renderer/lib/treeEditLock.ts` | nouveau — tenue du bail (prise, renouvellement 10 s, reprise, libération) |
| `apps/desktop/src/renderer/hooks/useTreeEditLock.ts` | nouveau — hook React autour de `holdTreeEditLock` |
| `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` | `reloadTree` : relit l'arbre et remplace `root` |
| `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx` | verrou tenu pour exigences / tests / issues en édition, `reloadTree` à la prise |
| `apps/desktop/e2e-web/gh361-tree-lock.spec.ts` | nouveau — refus pendant l'affichage, écriture après changement d'onglet, rechargement au retour (y compris par Suivi) |
| `*.gh361.test.ts` (2 fichiers) | D1, D2, D3 |
| `specs/SPEC-MCP-SERVER.md`, `specs/SPEC-ELECTRON-DESKTOP.md`, `specs/SPEC-INDEX.md` | mises à jour SPEC |

## Comportement

- Barre latérale sur Exigences / Tests / Issues, type en édition : bail tenu (fichier
  `<gitdir>/polenta/locks/tree.<nœud>.<type>.app-<pid>.json`), écritures MCP refusées (`TREE_LOCKED`).
- Changement de type, d'onglet (Suivi, Version…), panneau Campagnes, démontage : bail rendu.
  Panneau replié : reste monté (GH123), le verrou reste tenu.
- À chaque prise : attente de la fin d'une écriture MCP, puis **rechargement de l'arbre affiché**.

## Divergences avec le design

- **Rechargement de l'arbre affiché** (`reloadTree`, non prévu au design §3.3, qui se contentait
  d'invalider la requête) : le contexte ne remplace `root` qu'au changement de nœud/type, et le
  cache de requête garde l'arbre d'avant ; sans rechargement explicite, l'app réaffichait l'arbre
  antérieur à l'écriture de l'agent puis l'aurait réécrit. Contre-épreuve faite : sans
  `reloadTree`, l'e2e échoue dès le premier scénario.
- **Pas de `releaseAll` à l'arrêt** (design §3.1) : un processus arrêté n'a pas besoin de libérer,
  son PID mort rend le verrou caduc côté MCP (et un renderer disparu cesse de renouveler).
- Logique du hook extraite dans `renderer/lib/treeEditLock.ts` : l'environnement de test est node,
  sans rendu React.

## Mises à jour SPEC

- `SPEC-MCP-SERVER.md` §3 (`TreeService` reconstruit), §4.2 (champ `folder`), §4.12 (nouvelle :
  rangement en dossiers et verrou), §7 (limitations du verrou).
- `SPEC-ELECTRON-DESKTOP.md` §22.4 (verrou d'édition, rechargement à la prise ; MCP et `TreeService`).
- `SPEC-INDEX.md` : colonnes `MAJ` → GH361 pour ces deux lignes.

## Comment tester à la main

1. Ouvrir le projet dans l'app desktop, onglet Exigences, un type sélectionné.
2. Dans un agent (Claude Code) branché sur le serveur MCP du projet : `create_folders` sur ce type
   avec `dryRun: false` → `TREE_LOCKED`, message demandant de changer de type ; `get_tree` →
   `locked` renseigné.
3. Passer sur Suivi (ou un autre type) ; relancer → dossier créé. Revenir sur Exigences → le dossier
   est affiché ; ranger un élément à la main → le dossier de l'agent reste.
4. Tuer l'app (gestionnaire des tâches) pendant qu'elle affiche le type → l'écriture de l'agent
   passe aussitôt.
5. `git status` : aucun fichier de verrou.
