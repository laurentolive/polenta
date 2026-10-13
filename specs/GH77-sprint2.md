# GH77 — Sprint 2 : configuration dans l'éditeur de schéma, renommage de champ

Spec : `specs/GH77.md` §1, §6 · Design : `specs/GH77-design.md` §3 · Scénarios : `specs/GH77-tests.md` (C, R)

## Comportement livré

- **Éditeur de type** (onglet Structure, modal de configuration d'un élément) :
  - la colonne **« Hist. »** du tableau des champs active `trackHistory`. L'infobulle indique ce qui
    sera enregistré : « valeur, date et auteur », ou « date et auteur seulement » pour
    `textarea` / `richtext` / `drawio`. La case est grisée pour un champ nommé `status` ;
  - la case **« Historiser le statut »** est cochée par défaut, pour les trois catégories,
    campagnes comprises ;
  - écriture compacte : `trackHistory` n'est écrit que s'il est vrai, `trackStatusHistory` que
    s'il est faux.
- **MCP** : `add_object_type` et `add_field` acceptent `trackStatusHistory` / `trackHistory`
  (auparavant retirés par zod).
- **Renommage d'un champ** : à l'enregistrement d'un type, chaque champ dont le nom diffère de son
  nom d'origine est un renommage. Une fois le schéma enregistré, `schema:rename-fields` migre
  `fields.<ancien>` → `fields.<nouveau>` et `history.<ancien>` → `history.<nouveau>`. Sont concernés
  les exigences, les tests et les campagnes du type, dans le repo du type.
  - Aucune entrée d'historique n'est créée.
  - Les chaînes (`a→b`, `b→c`) sont appliquées d'un coup.
  - Un objet qui a déjà une donnée sous le nouveau nom n'est pas modifié et figure dans le compte
    rendu.
  - Un fichier en échec n'arrête pas les autres.
  - Une bannière dans l'onglet Structure donne le compte rendu : objets migrés, non migrés, échecs.
  - Toutes les vues en cache sont rafraîchies, pour qu'aucune sauvegarde ne réécrive l'ancienne clé.
  - Un champ supprimé puis recréé (sans nom d'origine) n'est pas un renommage.

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `packages/types/src/history.ts` | `renameFieldKeys`, `FieldRename`, `FieldRenameResult` |
| `main/services/field-rename.service.ts` (nouveau) | Orchestration exigences → tests → campagnes |
| `requirements.service.ts`, `tests.service.ts`, `campaigns.service.ts` | Méthode dédiée `renameFieldKeys` (écriture par `persist`, sans entrée) |
| `main/container.ts`, `main/ipc/index.ts`, `web-server/channel-policy.ts`, `packages/api-client` | Canal `schema:rename-fields` (validé : `objectTypeRef` `<nœud>::<type>`, renommages `{ from, to }`) |
| `mcp-server/tools/schema-mutation.tools.ts` | `trackHistory`, `trackStatusHistory` dans les schémas zod |
| `renderer/components/schema/objectTypeEditor.tsx` | État éditable (`trackHistory`, `originalName`, `trackStatusHistory`), `canTrackHistory`, `fieldRenames`, colonne « Hist. » |
| `ElementConfigModal.tsx` | Case « Historiser le statut » |
| `StructureTab.tsx` | Migration après enregistrement, bannière `FieldRenameBanner` |
| `i18n/locales/{fr,en}.json` | Libellés |
| Tests | `history.test.ts` (+6), `objectTypeEditor.gh77.test.ts` (7), `field-rename.service.test.ts` (7, dont C5 MCP), `e2e-web/gh77-history.spec.ts` (C2, C3, R1) |

## Divergences par rapport au design

1. `renameFieldKeys` prend un objet `FieldRenameResult` partagé, que les trois services
   complètent, au lieu de renvoyer chacun un résultat à fusionner.
2. Après la migration, **toutes** les requêtes en cache sont invalidées, pas seulement les listes.
   Une vue de détail ouverte sur l'ancienne clé l'aurait réécrite à la sauvegarde suivante.
3. `history.status` n'est jamais déplacé par un renommage : un champ nommé `status` n'est pas suivi,
   donc cette clé est toujours l'historique du statut.

## Revue de code

**Corrigé** :
- collision avec `history.status` lors du renommage d'un champ nommé `status` ;
- `in` remplacé par `Object.hasOwn` (noms comme `constructor`) ;
- rafraîchissement de toutes les vues ;
- validation de `objectTypeRef` dans le canal IPC.

**Laissé, assumé** :
- **Migration en deux appels** (enregistrement du schéma, puis migration) : pas de retour arrière,
  comme `ElementMoveService`, conformément au design §3.3. Un échec est affiché (« schéma
  enregistré, migration échouée »). Le MCP n'a pas d'outil de renommage, et `schema.yaml` modifié à
  la main ne migre rien : comportement inchangé.
- **Objets d'un composant dans le repo produit** : les objets d'un type de composant sont écrits dans
  le repo du composant (`resolveComponentRepoPath`), et c'est là que la migration s'applique.
- **Références `{req.<ancien>}` dans les étapes de test** (T179) : elles ne sont pas réécrites. C'est
  une réécriture de contenu `richtext` hors du périmètre de la spec, à traiter si besoin avec #82
  (renommages dans le schéma).
- **Champ supprimé et autre champ renommé sous son nom dans la même édition** : les objets qui ont
  une donnée sous l'ancien nom sont listés « non migrés », comme le prévoit la spec (donnée déjà
  présente sous le nouveau nom).
- Trois boucles `renameFieldKeys` similaires (verrous et lectures différents selon le service), et
  une relecture des campagnes : acceptable pour une action rare.

**Bug existant relevé** : l'éditeur supprime `validator` (ex. `EARS`) des champs à chaque
enregistrement d'un type → **#86**.

## Mises à jour SPEC

Aucune, elles sont prévues au sprint final (3).

## Résultats

- `tsc` : zéro erreur.
- `pnpm test` : 409 tests desktop + 38 merge-core, tous verts.
- e2e web : suite complète 52 passés / 13 ignorés (scénarios déployé / OIDC, inchangé), dont `gh77-history.spec.ts` 3/3.

## Comment tester manuellement

1. **C4** — Projet → Structure → ouvrir un type → survoler la case « Hist. » d'un champ `richtext` :
   « date et auteur seulement ».
2. **R5** — Renommer un champ d'un type d'un composant en repo séparé : les objets du repo du
   composant sont migrés (bannière, puis Version : fichiers à publier).
3. Renommer un champ en lui donnant le nom d'un champ supprimé dont des objets ont encore une
   valeur : ces objets sont listés « non migrés ».
4. Renommer un champ puis Publier : les objets modifiés font partie du commit.
