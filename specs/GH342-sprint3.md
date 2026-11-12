# GH342 — Sprint 3 : même élément édité dans deux fenêtres (D2)

## Fichiers

| Fichier | Changement |
|---|---|
| `renderer/lib/draftSync.ts` (+ test, 7 cas) | `changedKeys`, `externalConflicts`, `adoptExternal` ; hook `useDraftForm` (base / brouillon / serveur, `reload`, `keep`, `markSaved` au lancement de l'enregistrement, `restoreBase` en cas d'échec) |
| `renderer/routes/req.$reqId.tsx`, `test.$testId.tsx` | formulaire sur `useDraftForm` ; seules les clés modifiées envoyées ; bandeau ; plus de réinitialisation du formulaire après enregistrement |
| `renderer/components/system/EditView.tsx` | conflits détectés avec `externalConflicts`, échos de nos envois exclus (5 dernières valeurs par champ) ; champ en conflit jamais envoyé avant le choix (minuterie, sortie du champ, démontage) ; « Recharger » remonte le champ |
| `renderer/components/ExternalChangeBanner.tsx`, i18n | bandeau « Modifié ailleurs pendant votre saisie : … » — Recharger / Garder ma saisie |
| `renderer/hooks/useLiveFileSync.ts` | **fiche de la vue Édition (`['object', repo, catégorie, id]`) relue sur modification extérieure** d'une exigence / d'un test — jusqu'ici seules les issues l'étaient : la vue Édition ne voyait jamais une modification faite ailleurs |
| `main/host/app-windows.ts`, `main/services/update.service.ts`, `main/index.ts` | `prepareForcedQuit` avant `quitAndInstall` (revue) ; invitation : fenêtre du lancement libérée après prise ou à une invitation en cours de session (revue) |
| `renderer/hooks/useAutoPull.ts` | fenêtre non responsable : état de synchronisation relu à chaque tick (revue) |
| `renderer/hooks/useWindowState.ts` | `dirty` envoyé seulement sur le web (revue) |
| `e2e-web/gh342-concurrent.spec.ts` | C2/C6, C3, C4, C5, C7 |
| specs `SPEC-*` | voir ci-dessous |

## Divergences par rapport au design

- **Vue Édition non rafraîchie** (constaté par le test C7) : la clé de la fiche n'était pas
  invalidée pour les exigences et tests. Corrigé dans `useLiveFileSync` — sans cela ni CA4 ni CA6 ne
  tenaient pour la vue Édition.
- **Champ en conflit non envoyé** tant que l'utilisateur n'a pas choisi : sans cela, l'enregistrement
  automatique du texte riche (800 ms) ou la sortie du champ écrasait la valeur extérieure.
- `markSaved` au lancement de l'enregistrement (`onMutate`) plutôt qu'au succès : l'écho de notre
  écriture peut être relu avant la réponse.
- Page test : vider « Préconditions » / « Postconditions » n'efface toujours pas la valeur
  (`trim() || undefined`, comportement antérieur conservé).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-PROJECT-MANAGEMENT.md` §1, §5, §7 | §5 réécrit : multi-fenêtres sur le même projet (actions, architecture, fermeture, sortie, disposition, web) ; §1 et §7 alignés sur l'instance unique |
| `SPEC-ELECTRON-DESKTOP.md` §16.1 | ouverture directe d'une page (`__open`, lien direct web) |
| `SPEC-ELECTRON-DESKTOP.md` §19.1 | menu d'onglet, Ctrl+Shift+N, page rouverte au lancement, garde de fermeture |
| `SPEC-ELECTRON-DESKTOP.md` terminal (GH238) | sortie envoyée à la fenêtre propriétaire |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §2.5 | pull automatique : une fenêtre responsable par projet |
| `SPEC-WEB.md` §7 | nouvel onglet, `beforeunload`, URL d'entrée suivie |
| `SPEC-INDEX.md` | colonne MAJ → GH342 sur les six lignes |

## Vérifications

- `pnpm typecheck` OK ; unitaires desktop 1750/1750.
- e2e desktop `gh342-windows` 12/12 ; e2e web `gh342-*` 9/9.
- e2e web voisines : gh74-editing, gh152, gh246, gh229, gh230, gh228, gh299, gh206, gh195, gh77,
  gh214, gh136, gh82 : 59/59 (avant corrections de revue) ; gh74-editing, gh228, gh152, gh299 +
  gh342 : 25/25 après.
- Revue de code (PR #344) : 9 constats ; 8 corrigés, 1 partiel (erreurs du pull automatique visibles
  seulement dans la fenêtre responsable — l'état avance / retard est relu partout).

## Tester à la main

1. Même exigence (page exigence) dans deux fenêtres : modifier le titre dans l'une, un champ dans
   l'autre, enregistrer les deux → les deux valeurs dans le fichier.
2. Même champ en cours de saisie dans la fenêtre 2, enregistré dans la fenêtre 1 → bandeau dans la
   fenêtre 2 ; « Recharger » / « Garder ma saisie ».
3. Vue Édition, champ riche : taper dans la fenêtre 2 pendant que la fenêtre 1 enregistre le même
   champ → bandeau ; la saisie n'est pas enregistrée avant le choix.
4. Vue Édition ouverte dans une fenêtre : une modification enregistrée ailleurs apparaît sans
   recharger (nouveau).
