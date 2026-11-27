# GH54 — Scénarios de test

Chaque critère de `specs/GH54.md` a au moins un test. D8 est hors ticket : pas de test.

## Unitaires (vitest)

Fichier : `src/main/services/export-template-library.gh54.test.ts`.

| Test | Couvre |
|---|---|
| `importFile` : un `.docx` valide est écrit à la racine de la bibliothèque, contenu identique (SHA-256) | AC1, AC2 |
| `importFile` : nom déjà présent, `replace` faux → `exists`, fichier existant inchangé | AC3 |
| `importFile` : `replace` vrai → contenu remplacé, écriture atomique (aucun `.tmp` restant) | AC3 |
| `importFile` : archive ZIP sans `word/document.xml` → `refused`, rien écrit | AC5 |
| `importFile` : fichier non ZIP (texte) → `refused`, rien écrit | AC5 |
| `importFile` : `xlsx` sans `xl/workbook.xml` → `refused` ; `xlsx` valide → `ok` | AC5, D2 |
| `importFile` : extension `.pdf` ou `.docx` pour un format `xlsx` → `refused` | D2 |
| `importFile` : nom avec `..`, séparateur, préfixe `.` ou `~$` → `refused` | AC7 |
| `importFile` : dossier de bibliothèque non configuré → `refused` | §1.1 |
| `deleteFile` : gabarit existant supprimé du disque | AC4 |
| `deleteFile` : `..`, absolu, hors bibliothèque, inexistant → `refused`, rien supprimé | AC7 |
| `installExamples` : un fichier existant n'est jamais réécrit (test existant inchangé) | AC9 |

Fichiers de test : un `.docx` valide généré avec PizZip (`word/document.xml` minimal) ; un ZIP sans partie
principale ; un texte. Le dossier de bibliothèque est un dossier temporaire par test.

Canaux : `web-server/channel-policy.test.ts` (existant) doit passer avec les deux nouveaux canaux classés
dans `WEB_ONLY_CHANNELS` (AC10 côté serveur).

## End-to-end (Playwright, `apps/desktop/e2e-web/gh54-template-library.spec.ts`)

Le fichier envoyé est un exemple livré (`resources/export-templates`), pour que le test ne dépende d'aucun
binaire ajouté au dépôt.

| Test | Critère |
|---|---|
| GH54-1 — Préférences, bloc bibliothèque : « Ajouter un gabarit » envoie l'exemple ; il apparaît dans la liste Word sans rechargement | AC1 |
| GH54-2 — l'octet d'un gabarit envoyé est identique au fichier source (SHA-256 du fichier dans `userData/export-templates`) | AC2 |
| GH54-3 — renvoi du même nom : dialogue de remplacement ; « Annuler » ne modifie rien (SHA-256 inchangé) | AC3 |
| GH54-4 — « Remplacer » : le contenu sur disque est celui du nouvel envoi | AC3 |
| GH54-5 — « Supprimer » : dialogue avec le nom ; après confirmation, le fichier disparaît du disque et de la liste | AC4 |
| GH54-6 — suppression d'un gabarit référencé par la préférence du projet : le dialogue l'indique | AC4 |
| GH54-7 — fichier non valide envoyé (texte renommé `.docx`) : message de refus, aucun fichier ajouté | AC5 |
| GH54-8 — fichier de plus de 20 Mo : message « Fichier trop volumineux (max 20 Mo). » | AC6 |
| GH54-9 — export Word avec le gabarit ajouté : le téléchargement est produit | AC8 |
| GH54-10 — desktop : aucun bouton d'ajout ni de suppression (couvert par le test de capacité `webTemplateLibrary` faux, ou par les e2e desktop existants) | AC10 |

GH54-8 écrit un fichier de 21 Mo dans le dossier temporaire du test, puis le supprime.

## Vérifications de niveau 1 et 2

- `pnpm typecheck`, `pnpm lint` sur les fichiers touchés.
- `npx vitest run` sur le fichier gh54 et `channel-policy.test.ts`.
- `pnpm test` complet (fin de sprint 2).
- `pnpm build:web` puis `npx playwright test e2e-web/gh54-`.

## Non couvert

- Édition de la bibliothèque depuis un autre navigateur ou une autre session (cohérence de la liste) : à
  vérifier à la main.
- Le dialogue de confirmation sur clavier seul : non testé.
