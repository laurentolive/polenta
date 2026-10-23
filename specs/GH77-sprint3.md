# GH77 — Sprint 3 (final) : reprise depuis git, section « Historique », SPEC

Spec : `specs/GH77.md` §9, §10 · Design : `specs/GH77-design.md` §4 · Scénarios : `specs/GH77-tests.md` (B, H)

## Comportement livré

### Reprise depuis git

Dans les **Préférences du projet**, section « Historique des champs suivis » : une ligne par repo du
workspace (les composants montés sous un nœud `readonly` sont exclus), bouton « Reconstruire depuis
git », confirmation en ligne, puis un compte rendu (objets complétés, entrées ajoutées, fichiers
ignorés).

- **Parcours** : un seul, sur la **chaîne des premiers parents** de la branche courante.
  - Une entrée `source: git` par changement de valeur d'un champ suivi, selon la configuration
    actuelle du schéma.
  - Datée du commit (date de commit) et signée du nom de son auteur.
  - Mode événement (`richtext`…) : une entrée sans valeur à chaque commit qui modifie le champ.
- **Fusion avec l'historique existant** :
  - union sans doublon ;
  - une entrée git n'est pas ajoutée si l'application a déjà noté la même valeur entre le commit
    précédent du fichier et ce commit ;
  - les entrées « début du suivi » (`source: schema`) devenues redondantes sont retirées.
  - Relancer n'ajoute rien.
- **Écriture** : fichiers réécrits dans le working tree, à publier, sans comblement d'écart ajouté.
- **Mesure (B7)** : repo synthétique de 2 000 exigences × 200 commits (20 fichiers modifiés par
  commit), 5 980 entrées ajoutées en **58 s**. C'est sous le seuil de 60 s fixé au design : pas
  d'option « depuis le commit X ». Sur le repo de démo, la reprise prend 2,2 s.

### Section « Historique »

Section repliable, en lecture seule, dans le détail d'une exigence, d'un test et d'une campagne, et
dans la Vue Système › Édition.
- Une liste par champ suivi : le statut d'abord, puis les champs dans l'ordre du schéma, puis les
  clés inconnues du schéma.
- Entrées les plus récentes d'abord, avec les libellés du schéma (statuts des campagnes : libellés
  i18n).
- Affichage : « modifié » pour un événement seul, « (vide) » pour un champ vidé.
- Badges `MCP`, `git`, « début du suivi », « déduite », avec une infobulle explicative.
- Chargée seulement à l'ouverture, et relue quand le statut ou un champ suivi change.

### SPEC

| Fichier | Section | Modification |
|---------|---------|--------------|
| `SPEC-REQ-requirements.md` | §2.1, §3.1, §3.4 | `trackStatusHistory`, `trackHistory`, champ système `history` |
| `SPEC-REQ-requirements.md` | **§4.4 (nouvelle)** | Historique des champs suivis : principe « données brutes », configuration, stockage, alimentation, valeur courante, évolution du schéma, reprise git, affichage |
| `SPEC-TESTS.md` | §2.2, §4.1, §4.2 | `history` du test et de la campagne (statut `planned` → `in_progress` → clôture), `testSnapshot` sans `history` |
| `SPEC-TECH-stack.md` | §4.2, §6 | Champ `history` ; `history` jamais en conflit à la fusion (`mergeHistories`) |
| `SPEC-ELECTRON-DESKTOP.md` | §20.4, §20.6 | IPC `schema:rename-fields`, `history:get`, `history:backfill` ; options de l'onglet Structure, reprise dans les préférences, `HistorySection` |
| `SPEC-MCP-SERVER.md` | §4.1, §4.3 | Tool `get_history`, acteur `source: mcp`, options d'historique de `add_object_type` / `add_field` |
| `SPEC-TEMPLATES.md` | §3.1, §3.2 | `trackStatusHistory`, `trackHistory` |
| `SPEC-INDEX.md` | 10 lignes | Couverture, mots-clés, MAJ → GH77 |

## Fichiers modifiés (code)

