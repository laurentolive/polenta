# T171 — Sprint 3 (dernier) : résolution des paramètres en campagne

Réf. : `specs/T171.md` §6, §7, §10 (campagnes), §11 ; `specs/T171-design.md` §5 ;
`specs/T171-tests.md` (Sprint 3). Travail sur `main`.

## Fichiers modifiés

**Types partagés**
- `packages/types/src/campaign.ts` — `CampaignTestRun` reçoit trois nouveaux champs :
  `resolvedParams`, `paramSourceRef` et `unresolvedParams`. Nouveaux types
  `UnresolvedParam` / `UnresolvedParamReason` et `ParamResolutionPreview`.
- `packages/api-client` — le paramètre `workspaceDir?` est ajouté à `create`, `addTests` et
  `duplicateTest` ; nouvelle méthode `previewParams`.

**Main**
- `services/git.service.ts` — `readYamlAtTag(repoPath, tag, path)` renvoie `{ tagFound, data }`
  et déréférence les tags annotés.
- `services/parameters.service.ts`
  - `readAtTag` : lecture de la base à un tag.
  - `previewForTests(campaignRepo, tests, { baselineRef, workspaceDir })` classe chaque
    référence en résolue, à saisir ou non résolue, avec une raison.
  - Le repo du test est déduit de son `objectTypeRef`. Les composants visibles sont ceux de son
    `polenta-repo.yaml`. Avec une baseline, la base est lue au tag, sans repli sur l'état courant.
  - La lecture du fichier est factorisée dans `parseParametersFile`.
- `services/campaigns.service.ts`
  - Reçoit `ParametersService` en injection optionnelle ; sans lui (MCP), le comportement T97 est
    inchangé.
  - `create`, `addTests` et `duplicateTest` résolvent et figent les paramètres dans
    `buildNewRuns`.
  - Nouvelle méthode `previewParams`.
- `container.ts` construit `ParametersService` avant `CampaignsService`. `ipc/index.ts` ajoute
  `workspaceDir` aux canaux de campagne et crée `campaigns:preview-params`.

**Renderer**
- `lib/testParams.ts` (réécrit)
  - `runParamLookup` et `substituteRunParams` : `resolvedParams` d'abord, puis `paramValues`.
  - `substituteTestParams`, `manualKeysForRun`, `isT171Run`.
  - `isParamsComplete` ne porte plus que sur les références à saisir.
  - Les instances antérieures à T171 gardent la substitution T97, code compris.
- `components/TestParamFields.tsx` — reçoit la liste `labels` des références à saisir, les
  valeurs `resolved` (affichées en lecture seule) et les références `unresolved` avec leur raison.
- `hooks/useParamPreview.ts` (nouveau) — prévisualisation, relue à chaque ouverture.
- `routes/campaign.$campaignId.tsx`
  - Le panneau d'ajout, la complétude, la règle d'instance unique et « Dupliquer » s'appuient
    désormais sur la prévisualisation.
  - L'édition des valeurs utilise `manualKeysForRun`.
  - Chaque instance ayant des références non résolues porte un indicateur ⚠, et un bandeau
    persistant les récapitule.
  - `workspaceDir` est transmis aux appels.
- `routes/campaign.new.tsx` — prévisualisation au `baselineRef` saisi, même affichage, création
  avec `workspaceDir`.
- `components/UnresolvedParamsBanner.tsx` et `components/RunParamsInfo.tsx` (nouveaux) : bandeau
  des références non résolues, et source de lecture (tag ou état courant).
- `contexts/ParamRefContext.tsx` — `FrozenParamRefProvider` : valeurs figées d'une instance, avec
  l'origine au survol (base ou saisie), sans édition.
- `components/RichTextViewer.tsx` — décoration des références en lecture seule.
- `routes/campaign.$campaignId_.execute.$testId.tsx` et `…run.$testId.tsx` — valeurs figées
  stylées, en-tête indiquant la source, bandeau.
- `lib/campaignTests.ts` — `resolveCampaignRuns` substitue les valeurs figées. Cela couvre les
  exports de campagne xlsx et docx, et le PDF du plan et du rapport.
- i18n : `campaignParams.*`.

## Divergences par rapport au design

1. **Critère 5 reformulé** (validé au design) : les campagnes ne contiennent que les tests de
   leur propre repo. La résolution utilise le repo du test, donc elle couvrira les campagnes
   inter-repos si elles apparaissent.
2. **Pas de toast** : l'application n'a pas de système de notification. La notification « après
   l'ajout » est un bandeau persistant dans la page campagne, qui fait aussi office d'indicateur.
3. **Références à saisir sans valeur** (trouvé par `/code-review`) : le serveur les conserve,
   vides, dans `paramValues`. Sinon, avec une prévisualisation périmée, elles disparaissaient
   sans être signalées. De plus, la prévisualisation est relue à l'ouverture du panneau d'ajout
   et après chaque écriture de paramètre.
4. **Instances antérieures à T171** (trouvé par `/code-review`) : elles gardent la substitution
   T97 partout, y compris dans le code Markdown, à l'écran comme dans les exports. Le masquage du
   code ne s'applique qu'aux instances T171.
