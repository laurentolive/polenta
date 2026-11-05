# GH210 — Design technique : reflets Design et Validation

> Spec : `specs/GH210.md` (validée le 2026-11-05, D1–D6 acceptées).

## 1. Découpage

Un sprint : un service de lecture côté main, un canal, puis les colonnes dans les vues, sur le modèle de `coverageStatus`.

## 2. Types (`packages/types/src/validation.ts`)

```ts
/** GH210 — reflets d'une exigence : statut de design et décision de la dernière validation signée. */
export interface RequirementReflections {
  design?: { versionId: string; versionLabel: string }
  validation?: { decision: string; decisionLabel: string; validationId: string; versionId: string; versionLabel: string }
}
```

## 3. Main

### `ReflectionsService` (nouveau, `reflections.service.ts`)

```ts
list(repoPath: string, objectTypeRef: string, workspaceDir?: string): Promise<Record<string, RequirementReflections>>
```

- **Repo lu** : le propriétaire du type (`schema.resolveComponentRepoPath`), pour une exigence de sous-composant.
- **Design** : `VersionsService.designVersionsFor` (déjà utilisé par la vue Validation), sur les exigences du repo
  (`requirementStates`, nouvelle méthode publique qui expose `elements(repo, 'requirement')`).
- **Validation** :
  1. `VersionsService.releasedInOrder(repo)` (nouvelle méthode publique autour de la fonction existante) : versions released dans
     l'ordre des livraisons ;
  2. `ValidationsService.list(repo)` filtré sur `validationState === 'signed'` (D2 : une annulée ne compte plus) ;
  3. la retenue est celle dont la version est la plus avancée dans cet ordre (D1) ;
  4. une entrée par exigence de cette validation → `decision`, libellé lu dans `decisions` du type de validation ; exigence
     sans entrée : pas de reflet (D3).
- Aucun cache côté main : le renderer met en cache par repo, et le calcul n'est demandé que si une colonne est visible.

### Canal

- `reflections:list(repoPath, objectTypeRef, workspaceDir)` ; `api.reflections.list` (`packages/api-client`).
- Exposé au web (`WEB_EXPOSED`, `ROOT_ARGS` `[0, 2]`) : il ne lit que les versions et validations, en lecture (D6).

## 4. Renderer

- **Clés de colonne** `designStatus` et `validationStatus`, colonnes système facultatives comme `coverageStatus` :
  - `ExcelView.tsx` : liste des colonnes système (l. 197), texte affiché pour tri, filtre et export (l. 1586), rendu de
    cellule (l. 2530) ;
  - `WordView.tsx` : colonnes système (l. 110), en-tête (l. 538, 603) ;
  - `FieldConfigModal.tsx` (l. 76–79) : libellés et liste ;
  - `EditView.tsx` : affichés en lecture seule, comme les autres champs système.
- **Chargement** : `SystemView.tsx`, comme `coverageNeeded` (l. 514) : requête `['reflections', repoPath, typeRef, workspaceDir]`
  activée seulement si une des deux colonnes est visible et le type est une exigence ; carte `reflectionsByReqId` transmise
  aux vues.
- **Affichage** : Design « 1.2.4 » ; Validation « Conforme (1.2.4) » ; sinon « — ». Le label de version ouvre
  `/version/$versionId` dans le repo propriétaire, sauf sur le web (`capabilities`), où il reste du texte (D6).
- **Libellés** (D5) : `system.fieldConfig.colCoverage` → « Vérification » ; nouvelles clés `colDesign`, `colValidation`.
- **Invalidation** : `useLiveFileSync` invalide `['reflections']` sur `versions/`, `validations/`, `requirements/`, le schéma
  et `polenta-repo.yaml` (signature, annulation, release écrites par l'application ou ailleurs).
- **Vues enregistrées** (GH203) : les colonnes sont des clés de `visibleFields` comme les autres, aucun code dédié ;
  vérifié par test.

## 5. Décisions et alternatives rejetées

- **Un service dédié** plutôt qu'un ajout au graphe : le graphe porte déjà les données brutes (`designVersion`,
  validations et entrées) ; le reflet est un affichage de Polenta, pas un contrat pour les scripts (spec §3).
- **« Dernière signée » globale au composant** : on prend une seule validation pour tout le repo, et non la dernière
  décision exigence par exigence. C'est le feu vert le plus récent, et une exigence qu'il n'a pas couverte affiche « — » (D3).
- **Pas de cache côté main** : `designVersionsFor` lit git par exigence incluse ; la requête n'est lancée que si la colonne
  est visible, et React Query la garde jusqu'à invalidation.

## 6. Fichiers

| Zone | Fichiers |
|---|---|
| Types | `packages/types/src/validation.ts` |
| Main | `reflections.service.ts` (nouveau), `versions.service.ts` (`releasedVersions`, `requirementStates`), `container.ts`, `ipc/index.ts` |
| Web | `web-server/channel-policy.ts` |
| Client | `packages/api-client` |
| Renderer | `SystemView.tsx`, `ExcelView.tsx`, `WordView.tsx`, `EditView.tsx`, `FieldConfigModal.tsx`, `useLiveFileSync.ts`, `fr.json`, `en.json` |
| Specs | SPEC-REQ §13, SPEC-SYSTEM-VIEW, SPEC-WEB §11, SPEC-INDEX |
