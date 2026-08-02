# T123 — Sprint 4 (dernier sprint) — matrice de conformité + non-régression + SPEC

## Fichiers modifiés

- `apps/desktop/src/main/services/interface-compliance.service.ts` — réécrit à la granularité
  **composant** (`SystemNode`) au lieu de **repo** (`WorkspaceTreeNode`), cf.
  specs/T123-design.md §8 :
  - `listAllComponents(tree)` (nouveau) énumère tous les `SystemNode` de tous les repos, à toute
    profondeur d'imbrication (`flattenSystemNodes`), avec un `displayName` unique dans tout le
    workspace (`repo › ancêtres locaux › node` — un `SystemNode.name` n'est unique que dans son
    propre repo, T123 §Décisions #1, deux repos différents pourraient en théorie avoir un
    composant local de même nom).
  - `getComplianceMatrix` itère ces composants et filtre sur `node.roles` (au lieu de
    `WorkspaceTreeNode.isInterface`, repo-level).
  - `findApprovedReqsForNode`/`findLinksForNode` (nouveaux) filtrent les exigences/liens d'un repo
    (retournés par `RequirementsIndexService`, qui n'a pas de notion de composant) par
    `objectTypeRef` pour ne garder que ceux appartenant au `SystemNode` ciblé — résout le point
    ouvert de `specs/T123-design.md` §8 : un simple filtre côté appelant a suffi, aucun changement
    n'était nécessaire dans `RequirementsIndexService` (`findAll` acceptait déjà un filtre `type`
    exact, mais un composant a plusieurs types — le filtre par préfixe `objectTypeRef` généralise).
  - `buildMatrix`/`computeNeedsRevalidation` réécrits pour itérer des paires `(repoPath,
    SystemNode)` plutôt que des `WorkspaceTreeNode`.
  - `checkComponentCoverage` **non modifié** — reste à la granularité repo. Vérifié qu'il n'a
    aucun appelant côté renderer (IPC enregistré, jamais invoqué) — pas de régression utilisateur,
    mais à traiter en cohérence si un jour câblé à une UI.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` — `resolveInterfaceRoles`
  cherche désormais aussi dans l'arbre local de chaque repo (`findSystemNode`), pas seulement les
  mounts de repo (`flatNodes`) : un composant local marqué interface est maintenant résolu
  correctement dans la section "Interfaces implémentées" (catalogue de rôles en cases à cocher au
  lieu du fallback texte libre).
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — `rolesExposedLabel` déjà généralisé en
  Sprint 3 ; aucune nouvelle clé ce sprint.

## Non-régression vérifiée en conditions réelles (app buildée + pilotée)

Complète les points laissés en attente dans `specs/T123-sprint2.md`/`T123-sprint3.md` :

- **Création d'exigence sur un composant local imbriqué, bout en bout** : composant `capteur`
  (local, avec un rôle `controller`, badge Interface) → composant `suspension` imbriqué dessous →
  type d'objet `exigence-suspension` (préfixe `SUSP`) créé sur `suspension` → première exigence
  créée depuis la Vue Système → fichier généré `requirements/SUSP-0001.yaml`,
  `objectTypeRef: suspension::exigence-suspension` — bon préfixe (celui de `suspension`, pas d'un
  nœud voisin ou ancêtre), confirmant la non-régression du bug corrigé en T113 sprint1 point 5
  dans un contexte désormais imbriqué.
- **Combobox "Composant" (Vue Système)** : options observées
  `["Produit", "capteur", "capteur › suspension"]` — libellé en chemin conforme à
  specs/T123-design.md §9.
- **Matrice de conformité (`/compliance`)** : page testée avec un composant local (`capteur`,
  rôle `controller`, aucune exigence approuvée) — affiche correctement "Aucune interface trouvée
  dans ce workspace" (comportement attendu : `buildMatrix` retourne `null` sans exigence
  approuvée) sans erreur ni plantage. La réécriture à la granularité composant n'a **pas** été
  testée avec une matrice non vide (colonnes/cellules peuplées) — needs un scénario complet
  (exigence approuvée taguée par rôle + composant implémenteur + lien `implements-interface`),
  jugé disproportionné à mettre en place via pilotage UI pour ce sprint ; la logique elle-même est
  une adaptation directe (même algorithme, granularité changée) de code déjà en production depuis
  T69, relue avec attention plutôt que ré-écrite from scratch.

## Limitations connues, documentées mais non résolues dans ce ticket

1. **Collision de nom de composant interface entre deux repos différents.** `ImplementsDeclaration
   .interface` reste un simple nom (pas un chemin qualifié) — historiquement toujours un nom de
   mount de repo, garanti unique dans tout le workspace (`MountNameConflictError`). Un composant
   local n'est unique que dans son propre repo (T123 §Décisions #1) : si deux repos différents du
   même workspace avaient chacun un composant local de même nom, tous deux marqués interface, un
   `implements: [{interface: 'ce-nom', ...}]` serait ambigu. Cas extrême non désambiguïsé —
   documenté ici plutôt que résolu (changerait le format d'`ImplementsDeclaration`, hors scope).
2. **Champ `roles` d'une exigence (sourcing du catalogue) reste root-only.** Cf. note ajoutée à
   `SPEC-REQ-requirements.md` §3.2d — `EditView` source les options du champ `multi_enum roles`
   depuis `ProjectSchema.roles` (mirroré depuis `root` uniquement), pas encore depuis le
   `SystemNode` d'un composant local marqué interface. À traiter avec T126 (support `multi_enum`
   dans `DynamicField.tsx`), qui touche le même mécanisme.
3. **`checkComponentCoverage`** reste à la granularité repo (cf. ci-dessus) — sans conséquence
   utilisateur actuelle (aucun appelant), à revoir si un jour exposé dans l'UI.

## Mises à jour SPEC effectuées

- **`SPEC-TEMPLATES.md` §3** — réécrite : un composant est une notion unique (local ou avec repo
  séparé), imbrication (`children`) documentée avec exemple YAML, contrainte technique sur
  l'imbrication d'un repo séparé sous un composant local, combobox en chemin `›`, `add_component`
  MCP avec `parentName`.
- **`SPEC-TEMPLATES.md` §3a-3b** — réécrites : `roles`/`implements` portés par `SystemNode` (root
  compris) au lieu de `ProjectSchema`, migration/miroir transparents, édition identique pour tout
  composant (section "Rôles joués par le parent" réservée aux repos séparés), matrice de
  conformité à la granularité composant.
- **`SPEC-SYSTEM-VIEW.md`** — combobox "Composant" : description du libellé en chemin `›` pour une
  entrée imbriquée ; terminologie "sous-composant" → "composant local" dans le corps du texte
  (hors la mention volontairement entre guillemets d'un terme qui n'est plus exposé à
  l'utilisateur).
- **`SPEC-MCP-SERVER.md`** §4.3 (table des tools) et §2.3 — paramètre `parentName` sur
  `add_component`, terminologie "sous-composants" → "composants locaux, imbriqués ou non".
- **`SPEC-FORKS-BRANCHES-BASELINES.md`** §4.1 — note ajoutée clarifiant que le modèle composant-
  en-repo-séparé de cette section reste distinct du composant local (T123), avec la raison
  technique de l'exclusion d'imbrication.
- **`SPEC-REQ-requirements.md`** §3.2d — note sur la limite connue du sourcing du champ `roles`
  (root-only, cf. Limitations connues ci-dessus).
- **`SPEC-INDEX.md`** — colonne `MAJ` mise à jour → `T123` pour toutes les sections listées
  ci-dessus (SPEC-MCP-SERVER §global, SPEC-FORKS-BRANCHES-BASELINES §3-4, SPEC-SYSTEM-VIEW
  §global, SPEC-TEMPLATES §3 et §3a-3b, SPEC-REQ-requirements §3), descriptions/mots-clés
  rafraîchis (imbrication, `children`, `parentName`, composant local).

## Statut

TypeScript : 0 erreur. Testé manuellement dans l'app réelle : création d'exigence bout en bout sur
un composant local imbriqué à profondeur 2 (bon préfixe d'ID), combobox en chemin `›`, page
Conformité interfaces sans régression sur le chemin vide. Le chemin "matrice non vide" de
`interface-compliance.service.ts` n'a pas été testé manuellement (relu avec attention, pas de
scénario UI complet monté) — à surveiller en usage réel. Projets de test nettoyés après
vérification, rien commité en dehors du code/specs de ce sprint.

Ticket T123 complet après ce sprint (4/4) — prêt pour archivage et proposition de merge vers main.
