# T123 — Scénarios de test

## Sprint 1 — Fondation (modèle de données + résolution récursive)

### Nominal

1. **`add_component` sans `parentName`** (comportement T113 inchangé) : crée un `SystemNode` au
   niveau racine de `schema.nodes[]`. Vérifier `schema.yaml` résultant identique à avant ce ticket.
2. **`add_component` avec `parentName` valide** : crée le `SystemNode` dans `children[]` du parent
   désigné. Vérifier via lecture directe du `schema.yaml` (indentation `children:` sous le parent).
3. **Imbrication sur 3 niveaux** : repo → local A → local B (enfant de A) → local C (enfant de B),
   via 3 appels `add_component` successifs. Vérifier la structure YAML finale et que
   `resolveComponentRepoPath`/`findObjectTypeDef` retrouvent chacun des 3 nœuds par leur nom seul.
4. **Migration `roles`/`implements` racine → `root`** : ouvrir un projet dont le `schema.yaml`
   porte encore `roles:`/`implements:` au niveau racine du fichier (format pré-T123). Vérifier que
   `SchemaService.get()` renvoie ces valeurs sous `nodes[0].roles`/`nodes[0].implements` (node
   `root`), et qu'après un `save()` quelconque (ex. renommer `root`), le fichier réécrit sur disque
   n'a plus `roles`/`implements` au niveau racine — uniquement sous le node `root`.
5. **`nextId`/`nextTestId` sur composant imbriqué profondeur ≥ 2** : créer une exigence dont
   l'`objectTypeRef` cible un composant imbriqué à profondeur 2 ou plus ; vérifier que le préfixe
   généré est bien celui du type de ce composant précis (pas celui d'un nœud voisin ou d'un
   ancêtre) — non-régression directe du bug corrigé en T113 sprint1 point 5, maintenant testé en
   contexte imbriqué.

### Cas limites

6. **Nom déjà pris, y compris sous un autre parent** : tenter de créer un composant local nommé
   `"capteurs"` alors qu'un nœud `"capteurs"` existe déjà ailleurs dans l'arbre (parent différent,
   ou même à un niveau différent) → `NODE_NAME_TAKEN`, aucune écriture.
7. **`parentName` introuvable** : `add_component` avec un `parentName` qui ne correspond à aucun
   `SystemNode` de ce repo → erreur explicite (`NODE_NOT_FOUND`), pas de création silencieuse au
   niveau racine par erreur de repli.
8. **`parentName` désignant un nœud d'un autre repo** : impossible par construction — `addNode`
   n'opère que sur le `schema.yaml` d'un seul `repoPath` ; vérifier qu'aucun mécanisme ne permet de
   passer un `parentName` résolu dans un autre repo (test de non-régression architecturale, pas un
   cas d'usage atteignable depuis l'UI/MCP).
9. **`readonly` sur un composant local imbriqué** : un nœud `readonly: true` imbriqué refuse
   toujours `addObjectType`/`addField`/`addStatus` (comportement `requireNotReadonly` inchangé,
   juste atteint via un chemin récursif).
10. **Unicité de préfixe à travers les niveaux** : deux composants à des profondeurs différentes
    ne peuvent pas déclarer le même `prefix` sur un type d'objet → `PREFIX_TAKEN` avec le nom du
    nœud en conflit (`findNodeUsingPrefix` doit retrouver un nœud imbriqué, pas seulement les
    nœuds de premier niveau).

## Sprint 2 — UI Structure : imbrication

### Nominal

11. Depuis `StructureTab`, sur la ligne d'un composant local existant, cliquer "+ Composant
    local" → formulaire minimal (Nom) → le nouveau composant apparaît immédiatement, indenté sous
    son parent, sans rechargement de page.
12. Le nouveau composant imbriqué a lui-même les actions `+ élément`, `+ Composant local`, `✎`,
    `🗑` — identiques à un composant local non imbriqué.
13. Supprimer un composant local **sans** enfants ni éléments : suppression directe ou
    confirmation simple (comportement actuel, pas de changement).
14. Supprimer un composant local **avec** enfants et/ou éléments : confirmation explicite
    mentionnant le nombre de sous-composants et d'éléments qui seront supprimés ; confirmer →
    tout le sous-arbre disparaît de l'arbre Structure et du `schema.yaml`.

### Cas limites

15. **Annuler la suppression en cascade** : la popup de confirmation annulée ne modifie rien
    (schema.yaml et arbre inchangés).
16. **Composant local vide (aucun enfant, aucun objectType)** : "+ Composant local" et "+ élément"
    restent tous deux disponibles, aucun état d'erreur.
17. **Renommer/éditer label-description d'un composant imbriqué à profondeur ≥ 2** : la popup
    d'édition cible bien le nœud exact (par nom, pas par position — cf. design §6 sur le
    remplacement de `nodeIndex` par le nom), même si un autre nœud du même repo a une position
    similaire dans un sous-arbre différent.
