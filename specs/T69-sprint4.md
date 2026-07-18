# T69-sprint4 — Interfaces versionnées et matrice de conformité

## Fichiers modifiés / créés

| Fichier | Nature | Raison |
|---|---|---|
| `TICKETS.md` | modifié | T69 passé en "coding sprint 4" |
| `packages/types/src/schema.ts` | modifié | Ajout `RoleDefinition`, `ImplementsDeclaration` ; `ProjectSchema` enrichi avec `roles?` et `implements?` |
| `packages/types/src/polenta-workspace.ts` | modifié | `WorkspaceTreeNode` : ajout `implements?` ; ajout types `ComplianceCellStatus`, `ComplianceCell`, `ComplianceRequirementRow`, `ComplianceComponentColumn`, `ComplianceMatrix`, `CoverageResult` |
| `apps/desktop/src/main/services/workspace-tree.service.ts` | modifié | `buildWorkspaceTree()` devient async ; lit `schema.yaml` de chaque repo pour peupler `isInterface` et `implements` dans les `WorkspaceTreeNode` |
| `apps/desktop/src/main/services/interface-compliance.service.ts` | NOUVEAU | `InterfaceComplianceService` : `getComplianceMatrix()`, `checkComponentCoverage()`, `computeNeedsRevalidation()` |
| `apps/desktop/src/main/container.ts` | modifié | Instanciation `InterfaceComplianceService`, injection dans `registerIpcHandlers` |
| `apps/desktop/src/main/ipc/index.ts` | modifié | `InterfaceComplianceService` dans `Container` ; canaux `interface:compliance-matrix`, `interface:coverage`, `interface:needs-revalidation` |
| `packages/api-client/src/types.ts` | modifié | Import `ComplianceMatrix`, `CoverageResult` ; ajout `interface.*` dans `ApiClient` |
| `packages/api-client/src/ipc-client.ts` | modifié | Câblage des 3 nouveaux canaux IPC `interface:*` |
| `apps/desktop/src/renderer/components/ComplianceMatrix.tsx` | NOUVEAU | Composant React affichant la matrice de conformité (lignes groupées par rôle, colonnes composants, cellules colorées par statut) |
| `apps/desktop/src/renderer/routes/compliance.tsx` | NOUVEAU | Route `/compliance?dir=...` : vue "Conformité interfaces" avec onglets par interface et matrice |
| `apps/desktop/src/renderer/routes/workspace.tsx` | modifié | Ajout bouton "Conformité interfaces" naviguant vers `/compliance?dir=...` |
| `apps/desktop/src/renderer/routes/schema.tsx` | modifié | Import `RoleDefinition`, `ImplementsDeclaration` ; `EditorState` enrichi avec `roles` et `implements` ; convertisseurs mis à jour ; nouvel onglet "Interfaces" avec `InterfacesTab` ; `Tab` union mise à jour |
| `apps/desktop/src/renderer/routeTree.gen.ts` | modifié | Enregistrement de la route `/compliance` |
| `specs/SPEC-TEMPLATES.md` | modifié | §3 : suppression de la mention des champs `url`/`branch` obsolètes ; ajout §3a (interface repos : `roles:`) et §3b (composant implémenteur : `implements:`) |
| `specs/SPEC-INDEX.md` | modifié | Ligne SPEC-TEMPLATES.md : `MAJ` passé à `T69` ; nouvelle ligne §3a–3b |

---

## Comportement implémenté

### CA-7 — Déclaration des rôles

- `RoleDefinition` et `ImplementsDeclaration` ajoutés à `schema.ts`.
- `ProjectSchema` peut maintenant déclarer `roles:` (pour les repos interface) et `implements:` (pour les repos composant).
- L'onglet "Interfaces" dans l'éditeur de schéma permet d'éditer ces deux sections.
- `WorkspaceTreeService.buildWorkspaceTree()` lit `.polenta/schema.yaml` de chaque repo et peuple `isInterface: true` si `roles.length > 0`, et remplit `implements` depuis la déclaration `implements:`.
- Le badge "Interface" violet est déjà rendu dans `workspace.tsx` (Sprint 2) — il est maintenant correctement peuplé.

### CA-8 — Vérification de couverture par rôle

- `InterfaceComplianceService.checkComponentCoverage()` filtre les exigences `approved` de l'interface par intersection des rôles déclarés par le composant.
- Une exigence sans champ `roles` dans son frontmatter s'applique à tous les rôles (exigence commune).
- Un composant dont les rôles ne se croisent pas avec ceux d'une exigence obtient un statut `na` dans la matrice.

### CA-9 — Matrice de conformité

- `InterfaceComplianceService.getComplianceMatrix(workspaceDir)` produit une `ComplianceMatrix` par repo interface du workspace.
- La route `/compliance?dir=...` est accessible depuis le bouton "Conformité interfaces" dans la vue workspace.
- La vue `ComplianceMatrix.tsx` affiche :
  - lignes groupées par rôle (ou "Exigences communes")
  - colonnes = composants implémenteurs avec leurs rôles déclarés
  - cellules `validated` (vert), `covered` (ambre), `missing` (rouge), `na` (grisé)
- Si plusieurs interfaces dans le workspace, des onglets permettent de naviguer entre elles.

### CA-10 — Notification needsRevalidation sur modification interface

- `InterfaceComplianceService.computeNeedsRevalidation(interfaceReqId, reqRoles, workspaceDir)` parcourt tous les repos du workspace, filtre ceux dont les rôles déclarés intersectent `reqRoles`, et retourne les IDs de liens `implements-interface` concernés.
- IPC `interface:needs-revalidation` expose cette méthode. L'appelant (UI) peut ensuite marquer ces liens en `needsRevalidation` via le service de liens existant.

