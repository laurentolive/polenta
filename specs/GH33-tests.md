# GH33 — Scénarios de test

Pas de tests automatiques dans `apps/desktop` (seul `typecheck` existe) : scénarios manuels, à
dérouler dans l'app (`pnpm dev`).

**Jeu de données** : un repo avec au moins deux types de test (ex. `root::test-systeme` et
`root::test-integration`). Le premier contient une vingtaine de tests répartis dans 2–3
dossiers, dont un sous-dossier. On y trouve :
- des tests approuvés et en brouillon ;
- un test à référence à saisir (T97) ;
- un test itérant avec 2 exigences liées (T179) ;
- un test présent dans `tests/` mais absent de `.polenta/trees`.

Dans la Vue Excel du premier type, configurer quelques colonnes personnalisées, une colonne
figée et un dossier replié.

## Nominal — ajout à une campagne (sprint 1)

| # | Scénario | Attendu |
|---|----------|---------|
| N1 | Campagne `planned` → « + Ajouter des tests » | Modale grand format. Type par défaut = composant/niveau de la route, sinon le premier type. Colonnes, ordre, colonne figée et dossier replié identiques à la Vue Excel de ce type. Seuls les tests approuvés sont listés. |
| N2 | Cocher 3 tests sans paramètre → « Ajouter (3) » | Pas d'étape 2. La modale se ferme et 3 instances `pending` sont ajoutées. Contenu des `runs` identique à l'ancienne UI. |
| N3 | Sélectionner le test à référence à saisir + 1 test simple | Le bouton devient « Suivant ». L'étape 2 ne liste que le test paramétré (`TestParamFields`) ; « 1 test sans paramètre » apparaît replié. « Ajouter » reste désactivé tant que la référence est vide. Une fois remplie : 2 instances, `paramValues` corrects. |
| N4 | Sélectionner le test itérant | L'étape 2 affiche `ReqInstancePicker` avec les 2 exigences cochées. En décocher une → « Ajouter (1) » et une seule instance avec le bon `requirementId`. |
| N5 | Étape 2 → « Précédent » → désélectionner le test paramétré → « Ajouter » | Retour à l'étape 1 avec la sélection intacte. Ses valeurs ne sont pas envoyées et l'étape 2 est sautée si plus rien n'est à saisir. |
| N6 | Test paramétré déjà présent une fois | Proposé avec le badge « déjà ×1 ». L'ajouter crée une 2ᵉ instance (via `duplicateTest`). |

## Sélection (sprint 1)

| # | Scénario | Attendu |
|---|----------|---------|
| S1 | Clic sur une case, puis sur une autre | Les deux sont cochées : une case bascule sans rien retirer. |
| S2 | Clic simple sur une ligne (hors case) alors que 3 tests visibles sont cochés | Seule la ligne cliquée reste cochée parmi les lignes visibles. |
| S3 | Ctrl+clic sur 2 lignes | Chacune bascule ; le reste est inchangé. |
| S4 | Clic sur la ligne 2, puis Maj+clic sur la ligne 6 | Les lignes 2 à 6 sont sélectionnées. Les autres sélections visibles sont retirées ; celles non affichées sont conservées. |
| S5 | Clic sur la ligne 2, Ctrl+Maj+clic sur la ligne 6, alors que la ligne 10 est cochée | Les lignes 2 à 6 et la ligne 10 sont cochées. |
| S6 | Case de la ligne 2 cochée, puis Maj+clic sur la case (décochée) de la ligne 5 | Les lignes 2 à 5 sont cochées. Puis Maj+clic sur la case (cochée) de la ligne 4 → lignes 2 à 4 décochées. |
| S7 | Ancre masquée par un filtre, puis Maj+clic | Se comporte comme un clic sans Maj. |
| S8 | Case d'un dossier contenant un sous-dossier replié | Tous les tests du dossier, sous-dossier replié compris, sont cochés ; la case est cochée. En décocher un → la case du dossier est indéterminée. Nouveau clic sur la case → tous cochés. |
| S9 | Clic sur une ligne de dossier (hors case) | Le dossier se replie ou se déplie ; la sélection est inchangée. |
| S10 | Dossier sans aucun test proposé (ex. que des brouillons en mode ajout) | Dossier affiché, case désactivée. |
| S11 | Sélectionner 2 tests du type A, passer au type B, en sélectionner 1, valider | 3 instances ajoutées. Compteur au retour sur B : « 3 sélectionnés, dont 2 non affichés ». |
| S12 | Test absent de l'arbre | Listé en fin de grille et sélectionnable. |
| S13 | « Vider la sélection » | Compteur à 0, toutes les cases décochées, sélection des autres types comprise. |

