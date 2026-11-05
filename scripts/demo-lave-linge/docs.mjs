// Documentation écrite dans les repos du workspace de démonstration.

export const README_PRODUIT = `# Lave-linge LL800 — repo produit (démonstration Polenta)

Repo racine du workspace de démonstration Polenta : lave-linge frontal 8 kg / 1400 tr/min.

Il porte les exigences produit (PRD) et système (SYS), les tests système, les campagnes, les
versions, issues et validations du produit, les requêtes/dashboards partagés, et déclare ses
composants réutilisables dans
\`polenta-repo.yaml\` :

| Montage | Rôle | Pin |
| --- | --- | --- |
| \`comp-moteur\` | Moteur BLDC & onduleur (dépend lui-même de \`if-bus-interne\`) | \`main\` (branche) |
| \`comp-pompe-vidange\` | Pompe de vidange, affichée sous le composant local *hydraulique* | \`v2.0\` (tag) |
| \`comp-module-wifi\` | Module Wi-Fi | SHA de commit |
| \`if-bus-interne\` | Repo **interface** (rôles controller / device) | \`v1.1\` (tag) |

Voir \`GUIDE-EVALUATION.md\` pour la liste des fonctionnalités illustrées et les scénarios de test.
`

export const README_COMPOSANTS = {
  moteur: `# comp-moteur — Moteur BLDC & onduleur

Composant réutilisable (repo autonome, schéma propre). Composant local imbriqué : *Firmware FOC*.
Implémente l'interface \`if-bus-interne\` avec le rôle \`device\` (déclaré dans \`polenta-repo.yaml\`).
`,
  pompe: `# comp-pompe-vidange — Pompe de vidange

Composant réutilisable. Le paramètre \`bruit_max\` est volontairement vide (référence non résolue).
`,
  wifi: `# comp-module-wifi — Module Wi-Fi

Composant réutilisable sans tests (exigences « non couvertes »). Implémente partiellement
l'interface \`if-bus-interne\` (rôle \`device\`) : la matrice de conformité montre des manques.
`,
  bus: `# if-bus-interne — Interface du bus interne

Repo **interface** : déclare les rôles \`controller\` et \`device\`. Chaque exigence porte un champ
\`roles\` (vide = applicable à tous). Tags : \`v1.0\`, et \`v1.1\` posé par le passage released de IFV-0001.
`,
}

