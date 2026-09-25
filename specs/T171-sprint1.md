# T171 — Sprint 1 : base de paramètres et vue Paramètres

Réf. : `specs/T171.md`, `specs/T171-design.md` §3, `specs/T171-tests.md` (Sprint 1). Travail sur `main`.

## Fichiers modifiés

**Types partagés (`packages/types`)**
- `src/parameter.ts` (nouveau) — `Parameter`, `ParametersFile`, `RepoParameters` (avec `usageCounts`), `ParameterUsage`, `ParameterWriteResult`, `ParameterDeleteResult`.
- `src/parameter-refs.ts` (nouveau) — la grammaire unique : `PARAM_NAME_RE`, `paramRefRegExp()`, `parseParamRefs`, `extractTestParamRefs` (ordre T97), `extractFieldParamRefs`, `formatParamValue`, `substituteParamRefs`.
- `src/index.ts` — exports.
- `packages/api-client/src/{types,ipc-client}.ts` — section `parameters`.

**Main (desktop)**
- `services/parameters.service.ts` (nouveau) — `read`, `list` (tous les compteurs d'utilisation en un seul parcours), `usages`, `create`, `update`, `delete`. Écritures sérialisées par repo avec clés triées. Validation du nom, refus sur un repo readonly, refus de suppression si un élément non terminal utilise le paramètre. Marquage T172 des utilisateurs approuvés non terminaux (`includeSelf`) à la création et quand `value`/`unit` change.
- `services/revalidation.service.ts` — option `includeSelf` de `markImpactedBy` ; méthode publique `readonlyRepoPaths(repoPath, workspaceDir)`.
- `container.ts` — `ParametersService` injecté ; `ipc/index.ts` — canaux `parameters:list|usages|create|update|delete` et `Container.parameters`.

**Renderer**
- `routes/parameters.tsx` (nouveau) ; `routeTree.gen.ts` régénéré avec le générateur TanStack et la même configuration que le plugin Vite (ajouts uniquement).
- `components/parameters/ParametersView.tsx` (nouveau) — tableau par repo, recherche, compteurs, « Nouveau paramètre » masqué sur un repo readonly.
- `components/parameters/ParameterEditDialog.tsx` (nouveau) — création et édition, « Utilisé par » (liens vers `/req/$reqId` et `/test/$testId`, éléments terminaux grisés), confirmation listant les éléments approuvés, refus de suppression avec la liste des éléments. Exporte `UsageList` (réutilisé au sprint 2).
- `components/sidebar/ParametersPanel.tsx` (nouveau) — liste des repos, qui filtre la vue.
- `layout/AppLayout.tsx` (`Panel`, `deducePanel`, `handleSelectPanel`), `layout/ActivityBar.tsx` (icône `Variable`), `layout/Sidebar.tsx`, `contexts/TabsContext.tsx` (libellé d'onglet).
- `i18n/locales/{fr,en}.json` — `parameters.*`, `layout.activityBar.parameters`.

## Comportement implémenté

- **Base** : un fichier `parameters/parameters.yaml` par repo. Si le fichier est absent, la base
  est vide ; la première création crée le fichier. La valeur est toujours une chaîne, et une
  valeur numérique écrite à la main est lue comme une chaîne. `unit` et `description` sont omis
  quand ils sont vides.
- **Utilisations** : on parcourt les exigences et les tests de tous les repos du workspace.
  - Champs lus côté exigence : les champs `text`, `textarea` et `richtext` du type, ou tous les
    champs si le type n'est pas résolvable.
  - Champs lus côté test : preconditions, action et résultat attendu de chaque étape,
    postconditions. Les `notes` ne sont pas lues.
  - `{nom}` vise la base du repo de l'élément. `{<montage>::nom}` vise un composant déclaré dans
    le `polenta-repo.yaml` du repo de l'élément et monté dans le workspace.
- **Marquage** : à la création d'un paramètre, ou quand sa `value` ou son `unit` change, chaque
  élément approuvé et non terminal qui l'utilise est marqué, ainsi que ses éléments liés (T172).
  Un changement de description seule ne marque rien.

## Divergences par rapport au design

1. **Composants visibles** : le design parlait de nœuds `schema.nodes` portant une `url`. Or
   `SystemNode` n'a pas de champ `url` dans le modèle réel : les composants en repo séparé sont
   déclarés dans `polenta-repo.yaml` (dépendances, nom de montage). C'est donc ce manifeste
   qu'on utilise, avec la même convention de nom que les `objectTypeRef` inter-composants.
2. **Readonly** : c'est la même règle que T172, un repo monté sous un nœud `readonly` du schéma
   ouvert, rapproché par le nom. Dans le modèle workspace actuel, un repo composant n'est donc
   readonly que si le schéma ouvert déclare un nœud `readonly` du même nom. Aucun autre mécanisme
   readonly n'existe au niveau d'un repo.
3. `paramRefRegExp()` (fabrique) remplace une constante `PARAM_REF_RE` : une RegExp `g`
   partagée garde son `lastIndex` entre deux appels.
4. `RevalidationService` n'est pas ajouté à `Container`, faute d'appelant IPC.
   `renderer/lib/testParams.ts` n'est pas encore branché sur la nouvelle grammaire : c'est prévu
   au sprint 3, pour ne rien changer au comportement T97 avant la résolution en campagne.
5. **Nombre d'utilisations** : il est calculé dans `list` (champ `usageCounts`) plutôt que par un
   appel par ligne, pour éviter N parcours complets.

## Vérifications

- `tsc --noEmit` : 0 erreur sur `apps/desktop`, `apps/api` et `apps/web`.
- Script de service (tsx, repos git temporaires : produit + composant `motor-control`), 25/25 OK.
  Scénarios couverts : S1.1, S1.3–S1.5, S1.7, S1.9–S1.15, les compteurs, les références
  inter-composants et un nom `constructor`.
  - S1.7 : SYS-1, TSYS-1 et SW-9 (lié) sont marqués, les statuts restent inchangés et
    `links.yaml` n'est pas modifié.
- `/code-review` : 2 bugs trouvés, tous deux corrigés.
  1. Un nom de paramètre valide comme `constructor` rencontrait `Object.prototype`. On utilise
     désormais des dictionnaires sans prototype. Un test de régression a été ajouté.
  2. « Enregistrer » pouvait contourner la confirmation tant que la liste « Utilisé par » était
     en cours de chargement. Le bouton est maintenant désactivé pendant ce chargement.
- **App lancée** (build electron-vite + driver Playwright, projet jetable) : l'entrée
  « Paramètres » de la barre d'activité, le panneau et la vue s'affichent. La création de
  `puissance_turbo = 450 W` par la fenêtre d'édition écrit `parameters/parameters.yaml`
  correctement, la ligne apparaît avec son compteur, et « Publier » s'active.
- **Non vérifié dans l'app** : la confirmation et le marquage depuis l'UI (vérifiés côté
  service), le refus de suppression, un repo readonly, et « Utilisé par » avec des éléments
  réels.

## Tester manuellement

1. Barre d'activité → « Paramètres » (icône `(x)`). Créer `puissance_turbo` = 450, unité W.
2. Dans une exigence approuvée, écrire `{puissance_turbo}` dans l'énoncé. L'affichage de la
   valeur arrive au sprint 2 ; pour éditer, repasser l'exigence en brouillon puis la réapprouver.
3. Revenir dans Paramètres : le compteur vaut 1. Ouvrir le paramètre : « Utilisé par » liste
   l'exigence, et le lien l'ouvre.
4. Changer la valeur à 400 → une confirmation liste l'exigence → confirmer. L'exigence et ses
   éléments liés affichent ⚠ « Impact à vérifier » ; le statut reste Approuvé.
5. Changer seulement la description → pas de confirmation, pas de marquage.
6. Supprimer le paramètre → refus avec la liste des éléments. Retirer la référence, réessayer →
   la suppression passe.
