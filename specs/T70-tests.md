# T70-tests — Scénarios de test : Arbre de structure (composants & interfaces)

---

## 1. Scénarios nominaux (golden path)

### T70-N-01 — Consulter l'arbre de structure d'un workspace existant

**Prérequis** : Workspace ouvert avec un repo root et deux dépendances (`comp-motor-control`, `iface-can-bus`), chacune avec au moins un type d'élément défini.

**Étapes** :
1. Ouvrir Projet → Modèle de données.
2. L'onglet Structure est actif par défaut.

**Résultat attendu** :
- L'arbre affiche le repo root déplié, avec ses éléments et ses deux dépendances.
- `iface-can-bus` porte le badge "Interface" (violet) ; `comp-motor-control` non.
- Chaque repo affiche ses propres types d'éléments comme feuilles.

**Critère d'acceptation** : CA-1.

---

### T70-N-02 — Ajouter un composant existant (repo déjà cloné ailleurs, réutilisé)

**Prérequis** : Workspace ouvert, `iface-can-bus` déjà présent (ajouté par un autre composant).

**Étapes** :
1. Sur le nœud racine, "+ Ajouter un composant".
2. Repo = URL d'un repo existant non encore dépendance directe du root, label = `comp-bms`, branche = `main`.
3. Valider.

**Résultat attendu** :
- Entrée ajoutée dans `polenta-repo.yaml` du root.
- Le repo est cloné dans le workspace, checkout sur `main`.
- `comp-bms` apparaît dans l'arbre, déplié, avec ses éléments existants (si le repo en a déjà) ou vide.

**Critère d'acceptation** : CA-2.

---

### T70-N-03 — Ajouter une interface avec déclaration `implements`

**Étapes** :
1. Sur `comp-motor-control`, "+ Ajouter une interface".
2. Repo = URL de `iface-can-bus`, nom = `iface-can-bus`, rôles = `device`, version = `2.1`.
3. Valider.

