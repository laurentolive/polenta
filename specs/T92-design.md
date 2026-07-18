# T92 — Design technique

## 1. Vue d'ensemble

Deux composants partagés nouveaux, réutilisés partout, plutôt qu'une refonte visuelle
par vue :

- `ViewHeader` (nouveau, `components/layout/ViewHeader.tsx`) — barre de titre unique
  pour les vues principales. Reprend telle quelle la seule barre déjà cohérente du code
  (`EditView.tsx:450-467` : `px-4 py-2.5 border-b border-edge bg-surface`, titre
  `text-sm font-semibold text-ink`). Monte lui-même `ModificationControl` dans un slot
  toujours présent à droite.
- Généralisation de `.section-label` (classe déjà existante, `index.css:118`, inchangée)
  aux 2 panneaux qui n'ont pas d'en-tête (`SystemPanel`, `DashboardPanel`), et
  alignement du padding d'un panneau isolé (`SearchPanel`, `px-3 py-2` → `px-4 py-3`).

**Découverte pendant l'analyse — corrige `specs/T92.md`** : `ModificationControl` est
monté aujourd'hui dans `AppLayout.tsx:138` sans condition de route (`{currentProjectId
&& <ModificationControl .../>}`), et `useModificationMode` résout son `mode` à partir du
repo courant (racine ou `?repo=`), pas de la vue affichée. Le bouton Publier est donc
déjà visible sur **toutes** les vues d'un projet ouvert aujourd'hui (Exigences, Tests,
Schéma, Suivi…), pas seulement Système/Version comme l'écrivait `T92.md` — c'est
justement pour ça qu'il flotte en `fixed` par-dessus n'importe quel contenu. Ce design
préserve ce périmètre (toutes les vues d'un projet ouvert) : chaque vue migrée doit donc
passer son `currentProjectId` à `ViewHeader`, pas seulement Système/Version, sous peine
de régression (le bouton disparaîtrait des autres vues).

Aucun nouveau canal IPC, aucun nouveau type dans `@polenta/types` — refonte purement
renderer (layout + positionnement).

---

## 2. Fichiers à modifier

### 2.1 Nouveau composant : `components/layout/ViewHeader.tsx`

```tsx
interface ViewHeaderProps {
  back?: { label?: string; onClick: () => void }
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  currentProjectId?: string | null   // absent ⇒ pas de slot Publier (ex. /account)
}
```

- Conteneur : `shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-edge
  bg-surface`.
- `back` (optionnel) : `<button className="flex items-center gap-1 text-xs text-ink-3
  hover:text-ink transition-colors shrink-0"><ArrowLeft size={14} />{label ??
  'Retour'}</button>` — remplace les boutons retour ad hoc de `baseline.tsx`,
  `test.$testId.tsx` (run), etc.
- `title` + `subtitle` dans `<div className="flex-1 min-w-0">` : titre
  `text-sm font-semibold text-ink truncate`, sous-titre (si fourni)
  `text-xs text-ink-3 mt-0.5 truncate` (utilisé par `graph.tsx` pour le nom de branche
  actuellement affiché sous le `<h1>`, ligne 858-862).
- `actions` (optionnel) : `<div className="flex items-center gap-2 shrink-0">`.
- Slot Publier : si `currentProjectId` est fourni (`!== undefined`), rend
  `<ModificationControl currentProjectId={currentProjectId} />` juste après `actions`,
  toujours en dernière position. `ModificationControl` garde sa propre logique de
  visibilité (`mode === 'other'` → `null`) — `ViewHeader` ne fait aucun filtrage
  supplémentaire.

### 2.2 `components/layout/ModificationControl.tsx` — retrait du `fixed`, popover ancré

- **Conteneur racine** (ligne 201) : `fixed top-3 right-4 z-30 flex flex-col items-end
  gap-1.5` → `relative flex items-center gap-2 shrink-0`. Le composant participe
  désormais au flux de `ViewHeader` au lieu de flotter par-dessus le viewport.
- **Bandeaux non modaux** (`mode === 'blocked'`, `pushError`, `pinWarning` — lignes
  203-238) : actuellement empilés en `flex-col` sous le bouton dans le même conteneur
  `fixed`. Comme le conteneur racine perd son `flex-col items-end` (il redevient une
  ligne `flex items-center` pour s'intégrer à la barre), ces bandeaux passent dans un
  wrapper dédié `absolute right-0 top-full mt-1.5 z-40 flex flex-col items-end gap-1.5`
  — ancré sous le bouton plutôt que sous le conteneur racine. Contenu et logique de
  chaque bandeau inchangés.
- **`Overlay`** (lignes 25-33, `fixed inset-0 bg-black/50 flex items-center
  justify-center z-40`) — supprimé, remplacé par deux éléments :
  1. Une couche de capture de clic invisible, `fixed inset-0 z-40` (sans
     `bg-black/50`) — reprend le principe déjà utilisé par `FieldConfigModal`
     (`SystemView.tsx:150-153`, backdrop `fixed inset-0` sans assombrissement, fermeture
     au clic dessus) plutôt que d'inventer un nouveau pattern.
  2. Le panneau lui-même, `absolute right-0 top-full mt-2 z-50 bg-surface border
     border-edge rounded-lg shadow-xl p-6 w-full max-w-md` — ancré au conteneur
     `relative` du bouton (pas au viewport), donc toujours juste sous le bouton quelle
     que soit la vue. `w-full max-w-md` conservé (contenu du formulaire inchangé), mais
     `mx-4` (marge pensée pour un centrage plein écran) retiré, inutile en ancrage
     coin-à-coin.
- **Fermeture au clavier** : le popup de saisie du titre a déjà un handler `Escape` sur
  son `<input>` (ligne 249) — inchangé. Le popup d'erreur/conflit n'en avait aucun
  (fermeture uniquement via le clic sur le backdrop plein écran, qui disparaît) — ajout
  d'un `onKeyDown` global (`window.addEventListener('keydown', …)`, `useEffect` scopé à
  `publishError !== null`) fermant sur `Escape`, pour ne pas perdre cette possibilité de
  fermeture.
- **`z-index`** : `z-40` (couche de capture) / `z-50` (panneau) — cf. §4.3 pour le choix
  de valeurs par rapport à l'existant.
- Aucun changement à `publishMutation`, `slugify`, `PublishConflictError`,
  `isStalePopup`, ni à la logique métier de résolution nominal/avancé/bloqué (T87) —
  uniquement le rendu (JSX de conteneur/positionnement) est modifié.

### 2.3 `components/layout/AppLayout.tsx`

- Retrait de l'import et du montage global : ligne 5 (`import { ModificationControl }
  …`) et ligne 138 (`{currentProjectId && <ModificationControl … />}`) supprimés —
  `ModificationControl` n'est plus jamais monté directement par `AppLayout`, uniquement
  via `ViewHeader` dans chaque vue.
- Aucun autre changement (sidebar, resize, providers inchangés).

### 2.4 `contexts/SystemViewContext.tsx`

Le `currentProjectId` reçu en prop par `SystemViewProvider` (ligne 173) n'est
aujourd'hui pas exposé dans la valeur retournée par `useSystemView()`. Ajout d'un champ
`currentProjectId` à l'objet retourné (valeur déjà disponible localement dans le
provider, simple passthrough) — nécessaire pour que `SystemView.tsx` puisse le
transmettre à `ViewHeader` sans prop drilling depuis `product.tsx`.

### 2.5 `components/system/SystemView.tsx` — vue pilote n°1

Remplace le bloc `<div className="shrink-0 flex items-center gap-2 px-3 py-2
border-b border-edge">` (lignes 922-1004) par `<ViewHeader>` :

