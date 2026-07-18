# T101 — Sprint 2 (dernier) : dirty-state et confirmation de fermeture

## Fichiers modifiés

- `apps/desktop/src/renderer/contexts/TabsContext.tsx` — `dirtyTabIds`, `pendingCloseId`,
  `attemptCloseTab`/`confirmCloseTab`/`cancelCloseTab`, `setTabDirty`/`setTabTitleOverride`
  (mémoïsés via `useCallback`), hooks exportés `useRegisterTabDirty`/`useSetTabTitle`,
  helper `isEditableElement`. Correction du déclenchement du reset d'onglets sur changement de
  projet (`isRealSwitch`).
- `apps/desktop/src/renderer/hooks/useTabShortcuts.ts` — Ctrl+W appelle `attemptCloseTab` (au
  lieu de `closeTab`) ; Ctrl+T/Ctrl+W ignorés tant que la popup de confirmation est ouverte.
- `apps/desktop/src/renderer/components/layout/TabBar.tsx` — pastille "dirty" par onglet, croix
  appelle `attemptCloseTab`, rend `<ConfirmCloseTabModal/>`.
- `apps/desktop/src/renderer/routes/schema.tsx` — `useRegisterTabDirty(isDirty)` ; son propre
  gestionnaire Escape ignore la touche si une fermeture d'onglet est déjà en attente.
- `apps/desktop/src/renderer/routes/req.$reqId.tsx`, `test.$testId.tsx` —
  `useRegisterTabDirty(hasChanges)` (réutilise le flag déjà calculé par la vue) +
  `useSetTabTitle(...)`.
- `apps/desktop/src/renderer/routes/campaign.$campaignId.tsx` —
  `useRegisterTabDirty(editingFields !== null)` + `useSetTabTitle(...)`.
- `specs/SPEC-ELECTRON-DESKTOP.md` §19.1 (diagramme + description étendus avec la barre
  d'onglets), §19.3 (note de distinction titre fenêtre OS / titre par onglet).
- `specs/SPEC-INDEX.md` — nouvelle ligne §19.1/§19.3 → T101.

## Fichiers créés

- `apps/desktop/src/renderer/components/layout/ConfirmCloseTabModal.tsx` — popup générique
  "Fermer sans enregistrer ?", même gabarit que `CancelConfirmModal` (schema.tsx), Escape pour
  annuler.

## Comportement implémenté

Périmètre sprint 2 complet selon `specs/T101-design.md` §3, étendu à `req.$reqId.tsx` et
`test.$testId.tsx` (tous deux avaient déjà un flag `hasChanges` identique au `isDirty` de
schema.tsx — réutilisé par un seul appel, comme le design l'anticipait pour toute vue future au
même patron) : un onglet enregistré "dirty" affiche une pastille orange dans la barre, Ctrl+W et
la croix demandent confirmation avant de fermer/réinitialiser un onglet dirty, le filet de
sécurité "blur le champ focus avant d'évaluer" est en place, Escape ferme la popup sans
interférer avec l'Escape propre à schema.tsx.

## Bugs trouvés et corrigés

**Trouvés par `/code-review high` (8 angles), corrigés avant tout test interactif :**

1. **Boucle de rendu infinie** dans `setTabTitleOverride` : `.map()` retournait toujours un
   nouveau tableau même quand le titre ne changeait pas réellement, ce qui — combiné à l'absence
   de mémoïsation de la fonction — relançait indéfiniment l'effet de `useSetTabTitle`. Corrigé
   par un bail-out explicite (retourner `prev` inchangé si le titre est déjà correct).
2. **Empty title indistinguable de "pas encore chargé"** dans `useSetTabTitle` : `''` était
   traité comme `null`/`undefined`, laissant un titre générique périmé pour un titre légitimement
   vide. Corrigé : seul `null`/`undefined` est désormais ignoré.
3. **`campaign.$campaignId.tsx` sans dirty-tracking** malgré un flux d'édition explicite
   équivalent (`editingFields`) — ajouté.
4. **`ConfirmCloseTabModal` sans Escape** (incohérent avec `CancelConfirmModal`/
   `PublishPopover`) — ajouté, avec garde côté `schema.tsx` pour éviter l'empilement des deux
   popups sur la même touche.
5. Ctrl+T/Ctrl+W non désactivés pendant que la popup de confirmation est ouverte — ajouté.

**Trouvés seulement en testant interactivement l'app (deux allers-retours réels, non détectés
par la revue de code statique) :**

