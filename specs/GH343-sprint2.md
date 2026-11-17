# GH343 — Sprint 2 : glisser un onglet

Spec : `specs/GH343.md` §1 (D1, D2). Design : `specs/GH343-design.md` §Sprint 2.

## Comportement implémenté

- **Réordonner** : glisser un onglet entre deux autres de la même barre (indicateur d'insertion) —
  desktop et web.
- **Vers une autre fenêtre** (desktop) : lâché sur la barre d'onglets d'une fenêtre du même projet,
  l'onglet y est inséré à l'emplacement du lâcher et activé, et la fenêtre passe au premier plan ;
  il quitte la fenêtre d'origine, qui se ferme si c'était son dernier onglet. Fenêtre à l'accueil :
  acceptée, l'onglet remplace son onglet d'accueil et la fenêtre ouvre le projet. Fenêtre d'un autre
  projet : refusé (curseur « interdit »).
- **Hors des fenêtres** : nouvelle fenêtre à l'endroit du lâcher, à la taille de la fenêtre
  d'origine, avec cet onglet ; dernier onglet d'une fenêtre : rien. Lâché sur le contenu d'une
  fenêtre : rien.
- **Ce qui suit l'onglet** : page, titre, historique Précédent / Suivant et position dedans, saisie
  non sauvegardée (exigence, test, Schéma, édition des champs d'une campagne, éditeur de fichier
  d'un diff) avec son point « modifié ». Saisies à enregistrement automatique enregistrées au départ
  du glisser. Exigence / test : la saisie est réconciliée à l'arrivée avec l'objet relu (bandeau
  « modifié ailleurs » de GH342 si un champ saisi a changé entre-temps). Fenêtre d'arrivée déjà sur
  la même page : la saisie est remise directement à l'éditeur affiché.

## Mécanisme

Glisser HTML5 natif ; le `dataTransfer` ne porte que l'id du glisser (`application/x-polenta-tab`).
Le contenu passe par le main (`main/host/tab-drag.ts`, registre testable sans Electron) :

| Channel | Rôle |
|---|---|
| `app:tab-drag-start(id, payload)` | la source décrit l'onglet (`TabDragPayload`, `shared/tab-drag.ts`, contrôlé : forme, ≤ 5 Mo) |
| `app:tab-drag-ready(id)` | enregistrements automatiques de la source terminés |
| `app:tab-drag-info()` | la fenêtre survolée accepterait-elle le glisser en cours (D2) ? |
| `app:tab-drag-take(id)` | prise par la cible (attend `ready` ≤ 2,5 s) ; la source reçoit `app:tab-moved` |
| `app:tab-drag-end(id, dropped)` | fin du geste ; lâché hors des fenêtres → `createAppWindow({ adopt })` |

Renderer : `TabsContext` (`moveTab`, `detachTab`, `adoptTab`, `snapshotTab`, onglet de démarrage
`lib/bootTab.ts`), `TabBar` (geste), `lib/tabDraft.ts` (saisie transférable, un éditeur déclaré à
la fois, reprise une fois par l'éditeur de même clé), `main.tsx` (`__adopt`).

## Fichiers modifiés

Main : `host/tab-drag.ts` (+ test), `host/app-windows.ts`, `ipc/channels.ts`,
`ipc/desktop-only.handlers.ts`. Partagé : `shared/tab-drag.ts`. API : `packages/api-client`.
Renderer : `contexts/TabsContext.tsx`, `components/layout/TabBar.tsx`, `main.tsx`,
`lib/tabDraft.ts` (+ test), `lib/bootTab.ts`, `lib/draftSync.ts`, `routes/schema.tsx`,
`routes/campaign.$campaignId.tsx`, `components/diff/FileDiffView.tsx`.
e2e : `e2e-desktop/gh343-drag.spec.ts` (T25–T32), `e2e-web/gh343-projects.spec.ts` (T24).

## Divergences par rapport au design

- L'id du glisser est créé par le renderer (le `dataTransfer` doit être rempli pendant `dragstart`,
  avant toute réponse du main) ; le main le contrôle.
- `app:tab-drag-info` ne prend pas d'id (illisible pendant le survol) : un seul glisser à la fois.
- Pas de `api.app.focusWindow()` : le main met la fenêtre preneuse au premier plan à la prise.
- Remise directe de la saisie à l'éditeur déjà affiché (cas non prévu au design : pas de remontage
  quand la fenêtre d'arrivée est sur la même page).

## Revue de code (PR #382) — suites données

Corrigés : un enregistrement en échec au départ ne coupe plus le lien source ↔ glisser (l'onglet
aurait existé dans deux fenêtres) ; réponse d'acceptation remise à zéro à chaque passage sur la
barre et demandée une fois par passage ; réordonnancement local : glisser libéré tout de suite
côté main ; blur du champ actif par `flushPendingEdits` (plus de prédicat dupliqué).
Laissés, assumés :
- **Échap** pendant un glisser, pointeur hors des fenêtres : Chromium le termine comme un lâcher
  sur le bureau → une nouvelle fenêtre s'ouvre (limite documentée, SPEC-PROJECT-MANAGEMENT §5.1) ;
- le payload est envoyé au main dès le début du geste, même pour un simple réordonnancement (taille
  courante faible ; envoi différé = complexité sans gain mesuré) ;
- menu natif « Fermer le projet » (`useMenuEvents`) : menu désactivé depuis T130, non modifié.

## Mises à jour SPEC

- `SPEC-PROJECT-MANAGEMENT.md` §1 (plusieurs fenêtres, dernier projet ouvert), §5 (fenêtre vide,
  récents, saut au lancement, compte, fermeture du projet, disposition avec l'accueil, client web),
  §5.1 nouveau (glisser un onglet : gestes, ce qui suit, mécanisme, limite), §6 (fermeture
  conditionnelle).
- `SPEC-ELECTRON-DESKTOP.md` §16 (saut au lancement seulement, `__adopt`, paramètre de
  `clear-last-opened`), §19.1 (glisser / réordonner).
- `SPEC-WEB.md` (`__home`, réordonner seulement, `project-shown-elsewhere`).
- `SPEC-ACCOUNTS-AUTH.md` §5 (`current-account(remoteUrl)`, `logout(key)`).
- `SPEC-INDEX.md` : colonne MAJ → GH343 pour ces sections.

## Vérifications

- `pnpm typecheck` : OK. `pnpm lint` : aucun paquet n'a de script `lint` (`turbo lint` : 0 tâche) —
  pas de lint effectif, ni à ce sprint ni au précédent.
- Unitaires desktop : 1926 / 1926.
- e2e desktop `-g "GH343|GH342"` : 28 / 28 (glisser T25–T32, projets T8–T16, GH342).
- e2e web `gh343-`, `gh342-`, `gh228-` : 18 / 18 (ports 8936–8939).
- Non automatisé : le geste réel à la souris (Playwright ne produit pas de glisser système entre
  deux fenêtres ; les e2e envoient les événements de glisser aux barres d'onglets, toute la chaîne
  barre → main → autre fenêtre est réelle).

## Comment tester manuellement (T33–T35)

1. Deux fenêtres sur le même projet (Ctrl+Shift+N) : glisser un onglet de l'une sur la barre de
   l'autre (trait d'insertion, onglet déplacé) ; puis le dernier onglet d'une fenêtre (elle se ferme).
2. Glisser un onglet sur le bureau : nouvelle fenêtre au point de lâcher.
3. Fenêtre sur un autre projet : curseur « interdit » sur sa barre, rien ne bouge.
4. Exigence modifiée sans enregistrer, glissée ailleurs : saisie et point « modifié » présents ;
   même essai avec la vue Édition (enregistrement automatique) : valeur enregistrée.
5. Pendant le glisser, modifier le même champ dans une troisième fenêtre et enregistrer : bandeau
   « modifié ailleurs » à l'arrivée.
