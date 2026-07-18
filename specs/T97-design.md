# T97 — Design technique

Basé sur `specs/T97.md`. Sprint 1 (périmètre initial) + sprint 2 (§9, instances multiples,
ajouté après retour utilisateur — voir `T97.md` §Addendum sprint 2).

---

## 1. Vue d'ensemble des changements

Aucune nouvelle route, aucun nouveau composant Tiptap. Le tout tient dans :
- 2 nouveaux champs optionnels sur des types existants (`packages/types/src/campaign.ts`),
- un petit module utilitaire pur côté renderer (détection + substitution, aucune dépendance
  React/Tiptap),
- 2 flux d'ajout de test (déjà existants) qui gagnent un formulaire inline conditionnel,
- 2 pages d'affichage de test dans une campagne qui substituent le texte avant rendu.

---

## 2. Types (`packages/types/src/campaign.ts`)

```ts
export interface CampaignTestRun {
  testCaseId: string
  status: TestRunStatus
  runId?: string
  executedAt?: string
  executedBy?: string
  paramValues?: Record<string, string>   // NEW — label → valeur, absent si le test n'a pas de paramètre
}

export interface CreateCampaignDto {
  title: string
  objectTypeRef?: string
  fields?: Record<string, unknown>
  baselineRef?: string
  component?: string
  level?: string
  testCaseIds: string[]
  paramValuesByTest?: Record<string, Record<string, string>>   // NEW — testCaseId → (label → valeur)
}
```

