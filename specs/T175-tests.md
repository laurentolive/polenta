# T175 — Scénarios de test

Réf. : `specs/T175.md`, `specs/T175-design.md`.

Deux niveaux :
- **S** — script de service hors UI (tsx, repos git temporaires, sans Electron), sur
  `SyncService.workdirChangesVsHead` et `TraceabilityService.computeLocalImpactAnalysis` ;
- **M** — vérification manuelle dans l'app.

Jeu de données de base (repo racine `prod`, commité) : `SYS-0001` (approved), `SYS-0002` enfant de
`SYS-0001` (lien `SYS-0002 → SYS-0001`), `TEST-0001` couvrant `SYS-0001` (lien créé **depuis le
test** : `TEST-0001 → SYS-0001`), `TEST-0002` couvrant `SYS-0002` (lien créé **depuis l'exigence** :
`SYS-0002 → TEST-0002`). Composant `comp` (repo séparé, commité) : `MC-0001`, avec un lien dans le
produit `MC-0001 → SYS-0001`.

## 1. Nominal

| # | Niv. | Action | Attendu | CA |
|---|------|--------|---------|----|
| N1 | S | Aucune modification | `changedRequirements: []`, `heads` = HEAD de `prod` et `comp` | CA1 |
| N2 | S | Modifier `fields.statement` de `SYS-0001` (unstaged) | 1 élément `SYS-0001` modified, `changedFields` = [`fields.statement`] ; descendant contient `TEST-0001` et `SYS-0002` (avec `TEST-0002` sous lui) | CA3 |
| N3 | S | Idem N2 mais `git add` (staged) | Même résultat que N2 | CA3 |
| N4 | S | Créer `SYS-0003.yaml` non suivi + lien `SYS-0003 → SYS-0001` dans links.yaml | `SYS-0003` added ; son arbre montant contient `SYS-0001` | CA3, CA4 |
| N5 | S | Supprimer `SYS-0002.yaml` | `SYS-0002` removed, arbres vides, `title` = titre à HEAD | CA3 |
| N6 | S | Modifier `steps` de `TEST-0001` (section racine du YAML) | 1 élément `elementType: 'test_case'`, `changedFields` = [`steps`] ; descendant vide ; montant = `SYS-0001` | CA3 |
| N7 | S | Modifier `TEST-0002` (lien créé depuis l'exigence) | Montant = `SYS-0002` puis `SYS-0001` (lien de couverture suivi dans le sens exigence → test) | CA3 |
| N8 | S | Modifier `MC-0001` dans `comp` | Élément `MC-0001` avec `repo.name` = nom du composant ; arbre montant = `SYS-0001` (sans `repo`, repo racine) | CA5 |
| N9 | S | Supprimer localement le lien `TEST-0001 → SYS-0001` + modifier `SYS-0001` | `TEST-0001` absent de l'arbre descendant de `SYS-0001` | CA4 |
| N10 | S | Modifications N2 + N6 + N8 simultanées | Tri : `SYS-0001`, `TEST-0001` (repo racine, par id) puis `MC-0001` | CA3 |
| N11 | M | N2 dans l'app, ouvrir la vue Analyse d'impact | Entrée « Modifications locales (vs HEAD) » en tête, sélectionnée ; page = `SYS-0001` + arbres, sans sélecteur de statut ni export ni campagne | CA1, CA2, CA6 |
| N12 | M | Vue ouverte sur l'analyse locale, modifier `SYS-0002` dans l'app | ≤ 5 s après : `SYS-0002` ajoutée à la liste | CA7 |
| N13 | M | Vue ouverte sur l'analyse locale, Publier | Entrée disparaît, page revient au message d'invite | CA7 |
| N14 | M | Clic sur un élément d'un composant (arbre ou racine) | Le popup lecture seule s'ouvre sur le bon élément (repo du composant) | CA5 |
| N15 | M | Bouton Rafraîchir | Recalcul immédiat (heure « Calculée à » mise à jour) | CA7 |

## 2. Cas limites

| # | Niv. | Action | Attendu | CA |
|---|------|--------|---------|----|
| L1 | S | Seul `links/links.yaml` modifié | `changedRequirements: []` | spec U6 |
| L2 | S | Seuls `parameters/parameters.yaml`, `.polenta/…`, `impact-analyses/x.yaml` modifiés | `[]` | spec U7, U12 |
| L3 | S | `SYS-0001.yaml` réécrit avec les mêmes valeurs mais un autre formatage YAML | `[]` (identique champ à champ) | CA3 |
| L4 | S | Fichier `requirements/README.md` ajouté | Ignoré (non `.yaml`) | CA3 |
| L5 | S | YAML illisible (`requirements/SYS-0009.yaml` invalide, non suivi) | Pas d'échec de l'analyse ; signalé « ajoutée » sans détail (id = nom de fichier) | — |
| L5b | S | `SYS-0001.yaml` existant rendu invalide | Signalée « modifiée » (pas « supprimée »), titre de HEAD, arbres calculés | — |
| L6 | S | Repo sans aucun commit | `[]` pour ce repo, pas d'exception | — |
| L7 | S | Cycle de liens `SYS-0001 ↔ SYS-0002` + modification de `SYS-0001` | Terminaison, chaque élément une seule fois par élément changé | CA4 |
| L8 | S | Pas de `workspaceDir` (mono-repo) | Seul le repo racine est analysé | — |
| L9 | S | Après N2, vérifier `git status` | Aucun fichier créé/modifié par l'analyse | CA6 |
| L10 | M | Analyse enregistrée sélectionnée, puis modification locale | L'analyse enregistrée reste affichée ; entrée locale en tête non sélectionnée | CA2 |
| L11 | M | Analyse locale auto-sélectionnée, l'utilisateur clique dessus pour la désélectionner | Reste désélectionnée aux rafraîchissements suivants | CA2 |
| L12 | M | Repo propre, ouvrir la vue | Pas d'entrée locale, « Aucune analyse » si liste vide | CA1 |
| L13 | M | Repo sélectionné = composant dans le panneau Version, modification dans le produit | L'entrée locale apparaît quand même (analyse enracinée sur le repo racine) | CA1 |

## 3. Non-régression T46

| # | Niv. | Action | Attendu | CA |
|---|------|--------|---------|----|
| R1 | M | Créer une analyse entre deux baselines, changer des statuts, générer une campagne, exporter xlsx/pdf, supprimer | Identique à avant T175 | CA8 |
| R2 | M | Rouvrir une analyse `impact-analyses/*.yaml` créée avant T175 | S'affiche correctement (champs optionnels absents) | CA8 |
| R3 | S | `createImpactAnalysis` sur deux baselines où `TEST-0002` couvre `SYS-0002` via lien créé depuis l'exigence | `TEST-0002` présent dans l'arbre de `SYS-0002` (correction du sens de lien) | CA8 |

## 4. Vérifications statiques

- `pnpm --filter desktop typecheck` : zéro erreur nouvelle.
- Clés i18n présentes dans `fr.json` et `en.json` (CA9).
- `grep -rn "impact-analyses" apps/desktop/src/main/services/traceability.service.ts` : aucune
  écriture dans `computeLocalImpactAnalysis`.