### Peuplement de `isInterface` dans WorkspaceTreeNode

- Auparavant : `isInterface: false` pour tous les nœuds (divergence Sprint 2).
- Maintenant : `buildWorkspaceTree()` lit le `schema.yaml` de chaque repo via une nouvelle méthode `readSchema()` et peuple correctement `isInterface` et `implements`.

---

## Divergences par rapport au design

1. **`interface:needs-revalidation` ajouté en bonus** : le design Sprint 4 listait deux canaux IPC (`interface:compliance-matrix` et `interface:coverage`). Un troisième canal `interface:needs-revalidation` a été ajouté car il complète directement CA-10 sans surcoût significatif.

2. **Écriture effective de `needsRevalidation` hors scope** : `computeNeedsRevalidation` retourne les IDs de liens à marquer, mais l'écriture physique des fichiers de liens (marquer `needsRevalidation: true`) n'est pas implémentée ici. Le mécanisme d'écriture existe déjà dans `RequirementsIndexService` et serait déclenché par l'appelant UI. Cette implémentation est cohérente avec le design "ce ticket pose l'infrastructure, l'UI d'upgrade reste à planifier".

3. **Notification côté UI non câblée** : la notification visible dans la vue d'analyse d'impact (T46) pour les liens `needsRevalidation` issus d'un changement d'interface n'est pas déclenchée automatiquement. L'infrastructure est en place ; le déclencheur événementiel (watcher sur changement de statut d'exigence) est hors scope Sprint 4.

4. **`ComplianceCellStatus` renommé depuis `CellStatus`** : `CellStatus` était déjà exporté par `traceability.ts` avec des valeurs incompatibles (`not_run`, `pass`, `fail`…). Pour éviter le conflit d'export, le type de Sprint 4 est nommé `ComplianceCellStatus`.

---

## Mises à jour SPEC effectuées

| Fichier | Section | Modification |
|---|---|---|
| `SPEC-TEMPLATES.md` | §3 | Suppression de la mention des champs `url`/`branch` obsolètes sur `SystemNode` ; ajout note sur workspace plat T69 |
| `SPEC-TEMPLATES.md` | §3a (NOUVEAU) | Documentation des repos interface : déclaration `roles:` dans `schema.yaml`, effet sur le badge workspace et la matrice de conformité |
| `SPEC-TEMPLATES.md` | §3b (NOUVEAU) | Documentation des repos composant implémenteur : déclaration `implements:` avec interface, version, roles |
| `SPEC-INDEX.md` | ligne SPEC-TEMPLATES.md | `MAJ` mis à `T69` ; nouvelle ligne `§3a–3b` indexant les nouvelles sections |

---

## Comment tester manuellement

### Test CA-7 — Déclarer des rôles sur un repo interface

1. Ouvrir un projet dans Polenta.
2. Naviguer vers Modèle de données → onglet "Interfaces".
3. Dans la section "Rôles (repo interface)" :
   - Cliquer "+ Ajouter un rôle"
   - Saisir `controller` / label `Contrôleur CAN`
   - Cliquer "+ Ajouter un rôle"
   - Saisir `device` / label `Périphérique CAN`
4. Sauvegarder.
5. Vérifier : `.polenta/schema.yaml` contient `roles: [{name: controller, label: Contrôleur CAN}, ...]`.
6. Si ce repo est dans un workspace, reconstruire l'arbre : le badge "Interface" doit apparaître sur ce repo.

### Test CA-7 — Déclarer une implémentation sur un repo composant

1. Dans un repo composant, Modèle de données → onglet "Interfaces".
2. Section "Implémentations (repo composant)" → "+ Déclarer une implémentation".
3. Saisir : interface = `iface-can-bus`, version = `2.1`, rôles = `device`.
4. Sauvegarder → vérifier `.polenta/schema.yaml` contient `implements: [{interface: iface-can-bus, version: "2.1", roles: [device]}]`.

### Test CA-9 — Matrice de conformité

1. Avoir un workspace avec :
   - `iface-can-bus` : `roles: [controller, device]` dans son schema.yaml + exigences `approved` avec `roles: [device]` dans leur frontmatter.
   - `comp-motor` : `implements: [{interface: iface-can-bus, version: "2.1", roles: [device]}]`.
2. Depuis la vue workspace, cliquer "Conformité interfaces".
3. Vérifier : la matrice affiche une ligne par exigence de `iface-can-bus`, une colonne `comp-motor`.
4. Les exigences `[controller]` uniquement : cellule grisée (`na`) pour `comp-motor`.
5. Les exigences `[device]` ou communes : cellule `missing` (si pas de lien) ou `covered`/`validated` (si lien présent).

### Test CA-10 — Via DevTools

```js
// Calculer les liens à revalider pour une exigence d'interface modifiée
await window.polenta.invoke(
  'interface:needs-revalidation',
  'CAN-002',       // interfaceReqId
  ['device'],      // roles de cette exigence
  '/workspace'     // workspaceDir
)
// → [{ componentRepoPath: '/workspace/comp-motor', linkId: 'link-123' }]
```

### Test CA-8 — Via DevTools

```js
// Vérifier la couverture d'un composant sur une interface
await window.polenta.invoke(
  'interface:coverage',
  '/workspace/comp-motor',    // componentRepoPath
  '/workspace/iface-can-bus', // interfaceRepoPath
  ['device']                  // declaredRoles
)
// → { componentName, interfaceName, applicable, covered, missing, validated }
```
