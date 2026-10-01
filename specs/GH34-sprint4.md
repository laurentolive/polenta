# GH34 — Sprint 4 : gabarits Excel (dernier sprint)

Spec : `specs/GH34.md` §2.8 · Design : `specs/GH34-design.md` §4–5 · Tests : `specs/GH34-tests.md` (S4.x)

## Spike moteur (décision)

Gabarit « client » réaliste construit **par Excel** (`scripts/fixtures/make-gh34-client-xlsx.ps1` →
`gh34-client.xlsx` : logo, titre fusionné, ligne modèle stylée avec formule `=D6*2`, mise en forme
conditionnelle, validation, totaux `SOMME`/`NB.SI`, 2e feuille référençant le tableau, graphique,
zone d'impression), rempli par xlsx-template seul : lignes, styles, fusions, images et graphique
déplacés correctement, **mais** formules, MFC, validations, séries de graphique restées sur la seule
ligne modèle, formule de ligne non recopiée.

**Retenu** : xlsx-template (MIT, maintenu — conserve tout le classeur) + réécriture des références
par Polenta (`xlsx-refs.ts`). exceljs écarté (perd graphiques / tableaux croisés à la réécriture).

## Comportement implémenté

- Gabarits **Excel** sélectionnables pour `requirements`, `tests`, `campaign-plan`, `query-result`,
  `impact-analysis` : liste « Gabarit Excel » dans le popover (à côté de « Gabarit Word » quand les
  deux existent), défaut par projet (`preferences.exportTemplates.<kind>:xlsx`).
- Balises `${…}` : valeurs (`${project.label}`, `${git.commit}`…), **ligne modèle**
  `${table:<liste>.<champ>}` répétée avec sa mise en forme et ses autres cellules, `${columnNames}` /
  `${table:rows.cells}` pour les colonnes inconnues d'un résultat de requête.
- Données : une ligne par exigence/test (dossier `folder`/`folderPath`, `statusLabel`, `stepsText`,
  champs `number` en vrais nombres), par entrée de campagne, par ligne de requête, par nœud
  d'analyse d'impact (aplati, avec profondeur) ; richtext en texte simple.
- **Références étendues/décalées** dans tout le classeur : formules (toutes feuilles, formules
  partagées), MFC (y compris `x14`), validations, filtre automatique, séries de graphiques, noms
  définis et zone d'impression ; dans les lignes générées, sémantique de recopie d'Excel ;
  recalcul complet à l'ouverture.
- **Sécurité** : une valeur commençant par `=` (ex. titre `=HYPERLINK(…)`) est écrite comme texte
  (préfixe U+200B), jamais comme formule.
- **5 gabarits Excel d'exemple** (Liste des exigences, Liste des tests, Plan de campagne, Résultat
  de requête, Analyse des impacts) : cartouche, en-tête stylé, filtre, volets figés, impression
  paysage, totaux en formules ; installés avec les exemples Word. Référence des balises complétée
  (section 7 « Gabarits Excel »).

## Fichiers modifiés

| Fichier | |
|---------|-|
| `main/services/export/template/xlsx-render.ts` | **nouveau** — lecture des lignes modèles, xlsx-template, garde-fou cellules en double, réécriture, `fullCalcOnLoad` |
| `main/services/export/template/xlsx-refs.ts` | **nouveau** — projection des lignes, réécriture des références A1 |
| `main/services/export/template/template-data-xlsx.ts` | **nouveau** — données Excel des 5 kinds |
| `main/services/export/template/template-export.service.ts` | branche xlsx, 5 builders |
| `renderer/lib/exportTemplates.ts` | kinds xlsx |
| `apps/desktop/package.json`, `pnpm-lock.yaml`, `electron.vite.config.ts` | `xlsx-template` (bundlé) |
| `apps/desktop/scripts/build-export-templates.ts`, `resources/export-templates/*.xlsx` | exemples Excel |
| `apps/desktop/resources/export-templates/Référence des balises.html` | section Excel |
| `apps/desktop/scripts/fixtures/` | **nouveau** — gabarit client Excel de référence + script Excel qui le produit |
| `apps/desktop/scripts/check-gh34.ts` | scénarios S4 (111 contrôles au total) |
| `apps/desktop/scripts/e2e-gh34-drawio.mjs` | export Excel ajouté |

## Divergences par rapport au design

