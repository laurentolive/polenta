# T47 — Sprint 1 : affichage + fix bouton draw.io autonome

Réf. `specs/T47.md`, `specs/T47-design.md`.

## Fichiers modifiés / créés

**Nouveaux**
- `apps/desktop/src/main/drawio-xml.ts` — parsing d'un fichier `.drawio` (`<mxfile>`)
  en pages décompressées (`parseDrawioPages`), gère les deux modes de stockage
  draw.io (compressé deflate+base64 par défaut, ou XML littéral non compressé).
- `apps/desktop/src/renderer/lib/drawioRender.ts` — rendu local (offline) d'un
  `mxGraphModel` XML en SVG (`renderMxGraphXml`) + résolution d'ancre page/cellule
  (`resolveDrawioTarget`).
- `apps/desktop/src/renderer/tiptap/DrawioEmbedExtension.ts` — node TipTap atom
  `drawioEmbed` (attributs `path`, `nodeId`), sérialisation Markdown en bloc fenced
  ` ```drawio `, parsing markdown-it associé.
- `apps/desktop/src/renderer/tiptap/DrawioEmbedView.tsx` — NodeView React : lecture
  du fichier, rendu SVG, états erreur, double-clic → ouverture externe, resync au
  focus fenêtre.

**Modifiés**
- `packages/api-client/src/types.ts` — namespace `drawio` (`pickFile`, `read`,
  `openExternal`) + type `DrawioPage`.
- `packages/api-client/src/ipc-client.ts` — implémentation renderer du namespace.
- `apps/desktop/src/main/ipc/index.ts` — handlers `dialog:pick-drawio-file`,
  `drawio:read`, `drawio:open-external` (`shell.openPath`).
- `apps/desktop/package.json` — ajout de `@tiptap/core` (dépendance directe,
  auparavant seulement transitive).
- `apps/desktop/src/renderer/components/RichTextField.tsx`,
  `RichTextViewer.tsx` — extension `DrawioEmbed` ajoutée, nouvelle prop `repoPath`.
- `apps/desktop/src/renderer/components/DynamicField.tsx`,
  `StepsTable.tsx` — prop `repoPath` ajoutée et propagée.
- `apps/desktop/src/renderer/components/system/EditView.tsx` — prop `repoPath`
  propagée jusqu'à `RichTextField` ; **fix du bouton "Ouvrir dans Draw.io"** du
  champ `drawio` autonome (`case 'drawio'`), qui utilisait un `window.electronAPI`
  inexistant (code mort) — utilise maintenant `api.drawio.openExternal`.
- `apps/desktop/src/renderer/components/system/ExcelView.tsx`,
  `WordView.tsx`, `SystemView.tsx` — `repoPath` propagé jusqu'à tous les
  `RichTextField`/`RichTextViewer`/`StepsTable` (popover richtext, panneau étapes,
  carte élément). `WordView.tsx` avait sa **propre** réimplémentation locale de
  `RichTextViewer` (dupliquée, pas le composant partagé) — elle aussi reçoit
  l'extension `DrawioEmbed`.
- Routes `req.$reqId.tsx`, `req.new.tsx`, `test.$testId.tsx`, `test.new.tsx`,
  `campaign.$campaignId.execute.$testId.tsx`, `campaign.$campaignId.run.$testId.tsx`
  — `repoPath` (déjà présent dans chaque route via `Route.useSearch()`) propagé
  aux composants richtext qu'elles rendent.

## Comportement implémenté

- Un champ richtext contenant un bloc ` ```drawio\ndiagrams/foo.drawio#node-X\n``` `
  affiche le diagramme rendu en SVG, en lecture (`RichTextViewer`) comme en édition
  (`RichTextField`), sans requête réseau.
- Si `nodeId` correspond à l'id d'une page (`<diagram id="...">`), cette page est
  affichée. S'il correspond à l'id d'une cellule (`mxCell id="..."`) trouvée dans
  une page, cette page est affichée avec la cellule surlignée (contour orange).
  Sinon (ou `nodeId` absent), la première page est affichée.
- États d'erreur explicites : fichier introuvable, XML invalide, contexte repo
  indisponible (`repoPath` non résolu) — jamais de crash de l'éditeur.
- Double-clic sur le diagramme rendu → ouverture dans l'application associée du
  poste (`shell.openPath`, best effort).
- Retour de focus sur la fenêtre Polenta → relecture + re-rendu automatique.
- Champ `drawio` autonome (`EditView.tsx`) : le bouton "Ouvrir dans Draw.io" est
  désormais fonctionnel (il ne l'était pas avant T47).

## Divergence par rapport au design

Le design (`T47-design.md`) proposait de vendorer le bundle officiel
`viewer-static.min.js` de draw.io pour le rendu SVG. En pratique, ce fichier n'est
pas disponible via un package npm distinct et le récupérer directement depuis le
dépôt GitHub `jgraph/drawio` aurait signifié vendorer un binaire tiers non
audité dans ce dépôt sans revue de licence/sécurité complète — jugé disproportionné
pour ce sprint.

**Décision retenue à la place** : un rendu SVG local écrit dans ce dépôt
(`drawioRender.ts`), sans dépendance externe. Il supporte les formes couramment
utilisées dans les diagrammes système/bloc de ce projet (rectangle, rectangle
arrondi, ellipse, texte, arêtes droites/à points de passage avec flèche) — cf.
diagrammes prioritaires listés dans `CONTEXT.md` D4 (vue système, bloc puissance,
FSM, bloc BMS, arbre cinématique — tous des diagrammes bloc/flèche standards).
Formes personnalisées (stencils), images embarquées dans une forme, et routage
orthogonal complexe ne sont pas reproduits fidèlement — la mise en page reste
correcte (positions/tailles exactes) mais le style peut différer légèrement de
draw.io. Documenté en commentaire en tête de `drawioRender.ts`.

Cette décision réduit aussi la surface de risque (pas de contenu HTML/JS tiers
exécuté dans le renderer) — les valeurs de style issues du fichier `.drawio` sont
échappées avant insertion dans le SVG (`escapeXml`) avant tout rendu via
`dangerouslySetInnerHTML`.

## Revue de code et corrections apportées

`/code-review` lancé sur le diff (3 agents en parallèle : logique de rendu/parsing
draw.io, complétude du threading `repoPath`, réutilisation/simplification/altitude).
Résultats :

- **Threading `repoPath`** : aucune lacune trouvée — complet et correct sur tous
  les points d'appel vérifiés.
- **Réutilisation/altitude** : le prop-drilling de `repoPath` est cohérent avec le
  pattern déjà établi dans ce dépôt (route `useSearch()` → composants enfants),
  pas de Context React global adapté à ce modèle multi-composants — aucun
  changement nécessaire.
- **3 bugs confirmés et corrigés avant commit** :
  1. Boucle infinie possible dans `absoluteXY` (`drawioRender.ts`) si un fichier
     `.drawio` mal formé contient une chaîne de `parent` cyclique entre cellules
     — ajout d'un `Set` de cellules visitées pour interrompre la boucle.
  2. Round-trip Markdown cassé si `path` contient lui-même un `#` (ex.
     `diagrams/rev#2.drawio`) — le séparateur `path#nodeId` tronquait le chemin.
     Remplacé par une sérialisation JSON `{"path":...,"nodeId":...}` dans le bloc
     fenced, non ambiguë. Contenu non-JSON (édition manuelle) toléré en fallback
     (traité comme chemin brut sans ancre). `specs/T47-design.md` mis à jour en
     conséquence.
  3. Course possible dans `DrawioEmbedView` : une réponse tardive d'un chargement
     précédent (si `path`/`nodeId` changent rapidement) pouvait écraser un état
     plus récent — ajout d'un jeton de requête (`requestIdRef`) ignorant les
     réponses obsolètes.
