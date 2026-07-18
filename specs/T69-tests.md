# T69-tests — Scénarios de test : Workspace plat & Interfaces versionnées

---

## 1. Scénarios nominaux (golden path)

### T69-N-01 — Créer un workspace depuis un repo local existant

**Prérequis** : Un répertoire `~/dev/product-aspirateur-v1/` existe, c'est un repo git valide avec `.polenta/schema.yaml` mais sans `polenta-repo.yaml`.

**Étapes** :
1. Lancer Polenta → WorkspacePage.
2. Cliquer "Créer un workspace", sélectionner `~/dev/` comme répertoire workspace.
3. Indiquer `~/dev/product-aspirateur-v1` comme repo root (chemin local).
4. Valider.

**Résultat attendu** :
- `~/dev/.polenta/workspace.yaml` est créé avec `rootRepo: product-aspirateur-v1`.
- La WorkspacePage navigue vers la vue workspace.
- Aucun repo supplémentaire n'est cloné (pas de `polenta-repo.yaml` dans le root).
- `.polenta/tree.cache.yaml` est écrit avec un seul nœud (le root).

**Critère d'acceptation** : CA-1, CA-6.

---

### T69-N-02 — Ouvrir un workspace existant avec cache valide

**Prérequis** : `~/dev/.polenta/workspace.yaml` existe, `~/dev/.polenta/tree.cache.yaml` existe et est cohérent avec le HEAD actuel du repo root.

**Étapes** :
1. Lancer Polenta → WorkspacePage.
2. Cliquer "Ouvrir un workspace", sélectionner `~/dev/`.
3. Valider.

**Résultat attendu** :
- Polenta lit `tree.cache.yaml` directement (pas de parsing récursif).
- La vue workspace affiche l'arbre en < 500 ms.
- Aucun clone réseau déclenché.

**Critère d'acceptation** : CA-2, UC-2.

---

### T69-N-03 — Ouvrir un workspace avec cache périmé (nouveau commit sur root)

**Prérequis** : `tree.cache.yaml` existe mais `rootRepoHeadSha` ne correspond plus au HEAD actuel.

**Étapes** :
1. Ouvrir le workspace.

**Résultat attendu** :
- Polenta invalide le cache et lance le parsing récursif.
- Les repos déjà clonés à la bonne version sont skippés.
- `tree.cache.yaml` est réécrit avec le nouveau SHA.

**Critère d'acceptation** : CA-2.

---

### T69-N-04 — Parsing récursif : 3 dépendances dont une partagée

**Configuration** :
```
workspace/
├── product-root/        (polenta-repo.yaml: deps=[comp-a@sha1, comp-b@sha1, iface-can@sha2])
├── comp-a/              (polenta-repo.yaml: deps=[iface-can@sha2])
├── comp-b/              (pas de polenta-repo.yaml)
└── iface-can/           (pas de polenta-repo.yaml)
```

**Étapes** :
1. Ouvrir le workspace (aucun repo cloné sauf product-root).
2. Valider le lancement du parsing.

**Résultat attendu** :
- `comp-a` est cloné @ `sha1`.
- `comp-b` est cloné @ `sha1`.
- `iface-can` est cloné @ `sha2` une seule fois (même URL, même pin → instance partagée).
- `tree.cache.yaml` contient 4 nœuds, `iface-can` est référencé depuis product-root ET comp-a mais n'apparaît qu'une fois dans la liste plate.

**Critère d'acceptation** : CA-2 (N = 4 repos distincts, pas de doublon).

---

### T69-N-05 — Repo déjà cloné au bon pin → pas de re-clone

**Prérequis** : `comp-a/` existe dans le workspace, HEAD correspond au pin déclaré.

**Étapes** :
1. Ouvrir le workspace.

**Résultat attendu** :
- Aucun `git clone` lancé pour `comp-a`.
- Le log ne contient aucune opération réseau pour ce repo.

**Critère d'acceptation** : CA-2.

---

### T69-N-06 — Conflit diamond détecté : notification avant tout clone

**Configuration** :
```
product-root/polenta-repo.yaml:
  deps: [comp-a@sha_a, comp-b@sha_b]
comp-a/polenta-repo.yaml:
  deps: [iface-can@pin-v1]
comp-b/polenta-repo.yaml:
  deps: [iface-can@pin-v2]   ← pin différent !
```
`iface-can` n'est pas encore cloné.

**Étapes** :
1. Ouvrir le workspace (parsing récursif).