**Pourquoi un champ `paramValuesByTest` séparé plutôt que remplacer `testCaseIds: string[]` par
une liste d'objets `{testCaseId, paramValues}`** : `testCaseIds` est déjà lu tel quel par
`impact-analysis.tsx` (préremplissage URL, T46), `SystemPanel.tsx`, `CampaignListView.tsx`
(affichage `TestCampaign.testCaseIds`, type inchangé — c'est la liste de sortie, pas une DTO
d'entrée). Changer sa forme aurait un impact large pour un gain nul ; un champ additionnel optionnel
est cohérent avec le style déjà utilisé dans la codebase pour étendre une DTO (`preferences`,
`component`/`level`).

`addTests()` gagne le même principe en 4ᵉ paramètre plutôt qu'en changeant `testCaseIds: string[]`
en tableau d'objets — même raisonnement, et c'est le seul point d'appel de cette méthode.

---

## 3. Backend

### 3.1 `apps/desktop/src/main/services/campaigns.service.ts`

**`create()`** (L38-61) — dans le `.map()` qui construit `runs`, ajouter la valeur si présente :
```ts
runs: (dto.testCaseIds ?? []).map(tcId => ({
  testCaseId: tcId,
  status: 'pending' as TestRunStatus,
  ...(dto.paramValuesByTest?.[tcId] ? { paramValues: dto.paramValuesByTest[tcId] } : {}),
})),
```

**`addTests()`** (L126-155) — nouvelle signature :
```ts
async addTests(
  repoPath: string,
  campaignId: string,
  testCaseIds: string[],
  paramValuesByTest?: Record<string, Record<string, string>>,
): Promise<TestCampaign>
```
Dans la construction de `newIds.map(...)`, même ajout conditionnel de `paramValues` que
ci-dessus. Aucun autre changement (dédoublonnage par `existingIds` inchangé — un test déjà
présent reste silencieusement ignoré, y compris ses éventuelles valeurs, comportement actuel
préservé).

**Nouvelle méthode `updateRunParams()`** (édition après ajout, cf. §5.3) :
```ts
async updateRunParams(
  repoPath: string,
  campaignId: string,
  testCaseId: string,
  paramValues: Record<string, string>,
): Promise<TestCampaign> {
  const campaign = await this.get(repoPath, campaignId)
  const runIndex = campaign.runs.findIndex(r => r.testCaseId === testCaseId)
  if (runIndex === -1) throw new Error(`Test ${testCaseId} not found in campaign ${campaignId}`)
  campaign.runs[runIndex] = { ...campaign.runs[runIndex], paramValues }
  await this.gitService.writeYaml(repoPath, `campaigns/${campaignId}.yaml`, campaign)
  return campaign
}
```
Pas de garde sur le statut de la campagne (`completed`/`abandoned`) — contrairement à
`addTests()`, corriger une valeur sur un test déjà exécuté reste utile après clôture (erreur
constatée a posteriori) ; cohérent avec le fait que `updateRun()` lui-même n'a pas cette garde
non plus.

### 3.2 IPC (`apps/desktop/src/main/ipc/index.ts`, L327-329)

```ts
ipcMain.handle('campaigns:add-tests',
  (_e, repoPath: string, campaignId: string, testCaseIds: string[], paramValuesByTest?: Record<string, Record<string, string>>) =>
    c.campaigns.addTests(repoPath, campaignId, testCaseIds, paramValuesByTest))
ipcMain.handle('campaigns:update-run-params',
  (_e, repoPath: string, campaignId: string, testCaseId: string, paramValues: Record<string, string>) =>
    c.campaigns.updateRunParams(repoPath, campaignId, testCaseId, paramValues))
```
`campaigns:create` (L317-318) ne change pas — `dto` est déjà transmis tel quel.

### 3.3 `packages/api-client/src/types.ts` (L417) et `ipc-client.ts` (L174)

```ts
// types.ts
addTests(repoPath: string, campaignId: string, testCaseIds: string[], paramValuesByTest?: Record<string, Record<string, string>>): Promise<TestCampaign>
updateRunParams(repoPath: string, campaignId: string, testCaseId: string, paramValues: Record<string, string>): Promise<TestCampaign>

// ipc-client.ts
addTests: (p, campaignId, testCaseIds, paramValuesByTest) =>
  invoke('campaigns:add-tests', p, campaignId, testCaseIds, paramValuesByTest),
updateRunParams: (p, campaignId, testCaseId, paramValues) =>
  invoke('campaigns:update-run-params', p, campaignId, testCaseId, paramValues),
```
Pas de changement côté `preload/index.ts` (pont générique `invoke(channel, ...args)`, déjà
vérifié — pas de liste d'arguments à maintenir là).

---

## 4. Module utilitaire partagé — `apps/desktop/src/renderer/lib/testParams.ts` (nouveau fichier)

Fonctions pures, aucune dépendance React/Tiptap — testables isolément.

```ts
import type { TestCase } from '@polenta/types'

const PARAM_RE = /\{([A-Za-z0-9_-]+)\}/g

/** Labels uniques, dans l'ordre de première apparition :
 *  preconditions → steps (action, expectedResult, notes, dans cet ordre par étape,
 *  étapes triées par `order`) → postconditions. */
export function extractTestParameters(testCase: Pick<TestCase, 'preconditions' | 'postconditions' | 'steps'>): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  const scan = (text: string | null | undefined) => {
    if (!text) return
    for (const m of text.matchAll(PARAM_RE)) {
      const label = m[1]
      if (!seen.has(label)) { seen.add(label); ordered.push(label) }
    }
  }
  scan(testCase.preconditions)
  for (const step of [...testCase.steps].sort((a, b) => a.order - b.order)) {
    scan(step.action)
    scan(step.expectedResult)
    scan(step.notes)
  }
  scan(testCase.postconditions)
  return ordered
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Remplace chaque {label} par sa valeur (échappée HTML). Un label sans valeur connue
 *  est laissé tel quel (littéral) — cf. T97.md "Cas limite : test modifié après ajout". */
export function substituteParams(html: string, values: Record<string, string> | undefined): string {
  if (!values || Object.keys(values).length === 0) return html
  return html.replace(PARAM_RE, (match, label: string) =>
    label in values ? escapeHtml(values[label]) : match,
  )
}
```

**Regex** : identique à celle documentée dans `T97.md` §"Détection des paramètres" — labels
alphanumériques + `_`/`-`, pas d'espace, pas d'imbrication. Le scan se fait sur le HTML brut
(les balises ne contiennent jamais `{`/`}` dans le contenu généré par Tiptap/notre sérialiseur
Markdown — pas de risque de faux positif dans un attribut).

**Sécurité** : `substituteParams` échappe systématiquement la valeur insérée — c'est la seule
fonction qui écrit dans du HTML consommé ensuite par `dangerouslySetInnerHTML`/`RichTextViewer`.
Aucun autre point du code ne doit faire cette substitution autrement (pas d'interpolation
manuelle dans les composants de page).

---

## 5. Frontend — saisie des valeurs

### 5.1 Nouveau composant `apps/desktop/src/renderer/components/TestParamFields.tsx`

Utilisé par les deux flux d'ajout (§5.2) pour éviter la duplication de JSX.

```tsx
interface Props {
  testCase: TestCase
  values: Record<string, string>
  onChange: (label: string, value: string) => void
}

export function TestParamFields({ testCase, values, onChange }: Props) {
  const params = extractTestParameters(testCase)
  if (params.length === 0) return null
  return (
    <div className="pl-6 pb-2 space-y-1.5 border-l-2 border-edge ml-2">
      {params.map(label => (
        <label key={label} className="flex items-center gap-2 text-xs">
          <span className="font-mono text-ink-3 shrink-0 w-24 truncate" title={label}>{'{' + label + '}'}</span>
          <input
            type="text"
            value={values[label] ?? ''}
            onChange={e => onChange(label, e.target.value)}
            className="input-field flex-1 text-xs py-1"
            placeholder="Valeur…"
          />
        </label>
      ))}
    </div>
  )
}
```

Une fonction locale à chaque route, `isParamsComplete(selectedIds, testMap, paramValues)`,
vérifie que chaque paramètre détecté de chaque test sélectionné a une valeur non vide (trim) —
utilisée pour désactiver le bouton de confirmation.

### 5.2 `campaign.$campaignId.tsx` — panneau "+ Ajouter des tests" (L333-403)

- Nouvel état : `const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({})`.
- Sous chaque `<label>` de test coché (L374-386), si `extractTestParameters(t).length > 0`,
  rendre `<TestParamFields testCase={t} values={paramValues[t.id] ?? {}} onChange={(label, v) => setParamValues(prev => ({ ...prev, [t.id]: { ...(prev[t.id] ?? {}), [label]: v } }))} />` sous la ligne de checkbox correspondante.
- `handleConfirmAdd()` (L172-175) : bloqué si `!isParamsComplete(...)` ; appelle
  `addTestsMutation.mutate({ ids: [...selectedToAdd], paramValues })` (mutation adaptée pour
  prendre les deux).
- `addTestsMutation` (L103-113) : `mutationFn: ({ ids, paramValues }) => api.campaigns.addTests(repoPath, campaignId, ids, paramValues)`.
- Réinitialiser `paramValues` avec `selectedToAdd`/`testFilter` à l'annulation et au succès
  (L109-112, L352).
- Bouton "Ajouter" (L390-397) : `disabled` gagne la condition `|| !isParamsComplete(...)`.

### 5.3 Édition après ajout — liste des tests de la campagne (L282-330)

Sur chaque ligne de test déjà dans la campagne (L286-328), si
`extractTestParameters(tc).length > 0` (tc résolu via `testMap.get(tcId)`) : petite icône crayon
(`Pencil`, déjà importé L4) à côté du badge de statut, qui bascule un état local
`editingParamsFor: string | null` (id du test en édition). En mode édition, la ligne affiche
`<TestParamFields>` pré-rempli avec `campaign.runs.find(r => r.testCaseId === tcId)?.paramValues ?? {}`
et un bouton "Enregistrer" appelant une nouvelle mutation :
```ts
const updateParamsMutation = useMutation({
  mutationFn: ({ testCaseId, paramValues }: { testCaseId: string; paramValues: Record<string, string> }) =>
    api.campaigns.updateRunParams(repoPath, campaignId, testCaseId, paramValues),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['campaign', repoPath, campaignId] })
    setEditingParamsFor(null)
  },
})
```
Visible dans tous les états de campagne (pas seulement `isActive`) — cf. §3.1, corriger une
valeur après clôture reste utile.

### 5.4 `campaign.new.tsx` — sélection initiale de tests (L79-140+)

Même principe que §5.2, appliqué à `selectedTests`/`tests` (L87-92, `toggleTest` L132-139) :
état `paramValues` local, `<TestParamFields>` sous chaque test coché dans la liste de
sélection (partie non lue en détail ici, la liste de checkboxes suit le même pattern que
`campaign.$campaignId.tsx` — à vérifier/adapter en sprint), `createMutation` (L100-110) passe
`paramValuesByTest: paramValues` dans le DTO, bouton de soumission (`handleSubmit`, L124-130)
bloqué par `isParamsComplete` en plus des validations existantes (titre, repoPath).

Préremplissage T46 (`prefillTestCaseIds`, L41-53) : les tests préremplis passent par le même
`selectedTests`, donc le même formulaire de paramètres s'affiche pour eux si applicable — pas
de traitement spécial requis.

---

## 6. Frontend — substitution à l'exécution

### 6.1 `campaign.$campaignId.execute.$testId.tsx`

- Récupérer les valeurs de la campagne :
  ```ts
  const { data: campaign } = useQuery({
    queryKey: ['campaign', repoPath, campaignId],
    queryFn: () => api.campaigns.get(repoPath, campaignId),
    enabled: !!repoPath,
  })
  const paramValues = campaign?.runs.find(r => r.testCaseId === testId)?.paramValues
  ```
  (Cette query est déjà utilisée ailleurs dans l'app avec la même clé — mise en cache
  partagée, pas de requête réseau dupliquée coûteuse.)
- L174, L209, L216, L243 : remplacer `testCase.preconditions` / `step.action` /
  `step.expectedResult` / `testCase.postconditions` dans `dangerouslySetInnerHTML={{ __html: ... }}`
  par `substituteParams(testCase.preconditions, paramValues)` etc.

### 6.2 `campaign.$campaignId.run.$testId.tsx`

- `campaign` est déjà chargé (L53-57, utilisé pour résoudre `runId`). Même extraction :
  `const paramValues = campaign?.runs.find(r => r.testCaseId === testId)?.paramValues`.
- L128, L156, L160, L183 : `<RichTextViewer value={...} .../>` → envelopper la valeur avec
  `substituteParams(tc.preconditions, paramValues)` etc.

### 6.3 Pages hors scope (pas de changement)

- `test.$testId.tsx` (fiche de définition) — aucune valeur n'existe hors contexte de campagne,
  `{label}` reste affiché tel quel (cf. T97.md Hors scope).
- `StepsTable.tsx` — rendu de définition, même raison.

---

## 7. Décisions techniques et alternatives rejetées

| Point | Décision | Alternative rejetée |
|---|---|---|
| Détection des paramètres | Calcul client, à la volée, pas de persistance de la liste | Un endpoint backend dédié `tests:extract-params` — inutile, le contenu du test est déjà chargé côté client partout où c'est nécessaire (`api.tests.list`), pas de logique métier sensible à protéger côté serveur. |
| Forme des DTO d'entrée | Champ additionnel optionnel (`paramValuesByTest`, 4ᵉ argument `addTests`) | Remplacer `testCaseIds: string[]` par une liste d'objets partout — rejeté, impact large sur des lectures non liées à ce ticket (`CampaignListView`, `impact-analysis.tsx`) pour un gain nul. |
| Édition après ajout | Nouvelle méthode dédiée `updateRunParams()` | Réutiliser `update()` (générique, ne touche que `title`/`objectTypeRef`/`fields` de `TestCampaign`, pas `runs[]`) — rejeté, `update()` n'opère pas sur `runs[]`, en changer la portée aurait un effet de bord sur tous ses appelants actuels. |
| Substitution | Fonction pure `substituteParams`, appliquée juste avant le rendu dans les 2 pages concernées | Substitution dans `RichTextViewer`/`RichTextField` eux-mêmes (nouvelle prop `paramValues`) — rejeté, ces composants sont partagés avec les exigences et d'autres types d'objet ; les garder agnostiques de la notion de "paramètre de test" limite le rayon d'impact, cf. Hors scope de T97.md. |
| Sécurité substitution | Échappement HTML systématique de la valeur dans `substituteParams` | Faire confiance à la saisie utilisateur (pas d'échappement) — rejeté, vecteur XSS direct via `dangerouslySetInnerHTML`. |
| Regex des labels | `[A-Za-z0-9_-]+`, pas d'espace | Autoriser les espaces dans le label (`{max current}`) — rejeté en Spec (ambigu avec du texte normal entre accolades, ex. une note contenant littéralement `{à vérifier}`). |

---

## 8. Découpage en sprints

**Un seul sprint.** Périmètre cohérent et de taille modérée (2 champs de type, ~6 fichiers
backend/contrat, 1 nouveau module utilitaire pur, 1 nouveau composant partagé, 4 routes
existantes modifiées). Pas de dépendance externe, pas de migration de données (champs
optionnels, les fichiers `campaigns/*.yaml` existants restent valides sans `paramValues`).

Si le sprint doit être réduit en cours de route, l'ordre de coupe proposé :
1. Garder (cœur fonctionnel) : détection, saisie à l'ajout (§5.2, §5.4), stockage (§2, §3.1,
   §3.2, §3.3), substitution à l'exécution (§6).
2. Coupable en dernier recours, reportable en ticket de suivi si le temps manque : édition
   après ajout (§5.3, `updateRunParams`) — le ticket reste utilisable sans, au prix d'un
   retrait/ré-ajout du test en cas de faute de frappe.

---

## 9. Sprint 2 — instances multiples d'un même test paramétré

### 9.1 Le problème d'identité

`CampaignTestRun` (et par extension `TestCampaign.testCaseIds`) était jusqu'ici indexé
implicitement par `testCaseId` : `campaign.runs.find(r => r.testCaseId === x)` supposait
au plus une entrée par test. Permettre plusieurs instances d'un même test (paramétré)
casse cette hypothèse partout où elle était utilisée : rendu de la liste
(`campaign.testCaseIds.map(tcId => …)`, clé React + lookup de statut), navigation vers
l'exécution/la relecture (route paramétrée par l'ID du test), `updateRun()`/
`updateRunParams()` côté backend.

**Décision** : `CampaignTestRun` gagne un champ `entryId: string`, identifiant unique de
*cette inclusion* du test dans la campagne, généré `${testCaseId}-${n}` (n = position
parmi les instances du même `testCaseId`, dans l'ordre d'ajout). `testCaseId` reste sur
l'entrée mais n'est plus une clé unique au sein de `runs[]`.

### 9.2 Routes : pas de renommage de fichier

Alternative envisagée : renommer les fichiers de route
`campaign.$campaignId.execute.$testId.tsx` → `...$entryId.tsx` (idem `run.$testId.tsx`),
pour que l'URL reflète honnêtement ce qu'elle contient. **Rejetée** : ce projet utilise le
plugin `@tanstack/router-vite-plugin`, qui régénère `routeTree.gen.ts` (fichier généré,
630 lignes, symboles dérivés du nom de fichier) au démarrage de `vite dev`/`vite build` —
aucun serveur de dev n'était disponible dans cette session pour déclencher cette
régénération, et éditer ce fichier généré à la main est fragile (risque de désync avec le
plugin). Le segment d'URL reste donc littéralement nommé `testId`, mais porte désormais un
`entryId` — chaque page renomme la valeur extraite (`const { testId: entryId } =
Route.useParams()`) avec un commentaire expliquant l'écart nom-de-segment / contenu réel.
Compromis documenté, pas un oubli.

### 9.3 Génération de `entryId` et compatibilité ascendante

`CampaignsService` gagne un helper privé `buildNewRuns(existingRuns, newTestCaseIds,
paramValuesByTest)` (remplace la construction inline dans `create()`/`addTests()`),
partagé aussi par la nouvelle méthode `duplicateTest()`.

**`duplicateTest(repoPath, campaignId, testCaseId, paramValues)`** — contrairement à
`addTests()`, ne déduplique **pas** : c'est le point d'entrée dédié à l'ajout d'une
instance supplémentaire d'un test déjà présent. Même garde de statut que `addTests()`
(campagne `completed`/`abandoned` → erreur).

**Compatibilité ascendante** : les fichiers `campaigns/*.yaml` déjà écrits avant ce sprint
n'ont pas de champ `entryId` dans leurs `runs[]`. Plutôt qu'une migration explicite
(script, écriture de masse), `CampaignsService.get()`/`list()` backfillent `entryId` **en
mémoire** à la lecture (`ensureEntryIds()`, même schéma `${testCaseId}-${n}`) sans
réécrire le fichier — le calcul est déterministe et stable d'une lecture à l'autre tant
que l'ordre de `runs[]` ne change pas (il ne change jamais : ajout en fin de tableau
uniquement, jamais de réordonnancement). Trouvé nécessaire en revue de code : sans ce
backfill, toute campagne existante devenait inutilisable (recherches par `entryId` ne
matchant jamais, navigation vers `.../run/undefined`).