- `back` : le bloc actuel `backHistory.length > 0 && viewMode !== 'edit'` (lignes
  929-938) devient `back={backHistory.length > 0 && viewMode !== 'edit' ? { label:
  'Retour', onClick: handleGoBack } : undefined}`.
- `title` : `titleLabel` (ligne 911-916) inchangé.
- `actions` : tout le reste dans l'ordre actuel — `<RichTextToolbar>`, undo/redo,
  bouton réglages (`Settings`), sélecteur de vue Excel/Word — regroupés dans un
  `<>…</>` passé à `actions`. Aucun changement de comportement individuel.
- `currentProjectId` : `useSystemView().currentProjectId` (§2.4).

C'est la vue où `ModificationControl` est le plus souvent visible en pratique (avec
Version) — traitée en premier pour valider le comportement du nouveau popover avant de
dupliquer le pattern sur les 17 autres vues.

### 2.6 `routes/graph.tsx` — vue pilote n°2 (Version)

- Conteneur actuel (lignes 853-864, `px-6 py-4 border-b border-edge shrink-0` +
  `<h1 className="text-lg font-semibold text-ink">` + sous-ligne branche +
  `PinPropagationWarning`) → `<ViewHeader>` :
  - `title` : `Arbre de versions{repoName ? \` — ${repoName}\` : ''}`.
  - `subtitle` : le bloc `syncStatus?.branch` (lignes 858-862) déplacé dans le slot
    `subtitle`.
  - `currentProjectId` : déjà disponible via `Route.useSearch().projectId` (route
    existante).
  - **`PinPropagationWarning` (ligne 863)** : actuellement affiché dans l'en-tête de
    `graph.tsx` lui-même — indépendant du flux Publier de `ModificationControl`
    (déclenché par les actions de checkout/commit du panneau Version, T82). Reste à sa
    place actuelle dans le corps de `graph.tsx`, **pas** déplacé dans `ViewHeader` — ce
    ticket ne touche que l'avertissement de pin déclenché par `ModificationControl`
    lui-même (celui de §2.2), pas celui-ci.

