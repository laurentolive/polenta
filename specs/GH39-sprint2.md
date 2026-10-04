# GH39 — Sprint 2 : interface (indicateur, panneau Version, Resynchroniser) + SPEC

## Fichiers modifiés

- `apps/desktop/src/renderer/hooks/useIntegrationSync.ts` (nouveau) — requête d'état d'intégration
  par repo (`['sync:integration-state', repo]`, 30 s + invalidations), dernière erreur
  (`['sync:last-error', repo]`) et push en cours (`['sync:pushing', repo]`) exposés réactivement,
  `isSyncAlert`, `useRepoIntegrationSync`, `useWorkspaceSyncAlerts`, `useResyncIntegration` (clé de
  mutation partagée → un seul Resynchroniser à la fois dans l'app, message `integration-dirty`
  traduit, résultat `set-aside`).
- `apps/desktop/src/renderer/components/layout/SyncIndicator.tsx` (nouveau) — pastille d'en-tête +
  popover (repos en alerte, état, dernière erreur, Resynchroniser, message de mise de côté).
- `apps/desktop/src/renderer/components/layout/ViewHeader.tsx` — monte `SyncIndicator` à gauche de
  "Publier".
- `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` — `PublishPopover` exporté
  (réutilisé) ; `['sync:pushing', repo]` posé pendant le push post-Publier, état d'intégration
  invalidé à la fin.
- `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` — badge `↑N ↓M`
  (intégration vs origin), bouton Resynchroniser (icône) en alerte, dernière erreur / message de
  mise de côté sous la ligne ; push/pull/commit invalident l'état d'intégration.
- `apps/desktop/src/renderer/hooks/useModificationMode.ts` — `refetch()` invalide aussi l'état
  d'intégration.
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — `layout.syncIndicator.*`,
  `sidebar.version.integrationBadgeTooltip`.
- `specs/SPEC-FORKS-BRANCHES-BASELINES.md`, `specs/SPEC-INDEX.md` — voir ci-dessous.

## Comportement implémenté

Conforme à `specs/GH39.md` §3.1–3.2 (indicateur d'en-tête, panneau Version, Resynchroniser).

## Divergences par rapport au design

- Revue de code : l'état d'intégration est interrogé toutes les **30 s** (et non 3 s comme
  `sync:status`) — il parcourt l'historique dans le process principal — et rafraîchi
  immédiatement après chaque action qui peut le changer. Un seul Resynchroniser à la fois dans
  toute l'app (en-tête et panneau Version partagent la clé de mutation). Fermer le popover pendant
  une resync ne l'annule plus : un résultat « mis de côté » rouvre le popover.

## Mises à jour SPEC

- `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1 (note T154) : la divergence de l'intégration renvoie au
  §2.6 au lieu de « laissée inchangée, pas de nouvelle UI ».
- §2.3 (merge, étape 3) : un push en échec reste signalé par l'indicateur et est relancé par
  l'auto-pull.
- §2.5 (auto-pull) : réécrit — `autoSync`, fetch même si sale, fast-forward si propre, relance du
  push si l'intégration est seulement en avance, dernière erreur conservée.
- §2.6 (nouveau) : synchronisation de l'intégration avec origin — états, indicateur,
  Resynchroniser (`dev-resync`), "Publier" sur intégration divergée, plus de commit vide.
- `SPEC-INDEX.md` : ligne SPEC-FORKS-BRANCHES-BASELINES §1–2 → résumé + mots-clés, MAJ `GH39`.

## Vérifications

- `pnpm typecheck` : 0 erreur.
- Revue de code (`/code-review`) : 3 remarques, toutes corrigées (voir Divergences).
- **App réelle** (Electron, driver `run-desktop`), sur le workspace de démo LL800 dont tous les
  `origin` ont été redirigés vers des dépôts bare locaux, plus un clone « collègue » :
  - produit divergé (1/1) + moteur en avance (1) → pastille « 2 », popover avec les deux états ;
  - Resynchroniser moteur → push, sort de la liste ;
  - Resynchroniser produit avec un fichier non suivi → message `integration-dirty` traduit, rien
    de modifié ;
  - produit propre, panneau Version → badge `↑2 ↓1`, Resynchroniser → merge d'origin + push, 0/0,
    plus d'alerte ;
  - divergence en conflit → `dev-resync` créée, `main` = `origin/main`, message de mise de côté ;
    "Publier" actif avec « (commits mis de côté) » → conflit §2.4 standard (`NOTE-COLLEGUE.md`) ;
    après réconciliation du fichier + "Publier" → merge, retour sur `main`, `dev-resync` supprimée,
    push, 0/0, plus d'alerte ;
  - resync lancée puis popover fermé par Échap → la resync se termine (0/0).

## Points notés, hors périmètre

- Panneau Version : dans la barre latérale étroite, le nom du repo est déjà fortement tronqué (avant
  ce ticket) ; le badge et le bouton ajoutés le réduisent encore quand le repo est en alerte.
- Sur `dev-resync`, la section existante « ↑N commits à pousser » (branche courante, T86) affiche
  tout l'historique, la branche n'ayant pas d'équivalent distant — comportement antérieur pour
  toute branche locale jamais poussée.

## Tester manuellement

1. Workspace avec remote : faire un commit sur l'intégration en CLI sans pousser → pastille
   « 1 » dans l'en-tête et `↑1` dans le panneau Version ; Resynchroniser → poussé.
2. Faire pousser un commit par un collègue (fichier différent) + un commit local → « Divergé : 1 en
   local, 1 sur le serveur » ; Resynchroniser → merge + push.
3. Même chose sur le même fichier → `dev-resync` ; "Publier" → conflit → réconcilier le fichier
   sur `dev-resync` → "Publier" → retour sur l'intégration, alerte disparue.