export const GUIDE = `# Guide d'évaluation — workspace de démonstration « Lave-linge LL800 »

Ce workspace sert de support de test et d'évaluation de Polenta. Il est **généré** par
\`scripts/demo-lave-linge/generate.mjs\` (repo polenta, \`pnpm --filter @polenta/desktop demo:generate\`) :
on peut le régénérer à l'identique à tout moment (\`--force\`) après l'avoir modifié pendant les tests.

## 1. Structure

\`\`\`
demo-lave-linge/                 ← dossier à ouvrir dans Polenta
├── .polenta/workspace.yaml      ← rootRepo: ll800-produit
├── ll800-produit/               ← repo produit (racine)
├── comp-moteur/                 ← composant (dépend de if-bus-interne)
├── comp-pompe-vidange/          ← composant (monté sous le composant local « hydraulique »)
├── comp-module-wifi/            ← composant (pin par SHA)
└── if-bus-interne/              ← interface (rôles controller / device)
\`\`\`

Composants **locaux** du repo produit (même repo, \`children\` du schéma) :

\`\`\`
Lave-linge LL800 (root) ─ PRD, SYS, TSYS, campagnes
├── Sous-système hydraulique ─ HYD, THYD      (+ comp-pompe-vidange via localParent)
│   └── Électrovannes ─ EV                    (3e niveau d'imbrication)
├── Carte de commande ─ CC                    (implémente if-bus-interne:controller et bus-ihm:maitre)
│   └── Logiciel de commande ─ SW, TSW
├── Bus IHM (interface locale) ─ BIHM         (rôles maitre / esclave)
└── IHM façade ─ IHM                          (implémente bus-ihm:esclave)
\`\`\`

## 2. Historique git (auteurs, dates, baselines)

| Phase | Date | Contenu |
| --- | --- | --- |
| P1 | 2026-03-03 | Schémas, paramètres, diagrammes, images |
| P2 | 2026-03-17 | Rédaction des exigences (brouillons) |
| P3 | 2026-04-08 | Tests et liens de traçabilité |
| P4 | 2026-04-24 | Revue RE1, approbations, requêtes/dashboards, SYS-0015 supprimée (pierre tombale) — tag \`v1.0\` (interface) |
| — | 2026-04-30 | **Baseline \`RE1\`** (tag annoté sur les 5 repos) |
| P5 | 2026-05-20 | Campagnes EVT (CAMP-0001) et onduleur (CMOT-0001, comp-moteur), exécutions hors campagne ; issues ISS-0001, MISS-0001 depuis les échecs |
| P6 | 2026-06-15 | Évolutions : essorage 1200→1400, SYS-0002 v2, PRD-0011 obsolète |
| — | 2026-06-16 → 25 | **Versions 1.0** : bus 1.1, Wi-Fi 1.0, pompe 1.0, moteur 1.2.4 (validation VMOT-0001 signée), produit 1.0 (VAL-0001 signée) ; ouverture de la 2.0 |
| — | 2026-06-30 | **Baseline \`RE2\`** |
| P7 | 2026-07-08 | Campagnes DVT / KPI / endurance sur la version 2.0 ; ISS-0003 ; validation 2.0 commencée ; correctif 1.1 ouvert |
| P8 | 2026-07-20 | Ajustements (PRD-0006 v2, MOT-0007 en review) ; pompe 2.0 released (tag \`v2.0\`, pin du produit) ; moteur 1.3 ouverte ; correctif 1.1 abandonné |
| branche | 2026-07-22 | \`dev-essorage-1600\` (repo produit, **non fusionnée**) |

Auteurs : Claire Martin (produit), Hugo Bernard (système), Inès Leroy (logiciel), Marc Dubois
(validation), Sophie Laurent (hydraulique), Yann Petit (électronique de puissance) — visibles dans
les champs dérivés createdBy / updatedBy.

## 3. Fonctionnalités illustrées → où regarder

### Modèle de données (schéma)
- **Tous les types de champ** : \`text\`, \`textarea\` (SYS.notes), \`number\` (TSYS.duree_min, HYD.debit_l_min),
  \`enum\`, \`multi_enum\` (PRD.marches, TSYS.moyens), \`boolean\` (securite, claim), \`date\` (PRD.echeance),
  \`datetime\` (SYS.derniere_revue), \`richtext\`, \`user\` (PRD.responsable), \`drawio\` (SYS.diagramme),
  \`link\` multiple (SYS.documents, renseigné sur SYS-0001).
- **Obligatoire selon le statut** (\`requiredWhen\`) : PRD.acceptanceCriteria à l'approbation.
- **Contraintes de transition** sur les exigences système : brouillon → review bloqué si un champ requis manque
  (validateurs en avertissement) ; approbation sans lien de couverture signalée.
- **Historique des champs** : statut et priorité (\`trackHistory\`) écrits dans \`history\` pour les exigences
  et tests produit, système et moteur, avec un commentaire sur SYS-0002 ; les autres types (composants
  locaux, pompe, Wi-Fi, bus) sans \`history\` : entrées déduites, « Reconstruire depuis git ».
- **Colonnes par défaut** : les liens de vérification et les issues (\`defaultVisible\`) s'affichent sans configurer la vue.
- **Champs d'exécution** des tests système : \`banc_utilise\` par run, \`mesure\` par étape.
- **ID affiché** : les liens vers une exigence IHM montrent son titre (\`displayIdField\`).
- **Pierre tombale** : SYS-0015 supprimée en P4 (\`.polenta/tombstones/SYS-0015\`), la prochaine SYS est SYS-0016.
- **Validateurs** : \`EARS\` sur tous les énoncés ; \`regex\` sur PRD.reference_client (\`CLI-0042\` valide,
  \`CLI-12\` invalide sur PRD-0012) et TSW.version_firmware (\`1.2\` invalide sur TSW-0003).
- \`required\`, \`default\`, \`placeholder\` ; statuts colorés, \`isApproval\`, \`isTerminal\` (obsolete, rejected).
- Les 6 catégories de types : requirement, test, campaign, version, issue, validation ; préfixes uniques sur
  tout le workspace (LLV, MOTV, POMV, WIFV, IFV pour les versions ; ISS, MISS ; VAL, VMOT).
- \`preferences.autoPropagatePin: false\`.
- 6 types de liens : raffinement (source restreinte à \`root::exigence-produit\`), implementation,
  verification, implements-interface, issue-impact, relation (non contraint).

### Exigences — cas remarquables
| Élément | Ce qu'il illustre |
| --- | --- |
| SYS-0001 | Diagramme draw.io embarqué (bloc \`drawio\`) + champ \`drawio\` |
| SYS-0003 | draw.io embarqué avec \`nodeId\` et largeur |
| SYS-0005 | draw.io embarqué avec **rognage** (\`crop\`) ; paramètres \`{pression_eau_min}\`/\`{pression_eau_max}\` |
| SYS-0002 | Image redimensionnée (bloc \`image\`), réf. cross-composant \`{comp-moteur::…}\`, v2, **repassée en review** |
| IHM-0001 | Image Markdown standard dans un champ richtext secondaire |
| SYS-0009 | **Tableau** Markdown avec paramètre dans une cellule |
| SYS-0011 | Paramètre de composant **vide** (\`{comp-pompe-vidange::bruit_max}\`) → non résolu |
| SYS-0012 | Paramètre **absent** de la base (\`{effort_fermeture_hublot}\`) → reste littéral |
| PRD-0004 | Référence \`[[SYS-0002]]\` dans la justification |
| PRD-0010 | Lien **Jira** |
| PRD-0011 | Statut \`obsolete\` (terminal, masqué par défaut) |
| PRD-0012 | Énoncé **non EARS** + regex invalide (dashboard Maturité) |
| PRD-0013 | Statut \`rejected\` (second statut terminal) |
| PRD-0002, TSYS-0002, MOT-0001, MOT-0006, WIFI-0004 | \`needsRevalidation: true\` (⚠ Impact à vérifier) |

### Traçabilité et couverture (statuts attendus)
| Statut | Exemples |
| --- | --- |
| \`validated\` | PRD-0001, PRD-0007 (couverture partielle), SW-0001, SW-0002, HYD-0001, HYD-0003, POMP-0001, MOT-0003 |
| \`failing\` | PRD-0009 (BLOCKED en EVT puis INCOMPLETE en DVT), MOT-0004 (FAIL dans CMOT-0001, campagne du moteur) |
| cas limites | PRD-0003 / PRD-0004 : un test PASS + une instance TSYS-0005 en attente → \`covered\` |
| \`covered\` (lié, jamais exécuté) | SYS-0010, SYS-0004 (couverture **partielle**), MOT-0002 |
| \`needs_revalidation\` | SYS-0002, PRD-0002 |
| \`not_covered\` | SYS-0008, SYS-0013, WIFI-*, CC-* |

- Lien de vérification créé **à l'envers** (\`PRD-0002 → TSYS-0002\`) : doit être apparié comme les autres.
- Liens **cross-repo** : SYS-0002 → MOT-0001, SYS-0006 → POMP-0001 (stockés dans le repo produit).
- TSYS-0004 : FAIL en EVT puis PASS en DVT → le dernier run fait foi.
- TSW-0003 : FAIL puis PASS hors campagne.
- **Constellation** : partir de PRD-0002 pour voir raffinements et couverture.

### Paramètres (\`parameters/parameters.yaml\`, un par repo)
- Base produit (11 paramètres), moteur, pompe, Wi-Fi, interface.
- \`vitesse_essorage\` (produit) et \`vitesse_essorage_max\` (moteur) passent de 1200 à 1400 en P6 :
  comparer RE1 ↔ RE2, voir les valeurs figées dans CAMP-0001 (1200) vs CAMP-0002 (1400).
- La branche \`dev-essorage-1600\` passe \`vitesse_essorage\` à 1600.

### Tests, exécutions, campagnes
| Campagne | Statut | Particularités |
| --- | --- | --- |
| CAMP-0001 EVT | completed | paramètres lus au tag RE1, PASS/FAIL/BLOCKED, \`paramValues\` saisi à la main (\`charge_essai\`) |
| CMOT-0001 (comp-moteur) | completed | test du composant dans une campagne de son dépôt : TMOT-0003 en échec |
| CAMP-0002 DVT | in_progress | paramètres lus au tag RE2, version testée 2.0 (écart non documenté sur TSYS-0007), champs d'exécution (TSYS-0002), run importé d'Excel (TSYS-0006), entrée retirée (TSYS-0003), \`unresolvedParams\` |
| CAMP-0003 KPI | in_progress | Test **itérant** TSYS-0005 (\`{req.id}\`, \`{req.kpi_cible}\`) : 6 instances, une par exigence ; SYS-0009 sans \`kpi_cible\` → \`missing\` ; version testée 2.0 |
| CAMP-0004 Endurance | abandoned | — |
| CAMP-0005 PVT | planned | TSYS-0004 reporté depuis la DVT ; paramètre manuel laissé vide |

Exécutions hors campagne : THYD-*, TSW-0002/0003, TMOT-0001/0002, TPOMP-* (runs stockés dans le repo du test).
Une campagne ne contient que des tests de son dépôt.

### Versions, issues, validation
| Objet | Où | Ce qu'il illustre |
| --- | --- | --- |
| LLV-0001 \`1.0\` | produit | released, tag \`ll800-produit-1.0\`, composants moteur 1.2.4, pompe 1.0, Wi-Fi 1.0, analyse figée |
| LLV-0002 \`2.0\` | produit | en cours : backlog (PRD-0006), issues incluses, impact saisi sur SYS-0002, tests à exécuter |
| LLV-0003 \`1.1\` | produit | abandonnée ; son label peut être réutilisé |
| MOTV-0001 \`1.2.4\`, MOTV-0002 \`1.3\` | comp-moteur | released (le bus 1.1 suit le moteur) ; en cours |
| POMV-0001, POMV-0002 | comp-pompe-vidange | 1.0 puis 2.0, tag \`v2.0\` épinglé par le produit |
| WIFV-0001, IFV-0001 | Wi-Fi, bus | 1.0, 1.1 (tag \`v1.1\`) |
| ISS-0001 | produit | depuis l'échec TSYS-0004 (EVT), corrigée, livrée en 1.0 |
| ISS-0002 | produit | depuis la dérogation de VAL-0001 sur SYS-0004 |
| ISS-0003 | produit | depuis l'échec KPI de TSYS-0005 (CAMP-0003), impacte PRD-0002 |
| MISS-0001 | comp-moteur | depuis l'échec TMOT-0003, incluse en 1.3 |
| VAL-0001 | produit | signée : conforme, hors scope (PRD-0010, SYS-0013), dérogation (SYS-0004), copie figée |
| VAL-0002 | produit | en cours : décisions reprises, en attente, proposée (SYS-0013), à revoir (PRD-0006) |
| VMOT-0001 | comp-moteur | signée, visible dans l'en-tête de VAL-0001 |

Vue d'équipe « Suivi de conformité » sur les exigences produit : colonnes de reflets (design, validation).

### Interfaces et matrice de conformité
- **Interface en repo séparé** \`if-bus-interne\` (controller/device) : implémentée par la carte de commande
  (controller, composant local), \`comp-moteur\` et \`comp-module-wifi\` (device).
  - BUS-0006 (ajoutée en v1.1) : manquante pour tous.
  - MOT-0006 / WIFI-0004 marqués à revalider → cellules « couvert » et non « validé ».
  - WIFI-0004 ne couvre que BUS-0002 → manques sur BUS-0001/0003/0005.
- **Interface locale** \`bus-ihm\` (maitre/esclave) : CC-0005 (maître) ne couvre pas BIHM-0004 ; IHM-0004 (esclave) complète.

### Workspace multi-repo
- Dépendances imbriquées : produit → comp-moteur → if-bus-interne (même pin \`v1.1\` → nœud partagé, pas de conflit).
- Types de pin : branche (\`main\`), tag annoté de version (\`v2.0\`, \`v1.1\`), SHA (module Wi-Fi).
- \`localParent: hydraulique\` : la pompe s'affiche sous le composant local hydraulique.
- Baselines multi-composants : \`RE1\` et \`RE2\` existent sur les 5 repos.

### Vues enregistrées
- \`.polenta/views/root/exigence-produit.yaml\` : « Revue marketing » et « Suivi de conformité ».

### Suivi (requêtes & dashboards)
- 13 requêtes partagées au format v1 (GH74) : 7 modèles « Liste filtrée », 2 colonnes calculées
  (QUERY-0010, QUERY-0011) et 4 scripts écrits à la main (liens, tri par version, issues par version,
  décisions d'une validation choisie par paramètre).
- DASHBOARD-0001 (barres empilées, camembert, indicateur, table, courbe), DASHBOARD-0002,
  DASHBOARD-0003 « Versions & validation » (paramètre de dashboard).
- Pas de \`dashboards/lib/\` : la bibliothèque projet et le dashboard privé « Campagnes » sont semés à
  la première ouverture de Suivi. Pas de dashboard « Status » (il n'est semé que dans un projet sans
  dashboard).

## 4. Scénarios de test suggérés

Les tutoriels de Polenta (\`docs/tutoriels/\`) proposent un exercice par fonction sur cette démo. Pour une
évaluation rapide :

1. **Ouverture** : ouvrir \`demo-lave-linge/\` → 5 repos montés, arbre avec composants locaux sur 3 niveaux.
2. **Diamant** : dans \`comp-moteur/polenta-repo.yaml\`, passer le pin de \`if-bus-interne\` à \`v1.0\`,
   rouvrir → conflit de dépendance en diamant à résoudre (mount override).
3. **Revalidation** : repasser SYS-0001 (approuvée) en \`review\` → CC-0001 et les éléments liés
   doivent être marqués « Impact à vérifier ».
4. **Paramètre** : modifier \`capacite_kg\` → PRD-0001 et TSYS-0001 (approuvés) marqués ; vue « Utilisé par ».
5. **Suppression bloquée** : tenter de supprimer le paramètre \`consommation_eau_eco\` (utilisé).
6. **Baselines** : comparer \`RE1\` ↔ \`RE2\` (exigences ajoutées/modifiées/obsolètes, paramètres, pins).
7. **Branche** : basculer sur \`dev-essorage-1600\`, analyser l'impact, fusionner dans \`main\`.
8. **Analyse d'impact live** : modifier une exigence sans commiter → analyse vs HEAD multi-repo.
9. **Campagne itérative** : créer une campagne avec TSYS-0005 et choisir les exigences à instancier.
10. **Version testée** : exécuter une entrée de CAMP-0002 → la version 2.0 est demandée, un écart est signalé.
11. **Version** : inclure PRD-0006 dans LLV-0002, lire l'analyse d'impact, créer une campagne depuis les tests à exécuter.
12. **Issue** : créer une issue depuis un run en échec, la lier à une exigence, l'inclure dans LLV-0002.
13. **Validation** : dans VAL-0002, confirmer la proposition sur SYS-0013, reprendre PRD-0006 ; tenter de signer.
14. **Matrice de conformité** : vérifier les cellules attendues listées au §3.
15. **Recherche / remplacement** : rechercher « essorage » (plusieurs repos), regex \`\\{[a-z_]+\\}\`.
16. **Exports** Word/Excel/PDF d'un composant avec diagrammes, images et tableaux.
17. **Validation EARS / regex** : éditer PRD-0012 et TSW-0003.
18. **MCP** : lister les versions, les issues, proposer une décision de validation.

## 5. Régénérer

\`pnpm --filter @polenta/desktop demo:generate -- --out <dossier> --force\`. Sous bash, écrire le dossier avec
des \`/\` ou entre guillemets : un chemin \`C:\\…\` non quoté perd ses antislashs, et le générateur le refuse.
`
