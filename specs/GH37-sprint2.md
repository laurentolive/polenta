# GH37 — Sprint 2 : mode Rendu et ancêtre commun

Spec : `specs/GH37.md` §3–§6 — Design : `specs/GH37-design.md` §3.2, §9 (sprint 2) — Tests : `specs/GH37-tests.md` §4

## Comportement implémenté

- **En-tête de fichier sur deux lignes** :
  1. chemin, type de conflit et objet, puis **Merger** ;
  2. bascule **Raw | Rendu**, **Ancêtre commun**, Tout prendre à gauche / droite.
- **Mode Rendu**, pour les exigences et les tests uniquement : la bascule est désactivée, avec une
  info-bulle, pour les autres fichiers et pour un objet dont le type est introuvable dans le schéma.
  - **Côtés et ancêtre (lecture seule)** :
    - l'objet est rendu comme dans l'outil : titre, libellé du statut, champs du schéma dans
      l'ordre du schéma (richtext rendu via `RichTextViewer`) ;
    - pour un test, préconditions, tableau des étapes et postconditions ;
    - champs hors schéma et autres propriétés (`id`, `version`, `jiraLinks`…) en YAML compact ;
    - les unités modifiées par ce côté depuis l'ancêtre sont surlignées (bleu à gauche, vert à droite).
  - **Sortie (édition)** :
    - mêmes widgets que l'éditeur (`DynamicField`, `StepsTable`, titre, statut) ;
    - chaque unité encore en conflit est une **carte** qui montre les deux valeurs rendues, avec
      « ← Prendre gauche » et « Prendre droite → ». La valeur choisie reste modifiable ensuite.
- **Synchronisation Raw ↔ Rendu** : le texte de la sortie reste l'unique source de vérité.
  - Une modification en formulaire passe par `updateObjectOutput` (merge-core) : les régions
    encore ouvertes sont remplacées par des emplacements réservés, la valeur est modifiée, le YAML
    est réémis au format `writeYaml`, puis les régions sont remises telles quelles.
  - Le choix d'un côté sur une carte passe par `resolveRegion`, comme en Raw.
  - Si le YAML saisi en Raw est invalide, le Rendu de la sortie affiche un message et renvoie vers
    le Raw. Le texte n'est jamais réécrit.
- **Ancêtre commun** : le bouton divise la rangée du haut en trois colonnes (mes modifications |
  ancêtre | destination). « Fichier absent de l'ancêtre commun » s'affiche quand le fichier a été
  ajouté des deux côtés. L'ancêtre est en lecture seule, sans action de prise.
- **Séparateur redimensionnable** entre la rangée du haut et la sortie (15–85 %).
- **Défilement synchronisé** :
  - chaque panneau publie l'unité en haut de sa zone visible et le décalage dans cette unité ;
  - les autres panneaux se placent sur la même unité, ou sur la même position relative pour un
    fichier texte ou une unité absente ;
  - un défilement programmatique est ignoré pendant 200 ms, ce qui évite le ping-pong entre un
    panneau court borné et CodeMirror qui se re-mesure.
- **Préférences du poste** (`localStorage`, lecture et écriture protégées) : `polenta:mergeShowBase`,
  `polenta:mergeSplit`, `polenta:mergeViewMode`.
- **Avertissements non bloquants** dans la validation (main) : champ `required` vide, champ
  `validator: EARS` non conforme. Mêmes règles (`isFilled`, `isEarsCompliant`) que l'import en
  masse et la maturité. « Merger » reste actif.

## Fichiers modifiés / créés

