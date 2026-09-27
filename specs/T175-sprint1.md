# T175 — Sprint 1 (unique) : analyse d'impact des modifications locales (vs HEAD)

Réf. : `specs/T175.md`, `specs/T175-design.md`, `specs/T175-tests.md`. Travail sur `main`.

## Fichiers modifiés

- `packages/types/src/impact-analysis.ts` — `ElementRepoRef`, `ImpactNode.repo?`,
  `ChangedRequirement.elementType?` / `repo?`, `LocalImpactAnalysis`.
- `packages/api-client/src/types.ts`, `ipc-client.ts` — `impactAnalysis.local(repoPath, workspaceDir?)`.
- `apps/desktop/src/main/ipc/index.ts` — handler `impact-analysis:local`.
- `apps/desktop/src/main/services/sync.service.ts` — `resolveHead`, `workdirChangesVsHead`.
- `apps/desktop/src/main/services/traceability.service.ts` — `diffElementFields` (exigences + tests),
  `ImpactSnapshot` multi-repo (`repoPath` par élément, `rootRepoPath`, `repoNames`),
  `loadWorkingTreeSnapshot`, `readYamlLenient`, `buildImpactTreesFromSnapshot(…, rootType)` avec liens de
  couverture suivis dans les deux sens, `computeLocalImpactAnalysis`.
- `apps/desktop/src/renderer/hooks/useLocalImpactAnalysis.ts` (nouveau) — query partagée panneau/page.
- `apps/desktop/src/renderer/hooks/useLiveFileSync.ts` — invalide `['impact-analysis:local']` sur
  changement d'élément/lien ou de ref dans n'importe quel repo.
- `apps/desktop/src/renderer/contexts/ImpactAnalysisContext.tsx` — `LOCAL_IMPACT_ANALYSIS_ID`.
- `apps/desktop/src/renderer/components/sidebar/version/VersionImpactSelector.tsx` — entrée « Modifications
  locales (vs HEAD) », sélection auto à l'ouverture, désélection quand les modifications disparaissent ;
  import `ArrowLeft` inutilisé retiré.
- `apps/desktop/src/renderer/routes/impact-analysis.tsx` — rendu lecture seule (`readOnly`), badge EX/TC
  et badge de repo, popup ouvert dans le repo de l'élément, en-tête + bouton Rafraîchir.
- `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` — 6 clés.
- Specs : `SPEC-TRACEABILITY.md` (§4.6, nouveau §4.7), `SPEC-INDEX.md`, `T175-tests.md`, `T175-design.md`.

## Comportement implémenté

Conforme à `specs/T175.md`. Correction du sens des liens de couverture appliquée à tous les cas (analyse
locale et nouvelles analyses entre baselines), comme demandé à la validation du design.

## Divergences par rapport au design

1. **Pas de polling à 5 s** : le main process a déjà un watcher (`RepoWatcherService`, chokidar sur chaque
   repo du workspace + `.git/HEAD`/`refs`) relayé au renderer par `repo:file-changed`. `useLiveFileSync`
   invalide la query locale sur tout changement `requirements/`, `tests/`, `links/` ou de ref (`'*'`) —
   recalcul immédiat, rien quand rien ne bouge. `refetchOnWindowFocus` + bouton Rafraîchir en filet.
2. **Sections racine des tests** : `steps`, `preconditions`, `equipment`, `postconditions` ne sont pas dans
   `fields` (le design supposait `fields.steps`) — comparées en plus pour un test, chacune un champ
   (`steps`…). Trouvé par `/code-review`.
3. **YAML illisible** : le type de changement vient de git (`statusMatrix`), pas de la lisibilité du fichier.
   Un fichier invalide en cours d'édition est signalé (ajouté/modifié, sans détail de champs, id = nom de
   fichier si besoin) au lieu d'être pris pour une suppression ; `readYamlLenient` évite qu'un seul fichier
   invalide fasse échouer toute l'analyse (`GitService.readYaml` propage l'erreur de parsing — laissé tel
   quel pour les autres appelants). Trouvé par `/code-review` et le test L5.

## Vérifications

- `tsc` (`apps/desktop`, `packages/api-client`) : propre.
- Script de service hors UI (tsx, repos git temporaires, sans Electron) : **41/41 OK** — N1–N10, L1–L9
  (+ L5b), R3. Hors dépôt (scratchpad).
- `/code-review` : 2 bugs (points 2 et 3 ci-dessus), corrigés et re-testés.
- App (build + driver Playwright, projet fixture mono-repo) : N11 (entrée auto-sélectionnée, SYS-0001
  modifiée + SYS-0003 ajoutée, TEST-0001 rattaché via un lien créé depuis l'exigence, pas de statut /
  export / campagne), N12 (édition externe de SYS-0002 visible en quelques secondes), N13 (commit → entrée
  disparue, retour au message d'invite).
- Non vérifiés dans l'app : N14 (popup d'un élément de composant — multi-repo couvert par le script de
  service N8), L10/L11/L13, R1/R2 (parcours T46 complet).

## Limite connue

`isomorphic-git` se fie aux stats de l'index (mtime à la seconde + taille) : une réécriture de même taille
dans la même seconde que le commit n'est pas vue comme modifiée tant que le fichier n'est pas retouché.
Sans effet en usage réel ; le script de test attend 1 s après chaque commit.

## Mises à jour SPEC

- `SPEC-TRACEABILITY.md §4.6` — liens de couverture test ↔ exigence suivis dans les deux sens dans les arbres
  (analyses persistées non recalculées).
- `SPEC-TRACEABILITY.md §4.7` (nouveau) — analyse live des modifications locales : présentation, périmètre,
  calcul, nature non persistée, rafraîchissement.
- `SPEC-INDEX.md` — ligne SPEC-TRACEABILITY §3+ : couverture + mots-clés, MAJ → T175.

## Tester manuellement

1. Projet (idéalement avec un composant) propre : ouvrir Analyse d'impact → pas d'entrée locale.
2. Modifier l'énoncé d'une exigence liée à des tests et à une exigence fille, créer une exigence liée, modifier
   les étapes d'un test. Ouvrir Analyse d'impact → entrée « Modifications locales (vs HEAD) » sélectionnée ;
   les 3 éléments listés avec leurs arbres ; aucune liste déroulante de statut, pas d'export ni de campagne.
3. Vue ouverte, modifier un autre élément (dans l'app ou un éditeur externe) → il apparaît en quelques
   secondes. Idem pour une modification dans un composant (badge du composant, popup ouvert au bon endroit).
4. Cliquer sur l'entrée pour la désélectionner → elle reste désélectionnée ; choisir une analyse enregistrée
   → elle reste affichée malgré les modifications.
5. Publier → l'entrée disparaît, la vue revient au message d'invite.
6. Non-régression : créer une analyse entre deux baselines, changer des statuts, générer une campagne,
   exporter ; rouvrir une analyse ancienne.
