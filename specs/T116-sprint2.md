# T116 — Sprint 2 : Statuts métier

Réf : `specs/T116.md`, `specs/T116-design.md` §4

## Fichiers modifiés

- `apps/desktop/src/renderer/routes/requirements.tsx`
- `apps/desktop/src/renderer/routes/req.$reqId.tsx`
- `apps/desktop/src/renderer/routes/tests.tsx`
- `apps/desktop/src/renderer/routes/test.$testId.tsx`
- `apps/desktop/src/renderer/components/system/CampaignListView.tsx`
- `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx`
- `apps/desktop/src/renderer/components/system/WordView.tsx`
- `apps/desktop/src/renderer/components/impact/RequirementEditModal.tsx`
- `apps/desktop/src/renderer/components/impact/TestCaseEditModal.tsx`
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx`
- `apps/desktop/src/renderer/routes/campaign.$campaignId_.run.$testId.tsx`
- `apps/desktop/src/renderer/routes/campaign.$campaignId_.execute.$testId.tsx`

## Comportement implémenté

Les 4 systèmes de statuts (exigence, test, campagne, exécution de test) réutilisent désormais les mêmes 5 tokens de sentiment (`status-neutral/info/success/warning/danger`) au lieu de réimplémenter chacun leur propre palette de nuances Tailwind. Les fichiers ont été traités intégralement (pas seulement leur badge de statut) quand ils contenaient d'autres couleurs brutes annexes (boutons de transition, messages d'erreur, confirmations) déjà dans le périmètre du sprint selon `T116-design.md` §4.

**Harmonisations appliquées** (décidées en design, §2.1) :
- `SKIP` (jaune) et `BLOCKED` (orange) des statuts d'étape/exécution de test unifiés sur `status-warning`.
- `WordView.tsx` utilisait `bg-blue-*` pour le statut `review`, alors que `requirements.tsx`/`req.$reqId.tsx`/`RequirementEditModal.tsx` utilisaient `bg-amber-*` pour la même valeur — harmonisé sur `status-warning` (amber) partout.
- Le statut `obsolete` des tests (`tests.tsx`) utilisait une nuance de slate atténuée (`text-slate-500` vs `text-slate-700` pour `draft`) — consolidé sur le même `status-neutral` que `draft` (perte volontaire de la nuance "dimmed", jugée non essentielle).
- Nuances de rouge légèrement différentes selon les fichiers pour un même bouton "supprimer"/"abandonner" (`red-500` vs `red-600` vs bordure `red-300`) — unifiées sur `status-danger-solid`/`status-danger-border` selon le style (plein vs contour).

## Vérifications effectuées

- Grep de conformité restreint aux 12 fichiers du sprint : 0 classe Tailwind brute restante, à l'exception d'un bloc CSS de mise en forme de contenu riche (`code`/`blockquote`/`pre`) dans `WordView.tsx` ligne 179 — délibérément laissé de côté, hors périmètre "statuts" (relève du même style que `RichTextViewer.tsx`, prévu en sprint 4).
- `tsc --noEmit` (apps/desktop) : 0 erreur.
- Diff symétrique (93 insertions / 93 suppressions sur 12 fichiers) : confirme que seules des classes ont été substituées, aucune structure JSX modifiée.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev`.
2. Ouvrir la liste des exigences, la liste des tests, la liste des campagnes (sidebar et vue système) : les badges de statut doivent avoir un rendu cohérent (mêmes teintes) entre les trois écrans pour un même sentiment (ex. tous les statuts "en attente/brouillon" en gris-neutre).
3. Ouvrir une exigence en `review` : le badge doit être ambre (auparavant bleu dans `WordView.tsx` seulement — vérifier que l'incohérence a bien disparu).
4. Dans une campagne active, exécuter un test avec un résultat `SKIP` sur une étape et `BLOCKED` sur une autre : les deux badges doivent avoir la même couleur (ambre), mais des libellés textuels distincts ("Ignoré" / "Bloqué").
5. Basculer clair/sombre sur chacun de ces écrans : aucune zone ne doit rester bloquée sur l'ancienne palette.

## Suite

Sprint 3 (messages/formulaires, ~25 fichiers) peut démarrer.
