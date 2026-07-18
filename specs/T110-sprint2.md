# T110 — Sprint 2 / 3

Périmètre : section « Interfaces implémentées » dans la popup d'édition de **n'importe quel** nœud
dépendance (`AddDependencyModal.tsx` en mode édition, branché depuis `StructureTab.tsx`). Conforme
à `specs/T110-design.md` §Sprint 2.

## Fichiers modifiés

- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` :
  - `AddDependencyValues.implementsList: ImplementsDeclaration[]` (édition uniquement).
  - Nouvelles props `resolveInterfaceRoles?`/`resolveInterfacePin?` — la modale reste un composant
    de présentation pure, fournies par `StructureTab` qui a déjà `flatNodes`/`schemasByRepoPath` en
    mémoire (repris du design, alternative « fetch direct dans la modale » explicitement rejetée).
  - Nouvelle section **« Interfaces implémentées »** (visible en édition) : une ligne par entrée
    `{interface, roles}` — nom de montage en texte libre, « Version implémentée » en lecture seule
    résolue via `resolveInterfacePin`, rôles par cases à cocher si `resolveInterfaceRoles` renvoie un
    catalogue non vide pour ce nom, sinon champ texte libre (fallback identique à l'ancien
    `InterfacesTab`, `schema.tsx:328-336`).
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` :
  - `handleOpenEditDependency` : `implementsList` pré-rempli depuis `childSchema?.implements ?? []`,
    pour tout nœud.
  - `resolveInterfaceRoles`/`resolveInterfacePin` : cherchent par nom dans `flatNodes` (pas par
    `repoPath` seul — un mount name est unique dans le workspace, T74) puis lisent
    `schemasByRepoPath`/`pin`, même troncature de pin que l'arbre Structure (`RepoRow`).
  - `handleSubmitEditDependency` : écrit `implements: values.implementsList` dans le schema.yaml de
    l'enfant, omis (pas `[]`) quand vide — même convention que `roles` (sprint 1), appliquée ici dès
    l'écriture pour ne pas reproduire le bug équivalent.

## Comportement implémenté

Conforme au design, aucune divergence. Éditer n'importe quel nœud (composant ou interface) permet
de déclarer les interfaces qu'il implémente lui-même, indépendamment de son propre catalogue de
rôles (les deux notions cohabitent dans la même popup). Le nom de montage saisi résout en direct
(sans requête réseau) le catalogue de rôles de l'interface ciblée si elle est montée localement —
vérifié dans l'app réelle : taper un nom de montage existant fait apparaître les cases à cocher du
catalogue immédiatement, avec le pin résolu affiché en regard.

## Point non traité, jugé hors scope

La section « Rôles joués » du sprint 1 affiche séparément tout rôle hérité qui ne correspond à
aucune entrée du catalogue (badge « hors catalogue », retrait explicite) — la section « Interfaces
implémentées » de ce sprint n'a pas cet affichage : si `impl.roles` contient un nom qui ne
correspond à aucun rôle du catalogue résolu, il reste dans les données (aucune perte, `roles` n'est
jamais réécrit que par ajout/retrait du rôle explicitement coché) mais devient invisible et non
gérable depuis cette section tant que le catalogue est non vide. Absent du design (`T110-design.md`
Sprint 2 ne mentionne ce garde-fou que pour le sprint 1), et sans perte de données réelle — non
corrigé, à traiter dans un futur ticket si un projet réel le rencontre.

## Comment tester manuellement

1. Éditer un nœud, section « Interfaces implémentées » → « + Déclarer une implémentation ».
2. Saisir le nom de montage d'une interface montée localement avec un catalogue non vide → vérifier
   l'apparition des cases à cocher + le pin résolu dans « Version implémentée ».
3. Cocher un rôle, enregistrer → vérifier `implements[].roles` dans le schema.yaml du nœud édité.
4. Éditer un nœud sans aucune implémentation déclarée, enregistrer sans toucher la section →
   vérifier l'absence de clé `implements` dans son schema.yaml (pas de `[]` superflu).
5. Saisir un nom de montage qui ne correspond à aucun repo connu → vérifier le fallback en champ
   texte libre pour les rôles et « non résolu » pour la version.

## Statut

TypeScript : 0 erreur. Revue de code menée directement en session (diff de taille réduite) : aucun
bug de la classe des trois corrigés en sprint 1 — la convention « omettre plutôt que `[]` » a été
appliquée d'emblée. Testé manuellement dans l'app réelle (build + pilotage automatisé) sur un
workspace jetable dédié (1 produit + 1 composant + 1 interface avec catalogue réel) : résolution du
catalogue en direct, pin affiché, persistance vérifiée dans les deux schema.yaml concernés,
absence de pollution `implements: []` sur sauvegarde à vide. Artefacts de test nettoyés. Sprint 3
restant (voir `specs/T110-design.md`).