| Fichier | Modification |
|---------|--------------|
| `main/services/git.service.ts` | `commitChanges` (chaîne des premiers parents, fichiers modifiés), `readTextAt` (absent → `null`, autre erreur levée) |
| `main/services/history-backfill.service.ts` (nouveau) | Reprise git |
| `packages/types/src/history.ts` | `changeEntries`, `HistoryBackfillResult` |
| `requirements.service.ts`, `tests.service.ts`, `campaigns.service.ts` | `updateHistory` ; `persist(…, { raw: true })` pour la reprise et le renommage (aucun comblement) |
| `main/container.ts`, `main/ipc/index.ts`, `web-server/channel-policy.ts`, `packages/api-client` | Canal `history:backfill` |
| `renderer/components/history/` (nouveau) | `HistorySection`, `historySections` (logique pure), `HistoryBackfillPanel` |
| `routes/req.$reqId.tsx`, `routes/test.$testId.tsx`, `routes/campaign.$campaignId.tsx`, `components/system/EditView.tsx` | Section « Historique » |
| `routes/preferences.tsx` | Panneau de reprise |
| `i18n/locales/{fr,en}.json` | Libellés `history.*` |
| Tests | `history-backfill.service.test.ts` (8, vrai repo git), `historySections.test.ts` (4), `e2e-web/gh77-history.spec.ts` (+4 : H1/H3, H4, H5, B8) |

## Divergences par rapport au design

1. **Pas de barre de progression** : un état « Reconstruction… » puis le compte rendu. C'est une
   action ponctuelle d'environ une minute au pire mesuré, et l'IPC n'a pas de canal d'événements
   commun au desktop et au web.
2. **Emplacement** : la page Préférences du projet (lien « Préférences » du panneau Projet) plutôt
   que le panneau Projet lui-même, trop étroit pour une ligne par repo.
3. **Branches fusionnées** : avec le premier parent seul, le changement fait sur une branche est
   daté et signé **du commit de fusion**, pas de son commit d'origine. C'est l'histoire de la
   branche d'intégration. Parcourir tous les parents produisait de faux allers-retours quand deux
   branches touchaient le même fichier (revue de code).
4. **Date de commit** plutôt que date d'auteur : elle est monotone le long de la chaîne, ce que
   demande la fenêtre de dédoublonnage (une date d'auteur peut reculer après un rebase).
5. **Entrées « début du suivi » redondantes** retirées par la reprise (non prévu) : sans ça, chaque
   objet modifié depuis le sprint 1 aurait gardé sa valeur deux fois.
6. **Écriture « brute »** (`persist(…, { raw: true })`) pour la reprise **et le renommage**
   (correction du sprint 2) : ces écritures ne changent aucune valeur et ne doivent pas ajouter
   d'entrée de comblement.

## Revue de code

**Corrigé** :
- parcours limité au premier parent ;
- date de commit ;
- écriture brute ;
- entrées `schema` redondantes ;
- erreur de lecture d'un objet git distinguée d'une suppression ;
- repos `readonly` exclus du panneau ;
- clé de rafraîchissement de la Vue Système limitée au statut et aux champs suivis ;
- comptage des entrées ajoutées et réécriture seulement en cas de changement réel.

**Laissé, documenté** :
- **Historique antérieur à un renommage de champ** non repris : les anciennes versions portent
  l'ancien nom. C'est noté dans SPEC-REQ §4.4.
- **Type d'un composant référencé depuis un autre repo** : la reprise lit le schéma du repo traité.
  Les objets d'un type de composant vivent dans le repo du composant, où la reprise s'exécute.
- **Invalidation de tout le cache** après une reprise : action rare.

## Points ouverts pour la validation

- **`by` des entrées datées d'un commit** (reprise, comblement d'écart) : c'est le **nom** de
  l'auteur git, pas le login forge. Signalé aux sprints 1 et 2, toujours sans décision. C'est le
  comportement livré, et `source` le signale.
- **#86** (bug existant) : enregistrer un type dans l'onglet Structure supprime `validator`.
- **#82** : renommer un statut ou une valeur d'enum.

## Résultats

- `tsc` : zéro erreur (desktop, api-client, merge-core).
- `pnpm test` : 421 tests desktop + 38 merge-core, tous verts.
- e2e web : 56 passés, 13 ignorés (scénarios déployé / OIDC, inchangé), dont `gh77-history.spec.ts`
  7/7.

## Comment tester manuellement

1. **Reprise** : Projet → Préférences → « Reconstruire depuis git » sur le repo du projet → Oui. Le
   compte rendu s'affiche, Version liste les fichiers à publier, et une exigence ancienne montre des
   entrées « git » dans sa section Historique.
2. Relancer la reprise : « 0 objet(s) complété(s) ».
3. Workspace avec un composant `readonly` : sa ligne n'apparaît pas.
4. Section Historique : changer le statut d'une exigence, puis ouvrir la section ; l'entrée est en
   tête avec votre login. Modifier le YAML à la main puis rouvrir : badge « déduite ».
5. Campagne : créer, saisir un résultat, clôturer. La section montre Planifiée → En cours → Terminée.
