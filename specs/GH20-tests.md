# GH20 — Scénarios de test

Spec : `specs/GH20.md`. Design : `specs/GH20-design.md`.
Sauf mention « manuel », chaque scénario est exécuté par le script `tsx` de vérification
sur un repo temporaire (`git init`, `.polenta/schema.yaml` minimal).

## Nominal

1. **Premier ID** — repo vide, sans `counters.yaml` → création d'une exigence `SYS` :
   `SYS-0001` ; aucun `config/counters.yaml` créé.
2. **Séquence** — trois créations `SYS` successives → `SYS-0001`, `SYS-0002`, `SYS-0003`.
3. **Prefixes indépendants** — `SYS-0003` existe, création d'un test `TST` → `TST-0001`.
4. **UC-1 campagne** — `CAMP-0001`, `CAMP-0002` ; suppression de `CAMP-0002` →
   `.polenta/tombstones/CAMP-0002` existe (fichier vide), `campaigns/CAMP-0002.yaml`
   absent ; création → `CAMP-0003`.
5. **Pierre tombale après redémarrage** — `CAMP-0001` présent, pierre tombale
   `CAMP-0002`, nouveau process (mémoire vide) → création → `CAMP-0003`.
6. **UC-2 requête** — `QUERY-0005` partagée passée en privé → pierre tombale
   `QUERY-0005` ; nouvelle requête partagée → `QUERY-0006`.
7. **Dashboard** — mêmes vérifications que 4 et 6 pour `DASHBOARD` (delete et setScope → privé).
8. **Revue** — deux créations → `REVIEW-0001`, `REVIEW-0002`, sans `counters.yaml`.

## Migration

9. **UC-3** — `counters.yaml` = `{ SW: 42, CAMP: 7 }`, `requirements/SW-0042.yaml`
   présent, aucun `CAMP-0007.yaml` → une création quelconque : pierre tombale
   `CAMP-0007` seulement (pas `SW-0042`), `counters.yaml` supprimé ; prochains IDs
   `SW-0043` et `CAMP-0008`.
10. **Clés héritées** — `counters.yaml` = `{ nextId: 12, prefixes: {…}, QUERY: 3 }` →
    pas de pierre tombale `nextId-…` ni `prefixes-…` ; `QUERY-0003` posée si absente.
11. **Idempotence** — interrompre après la pose des pierres tombales (fichier
    `counters.yaml` remis en place à la main) → relancer : même ensemble de pierres
    tombales, `counters.yaml` supprimé, mêmes prochains IDs.
12. **Exigence en sous-dossier** — `counters.yaml` = `{ SW: 5 }`,
    `requirements/sub/SW-0005.yaml` présent → pas de pierre tombale `SW-0005`.

## Concurrence et mémoire

13. **Créations concurrentes** — `Promise.all` de 10 `create()` `SYS` sur le même repo →
    10 IDs distincts `SYS-0001`…`SYS-0010`, 10 fichiers.
14. **Idem dashboards, requêtes, revues** (non sérialisés avant GH20) : 5 créations
    parallèles de chaque → IDs distincts.
15. **Réservation** — `nextCounterId` appelé deux fois sans écrire de fichier entre les
    deux → deux IDs distincts consécutifs.

## Repo composant (§3.1 du design)

16. **Attribution dans le composant** — workspace produit + composant `mc` (prefix `MC`,
    présent dans le cache d'arbre) ; `mc/requirements/MC-0004.yaml` existe → création
    d'une exigence `mc::exigence` depuis le produit : `MC-0005` écrit dans le composant ;
    une deuxième création → `MC-0006` (pas de réattribution de `MC-0005`).
17. **Aperçu dryRun composant** — même état, `bulk_import_requirements` `dryRun: true`
    avec 2 entrées `mc::exigence` → `MC-0005`, `MC-0006` ; `dryRun: false` → mêmes IDs.

16b. **Historique du produit** (ajouté en revue de code) — `counters.yaml` du produit =
    `{ MC: 12 }`, composant avec `MC-0004` seul → aperçu `dryRun` et création :
    `MC-0013` ; workspace neuf dont le produit porte seulement la pierre tombale
    `MC-0012` → création : `MC-0013`.

## Aperçu MCP

18. **UC-5** — repo non migré (`counters.yaml` = `{ CAMP: 7 }`, aucun fichier) →
    `bulk_import_campaigns` `dryRun: true` → `CAMP-0008` ; `counters.yaml` toujours
    présent, aucune pierre tombale créée ; `dryRun: false` → `CAMP-0008` créé.

## Cas limites

19. **Garde-fou** — un fichier `CAMP-0003.yaml` créé à la main entre l'attribution et
    l'écriture (simulé en appelant `nextCounterId` puis en créant le fichier) →
    `create()` échoue avec `… already exists`, aucun écrasement.
20. **Dossier absent** — ni `campaigns/` ni `.polenta/tombstones/` → `CAMP-0001`.
21. **Pierre tombale sans objet** — seule `.polenta/tombstones/CAMP-0009` existe →
    `CAMP-0010`.
22. **Numéro > 9999** — `SW-12345.yaml` présent → `SW-12346` (format 4 chiffres minimum).

## Manuel (app)

23. Supprimer une campagne dans l'UI, puis Publier → le commit contient la suppression
    et `.polenta/tombstones/CAMP-xxxx`.
24. Ouvrir un projet existant ayant un `counters.yaml`, créer une exigence → la vue des
    changements montre `counters.yaml` supprimé (+ pierres tombales éventuelles) ; l'ID
    attribué suit la séquence d'avant.

## Critères d'acceptation vérifiables

- `grep -rn "counters.yaml" apps/desktop/src` ne trouve plus que la migration (lecture +
  suppression) et des commentaires.
- `GitService.nextCounterId` et `ReviewsService.nextReviewId` n'existent plus.
- `pnpm typecheck` et `pnpm lint` : zéro erreur nouvelle.
- Scénarios 1–22 au vert dans le script de vérification.
