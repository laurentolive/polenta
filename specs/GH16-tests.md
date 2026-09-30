# GH16-tests — Scénarios de validation

Pas d'infrastructure de test unitaire sur `main/services/*` ni sur le serveur MCP (cf.
T122-tests.md) : scénarios à exécuter manuellement par l'Agent Dev, via un client MCP réel
(Claude Code + `.mcp.json`) ou un script Node client stdio
(`@modelcontextprotocol/sdk/client`), sur une **copie jetable** d'un repo Polenta
d'exemple.

Pré-requis du repo de test : un `linkTypes` `verification` (`sourceRefs: [test]`,
`targetRefs: [requirement]`), un `implementation` (`[requirement]` → `[requirement]`),
au moins 2 exigences (`R1`, `R2`), 2 tests (`T1`, `T2`), 1 campagne (`C1`), et quelques
liens existants dans `links/links.yaml` dont `L0 = verification T1 → R1`.

Pour chaque écriture : noter le hash de `links/links.yaml` avant/après.

## Nominal

1. **Découverte** : la liste des tools contient `list_links`, `create_links`,
   `delete_links`.
2. **`list_links` sans filtre** = contenu exact de `links/links.yaml`.
3. **`list_links { objectId: R1 }`** : uniquement les liens où R1 est source ou cible.
   **`{ objectId: R1, type: verification }`** : intersection.
4. **`create_links` dryRun implicite** avec `verification T2 → R2` : `wouldCreate` contient
   l'entrée, `created` vide, hash de `links.yaml` **inchangé**.
5. **`create_links { dryRun: false }`** même entrée : `created: [{ index: 0, id: lnk_… }]`,
   le lien est dans `links.yaml` avec `createdBy: mcp`, `createdAt` ISO, sens T2 → R2
   conservé.
6. **Sens inverse accepté** : `verification R2 → T1` (exigence en source) : valide, écrit
   tel quel (sourceId R2).
7. **Lot de 3 entrées valides** en `dryRun: false` : 3 liens, ids distincts ; vérifier (log
   ou mtime) une **seule** écriture de `links.yaml`.
8. **`delete_links` dryRun** avec l'id créé en 5 : `wouldDelete` = l'objet complet, fichier
   inchangé. Puis `dryRun: false` : `deleted: [id]`, lien absent du fichier, autres liens
   intacts.
9. **App ouverte en parallèle** : après 5, la vue édition de R2 (app Polenta ouverte sur le
   même repo) affiche le lien sans redémarrage ; après 8, il disparaît.

## Validation stricte (create_links)

10. `type: inexistant` → `LINK_TYPE_NOT_FOUND`.
11. `sourceId = targetId = R1` → `SELF_LINK`.
12. `targetId: SYS-9999` (inexistant) → `OBJECT_NOT_FOUND`, la raison cite `SYS-9999` et
    précise « cible ».
13. `verification R1 → R2` (exigence ↔ exigence) → `LINK_TYPE_INCOMPATIBLE`.
14. `implementation R1 → R2` → valide. `implementation T1 → R1` → `LINK_TYPE_INCOMPATIBLE`.
15. Doublon exact de `L0` (`verification T1 → R1`) → `DUPLICATE_LINK`, raison cite l'id de
    `L0`. Doublon inversé (`verification R1 → T1`) → `DUPLICATE_LINK` aussi.
16. Même entrée deux fois dans un lot : index 0 valide, index 1 `DUPLICATE_LINK`.
17. **Lot mixte** (2 valides, 3 invalides de causes différentes) en `dryRun: false` :
    `summary { total: 5, ok: 2, failed: 3 }`, les 2 valides écrits, `errors` triés par
    index, chacun avec son `code`.
18. Linktype avec `sourceRefs`/`targetRefs` sous forme `nœud::type` : un objet de ce type
    exact est accepté, un objet d'un autre type de même catégorie est refusé.
19. Campagne : un linkType dont les refs incluent `campaign` accepte `C1` ; `verification
    C1 → R1` → `LINK_TYPE_INCOMPATIBLE`.

## Cas limites

20. `entries: []` → `summary { total: 0, ok: 0, failed: 0 }`, pas d'écriture même en
    `dryRun: false`.
21. Repo sans `links/links.yaml` : `list_links` → `{ links: [] }` ; `create_links dryRun:
    false` crée le fichier.
22. `delete_links` avec un id inexistant + un id valide : `LINK_NOT_FOUND` à l'index du
    premier, le second supprimé. Même id répété : 2ᵉ occurrence `LINK_NOT_FOUND`.
23. **Index MCP périmé (objets)** : serveur MCP démarré, `list_requirements` appelé
    (index construit), puis création d'une exigence `R3` **dans l'app** ; `create_links`
    avec `R3` → valide (invalidation + nouvel essai), pas `OBJECT_NOT_FOUND`.
24. **Index MCP périmé (liens)** : serveur MCP démarré, `list_links` appelé, puis
    création d'un lien **dans l'app** ; `create_links dryRun: false` d'un autre lien → le
    lien créé dans l'app est **toujours présent** dans `links.yaml`. Idem avec
    `delete_links`.
25. **Mode workspace** (`--workspace` fourni, projet avec un composant local ou
    submodule) : lien `verification` entre un test du repo produit et une exigence du
    composant → valide, écrit dans `links/links.yaml` du **repo produit**. Sans
    `--workspace` : même lien → `OBJECT_NOT_FOUND` (limitation mono-repo documentée).
26. **Erreur inattendue** : `links/links.yaml` au YAML corrompu → erreur de protocole
    remontée (pas un résultat `errors[]`), fichier non écrasé.

## Documentation

27. Ouvrir dans l'app un projet dont l'`AGENTS.md` porte la version 1 → régénéré en
    version 2, mentionne `list_links`/`create_links`/`delete_links`.
28. `pnpm --filter desktop run typecheck` sans erreur ; `pnpm --filter desktop run
    build:mcp-server` produit le bundle.
