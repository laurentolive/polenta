# GH46 — Scénarios de test

Chaque critère d'acceptation de `specs/GH46.md` a au moins un test. Les cas limites sont listés à part.

## Unitaires (vitest)

| Test | Fichier | Couvre |
|---|---|---|
| Script : SHA-256 (test vectoriel, casse, valeur épinglée valide) | `scripts/drawio-editor-lib.test.ts` (fonctions pures de `fetch-drawio-editor.ts`) | §1.2, AC10 |
| Script : élagage (préfixes, suffixes, exact), service worker conservé, `index.html` gardé | idem | §1.2, AC10 |
| Script : chemins d'entrée du zip refusés (`..`, absolu, lecteur) | idem | §1.2 |
| `web:drawio-save` refuse un chemin hors `diagrams/` (`../x.drawio`, absolu, lien symbolique sortant) | `drawio-edit.service.test.ts` | AC8 |
| `web:drawio-save` refuse un XML non mxfile, n'écrit rien | idem | §5 |
| `web:drawio-save` renvoie `conflict` si le SHA-256 courant ≠ `baseHash`, ne modifie rien | idem | AC7 |
| `web:drawio-save` écrit atomiquement, le fichier relu = XML envoyé (deux pages incluses) | idem | AC3, AC6 |
| `web:drawio-open` renvoie `baseHash` = SHA-256 des octets | idem | AC7 |
| Canaux `web:drawio-*` classés dans `channel-policy` (le test existant échoue sinon) | `channel-policy.test.ts` | §3.1 |
| Messages : seul `event.source === contentWindow` et `origin === location.origin` est accepté | `src/renderer/lib/drawioEmbedProtocol.test.ts` | §2 (sécurité) |
| Protocole : messages `load` / `export` (XML), événements `init` / `load` / `exit`, réponses hors XML ignorées | idem | §2 |
| URL de l'éditeur : mode embarqué, hors ligne, sans boutons de l'éditeur, aucun hôte externe | idem | §1.4 |

Pas de test unitaire du composant `DrawioEditorDialog` : son comportement (ouverture, enregistrement,
conflit, fermeture, `beforeunload`) est couvert par les e2e GH46-1 à GH46-7 ci-dessous.
`GRAPH_WRITE_CHANNELS` n'est pas concerné (lecture et écriture directes, sans cache : §3.1).

## End-to-end (Playwright, `apps/desktop/e2e-web/gh46-drawio-edit.spec.ts`)

Un diagramme `diagrams/gh46.drawio` (deux pages) est créé avec `requirements:create`-like helpers.

| Test | Critère |
|---|---|
| GH46-1 — bouton « Modifier » présent sur un diagramme d'une exigence, absent sur un nœud `readonly` | AC1 |
| GH46-2 — pendant ouverture, édition (ajout d'une forme via l'éditeur) et enregistrement : aucune requête vers `diagrams.net` / `app.diagrams.net` / `embed.diagrams.net` (interception `page.route`) | AC2 |
| GH46-3 — modifier puis « Enregistrer » : `drawio:read` relit la forme ajoutée ; le bloc affiche la nouvelle version | AC3 |
| GH46-4 — « Fermer » sans enregistrer : SHA-256 du fichier identique avant/après | AC4 |
| GH46-5 — modifié sans enregistrer, fermeture de l'onglet : `beforeunload` armé ; après fermeture de l'éditeur : désarmé (AC5 tel qu'écrit en §3.3 du design) | AC5' |
| GH46-6 — fichier à deux pages : après enregistrement, `drawio:read` renvoie deux pages | AC6 |
| GH46-7 — fichier modifié par un tiers (écriture hors Polenta) pendant l'édition : « Enregistrer » → message de conflit, fichier du tiers conservé | AC7 |
| GH46-8 — bureau : « Ouvrir dans Draw.io » (desktop) inchangé — couvert par les tests desktop existants | AC9 |

Les e2e sont lancés sur le build web (`pnpm build:web` puis `npx playwright test e2e-web/gh46-`).

## Cas limites (unitaires ou e2e selon le coût)

- Éditeur qui ne répond pas (pas d'`init`) : message après 20 s. Non couvert par un test automatique.
- Session expirée (401) pendant l'enregistrement : message « rien n'a été écrit ». Non couvert par un test automatique.
- Fichier supprimé pendant l'édition : `refused` côté service (`drawio-edit.service.test.ts`, cas « fichier absent »).
  Le message pendant l'édition n'est pas couvert par e2e.

## Vérifications de niveau 1 et 2

- `pnpm typecheck`, `pnpm lint` (sur les fichiers touchés), `npx vitest run` sur les fichiers ci-dessus.
- `pnpm test` complet (une fois, en fin de sprint 2).
- `pnpm build:web` puis `npx playwright test e2e-web/gh46-` (niveau 2).
- La suite e2e complète n'est pas lancée ici (niveau 3, réservée au push de `main`).

## Non couvert par les tests (à vérifier à la main par l'humain)

- Édition réelle d'un diagramme complexe (formes personnalisées, images, multi-pages volumineux).
- Recherche d'icônes (appelle `icons.diagrams.net` : hors AC2).
- Comportement sur un navigateur autre que Chromium.
