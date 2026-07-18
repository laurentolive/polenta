# T52 — Scénarios de test : restaurer la sélection composant/élément de la vue Système

## Prérequis

- Un projet Polenta ouvert avec au moins 2 repos dans le workspace (racine + une dépendance), ou
  à défaut un projet mono-repo avec au moins 2 composants (`SystemNode`) ayant chacun plusieurs
  types d'éléments.
- Accès DevTools (Application → Local Storage) pour inspecter la clé
  `polenta:lastSelection:<projectId>`.

---

## Scénarios nominaux

### N1 — Retour sur la vue Système depuis un autre panneau

**Étapes :**
1. Ouvrir la vue Système, sélectionner un composant B (≠ composant racine) via le combobox
   Composant, puis un élément Y (≠ premier élément) via le combobox Élément.
2. Cliquer sur l'icône "Version" dans la barre d'activité.
3. Cliquer sur l'icône "Système" dans la barre d'activité.

**Attendu :**
- Le combobox Composant affiche B, le combobox Élément affiche Y.
- L'arbre et la vue document affichent le contenu de B/Y, pas ceux du composant racine.

---

### N2 — Sélection persistée après redémarrage de l'application

**Étapes :**
1. Suite du scénario N1 (B/Y sélectionnés, toujours sur la vue Système).
2. Fermer complètement l'application Polenta.
3. Rouvrir l'application sur le même projet.

**Attendu :**
- La vue Système s'ouvre directement sur B/Y (pas le composant racine / premier élément).

---

### N3 — Changement de composant seul persiste le nouveau composant + son premier élément

**Étapes :**
1. Sélectionner un composant C dans le combobox Composant (le combobox Élément retombe sur le
   premier type de C, comportement existant).
2. Naviguer vers un autre panneau puis revenir sur Système.

**Attendu :**
- Composant C et son premier élément sont réaffichés.

---

### N4 — Changement d'élément seul (même composant) persiste le nouveau type

**Étapes :**
1. Rester sur le composant courant, changer uniquement le combobox Élément vers un type Z.
2. Naviguer vers un autre panneau puis revenir sur Système.

**Attendu :**
- Le composant courant est réaffiché avec l'élément Z.

---

### N5 — Lien direct explicite prévaut sur la sélection persistée

**Étapes :**
1. Suite du scénario N1 (dernière sélection persistée = B/Y).
2. Naviguer manuellement vers une URL `/product?projectId=...&repo=<root>&node=<autreNode>&type=<autreType>`
   avec des valeurs différentes de B/Y.

**Attendu :**
- La page affiche le composant/élément indiqués explicitement dans l'URL, pas B/Y.
- (Optionnel) Revenir ensuite sur Système via un lien "bare" doit réafficher B/Y à nouveau si
  aucun changement manuel n'a eu lieu entre-temps sur ce lien explicite — sinon la dernière
  sélection valide (celle du lien explicite) est celle persistée, comportement attendu par design.

---

## Cas limites

### L1 — Composant sauvegardé supprimé du schéma

**Étapes :**
1. Sélectionner un composant B, élément Y ; laisser la persistance s'enregistrer.
2. Modifier `schema.yaml` pour supprimer le `SystemNode` B (ou renommer son `name`).
3. Recharger l'application / revenir sur la vue Système avec une URL bare.

**Attendu :**
- Aucune erreur ni écran blanc.
- Retour silencieux au comportement par défaut (composant racine, premier élément).

---

### L2 — Élément (type) sauvegardé supprimé du schéma, composant toujours présent

**Étapes :**
1. Sélectionner composant B, élément Y.
2. Supprimer uniquement le type Y du `SystemNode` B dans `schema.yaml` (B existe toujours).
3. Revenir sur la vue Système avec une URL bare.

**Attendu :**
- Pas d'erreur.
- Retour au comportement par défaut (composant racine, premier élément) — la validation croisée
  composant+type échoue dès que l'un des deux ne correspond plus.

---

### L3 — Première visite d'un projet (aucune clé `localStorage`)

**Étapes :**
1. Ouvrir un projet jamais visité auparavant (ou vider `localStorage` pour ce `projectId`).
2. Aller sur la vue Système.

**Attendu :**
- Comportement inchangé : composant racine + premier élément sélectionnés.
- Aucune erreur liée à l'absence de clé `localStorage`.

---

### L4 — Isolation entre deux projets différents

**Étapes :**
1. Dans le projet P1, sélectionner composant B / élément Y ; laisser persister.
2. Fermer P1, ouvrir un projet P2 différent.
3. Aller sur la vue Système de P2.

**Attendu :**
- P2 affiche son propre défaut ou sa propre dernière sélection, jamais B/Y de P1.
- Revenir ensuite sur P1 réaffiche B/Y (clé `localStorage` bien indexée par `projectId`, aucune
  écrasée par l'autre).

---

### L5 — `localStorage` corrompu ou indisponible

**Étapes :**
1. Dans DevTools, écrire manuellement une valeur JSON invalide sous
   `polenta:lastSelection:<projectId>` (ex. `"{not json"`).
2. Revenir sur la vue Système avec une URL bare.

**Attendu :**
- Pas de crash JS (le `try/catch` de `readLastSelection` absorbe l'erreur de parsing).
- Retour au comportement par défaut (composant racine, premier élément).

---

### L6 — Repo de la sélection sauvegardée retiré du workspace

**Étapes :**
1. Sélectionner un composant appartenant à un repo dépendance D (pas le repo racine).
2. Retirer D du workspace (ou le repo devient inaccessible).
3. Revenir sur la vue Système.

**Attendu :**
- Pas d'erreur : `repoOptions.find(r => r.name === saved.repo)` échoue proprement →
  `savedRepoPath` est `undefined` → fallback au comportement par défaut.

---

### L7 — Combobox `/components` (Structure) non affecté

**Étapes :**
1. Utiliser l'onglet Structure (`/components`) normalement (sélection composant/élément).
2. Vérifier qu'aucune clé `polenta:lastSelection:*` supplémentaire ou comportement de
   restauration inattendu n'apparaît sur cette route (hors scope T52).

**Attendu :**
- Comportement de `/components` inchangé par rapport à avant T52.

---

## Critères d'acceptation vérifiables manuellement

| # | Critère | Vérification |
|---|---------|-------------|
| CA1 | Retour sur Système depuis un autre panneau réaffiche le dernier composant/élément | Répéter N1 |
| CA2 | Redémarrage de l'app réaffiche le dernier composant/élément | Répéter N2 |
| CA3 | Changement de composant seul persiste correctement | Répéter N3 |
| CA4 | Changement d'élément seul persiste correctement | Répéter N4 |
| CA5 | Un lien direct avec params explicites reste prioritaire sur la sélection persistée | Répéter N5 |
| CA6 | Composant supprimé du schéma → fallback silencieux | Répéter L1 |
| CA7 | Type supprimé du schéma → fallback silencieux | Répéter L2 |
| CA8 | Première visite d'un projet → comportement par défaut inchangé | Répéter L3 |
| CA9 | Deux projets gardent chacun leur propre dernière sélection | Répéter L4 |
| CA10 | `localStorage` corrompu ne casse pas la vue Système | Répéter L5 |
| CA11 | Repo retiré du workspace → fallback silencieux | Répéter L6 |
| CA12 | `/components` (Structure) non affecté | Répéter L7 |
| CA13 | Zéro nouvelle erreur TypeScript (`tsc --noEmit`) | Lancer la vérification en CI ou en local |
| CA14 | `/code-review` passé sur le diff | Lancer `/code-review` sur la branche T52 |
