# GH64 — Sprint 2 : sélecteur (dernier sprint)

Spec : `specs/GH64.md` — Design : `specs/GH64-design.md` §4 — Tests : `specs/GH64-tests.md`
L1–L9, U1–U6.

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `apps/desktop/src/renderer/lib/carryOver.ts` | nouveau — lignes proposées (`buildCarryRows`), disponibilité, doublons, saisies de l'étape 2, entrées retenues (`pickCarried`), couverture et priorité sur l'onglet Tests (`carryCoverage`, `withCarryPrecedence`), sélection envoyée au main |
| `apps/desktop/src/renderer/lib/carryOver.test.ts` | nouveau — 16 tests |
| `apps/desktop/src/renderer/components/campaign/CampaignCarryPanel.tsx` | nouveau — onglet « Depuis une campagne » (campagnes source, filtre de statut, entrées) |
| `apps/desktop/src/renderer/components/campaign/TestPickerModal.tsx` | onglets à l'étape 1, état du report, requête de résolution dédiée aux campagnes source, étape 2 des entrées reportées, `PickerResult.carried` / `carryState` |
| `apps/desktop/src/renderer/hooks/useParamPreview.ts` | map mémoïsée ; option `keepPrevious` (garde la réponse précédente pendant un rechargement) |
| `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` | props du report, priorité appliquée à l'envoi, `carried` transmis à `addTests` |
| `apps/desktop/src/renderer/routes/campaign.new.tsx` | état `carried` / `carryState`, récapitulatif, complétude, priorité, `carried` dans le DTO |
| `apps/desktop/src/renderer/components/system/CampaignListView.tsx` | export des classes de pastilles de statut (réutilisées par l'onglet) |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `campaignPage.picker.tabTests` / `tabCampaign`, `campaignPage.carry.*` |
| `apps/desktop/src/web-server/channel-policy.ts` | **correctif** `ROOT_ARGS['campaigns:add-tests']` : `[0, 5]` → `[0, 4]` (voir ci-dessous) |
| `apps/desktop/src/web-server/channel-policy.test.ts` | découpage des paramètres de handler sur les virgules de premier niveau (génériques imbriqués) |
| `apps/desktop/e2e-web/gh64-carry-over.spec.ts` | nouveau — U1–U5 |
| `specs/SPEC-TESTS.md`, `specs/SPEC-INDEX.md` | mises à jour SPEC (ci-dessous) |

## Comportement implémenté

Conforme à `specs/GH64.md` §2–§4 : onglets « Tests » / « Depuis une campagne » à la création et à
l'ajout ; toutes les campagnes sauf la cible ; filtre de statut (défaut pending / BLOCKED /
INCOMPLETE) ; coche par défaut à la première apparition, choix conservés ; motifs d'indisponibilité ;
avertissement de version ; une ligne par clé (source la plus récente, autres citées) ; étape 2 avec
valeurs pré-remplies, exigence de la source figée, `ReqInstancePicker` pour une entrée sans exigence
d'un test devenu itérant ; récapitulatif de création ; mention `↩ CAMP-ID`.

## Divergences par rapport au design

- **Correctif hors design, nécessaire au client web** : `campaigns:add-tests` était refusé (403) par
  la garde de chemins du serveur web dès qu'un `reqInstances` était envoyé — c'est-à-dire **à chaque
  ajout de tests depuis le navigateur, avant même GH64**. Cause : `ROOT_ARGS` déclarait l'argument 5
  (`reqInstances`) comme chemin racine au lieu du 4 (`workspaceDir`), et le test censé la garder
  synchronisée découpait mal `Record<string, Record<string, string>>`. Test et table corrigés ; plus
  aucune autre entrée de la table ne change.
- **Résolution des paramètres** : deux requêtes au lieu d'une — celle des candidats (inchangée) et une
  dédiée aux tests des **seules campagnes source cochées** (retour de revue : ne pas résoudre toutes
  les campagnes du repo à chaque ouverture), avec `keepPrevious` pour éviter un état vide pendant le
  rechargement qui suit une coche.
- **Priorité sur l'onglet Tests** : appliquée à l'envoi par l'appelant (`withCarryPrecedence`), pas en
  réécrivant la sélection de l'onglet Tests (retour de revue : décocher plus tard l'entrée reportée
  doit rendre au test sa sélection d'origine).
- Une entrée sans exigence d'un test devenu itérant dont aucune exigence n'est retenue est omise
  (elle ne créerait rien) ; ses exigences proposées excluent celles d'autres entrées reportées.
- Coche par défaut seulement une fois la résolution du test reçue (sinon « Exigence plus liée »
  pourrait être manquée).
- U6 (même test dans les deux onglets) couvert par les tests unitaires (`carryOver.test.ts`,
  `campaigns.service.carry.test.ts` S9b) plutôt qu'en e2e : la sélection dans la Vue Excel du
  sélecteur n'est pas pilotable simplement dans la démo.

## Revue de code — points non retenus

- En-tête « test · ↩ campagne · exigence » présent dans l'étape 2 et dans le récapitulatif de
  création : quelques lignes, pas de composant partagé.

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 205 tests desktop + 34 merge-core, verts.
- `pnpm --filter @polenta/desktop test:e2e:web` : 30 passés (dont `gh64-carry-over.spec.ts` U1–U4,
  U5), 13 ignorés (forge / déploiement requis), 0 échec.

## Mises à jour SPEC

| Section | Modification |
|---------|--------------|
| `SPEC-TESTS.md` §4.2 | attribut `carriedFrom` dans la table de `CampaignTestRun` ; paragraphe « Report depuis une autre campagne (GH64) » (onglet, filtre, doublons, disponibilité, instance créée, priorité, comportement du main, mention ↩) |
| `SPEC-INDEX.md` | ligne `SPEC-TESTS.md §4.1–4.2` : résumé et mots-clés du report, MAJ → GH64 |

## Tester manuellement

1. Campagne A : quelques tests, mettre des résultats variés (PASS, BLOCKED, laisser pending), la
   clôturer.
2. Nouvelle campagne B → « Sélectionner des tests… » → onglet « Depuis une campagne » → cocher A :
   BLOCKED et pending cochés, PASS absent. Cocher « Passé » dans le filtre : la ligne PASS apparaît
   cochée, une ligne décochée avant reste décochée.
3. Valider, créer : les instances reportées portent `↩ A` dans la liste des tests ; A est inchangée.
4. Dans B, « + Ajouter des tests » → onglet campagne → A : les entrées déjà reportées sont grisées
   « Déjà présent ».
5. Avec un test à paramètre saisi : l'étape 2 montre la valeur de la source pré-remplie, modifiable.
6. Avec un test itérant (T179) : l'instance reportée garde son exigence ; retirer le lien
   test ↔ exigence puis rouvrir : « Exigence plus liée ».
7. Client web : même parcours (correctif `ROOT_ARGS`).