5. **« Specs d'export »** : il n'existe pas de fichier SPEC dédié aux exports. Les règles
   d'export sont documentées dans SPEC-REQ §3.2f et SPEC-TESTS §4.4.
6. **Écart antérieur à T171, non traité** : ouvert depuis le panneau Campagnes, le formulaire de
   création filtre les tests sur le *type de campagne* (`level`) et n'en propose donc aucun. Les
   tests ont été vérifiés via « Ajouter des tests » de la page campagne.

## Vérifications

- `tsc --noEmit` : 0 erreur sur `apps/desktop`, `apps/api` et `apps/web`.
- Script de service campagnes (tsx, repos git temporaires, produit + composant, tag léger et
  tag annoté) : 22/22. Couvre S3.1, S3.2, S3.4 à S3.9, S3.11 à S3.13, la prévisualisation depuis
  une campagne, `duplicateTest`, et la régression de la revue (saisie vide conservée).
- Script du sprint 1 : 25/25, sans régression.
- **App lancée** (projet jetable ; tag `baseline/v1.0` à 450 W, puis base passée à 400 W) :
  - **Baseline invalide** : le panneau d'ajout affiche « baseline introuvable » pour
    `{numero_serie}` et `{puissance_turbo}`, et « composant inconnu » pour
    `{tolerance_absente::x}`. L'ajout est autorisé ; ensuite apparaissent le bandeau
    « 1 instance a des références… » et l'indicateur « 3 références non résolues ». (S3.5)
  - **Baseline valide** : le bouton « Ajouter » est désactivé tant que `numero_serie` est vide,
    puis l'ajout passe. Le fichier contient `resolvedParams: puissance_turbo: 450 W` (et non
    400), `paramValues: numero_serie: SN-42`, `paramSourceRef: baseline/v1.0` et `unresolvedParams`
    avec `unknown_node`. (S3.4, S3.9)
  - **Exécution** : « Paramètres lus à la baseline baseline/v1.0 », bandeau, « Banc n° SN-42 »
    et « Puissance >= 450 W » stylés, `{tolerance_absente::x}` barré.
- `/code-review` : 2 remarques, toutes deux corrigées (divergences 3 et 4).
- **Non vérifié dans l'app** : la page de relecture d'un run exécuté, « Dupliquer », le contenu
  des fichiers exportés, une campagne T97 existante (S3.11 couvert seulement côté service).

## Mises à jour SPEC

| Section | Modification |
|---------|--------------|
| `SPEC-TESTS.md §2.4a` | Syntaxe unifiée avec la base ; trois cas (résolue / à saisir / non résolue) ; affichage de la valeur courante sur la fiche |
| `SPEC-TESTS.md §4.2` | Champs `resolvedParams`, `paramSourceRef`, `unresolvedParams` ; résolution à l'ajout (tag, sans repli), prévisualisation, bandeau et indicateur ; règle d'instance unique sur les références à saisir |
| `SPEC-TESTS.md §4.4` | Substitution depuis les valeurs figées, source et bandeau, compatibilité T97, exports de campagne |
| `SPEC-REQ-requirements.md §3.2f` (nouveau) | Base de paramètres, références, affichage, insertion, vue Paramètres, exports |
| `SPEC-REQ-requirements.md §5.3` | Second déclencheur : modification d'un paramètre (`includeSelf`) |
| `SPEC-FORKS-BRANCHES-BASELINES.md §5.3` | Paramètres lus au tag de baseline dans chaque repo |
| `SPEC-TRACEABILITY.md §3+` | `readYamlAtTag` |
| `SPEC-ELECTRON-DESKTOP.md §19.2 / §19.3 / §19.14` | Entrée « Paramètres », route `/parameters`, canaux `parameters:*` et `campaigns:preview-params` |
| `SPEC-INDEX.md` | MAJ → T171 pour les lignes ci-dessus ; nouvelle ligne SPEC-REQ §3.2f |
| `CLAUDE.md` | Structure (`parameters/parameters.yaml`) ; règle de cohérence 11 |

## Tester manuellement

1. Dans Paramètres, créer `puissance_turbo` = 450 W. Créer un tag `baseline/v1.0`, puis passer
   la valeur à 400.
2. Un test approuvé contient `{puissance_turbo}` et `{numero_serie}` dans ses étapes.
3. Campagne sans baseline → « Ajouter des tests » : `{puissance_turbo}` s'affiche « 400 W » en
   lecture seule et seul `numero_serie` est demandé. Après l'ajout, passer le paramètre à 380 :
   la campagne garde 400 W.
4. Campagne avec `baselineRef: baseline/v1.0` : 450 W, et l'exécution indique la baseline.
5. Campagne avec un `baselineRef` inexistant : l'ajout est autorisé, les références sont
   signalées (panneau, bandeau, ⚠) et affichées barrées à l'exécution.
6. Un test dont toutes les références sont dans la base : il n'est pas proposé une seconde fois,
   et le bouton « Dupliquer » n'apparaît pas.
7. Exports plan / rapport : valeurs figées, y compris `numero_serie`.