## Filtres (sprint 1)

| # | Scénario | Attendu |
|---|----------|---------|
| F1 | Filtre colonne sur « Statut » ou sur un champ personnalisé | Même comportement que dans la Vue Excel (popover, options, couleur de l'icône, regex invalide sans effet). |
| F2 | Avec un filtre colonne actif, cocher la case d'en-tête | Seuls les tests filtrés sont cochés. En vidant le filtre, les autres restent décochés. |
| F3 | Sélectionner 5 tests, puis filtrer pour n'en montrer que 2 | « 5 sélectionnés, dont 3 non affichés ». |
| F4 | Filtre global avec option regex | Filtre la grille comme dans la vue système. Changer de type le vide ; les options sont conservées. |
| F5 | `Échap` dans le popover de filtre colonne | Le texte du filtre est vidé et le popover se ferme ; la modale reste ouverte. |

## Annulation et lecture seule (sprint 1)

| # | Scénario | Attendu |
|---|----------|---------|
| A1 | Ouvrir puis Annuler sans rien changer | Fermeture immédiate, sans confirmation. |
| A2 | Cocher un test puis `Échap` (hors popover) / clic sur l'overlay / « Annuler » | Confirmation « Abandonner la sélection ? ». « Continuer » garde la modale ; « Abandonner » la ferme sans rien ajouter. |
| A3 | Double-clic sur une cellule, F2, frappe, clic sur une cellule de lien, clic droit sur une ligne | Rien n'est édité ; aucun popover de lien ni menu contextuel. |
| A4 | Tenter de glisser une ligne ou un en-tête de colonne | Aucun déplacement. |
| A5 | Dans la modale : replier un dossier, figer une colonne de plus, filtrer → fermer → ouvrir la Vue Excel du type | La vue système est inchangée (repli, colonnes figées et filtres d'origine). |
| A6 | Échec de l'ajout (ex. campagne passée `completed` dans un autre onglet) | Erreur affichée dans le pied ; la modale reste ouverte avec la sélection. |

## Création de campagne (sprint 2)

| # | Scénario | Attendu |
|---|----------|---------|
| C1 | `/campaign/new` → « Sélectionner des tests… » | La modale liste **tous** les tests (brouillons compris), comme avant GH33. |
| C2 | Sélectionner 3 tests dont un paramétré, remplir la valeur, valider | La modale se ferme. Le récapitulatif liste les 3 tests, avec la valeur saisie pour le test paramétré. « Créer » produit la campagne avec les mêmes `runs` qu'avant GH33. |
| C3 | « Modifier » | La modale rouvre avec la sélection et les valeurs restituées (étape 1). |
| C4 | Ouvrir, modifier, puis Annuler et confirmer l'abandon | Le récapitulatif est inchangé. |
| C5 | Préremplissage T46 (« Générer une campagne » depuis l'analyse d'impact) avec un test hors du composant/niveau | Tests présélectionnés. Le compteur inclut le test hors filtre dans « non affichés ». Il est bien créé dans la campagne. |
| C6 | Saisir un `baselineRef` puis ouvrir la modale | Prévisualisation des paramètres lue au tag (références résolues ou non résolues affichées à l'étape 2 comme avant). |
| C7 | Créer une campagne sans aucun test | Toujours possible (bouton « Créer » actif, aucun récapitulatif). |

## Cas limites (sprint 2)

| # | Scénario | Attendu |
|---|----------|---------|
| L1 | Repo sans aucun type de test | La modale n'affiche que le message et « Annuler ». |
| L2 | Type sans aucun test proposé | Message vide existant dans la grille ; le combobox de type reste utilisable. |
| L3 | Mode ajout, rien de sélectionné | Bouton principal désactivé. |
| L4 | ~300 tests dans un type | Ouverture fluide (rendu progressif) ; case d'en-tête et compteur réactifs. |
| L5 | Langue EN | Tous les libellés de la modale et du récapitulatif sont en anglais. |

## Non-régression vue système (sprint 2)

| # | Scénario | Attendu |
|---|----------|---------|
| R1 | Vue Excel d'exigences et de tests | Pas de colonne de cases. Édition inline, F2, liens, glisser-déposer, menu contextuel, Ctrl/Maj (T149) et colonnes figées inchangés. |
| R2 | `Échap` dans un popover de filtre colonne de la vue système | Vide le filtre et ferme le popover (inchangé). |
