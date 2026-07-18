# T59 — Scénarios de test : Vue diff dédiée

## Prérequis

- Un projet git ouvert dans Polenta avec au moins 3 commits et un tag (`v1.0.0` par exemple)
- Au moins 2 branches locales
- Au moins un fichier modifié entre deux commits

---

## Scénarios nominaux

### N1 — Ouverture depuis VersionPanel

**Étapes :**
1. Ouvrir un projet dans Polenta
2. Dans le panel latéral section "Version", cliquer sur l'icône GitCompare (troisième bouton après Tag et History)

**Attendu :**
- Navigation vers `/version-diff?projectId=<id>`
- Page affichée avec deux comboboxes vides (label "Objet A" et "Objet B")
- Zone principale : message "Sélectionnez un fichier dans le panel latéral"
- Liste de fichiers vide (aucune paire de refs sélectionnée)

---

### N2 — Sélection de deux branches et affichage de la liste de fichiers

**Étapes :**
1. Depuis la page `/version-diff`, ouvrir la combobox Objet A
2. Sélectionner la branche `main`
3. Ouvrir la combobox Objet B
4. Sélectionner une branche feature (ex: `feature/foo`)

**Attendu :**
- La liste de fichiers apparaît sous les comboboxes
- Chaque fichier affiche son marqueur coloré : M (amber), A (vert), D (rouge)
- La liste est mise à jour dans les secondes suivant la sélection (indicateur de chargement visible)

---

### N3 — Sélection d'un fichier et affichage du diff

**Étapes :**
1. Suite du scénario N2 (deux refs sélectionnées, liste de fichiers visible)
2. Cliquer sur un fichier marqué M (modifié) dans la liste

**Attendu :**
- Le fichier cliqué est surligné dans la liste
- La zone principale affiche la table de diff (lignes rouges = suppressions, vertes = ajouts, neutres = contexte)
- Le compteur "+X / -Y" est affiché
- Aucune erreur dans la console

---

### N4 — Changement d'un des objets remet à jour la liste et efface la sélection

**Étapes :**
1. Suite du scénario N3 (un fichier est sélectionné et affiché)
2. Changer la combobox Objet A (sélectionner un autre commit ou tag)

**Attendu :**
- La liste de fichiers est rechargée (indicateur de chargement visible)
- Le fichier précédemment sélectionné n'est plus surligné
- La zone principale revient au message placeholder "Sélectionnez un fichier…"

---

### N5 — Utilisation d'un tag dans une combobox

**Étapes :**
1. Ouvrir la combobox Objet A
2. Sélectionner un tag existant (ex: `v1.0.0`)
3. Ouvrir la combobox Objet B
4. Sélectionner `main`

**Attendu :**
- La combobox affiche `⊙ v1.0.0` pour le tag
- La liste de fichiers se charge correctement
- Le diff d'un fichier sélectionné s'affiche

---

### N6 — Utilisation d'un SHA court dans une combobox (via groupe "Commits")

**Étapes :**
1. Ouvrir la combobox Objet A
2. Dans le groupe "Commits récents", sélectionner un commit (affichage `# abc1234 message…`)
3. Sélectionner une branche pour Objet B

**Attendu :**
- La combobox affiche `# abc1234`
- Liste de fichiers et diff fonctionnent normalement

---

### N7 — Navigation depuis graph avec pré-remplissage (sprint 2)

**Étapes :**
1. Aller sur la page `/graph`
2. Cliquer sur un commit dans la liste
3. Cliquer sur le bouton "Comparer vs HEAD" de ce commit

**Attendu :**
- Navigation vers `/version-diff?projectId=...&sha1=<commit_sha>&sha2=<HEAD_sha>`
- Les deux comboboxes sont pré-remplies avec les valeurs correspondantes
- La liste de fichiers se charge automatiquement

---

### N8 — Filtrage dans la combobox

**Étapes :**
1. Ouvrir la combobox Objet A
2. Taper "main" dans le champ de filtre

**Attendu :**
- Seules les refs contenant "main" sont affichées
- La sélection fonctionne normalement sur le résultat filtré

---

## Cas limites

### L1 — Refs identiques (sha1 === sha2)

**Étapes :**
1. Sélectionner la même branche (`main`) pour Objet A et Objet B

