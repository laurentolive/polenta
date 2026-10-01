# GH34 — Scénarios de test

Spec : `specs/GH34.md` · Design : `specs/GH34-design.md`

**Automatique** : `scripts/check-gh34.ts` (lancé avec `tsx`) génère des documents à partir de
gabarits fixtures (`apps/desktop/resources/export-templates/` + fixtures de cas d'erreur), les
relit (PizZip + parsing XML) et vérifie les assertions marquées **[auto]**. Les autres scénarios
sont manuels, dans l'app, avec ouverture du résultat dans Word.

Fixture de données : projet de démo (`scripts/demo-lave-linge` ou `demoProject.ts`) avec au moins
un dossier imbriqué, une exigence dont le champ richtext contient : titre, gras/italique/barré,
code inline, liste à puces imbriquée, liste numérotée, cases à cocher, tableau GFM, image du
repo, diagramme draw.io, lien `[[ID]]`, référence de paramètre.

## Sprint 1 — Socle

### Nominal
| # | Scénario | Attendu |
|---|----------|---------|
| S1.1 | Préférences app → Choisir un dossier de bibliothèque, redémarrer l'app | Chemin conservé (`app-settings.json`) |
| S1.2 | Bibliothèque avec `ACME/cahier.docx`, `ACME/sub/x.docx`, `Globex/y.xlsx`, `~$cahier.docx`, `.cache/z.docx` | Popover Word : Standard, `ACME/cahier.docx`, `ACME/sub/x.docx` uniquement **[auto: list]** |
| S1.3 | Préférences projet → défaut `requirements:docx` = `ACME/cahier.docx`, enregistrer | `schema.yaml` contient `preferences.exportTemplates.requirements:docx`, `autoPropagatePin` intact |
| S1.4 | Exporter → Word depuis la vue exigences | Gabarit ACME présélectionné ; document produit avec page de garde, en-tête/pied, logo et styles du gabarit |
| S1.5 | Gabarit avec `{{project.label}}`, `{{git.branch}}`, `{{git.commit}}`, `{{git.tag}}`, `{{export.date}}`, `{{export.user}}`, `{{count}}` | Valeurs correctes ; `git.tag` vide si HEAD non tagué, renseigné sinon **[auto]** |
| S1.6 | Boucle `{{#items}}` dans une ligne de tableau | Une ligne par élément, ordre de l'arbre, filtre et colonnes de la Vue Word respectés **[auto]** |
| S1.7 | Gabarit utilisant `{{#isFolder}}` / `level` | Titres de dossiers à leur place, dossiers vidés par le filtre absents **[auto]** |
| S1.8 | Export tests avec boucle `{{#steps}}` | Étapes détaillées (action, résultat attendu, notes) dans l'ordre **[auto]** |
| S1.9 | Choisir « Standard » dans le popover | Rendu identique à avant GH34 ; défaut du projet inchangé |
| S1.10 | Référence de paramètre `{nom}` dans un champ | Valeur substituée, comme l'export standard **[auto]** |
| S1.11 | Champ richtext en `{{statement}}` | Texte sans syntaxe Markdown **[auto]** |
| S1.12 | Expression `{{#status == "approved"}}` et filtre `{{title \| upper}}` | Évalués correctement **[auto]** |

### Cas limites
| # | Scénario | Attendu |
|---|----------|---------|
| S1.13 | Aucune bibliothèque configurée | Popover : Standard seul + indication vers les préférences |
| S1.14 | Défaut projet absent de la bibliothèque (renommé) / bibliothèque d'un autre membre à un autre chemin | Option « ⚠ chemin (introuvable) » désactivée, Standard présélectionné ; autre membre : gabarit trouvé via le chemin relatif |
| S1.15 | Dossier de bibliothèque supprimé après configuration | Pas de crash ; comme S1.13 avec message « dossier introuvable » |
| S1.16 | Liste filtrée vide (aucun élément) | Document généré, boucle vide, `count` = 0 **[auto]** |
| S1.17 | Balise `{{champInexistant}}` | Valeur vide, pas d'erreur **[auto]** |
| S1.18 | Gabarit avec `{{#items}}` non fermé | Message nommant le gabarit et la balise ; aucun fichier à la destination (y compris si un fichier existait déjà : il n'est pas écrasé) **[auto]** |
| S1.19 | Fichier `.docx` corrompu (zip invalide) / ouvert dans Word (verrou) | Message explicite, aucun fichier écrit **[auto pour corrompu]** |
| S1.20 | `templateRelPath` = `../../secret.docx` envoyé à l'IPC | Refusé (hors bibliothèque) **[auto]** |
| S1.21 | Balise `{{constructor.constructor("return process")()}}` ou équivalent | Aucune exécution, valeur vide ou erreur de gabarit **[auto]** |
| S1.22 | Texte du gabarit contenant `{nom}` avec accolades simples | Laissé tel quel (délimiteurs `{{ }}`) **[auto]** |
| S1.23 | Champ contenant `<`, `&`, guillemets, emoji, retours à la ligne | Texte correct, document valide, retours à la ligne conservés **[auto]** |
| S1.24 | Projet en lecture seule / composant de workspace | Export fonctionne (lecture seule) |

## Sprint 2 — Richtext

| # | Scénario | Attendu |
|---|----------|---------|
| S2.1 | `{{@rich.statement}}` avec la fixture richtext complète | Titres en style Titre du gabarit, gras/italique/barré, code en mono, listes imbriquées, numérotation, cases ☐/☒, tableau avec en-tête, image du repo ; Word ouvre **sans message de réparation** **[auto: XML valide, relations/médias/content types cohérents]** |
| S2.2 | Gabarit Word français (styleId `Titre1`) et anglais (`Heading1`) | Bon style appliqué dans les deux cas **[auto]** |
| S2.3 | Gabarit sans style `Table Grid` ni `List Paragraph` | Pas d'erreur, rendu par défaut lisible **[auto]** |
| S2.4 | Deux listes numérotées successives et dans deux éléments différents | Chacune repart à 1 **[auto]** |
| S2.5 | Gabarit sans `numbering.xml` | Partie créée, listes correctes **[auto]** |
| S2.6 | Image plus large que la page | Ramenée à la largeur utile, ratio conservé **[auto]** |
| S2.7 | Image introuvable / URL externe en erreur ou lente (>10 s) | Paragraphe de repli, export terminé **[auto pour introuvable]** |
| S2.8 | Même image dans 50 éléments | Un média par occurrence ou dédoublonné — document valide, taille raisonnable |
| S2.9 | `{{@rich.x}}` placé au milieu d'un paragraphe avec du texte | Erreur de gabarit explicite (balise brute non seule) **[auto]** |
| S2.10 | Champ richtext vide | Aucun paragraphe parasite **[auto]** |
| S2.11 | `[[SW-0042]]` et lien Markdown | Texte `SW-0042` ; texte du lien **[auto]** |
| S2.12 | Cahier de 500 exigences avec richtext | Export < 15 s, UI non bloquée |

## Sprint 3 — Diagrammes, campagnes, dashboard, livrables

| # | Scénario | Attendu |
|---|----------|---------|
| S3.1 | Richtext avec diagramme draw.io (avec ancre `nodeId`, avec crop, sans dimensions) | Image du diagramme fidèle au rendu Vue Word, nette, bonne page/rognage |
| S3.2 | Diagramme dont le fichier est absent / XML invalide | Paragraphe `[Diagramme : path#nodeId]`, export terminé |
| S3.3 | Même diagramme référencé 20 fois | Un seul rendu (dédoublonnage), temps raisonnable |
| S3.4 | Export campaign-plan avec gabarit | Campagne + entrées (instances générées avec exigence de l'instance) **[auto]** |
| S3.5 | Export campaign-report avec gabarit | Statuts d'exécution, étapes avec résultat, `summary` cohérent avec l'écran **[auto]** |
| S3.6 | Export dashboard avec gabarit | Un tableau par widget avec colonnes/lignes du résultat **[auto]** |
| S3.7 | Gabarits d'exemple livrés, copiés dans la bibliothèque | Chacun produit un document valide sur le projet de démo **[auto]** |
| S3.8 | Référence des balises | Couvre syntaxe + modèle de chaque kind ; exemples conformes au comportement réel |
| S3.9 | App packagée (installeur NSIS) | Dépendances présentes, export gabarit + snapshot draw.io fonctionnels hors dev |

## Sprint 4 — Excel

| # | Scénario | Attendu |
|---|----------|---------|
| S4.1 | Gabarit xlsx client (logo, cartouche, ligne modèle stylée, formule de total, mise en forme conditionnelle, 2e feuille, graphique) | Ligne répétée par élément avec mise en forme ; cartouche rempli ; formule et MFC étendues ; 2e feuille et graphique conservés **[auto partiel]** |
| S4.2 | Défaut projet `requirements:xlsx`, sélection au moment de l'export | Comme S1.3/S1.4 pour Excel |
| S4.3 | Champ richtext | Texte simple dans la cellule |
| S4.4 | Kinds query-result et impact-analysis | Données exportées via gabarit **[auto]** |
| S4.5 | Gabarit xlsx invalide / corrompu | Message explicite, aucun fichier écrit **[auto]** |
| S4.6 | Excel ouvre le résultat | Aucun message de réparation |

## Non-régression (tous sprints)

- Exports Standard xlsx/docx/pdf des 7 kinds : inchangés.
- `pnpm typecheck` sans nouvelle erreur ; temps de démarrage inchangé (dépendances chargées en `import()` dynamique).
