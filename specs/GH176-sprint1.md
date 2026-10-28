# GH176 — Sprint 1 (unique)

Spec : [GH176.md](GH176.md) · Design : [GH176-design.md](GH176-design.md) · Tests : [GH176-tests.md](GH176-tests.md)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/api-client/src/types.ts`, `index.ts` | `FieldVisibilityPref.picker?` / `showFoldersPicker?` ; type `FieldVisibilityPatch` ; `setFieldVisibility` prend un patch. |
| `apps/desktop/src/main/ipc/pref.handlers.ts` | `set` : écriture partielle (`null` = suppression, entrée vide retirée, payload non objet refusé). `get` : défaut d'équipe fusionné vue par vue sous le choix personnel. |
| `apps/desktop/src/main/services/pref-defaults.test.ts` | U1–U7. |
| `apps/desktop/src/renderer/components/system/FieldConfigModal.tsx` (nouveau) | Panneau ⚙️ extrait de `SystemView.tsx` ; props `tabs`, `lockedFields`, `onReset`, `layer` ; libellé « Réinitialiser » traduit ; `data-testid` pour les e2e. |
| `apps/desktop/src/renderer/components/system/SystemView.tsx` | Import du panneau ; écritures de préférences en patch (plus de `prefsRef`), fusion dans le cache partagé. |
| `apps/desktop/src/renderer/components/campaign/TestPickerModal.tsx` | Bouton ⚙️, état `columnsOpen` (fermé au changement de type / onglet / étape), raccourcis de la modale suspendus panneau ouvert. |
| `apps/desktop/src/renderer/components/campaign/TestPickerGrid.tsx` | Colonnes `picker ?? excel ?? défaut`, dossiers `showFoldersPicker ?? showFoldersExcel ?? true`, panneau, écriture optimiste + relecture, repli / colonnes figées initialisés une fois par (repo, utilisateur, type). |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `campaignPage.picker.statusAlwaysShown`, `system.fieldConfig.reset`. |
| `apps/desktop/e2e-web/gh176-picker-columns.spec.ts` (nouveau) | E1–E10, L4. |
| `specs/SPEC-TESTS.md`, `SPEC-SYSTEM-VIEW.md`, `SPEC-INDEX.md` | Voir § Mises à jour SPEC. |

## Comportement implémenté

Conforme à la spec : ⚙️ dans l'onglet Tests du sélecteur, panneau identique à l'onglet Tableau
de la Vue Excel (sans onglets, Statut verrouillé), préférence propre au sélecteur qui suit la Vue
Excel tant qu'absente, Réinitialiser = suppression des clés, `Échap` ferme le panneau seul.

## Divergences par rapport au design

1. **La Vue Système a changé** (le design disait « rien à changer ») : la revue de code a montré
   que son `onSuccess` remplaçait le cache `['pref-visibility', …]` (partagé avec le sélecteur) par
   sa copie en mémoire, sans `picker` — le sélecteur rouvert dans les 60 s affichait les colonnes
   de la Vue Excel, et un clic réécrivait `picker` à partir de celles-ci. Elle envoie désormais
   seulement la clé modifiée et fusionne le cache ; `prefsRef` (objet complet) est supprimé. Effet
   de bord voulu : une modification n'écrit plus les autres vues dans le `.pref`, donc ne fige plus
   le défaut d'équipe dans le choix personnel.
2. **Statut verrouillé géré par le panneau** : `lockedFields` affiche la case cochée quel que soit
   le contenu de la liste et `toggle` l'ignore. Le sélecteur passe donc directement la liste suivie
   (`picker ?? excel`), sans insérer puis retirer `status`.
3. **Relecture après écriture** dans le sélecteur (`invalidateQueries` au retour de l'IPC) en plus
   de la mise à jour optimiste : après un Réinitialiser, seul le main sait à quoi l'entrée retombe
   (défaut d'équipe ou rien).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TESTS.md` §4.1–4.2 (Sélecteur de tests) | Colonnes / titres de dossiers configurables par ⚙️, préférence propre, Statut jamais écrit dans `picker`. |
| `SPEC-SYSTEM-VIEW.md` §Configuration des champs | Paragraphe « Sélecteur de tests (GH176) » : réutilisation du panneau, un onglet, Statut verrouillé, Réinitialiser, portail / `Échap`. |
| `SPEC-SYSTEM-VIEW.md` §Persistance de l'état | Clés `picker` / `showFoldersPicker` (et clés existantes manquantes dans le tableau) ; écriture partielle ; défaut d'équipe fusionné vue par vue à la lecture. |
| `SPEC-INDEX.md` | Lignes SPEC-TESTS §4.1–4.2 et SPEC-SYSTEM-VIEW §Configuration des champs : description, mots-clés, MAJ → GH176. |

## Tests

- Unitaires : `pnpm test` — 824 tests verts (dont U1–U7).
- TypeScript : `tsc --noEmit` sans erreur.
- e2e : `gh176-picker-columns` 5 verts (E1–E9, L4), **E10 ignoré** — la démo n'a qu'un type de
  test contenant des tests (à vérifier à la main avec deux types) ; GH64 / GH68 / GH70 / GH126 :
  24 verts. Suite complète lancée une fois avant les corrections de revue : 151 verts, seul
  `gh136-status-label` GH136-1 en échec — il échoue aussi sur `main` (option « — » en trop dans la
  liste des statuts) : préexistant, hors périmètre.

## Tester manuellement

1. Ouvrir une campagne active → « + Ajouter des tests » → choisir un type de test.
2. ⚙️ à droite des options de filtre : cocher une colonne de liens ou une colonne calculée. La
   colonne apparaît, la sélection en cours est conservée.
3. `Échap` : le panneau se ferme, pas la modale. Fermer la modale, la rouvrir : la colonne est là.
4. Vue Système → Tests → Vue tableau du même type : colonnes inchangées. Y changer une colonne,
   revenir au sélecteur : ses colonnes sont intactes.
5. Sélecteur → ⚙️ → Réinitialiser : retour aux colonnes de la Vue Excel.
6. Décocher « Afficher les titres des dossiers » dans le sélecteur : liste plate dans le
   sélecteur, la Vue Excel garde ses dossiers.
7. Desktop (Electron) : refaire 2–3 (L8).
