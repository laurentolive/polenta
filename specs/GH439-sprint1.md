# GH439 — Sprint 1 : données (couverture figée, lecture des exigences d'une version)

Spec : `specs/GH439.md` · design : `specs/GH439-design.md` · scénarios : `specs/GH439-tests.md`.

## Fichiers

| Fichier | Changement |
|---|---|
| `packages/types/src/product-version.ts` | `VersionVerificationRow`, `VersionVerification`, `ProductVersion.verification?`, code `VERSION_NOT_FROZEN` |
| `packages/types/src/version-requirements.ts` (nouveau) | `VersionRequirementRow`, `VersionRequirementsPage`, `VersionVerificationOrigin` |
| `main/services/version-verification.util.ts` (nouveau) | fonctions pures : `buildVerification` (gel), `buildRequirementRows`, `frozenCoverage`, `liveCoverage` |
| `main/services/version-requirements.service.ts` (nouveau) | `VersionRequirementsService.page(repoPath, versionId, workspaceDir?)` |
| `main/services/versions.service.ts` | `release()` fige `verification` dans le commit du fichier de version (`freezeVerification`) ; `setImpactSources` reçoit aussi `getMatrix` ; `page()` ne renvoie plus `verification` |
| `main/container.ts`, `main/ipc/index.ts` | service câblé ; canal `versions:requirements` |
| `web-server/channel-policy.ts` | canal exposé au web, chemins aux positions `[0, 2]` |
| `api-client` (`types.ts`, `ipc-client.ts`) | `versions.requirements(repoPath, id, workspaceDir?)` |

## Comportement

- **Passage released** : après l'analyse d'impact, la couverture de chaque exigence du périmètre (hors statuts terminaux,
  telles que le commit figé les contient) est écrite dans `verification { computedAt, rows: [{ id, status, tests }] }`,
  dans le même commit que le fichier de version. `computedAt` = `freeze.at`. Une matrice illisible fait échouer le
  passage : version en cours, ni tag, ni commit, rien d'écrit (R4).
- **`versions:requirements`** : exigences lues dans l'état de la version (`freeze.sha`, ou disque pour une version en
  cours), schéma du gel pour les champs et libellés. `verification` : `frozen` (copie figée lue, la matrice n'est pas
  calculée), `missing` (released avant GH439 : couverture `null`), `live` (version en cours : matrice à l'instant).
  Abandonnée sans gel : `VERSION_NOT_FROZEN`. Gel absent du repo : `VERSION_NOT_FOUND`, jamais une liste vide.
- **`versions:get`** : `verification` retirée de l'objet `version` (volumineux, une ligne par exigence) ; `analysis`
  inchangée (elle y était déjà).

## Divergences par rapport au design

- Les deux utilitaires purs (`buildVerification`, `buildRequirementRows`) tiennent dans **un seul fichier**
  `version-verification.util.ts` au lieu de deux : ils partagent le tri et le type de couverture.
- `VersionRequirementsPage` n'a **pas** de champ `component` : la page de la version (`versions:get`) le porte déjà.
  `requirementTypeLabels` est indexé par `objectTypeRef` (`<nœud>::<type>`).
- Tests : un seul fichier de service `version-requirements.gh439.test.ts` (séries R, S et volume, montage partagé) et
  `version-verification.util.gh439.test.ts` pour les fonctions pures, au lieu des trois fichiers prévus.
- Tests existants adaptés : `versions.gh245.test.ts` (index réels + `getAt`) et `issues.gh244.test.ts` (`getAt`) — le
  passage released lit maintenant le schéma du gel et la matrice ; `path-guard.test.ts` (28 canaux versions/validations).

## Vérifications (niveau 2, sans UI)

- `pnpm typecheck` : OK. `pnpm lint` : seules les 3 erreurs préexistantes de `main` (#437), aucune dans ce ticket.
- Nouveaux tests : 30 (R1–R10, S1–S17, pures). Volume : 1 500 exigences, passage released + lecture en ~32 s,
  fichier de version à **105 Ko**, aucune erreur de file de tâches Git (leçon GH335).
- Suites voisines : `versions.gh201`, `versions.gh245`, `issues.gh244`, `validations.gh204`, `web-server`.

## Revue (`/code-review medium 440`)

- **Corrigé** : un schéma illisible faisait entrer les exigences terminales dans le périmètre (`inPerimeter(null, …)`
  les garde toutes), donc dans la couverture figée. `VersionsService.perimeterOf` (schéma + exigences du périmètre)
  remonte `VERSION_NOT_FOUND` ; utilisé par le gel et par la page (tests R4b, S10b).
- **Assumé, documenté au dernier sprint** : la couverture lit le workspace, pas le commit (précédent GH245) — un lien
  ou une exécution non commités au passage sont comptés ; annoncé à la validation de la spec.
- **Reporté** : traduction de `VERSION_NOT_FROZEN`, `SectionToggle` / `useVersionRequirements` sans appelant (sprint 2),
  entrée `verification` de CLAUDE.md (sprint 3).
- Non retenu : double lecture du périmètre et de la matrice au passage (coût d'un passage mesuré : le volume à
  1 500 exigences, écriture des fichiers comprise, tient en ~32 s).

## Comment tester à la main

Rien à voir à l'écran à ce stade (pas d'UI). Le canal se vérifie depuis le sprint 2, dans la section « Exigences ».
Les fichiers de version released à partir de maintenant contiennent une clé `verification:`.

## Mises à jour SPEC

Reportées au dernier sprint (SPEC-REQ §11.1, CLAUDE.md « Champs propres aux versions »).
