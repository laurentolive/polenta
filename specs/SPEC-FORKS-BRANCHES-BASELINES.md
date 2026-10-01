# SPEC-FORKS-BRANCHES-BASELINES — Variantes, Composants et Jalons

> Référence parent : [SPEC.md](../SPEC.md) §2.5  
> Dépend de : [SPEC-TECH-stack.md](SPEC-TECH-stack.md) (git comme source de vérité)

---

## 1. Vue d'ensemble

Trois concepts couverts par cette spec :

| Concept | Analogie git | Usage |
|---------|-------------|-------|
| **Branche** | `git branch` | Travail parallèle dans un même projet (feature, variante, review) |
| **Fork** | `git clone` / fork | Nouveau projet dérivé (variante produit, reconception) |
| **Composant** | `git submodule` | Bloc de spécifications réutilisable entre plusieurs produits |
| **Baseline** | `git tag` | Snapshot immuable à un jalon (release, audit, certification) |

---

## 2. Branches

> **Implémentation actuelle** : il n'existe pas de `BranchService`/`MergeService` séparés — les
> opérations de branche/merge vivent directement dans `SyncService`
> (`apps/desktop/src/main/services/sync.service.ts`), exposées en IPC sous le namespace `sync:*`
> (`sync:create-branch`, `sync:checkout-branch`, `sync:delete-branch`, `sync:merge-into`,
> `sync:push-branch`…). La convention de nommage n'est **pas libre** : deux préfixes structurent
> tout le modèle (T81) — `int-*` pour les branches d'intégration et `dev-*` pour les branches de
> travail. Depuis T87, `int-*` n'est plus en lecture seule dans l'UI (`VersioningContext.isReadonly`
> ne reflète plus que le detached HEAD, cf. §2.1) — seule la convention de nommage subsiste, plus la
> contrainte d'accès. Chaque repo (root ou composant, chacun projet Polenta autonome avec son propre
> `config/project.yaml`) a une branche d'intégration **configurée**
> (`GitService.getIntegrationBranch`/`setIntegrationBranch`, fallback `'main'` si non configurée) —
> c'est vers cette branche que les merges automatiques du workflow ci-dessous sont dirigés.

### 2.1 Cas d'usage — workflow simplifié "Publier" (T83, simplifié T87)