6. **Régression introduite par le correctif du point ci-dessus visant une race sur
   `activeTabId`** (`useRegisterTabDirty`/`useSetTabTitle` pinnaient l'id de l'onglet via une
   `ref` capturée au montage plutôt que de lire `activeTabId` en direct). Cassait la pastille
   dirty et la confirmation de fermeture dans le cas très courant de deux onglets ouverts sur la
   même route (ex. "+" ouvre systématiquement sur `/schema` quand un projet est chargé — un
   deuxième onglet sur la même URL ne remonte jamais `schema.tsx`, donc son `ref` restait
   pointé sur le tout premier onglet ayant affiché cette URL, pour le reste de la session).
   Revert vers la lecture en direct de `activeTabId` (voir commentaire dans `TabsContext.tsx`) —
   la race qu'elle visait à corriger est nettement plus étroite (aucune route de l'app n'utilise
   de `loader` TanStack Router, donc pas de fenêtre asynchrone où l'ancien rendu pourrait
   survivre) et acceptée comme compromis documenté.
7. **Reset d'onglets déclenché à tort sur la toute première ouverture de projet d'une session**
   (transition `currentProjectId` null → non-null) : créait un nouvel id d'onglet alors que
   `schema.tsx` était déjà monté sur la même URL, orphelinant son enregistrement dirty — exact
   même symptôme que le point 6, cause différente. Corrigé en excluant cette transition de la
   condition `isRealSwitch` (elle ne doit se déclencher que sur un changement entre deux projets
   déjà chargés, ou une fermeture réelle).

Ces deux derniers points illustrent une même limite structurelle : toute règle qui suppose "un
montage de route = un onglet" est fragile dans ce modèle single-Outlet, dès que deux onglets
peuvent légitimement partager la même URL (le cas le plus courant étant justement le bouton "+").
Signalé dans le code pour que toute évolution future de ce mécanisme parte de cette contrainte.

## Comment tester manuellement

1. Ouvrir `/schema`, modifier un type de lien (le `*` apparaît dans le titre) : la pastille
   orange apparaît sur l'onglet actif, sur lui seul si plusieurs onglets sont ouverts.
2. Ctrl+W ou la croix sur cet onglet : popup "Fermer sans enregistrer ?" ; Annuler/Escape
   préserve le brouillon, confirmer ferme et perd le brouillon.
3. Fermer un onglet non dirty : aucune popup, fermeture immédiate.
4. Ouvrir 3 onglets (dont un via "+", tous par défaut sur la même URL /schema si un projet est
   chargé), rendre l'onglet actif dirty, fermer un onglet différent et non dirty : silencieux ;
   Ctrl+W sur l'onglet dirty : popup correcte.
5. `tsc --noEmit` : 0 erreur. `/code-review high` (8 angles) : 5 findings corrigés avant tout
   test. 2 régressions supplémentaires trouvées et corrigées en testant interactivement l'app
   réelle (build + Electron piloté via Playwright, profils fraîchement créés) — non détectables
   par la seule lecture du code, la piste a nécessité d'inspecter l'état React en direct via des
   logs temporaires (retirés avant commit).

Voir `specs/T101-tests.md` pour les scénarios N11-N14, L4-L5 (dirty-state), désormais couverts.

## Addendum — bug signalé par l'utilisateur après validation manuelle

**Symptôme rapporté :** "j'ai plusieurs tabs d'ouvert, je clique sur comparer dans version, les
tabs sont fermés il n'en reste plus que 1."

