# T164-tests — Clic simple sur un élément de l'arbre → *goto* dans la vue de droite

Tests **manuels** (pas de runner automatisé dans `apps/desktop`). Seul garde-fou automatique :
`pnpm -C apps/desktop typecheck`.

Fixture : n'importe quel projet avec ≥ 20 éléments sous un même type et au moins un dossier
non vide (p. ex. `apps/desktop/PL/Product`, ~281 items). Vue Système, onglet Exigences ou Tests.

---

## Scénarios nominaux (golden path)

### S1 — Clic simple, vue Excel
1. Sélectionner un type avec beaucoup d'éléments ; vue **Excel** ; filtre inactif.
2. Faire défiler la vue Excel tout en haut.
3. Dans l'arbre, clic simple sur un élément situé loin dans la liste.

**Attendu** : la vue Excel défile (fluide) jusqu'à amener la ligne dans le viewport ; la ligne
porte un **contour** visuellement distinct de la surbrillance de sélection de ligne ; l'arbre
sélectionne l'élément normalement ; le `viewMode` reste `excel`.

### S2 — Clic simple, vue Word
1. Idem S1 en vue **Word**.
2. Clic simple sur un élément bas de document.

**Attendu** : le document défile jusqu'à la **carte** de l'élément, qui reçoit le contour.
Pas de bascule en Édition.

### S3 — Déplacement du contour
1. Depuis S1, clic simple sur un autre élément.

**Attendu** : le contour se déplace sur le nouvel élément ; l'ancien n'a plus de contour
(un seul marqué à la fois) ; la vue re-défile vers le nouveau.

### S4 — Clic sur un dossier
1. Vue Word (puis répéter en Excel). Clic simple dans l'arbre sur un **dossier**.

**Attendu** : la vue défile jusqu'à l'en-tête de section (Word) / la ligne de groupe (Excel)
du dossier, qui porte le contour. Fonctionne aussi sur un **dossier vide** et sur un dossier
**replié** dans la vue de droite.

### S5 — Drag & drop → *goto* sur l'élément déplacé
1. Vue Excel ou Word. Dans l'arbre, glisser un élément à une autre position (même niveau) et
   déposer.

**Attendu** : après le dépôt, la vue de droite se recale (scroll) sur l'élément déplacé, qui
porte le contour. L'arbre reflète le nouvel ordre.

### S6 — Double-clic inchangé
1. Double-clic sur un élément de l'arbre.

**Attendu** : ouverture de la **Vue Édition** sur cet élément (comportement actuel).
Éventuel scroll/contour furtif juste avant la bascule = acceptable.

---

## Cas limites

### E1 — Multi-sélection : pas de *goto*
1. Vue Excel. Clic sur un élément (S1 → contour posé).
2. **Shift+clic** sur un élément plus bas, puis **Ctrl+clic** sur un troisième.

**Attendu** : aucun scroll déclenché par les clics 2 et 3 ; aucun nouveau contour posé
(le contour de l'étape 1 peut rester tel quel — il n'est pas synchronisé avec `selectedIds`).

### E2 — Ctrl+clic qui réduit à une seule sélection
1. Sélection multiple de 2 éléments (Ctrl+clic). Ctrl+clic sur l'un des deux pour le retirer.

**Attendu** : pas de *goto* (règle : *goto* uniquement au clic **sans modificateur**).

### E3 — Clic simple en Vue Édition
1. Double-clic sur un élément → Vue Édition.
2. Dans l'arbre, clic simple sur un **autre** élément.

**Attendu** : **rien de visible** ne change dans la zone de droite (pas de rechargement de
l'éditeur, pas de scroll). L'arbre met à jour sa sélection. Seul un **double-clic** (ou l'icône
Éditer) change l'élément édité.

### E4 — Retour d'Édition vers Word/Excel
1. Depuis E3, revenir en arrière (Échap / Annuler) → Vue Word ou Excel.

**Attendu** : aucun contour résiduel, aucun scroll automatique ; l'état *goto* est reparti de
zéro.

### E5 — Clic dans le vide de l'arbre
1. Vue Word/Excel, un élément porte le contour (S1).
2. Clic dans la zone vide sous l'arbre.

**Attendu** : désélection de l'arbre **et** disparition du contour dans la vue de droite.

### E6 — Changement de composant/type
1. Un élément porte le contour.
2. Changer d'entrée dans le combobox Composant / Élément.

**Attendu** : le nouvel arbre / la nouvelle vue s'affichent sans contour résiduel ; aucun
scroll automatique.

### E7 — Élément masqué par un filtre
1. Activer un filtre qui ne laisse que quelques éléments.
2. Clic simple sur un élément **visible** dans l'arbre filtré.

**Attendu** : *goto* normal sur cet élément (il est aussi dans la vue document, même filtre
global). Aucun élément non visible n'est cliquable → pas de cas « cible absente » atteignable
par l'utilisateur ; si cela se produit malgré tout (course de rendu) → no-op silencieux, pas
d'erreur console bloquante.

### E8 — Re-clic sur l'élément déjà marqué
1. Élément A porte le contour. Re-clic simple sur A.

**Attendu** : la vue re-défile vers A (grâce à `gotoSeq`) ; le contour reste sur A.

### E9 — Vue Campagnes / Vue Recherche (hors scope — non-régression)
1. Onglet **Campagnes** : clic simple sur une campagne dans `CampaignNavList`.
2. Panneau **Recherche** : clic simple sur un résultat.

**Attendu** : comportement **actuel** inchangé (ouverture de la campagne / de la page détail).
Aucun effet de bord introduit par T164.

### E10 — Non-régression interactions arbre
1. Menu contextuel (clic droit), F2 renommage, Suppr, Ctrl+C/V, undo/redo, expand/collapse
   dossier au double-clic, navigation ↑/↓/Entrée, clic sur un lien interne (`navigateToObject`).

**Attendu** : tout fonctionne comme avant ; `navigateToObject` ouvre toujours la fiche en
Édition sans contour parasite.

---

## Critères d'acceptation vérifiables

- [ ] S1–S6 conformes.
- [ ] E1, E2 : aucun scroll ni contour posé en présence d'un modificateur clavier.
- [ ] E3, E4 : *goto* strictement inopérant en Vue Édition, pas d'état résiduel au retour.
- [ ] E5, E6 : le contour disparaît à la désélection totale et au changement de contexte.
- [ ] E8 : re-clic re-scrolle.
- [ ] E9, E10 : zéro régression.
- [ ] `pnpm -C apps/desktop typecheck` : aucune erreur nouvelle.
- [ ] Le style du contour est distinct de la surbrillance de sélection dans les deux vues,
      y compris sur une ligne Excel simultanément sélectionnée.
