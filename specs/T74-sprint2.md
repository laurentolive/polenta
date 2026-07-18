# T74-sprint2 — Renommage de mount avec cascade (dernier sprint)

## Fichiers modifiés

- `apps/desktop/src/main/services/workspace-tree.service.ts` — `renameClonedRepo()`.
- `apps/desktop/src/main/ipc/index.ts` — canal `workspace:rename-repo-dir`.
- `packages/api-client/src/ipc-client.ts`, `packages/api-client/src/types.ts` —
  `workspace.renameRepoDir()`.
- `apps/desktop/src/renderer/lib/workspaceActions.ts` — `renameDependency()`, `RenameError`.
- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` — le champ Nom (montage)
  est désormais éditable en mode édition (seule l'URL reste en lecture seule).
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` — `handleSubmitEditDependency`
  détecte un changement de nom et appelle `renameDependency()` avant la logique existante
  (branche/rôles), qui continue de s'appliquer sur le nom (éventuellement nouveau).

## Comportement implémenté

Renommer le mount d'un composant ou d'une interface depuis la modale d'édition :
1. Vérifie qu'aucun autre nœud du workspace n'utilise déjà le nouveau nom.
2. Renomme physiquement le répertoire (`fs.rename`) — en premier, car atomique au niveau OS :
   soit ça réussit entièrement, soit rien n'est modifié.
3. Met à jour `name` dans l'entrée `polenta-repo.yaml → dependencies[]` du parent direct.
4. Parcourt **tous** les repos de l'arbre workspace (pas seulement le parent direct — un
   composant peut implémenter une interface qui n'est pas son parent dans l'arbre, cf. T74
   sprint 1) et réécrit chaque `implements[].interface` pointant vers l'ancien nom, en best-effort
   (l'échec d'un repo n'arrête pas les autres).
5. Rebuild de l'arbre.

Aucune tentative de rollback automatique du renommage physique si une étape suivante échoue —
choix assumé (cf. `T74-design.md` §7, tranché dans ce sprint) : le renommage de répertoire ne
crée jamais de perte de données, seulement une incohérence récupérable (ex. un `implements[]`
qui référence encore l'ancien nom), jamais pire qu'avant le correctif de sécurité du sprint 1.

## Vérification manuelle effectuée

App buildée et pilotée en direct (Playwright `_electron`) contre `polenta-prj2` :

- Renommé `iface-bus-uart` → `iface-bus-uart-v2` depuis la modale d'édition.
- **Répertoire physiquement renommé**, `.git` intact après renommage.
- **`polenta-repo.yaml`** : entrée mise à jour (`name: iface-bus-uart-v2`, url inchangée).
- **Cascade confirmée sur les deux composants qui ne sont pas le parent direct de
  l'interface** (`comp-controller` et `comp-sensor`, tous deux enfants directs de la racine, pas
  de `iface-bus-uart`) : leurs `implements[].interface` sont passés de `iface-bus-uart` à
  `iface-bus-uart-v2`, rôles préservés (`master`/`slave` respectivement) — exactement le
  scénario que ce sprint devait couvrir (une interface n'est pas nécessairement le parent dans
  l'arbre des composants qui l'implémentent).
- Aucune erreur affichée, arbre rechargé correctement sous le nouveau nom.
- Toute donnée de test créée (renommage vers `iface-bus-uart-v2`) a été annulée après coup ;
  `polenta-prj2` est revenu exactement à son état documenté (répertoire renommé en retour,
  `polenta-repo.yaml` et les deux `schema.yaml` restaurés via `git checkout`).

**Non vérifié manuellement dans ce sprint** : le cas diamond-conflict/`MountOverride` (même URL
montée deux fois sous deux noms) — le filtrage par nom de mount exact dans la cascade garantit
par construction qu'un renommage ne touche que les références au montage renommé, mais ce cas
n'a pas été exercé en direct (fixture actuelle n'a pas de diamond conflict configuré).

## Mises à jour SPEC

Aucune. `SPEC-TEMPLATES.md` §3a–3b décrit le format de données (`roles`/`implements`), pas
l'éditabilité UI — pas de divergence. `SPEC-FORKS-BRANCHES-BASELINES.md` §3–4 s'est avéré décrire
un modèle pré-T69 (API REST, `config/components.yaml`) déjà obsolète indépendamment de ce ticket
— pas dans le périmètre de T74 de le corriger.

## Résumé pour archivage

T74 complet (2 sprints) : édition (branche/pin, rôles, renommage avec cascade) et retrait
(avec suppression disque optionnelle) d'un composant ou d'une interface existant dans l'onglet
Structure. Un bug de sécurité pré-existant (T69/T70) a été trouvé et corrigé en sprint 1 : éditer
la branche d'une dépendance déjà clonée vers un nom invalide détruisait son historique git avant
même de découvrir que la branche n'existe pas.
