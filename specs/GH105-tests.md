# GH105 — Scénarios de test

Fixture commune (unitaire et e2e) : workspace de 3 repos.

- `prod` (racine) : nœud `root`, types `root::P_REQ` (requirement), `root::P_TEST` (test) ;
  `linkTypes` : `implements` (`root::P_REQ` → `root::C_REQ`), `verifies` (`root::P_REQ` →
  `root::P_TEST`), `refines` (`root::C_REQ` → `root::P_REQ`).
- `comp` (composant modifiable, sur une branche) : `root::C_REQ`, sans `linkTypes`.
- `pinned` (composant épinglé sur un SHA, HEAD détaché) : `root::K_REQ`.
- Objets : `P_REQ-0001`, `P_TEST-0001`, `C_REQ-0001` (**non commité**), `K_REQ-0001`.

## Nominaux (golden path)

| # | Scénario | Attendu |
|---|---|---|
| N1 | Candidats de `implements` depuis `P_REQ-0001` | `C_REQ-0001` proposé, libellé du repo `comp` ; `P_TEST-0001` absent |
| N2 | Créer `implements` `P_REQ-0001` → `C_REQ-0001` depuis `P_REQ-0001` | ligne ajoutée dans `prod/links/links.yaml` ; `comp/links/links.yaml` inchangé |
| N3 | Même lien créé depuis `C_REQ-0001` (repo `comp` sélectionné) | écrit dans `prod/links/links.yaml` (source = `P_REQ`) |
| N4 | Ouvrir `P_REQ-0001` | lien `implements` avec titre et statut de `C_REQ-0001` |
| N5 | Ouvrir `C_REQ-0001` (repo `comp`, sans `linkTypes`) | lien affiché avec `labelTargetToSource` dans Édition, Excel (colonne `link::implements`), Word |
| N6 | Supprimer le lien depuis `C_REQ-0001` | ligne retirée de `prod/links/links.yaml` |
| N7 | `refines` `C_REQ-0001` → `P_REQ-0001` | écrit dans `comp/links/links.yaml` (source dans `comp`) ; visible sur les deux objets |
| N8 | Clic sur `C_REQ-0001` depuis `P_REQ-0001` | Vue Système sur repo `comp`, type `C_REQ`, objet ouvert ; « ← Retour » → `P_REQ-0001` dans `prod` |
| N9 | Ctrl+clic | nouvel onglet `/req/C_REQ-0001` sur le repo `comp` |
| N10 | Couverture de `P_REQ-0001` liée à un test stocké dans un autre repo | `coverageStatus` en tient compte |

## Cas limites

| # | Scénario | Attendu |
|---|---|---|
| L1 | Cible dans `pinned` (`implements` étendu à `root::K_REQ`) | `K_REQ-0001` candidat en cible ; lien écrit dans `prod` |
| L2 | Source dans `pinned` (type `K_REQ` → `P_REQ`) | `K_REQ-0001` absent des candidats côté source ; IPC direct → `READONLY_REPO`, repo nommé |
| L3 | Lien stocké dans `pinned` (fichier préexistant) affiché sur `P_REQ-0001` | bouton supprimer désactivé, infobulle ; IPC direct → `READONLY_REPO` |
| L4 | Lien vers un ID absent de `W` | ID brut + badge « introuvable », pas d'erreur |
| L5 | Doublon (même type, mêmes objets, sens inverse) dans le repo de stockage | `DUPLICATE_LINK`, rien n'est écrit |
| L6 | Collision `root::` : `prod` déclare aussi un type `root::C_REQ` | une ref `root::C_REQ` de `prod` ne vise que les objets de `prod` (D2) |
| L7 | Ref par catégorie (`targetRefs: [test]`) | tests de tous les repos de `W` |
| L8 | Type de lien de même nom dans `prod` et `comp` | celui de `prod` utilisé, `console.warn` |
| L9 | Projet mono-repo (pas de `workspaceDir`) | comportement identique à aujourd'hui |
| L10 | Composant ajouté au workspace puis objet créé dedans | candidat sans redémarrage (invalidation) |
| L11 | Lien dont l'ID existe dans deux `links.yaml` | affiché une seule fois (racine prioritaire) |
| L12 | Client web | nouveaux channels autorisés, `workspaceDir` hors espace utilisateur refusé (`ROOT_ARGS`) |
| L13 | MCP `create_links` source dans `comp` | écrit dans `comp/links/links.yaml` ; source dans `pinned` → erreur par entrée |

## Critères vérifiables (renvoi aux critères d'acceptation de la spec)

- Unitaires (S1) : N2, N3, N6, N7, L2, L3, L5, L6, L7, L8, L9, L11, L13 sur
  `WorkspaceLinksService` / `link-validation.util` / `links.tools`.
- e2e web (S2, `gh105-cross-repo-links.spec.ts`) : N1, N4, N5, N6, N8, L1, L3, L4.
- Manuels (S2, PH2) :
  - **M1** — `handstickProduct`, une `PRODUCT_REQ` : `implements` propose `HMI_PH2_REQ-0001/0002`
    (« bla bla », « bla bla bla », `HMI VE22D`) ; créer le lien → `handstickProduct/links/links.yaml`.
  - **M2** — `hmi-PH2`, `HMI_PH2_REQ-0001` : le lien apparaît (Édition, Excel, Word) ; clic → la
    `PRODUCT_REQ` dans `handstickProduct` ; « ← Retour ».
  - **M3** — `hmi-PH2` épinglé (`c831de5`) : lien affiché, suppression depuis la `PRODUCT_REQ`
    possible, depuis la `HMI_PH2_REQ` aussi (stockage dans le produit, modifiable).
