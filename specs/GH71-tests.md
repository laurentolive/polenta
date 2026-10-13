# GH71 — Scénarios de test

Spec : `specs/GH71.md` · Design : `specs/GH71-design.md`.

Données communes : type de test `root::test`, statuts `draft`, `review`, `valide` (`isApproval`),
`obsolete` (`isTerminal`). Tests : `A` (`draft`), `B` (`review`), `C` (`valide`), `D` (`valide`),
`E` (`valide`). Campagne ouverte `CAMP-1` : `A` pending (copie draft), `B` pending (copie review),
`C` pending (copie valide), `D` PASS, `E` FAIL.

## Unitaires — `@polenta/types` (sprint 1)

- P1 — `entryProgress` : A → `prep:draft`, B → `prep:review`, C → `ready`, D → `PASS`, E → `FAIL`.
- P2 — instance exécutée sur une copie draft → son résultat.
- P3 — `progressSubject` : copie draft + live review + campagne ouverte → live (`prep:review`) ;
  campagne clôturée → copie (`prep:draft`).
- P4 — copie valide, live repassé draft → copie (`ready`, T49).
- P5 — entrée pré-T49 (sans copie) → live ; ni copie ni live → `ready`.
- P6 — `progressRank` : draft(0) < review(1) < ready < INCOMPLETE < BLOCKED < FAIL < PASS ; statut
  inconnu → après les statuts connus, avant `ready` ; valeur hors étape → après tout.
- P7 — `prepStatusOrder` sur deux types (`draft, review` / `brouillon, relecture`) → draft=0,
  brouillon=0, review=1, relecture=1 ; `compareProgressKeys` départage par nom
  (`prep:brouillon` < `prep:draft` < `prep:relecture` < `prep:review` < `ready`).
- P8 — `isProgressKey` : `prep:x`, `ready`, `PASS` vrais ; `prep:`, `pending`, `''`, `42` faux.

## Unitaires — main (sprint 1)

### `campaign_entries` (`query-engine.campaigns.test.ts`)
- Q1 — CAMP-1 : colonnes `progress` / `progressRank` / `testStatus` attendues (P1, P6) ; `status`
  inchangé (`pending` ×3, `PASS`, `FAIL`).
- Q2 — test A passé `review` (live) → `progress` = `prep:review` sans réécriture de la campagne.
- Q3 — campagne clôturée, entrée pending copie draft, live valide → `prep:draft`.
- Q4 — test d'un composant (autre repo) : statut et rang jugés sur le schéma **de ce repo**.
- Q5 — `SELECT [progress], COUNT(*) … GROUP BY [progress]` et builder `progress = 'ready'` :
  fonctionnent ; `progressRank` refusé dans le builder (hors allowlist UI), accepté en SQL.
- Q6 — drill-down sur un segment `prep:review` de la requête du seed → entrée B seule.

### `resolveRowTarget`
- T1 — ligne `{ campaignId, entryId: A-1 }` → `{ kind: 'campaign', progress: 'prep:draft' }`.
- T2 — entrée exécutée → `campaign-run` (inchangé).
- T3 — ligne `{ campaignId, progress: 'ready' }` sans entrée → `campaign` + `progress`.
- T4 — test introuvable partout → `progress: 'ready'` (règle P5), jamais d'erreur.

### Seed (`dashboard-seed.campaigns.test.ts`)
- D1 — seed neuf : requête `progress` = nouvelle SQL, widget avec `series: 'progress'` et
  `preset: 'campaignProgress'` ; marqueur `done` avec `queries`/`dashboardId` ; upgrade marqué.
- D2 — seed GH65 existant intact (marqueur `done` sans ids) → requête et widget mis à niveau ;
  titres conservés ; marqueur `progressV2` posé.
- D3 — SQL de la requête modifié → rien ; marqueur posé.
- D4 — requête intacte mais widget modifié (ex. `stacked: false`) → ni requête ni widget touchés.
- D5 — requête intacte, aucun widget → requête mise à niveau.
- D6 — requête passée en `shared` → non touchée.
- D7 — deuxième appel → aucune écriture (marqueur).
- D8 — échec d'écriture pendant la mise à niveau → journalisé, `dashboards:list` réussit, retenté
  au prochain appel (marqueur non posé).

## Renderer / e2e (sprint 2)

### Préréglage
- W1 — widget du seed sur CAMP-1 : légende « Brouillon, En revue, Prêt à exécuter, Échoué, Passé »
  dans cet ordre ; couleurs gris foncé / gris clair / bleu / rouge / vert (jetons thème clair et
  sombre).
- W2 — clic sur le segment « En revue » → popup de détail avec l'entrée B.
- W3 — éditeur de widget : « Présentation des séries » visible pour une barre avec série, masqué
  sinon ; passage à « Standard » → ordre d'apparition et palette catégorielle ; réouverture →
  préréglage conservé.
- W4 — préréglage sur une série sans clé d'étape (`component`) → rendu standard.
- W5 — impression du dashboard → mêmes couleurs/libellés.

### Page campagne
- C1 — CAMP-1 : pastilles « Brouillon 1 · En revue 1 · Prêt à exécuter 1 · Incomplet 0 · Bloqué 0 ·
  Échoué 1 · Passé 1 », dans cet ordre.
- C2 — clic « En revue » → liste = B, URL `progress=prep:review`, « Filtre : En revue ✕ » ; re-clic →
  retrait.
- C3 — URL `status=pending` (lien GH65) → A, B, C ; `status=PASS` → D ; `progress` + `status` →
  `progress` l'emporte ; `progress=inconnu` → ignoré.
- C4 — aucune entrée en préparation → pas de pastille de préparation ; « Prêt à exécuter 0 » affichée.
- C5 — campagne clôturée, instance pending sur copie draft, test approuvé depuis → pastille
  « Non approuvé » sur l'instance, pastille d'étape « Brouillon » (correction GH68).

### Navigation
- N1 — Vue Suivi, table d'entrées : clic sur l'entrée A → page CAMP-1 filtrée `progress=prep:draft`.
- N2 — clic sur une entrée exécutée → résultat d'exécution (inchangé).

### Non-régression
- R1 — `pnpm test`, `check-gh36`, e2e `gh64-*`, `gh65-*` (mis à jour : 2.4/2.7, 2.9), `gh68-*`,
  `parity` verts.
- R2 — KPI « % exécuté » / « % PASS », « Exécutions par jour », « Entrées en échec » : valeurs
  inchangées sur la démo.

## Critères d'acceptation vérifiables

CA1–CA12 de `specs/GH71.md`. CA7 lu avec la précision du design §3.3 : une requête intacte n'est
mise à niveau que si tous ses widgets ont le mapping GH65.
