# T151 — Sprint 1

## Fichiers modifiés

- `apps/desktop/src/renderer/components/system/ElementTree.tsx`

## Comportement implémenté

Le menu « Créer un élément / Créer un dossier / Coller » (`BgContextMenu`, déjà utilisé
par le clic droit dans le vide) est maintenant partagé par les **quatre** déclencheurs
`+` de l'arbre, chacun ouvrant le menu à sa position avec son propre point d'insertion :

- État `addMenu` (remplace l'ancien `bgContextMenu`, portée élargie) : `{ x, y, parentId,
  afterId }` — `parentId`/`afterId` capturent où insérer, indépendamment du déclencheur.
- `openAddMenuNear(el, parentId, afterId)` : calcule la position sous l'élément cliqué
  (`getBoundingClientRect()`), bornée à `window.innerHeight - 100` pour rester visible
  même quand le déclencheur est proche du bas de la fenêtre.
- `handleAddMenuAction(action)` : dispatch générique — `create-item`/`create-folder` →
  `createItem(parentId, afterId, kind)` ; `paste` → nouvelle fonction `pasteAt(parentId,
  afterId)` (factorisée depuis l'ancienne logique de collage à la racine, désormais
  paramétrable par position).
- Bouton `+` de fin d'arbre et bouton « Créer le premier élément » (arbre vide) →
  `parentId: null, afterId: null` (racine).
- `+` inline au survol d'une ligne dossier (`handlePlusClick`, infobulle « Créer dans ce
  dossier ») → `parentId: <dossier>, afterId: null`.
- `+` de l'interstice entre deux lignes (`handleGapPlusClick`, infobulle « Créer un
  élément ici ») → `parentId: <parent du nœud survolé>, afterId: <nœud survolé>`.
- Clic droit dans la zone vide → inchangé (racine), simplement migré vers le nouvel état.

Aucune modification de `SystemPanel.tsx` / `CampaignNavList` — vue Campagnes inchangée.

## Divergences par rapport au design initial

Le design initial (voir historique de `specs/T151.md`) limitait le changement au bouton
`+` de fin d'arbre et à celui de l'arbre vide, en considérant le `+` inline et le `+`
d'interstice comme des raccourcis de position hors scope. Retour utilisateur après le
premier essai : cliquer sur le `+` d'interstice (« Créer un élément ici ») créait
toujours un élément directement, perçu comme un bug plutôt que comme un choix de scope.
`specs/T151.md` a été mis à jour en conséquence — les quatre déclencheurs sont unifiés.

## Comment tester manuellement

1. Vue Exigences (ou Tests), bouton `+` de fin d'arbre → menu → « Créer un dossier » crée
   à la racine, en renommage immédiat.
2. Sur un arbre vide, bouton « Créer le premier élément » → même menu.
3. Survoler une ligne dossier → `+` inline (infobulle « Créer dans ce dossier ») → menu →
   « Créer un élément » crée bien *dans* ce dossier (section imbriquée, ex. `4.1`).
4. Survoler l'interstice entre deux lignes → `+` circulaire bleu (infobulle « Créer un
   élément ici ») → menu → « Créer un dossier » insère bien juste après la ligne
   survolée, au même niveau (pas à la racine).
5. Clic droit dans la zone vide de l'arbre → menu inchangé, insertion à la racine.
6. Vue Campagnes : bouton `+` du header inchangé (crée directement une campagne).

## Vérifications techniques

- `pnpm --filter @polenta/desktop typecheck` : OK, aucune erreur (avant et après
  l'élargissement de scope).
- `pnpm --filter @polenta/desktop build` : OK.
- Test manuel end-to-end via le driver Playwright du skill `run-desktop`, sur une copie
  isolée d'un vrai projet Polenta (schéma + exigences existants, pas de données
  utilisateur modifiées) : les 4 scénarios ci-dessus (fin d'arbre, interstice, inline
  dossier, clic droit) ont été exercés ; interstice et inline dossier confirmés par
  capture d'écran + numérotation de section (`4.1` imbriqué sous le dossier créé). Le
  clic droit n'a pas pu être vérifié par ce driver (pas de commande "right-click" native
  et la simulation `dispatchEvent('contextmenu')` ne déclenche pas le hit-testing
  Electron dans cet environnement) — son code est resté strictement équivalent à l'
  existant (juste migré vers l'état `addMenu` renommé), donc non retesté visuellement.

## Note

Un refactor de performance concurrent (React.memo sur `TreeRow`, `useCallback`/
`useMemo` sur plusieurs handlers), non fait par cet agent, est apparu dans ce même
fichier en cours de sprint 1 — laissé en l'état, sans conflit avec ce ticket
(`typecheck` + tests manuels après élargissement de scope toujours au vert).
