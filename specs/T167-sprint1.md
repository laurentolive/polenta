# T167 — Sprint 1

Réf. : `specs/T167.md`, `specs/T167-design.md`, `specs/T167-tests.md`.

Périmètre livré : infrastructure de partage d'état + liste des résultats en
lecture seule (style Vue Word) + « goto » au clic simple + surbrillance des
occurrences. **L'édition inline (double-clic) est reportée au sprint 2** — le
double-clic conserve pour l'instant l'ouverture des pages détail.

## Fichiers

| Fichier | Nature |
|---|---|
| `apps/desktop/src/renderer/lib/searchQuery.ts` | **nouveau** — utilitaires purs extraits de `SearchPanel.tsx` (`buildRegex`, `findMatches`, `replaceInText`, `getStringFields`, types `SearchResult`/`SearchOpts`/`SearchTypes`/`MatchedField`/`ItemType`) |
| `apps/desktop/src/renderer/contexts/SearchContext.tsx` | **nouveau** — `SearchProvider` + `useSearch()` (throw hors provider) + `useOptionalSearch()` (nullable). Porte requête / options / filtres / résultats calculés / remplacement / cible goto / cible d'édition (inerte au sprint 1). `enabled: !!regex` sur les 3 requêtes de liste |
| `apps/desktop/src/renderer/components/layout/AppLayout.tsx` | montage `<SearchProvider key={currentProjectId} …>` dans la branche `currentProjectId`, sous `SystemViewProvider` |
| `apps/desktop/src/renderer/components/sidebar/SearchPanel.tsx` | refactor **consommateur** du contexte (perte des `useState`/`useQuery`/`useMemo` locaux et des utilitaires). Clic simple sur un résultat → `setGoto(id)` (plus de navigation). Double-clic → `handleOpen` (navigation page détail, transitoire). `ExcerptView`/`ToggleBtn`/`ResultItem` conservés en local |
| `apps/desktop/src/renderer/components/search/SearchResultsDoc.tsx` | **nouveau** — liste plate de `ResultCard` lecture seule (en-tête badge/id/titre/statut/version + champs du type rendus en lecture, richtext via `StaticRichTextViewer`). `useScrollToNode` pour le goto, contour `ring-2 ring-inset ring-status-info-solid`. `HighlightedText` (champs simples + id + titre). Étapes de test rendues en liste lecture seule (pas de `StepsTable`, qui monterait un éditeur TipTap par cellule) |
| `apps/desktop/src/renderer/lib/staticRichText.tsx` | prop optionnelle `highlightRegex` + effet : `clearSearchHighlights` (retire les `<mark data-search-hl>` du passage précédent — `html` inchangé quand seul `regex` change) puis `highlightTextNodes` (TreeWalker, ignore `pre`/`code`/`.static-drawio`). Inerte sans `highlightRegex` → zéro impact Vue Word |
| `apps/desktop/src/renderer/routes/search.tsx` | aiguilleur : `ViewHeader` + `SearchResultsDoc` si résultats, sinon état vide (`hint`) ou « aucun résultat » (`search.page.noResults`). `useOptionalSearch()` → page d'invite si le provider est absent (route atteinte sans projet) |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `sidebar.search.clickToGoto`, `search.page.noResults`, `search.doc.noField`, `search.doc.expectedResult` |

## Comportement implémenté

- **Zone principale `/search`** : tant que la recherche est vide/invalide → état
  vide inchangé (icône + invite). Recherche valide sans résultat → « Aucun
  résultat pour cette recherche. ». Recherche avec résultats → une carte lecture
  seule par élément, ordre exigences → tests → campagnes (identique au panneau).
- **Carte** : en-tête (badge EX/TC/CA, id, titre, badge statut, `v{n}`) + tous
  les champs du type en lecture ; occurrences surlignées (`<mark>`) dans id,
  titre, champs texte et champs richtext (best effort). Test → section Étapes en
  lecture seule.
- **Clic simple** (panneau **ou** carte) → « goto » : la zone principale défile
  jusqu'à la carte (`data-node-id` = id de l'élément) + contour bleu persistant.
  Plus aucune navigation routeur au clic simple (`/search` conservé).