18. **`allPrefixes` avec composants imbriqués** : la validation de préfixe unique côté UI
    (`useWorkspaceStructure`) détecte un conflit de préfixe même quand l'un des deux types est
    porté par un composant imbriqué à profondeur ≥ 2.

## Sprint 3 — Interfaces sur SystemNode

### Nominal

19. Éditer un composant local (imbriqué ou non) → section "Rôles exposés par ce composant" →
    ajouter un rôle → sauvegarder → badge "Interface" apparaît sur ce composant dans l'arbre
    Structure.
20. Le même composant local → section "Interfaces implémentées" → déclarer `{interface, roles}`
    → sauvegarder → `implements` persisté sur ce `SystemNode` (pas au niveau racine du fichier).
21. Une exigence créée sur un composant local qui expose des `roles` source ses options `roles`
    (champ `multi_enum`) depuis le catalogue de ce composant précis.
22. Le combobox "Composant" (Vue Système) affiche `Parent › Enfant` pour un composant local
    imbriqué, sous le bon `groupLabel` de repo ; le sélectionner recharge schéma/arbre/index sur
    ce nœud exact.
23. Un repo interface existant (format pré-T123, `roles` au niveau fichier) continue d'afficher
    le badge "Interface" sur sa ligne de repo après migration (§Sprint 1 point 4) — non-régression
    visuelle.

### Cas limites

24. **Composant local avec `roles` vide `[]`** (pas `undefined`) : pas de badge "Interface" —
    cohérent avec le comportement actuel (`Array.isArray(s?.roles) && s.roles.length > 0`).
25. **Composant local imbriqué qui expose des rôles ET implémente une interface simultanément** :
    les deux sections coexistent sans conflit (même garantie que pour un composant repo séparé
    aujourd'hui, `SPEC-TEMPLATES.md` §3b).
26. **Repo mono-node (seulement `root`) sans aucun composant local** : combobox Composant
    inchangé visuellement (pas de chemin `›`, pas de `groupLabel`) — aucune régression pour le cas
    le plus courant.

## Sprint 4 (final) — Matrice de conformité + non-régression

### Nominal

27. Un composant local (imbriqué ou non) qui implémente une interface apparaît dans la matrice de
    conformité (colonne composant), avec le même calcul de couverture par rôle qu'un composant en
    repo séparé (cellules `validated`/`covered`/`missing`/`na`).
28. Un composant local qui **expose** des `roles` (devient lui-même "l'interface") apparaît comme
    ligne d'interface dans la matrice, avec les exigences de ce composant précis comme lignes de
    la matrice (pas celles d'un autre composant du même repo).
29. Modifier une exigence d'interface portée par un composant local déclenche
    `needsRevalidation` sur les liens `implements-interface` des composants qui l'implémentent —
    y compris si l'implémenteur est lui-même un composant local imbriqué.
30. Créer une exigence, un test, une campagne sur un composant local imbriqué à profondeur ≥ 2 —
    de bout en bout : formulaire UI → fichier écrit dans `requirements/`/`tests/` du repo →
    visible dans les listes, dashboards, requêtes SQL (`objectTypeRef` correct, `component` du
    dataset correctement résolu au nom du composant précis, pas de son ancêtre).
31. Un lien (`ObjectLink`) entre deux éléments portés par deux composants locaux différents
    (imbriqués ou non, y compris à des profondeurs différentes) se crée et se résout normalement
    — vérification de non-régression du mécanisme `sourceRefs`/`targetRefs`.

### Cas limites

32. **Repo avec plusieurs composants locaux implémentant chacun des rôles différents de la même
    interface** : la matrice distingue bien chaque composant en colonne séparée (pas de fusion par
    repo).
33. **Deux composants locaux du même repo, l'un imbriqué sous l'autre, tous deux avec des
    `implements` vers la même interface** : chacun compte séparément dans la couverture (pas de
    double-comptage ni d'écrasement).
34. **Volume** : repo avec un nombre significatif d'exigences (ordre de grandeur : plusieurs
    dizaines) réparties sur plusieurs composants locaux imbriqués — le filtrage par
    `objectTypeRef` dans `interface-compliance.service.ts` (cf. design §8, point ouvert) ne
    dégrade pas perceptiblement le temps de calcul de la matrice par rapport à l'existant.

## Critères d'acceptation transverses (fin de ticket)

- [ ] Tous les critères d'acceptation de `specs/T123.md` sont couverts par au moins un scénario
  ci-dessus.
- [ ] TypeScript/lint : zéro nouvelle erreur, à chaque sprint (pas seulement au dernier).
- [ ] Aucune régression sur un projet existant sans composant local (mono-`root`) ni sur un projet
  avec composants locaux non imbriqués créés avant ce ticket (T113) — testé manuellement sur un
  projet de démo existant (ex. `aspirateur-demo`) en plus des scénarios ci-dessus.
