# T110 — Sprint 1 / 3

Périmètre : catalogue de rôles + rôles joués par le parent, dans la popup d'édition de
**n'importe quel** nœud dépendance (`AddDependencyModal.tsx` en mode édition, branché depuis
`StructureTab.tsx`). Conforme à `specs/T110-design.md` §Sprint 1.

## Fichiers modifiés

- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` :
  - `AddDependencyValues.roles: string` (CSV, `kind === 'interface'` uniquement) remplacé par
    `catalogRoles: RoleDefinition[]` et `parentRoles: string[]`, disponibles en mode édition quel
    que soit `kind` (plus de branche conditionnelle — cf. « problème d'œuf et de poule » du design :
    `kind` dérive de `node.isInterface`, lui-même dérivé de `schema.roles` non vide, donc un repo
    jamais encore interface ne pourrait jamais le devenir si la section catalogue restait gatée
    dessus).
  - Nouvelle section **« Rôles exposés par ce repo »** (visible en édition) : tableau éditable
    nom/label + suppression, réutilise `thClass`/`tdClass`/`ConfirmDelete` de `objectTypeEditor.tsx`
    (même pattern que l'ancien `InterfacesTab`, `schema.tsx:243-277`).
  - Nouvelle section **« Rôles joués par {parent} »** (visible si le catalogue ou les rôles joués
    ne sont pas tous les deux vides) : cases à cocher sur le catalogue ci-dessus (calculées
    localement, sans round-trip réseau), plus les rôles hérités hors catalogue (legacy texte libre
    pré-T110, ou catalogue vidé depuis) affichés séparément avec un badge « hors catalogue » et
    leur propre case de retrait — jamais purgés silencieusement.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` :
  - `handleSubmitDependency` (ajout d'une nouvelle dépendance interface) : le catalogue se saisit
    désormais en édition uniquement, donc l'ajout monte la dépendance sans rôle initial
    (`roles: values.parentRoles`, vide à l'ajout).
  - `handleOpenEditDependency` : `catalogRoles` pré-rempli depuis `childSchema?.roles ?? []`,
    `parentRoles` depuis `parentSchema?.implements?.find(...).roles ?? []`, pour tout nœud (plus de
    condition sur `node.isInterface`).
  - `handleSubmitEditDependency` : écrit `roles: values.catalogRoles` dans le schema.yaml de
    l'enfant (omis, pas `[]`, quand vide — voir Divergences) ; appelle `updateInterfaceRoles` côté
    parent quand il y a un rôle joué à écrire ou à préserver (voir Divergences pour la condition
    exacte, corrigée deux fois par rapport à la première version).

## Comportement implémenté

Conforme au design après trois corrections (voir Divergences). Éditer n'importe quelle dépendance
(composant ou interface, jamais interface y compris) permet désormais de lui déclarer un premier
catalogue de rôles et de sélectionner par cases à cocher les rôles joués par le parent — plus de
texte libre, plus de dépendance à `kind`. Un repo jamais marqué interface le devient dès qu'un
premier rôle est ajouté à son catalogue et sauvegardé (`node.isInterface` recalculé au prochain
chargement de l'arbre, vérifié à l'écran — badge violet « Interface » apparu après coup).

## Divergences par rapport au design

Trois bugs trouvés et corrigés, aucun présent dans le design lui-même (les deux premiers par
`/code-review`, le troisième par vérification manuelle dans l'app réelle — absent des deux passes
précédentes) :

1. **Bug réel (`/code-review`)** : le retrait explicite du dernier rôle hérité hors catalogue (case
   décochée) ne se persistait pas quand le catalogue était vide — la condition d'écriture côté
   parent se basait uniquement sur les valeurs finales (`catalogRoles.length > 0 ||
   parentRoles.length > 0`), toutes deux vides après le retrait. Corrigé en comparant aussi à
   `editingDependency.initialValues.parentRoles.length > 0`.
2. **Bug réel (`/code-review`)** : `roles: values.catalogRoles` était écrit sans condition dans le
   schema.yaml de l'enfant, ajoutant `roles: []` à chaque sauvegarde d'un composant ordinaire (même
   un simple changement de label), contrairement à la convention déjà en place ailleurs dans ce
   fichier (`schema.tsx:85`, `if (state.roles.length > 0) schema.roles = state.roles`). Corrigé :
   `roles` n'est écrit que si `catalogRoles.length > 0`, sinon la clé est supprimée (`delete
   nextChildSchema.roles`) plutôt que mise à `[]`.
3. **Bug réel, trouvé en vérification manuelle (absent des deux revues précédentes)** : donner un
   premier rôle au catalogue d'une interface, **sans cocher aucune case « Rôles joués »**, créait
   quand même une entrée `implements: [{interface: ..., roles: []}]` côté parent — la condition
   d'écriture (issue du design lui-même, `T110-design.md` ligne 27 : `catalogRoles.length > 0 ||
   parentRoles.length > 0`) déclenchait l'écriture parent sur la seule taille du catalogue, qui n'a
   pourtant aucun rapport avec ce que le parent joue. Reproduit et confirmé dans l'app (build +
   pilotage automatisé) : `schema.yaml` du parent gagnait une entrée `implements` jamais demandée
   par l'utilisateur dès qu'un rôle était ajouté au catalogue de l'enfant. Corrigé : la condition ne
   regarde plus que `parentRoles` (finale ou initiale), plus `catalogRoles.length`.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop build`, ouvrir un workspace avec au moins une dépendance montée
   (composant ou interface) dans Structure.
2. Cliquer le crayon d'édition d'une dépendance **jamais marquée interface** : vérifier la section
   « Rôles exposés par ce repo » (vide, `+ Ajouter un rôle`) et l'absence de section « Rôles joués »
   tant qu'aucun rôle n'existe. Enregistrer sans rien toucher → `schema.yaml` de ce repo ne doit
   **pas** gagner de clé `roles`.
3. Ajouter un rôle au catalogue (nom + label), enregistrer **sans cocher** la case « Rôles joués »
   qui vient d'apparaître → le `schema.yaml` du **parent** ne doit **pas** gagner d'entrée
   `implements` pour ce nœud. Actualiser l'arbre → le nœud affiche désormais le badge violet
   « Interface ».
4. Rouvrir l'édition, cocher le rôle → enregistrer → `implements[].roles` du parent contient bien ce
   rôle.
5. Sur une dépendance ayant un rôle hérité hors catalogue (« hors catalogue », catalogue vide),
   décocher ce rôle → enregistrer → `implements[].roles` du parent devient `[]` (pas de résidu).

## Statut

TypeScript : 0 erreur (`pnpm --filter @polenta/desktop typecheck`). Pas de script `lint` configuré
sur ce projet (aucun eslint config trouvé — vérifié, pas une omission de ce sprint). `/code-review`
(effort medium, mené directement en session plutôt qu'en 8 sous-agents vu la taille réduite du
diff) : 2 findings CONFIRMED, corrigés. Testé manuellement dans l'app réelle (build + pilotage
automatisé, Playwright `_electron`) sur un workspace jetable dédié (1 produit + 1 composant + 2
interfaces, dont une avec rôle hérité hors catalogue pré-seedé pour simuler un état pré-T110) — a
révélé un 3ᵉ bug (voir Divergences #3) absent des deux revues précédentes, corrigé et re-vérifié.
Artefacts de test nettoyés (`C:\tmp\t110-verify`, screenshots, user-data Electron). Rien de ce
répertoire de test n'est commité. Sprints 2 et 3 restants (voir `specs/T110-design.md`).