**Résultat attendu** :
- La modale `DiamondConflictModal` s'affiche.
- Le conflit est décrit : "iface-can requis par comp-a @ pin-v1 et comp-b @ pin-v2".
- `iface-can` n'est PAS encore cloné.
- Les deux chemins de dépendance sont listés.

**Critère d'acceptation** : CA-3.

---

### T69-N-07 — Résolution conflit diamond (Option B : coexistence)

**Prérequis** : Conflit diamond détecté (T69-N-06).

**Étapes** :
1. Dans `DiamondConflictModal`, saisir `can-bus-next` pour pin-v2, `can-bus-legacy` pour pin-v1.
2. Confirmer.

**Résultat attendu** :
- `.polenta/workspace.yaml` est mis à jour avec les `mount-overrides`.
- Le parsing reprend.
- `workspace/can-bus-next/` est cloné @ pin-v2.
- `workspace/can-bus-legacy/` est cloné @ pin-v1.
- `tree.cache.yaml` contient deux nœuds distincts pour la même URL avec des noms différents.

**Critère d'acceptation** : CA-4.

---

### T69-N-08 — Supprimer les champs URL/branche de l'UI Schema

**Étapes** :
1. Ouvrir `routes/schema.tsx` (UI).
2. Aller dans l'onglet "Composants".

**Résultat attendu** :
- Aucun champ "URL dépôt" ni "Branche d'intégration" dans le tableau.
- Le tableau comporte uniquement : Nom, Label, Description, (actions).
- La sauvegarde du schema ne génère pas de `.gitmodules`.

**Critère d'acceptation** : CA-5.

---

### T69-N-09 — Projet mono-repo sans polenta-repo.yaml : aucune régression

**Prérequis** : Projet existant sans `polenta-repo.yaml` (cas mono-repo), liste des projets récents dans `workspace.json`.

**Étapes** :
1. Lancer Polenta.
2. Cliquer sur le projet récent.

**Résultat attendu** :
- Le projet s'ouvre normalement.
- Les exigences, tests, campagnes, baselines fonctionnent identiquement.
- Aucun message d'erreur lié au workspace.

**Critère d'acceptation** : CA-6.

---

### T69-N-10 — Déclaration de rôles dans un repo interface

**Prérequis** : `iface-can/.polenta/schema.yaml` contient `roles: [{name: controller}, {name: device}]`.

**Étapes** :
1. Ouvrir le workspace.
2. Consulter la vue workspace tree.

**Résultat attendu** :
- `iface-can` porte un badge visuel "Interface" dans l'arbre.
- La vue détail du repo liste les rôles déclarés.

**Critère d'acceptation** : CA-7.

---

### T69-N-11 — Composant implémenteur : couverture par rôle

**Prérequis** :
- `comp-a/.polenta/schema.yaml` déclare `implements: [{interface: iface-can, version: "2.1", roles: [device]}]`.
- `iface-can` a 3 exigences `approved` : CAN-001 (roles: [controller]), CAN-002 (roles: [device]), CAN-003 (roles: []).
- `comp-a` a un lien `implements-interface` vers CAN-002 et CAN-003 mais pas CAN-001.

**Étapes** :
1. Consulter la vue conformité de `comp-a` vis-à-vis de `iface-can`.