### 9.4 UI — action "Dupliquer" + panneau groupé (révisé, voir §9.6)

Une icône (`Copy`, lucide-react) apparaît sur chaque ligne de test **paramétré** de la
liste de la campagne, visible uniquement si la campagne est active (`isActive`, même
garde que le backend `duplicateTest()`). Au clic : formulaire `TestParamFields` inline
(valeurs vierges), bouton "Dupliquer" bloqué tant qu'une valeur manque (même pattern que
l'ajout et l'édition). Mutuellement exclusif avec le panneau d'édition des valeurs de la
même ligne (ouvrir l'un ferme l'autre).

La liste elle-même affiche désormais les valeurs de paramètres de chaque instance en
sous-texte (`{label}=valeur · …`), sous le titre du test — deuxième point du retour
utilisateur, jusque-là uniquement visible via le clic sur l'icône d'édition.

Le panneau groupé "+ Ajouter des tests" permet **aussi** d'ajouter une instance
supplémentaire d'un test paramétré déjà présent (§9.6 — corrigé après un second retour
utilisateur ; la décision initiale ci-dessous a été révisée, conservée pour traçabilité) :

~~**Décision initiale (sprint 2, révisée en §9.6)** : pas de changement au panneau groupé
"+ Ajouter des tests" (sélection `Set<string>`, limitée à une instance par test — la
duplication passe uniquement par "Dupliquer" sur une ligne déjà présente). Alternative
envisagée et rejetée à l'époque : permettre plusieurs instances dès ce panneau (bouton
"+ Ajouter une instance" sous chaque `TestParamFields` coché, `selectedToAdd: Set<string>`
transformé en structure `{testCaseId, paramValues}[]` supportant les doublons) — rejetée
pour limiter le périmètre du sprint.~~