### 2.7 Vues restantes — migration mécanique (Sprint 2)

Même pattern que §2.5/2.6 appliqué à chacune, sans changement fonctionnel des actions
qu'elles contiennent — seul le conteneur d'en-tête et la taille du titre changent. Toutes
lisent déjà `projectId` via `Route.useSearch()` (vérifié pour `dashboard.tsx`,
`campaign.new.tsx` ; à confirmer au cas par cas en sprint, la convention `?projectId=`
est systématique sur les routes internes à un projet dans ce code) :

| Fichier | Conteneur actuel | Titre actuel | Particularité à préserver |
|---|---|---|---|
| `requirements.tsx:76-81` | aucun (juste `mb-6`) | `text-xl font-semibold` | badge compteur `({filtered.length})` → `subtitle` ou concaténé au `title` |
| `tests.tsx` (même structure) | aucun | `text-xl font-semibold` | idem |
| `dashboard.tsx:139-169` | aucun (`flex items-center justify-between gap-4`) | `<input>` éditable inline | `title` reçoit l'`<input>` tel quel (nœud React) ; bascule Privé/Partagé + "Ajouter un widget" → `actions` |
| `query.tsx:232` | aucun | `text-xl font-semibold` | — |
| `schema.tsx:441-472` | `mb-6` | `text-xl font-semibold` + `*` si dirty | indicateur dirty conservé dans `title` ; Enregistrer/Annuler/Enregistré/erreur → `actions` |
| `baseline.tsx:218-230` | `px-6 py-4 border-b border-edge shrink-0 flex items-center gap-3` | `text-sm font-semibold` | bouton retour (`ChevronLeft`) → `back` ; icône `Tag` conservée à côté du titre dans `title` |
| `req.$reqId.tsx:125` | à identifier en sprint | `text-xl font-semibold` | — |
| `req.new.tsx:83` | `mb-6` | `text-xl font-semibold` | — |
| `test.$testId.tsx:125-149` | `flex items-center gap-3 h-8 mb-4 border-b border-edge pb-2` | `text-base font-semibold` | select/input statut + id → `title` (nœud composite) ; `RichTextToolbar` → `actions` (§2.9) |
| `test.new.tsx:104-131` | `mb-6`-like | `text-base font-semibold shrink-0` | `RichTextToolbar` → `actions` |
| `campaign.$campaignId.tsx:180-194` | `flex items-start gap-3 mb-1` | `text-2xl font-semibold` | badge statut → `actions` ; `RichTextToolbar` → `actions` |
| `campaign.new.tsx:128-131` | `mb-6` | `text-2xl font-semibold shrink-0` | `RichTextToolbar` → `actions` |
| `campaign.$campaignId.execute.$testId.tsx:145-165` | `px-6 py-3 border-b border-edge shrink-0` | `text-sm font-semibold` | bouton retour + séparateur (`w-px h-4 bg-edge`) → `back` ; id + titre composite → `title` ; `RichTextToolbar` + badge statut → `actions` |
| `campaign.$campaignId.run.$testId.tsx:82-107` | pas de conteneur bordé, bouton retour séparé (`mb-5`) | `text-xl font-semibold` | bouton retour → `back` ; id + titre + badge statut → `title`/`actions` ; pas de `RichTextToolbar` (lecture seule) |
| `compliance.tsx:70-87` | à identifier en sprint | `text-lg font-semibold` | — |
| `diff.tsx:93` | `px-6 py-4 border-b border-edge shrink-0 flex items-center gap-4` | pas de `<h1>` (chemin de fichier `font-mono`) | `title` reçoit directement le chemin en `font-mono` (dérogation typographique assumée — un chemin de fichier n'est pas un titre de vue, cf. §4.4) |
| `version-diff.tsx:352-369` | plusieurs sous-en-têtes (`px-4 py-3` / `px-3 py-2`) | pas de titre unique | seul l'en-tête de premier niveau migre vers `ViewHeader` ; les sous-en-têtes internes (sélecteurs de comparaison) restent inchangés — hors scope (comparaison, pas titre de vue) |
| `account.tsx:57-59` | aucun (`space-y-6`) | `text-xl font-semibold` | pas de `currentProjectId` (panneau Compte, hors contexte projet) → slot Publier omis |

### 2.8 Panneaux latéraux

- `components/sidebar/SystemPanel.tsx` : ajout, avant `<FilterBar />` (ligne 38),
  d'un bloc `<div className="px-4 py-3 border-b border-edge"><p
  className="section-label">Système</p></div>` (libellé repris de
  `ActivityBar.tsx:21`).
- `components/sidebar/DashboardPanel.tsx` : ajout du même bloc avec `Suivi`
  (`ActivityBar.tsx:22`), avant les sections `ReorderableSidebarSection` existantes.
- `components/sidebar/SearchPanel.tsx:421` : `px-3 py-2 border-b border-edge shrink-0
  space-y-2` → `px-4 py-3 border-b border-edge shrink-0 space-y-2` (seul le padding
  change, le reste du contenu de ce bloc — barre de recherche/options — inchangé).
- `ProjectPanel.tsx`, `VersionPanel.tsx`, `RequirementsPanel.tsx`, `TestsPanel.tsx`,
  `AccountPanel.tsx` : déjà conformes (`px-4 py-3 border-b border-edge` +
  `.section-label`) — non modifiés.

### 2.9 `RichTextToolbar` — pas de changement du composant lui-même

`components/system/RichTextToolbar.tsx` n'est pas modifié : sa logique d'affichage
conditionnel (actif seulement quand un champ richtext a le focus, via
`RichTextContext`) reste identique. Seul son point de montage change, dans les 6 vues
listées en §1bis de `T92.md` : il passe du conteneur d'en-tête propre à chaque vue au
slot `actions` de `ViewHeader` (mêmes props `repoPath`).

---

## 3. Nouvelles interfaces / types

Uniquement renderer, non partagé :

```typescript
// components/layout/ViewHeader.tsx
interface ViewHeaderProps {
  back?: { label?: string; onClick: () => void }
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  currentProjectId?: string | null
}
```

`ModificationControlProps` (`{ currentProjectId: string | null }`) inchangée.
`SystemViewContextValue` gagne un champ `currentProjectId: string`.

---

## 4. Décisions techniques et alternatives rejetées

### 4.1 Un `ModificationControl` par `ViewHeader`, pas un singleton global

**Décision** : chaque `ViewHeader` monte sa propre instance de `ModificationControl`
(donc démonté/remonté à chaque changement de vue) plutôt que de garder un singleton
global positionné différemment.
**Rationale** : `useModificationMode` s'appuie sur react-query (`queryKey` scopées à
`repoPath`/`currentProjectId`) — remonter le composant réutilise le cache, pas de
flash de chargement perceptible. L'état local transitoire du composant (popup ouvert,
titre saisi) se réinitialise à la navigation, ce qui est le comportement désiré (déjà
partiellement forcé aujourd'hui par l'effet de la ligne 83-96 qui ferme le popup sur
changement de `mode`/`repoPath`/`branch`).
**Alternative rejetée** : garder un singleton monté dans `AppLayout` et le positionner
en `position: absolute` à l'intérieur d'un point d'ancrage exposé par `ViewHeader`
(`ref`/portail). Rejetée — complexité inutile (gestion de ref cross-composant,
mesure de position) pour un gain nul, vu que le remontage react-query est gratuit ici.

### 4.2 `subtitle` en slot dédié plutôt que concaténé au `title`

**Décision** : `ViewHeader` a un slot `subtitle` séparé (ligne sous le titre, `text-xs
text-ink-3`) plutôt que de forcer chaque vue à composer elle-même un nœud multi-lignes
dans `title`.
**Rationale** : seul `graph.tsx` en a besoin aujourd'hui (nom de branche sous le titre)
— avoir un slot dédié documente l'intention et évite que chaque vue réinvente le même
`<div><span/><span/></div>` si un futur ticket ajoute un sous-titre ailleurs.

### 4.3 `z-index` du nouveau popover : `z-40` (capture clic) / `z-50` (panneau)

**Décision** : aligné sur le `z-50` déjà utilisé par `DiamondConflictModal` et
`FieldConfigModal` (les seules modales franchement "au-dessus de tout" du code
existant), au lieu de réutiliser `z-40` (ancien `Overlay` de `ModificationControl`) ou
`z-30` (ancien bouton lui-même).
**Rationale** : le popover Publier doit rester au-dessus du contenu de la vue et de son
propre `ViewHeader` (`z-index` implicite = ordre DOM, pas de valeur explicite sur
`ViewHeader`) — `z-50` garantit qu'il n'est jamais recouvert par une autre modale déjà
présente dans le code (toutes à `z-50` ou moins).
**Alternative rejetée** : introduire une échelle de `z-index` documentée pour toute
l'app (variables Tailwind nommées). Rejetée — explicitement hors scope de ce ticket
(`T92.md` § Hors scope explicite), le correctif ici ne fait que positionner le nouveau
popover dans la pile existante sans la réorganiser.

### 4.4 `diff.tsx` — dérogation typographique assumée pour le `title`

**Décision** : `diff.tsx` n'affiche pas de titre de vue au sens propre (juste un chemin
de fichier en `font-mono text-sm`, ligne 93) — le slot `title` de `ViewHeader` reçoit ce
chemin tel quel plutôt que d'être forcé dans `text-sm font-semibold` générique.
**Rationale** : le critère d'acceptation n°2 de `T92.md` ("même classe de
taille/graisse... sur toutes les vues migrées") vise la taille de police, pas le
contenu — un chemin de fichier en `font-mono` reste à `text-sm`, seule sa graisse/police
diffère légitimement (convention déjà utilisée ailleurs dans le code pour les chemins,
ex. `EditView.tsx:463` id en `font-mono`). Documenté ici pour que le Dev ne le traite
pas comme un oubli de migration.

---

## 5. Arbre de fichiers créés / modifiés

```
apps/desktop/src/renderer/
  components/layout/ViewHeader.tsx            NOUVEAU
  components/layout/ModificationControl.tsx   modifié (retrait fixed, popover ancré)
  components/layout/AppLayout.tsx             modifié (retrait montage global)
  contexts/SystemViewContext.tsx              modifié (expose currentProjectId)
  components/system/SystemView.tsx            modifié (→ ViewHeader, sprint 1)
  routes/graph.tsx                            modifié (→ ViewHeader, sprint 1)
  routes/requirements.tsx                     modifié (→ ViewHeader, sprint 2)
  routes/tests.tsx                            modifié (→ ViewHeader, sprint 2)
  routes/dashboard.tsx                        modifié (→ ViewHeader, sprint 2)
  routes/query.tsx                            modifié (→ ViewHeader, sprint 2)
  routes/schema.tsx                           modifié (→ ViewHeader, sprint 2)
  routes/baseline.tsx                         modifié (→ ViewHeader, sprint 2)
  routes/req.$reqId.tsx                       modifié (→ ViewHeader, sprint 2)
  routes/req.new.tsx                          modifié (→ ViewHeader, sprint 2)
  routes/test.$testId.tsx                     modifié (→ ViewHeader, sprint 2)
  routes/test.new.tsx                         modifié (→ ViewHeader, sprint 2)
  routes/campaign.$campaignId.tsx             modifié (→ ViewHeader, sprint 2)
  routes/campaign.new.tsx                     modifié (→ ViewHeader, sprint 2)
  routes/campaign.$campaignId.execute.$testId.tsx  modifié (→ ViewHeader, sprint 2)
  routes/campaign.$campaignId.run.$testId.tsx      modifié (→ ViewHeader, sprint 2)
  routes/compliance.tsx                       modifié (→ ViewHeader, sprint 2)
  routes/diff.tsx                             modifié (→ ViewHeader, sprint 2)
  routes/version-diff.tsx                     modifié (→ ViewHeader, sprint 2, en-tête de premier niveau seulement)
  routes/account.tsx                          modifié (→ ViewHeader, sprint 2, sans slot Publier)
  components/sidebar/SystemPanel.tsx          modifié (ajout section-label, sprint 3)
  components/sidebar/DashboardPanel.tsx       modifié (ajout section-label, sprint 3)
  components/sidebar/SearchPanel.tsx          modifié (padding, sprint 3)

specs/SPEC-ELECTRON-DESKTOP.md                modifié (sprint final — nouvelle section ViewHeader/section-label)
specs/SPEC-INDEX.md                           modifié (sprint final — nouvelle ligne d'index)
```

---

## 6. Découpage en sprints

### Sprint 1 — Fondations : `ViewHeader` + `ModificationControl` ancré (2 vues pilotes)

**Périmètre** :
- `ViewHeader.tsx` (nouveau).
- `ModificationControl.tsx` : retrait `fixed`, popover ancré, bandeaux non modaux ancrés,
  fermeture Échap sur le popup d'erreur.
- `AppLayout.tsx` : retrait du montage global.
- `SystemViewContext.tsx` : expose `currentProjectId`.
- Migration de `SystemView.tsx` (vue Système) et `routes/graph.tsx` (vue Version) —
  les deux vues où `ModificationControl` est le plus visible/testé aujourd'hui.

**Critères de validation Sprint 1** : CA-1 à CA-5 de `T92.md` **vérifiés sur ces 2 vues
uniquement** (le reste de CA-1/CA-2 — "toutes les vues" — est complété en Sprint 2) ;
CA-8 (non-régression T87) intégralement, puisque c'est ici que la logique de publication
est exercée.

### Sprint 2 — Rollout mécanique (16 vues restantes)

**Périmètre** : migration de toutes les vues listées en §2.7, suivant le pattern validé
en Sprint 1. Y compris le repositionnement de `RichTextToolbar` dans le slot `actions`
sur les 6 vues concernées (§2.9).

**Critères de validation Sprint 2** : CA-1, CA-2 complets (toutes les vues) ; CA-8
(critère n°8 de `T92.md`, position de `RichTextToolbar`).

### Sprint 3 — Panneaux latéraux + documentation SPEC

**Périmètre** :
- `SystemPanel.tsx`, `DashboardPanel.tsx` : ajout `section-label`.
- `SearchPanel.tsx` : padding.
- Sprint final (dernier sprint du ticket) : mise à jour `SPEC-ELECTRON-DESKTOP.md`
  (nouvelle section documentant `ViewHeader` et la convention de header de panneau) +
  `SPEC-INDEX.md`.

**Critères de validation Sprint 3** : CA-6, CA-7 de `T92.md`. Passe de régression
visuelle rapide sur l'ensemble des vues et panneaux migrés (CA-1 à CA-7 récapitulatifs).

---

## 7. Refs SPEC consultées pour ce design

- `SPEC-FORKS-BRANCHES-BASELINES.md` §1-2 (workflow Publier, T87) — logique métier
  confirmée non touchée, uniquement son rendu.
- `SPEC-ELECTRON-DESKTOP.md` §19.3/19.6 — section à étendre au sprint final (§6, Sprint 3).
- Aucune autre section SPEC concernée.
