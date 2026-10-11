# GH56 — Scénarios de test

Spec : `specs/GH56.md` — Design : `specs/GH56-design.md`.

## Unitaires (`activityBarLayout.test.ts`, vitest)

| # | Cas | Attendu |
|---|---|---|
| U1 | `applyOrder(defaults, null)` | `defaults` inchangé |
| U2 | ordre enregistré partiel (nouveau panneau absent) | panneaux enregistrés dans leur ordre, absents ajoutés en fin |
| U3 | ordre enregistré avec id inconnu (`'foo'`) | id ignoré |
| U4 | `hiddenSet` avec `account`/`project` dans `hidden` | ils sont exclus du set |
| U5 | `hiddenSet` avec id inconnu | ignoré |
| U6 | `movePanel` before / after / sur soi-même | position correcte ; soi-même → inchangé |
| U7 | `toggleHidden` masque puis réaffiche ; sur `account` | aller-retour ; `account` → no-op |
| U8 | `loadLayout` : clé absente, JSON invalide, `{order: 3}`, forme valide | null, null, null, objet |
| U9 | `loadLayout` / `saveLayout` quand `localStorage` lève | null / pas d'exception |

## Bout en bout (`e2e-web/gh56-activity-bar.spec.ts`)

Chaque test commence par `localStorage.removeItem('polenta.activityBarLayout')`.

| # | Scénario (golden path) | Attendu |
|---|---|---|
| E1 | Glisser « Version » sur la moitié haute de « Suivi » | Version juste avant Suivi ; inchangé après `page.reload()` |
| E2 | Clic droit sur « Analyse d'impact » → « Masquer « Analyse d'impact » » | bouton absent ; toujours absent après reload |
| E3 | Clic droit dans la zone vide → cocher « Analyse d'impact » | bouton réapparaît à sa position dans l'ordre courant |
| E4 | Clic droit sur « Compte » | pas d'entrée « Masquer » ; entrées Compte et Projet `aria-disabled` |
| E5 | Après E1 + E2 → « Réinitialiser la disposition » | ordre par défaut, tous visibles, clé localStorage absente |
| E6 | Clic simple sur un bouton réordonné | navigation vers la vue du panneau (titre/route attendus) |
| E7 | Ouvrir un 2ᵉ projet après avoir réordonné | même ordre/visibilité (préférence commune aux projets) |

## Cas limites

| # | Cas | Attendu | Vérif |
|---|---|---|---|
| L1 | Aucun projet ouvert : glisser « Exigences » (grisé) | déplacé ; clic toujours sans effet | e2e |
| L2 | Masquer le panneau actif (ex. Exigences ouvert) | bouton disparaît, la vue Exigences reste affichée, URL inchangée | e2e |
| L3 | Dépôt hors de la barre / à la position d'origine | aucun changement, clé localStorage inchangée | e2e |
| L4 | Clic droit sur le badge de mise à jour | pas de menu | manuel (badge visible seulement si une MAJ est prête) |
| L5 | Échap / clic extérieur avec menu ouvert | menu fermé, aucun changement | e2e |
| L6 | Valeur corrompue en localStorage (`"{"`) puis reload | disposition par défaut, pas d'erreur | e2e |
| L7 | Menu ouvert près du bas d'une fenêtre courte | menu entièrement visible | manuel |
| L8 | Client desktop Electron | même comportement que web (E1–E5) | manuel |

## Critères d'acceptation (rappel spec)

CA1 ↔ E1 · CA2 ↔ E7 · CA3 ↔ E2/E3 · CA4 ↔ E4 · CA5 ↔ E5 · CA6 ↔ E6/L1 · CA7 ↔ L4 · CA8 ↔ L8.