- **Double-clic** (transitoire sprint 1) → ouverture de `/req/$id`, `/test/$id`
  ou `/campaign/$id`. Sera remplacé au sprint 2 par l'édition inline (exig./tests)
  et conservé pour les campagnes.
- **Partage d'état** : `SearchProvider` monté tant qu'un projet est ouvert → la
  recherche survit à la navigation hors Recherche puis retour. `key={currentProjectId}`
  → remise à zéro au changement de projet.
- **Remplacement** : inchangé côté panneau ; les cartes se rafraîchissent via
  l'invalidation des queries `['requirements'|'tests', repoPath]`.

## Divergences par rapport au design

- Étapes de test : le design mentionnait `StepsTable disabled` ; remplacé par un
  rendu liste + `StaticRichTextViewer` pour éviter N éditeurs TipTap montés en
  lecture (même motif que l'extraction de `StaticRichTextViewer` elle-même).
- `GOTO_OUTLINE_CLASS` / `getStatusClass` : **dupliqués** dans `SearchResultsDoc`
  (constante + helper ~6 lignes), pas d'extraction — `WordView.tsx` non touché
  (option laissée ouverte par le design).

## Corrections issues de `/code-review` (high)

1. `SearchResultsDoc` — `rawFields` déréférencé sans garde : `fields = rawFields ?? {}`
   (campagne sans `objectTypeRef`, `typeDef` non encore chargé, champ de schéma
   absent de l'objet).
2. `staticRichText` — les `<mark>` s'empilaient quand seul `regex` changeait
   (`html` mémoïsé ⇒ innerHTML non réinitialisé par React) : ajout de
   `clearSearchHighlights` avant chaque passe.
3. `routes/search.tsx` — `useSearch()` levait une exception si `/search` était
   atteint sans `SearchProvider` (route restaurée / projet fermé) : passage à
   `useOptionalSearch()` + page d'invite en repli.
4. `SearchResultsDoc` — une occurrence trouvée uniquement dans l'`id` ou le
   `title` n'était pas surlignée : id et titre passent désormais par
   `HighlightedText`.

## Vérifications

- `cd apps/desktop && npx tsc --noEmit -p tsconfig.json` → **0 erreur**.
- `npx electron-vite build` → **OK** (chunk `search-*.js` généré).
- `turbo test` : échoue sur `@polenta/api#test` (`jest` absent du worktree —
  binaire non hoisté), **sans rapport avec T167** (apps/api non touché) ;
  `@polenta/desktop` n'a pas de script `test` (aucun runner renderer configuré).
- `routeTree.gen.ts` : non modifié (chemin de route inchangé).

## Comment tester manuellement (scénarios sprint 1 de `T167-tests.md`)

1. `pnpm --filter @polenta/desktop dev`, ouvrir un projet (idéalement
   `apps/desktop/PL/Product`), activité **Recherche**.
2. Champ vide → zone principale = invite. Saisir un terme fréquent → cartes
   lecture seule à droite, occurrences jaunes, ordre exig./tests/campagnes.
3. Clic simple sur une ligne du panneau → la zone de droite défile + contour
   bleu ; l'URL reste `/search`. Idem clic sur une carte.
4. Décocher « Tests » → cartes tests retirées. `Tout remplacer` → cartes
   rafraîchies.
5. Aller sur Suivi puis revenir sur Recherche → requête + résultats conservés.
6. Regex invalide (`(` en mode `.*`) → zone de droite = invite, erreur dans le
   panneau.
7. Double-clic sur une carte → page détail (comportement transitoire du sprint 1).
8. Vue Système → Vue Word : goto/contour/rendu inchangés (non-régression).

## Reste pour le sprint 2

- `components/search/SearchEditPane.tsx` (câblage `EditView`), activation de
  `openEditor`/`closeEditor`, double-clic exig./test → édition inline,
  `ViewHeader` bouton retour + `RichTextProvider`/`RichTextToolbar`, `readOnly`.
- Section SPEC `Vue Recherche` (`SPEC-ELECTRON-DESKTOP.md`) + MAJ `SPEC-INDEX.md`.
