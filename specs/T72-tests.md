# T72-tests — Vue système multi-repo

Fixture de référence pour les scénarios manuels : le workspace `C:\Dev\polenta-prj2` (repo
racine `polenta-prj2` + dépendances `HMI`, `BMS`, `iface-bus-uart`, `comp-controller`,
`comp-sensor`). `comp-controller` et `comp-sensor` sont pinnés sur la branche `main` (éditables) ;
`BMS` n'a pas de `.polenta/schema.yaml`.

---

## Scénarios nominaux (golden path)

### S1 — Le combobox Composant liste tous les repos du workspace

1. Ouvrir `polenta-prj2`, aller dans Vue Système (`/product`).
2. Ouvrir le combobox Composant.

**Attendu** : 6 entrées — `polenta-prj2`, `HMI`, `BMS`, `iface-bus-uart`, `comp-controller`,
`comp-sensor` — dans l'ordre du DFS de l'arbre workspace. Chaque entrée dépendance affiche son
mount name (+ le label de son nœud local si `.polenta/schema.yaml` en déclare un, ex.
`comp-controller — Contrôleur (maître bus UART)`).

### S2 — Sélectionner un repo dépendance recharge le bon contenu

1. Depuis S1, sélectionner `comp-controller`.

**Attendu** :
- Combobox Élément se réinitialise sur le premier type disponible (`Exigence firmware`).
- L'arbre affiche les exigences `CTRL-001`…`CTRL-004` (lues depuis
  `comp-controller/requirements/`, pas depuis le repo racine).
- Créer un nouvel élément via `+ Nouvel élément` écrit un fichier dans
  `comp-controller/requirements/`, pas dans `polenta-prj2/requirements/`.

### S3 — La section Liens affiche un lien cross-repo par son ID brut

1. Depuis S2, ouvrir `CTRL-001` en vue Édition.

**Attendu** : section Liens affiche "implémente" → `ITF-005` (ID brut, pas de titre résolu —
hors périmètre de ce ticket, cf. `T72.md` §Hors scope). Aucune erreur, aucun crash.

### S4 — Persistance de la sélection via l'URL

1. Depuis S2 (repo `comp-controller` sélectionné, type `exigence-fw`), copier l'URL courante.
2. Fermer et rouvrir l'app sur cette URL (ou naviguer ailleurs puis coller l'URL).

**Attendu** : `comp-controller` / `exigence-fw` sont resélectionnés automatiquement — l'URL
contient `repo=comp-controller&node=root&type=exigence-fw` (ou équivalent selon la route
`/product` ou `/components`).

### S5 — Mono-repo : comportement inchangé

1. Ouvrir un projet Polenta simple, jamais initialisé en workspace (`workspace.detect` →
   `'repo'`).

**Attendu** : combobox Composant affiche une seule entrée (le repo lui-même) — aucune régression
visuelle ni fonctionnelle par rapport à avant T72.

---

## Cas limites

### L1 — Lien vers un ancien projet (URL pré-T72, sans `repo`)

Ouvrir une URL `/product?projectId=…&node=root&type=SYS_REQ` générée avant ce ticket (pas de
`repo`).
**Attendu** : résolution sur le repo racine par défaut, comportement identique à avant T72,
aucune erreur de paramètre manquant.

### L2 — Repo sans `.polenta/schema.yaml`

Sélectionner `BMS` dans le combobox Composant.
**Attendu** : combobox Élément affiche `Aucun élément configuré` (schéma par défaut vide),
aucune erreur, aucun crash — état déjà documenté dans `SPEC-SYSTEM-VIEW.md` § État vide général,
maintenant atteignable pour un repo dépendance et pas seulement pour le repo racine.

### L3 — Tree cache absent ou périmé au premier chargement

Ouvrir un workspace dont `.polenta/tree.cache.yaml` vient d'être supprimé (ex. juste après un
`git pull` qui ajoute une dépendance).
**Attendu** : `useWorkspaceStructure` déclenche la lecture cache existante (pas de rebuild
automatique, cohérent avec le comportement T70) ; si le cache est absent, le combobox retombe
sur le fallback mono-repo (racine seule) plutôt que de planter — l'utilisateur doit passer par
l'onglet Structure pour déclencher un rebuild, comportement identique à T70, pas modifié ici.

### L4 — Repo dépendance pinné sur un tag (lecture seule)

1. Dans `polenta-repo.yaml` du repo racine, repointer `comp-sensor` sur un tag existant plutôt
   que `main` (ou créer un tag de test et pointer dessus), puis déclencher un rebuild de l'arbre
   (onglet Structure).
2. Sélectionner `comp-sensor` dans la vue Système.

**Attendu** : bandeau "figé sur une baseline" visible, bouton `+ Nouvel élément` désactivé,
édition inline désactivée dans l'arbre (`readOnly=true` propagé à `ElementTree`).

### L5 — Retour à une branche : l'édition redevient possible

1. Depuis L4, repointer `comp-sensor` sur `main` à nouveau, rebuild de l'arbre (onglet
   Structure).
2. Resélectionner `comp-sensor` dans la vue Système (ou revenir dessus si déjà sélectionné).

**Attendu** : le bandeau lecture seule disparaît, création/édition redeviennent possibles, sans
nécessiter de redémarrage complet de l'application (juste une invalidation react-query sur
`['sync:status', repoPath]`, déclenchée par le changement de sélection ou un refetch manuel).

### L6 — Changement de repo réinitialise proprement la sélection Élément

1. Sélectionner `comp-controller` / type `test-fw`.
2. Basculer vers `comp-sensor`.

**Attendu** : le combobox Élément retombe sur le premier type de `comp-sensor` (`exigence-fw`),
pas sur `test-fw` (qui pourrait ne pas exister avec ce nom exact dans l'autre repo, ou pointer
vers un type différent par coïncidence de nom).

---

## Critères d'acceptation (repris et détaillés de `T72.md`)

- [ ] S1 : 6 entrées listées pour le workspace `polenta-prj2`, ordre DFS stable.
- [ ] S2 : sélection d'un repo dépendance charge ses propres exigences, création y écrit belle
      et bien dans son propre dossier `requirements/`.
- [ ] S3 : lien cross-repo affiché en ID brut, pas d'erreur.
- [ ] S4 : URL avec `repo=` restaure la bonne sélection après rechargement.
- [ ] L1 : URL sans `repo` (pré-T72) retombe sur la racine sans erreur.
- [ ] S5 : mono-repo inchangé (une seule entrée dans le combobox).
- [ ] L4/L5 : lecture seule pilotée par l'état branche/détaché du repo sélectionné, dynamique
      (pas de redémarrage requis après un rebuild d'arbre).
- [ ] L2 : repo sans schéma → état vide propre, pas de crash.