### 9.5 Points trouvés et corrigés en revue de code (`/code-review`, 2 angles)

- Bouton "Dupliquer" non gardé par `isActive` initialement (le backend rejette mais rien
  ne l'empêchait d'apparaître sur une campagne clôturée) — gardé.
- `addTests()` ne dédupliquait pas les doublons **au sein** de son propre tableau d'entrée
  (seulement contre l'existant) — dédup ajoutée (`[...new Set(testCaseIds)]`), défensif,
  aucun chemin UI actuel ne déclenche ce cas (sélection via `Set` déjà unique).
  `duplicateTest()` n'est pas concerné : dupliquer est tout son but.
  Voir aussi §9.3 pour le backfill `entryId` (trouvaille la plus sévère de cette revue).
- Panneaux d'édition et de duplication d'une même ligne pouvaient s'ouvrir simultanément
  (états indépendants) — rendus mutuellement exclusifs.
- `updateRunMutation` (défini dans `campaign.$campaignId.tsx`, jamais appelé) supprimé —
  code mort confirmé, déjà présent avant ce sprint, nettoyé au passage car la ligne était
  déjà touchée par le renommage `testCaseId`→`entryId`.

### 9.6 Correctif — instance supplémentaire depuis le panneau groupé

Retour utilisateur après §9.4 : « dans la liste des tests a ajouter les tests deja
present ne sont pas affiché meme si ils ont des parametres ». La décision §9.4 de limiter
la duplication à l'action "Dupliquer" par ligne (panneau groupé inchangé, filtrant tout
test déjà inclus) ne correspondait pas à l'attente — l'utilisateur veut pouvoir ajouter une
2ᵉ instance directement en cochant à nouveau le test dans "+ Ajouter des tests".

