# T110 — Sprint 3 / 3 (dernier sprint)

Périmètre : champ `roles` d'exigence sourcé depuis le catalogue d'interface, suppression de
l'onglet Interfaces, mises à jour SPEC. Conforme à `specs/T110-design.md` §Sprint 3.

## Fichiers modifiés

- `apps/desktop/src/renderer/components/system/EditView.tsx` :
  - `EditView` : requête `useQuery(['schema', repoPath], () => api.schema.get(repoPath!), {enabled: !!repoPath})`
    — une seule par montage de vue, pas par champ ; `interfaceRoles = currentSchema?.roles?.map(r => r.name)`.
  - `FieldControl`/`FieldRow` : nouvelle prop `interfaceRoles?: string[]`, transmise seulement au
    champ dont `field.name === 'roles'` (calculé dans `makeRow`, `EditView`).
  - Cas `'multi_enum'` de `FieldControl` : `opts = (field.name === 'roles' && interfaceRoles?.length) ? interfaceRoles : (field.values ?? [])`
    — spécialisation par nom de champ, pas de nouveau `SchemaFieldType` (décidé dans le design).
- `apps/desktop/src/renderer/routes/schema.tsx` :
  - Suppression de `InterfacesTab` (roles/implements en tableaux + inputs libres) et de l'entrée
    `{ key: 'interfaces', label: 'Interfaces' }` dans `TABS` — `Tab` n'a plus que
    `'structure' | 'liens'`.
  - Imports devenus inutiles retirés (`useWorkspaceStructure`, `thClass`/`tdClass`/`cellInput`).
  - `EditorState.roles`/`.implements` et `schemaToEditable`/`editableToSchema` **conservés
    inchangés** — nécessaires comme représentation en mémoire de `ProjectSchema.roles`/`implements`
    pour que sauvegarder l'onglet Liens ne les efface jamais ; alimentés uniquement par
    `StructureTab` (sprints 1–2) désormais, plus par une UI dédiée dans cette page.
- `specs/SPEC-TEMPLATES.md` §3a/§3b : documente que l'édition se fait désormais depuis la popup
  Structure (plus d'onglet Interfaces dédié), et le comportement du champ `roles` d'exigence.
- `specs/SPEC-REQ-requirements.md` : nouvelle §3.2d documentant la spécialisation du champ
  `multi_enum` nommé `roles`.
- `specs/SPEC-INDEX.md` : colonne `MAJ` → `T110` pour les deux entrées ci-dessus.

## Comportement implémenté

Conforme au design, aucune divergence. Un champ `multi_enum` nommé `roles` affiche désormais les
rôles du catalogue du repo courant (`schema.roles`) au lieu de ses `values:` codées en dur, dès que
ce catalogue est renseigné ; sinon repli identique sur `field.values` (aucune migration requise).
L'onglet « Interfaces » a disparu de `/schema` — `roles`/`implements` s'éditent uniquement depuis
les popups de l'onglet Structure (sprints 1–2).

## Vérification manuelle (app réelle, build + pilotage automatisé)

Workspace jetable dédié (1 repo interface avec catalogue `[device, controller]` et un type
d'exigence dont le champ `roles` déclare `values: [legacy1, legacy2]`) :

1. Onglet `/schema` : confirmé seulement « Structure » et « Liens » dans la barre d'onglets.
2. Création d'une exigence, ouverture en vue document éditable (« Éditer ») : le champ « Roles »
   affiche des cases à cocher **device / controller** (catalogue), pas `legacy1`/`legacy2`.
3. Catalogue vidé (`roles:` retiré du schema.yaml du repo, à la main, pour simuler un projet
   pré-T110) puis rechargement : le même champ affiche à nouveau `legacy1`/`legacy2` — fallback
   confirmé, aucune régression sur un projet sans catalogue.

## Statut

TypeScript : 0 erreur (`pnpm --filter @polenta/desktop typecheck`). Revue de code menée
directement en session : aucun bug trouvé sur ce diff. Testé manuellement dans l'app réelle comme
décrit ci-dessus, sur les deux chemins (catalogue renseigné / catalogue vide). Artefacts de test
nettoyés. **Sprint 3/3 — périmètre complet de `specs/T110-design.md` livré.**

## Critères d'acceptation (`specs/T110.md`) — vérification finale

1. ✅ Catalogue + rôles joués éditables dans la popup Structure de tout nœud (sprint 1).
2. ✅ Déclarations `implements` visibles/éditables dans la même popup, rôles par cases à cocher
   quand le catalogue résout (sprint 2).
3. ✅ Un nouveau repo devient interface en lui ajoutant un premier rôle via Structure, sans onglet
   Interfaces (sprint 1, revérifié en sprint 3 après sa suppression).
4. ✅ Champ `roles` d'exigence sourcé depuis le catalogue du repo courant (sprint 3).
5. ✅ Projet existant avec `values:` codées en dur et catalogue vide : fallback identique, testé
   manuellement (sprint 3).
6. ✅ Onglet « Interfaces » supprimé de `/schema` (sprint 3).
7. ✅ Aucune régression TypeScript sur `apps/desktop` (vérifié à chaque sprint).
