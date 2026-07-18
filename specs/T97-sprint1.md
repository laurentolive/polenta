# T97 — Sprint 1 (unique)

Périmètre complet du ticket codé en un seul sprint (cf. `T97-design.md` §8).

## Fichiers modifiés

**Types** (`packages/types/src/campaign.ts`) :
- `CampaignTestRun` gagne `paramValues?: Record<string, string>`.
- `CreateCampaignDto` gagne `paramValuesByTest?: Record<string, Record<string, string>>`.

**Backend** (`apps/desktop/src/main/services/campaigns.service.ts`) :
- `create()` attache `paramValues` à chaque run initial si fourni dans `dto.paramValuesByTest`.
- `addTests()` prend un 4ᵉ paramètre `paramValuesByTest` optionnel, même logique.
- Nouvelle méthode `updateRunParams(repoPath, campaignId, testCaseId, paramValues)` — édition des
  valeurs après ajout, sans garde de statut (cohérent avec `updateRun()`).

**IPC** (`apps/desktop/src/main/ipc/index.ts`) : `campaigns:add-tests` transmet le 4ᵉ argument ;
nouveau handler `campaigns:update-run-params`.

**Contrat api-client** (`packages/api-client/src/types.ts`, `ipc-client.ts`) : signatures mises à
jour en conséquence.

**Nouveau module utilitaire pur** (`apps/desktop/src/renderer/lib/testParams.ts`) :
- `extractTestParameters(testCase)` — scan `preconditions`/`postconditions`/`action`/`expectedResult`
  des étapes (triées par `order`), labels uniques dans l'ordre de première apparition.
- `substituteParams(text, values)` — remplace chaque `{label}` par sa valeur ; un label sans valeur
  (ou avec une valeur vide) reste affiché littéralement.
- `isParamsComplete(selectedIds, testMap, paramValues)` — vrai si chaque paramètre détecté de
  chaque test sélectionné a une valeur non vide.

**Nouveau composant** (`apps/desktop/src/renderer/components/TestParamFields.tsx`) : formulaire de
saisie des valeurs, un champ par paramètre détecté, rendu conditionnel (rien si aucun paramètre).

**Routes modifiées :**
- `campaign.$campaignId.tsx` : panneau "+ Ajouter des tests" affiche `TestParamFields` sous chaque
  test coché ayant des paramètres, bouton "Ajouter" bloqué tant qu'une valeur manque ; liste des
  tests de la campagne gagne une icône crayon (par test avec paramètres) ouvrant un panneau
  d'édition inline des valeurs déjà saisies, bouton "Enregistrer" bloqué tant qu'une valeur requise
  est vide.
- `campaign.new.tsx` : même formulaire sous chaque test coché dans la sélection initiale ; validation
  et désactivation du bouton "Créer la campagne" basées sur `allTests` (pas la liste filtrée
  composant/niveau), pour couvrir aussi les tests préremplis via "Générer une campagne" (T46).