**Correctif** (`campaign.$campaignId.tsx`) :
- `availableTests` n'exclut plus un test déjà inclus s'il a des paramètres
  (`!includedIds.has(t.id) || extractTestParameters(t).length > 0`) — reste filtré
  seulement si sans paramètre (comportement inchangé pour ce cas).
- Chaque ligne déjà incluse affiche une mention "déjà présent" (ou "déjà présent (n×)" si
  plusieurs instances existent déjà), pour éviter toute confusion sur le fait de créer une
  instance supplémentaire plutôt que de modifier l'existante.
- `handleConfirmAdd()` scinde la sélection confirmée en deux groupes : les ids réellement
  nouveaux (→ `addTests()`, dédupliqué comme avant) et les ids déjà présents (→
  `duplicateTest()` un par un, qui ne déduplique pas — c'était tout l'intérêt de cette
  méthode introduite en §9.3). Les deux groupes sont soumis en parallèle
  (`Promise.all`), avec un état de chargement local dédié (`isConfirmingAdd`) plutôt que
  de dépendre de `addTestsMutation.isPending` seul (qui ne reflète plus, à lui seul,
  l'ensemble de l'opération).

L'alternative barrée en §9.4 (transformer `selectedToAdd` en structure
`{testCaseId, paramValues}[]` supportant nativement les doublons dans une même
sélection) reste **non retenue** : ce correctif couvre le besoin exprimé (ajouter une
instance de plus à un test déjà présent, un clic de case à cocher à la fois) sans
réécrire le modèle de sélection groupée.