**Root cause :** `RootLayout` (`__root.tsx`, et donc tout ce qu'il contient — `TabsProvider`
inclus) se démonte et se remonte entièrement sur certaines navigations, dont celle déclenchée par
le bouton "Comparer deux versions" du panneau Version vers `/version-diff`. Vérifié comme
**préexistant sur `master`, avant tout changement T101** (reproduit dans un worktree jetable sur
le commit de base, avec le même log de montage/démontage) — probablement un avatar du même
défaut TanStack Router déjà documenté ailleurs dans ce repo (`apps/desktop/.claude/skills/
run-desktop`, "Cold boot sometimes shows a stray Not Found... TanStack Router initial-history-entry
mismatch"), lié au protocole `file://`. Invisible avant ce ticket car rien de statefull ne vivait
dans ce sous-arbre ; T101 y a placé les onglets ouverts, premier état visible à en pâtir.

**Correctif appliqué (dans le périmètre de T101, pas un correctif du bug routeur sous-jacent) :**
`tabs`/`activeTabId`/`recentlyClosed` sont mis en cache dans une variable de module (hors état
React), réhydratée à chaque montage de `TabsProvider` — un remount ne réinitialise donc plus la
liste d'onglets. `dirtyTabIds`/`pendingCloseId` ne sont volontairement pas mis en cache : la vue
qui les avait enregistrés est elle-même réellement démontée par ce même remount, donc son
brouillon en mémoire est réellement perdu — mettre en cache le seul indicateur visuel aurait
affiché une pastille "dirty" mensongère pour un brouillon qui n'existe plus nulle part.

**Non corrigé, hors périmètre T101 :** la cause profonde (pourquoi TanStack Router démonte
`RootLayout` sur cette navigation) reste ouverte — un correctif propre demanderait d'investiguer
le routeur/le protocole `file://` indépendamment des onglets. Conséquence résiduelle acceptée :
un brouillon non enregistré dans la vue active au moment d'une telle navigation est perdu sans
avertissement, exactement comme avant T101 (pas une régression de ce ticket, juste rendu visible
différemment). À signaler comme ticket séparé si l'utilisateur souhaite l'investiguer.

**Vérifié :** rebuild + test interactif (3 onglets ouverts, un dirty, clic Version → Comparer) —
les 3 onglets survivent désormais à la navigation ; seule la pastille "dirty" disparaît (cohérent
avec la perte réelle du brouillon).

## Addendum 2 — spécificité des titres d'onglet (retour utilisateur)

**Retour rapporté :** "lorsque je clique sur recherche le nom du tab ne change pas. le nom du
tab de la vue system est produit, il faudrait etre plus specifique... vue suivi, vue analyse
d'impact, compare, arbre de version..."

**Sur "Recherche" :** clic sur l'icône Recherche de l'ActivityBar ne navigue jamais le main frame
(`AppLayout.tsx` — `search` est dans `SIDEBAR_ONLY_PANELS`, seul le contenu de la sidebar change).
Le contenu principal de l'onglet ne changeant pas, l'onglet ne change pas de nom — comportement
volontaire, pas un bug : le titre représente ce qui est affiché dans le main frame, pas quel
panneau de la sidebar est ouvert. Cliquer un **résultat** de recherche, en revanche, navigue bien
vers `/req/$reqId` etc. et bénéficie déjà du titre spécifique (voir plus haut).

**Sur la spécificité générale :** `useSetTabTitle` étendu à des vues qui ne l'avaient pas encore :

- `product.tsx` / `components.tsx` (panneaux Système "Produit"/"Composants") — le nom générique
  du panneau est remplacé par `${effectiveNode.label} — ${effectiveType.label}` (ex. "Produit —
  Exigences fonctionnelles"), lu directement depuis `useSystemView()` déjà consommé par la vue
  elle-même (pas de nouvel appel réseau). Garde volontaire en `||` (pas `??`) : un type sauvegardé
  avec un nom/label vide retombe sur le titre générique, comme s'il était absent.
- `dashboard.tsx` — `useSetTabTitle(dashboard?.title)`, réutilise la donnée déjà chargée.
- `query.tsx` — `useSetTabTitle(savedQueries.find(q => q.id === queryId)?.title)` ; une requête
  ad hoc/historique (non sauvegardée) n'a pas de nom stable, garde le titre générique "Requêtes".
- `graph.tsx` — `Arbre de versions — {repoName}` (nom du repo actuellement sélectionné dans
  l'arbre Version).
- `compliance.tsx` — `Conformité — {interfaceName}` (interface actuellement sélectionnée).

Non touchés (jugés suffisamment génériques par nature, listes sans élément unique sélectionné) :
`baseline.tsx`, `requirements.tsx`, `tests.tsx`. `/version-diff`/`/impact-analysis` avaient déjà
un titre statique correct depuis le sprint 1 (§2.3).

**Vérifié interactivement** (profil dédié, type d'objet réellement nommé "Exigences
fonctionnelles" créé et sélectionné) : titre d'onglet passe de "Produit" à
"Produit — Exigences fonctionnelles", correspond exactement à l'en-tête de la page
("Produit / Exigences fonctionnelles"). Bascule Système → Version → Suivi → Système confirme
qu'aucun onglet ne perd son titre spécifique entre-temps.

Note en cours de vérification : la première tentative avec un profil de test réutilisé montrait
un titre "Produit — " avec un tiret suivi de rien — pas un bug de la logique de titre, mais un
type d'objet resté sans nom dans le fixture de test (créé par erreur en validant le formulaire de
création sans remplir les champs, lors d'un essai précédent). La garde `||` ajoutée couvre ce cas
proprement (retombe sur le titre générique) quelle qu'en soit la cause.

## Mises à jour SPEC

- `specs/SPEC-ELECTRON-DESKTOP.md` §19.1 : diagramme et description étendus avec la barre
  d'onglets (T101).
- `specs/SPEC-ELECTRON-DESKTOP.md` §19.3 : note ajoutée distinguant le titre de fenêtre OS
  (scope projet, inchangé) du titre par onglet (nouveau, scope TabsContext).
- `specs/SPEC-INDEX.md` : nouvelle ligne indexant SPEC-ELECTRON-DESKTOP.md §19.1/§19.3 → T101
  (aucune section n'indexait la barre d'onglets avant ce sprint).
