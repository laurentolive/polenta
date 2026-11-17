# GH389 — Sprint 5 : campagnes (entrées, report, liste)

Spec : `specs/GH389.md` (§1, §4 lignes « Entrées d'une campagne », « Report depuis une campagne »,
« Liste des campagnes » ; critères C11, C12). Design : `specs/GH389-design.md` §8, §10 ligne 5 ;
écarts au §16. Base : `1733548` (sprint 4). Abréviation : `r/` = `apps/desktop/src/renderer`.

## Fichiers

### Modifiés
- `r/routes/campaign.$campaignId.tsx` : la liste des entrées et ses formulaires passent dans
  `CampaignEntriesGrid` (remontée par campagne) ; pastilles de statut déplacées dans la barre
  d'outils de la grille ; page pleine largeur (bloc des champs borné comme avant).
- `r/components/campaign/CampaignCarryPanel.tsx` : table des entrées → `DataGrid` à cases (modale) ;
  statuts et filtre texte dans la barre d'outils ; test, exigence, campagne source et « aussi dans »
  en liens d'élément ; prop `repoPath`.
- `r/components/campaign/TestPickerModal.tsx` : passe `repoPath` au panneau de report.
- `r/components/system/CampaignListView.tsx` : cartes → `DataGrid` ; textes en dur traduits.
- `r/components/grid/DataGrid.tsx` : dépli contrôlé (`expanded`, `onToggleExpanded`).
- `r/lib/runStatus.ts` : `CAMPAIGN_STATUS_CLASS` (couleurs locales de `CampaignListView` supprimées).
- `r/i18n/locales/{fr,en}.json` : `campaignPage.columns.*`, `campaignPage.entriesTitle`,
  `campaignPage.carry.gridTitle`, `system.campaignListView.*`.
- `apps/desktop/e2e-web/gh64-carry-over.spec.ts` : lignes `data-node-id`, entrée indisponible sans case.
- `specs/GH389-design.md` : §16.

### Nouveaux
- `r/components/campaign/CampaignEntriesGrid.tsx`.
- `apps/desktop/e2e-web/gh389-campaigns.spec.ts` (E11 entrées / report / liste, E12 entrées et liste).

## Comportement

**Page d'une campagne** — grille des entrées : Test, Titre, Exigence, Reportée depuis, Paramètres,
Statut, Actions. Barre d'outils : pastilles de statut (filtre de l'écran, URL `status`), 👁, ↕▯,
Exporter, « affichées / total ». Filtre par colonne, largeurs, gel, ordre, clavier. ✎ / ⧉ (ou
chevron, ←/→) déplient la ligne sur la saisie des paramètres / le duplicata. Double-clic, Entrée ou
« Voir » ouvrent l'entrée ; « Exécuter », « Retirer » inchangés. Exports de plan / rapport inchangés
dans l'en-tête.

**Sélecteur de tests, onglet « Depuis une campagne »** — grille à cases : clic sur la ligne, case,
Espace, Maj ; entrées indisponibles estompées, sans case ; Échap d'une cellule active ne ferme pas
la modale.

**Liste des campagnes** (barre d'activité « Campagnes ») — grille ID (lien), statut traduit, titre,
tests (liens), entrées par statut ; « + Nouvelle campagne » en tête ; filtre global de la vue
système combiné ; double-clic / Entrée ouvre la campagne.

## Divergences au design

Détail : `specs/GH389-design.md` §16. En bref : colonne « Reportée depuis » ; ouverture d'une entrée
par double-clic / Entrée / Voir (plus par simple clic sur une campagne clôturée) ; dépli contrôlé ;
grille remontée par campagne ; entrée de report indisponible sans case ; E12 par onglet et
Précédent pour les entrées, par barre d'activité et Précédent pour la liste.

## Tester à la main

1. Campagne en cours avec des tests paramétrés : ✎ ouvre la saisie sous la ligne, Enregistrer ;
   ⧉ ouvre le duplicata ; chevron et ←/→ font de même.
2. Pastille « Échoué » + filtre de colonne sur Test : seules les lignes des deux filtres.
3. Campagne clôturée : double-clic sur une ligne → résultat ; « Voir » sur chaque ligne.
4. Sélecteur → Depuis une campagne : cocher / décocher par ligne, Espace ; Échap.
5. Liste des campagnes : survol d'un ID / d'un test (popup), 👁 (masquer Tests), exporter.

## Vérifications

**Niveau 1**
- `tsc --noEmit -p tsconfig.json` (desktop) : 0 erreur.
- `pnpm lint` : n'exécute rien (#395).

**Revue** : le skill `code-review` (medium), lancé depuis la session, a revu le diff de `main` du
dossier principal (GH387) et non celui du sprint ; relecture manuelle du diff à la place (gestes des
cellules lus par ref, double-clic des boutons d'action arrêté, sélection du report traduite en clés,
expansion contrôlée). Correction issue des e2e : grille remontée par campagne (Précédent d'une
campagne à l'autre ne reprenait pas la position).

**Niveau 2**
- `pnpm test` (racine) : desktop 197 fichiers / 2 062 tests OK ; admin-service 124 OK + 3 ignorés ;
  merge-core 83 OK.
- e2e-web (`pnpm build:web`), mise au point de `gh389-campaigns` : 7/7 OK après corrections du test
  (clic de ligne d'une grille à cases, accès à la liste par `/product?category=campaign`) et du
  code (remontée par campagne).
- e2e-web voisins, un passage : `gh389-` (campaigns, excel-export, excel-keyboard, executions,
  versions), `gh246-render-loop`, `gh64`, `gh65-*`, `gh68`, `gh71`, `gh73`, `gh77`, `gh80`, `gh81-*`,
  `gh93`, `gh227`, `gh196`, `gh229-element-refs`, `gh256`, `gh176`, `gh144`, `gh203`, `gh129`, `gh278`
  → 95 tests : **92 OK**, 1 ignoré (prérequis de démo), 1 non lancé (suite en série), 1 échec
  `gh227` (« ERR_NETWORK_CHANGED » en console, changement réseau du poste) ; relancé seul : 2/2 OK.
  (Un premier passage avait été tué en cours par une interruption de session : workers sortis en
  0xC0000142, sans rapport.)

**Non lancé** : suite e2e complète (niveau 3) ; e2e-desktop (`gh202-tested-version` lit les boutons
« Exécuter » / « Voir », conservés) ; contrôles manuels (thème sombre, classeur exporté).

## Restes fragiles

- Une `DataGrid` restée montée d'une entité à l'autre sur la même route (Précédent) ne reprenait pas
  sa position : contourné par `key` (comme la Validation). La page d'une version (sprint 4) n'est pas
  remontée par version — chemin Précédent version → version non couvert par un e2e.
- Ouverture d'une entrée : plus de simple clic sur une ligne de campagne clôturée (contrat §1.9).
