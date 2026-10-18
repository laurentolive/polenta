# GH105 — Sprint 2 (renderer) : liens inter-repos dans les vues, navigation, SPEC

Périmètre : `specs/GH105-design.md` D8 + i18n + e2e web + mises à jour SPEC (dernier sprint).

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `renderer/hooks/useWorkspaceLinks.tsx` (nouveau) | hook + contexte : objets, liens, types de lien du workspace (`api.links.*`), index (par id, par objet), libellés de repo, candidats, portée des refs, `createLink` / `deleteLink` (avec `workspaceDir`), invalidation ; clés indexées sur l'empreinte des repos du workspace |
| `renderer/components/system/LinkTypeEditor.tsx` (nouveau) | éditeur des liens d'un objet pour un type (sortants / entrants), partagé par Édition, Excel, Word ; `linkTypeVisibility` (règle d'affichage unique) ; `describeLink` (pastille résolue) |
| `renderer/components/system/LinkCombobox.tsx` | pastilles : titre, repo du pair, badge « introuvable », suppression désactivée si le repo de stockage est en lecture seule ; candidats : libellé du repo ; erreurs d'écriture affichées sous le champ (le combobox ne reste plus bloqué en chargement) |
| `renderer/components/system/linkUtils.ts` | `filterCandidatesByRefs(…, scope?)` (refs résolues par repo, D2), `normRepoPath`, `parseLinkError` |
| `renderer/components/system/{EditView,ExcelView,WordView}.tsx` | éditeurs de liens remplacés par `LinkTypeEditor` (plus d'appel direct à `linkCreate` / `linkDelete`) |
| `renderer/components/system/SystemView.tsx` | `useWorkspaceLinks` + `WorkspaceLinksProvider` ; types de lien, liens et candidats du workspace ; couverture avec `workspaceDir` ; tests des autres repos dans `testsById` ; navigation vers un objet d'un autre repo et « ← Retour » multi-repo |
| `renderer/contexts/SystemViewContext.tsx` | `navigateToRepo`, `repoNameOf` |
| `renderer/components/search/SearchEditPane.tsx` | même contexte ; nouvel onglet ouvert sur le repo de l'objet lié |
| `renderer/hooks/useLiveFileSync.ts` | invalidation `links-*` et couverture sur tout changement d'objet / lien / schéma / `polenta-repo.yaml` |
| `renderer/i18n/locales/{fr,en}.json` | `system.linkCombobox.{notFound, notFoundHint, readonlyStorage, notReady, errors.*}` |
| `main/services/workspace-links.service.ts`, `packages/types` | `WorkspaceObject.readonly` (objet d'un repo en lecture seule : jamais source d'un nouveau lien) |
| `…/linkUtils.gh105.test.ts` (nouveau), `…/workspace-links.service.test.ts` | 8 tests |
| `e2e-web/gh105-cross-repo-links.spec.ts` (nouveau) | 4 parcours sur la démo (voir Vérifications) |
| `specs/SPEC-*.md` | voir Mises à jour SPEC |

## Comportement implémenté

- **Candidats** : exigences et tests de tous les repos du workspace, filtrés par les refs du type
  avec résolution par repo, libellé du repo affiché ; objets d'un repo en lecture seule proposés
  en cible seulement ; aucun candidat en sortie quand l'objet édité est lui-même en lecture seule.
- **Affichage des deux côtés** : un objet montre les liens dont il est source ou cible, quel que
  soit le repo qui les stocke ; types de lien = union du workspace (un composant sans `linkTypes`
  affiche ceux du produit). Pastille : id, titre, repo du pair s'il diffère ; « introuvable » si
  le pair n'est pas dans le workspace (seulement une fois les objets chargés).
- **Écriture** : création côté source / suppression dans le repo de stockage par le main ;
  refus affiché sous le champ (`READONLY_REPO`, `DUPLICATE_LINK`…, traduits).
- **Navigation** : clic sur un objet d'un autre repo → bascule sur son repo (`navigateToRepo`),
  objet ouvert (Édition) ou type affiché (Word) ; « ← Retour » revient au repo de départ. Ctrl+clic
  ouvre l'objet dans un onglet sur son repo.
- **Couverture** : matrice calculée sur le workspace (liens et tests des autres repos).
- **Rafraîchissement** : composant ajouté, objet créé / modifié, lien ou schéma changé dans
  n'importe quel repo → requêtes `links-*` et couverture invalidées.

## Divergences par rapport au design

1. **Composant partagé `LinkTypeEditor`** au lieu de modifier séparément les trois vues : les trois
   éditeurs de liens étaient identiques (deux `LinkCombobox` + appels IPC) ; la règle d'affichage
   (`linkTypeVisibility`) n'existe plus qu'à un endroit.
2. **Pas de toast** (l'application n'en a pas) : l'erreur d'écriture s'affiche dans le combobox.
3. **Titre du pair** : affiché dans les pastilles des éditeurs (Édition, popovers Excel / Word) ;
   les cellules de liens Excel et les lignes de liens des cartes Word gardent la liste d'ids
   (comportement antérieur).
4. **Lien vers un test depuis l'onglet Exigences** (préexistant) : la navigation garde la catégorie
   de l'onglet ; l'historique de « ← Retour » expire alors après 3 s au lieu de rester bloqué.

## Revue de code (`/code-review`)

Corrigés : historique « ← Retour » qui pouvait rester figé (expiration de la cible de navigation),
« introuvable » affiché pendant le chargement, candidats de sortie pour un objet en lecture seule,
couverture non invalidée sur changement d'un autre repo, double invalidation après écriture,
double exécution des requêtes au démarrage (attente de l'arbre du workspace), recherches linéaires
par pastille (index par id, libellés de repo), règle d'affichage triplée, écriture ignorée en
silence avant le chargement du projet (erreur `notReady`).

Conservé : index des objets par id seul (préfixes uniques dans le projet, règle 10 ; le main
garde le premier et le signale).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-REQ-requirements.md` §5.2a (nouvelle) | liens entre repos : stockage côté source, affichage des deux côtés, union des types, refs résolues par repo, candidats, `READONLY_REPO`, navigation |
| `SPEC-MCP-SERVER.md` §4.4 | liens lus sur le workspace, écrits côté source ; `storedIn` / `readonly` ; règles 1, 5, 6 ; chemin IPC désormais validé avec `workspaceDir` |
| `SPEC-ELECTRON-DESKTOP.md` §22.3 | écart constaté : refs `root::<type>` des composants (pas `<montage>::<type>`), liens stockés côté source |
| `SPEC-SYSTEM-VIEW.md` (← Retour) | navigation vers un autre repo, pile multi-repo, expiration |
| `SPEC-INDEX.md` | colonne MAJ → GH105 pour les 4 lignes, mots-clés ajoutés |

## Vérifications

- `pnpm -r typecheck` : OK. `pnpm test` : desktop 632/632, merge-core 38/38.
- e2e web `gh105-cross-repo-links.spec.ts` sur la démo : 4/4 (GH105-1 candidat d'un composant
  et stockage côté source, GH105-2 affichage côté cible + navigation inter-repos + « ← Retour »,
  GH105-3 suppression depuis la cible, GH105-4 pastille « introuvable »). Suite e2e complète
  exécutée une fois pendant le sprint : 100 passés, 13 ignorés (OIDC / instance déployée), aucune
  régression (seul GH105-1 échouait alors, sur un élément approuvé donc verrouillé — test corrigé
  pour choisir / rouvrir un élément en brouillon).

## Comment tester manuellement (PH2)

- **M1** — `handstickProduct`, une `PRODUCT_REQ`, vue Édition : `implements` propose
  `HMI_PH2_REQ-0001/0002` (« bla bla », « bla bla bla », libellé `HMI VE22D`) ; créer le lien →
  ligne dans `handstickProduct/links/links.yaml`, `hmi-PH2` inchangé.
- **M2** — Exigences → `HMI VE22D / Exigence`, `HMI_PH2_REQ-0001` : le lien apparaît (Édition,
  Excel colonne `implements`, Word) ; clic sur la `PRODUCT_REQ` → bascule sur `handstickProduct` ;
  « ← Retour » revient sur `hmi-PH2`.
- **M3** — `hmi-PH2` épinglé (`c831de5`) : le lien reste supprimable des deux côtés (stocké dans le
  produit, modifiable) ; depuis la `HMI_PH2_REQ`, aucun candidat proposé en sortie.
