# T106 — Sprint 1 (final)

## Fichiers modifiés

- `apps/desktop/src/main/services/agents-md.template.ts` (nouveau) — constante
  `AGENTS_MD_TEMPLATE`, contenu Markdown générique et indépendant du domaine métier.
- `apps/desktop/src/main/services/workspace.service.ts` — `createNewProject()` écrit
  désormais `AGENTS.md` à la racine du nouveau repo et l'ajoute au commit initial
  `init: create project`, au même titre que `.gitignore`.

## Comportement implémenté

À chaque "Créer un nouveau projet" (`api.workspace.createNew` → IPC
`workspace:createNew` → `WorkspaceService.createNewProject`), le projet créé contient
désormais un `AGENTS.md` à sa racine, commité dès la création. Le contenu documente :
format des objets (frontmatter + Markdown), rôle de `.polenta/schema.yaml` comme
source de vérité du modèle, invariants (`tree.yaml` généré, IDs jamais réutilisés,
`needsRevalidation`), et les 4 usages "system engineering assisté par IA" cités dans
le ticket (review d'exigence, review de test, requêtes/dashboards, vérification des
liens de traçabilité). Le fichier ne cite aucun outil IA en particulier.

`createFromClone` n'a pas été modifié (cf. hors scope de `specs/T106.md`).

## Divergences par rapport au design

Aucune — pas de phase Design séparée pour ce ticket, la spec (`specs/T106.md`)
couvrait directement les décisions techniques (nom du fichier, point d'injection,
contenu) déjà validées avec l'utilisateur en amont.

## Mises à jour SPEC

Aucune section de `specs/SPEC-*.md` ne documentait la création de nouveau projet
avec un contenu de fichiers au-delà de `.gitignore` — pas de section existante à
mettre à jour. `SPEC-TEMPLATES.md` reste inchangé : ce ticket n'introduit pas de
sélection de template, juste un fichier fixe toujours écrit.

## Comment tester manuellement

1. Lancer l'app desktop (`pnpm --filter @polenta/desktop dev`).
2. Écran d'accueil → "Créer un nouveau projet" → choisir un dossier + un nom → Créer.
3. Ouvrir le dossier du projet créé : `AGENTS.md` doit être présent à la racine.
4. `git log -p --stat` dans ce nouveau repo : le commit `init: create project` doit
   inclure `.gitignore` ET `AGENTS.md`.
5. Cloner un projet existant (`createFromClone`) : vérifier qu'aucun `AGENTS.md`
   n'est ajouté automatiquement (comportement inchangé).