| Fichier | Nature |
|---|---|
| `packages/merge-core/src/units.ts` (nouveau), `index.ts` | `changedUnits`, `regionFragments`, `fragmentValue`, `updateObjectOutput`, `unitAnchors`, `unitValue` |
| `packages/merge-core/src/merge-core.test.ts` | U14 + 4 tests des helpers (25 au total) |
| `apps/desktop/src/renderer/components/merge/RenderedObjectPane.tsx` (nouveau) | rendu lecture / formulaire, cartes de conflit |
| `apps/desktop/src/renderer/components/merge/scrollSync.ts` (nouveau) | groupe de synchronisation, `useElementSync`, préférences |
| `apps/desktop/src/renderer/components/merge/FileResolver.tsx` | bascules, colonne ancêtre, séparateur, sortie Rendu, en-tête sur deux lignes |
| `apps/desktop/src/renderer/components/merge/RawPane.tsx` | ancrage et suivi du défilement |
| `apps/desktop/src/main/services/merge-resolution.service.ts` | avertissements `requiredEmpty` / `ears` |
| `packages/types/src/merge-resolution.ts` | codes d'avertissement |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `mergeResolve.mode*`, `showBase`, `basePane`, `rendered.*`… |

## Divergences par rapport au design

1. **Rendu des préconditions, étapes et postconditions d'un test** : l'édition de `equipment` reste
   en Raw (affichée en YAML dans « Autres propriétés »).
2. **Les notes des étapes (`notes`) suivent leur étape** dans la sortie Rendu : rattachement par
   contenu, ou par position pour une étape modifiée sur place. Les autres éditeurs de test les
   remettent à `null` à chaque sauvegarde des étapes (comportement existant, pas modifié ici).
3. **Le mode Raw/Rendu est aussi mémorisé** (`polenta:mergeViewMode`), en plus de l'ancêtre et du
   séparateur.

## Mises à jour SPEC

Aucune à ce sprint (prévues au sprint 3).

## Vérifications effectuées

- `tsc --noEmit` (apps/desktop, merge-core) : 0 erreur. `vitest` merge-core : 25/25.
- **Service** (script hors repo, schéma avec `required` + `validator: EARS`) : un énoncé non EARS
  et une priorité vide donnent `requiredEmpty` + `ears` en avertissements, sans erreur.
- **App (driver Playwright, remote bare + second clone)** :
  - Rendu : les trois colonnes sont rendues, avec le richtext Markdown formaté et les unités
    modifiées surlignées ; cartes de conflit gauche/droite ;
  - prendre gauche/droite depuis les cartes, puis retour en Raw : texte cohérent, régions restantes
    intactes ;
  - modifier la priorité dans le formulaire : visible en Raw, puis Merger → Finaliser (commit de
    merge, publication terminée) ;
  - ancêtre commun mémorisé d'une session à l'autre ;
  - défilement synchronisé sur une exigence longue (120 lignes) en Raw et en Rendu, après
    correction d'un ping-pong (voir plus haut).
- **`/code-review` (medium)** : 2 constats, corrigés.
  - Notes d'étape réattribuées par position après suppression ou réordonnancement → rattachement
    par contenu.
  - Un champ `text` contenant `42` devenait `NaN` à l'édition → conversion d'après le type du
    schéma uniquement.

## Comment tester manuellement

1. Créer un conflit sur une exigence : titre, priorité et énoncé (richtext) modifiés différemment
   des deux côtés, puis Publier → Résoudre les conflits.
2. Basculer en **Rendu** :
   - les côtés sont rendus et les champs modifiés surlignés ;
   - la sortie affiche une carte par champ en conflit.
3. Prendre une valeur à gauche, une autre à droite, puis éditer l'énoncé dans le formulaire.
   Rebasculer en **Raw** : le texte reflète tout, et les régions encore ouvertes sont intactes.
4. En Raw, casser le YAML (par exemple `status: [`) puis basculer en Rendu : un message s'affiche
   et le texte n'est pas perdu au retour en Raw.
5. **Ancêtre commun** : trois colonnes. Fermer l'onglet puis rouvrir : le choix est conservé.
   Déplacer le séparateur, rouvrir : la hauteur est conservée.
6. Sur une exigence longue, faire défiler un panneau : les autres suivent sur le même champ.
7. Un énoncé non EARS ou un champ requis vidé affiche un avertissement orange ; « Merger » reste actif.
8. Sur un test en conflit sur `steps` : un seul bloc, rendu en tableau.

Scénarios de `GH37-tests.md` couverts par ce sprint : U14, M17, M19–M29.
