# T87 — Sprint 1 (unique)

Périmètre complet du ticket codé en un seul sprint, conformément à `T87-design.md`.

## Fichiers modifiés

- `apps/desktop/src/main/services/sync.service.ts` — `createBranch` réimplémenté avec
  `git.branch({ checkout: false })` + `git.checkout({ ref: name, noCheckout: true })` au lieu de
  `git.branch({ checkout: true })`, pour ne jamais écraser des modifications non commitées au
  moment où une branche est créée à la position courante (le cas nominal de "Publier").
- `apps/desktop/src/renderer/contexts/VersioningContext.tsx` — `isReadonly` ne teste plus que
  `branch === ''` (detached HEAD), retire `|| branch.startsWith('int-')`.
- `apps/desktop/src/renderer/hooks/useModificationMode.ts` — `ModificationMode` passe de
  `'view' | 'edit' | 'other'` à `'active' | 'blocked' | 'other'` : `'blocked'` couvre le nouveau cas
  "sur une branche `int-*` différente de la branche d'intégration configurée du repo" (édition
  autorisée, publication interdite).
- `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` — réécriture complète :
  suppression du bouton "Faire une modification", du bouton "Annuler" et du badge Lecture/Édition ;
  "Publier" résout au clic son propre mode (créer une branche éphémère depuis l'intégration, ou
  committer directement sur la branche courante) et pousse la branche d'intégration vers `origin`
  une fois le merge réussi.
- `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` — tooltip de l'icône verrou
  reformulé (`"État figé — aucune branche extraite"`) pour ne plus laisser croire qu'une branche
  `int-*` déclenche ce badge.
- `apps/desktop/src/renderer/components/schema/IntegrationBranchSelector.tsx` — **hors liste initiale
  du design**, corrigé pendant `/code-review high` (cf. divergences ci-dessous).
- `specs/SPEC-FORKS-BRANCHES-BASELINES.md` — §2.1–2.3 réécrites (workflow "Publier" unique, tableau
  de résolution de branche cible, push automatique, note sur le correctif `createBranch`) ; §4.3
  annotée comme spec caduque (modèle `components.yaml`/`sourceRef` sans traduction dans le code
  actuel — architecture réelle = submodules git plats, T30).
- `specs/SPEC-INDEX.md` — colonne `MAJ` mise à jour (`T84`/`T30` → `T87`) pour les deux lignes
  `SPEC-FORKS-BRANCHES-BASELINES.md` §1–2 et §3–4 touchées ci-dessus.

## Comportement implémenté

Conforme à `specs/T87.md` : édition possible directement sur la branche d'intégration (ou toute
branche, seul le detached HEAD reste bloqué) ; "Publier" résout son comportement par repo à partir
de la branche courante vs la branche d'intégration configurée (nominal / avancé / bloqué) ; push
automatique best-effort après un merge réussi ; aucune branche créée manuellement par l'utilisateur
n'est jamais supprimée automatiquement.

## Divergences par rapport au design

`specs/T87-design.md` couvrait 5 fichiers ; l'implémentation en touche 6 et diverge sur plusieurs
points, tous identifiés pendant `/code-review high` (8 angles, 10 findings rapportés, 8 corrigés sur
le champ, 2 explicitement différés) plutôt que anticipés dans le design :

1. **`IntegrationBranchSelector.tsx` (hors design initial).** Ce composant construisait sa propre
   copie de la formule `isReadonly` (`branch === '' || branch.startsWith('int-')`, désormais
   obsolète) et checkoutait une branche `int-*` sans aucune garde de modifications en attente — un
   invariant qui tenait tant que `int-*` était nécessairement propre (avant T87). Corrigé : même
   garde `isDirty` + popup de confirmation que `RepoBranchSelector`/`VersionRepoFolder`, affichage
   des erreurs de checkout (`checkoutError`), et `isReadonly` alignée sur `VersioningContext`.