Depuis T87, l'édition est possible directement sur n'importe quelle branche checkoutée (y compris
la branche d'intégration `int-*`) — la seule condition bloquant l'édition est un **detached HEAD**
(commit ou tag checkouté sans branche, typiquement une baseline). Il n'y a plus de bouton "Faire
une modification" ni de bouton "Annuler" : un seul bouton, **"Publier"**, dont le comportement se
résout au clic à partir de la branche courante du repo concerné et de sa branche d'intégration
**configurée** — évalué indépendamment pour chaque repo d'un workspace multi-repo :

| Branche courante du repo | Comportement de "Publier" |
|---|---|
| `branch === integrationBranch` (cas nominal — utilisateur non technique) | Popup titre → **fetch du remote (T154, voir note ci-dessous)** → crée `dev-<slug-du-titre>` depuis la position courante (le checkout ne touche aucun fichier, cf. note `createBranch` ci-dessous — les modifications non commitées suivent) → **fast-forward de l'intégration locale si elle est en retard (T154)** → stage + commit (message = titre) → merge dans la branche d'intégration → checkout de la branche d'intégration + suppression de `dev-<slug>` → push de la branche d'intégration vers `origin`. |
| `branch` ne commence pas par `int-` et diffère de `integrationBranch` (branche `dev-*` ou branche libre — usage avancé, utilisateur git) | Popup titre → fetch + fast-forward de l'intégration si en retard (T154, comme ci-dessus) → stage + commit **directement sur `branch`**, aucune branche intermédiaire créée → merge vers la branche d'intégration → push. Le repo **reste checkouté sur `branch`** après coup ; cette branche n'est **jamais supprimée automatiquement** — créée par l'utilisateur, il en reste responsable. |
| `branch` commence par `int-` mais diffère de `integrationBranch` (une autre branche d'intégration que celle configurée pour ce repo) | **Publication interdite** pour ce repo — l'édition reste possible, seul "Publier" est bloqué (mergerait deux branches d'intégration entre elles, ce qui n'a pas de sens). |
| Detached HEAD | Édition elle-même bloquée (`VersioningContext.isReadonly` / `SystemViewContext.isRepoReadonly`) — "Publier" non pertinent. |

Le discard de modifications en attente (l'ancien rôle du bouton "Annuler") reste possible mais
uniquement depuis le panneau Version (`VersionRepoFolder.tsx`, action "Tout annuler") —
délibérément moins accessible que dans T83 pour limiter les pertes de travail accidentelles.

**Rafraîchir / `git pull` (T153) :** un bouton icône "Rafraîchir" est affiché en permanence dans
l'en-tête de chaque repo (`VersionRepoFolder.tsx`, à côté du nom, avant le `BranchCombobox`) et
déclenche `SyncService.pull()` (déjà exposé en IPC/`api.sync.pull` depuis T74 mais jamais appelé
par l'UI avant ce ticket). Désactivé (avec tooltip explicatif) tant que le repo a des
modifications en attente (`staged`/`unstaged` non vides) — même garde que celle utilisée pour
bloquer un checkout direct au §2.1 — pour ne jamais faire merger un pull sur un working tree
sale. Pas de gate sur `behind`/`ahead` : contrairement au bouton Push (visible seulement si
`ahead > 0`), le bouton Rafraîchir reste toujours visible, sur demande explicite.

> **Correctif `SyncService.createBranch` (T87) :** créer une branche à la position courante alors
> que le répertoire de travail contient des modifications non commitées (le cas nominal ci-dessus)
> ne doit écraser aucun fichier. `git.branch({ checkout: true })` d'isomorphic-git délègue à son
> `checkout()`, qui par défaut réécrit les fichiers suivis — risque réel de perte de travail.
> `createBranch` utilise désormais `git.branch({ checkout: false })` puis
> `git.checkout({ ref: name, noCheckout: true })`, qui déplace `HEAD` sans toucher un seul fichier.
> Bénéficie à tous les appelants de `sync:create-branch` (pas seulement "Publier").

> **Intégration à jour avant merge (T154) :** avant tout, `publishMutation` fait un
> `SyncService.fetch()` du remote — pendant qu'on est encore checkouté sur `branch`, ce qui est
> sûr car `fetch` n'écrit que des refs distantes (`refs/remotes/...`), jamais une branche locale.
> Si ce fetch échoue (réseau, proxy, auth), la publication est bloquée immédiatement avec un
> message dédié ("réseau indisponible") — **avant** toute création de branche ou commit, donc sans
> aucun effet de bord ; il est jugé préférable qu'une publication échoue clairement faute de réseau
> plutôt que de réussir en silence sur une intégration locale potentiellement obsolète (retour
> utilisateur explicite lors de la conception de ce ticket). Un repo sans remote configuré (projet
> purement local) reste inchangé : `fetch()` y est un no-op, pas une erreur.
>
> Une fois hors de `integrationBranch` (branche éphémère créée, ou déjà sur `branch` dans le cas
> avancé), `SyncService.fastForwardBranch()` avance la référence locale de l'intégration jusqu'au
> commit distant tout juste récupéré, **sans jamais toucher le répertoire de travail** — seule une
> réécriture de `refs/heads/<intégration>`, ce qui suppose de ne jamais l'appeler pendant qu'on est
> checkouté sur cette branche (sinon HEAD/index et fichiers désynchronisent silencieusement).
> Si l'intégration locale a divergé (commits locaux non poussés en attente d'un push précédent
> resté en échec — cas préexistant, rare) : laissée inchangée, `mergeInto` se comporte comme avant
> ce ticket pour ce cas précis — pas de nouvelle UI de résolution introduite ici.

> **Règle :** toute modification d'exigence ou de test finit par transiter par une branche `dev-*`
> avant merge dans l'intégration — soit une branche éphémère créée par "Publier" (cas nominal), soit
> une branche `dev-*`/libre créée manuellement depuis le panneau Version (usage avancé).  
> Pas de fichier YAML de métadonnées associé à la branche — elle est son propre identifiant. L'ancien
> flux "Action" (`ActionService`, IDs `ACT-XXXX`, review obligatoire avant merge) a été retiré (T83
> sprint 2) — il n'était atteignable depuis aucune navigation de l'UI et faisait doublon avec ce
> workflow simplifié.

### 2.2 Règles

- Chaque repo a une branche d'intégration **configurée** (pas nécessairement `main` — désignée
  depuis le Modèle de données, onglet Structure, widget `IntegrationBranchSelector` affiché sous la
  ligne du repo root — anciennement `IntBranchSelector` dans le "Tableau de bord" de la vue Projet,
  retiré en T86). Depuis T87, ce widget checkoute directement une branche `int-*` (avec la même
  garde de confirmation qu'un checkout ailleurs dans l'app si des modifications sont en attente —
  `int-*` n'est plus garanti propre).
- Toute branche `dev-*` (éphémère ou manuelle) hérite de l'état de sa branche d'intégration au
  moment de sa création.
- Les exigences et tests sont **isolés par branche** : modifier SW-0042 sur `dev-mode-boost` ne
  touche pas la branche d'intégration tant que "Publier" n'a pas été cliqué.
- Les reviews (fonctionnalité générique, indépendante de ce workflow) peuvent être créées sur
  n'importe quelle branche.
- Aucune garde applicative n'empêche de checkout une autre branche/commit sur un repo qui a des
  modifications en attente (décision explicite T87) — comportement natif d'isomorphic-git : succès
  si aucun conflit de fichier (les modifications suivent alors sur la nouvelle cible), erreur native
  sinon.

### 2.3 Cycle de vie d'une branche

```
int-v1 (intégration, éditable depuis T87) ─────────────►
      │                                    ▲
      │ "Publier" (crée dev-* si besoin)   │ "Publier" (merge auto + push)
      ▼                                    │
      dev-<slug> (éphémère) ───────────────┘
      (stage+commit via "Publier", supprimée après merge réussi)
```

**Création d'une branche (workflow "Publier", cas nominal) :** IPC `sync:create-branch` avec un nom
`dev-<slug>` dérivé du titre saisi (collision résolue par suffixe numérique). Crée la branche à la
position courante sans checkout matériel (cf. note `createBranch` en §2.1) puis y déplace `HEAD`.

**Création manuelle (panneau Version, avancé) :** IPC `sync:create-branch` avec un nom libre,
depuis `BranchCombobox`/`VersionRepoFolder.tsx` — pas de contrainte de préfixe imposée par le
backend, seule l'UI simplifiée (T83/T87) impose `dev-*` pour son propre flux.

**Merge ("Publier") :**
1. `sync:stage-all` puis `sync:commit` sur la branche de travail (éphémère ou courante selon le cas
   du tableau §2.1)
2. `sync:merge-into` (repoPath, brancheDeTravail, brancheIntégration) — merge par référence, sans
   nécessiter de checkout préalable de la branche d'intégration
3. Si pas de conflit et cas nominal → `sync:checkout-branch` vers l'intégration +
   `sync:delete-branch` de la branche éphémère ; puis dans tous les cas (nominal ou avancé) →
   `sync:push-branch` de la branche d'intégration vers `origin` (best-effort, un échec de push
   n'annule pas le merge local déjà acquis)
4. Si conflit → voir §2.4

**Suppression :** `sync:delete-branch` — possible sur toute branche sauf celle actuellement
checkoutée. Seule la branche éphémère créée par le cas nominal de "Publier" est supprimée
automatiquement ; toute branche créée manuellement par l'utilisateur (y compris via l'usage avancé
de "Publier") ne l'est jamais.

### 2.4 Résolution de conflits

**État actuel (T84) :** la détection de conflit reste **binaire au niveau fichier**, pas champ par
champ. `SyncService.merge`/`mergeInto` détectent `MergeConflictError` d'isomorphic-git via
`instanceof git.Errors.MergeConflictError` (pas un test sur `err.message` — cf. note historique
ci-dessous) et retournent `{ success: false, conflicts: string[] }`, où `conflicts` porte les
chemins réels des fichiers en conflit (`err.data.filepaths`). Le type `YamlConflict`
(`base`/`ours`/`theirs`/`conflictingFields`), jamais peuplé et sans consommateur, a été supprimé de
`sync.service.ts` par ce ticket.

En cas d'échec de "Publier", l'utilisateur reste sur sa branche `dev-*` (aucune perte de travail),
une notification affiche le message générique ("quelqu'un a modifié les mêmes informations") **et**
la liste des fichiers en conflit, avec un bouton "Résolution manuelle (Version)" qui navigue vers
`/version-diff` — scopé au repo réellement concerné (root ou composant, pas systématiquement le
root comme le lien `/graph` utilisé avant ce ticket) et pré-rempli avec le diff entre la branche
`dev-*` et la branche d'intégration. Résolution manuelle = éditer le fichier sur `dev-*` pour
réconcilier son contenu (en s'aidant de ce diff), committer, relancer "Publier" — pas d'assistance
de résolution dans l'UI au-delà de ce diff en lecture seule.

**Note historique :** avant T84, la détection utilisait `err.message.includes('MergeConflictError')`
— une chaîne qui n'apparaît en réalité jamais dans le message de l'erreur isomorphic-git. Le catch
tombait donc toujours dans `throw err` ; un conflit de merge remontait comme une erreur non gérée
plutôt que comme l'échec binaire documenté par `T83`. Corrigé par ce ticket en même temps que le
peuplement de `conflicts`.

**Résolution champ par champ — non implémentée, hors périmètre (pas de ticket ouvert à ce jour) :**
l'exemple ci-dessous reste une vision non engagée, pas un comportement livré ou planifié :

```
Conflit sur SW-0042 — Exigence moteur démarrage

Champ : criticality
  Base (fork point) :  moyenne
  intégration       :  haute        [choisir]
  dev-mode-boost    :  critique     [choisir ★]
  Valeur custom     :  [___________]

Champ : statement
  Base :  "WHEN moteur démarre THE système SHALL..."
  intégration :  inchangé
  dev-mode-boost :  "WHEN démarrage reçu THE système SHALL..."  [choisir ★]
  → Pas de conflit sur ce champ (un seul côté a changé → auto-résolu)
```

Nécessiterait de lire les 3 versions du fichier, comparer les champs, et construire une UI de
résolution dédiée — non engagé.

### 2.5 Auto-pull périodique (T155)

Tant qu'un projet est ouvert, `useAutoPull` (`apps/desktop/src/renderer/hooks/useAutoPull.ts`,
monté une fois dans `AppLayout.tsx`, indépendamment du panneau/onglet actif) tente toutes les
**5 minutes** de mettre à jour chaque repo du workspace (root + composants/interfaces) — objectif :
un utilisateur non git-initié n'a jamais besoin de savoir que "Rafraîchir" (T153) existe. Ne
tourne jamais à l'ouverture du projet elle-même (`setInterval` diffère naturellement son premier
tick) — l'ouverture fait déjà sa propre résolution réseau (clone/fetch des dépendances manquantes),
inutile de la ralentir davantage.

Par repo, à chaque tick :
1. Ignoré si des fichiers stagés ou non stagés existent (même garde que T153).
2. Sinon, `SyncService.pullFastForwardOnly()` (nouveau, distinct de `pull()`) — **jamais** de vrai
   merge à trois voies : contrairement à un clic explicite sur "Rafraîchir", une opération
   silencieuse et non demandée ne doit jamais pouvoir écrire des marqueurs de conflit dans les
   fichiers de l'utilisateur pendant qu'il travaille sur autre chose. Un repo qui a divergé (commits
   locaux non poussés, cf. §2.1 T154) échoue silencieusement, retenté au tick suivant.
3. Aucune notification ni indicateur — succès invisible, échec journalisé (`console.warn`) jamais
   remonté à l'utilisateur.

> **Note (constatée pendant les tests de T155, non corrigée par ce ticket) :**
> `WorkspaceTreeService.writeCache` réécrit `.polenta/tree.cache.yaml` avec un `generatedAt`
> recalculé à chaque régénération de l'arbre (typiquement à chaque ouverture de projet). Ce fichier
> étant suivi par git, le repo apparaît "modifié" (au moins ce fichier) peu après l'ouverture — ce
> qui bloque la garde ci-dessus (comme celle de T153) jusqu'à ce que l'utilisateur committe ou
> annule ce changement. Cause racine distincte du pull, mérite un ticket dédié.

---

## 3. Forks de projet

### 3.1 Cas d'usage

| Scénario | Pourquoi un fork plutôt qu'une branche |
|----------|--------------------------------------|
| Créer une variante produit longue durée (aspirateur EU vs US) | Cycle de vie indépendant, équipes différentes |
| Réutiliser un projet existant comme point de départ | Base commune, évolution divergente |
| Isoler un client (OEM) | Données séparées, accès contrôlé |

### 3.2 Opération de fork

Un fork **clone** le repo git du projet source et crée un nouveau projet indépendant dans le registre.

```
IPC : workspace:clone
{ remoteUrl: "<fork-url>", localPath: "/chemin/local" }
```
Ou directement via `SyncService.clone()` depuis un repo git déjà forké sur le remote.

**Ce qui est copié :**
- Tout l'historique git (tous les commits, toutes les branches)
- Toutes les exigences, tests, reviews, baselines

**Ce qui n'est PAS copié :**
- Les composants référencés (ils pointent vers les mêmes repos sources)
- Les utilisateurs et permissions (à reconfigurer dans le fork)

**Enregistrement du lien dans `config/project.yaml` du fork :**
```yaml
# config/project.yaml du fork
schemaVersion: 1
name: "Aspirateur EU — v2"
integrationBranch: integration
forkOf: https://github.com/org/aspirateur-v1.git
forkCommitSha: "abc123..."   # SHA du commit HEAD au moment du fork
```

Ce lien est dans le repo git lui-même (versionné, portable). Il permet de calculer ce qui a divergé entre le fork et le projet source.

### 3.3 Merge fork → projet source (ou inversement)

Le merge inter-projets suit le même algorithme que le merge de branches :

1. Identifier le **point de divergence** (le commit SHA enregistré au moment du fork)
2. Calculer `Δ_fork` et `Δ_source` depuis ce point
3. Appliquer les changements non conflictuels automatiquement
4. Présenter les conflits pour résolution manuelle

**Limitation V1 :** le merge inter-projets est un **wizard guidé**, pas une opération git directe (les repos sont distincts). L'API :
- Lit les YAML du fork à son HEAD
- Lit les YAML du source depuis le fork point
- Calcule les deltas
- Génère un "patch" à appliquer sur le projet cible

```
IPC : workspace:merge-from-fork
{ repoPath, forkLocalPath, forkCommitSha }
→ Retourne ImpactReport + liste des changements auto-mergeables + conflits
```

L'utilisateur valide → les changements sont commités sur le projet cible.

---

## 4. Composants

### 4.1 Principe

Un **composant** est un projet Polenta autonome dont les exigences (et tests) peuvent être **inclus par référence** dans d'autres projets. Analogue aux submodules git.

> **T123** : un composant peut aussi être **local** (vivre dans le `schema.yaml` du repo courant,
> sans submodule séparé — cf. `SPEC-TEMPLATES.md` §3) et imbriqué sous un autre composant local à
> n'importe quelle profondeur. Ce mécanisme reste entièrement distinct du modèle "composant = repo
> séparé" décrit dans cette section — un composant en repo séparé ne peut jamais être imbriqué sous
> un composant local, pour une raison technique (un submodule est déclaré dans
> `polenta-repo.yaml`, un fichier par repo, jamais au niveau d'un `SystemNode` particulier),
> pas fonctionnelle.

**Exemples :**
- `component-battery-bms` — Spécifications BMS réutilisées dans 3 produits
- `component-motor-driver` — Spécifications du driver moteur
- `component-iec60335-safety` — Exigences de sécurité IEC 60335 (base normative)

### 4.2 Référencer un composant dans un projet

Le fichier `config/components.yaml` dans le repo git du projet liste les composants inclus :

```yaml
# config/components.yaml
components:
  - id: comp-bms
    name: "Battery BMS"
    sourceProjectId: proj-battery-bms
    sourceRef: "baseline/v2.1"       # tag git dans le repo du composant
    mountPoint: BAT                   # type d'exigences importées (filtre)
    prefix: "BMS"                     # préfixe affiché pour distinguer les IDs

  - id: comp-motor
    name: "Driver moteur"
    sourceProjectId: proj-motor-driver
    sourceRef: "baseline/v1.0"
    mountPoint: HW
    prefix: "MOT"
```

La référence `sourceRef` **pointe toujours vers une baseline ou un tag** — jamais vers `main` d'un composant (qui peut changer). C'est le principe de version pin.

### 4.3 Visibilité dans le projet parent

> **Spec caduque (constatée T87) :** le modèle `components.yaml` + `sourceRef` figé sur une
> baseline/tag décrit ci-dessous ne correspond à aucune implémentation actuelle — l'architecture
> réelle (T30) utilise des submodules git plats et autonomes, sans mécanisme de pin déclaratif de ce
> type ni de lecture-seule imposée à un composant en tant que tel. Le seul motif de lecture-seule
> restant dans le code (`SystemViewContext.isRepoReadonly`) est le detached HEAD d'un repo — pas la
> nature "composant" du repo. Cette section reste comme repère historique de l'intention initiale ;
> une réécriture alignée sur l'architecture submodules est hors scope de T87 (à traiter par un
> ticket dédié).

Quand un projet charge ses exigences, l'index mémoire inclut :
1. Ses propres exigences (lues depuis son repo git)
2. Les exigences de chaque composant (lues depuis le repo du composant à la ref pinnée)

Les exigences de composant sont **distinguées visuellement** (badge "BMS", "MOT") et **en lecture seule** dans le contexte du projet parent.

**Hiérarchie dans l'arbre :**
```
SYS-0001  Exigence système — Performance aspiration
  └── SW-0042   Exigence firmware — Mode Éco            [projet courant]
  └── [BMS] BAT-0001  Gestion surcharge cellule         [composant Battery BMS v2.1]
  └── [MOT] HW-0001   Driver moteur — courant max        [composant Motor Driver v1.0]
```

**Ce qu'on peut faire avec des exigences de composant :**
- Les lire et naviguer dans leur hiérarchie
- Créer des liens depuis les exigences du projet (`SW-0042 SATISFIES [BMS] BAT-0001`)
- Les inclure dans des reviews et campagnes de test
- Les voir dans la matrice de traçabilité

**Ce qu'on NE peut PAS faire :**
- Les modifier (read-only)
- Créer des exigences enfants directement dedans

### 4.4 Mise à jour d'un composant (upgrade)

Quand une nouvelle baseline du composant est disponible :

```
PATCH /projects/:id/components/comp-bms
{ "sourceRef": "baseline/v3.0" }
```

**Processus :**
1. Calcul des changements entre `v2.1` et `v3.0` dans le composant
2. Analyse d'impact : quelles exigences du projet parent ont des liens vers des exigences modifiées du composant ?
3. Les éléments liés sont marqués `needsRevalidation` (T172 : flag porté par les éléments, SPEC-REQ §5.3)
4. Un résumé est affiché avant confirmation

```
Mise à jour BMS : v2.1 → v3.0

Changements dans le composant :
  BAT-0003  Température pack  ← modifié (v4 → v5)
  BAT-0009  Charge rapide     ← nouveau
  BAT-0012  Court-circuit     ← archivé

Impact sur votre projet :
  SW-0051 SATISFIES [BMS]BAT-0003  ⚠ à revalider
  TEST-0007 couvre [BMS]BAT-0003   ⚠ à revalider
  [BMS]BAT-0012 référencé par SW-0088  → exigence cible archivée, lien à supprimer
```

L'utilisateur confirme → `config/components.yaml` est mis à jour, commit git, index invalidé.

### 4.5 Création d'un composant

Tout projet Polenta peut être publié comme composant :

```
POST /projects/:id/publish-as-component
```

Cette opération ne crée pas de nouveau repo — elle marque simplement le projet comme "composant disponible" dans le catalogue partagé. D'autres projets peuvent ensuite le référencer.

---

## 5. Baselines

### 5.1 Principe

Une **baseline** est un snapshot immuable de l'ensemble du projet à un instant T, créé à un **jalon** (release produit, audit, revue de conception, fin de sprint).

En git : un tag `baseline/<nom>` posé sur `main` (ou la branche à baseline).

### 5.2 Conditions de création

Avant de créer une baseline, Polenta vérifie et affiche :

| Condition | Comportement |
|-----------|-------------|
| Des exigences en brouillon sur `main` | ⚠ Avertissement (bloquant si configuré) |
| Des exigences approuvées sans test lié | ⚠ Avertissement |
| Des éléments marqués `needsRevalidation` (T172) | ⚠ Avertissement |
| Des campagnes de test en cours | ℹ Information |
| Taux de couverture < seuil configuré | ⚠ Avertissement (ex. < 80%) |

L'utilisateur peut forcer la création malgré les avertissements (avec commentaire justificatif).

**T79 — baseline multi-composant** : dans un workspace multi-repo, une condition supplémentaire
est vérifiée **par repo** (root et composants) et affichée avant même la saisie du tag, sans
modification en attente (stagée ou non). Les repos en défaut sont listés avec leur raison.

> **T46** : la condition T79 vérifiait aussi que chaque repo soit sur sa branche d'intégration
> configurée — **retiré**. Le besoin de mesurer l'impact d'une modification avant de la livrer exige de
> pouvoir baseliner une branche de travail (`dev-*`) quelconque, pas seulement la branche
> d'intégration ; cela aligne le comportement sur §5.7 ci-dessous, qui décrivait déjà qu'une baseline
> peut être posée sur n'importe quelle branche. Seule l'absence de modification en attente reste
> **bloquante et non contournable** (pas de "forcer la création" possible) — la branche courante du
> repo est toujours affichée à titre informatif dans le récapitulatif, mais ne bloque plus.

### 5.3 Contenu d'une baseline

> **Implémentation actuelle** : il n'y a pas de fichier d'index (`.polenta/baselines.yaml` a été
> retiré — voir encadré ci-dessous) ni de fichiers individuels `baselines/<nom>.yaml`. Le tag git
> est l'unique source de vérité : `BaselineService.list()` (`apps/desktop/src/main/services/baseline.service.ts`)
> énumère les tags du repo racine via `git.listTags`, et ne retient comme baseline que ceux
> présents sous le même nom sur chaque composant (submodule) du workspace — ce qui écarte les tags
> créés ponctuellement ailleurs (ex. depuis la vue graphe des commits) sur un seul repo. `createdAt`
> est dérivé de la date du commit taggé (`git.readCommit`), pas d'un champ stocké.
>
> **Historique** : une première version (T58/T79) agrégeait les métadonnées dans un fichier unique
> `.polenta/baselines.yaml` versionné dans le repo racine. Ce fichier a été abandonné car son contenu
> dépendait du commit/branche checkouté — changer de branche changeait la liste de baselines
> affichée, alors que les tags git, eux, sont visibles quel que soit le checkout courant.

```yaml
# baselines/v1.0.yaml  ← structure logique (fichier unique en implémentation)
id: baseline-v1.0
name: "v1.0 — Release production marché EU"
tag: "baseline/v1.0"
branch: main
commitSha: "abc123def456..."
createdAt: "2026-06-01T10:00:00Z"
createdBy: user-123
milestone: "Production Release"
description: "Première mise en production aspirateur Polenta EU. Certification IEC 60335 obtenue."
forcedCreation: false
warnings: []

stats:
  requirements:
    total: 48
    approved: 48
    draft: 0
    archived: 3
  tests:
    total: 62
    approved: 60
    draft: 2
  coverage:
    covered: 45          # exigences avec au moins un test
    notCovered: 3
    coverageRate: 93.8%
  execution:
    passRate: 100%       # des tests exécutés
    lastRunDate: "2026-05-28"

components:
  - id: comp-bms
    name: "Battery BMS"
    sourceProjectId: proj-battery-bms
    sourceRef: "baseline/v2.1"
    commitSha: "def456..."
  - id: comp-motor
    name: "Driver moteur"
    sourceProjectId: proj-motor-driver
    sourceRef: "baseline/v1.0"
    commitSha: "ghi789..."
```

> **Implémentation actuelle (T79)** : `components` est en pratique une liste `{ name, tag }`
> beaucoup plus simple que la structure logique ci-dessus (pas de `id`/`sourceProjectId`/
> `sourceRef`/`commitSha` par composant) — cf. `BaselineComponentRecord` dans
> `packages/api-client/src/types.ts`. Un composant n'apparaît dans cette liste que si son tag a
> effectivement été posé avec succès (les échecs de tag par composant, rares, sont non-bloquants
> pour la création de la baseline mais signalés à l'utilisateur — le composant concerné est alors
> absent de `components`).

**Paramètres (T171)** : `parameters/parameters.yaml` est versionné comme les exigences et les
tests ; une campagne avec `baselineRef` lit la base de chaque repo au tag du même nom (produit et
composants), sans repli sur l'état courant si le tag manque dans un repo (SPEC-TESTS §4.2).

### 5.4 Ce qu'une baseline gèle

| Élément | Gel |
|---------|-----|
| Exigences | État de tous les fichiers YAML au commit taggé |
| Tests et exécutions | Idem — les runs existants sont accessibles via le commit |
| Versions des composants | Figées via `sourceRef` dans `config/components.yaml` |
| Configuration du projet | Schéma des types, workflows, template |
| Matrice de traçabilité | Regénérable depuis le tag à tout moment |

### 5.5 Consultation d'une baseline

N'importe quelle baseline peut être consultée en lecture seule :

```
GET /projects/:id/baselines/v1.0/requirements
GET /projects/:id/baselines/v1.0/traceability/matrix
```

L'API lit les fichiers YAML depuis le tag git (`git show baseline/v1.0:requirements/SW-0042.yaml`), sans modifier l'index courant.

L'UI permet de **naviguer dans une baseline** comme si on était dans l'état du projet à ce moment-là.

### 5.6 Comparaison entre baselines

> **T46 — implémentation réelle** : pas d'endpoint REST `GET /baselines/diff` (l'app desktop
> n'expose rien en HTTP, cf. `SPEC-ELECTRON-DESKTOP.md` §1) — le diff exigence-par-exigence est
> `TraceabilityService.diffRequirementsBetweenRefs(repoPath, fromSha, toSha)`, exposé en IPC
> (`traceability:diff-requirements`), et utilisé en interne par `createImpactAnalysis` (cf.
> `SPEC-TRACEABILITY.md` §4.6, qui documente le flux complet — diff + arbres d'impact + statuts). Champs
> réellement produits par entrée : `reqId`, `changeType` (`added`/`removed`/`modified`), `changedFields`
> (`field`/`from`/`to`), `titleFrom`/`titleTo` — plus proche de la forme ci-dessous que de l'exemple
> `testCoverageChange`/`componentUpdates`, qui ne sont **pas** implémentés (pas de diff de couverture ni
> de comparaison multi-composant, cf. `T46.md` Hors scope).

```yaml
addedRequirements:
  - SW-0055  "Nouveau mode Boost"
  - BAT-0015  "Limite courant charge rapide"

removedRequirements:
  - SW-0012  "Mode veille — archivé"

modifiedRequirements:
  - reqId: SW-0042
    changedFields:
      - field: criticality
        from: haute
        to: critique
      - field: statement
        from: "WHEN démarrage..."
        to: "WHEN signal démarrage reçu..."
```

### 5.7 Baseline et branches

Une baseline peut être posée sur n'importe quelle branche, pas seulement `main` — cf. correction T46 en
§5.2 (le code, via T79, l'empêchait en pratique jusque-là ; c'est désormais aligné avec ce que cette
section décrivait déjà).

Si on a besoin d'une baseline sur une branche (ex: baseline de la variante US au moment de sa validation, ou d'une branche `dev-*` avant de la livrer, cf. `SPEC-TRACEABILITY.md` §4.6), on la crée explicitement dessus :

```
POST /projects/:id/baselines
{ "name": "v1.0-US", "branch": "variant/us-market", "milestone": "US Market Release" }
```

---

## 6. Stockage Git — structure complète

```
<project-git-repo>/
├── config/
│   ├── project.yaml             ← schemaVersion, integrationBranch, forkOf...
│   ├── requirement-types.yaml
│   └── components.yaml          ← références aux composants
├── requirements/
├── versions/
├── tests/
├── test-runs/
├── campaigns/
├── campaign-runs/
├── reviews/
├── review-comments/
├── baselines/                   ← métadonnées des baselines
│   ├── v1.0.yaml
│   └── v2.0.yaml
├── impact-acks/
├── links/
│   └── links.yaml
└── traceability/
    └── matrix.yaml              ← généré par scripts/matrix.py
```

**Tags git créés par Polenta :**
```
baseline/v1.0          ← baseline / jalon
baseline/v2.0
baseline/v1.0-PDR      ← jalon nommé (Preliminary Design Review)
SW-0042/v1             ← version d'une exigence
SW-0042/v2
TEST-0007/v1           ← version d'un test
```

---

## 7. Index mémoire — extensions

### 7.1 Index avec composants

```typescript
interface ProjectIndex {
  own: BranchIndex          // exigences et tests du projet courant
  components: Map<string, ComponentIndex>  // clé = comp.id
}

interface ComponentIndex {
  projectId: string
  ref: string               // baseline tag pris comme base
  requirements: Map<string, Requirement>
  tests: Map<string, TestCase>
  loadedAt: Date
}
```

Lors d'une recherche ou d'un filtrage, les deux maps sont interrogées et les résultats sont annotés avec leur source (`own` ou `comp-bms`).

### 7.2 Cache des baselines

Les baselines ne sont pas pré-chargées en mémoire — elles sont lues à la demande (`git show <tag>:<file>`). Le cache LRU garde les N dernières consultées.

---

## 8. Décisions de conception

| Point | Décision |
|-------|----------|
| Composant = sous-module | Oui — projet Polenta indépendant, référencé avec version pinnée sur une baseline |
| Exigences de composant modifiables | Non — read-only dans le projet parent |
| Pin du composant | Toujours sur une baseline/tag, jamais sur `main` |
| Merge fork → source | Wizard guidé (V1), pas de git merge direct entre repos distincts |
| Baseline forcée | Autorisée avec commentaire justificatif |
| Baseline sur branche non-main | Autorisée (ex: variante produit) |
| Comparaison baselines | Supportée — diff field-by-field entre deux tags |