- `campaign.$campaignId.execute.$testId.tsx` : preconditions/steps/postconditions rendus via
  `RichTextViewer` (au lieu d'un `dangerouslySetInnerHTML` brut) avec substitution des paramètres
  appliquée avant rendu — voir "Divergences" ci-dessous.
- `campaign.$campaignId.run.$testId.tsx` : même substitution appliquée aux `RichTextViewer` déjà en
  place (preconditions, action, expectedResult, postconditions).

## Comportement implémenté

Conforme à `specs/T97.md` : détection automatique des paramètres `{label}` (pas de déclaration
séparée), saisie obligatoire à l'ajout d'un test en campagne (nouvelle campagne ou ajout à une
campagne existante), substitution à l'exécution et à la relecture d'un run, édition des valeurs
après ajout.

## Divergences par rapport au design

Le design (`T97-design.md` §6) prévoyait d'HTML-échapper la valeur substituée puis de l'injecter
telle quelle dans les deux pages (`dangerouslySetInnerHTML` pour l'exécution, `RichTextViewer` pour
la relecture). La revue de code (`/code-review high`) a mis en évidence que ces deux pages ne sont
**pas** des sinks équivalents : `RichTextViewer`/`RichTextField` utilisent `tiptap-markdown` avec
`Markdown.configure({ html: false })` — le contenu persisté par `RichTextField.onUpdate`
(`editor.storage.markdown.getMarkdown()`) est du **Markdown**, pas du HTML, et `RichTextViewer` le
reparse comme tel à l'affichage (confirmé en lisant `node_modules/tiptap-markdown` :
`onBeforeCreate` appelle `parser.parse()` sur le contenu initial). Un HTML-échappement manuel de la
valeur substituée, correct pour un `dangerouslySetInnerHTML` brut, produit un double-échappement
visible (`&` devient littéralement `&amp;` à l'écran) une fois passé dans ce pipeline Markdown, et
un texte substitué contenant de la syntaxe Markdown (ex. `*24V*`) s'affichait différemment selon la
page (texte brut à l'exécution, mise en forme à la relecture).

**Correctif appliqué** : la page d'exécution rend désormais preconditions/steps/postconditions via
`RichTextViewer` (comme la page de relecture), et `substituteParams` n'échappe plus rien
manuellement — `markdown-it` avec `html: false` neutralise déjà tout caractère spécial d'une valeur
substituée lors du rendu, ce qui rend l'échappement manuel à la fois inutile et incorrect (double
échappement). Les deux pages affichent maintenant un contenu identique pour un même run. Ce
correctif a aussi révélé et corrigé un point : l'exécution utilisait un rendu HTML brut a priori
déjà incohérent avec le stockage Markdown de ces champs (indépendant des paramètres) —
`RichTextViewer` uniformise ce rendu au passage, sans changer le comportement fonctionnel
d'exécution (saisie des résultats, etc.).

Autres écarts, tous identifiés en revue de code et corrigés avant ce commit :
- `TestStep.notes` retiré du scan de détection des paramètres : ce champ n'est affiché nulle part
  dans le contexte d'une campagne (ni exécution ni relecture), donc un paramètre qui n'y
  apparaîtrait que là serait une saisie obligatoire sans aucun effet visible.
- Le bouton "Enregistrer" du panneau d'édition des valeurs (test déjà ajouté) n'avait initialement
  aucune garde de complétude, contrairement au bouton "Ajouter" — un utilisateur pouvait vider un
  champ et l'enregistrer, substituant silencieusement une chaîne vide. Garde ajoutée
  (`extractTestParameters(tc).some(label => !editParamValues[label]?.trim())`).
- `campaign.new.tsx` validait la complétude des paramètres contre la liste de tests **filtrée**
  (composant/niveau) plutôt que la liste complète — un test préaffecté via l'URL de préremplissage
  T46 mais situé hors du filtre courant pouvait échapper à la validation. Corrigé en validant contre
  `allTests`.
- Bouton "Créer la campagne" non désactivé de façon proactive pour paramètres incomplets
  (uniquement bloqué via message d'erreur au submit) — aligné sur le comportement du bouton
  "Ajouter" de `campaign.$campaignId.tsx`.

Aucune divergence sur le reste du périmètre (stockage `paramValues`, détection, formulaire de
saisie, dédoublonnage `addTests`, indépendance de T49).

## Mises à jour SPEC effectuées

- `SPEC-TESTS.md` §2.4a (nouvelle section) — notion de paramètre `{label}`, portée du scan,
  absence de déclaration séparée.
- `SPEC-TESTS.md` §4.2 — `CampaignTestRun.paramValues` documenté.
- `SPEC-TESTS.md` §4.4 (nouvelle section) — règles de substitution à l'exécution/relecture, cas
  limites (paramètre apparu/disparu depuis l'ajout), note sur l'absence d'échappement manuel
  (contenu Markdown, `html: false`).
- `SPEC-TESTS.md` §7 — ligne ajoutée au tableau des décisions arrêtées.
- `SPEC-INDEX.md` — colonne `MAJ` → `T97` pour les lignes `SPEC-TESTS.md §2–3` et `§4.1–4.2`,
  `§4+` étendu pour couvrir la substitution ; mots-clés `paramètre`/`placeholder`/`paramValues`
  ajoutés.

Note : `SPEC-TESTS.md`/`SPEC-INDEX.md` de la branche T97 ont été resynchronisés sur le contenu
(alors non commité) de `C:\Dev\polenta` avant d'y appliquer les ajouts ci-dessus — le commit ac2bf00
dont la branche T97 est issue portait une version plus ancienne de `SPEC-TESTS.md` (modèle
`TestCampaign`/`CampaignRun` séparés, antérieur à la décision T66) que la version alors en cours
d'édition, non commise, dans le dossier principal. Confirmé avec l'utilisateur avant application.

## Comment tester manuellement

Suivre les scénarios de `specs/T97-tests.md` (T97-01 à T97-15). Points clés :
1. Créer/éditer un test avec `{voltage}` dans une étape.
2. L'ajouter à une campagne (existante ou nouvelle) — un champ de saisie "voltage" doit apparaître
   et bloquer la confirmation tant qu'il est vide.
3. Exécuter le test dans cette campagne — `{voltage}` doit être remplacé par la valeur saisie,
   identique en exécution et en relecture (page "Voir").
4. Tester une valeur contenant `<`/`>`/`&` — doit s'afficher tel quel, sans être interprété.
5. Éditer la valeur depuis la liste des tests de la campagne (icône crayon) — la nouvelle valeur
   doit être reprise à l'exécution.

Non testé interactivement dans cette session (pas d'Electron attachable) — `pnpm typecheck` passe
sans erreur nouvelle sur `@polenta/desktop` et `@polenta/api-client` (l'échec de `@polenta/api` est
préexistant, sans rapport avec ce ticket — `Property 'url' does not exist on type 'SystemNode'`
dans `schema.service.ts`, confirmé avant de commencer). Revue de code `/code-review high` menée
(8 angles), 9 findings confirmés, tous corrigés avant ce commit. Attend validation manuelle humaine
avant archivage/merge.