- **Réécriture des références** (`xlsx-refs.ts`) : non prévue au design, indispensable (spike).
- **Liste de cellules en largeur** (`${table:rows.cells}`) : l'option de recopie des autres cellules
  de la ligne est désactivée dans ce cas (bug xlsx-template : cellules en double → classeur
  illisible, trouvé par Excel) ; garde-fou d'erreur explicite si une combinaison produit malgré tout
  deux cellules à la même adresse.
- **Balise de table seule dans sa cellule** : contrainte de xlsx-template, documentée.
- **Injection de formule** : neutralisation ajoutée (non prévue au design).

## Vérifications

- `pnpm typecheck` : aucune nouvelle erreur (seule `git.service.ts(78)`, préexistante) ; `pnpm build` OK,
  aucun `require` externe dans les chunks de l'export par gabarit.
- `scripts/check-gh34.ts` : **111 PASS, 0 FAIL** (S1–S3 + S4.1–S4.5, recopie d'Excel, cas de la revue).
- **Excel 16 (COM)** : tous les classeurs produits s'ouvrent **sans réparation** (un témoin
  volontairement corrompu est bien refusé : la vérification détecte les réparations) ; valeurs
  **calculées par Excel** conformes (totaux 17/34, NB.SI 2, moyenne 5,67 sur l'autre feuille,
  cumul 1/3/6, différences 1/1/1, formules de ligne 2/4/6) ; MFC et séries du graphique étendues ;
  rendu contrôlé visuellement (gabarit client avec graphique, exemple).
- **E2E** app buildée et app packagée (`electron-builder --dir`) : export Word (draw.io) + Excel OK.
- **UI** (démo LL800) : popover avec « Gabarit Word » et « Gabarit Excel » ; export Excel des
  exigences avec l'exemple → libellés de statut, dossiers, totaux 13 / 8 approuvées.
- `/code-review` : 4 problèmes (lignes et cellules vides auto-fermantes, sémantique de recopie dans
  les lignes générées, balise de table partielle) — tous corrigés, chacun couvert par un contrôle.

## Mises à jour SPEC (sprint final — confrontation des `Refs SPEC`)

| Section | Modification |
|---------|--------------|
| `SPEC-TECH-stack.md` §2 | ligne « Export Excel par gabarit client » (xlsx-template, exceljs écarté, réécriture des références) |
| `SPEC-TECH-stack.md` §9 | exemples : 5 Word + 5 Excel |
| `SPEC-TEMPLATES.md` §2 | `exportTemplates` : Word/Excel |
| `SPEC-ELECTRON-DESKTOP.md` §19.15a | kinds xlsx, deux listes, section Excel (moteur, références, sécurité, limites), vérification |
| `SPEC-TESTS.md` §4.4 | exports de campagne par gabarit : une entrée par instance avec `requirementId` |
| `SPEC-REQ-requirements.md` §3, §3.2f | comparés — pas de divergence (richtext Markdown ; paramètres substitués comme les exports Standard) |
| `SPEC-INDEX.md` | MAJ → GH34 (§2, §19.15, SPEC-TESTS §4+) et mots-clés |

(Les autres mises à jour SPEC de GH34 ont été faites au sprint 3 : SPEC-TECH-stack §2/§9,
SPEC-TEMPLATES §2, SPEC-ELECTRON-DESKTOP §19.15/§19.15a.)

## Test manuel

1. Panneau Compte › **Installer les exemples** (ajoute les 5 classeurs Excel à `Exemples Polenta/`).
2. Vue exigences → Exporter → « Gabarit Excel » : `Exemples Polenta/Liste des exigences.xlsx` → Excel.
   Cartouche, une ligne par exigence, dossiers, statuts, totaux corrects, filtre sur tout le tableau.
3. Ouvrir un classeur client (ou `scripts/fixtures/gh34-client.xlsx`), mettre une ligne modèle
   `${table:items.id}` / `${table:items.name}` / `${table:items.statusLabel}`, une formule
   `=SOMME(…)` sur la seule ligne modèle, une MFC et un graphique sur la colonne → exporter : tout
   s'étend aux lignes générées.
4. Requête ad hoc → Exporter → `Résultat de requête.xlsx` : colonnes de la requête en largeur.
5. Analyse d'impact → `Analyse des impacts.xlsx` ; campagne → `Plan de campagne.xlsx`.