- **Duplication mineure** (`escapeXml` dupliqué entre `drawioRender.ts` et
  `DrawioEmbedExtension.ts`) — consolidée : `escapeXml` exporté depuis
  `drawioRender.ts` et réutilisé.
- `drawio.pickFile` (IPC) sans appelant dans ce sprint — attendu, consommé en
  sprint 2 (UI d'insertion).

Après corrections : `pnpm typecheck` et `pnpm build` (apps/desktop) re-vérifiés,
toujours propres.

## Vérifications effectuées

- `pnpm typecheck` sur `@polenta/api-client` et `@polenta/desktop` : **0 erreur**.
  (Le workspace complet a une erreur préexistante dans `apps/api`, non liée à T47
  — confirmée présente avant ce ticket.)
- `pnpm build` (`electron-vite build`) : bundles main/preload/renderer générés
  sans erreur (le seul message d'erreur observé, un `ENOENT` sur un scan de routes
  TanStack Router pendant l'étape SSR intermédiaire, est préexistant et n'empêche
  pas le build de produire ses artefacts — confirmé non lié aux fichiers modifiés
  par T47).
- Logique de décompression draw.io (`parseDrawioPages`, page compressée
  deflate+base64 et page non compressée) vérifiée par un script Node isolé :
  round-trip exact retrouvé.
- **Non vérifié en interactif** : le lancement de l'app Electron complète
  (`pnpm dev`) échoue dans cet environnement d'exécution sandboxé — le process
  main crashe sur `electron.app` `undefined`, signe que le binaire Electron réel
  n'est pas disponible/attachable ici (pas de serveur d'affichage). Cette
  limitation est environnementale, pas liée au code de T47 (le bundle renderer se
  construit sans erreur et contient tous les nouveaux fichiers). **Le rendu visuel
  réel du SVG dans l'éditeur richtext n'a donc pas été vérifié à l'œil** — à faire
  manuellement dans l'app avant merge, ou lors du sprint 2 si un environnement
  avec affichage est disponible.

## Comment tester manuellement

1. Lancer l'app (`pnpm dev` dans `apps/desktop`, poste avec affichage).
2. Ouvrir un projet contenant un dossier `diagrams/` avec un fichier `.drawio`
   existant (sinon en créer un minimal via l'app draw.io desktop).
3. Ouvrir une exigence/un test, passer un champ richtext en mode "Raw" (bouton
   toolbar), taper :
   ````
   ```drawio
   diagrams/<nom-du-fichier>.drawio
   ```
   ````
4. Repasser en mode normal → le diagramme doit s'afficher en SVG.
5. Couper le réseau du poste → le rendu doit rester identique (aucune requête).
6. Double-cliquer sur le diagramme → l'app draw.io externe doit s'ouvrir sur le
   fichier (si installée sur le poste).
7. Champ `drawio` autonome (modèle de données avec un champ de type `drawio`) :
   renseigner un chemin, cliquer "Ouvrir dans Draw.io" → doit maintenant ouvrir le
   fichier (avant T47 : ne faisait rien).