**Attendu :**
- La liste de fichiers est vide
- Message visible : "Aucune différence" ou "Aucun fichier modifié"
- Pas d'erreur, pas de spinner infini

---

### L2 — Fichier absent dans un des deux objets (A : nouveau fichier, D : fichier supprimé)

**Étapes :**
1. Sélectionner deux refs entre lesquelles un fichier a été ajouté (marqueur A) ou supprimé (marqueur D)
2. Cliquer sur ce fichier dans la liste

**Attendu :**
- Pour un fichier ajouté (A) : `oldContent` = vide, `newContent` = contenu du fichier → toutes les lignes en vert
- Pour un fichier supprimé (D) : `oldContent` = contenu du fichier, `newContent` = vide → toutes les lignes en rouge
- Pas d'erreur ni de crash

---

### L3 — Repo sans remote

**Étapes :**
1. Ouvrir un projet git local sans remote configuré
2. Ouvrir `/version-diff`

**Attendu :**
- Les branches locales apparaissent dans les comboboxes
- La section "Branches remote" est absente ou vide dans les comboboxes (pas d'erreur)
- Le reste de la page fonctionne normalement

---

### L4 — Sélection d'un seul objet (l'autre est vide)

**Étapes :**
1. Sélectionner uniquement Objet A (pas Objet B)

**Attendu :**
- La liste de fichiers n'est pas chargée (pas d'appel IPC inutile)
- Zone principale : message placeholder
- Pas d'erreur TypeScript ni runtime

---

### L5 — Fichier binaire dans la liste

**Étapes :**
1. Sélectionner deux refs entre lesquelles un fichier PNG a été modifié
2. Cliquer sur ce fichier dans la liste

**Attendu :**
- Le diff s'affiche (même si le contenu est du binaire décodé en UTF-8, ce qui peut être illisible)
- Pas de crash (hors scope T59 : affichage spécifique pour les binaires)

---

### L6 — Paramètres URL invalides (ref inexistante)

**Étapes :**
1. Naviguer manuellement vers `/version-diff?projectId=...&ref1=inexistant`

**Attendu :**
- La page s'ouvre sans crash
- La combobox correspondante est vide (la ref invalide est ignorée silencieusement)
- Aucun spinner infini

---

### L7 — Repo sans commits

**Étapes :**
1. Ouvrir un projet git initialisé mais sans commit

**Attendu :**
- Les comboboxes sont vides
- Message adapté : "Aucune version disponible" ou comboboxes désactivées
- Pas d'erreur

---

### L8 — Liste de fichiers très longue (> 100 fichiers modifiés)

**Étapes :**
1. Sélectionner deux refs avec un grand nombre de fichiers différents

**Attendu :**
- La liste s'affiche avec scroll
- La page reste réactive
- La sélection d'un fichier fonctionne normalement

---

## Critères d'acceptation vérifiables manuellement

| # | Critère | Vérification |
|---|---------|-------------|
| CA1 | L'icône GitCompare est visible dans VersionPanel | Inspecter visuellement la section "Version" du panel |
| CA2 | Clic icône → page `/version-diff` ouverte | Vérifier l'URL dans DevTools |
| CA3 | Comboboxes listent toutes les refs (local, remote, tags, commits) | Ouvrir le dropdown et vérifier les groupes |
| CA4 | Sélection de deux refs → liste de fichiers avec marqueurs M/A/D colorés | Vérification visuelle |
| CA5 | Clic sur un fichier → diff affiché | Vérification visuelle (lignes colorées) |
| CA6 | Changer une ref → liste de fichiers rechargée et sélection effacée | Répéter N4 |
| CA7 | Refs identiques → liste vide sans erreur | Répéter L1 |
| CA8 | Fichier absent dans un objet → diff all-green ou all-red | Répéter L2 |
| CA9 | Repo sans remote → pas d'erreur au chargement | Répéter L3 |
| CA10 | Navigation avec sha1/sha2 en paramètres → comboboxes pré-remplies | Répéter N7 (sprint 2) |
| CA11 | Zéro erreur TypeScript (`tsc --noEmit`) | Lancer la vérification en CI ou en local |
| CA12 | Zéro erreur ESLint sur les fichiers modifiés | Lancer eslint sur le diff |
