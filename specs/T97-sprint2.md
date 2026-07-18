# T97 — Sprint 2

Ajouté après validation du sprint 1, suite à un retour utilisateur (cf. `T97.md` §Addendum
sprint 2) : « on doit pouvoir ajouter plusieurs fois le même test dans une campagne s'il y
a des paramètres, et la liste des tests de la campagne doivent faire apparaître les
paramètres s'il y en a ».

## Fichiers modifiés

**Types** (`packages/types/src/campaign.ts`) : `CampaignTestRun` gagne `entryId: string`,
identifiant unique de l'inclusion (distinct de `testCaseId`, qui n'est plus unique dans
`runs[]`).

**Backend** (`apps/desktop/src/main/services/campaigns.service.ts`) :
- Nouvelle méthode `duplicateTest(repoPath, campaignId, testCaseId, paramValues)` — ajoute
  une nouvelle instance d'un test déjà présent, sans dédoublonnage (contrairement à
  `addTests()`).
- `create()`/`addTests()` refactorés sur un helper privé commun `buildNewRuns()` qui génère
  `entryId` (`${testCaseId}-${n}`).
- `updateRun()`/`updateRunParams()` : lookup par `entryId` au lieu de `testCaseId`.
- `addTests()` déduplique désormais aussi son propre tableau d'entrée
  (`[...new Set(testCaseIds)]`), défensif.
- Nouveau helper privé `ensureEntryIds()` — backfill en mémoire de `entryId` pour les
  campagnes existantes (voir "Divergences").

**IPC/api-client** : nouveau canal `campaigns:duplicate-test` ; `updateRun`/
`updateRunParams` renommés `entryId` dans leurs signatures (comportement inchangé, c'est
juste le nom du paramètre qui reflète l'usage réel).

**`campaign.$campaignId.tsx`** :
- La liste des tests itère désormais `campaign.runs` (une ligne par instance) au lieu de
  `campaign.testCaseIds` (aurait produit des clés React dupliquées et un lookup de statut
  ambigu avec des instances multiples).
- Valeurs de paramètres affichées directement sous le titre de chaque ligne.
- Nouvelle icône "Dupliquer" (Copy) par ligne de test paramétré, visible seulement si la
  campagne est active — ouvre un formulaire `TestParamFields` inline, mutuellement
  exclusif avec le panneau d'édition des valeurs de la même ligne.
- `updateRunMutation` (mort depuis le sprint 1, jamais appelé) supprimé.

**`campaign.$campaignId.execute.$testId.tsx` / `run.$testId.tsx`** : résolvent désormais
`testCaseId` en cherchant l'entrée `campaign.runs` par `entryId` (valeur portée par le
paramètre d'URL, toujours nommé `testId` — voir "Divergences"), puis chargent le
`TestCase` via ce `testCaseId` résolu. `paramValues` vient directement de l'entrée
résolue.

**`CampaignListView.tsx`** : clé React `${tcId}-${idx}` au lieu de `tcId` seul — évite un
avertissement de clé dupliquée maintenant que `testCaseIds` peut contenir des doublons.

## Comportement implémenté

Un test avec au moins un paramètre peut être inclus plusieurs fois dans une campagne (via
l'action "Dupliquer" sur une instance déjà présente), chaque instance ayant ses propres
valeurs, son propre statut d'exécution, sa propre navigation exécution/relecture,
indépendants des autres instances du même test. Un test sans paramètre reste limité à une
seule inclusion (pas de changement de comportement pour ce cas — pas d'icône "Dupliquer").
La liste des tests d'une campagne affiche désormais les valeurs de paramètres de chaque
instance en regard de son titre, sans clic supplémentaire.

## Divergences par rapport au design initial de la conversation

**Pas de renommage des fichiers de route** (`...$testId.tsx` conservés tels quels plutôt
que renommés `...$entryId.tsx`) : ce projet régénère `routeTree.gen.ts` via le plugin
`@tanstack/router-vite-plugin` au démarrage de `vite dev`/`build`, indisponible dans cette
session (pas de serveur de dev attaché). Éditer ce fichier généré (630 lignes, symboles
dérivés du nom de fichier) à la main aurait été fragile. Le segment d'URL reste donc
littéralement `testId` mais porte un `entryId` — chaque page renomme la valeur extraite
(`{ testId: entryId } = Route.useParams()`) avec un commentaire explicite. Voir
`T97-design.md` §9.2 pour le détail de cette décision.

**Compatibilité ascendante non anticipée en amont** : la revue de code (`/code-review`, 2
angles ciblés) a mis en évidence que rendre `entryId` obligatoire dans le type sans plan de
migration cassait toute campagne créée avant ce sprint (recherches par `entryId` ne
matchant jamais des `runs[]` sans ce champ, navigation vers `.../run/undefined`). Corrigé
par un backfill déterministe en mémoire à la lecture (`ensureEntryIds()`, §9.3 du design),
sans réécriture de fichier — pas anticipé dans la conception initiale de ce sprint, trouvé
et corrigé avant ce commit.

Autres points trouvés en revue et corrigés avant ce commit :
- Icône "Dupliquer" pas gardée par `isActive` (le backend refuse mais rien n'empêchait
  l'affichage du bouton sur une campagne clôturée) — gardée.
- Panneaux d'édition et de duplication d'une même ligne pouvaient s'ouvrir simultanément —
  rendus mutuellement exclusifs.
- `addTests()` ne déduplique pas nativement son propre tableau d'entrée — dédup ajoutée,
  défensif (aucun chemin UI actuel ne déclenche ce cas).

Non corrigé, jugé hors scope (limitation architecturale préexistante, pas spécifique à ce
sprint) : absence de verrou/transaction sur l'écriture concurrente du fichier YAML d'une
campagne — deux mutations (ex. "Ajouter" et "Dupliquer") déclenchées à la milliseconde
près pourraient en théorie s'écraser l'une l'autre. Déjà vrai avant T97 pour toute paire de
mutations sur la même campagne (`updateRun`/`close`, etc.), pas de mécanisme de
verrouillage nulle part dans `CampaignsService`.

## Mises à jour SPEC effectuées

- `SPEC-TESTS.md` §4.2 — reformulée pour documenter `entryId`, les instances multiples et
  le backfill de compatibilité ascendante.
- `T97.md` — addendum décrivant le nouveau périmètre sprint 2.
- `T97-design.md` — nouvelle §9 (conception `entryId`, décisions et alternatives
  rejetées).
- `T97-tests.md` — scénarios T97-16 à T97-21, critères CA8–CA10.

## Comment tester manuellement

Suivre `T97-tests.md` T97-16 à T97-21. Point clé : dupliquer un test paramétré dans une
campagne, vérifier que les deux instances s'exécutent indépendamment (statuts, valeurs
substituées) sans interférence l'une sur l'autre.

Non testé interactivement (pas d'Electron attachable dans cette session) — `pnpm
typecheck` passe sans erreur nouvelle sur `@polenta/desktop` et `@polenta/api-client`.
Revue de code menée (2 angles ciblés sur la refonte d'identité `entryId`), 9 findings
remontés, tous évalués — 6 corrigés avant ce commit (dont le backfill de compatibilité
ascendante, le plus sévère), 1 hors scope documenté (verrouillage concurrent), 2 déjà
couverts/non reproductibles. Attend validation manuelle humaine avant archivage/merge.