**Résultat attendu** :
- CAN-001 : grisée (non applicable — comp-a n'est pas controller).
- CAN-002 : `covered` (lien présent).
- CAN-003 : `covered` (exigence commune, lien présent).
- Aucune alerte de non-couverture.

**Critère d'acceptation** : CA-8.

---

### T69-N-12 — Matrice de conformité multi-composants

**Prérequis** : Workspace avec `iface-can` (interface) + `comp-motor` (device) + `comp-bms` (controller + device).

**Étapes** :
1. Ouvrir la vue "Conformité interfaces" depuis le workspace.

**Résultat attendu** :
- Lignes : exigences de `iface-can` groupées par rôle (controller / device / commun).
- Colonnes : `comp-motor`, `comp-bms`.
- Cellules `comp-motor` sur exigences [controller] : grisées.
- Cellules `comp-bms` sur toutes les exigences : colorées (covered/missing/validated).

**Critère d'acceptation** : CA-9.

---

### T69-N-13 — Notification needsRevalidation sur modification interface

**Prérequis** : Lien `implements-interface` entre `comp-motor` et CAN-002 (roles: [device]).

**Étapes** :
1. Modifier l'énoncé de CAN-002 dans `iface-can` puis la passer en `approved`.

**Résultat attendu** :
- Le lien `implements-interface` de `comp-motor` → CAN-002 est marqué `needsRevalidation: true`.
- `comp-bms` (roles: [controller, device]) reçoit également le signal sur CAN-002.
- Aucun composant n'ayant que le rôle `controller` ne reçoit le signal sur CAN-002.

**Critère d'acceptation** : CA-10.

---

## 2. Cas limites

### T69-L-01 — Répertoire sélectionné ne contient pas `.polenta/workspace.yaml`

**Étapes** :
1. Cliquer "Ouvrir un workspace", sélectionner un répertoire ordinaire.

**Résultat attendu** :
- Message d'erreur explicite : "Ce répertoire n'est pas un workspace Polenta. Créez-en un nouveau."
- L'app ne navigue pas et reste sur WorkspacePage.

**Critère d'acceptation** : CA-1.

---

### T69-L-02 — Dépendance circulaire (A → B → A)

**Configuration** :
```
comp-a/polenta-repo.yaml: deps: [comp-b]
comp-b/polenta-repo.yaml: deps: [comp-a]
```

**Étapes** :
1. Ouvrir un workspace avec `comp-a` comme root.

**Résultat attendu** :
- L'erreur identifie explicitement le cycle : "Cycle détecté : comp-a → comp-b → comp-a".
- L'app s'arrête de parser et affiche l'erreur.
- Le workspace partiel (repos déjà clonés avant le cycle) reste utilisable.

**Critère d'acceptation** : cas limites spec.

---

### T69-L-03 — `polenta-repo.yaml` mal formé (YAML invalide)

**Prérequis** : `comp-a/polenta-repo.yaml` contient du YAML syntaxiquement invalide.

**Étapes** :
1. Lancer le parsing récursif.

**Résultat attendu** :
- Une erreur de parsing est signalée pour `comp-a` uniquement.
- Les autres branches de l'arbre (comp-b, iface-can) continuent d'être traitées.
- Le workspace reste partiellement utilisable avec un avertissement visible.

**Critère d'acceptation** : cas limites spec.

---

### T69-L-04 — Pin introuvable sur le remote (SHA inconnu)

**Prérequis** : `polenta-repo.yaml` déclare `pin: deadbeef0000` qui n'existe pas sur le remote.

**Étapes** :
1. Lancer le parsing récursif.

**Résultat attendu** :
- Erreur de clone signalée pour ce repo spécifique.
- L'utilisateur peut ignorer la dépendance ou corriger le pin dans `polenta-repo.yaml`.
- Le reste du workspace continue de fonctionner.

**Critère d'acceptation** : cas limites spec.

---

### T69-L-05 — Workspace ouvert hors connexion réseau

**Prérequis** : Machine sans accès réseau. Tous les repos déjà clonés.

**Étapes** :
1. Ouvrir le workspace.

**Résultat attendu** :
- Les repos déjà clonés fonctionnent normalement.
- Si une dépendance manquante est détectée, elle est signalée "non disponible (hors ligne)" sans bloquer l'app.
- Aucune exception non catchée.

**Critère d'acceptation** : cas limites spec.

---

### T69-L-06 — Repo cloné mais corrompu (pas de HEAD valide)

**Prérequis** : `comp-a/` existe sur disque mais `.git/HEAD` est corrompu.

**Étapes** :
1. Lancer le parsing.

**Résultat attendu** :
- Avertissement non bloquant : "comp-a ignoré (repo corrompu)".
- Le reste du workspace est construit normalement.
- Le repo corrompu reste sur disque (pas de suppression automatique).

**Critère d'acceptation** : cas limites spec.

---

### T69-L-07 — Conflit de noms (même nom, URLs différentes)

**Configuration** :
```
comp-a/polenta-repo.yaml: deps: [{name: iface-common, url: ...org/iface-a.git, pin: sha1}]
comp-b/polenta-repo.yaml: deps: [{name: iface-common, url: ...org/iface-b.git, pin: sha2}]
```
Même nom `iface-common`, URLs différentes.

**Étapes** :
1. Lancer le parsing.

**Résultat attendu** :
- Conflit de nom (pas de version) détecté.
- Polenta demande à l'utilisateur de renommer l'un des deux via `mount-overrides` dans `workspace.yaml`.
- Message explicite indiquant les deux chemins et les deux URLs.

**Critère d'acceptation** : cas limites spec.

---

### T69-L-08 — Exigence interface sans champ `roles` : s'applique à tous

**Prérequis** : CAN-003 dans `iface-can` n'a pas de champ `roles` dans son frontmatter.

**Étapes** :
1. Vérifier la couverture de `comp-motor` (rôle: device).

**Résultat attendu** :
- CAN-003 est listée comme applicable à `comp-motor` (exigence commune).
- CAN-003 apparaît dans la matrice de conformité pour tous les composants.

**Critère d'acceptation** : CA-7.

---

### T69-L-09 — Composant avec `implements` mais interface absente du workspace

**Prérequis** : `comp-a` déclare `implements: [{interface: iface-missing, ...}]` mais `iface-missing` n'est pas dans le workspace.

**Étapes** :
1. Ouvrir la matrice de conformité.

**Résultat attendu** :
- Avertissement : "Interface iface-missing déclarée dans comp-a mais absente du workspace".
- La matrice n'est pas calculée pour cette interface.
- Le reste de la matrice (autres interfaces) est affiché normalement.

**Critère d'acceptation** : CA-7, robustesse.

---

### T69-L-10 — Migration : projet avec `nodes[].url` dans schema.yaml

**Prérequis** : `schema.yaml` contient un nœud avec `url: git@github.com:org/comp-motor.git` et `branch: main`.

**Étapes** :
1. Lancer `scripts/migrate-workspace.ts`.

**Résultat attendu** :
- `polenta-repo.yaml` est créé à la racine du repo avec les dépendances issues des nœuds url.
- `schema.yaml` est mis à jour : les champs `url` et `branch` sont supprimés des nœuds.
- `.gitmodules` est supprimé s'il existe.
- Les noms des nœuds (`name`) sont conservés comme noms de montage dans `polenta-repo.yaml`.

**Critère d'acceptation** : CA-5.

---

## 3. Critères d'acceptation vérifiables (récapitulatif)

| CA | Scénario(s) | Vérifié par |
|---|---|---|
| CA-1 Marqueur workspace | T69-N-01, T69-L-01 | Vérifier présence/absence `.polenta/workspace.yaml` |
| CA-2 Parsing récursif et cache | T69-N-02, T69-N-03, T69-N-04, T69-N-05 | Inspecter filesystem + `tree.cache.yaml` |
| CA-3 Détection diamond avant clone | T69-N-06 | Vérifier qu'aucun répertoire n'est créé avant la résolution |
| CA-4 Coexistence Option B | T69-N-07 | Vérifier deux répertoires distincts dans workspace |
| CA-5 Suppression url/branch | T69-N-08, T69-L-10 | Inspecter `SystemNode` TypeScript + UI schema |
| CA-6 Aucune régression mono-repo | T69-N-09 | Smoke test sur projet existant |
| CA-7 Déclaration rôles | T69-N-10, T69-L-08, T69-L-09 | Badge UI + filtrage exigences communes |
| CA-8 Couverture par rôle | T69-N-11 | Cellules grisées pour rôles non déclarés |
| CA-9 Matrice de conformité | T69-N-12 | Vue dédiée accessible depuis workspace |
| CA-10 needsRevalidation interfaces | T69-N-13 | Inspecter liens après modification exigence interface |

---

## 4. Tests automatiques recommandés

### `workspace-tree.service.test.ts`
- `buildTree` avec 3 repos + dépendance partagée → N=3 nœuds distincts.
- `buildTree` avec cycle → erreur avec message listing le cycle.
- `buildTree` avec diamond → `WorkspaceTreeResult` contient `conflicts`.
- `isCacheValid` : retourne `false` si HEAD SHA différent.
- `writeCache` / `readCache` : round-trip sans perte.

### `polenta-repo.service.test.ts`
- `readManifest` sur répertoire sans `polenta-repo.yaml` → `null`.
- `readManifest` sur YAML invalide → throw `ParseError`.
- `writeManifest` → round-trip.

### `schema.service.test.ts` (régression)
- `save()` ne déclenche plus `syncSubmodules` ni `writeGitmodules`.
- `resolveComponentRepoPath()` sur nœud sans `url` retourne `null`.

### `interface-compliance.service.test.ts` (Sprint 4)
- Composant `device` : exigence `[controller]` → NA, exigence `[device]` → applicable.
- Composant `[controller, device]` : toutes exigences applicables.
- Exigence sans `roles` → applicable à tous.
- Exigence `draft` → non exigée dans la vérification de couverture.