**Résultat attendu** :
- Le repo `iface-can-bus` est cloné (ou réutilisé s'il existe déjà avec la même URL/pin).
- Le `schema.yaml` de `comp-motor-control` contient une nouvelle entrée `implements: [{ interface: 'iface-can-bus', version: '2.1', roles: ['device'] }]`.
- `iface-can-bus` apparaît dans l'arbre sous `comp-motor-control` avec le badge "Interface".

**Critère d'acceptation** : CA-3.

---

### T70-N-04 — Ajouter un élément (type d'objet) et le configurer

**Étapes** :
1. Sur `comp-bms`, "+ Ajouter un élément" → Exigence.
2. La popup `ElementConfigModal` s'ouvre automatiquement.
3. Renseigner nom=`req-bms`, label=`Exigence BMS`, préfixe=`BMS`, ajouter un champ `priority` (enum).
4. Enregistrer.

**Résultat attendu** :
- `comp-bms/.polenta/schema.yaml` contient le nouveau `ObjectTypeDefinition`.
- L'élément apparaît comme feuille sous `comp-bms` dans l'arbre.
- Un clic ultérieur sur cette feuille rouvre la popup pré-remplie avec les mêmes valeurs.

**Critère d'acceptation** : CA-4.

---

### T70-N-05 — Éditer un élément d'un repo dépendance (cross-repo)

**Étapes** :
1. Cliquer sur un élément existant appartenant à `comp-motor-control` (pas le repo courant).
2. Modifier son label et ajouter un statut.
3. Enregistrer.

**Résultat attendu** :
- `comp-motor-control/.polenta/schema.yaml` (et non celui du repo courant) est mis à jour.
- Le repo courant n'est pas modifié.

**Critère d'acceptation** : CA-5.

---

## 2. Cas limites

### T70-E-01 — Conflit de nom de montage (URL différente, même nom)

**Étapes** :
1. "+ Ajouter un composant" avec label = `comp-bms` (déjà utilisé par un autre repo dans l'arbre) mais une URL différente.

**Résultat attendu** :
- Rejet avant toute écriture, message explicite invitant à choisir un autre nom.
- `polenta-repo.yaml` n'est pas modifié.

**Critère d'acceptation** : CA-2, cas limite "conflit de nom".

---

### T70-E-02 — Échec de clone (branche introuvable)

**Étapes** :
1. "+ Ajouter un composant" avec une branche qui n'existe pas sur le remote.

**Résultat attendu** :
- Erreur affichée inline ("branche introuvable" ou équivalent).
- `polenta-repo.yaml` n'est pas modifié (opération atomique — pas d'entrée orpheline).

**Critère d'acceptation** : CA-2 (échec de clone).

---

### T70-E-03 — Conflit diamond déclenché par un ajout

**Prérequis** : `comp-bms` dépend déjà de `iface-can-bus` au pin `abc123`.

**Étapes** :
1. Depuis `comp-motor-control`, ajouter `iface-can-bus` au pin `def456` (différent).

**Résultat attendu** :
- `DiamondConflictModal` s'affiche avant tout clone de la version en conflit.
- Après résolution (deux noms de montage distincts), les deux versions coexistent dans l'arbre.

**Critère d'acceptation** : CA-2, réutilisation du mécanisme T69 CA-3/CA-4.

---

### T70-E-04 — Préfixe dupliqué entre deux repos du workspace

**Étapes** :
1. `comp-bms` a déjà un élément de préfixe `MC`.
2. Sur `comp-motor-control`, créer un élément avec le même préfixe `MC`.
3. Enregistrer.

**Résultat attendu** :
- Erreur à l'enregistrement, aucun des deux repos n'est modifié.
- Modifier le préfixe pour une valeur unique permet l'enregistrement.

**Critère d'acceptation** : CA-4 (préfixe unique cross-repo).

---

### T70-E-05 — Ajout de composant/interface sur un projet mono-repo jamais initialisé en workspace

**Prérequis** : Projet ouvert directement comme repo simple, sans `.polenta/workspace.yaml`.

**Étapes** :
1. Onglet Structure : l'arbre affiche uniquement le repo courant, pas d'entrée "dépendances".
2. "+ Ajouter un composant".

**Résultat attendu** :
- Avant l'ajout, Polenta initialise le workspace (`workspace:init`) de manière transparente (ou avec confirmation explicite — à valider en Sprint 2 UX).
- Une fois initialisé, l'ajout se déroule comme T70-N-02.

**Critère d'acceptation** : cas limite "jamais initialisé".

---

### T70-E-06 — Suppression d'un élément utilisé par des instances existantes

**Étapes** :
1. Un type d'élément a des exigences déjà créées avec ce type.
2. Le supprimer depuis `ElementConfigModal`.

**Résultat attendu** :
- Confirmation explicite avant suppression.
- Les instances existantes ne sont pas supprimées (deviennent orphelines — comportement identique à l'existant).

**Critère d'acceptation** : cas limite (comportement inchangé, non régressé).

---

### T70-E-07 — Ancien projet avec `SystemNode` locaux multiples sans repo

**Prérequis** : Projet créé avant T70 avec deux `SystemNode` locaux dans son `schema.yaml`, aucun n'étant une vraie dépendance workspace.

**Étapes** :
1. Ouvrir l'onglet Structure.

**Résultat attendu** :
- Les deux nœuds sont affichés avec un badge "⚠ non associé à un repo".
- Leurs éléments restent visibles et éditables (lecture/écriture dans le `schema.yaml` du repo courant, comme avant).
- Aucune donnée n'est supprimée ou masquée silencieusement.

**Critère d'acceptation** : CA-7 (aucune régression / pas de perte de données).

---

## 3. Régression — onglets inchangés

### T70-R-01 — Onglet Liens

**Étapes** :
1. Ouvrir l'onglet Liens, créer/modifier un type de lien avec des `sourceRefs`/`targetRefs`.

**Résultat attendu** : Comportement strictement identique à avant T70 (aucun changement de code sur cet onglet).

**Critère d'acceptation** : CA-7.

### T70-R-02 — Onglet Interfaces

**Étapes** :
1. Ouvrir l'onglet Interfaces, déclarer un rôle et une implémentation manuellement (comme avant).

**Résultat attendu** : Comportement strictement identique. Note : ce tab reste la seule façon d'éditer `roles`/`implements` en dehors du flux "+ Ajouter une interface" de l'onglet Structure (les deux écrivent dans les mêmes champs, doivent rester cohérents).

**Critère d'acceptation** : CA-7.

### T70-R-03 — Route `/workspace` retirée

**Étapes** :
1. Naviguer vers `/workspace?dir=...` directement (ancien favori/lien).

**Résultat attendu** : Redirection vers l'onglet Structure du projet correspondant (ou message clair si le projet n'est plus résolvable).

**Critère d'acceptation** : CA-6.