2. **Push non-bloquant plutôt qu'attendu dans la mutation.** Le design décrivait le push comme une
   étape de la séquence ; l'implémentation le déclenche en fire-and-forget juste après
   `onSuccess` (merge + checkout + suppression déjà faits), pour que l'échec du push ne bloque pas
   l'état "Publication…" le temps d'un aller-retour réseau. Comportement fonctionnel inchangé
   (échec non bloquant, cf. critère d'acceptation 7 de `T87.md`) — juste une meilleure latence
   perçue.
3. **Suivi d'une branche éphémère abandonnée après conflit (`ephemeralBranch`), non anticipé dans le
   design.** Sans ce suivi, republier après un conflit (l'utilisateur reste alors sur la branche
   éphémère créée par la première tentative) recalculait `isNominal` à partir de
   `branch === integrationBranch` — devenu faux — et traitait silencieusement la republication comme
   un usage avancé : jamais de checkout retour ni de suppression, branches `dev-*` orphelines
   accumulées à chaque cycle conflit/nouvelle tentative. Corrigé en gardant en mémoire (scopé au
   repo) le nom de la branche éphémère créée, reconnu comme telle si l'utilisateur y republie.
4. **Garde anti-popup périmée (`popupOpenedFor`), non anticipée dans le design.** L'effet de reset
   ne dépendait que de `mode`, qui peut rester `'active'` alors que la branche réelle a changé sous
   la popup ouverte (checkout externe pendant la saisie du titre). La popup capture désormais le
   repo/branche au moment de son ouverture et refuse une soumission devenue périmée.
5. **Conflit modélisé comme une erreur typée (`PublishConflictError`) plutôt qu'une variante de
   résultat.** Simplification interne suggérée en revue — supprime un renommage de champ dupliqué
   entre deux unions parallèles ; aucun changement de comportement visible.

Deux findings de la revue sont délibérément **non corrigés**, notés comme suivi possible plutôt que
comme régression :
- Le bandeau d'échec de push et le formatage `err instanceof Error` dupliquent des motifs déjà
  présents ailleurs (`PinPropagationWarning`, `VersionRepoFolder`) — généraliser ces motifs en
  composants/helpers partagés dépasse le périmètre de ce ticket.
- L'orchestration complète de "Publier" (décision de branche, création/nettoyage, merge, push) vit
  entièrement dans `ModificationControl.tsx`, sans primitive backend dédiée — cohérent avec le
  pattern déjà en place depuis T83, mais un futur appelant non-UI (CLI, automatisation) devrait la
  réimplémenter à l'identique. Signalé pour un futur ticket, pas traité ici.

## Vérifications effectuées

- `pnpm typecheck` (apps/desktop) : aucune erreur.
- Aucun script de lint/test automatisé n'est configuré pour ce package (confirmé — cohérent avec
  les tickets précédents).
- `/code-review high` : 8 agents (3 correctness + 3 cleanup + altitude + conventions), 10 findings
  retenus après vérification, 8 corrigés sur le champ (dont le risque de perte de données sur
  `IntegrationBranchSelector.tsx` et les branches `dev-*` orphelines après conflit), 2 différés
  explicitement (voir ci-dessus). Aucune violation CLAUDE.md trouvée (le seul CLAUDE.md du repo ne
  couvre pas le code applicatif touché).
- Non testé interactivement (pas d'Electron attachable dans cette session) — attend validation
  manuelle humaine avant archivage/merge.

## Comment tester manuellement

Suivre `specs/T87-tests.md`, en particulier :
- **T87-01/T87-02** (golden path) : éditer directement sur la branche d'intégration, publier,
  vérifier la séquence complète (branche éphémère créée puis supprimée, checkout retour, push).
- **T87-03/T87-03b** : publier depuis une branche `dev-*`/libre manuelle (reste dessus, jamais
  supprimée) ; vérifier le blocage sur une autre branche `int-*` non configurée.
- **T87-06** : un repo en detached HEAD (baseline) reste bloqué à l'édition.
- **T87-07** puis republier immédiatement après résolution d'un conflit — vérifier qu'aucune
  branche `dev-*` orpheline ne subsiste (le point le plus à risque de cette implémentation).
- **T87-09b** : simuler un échec de push (remote injoignable) — le merge local doit rester acquis.
- Vérifier dans le panneau Version que `IntegrationBranchSelector` demande confirmation avant un
  checkout `int-*` alors que des modifications sont en attente.
