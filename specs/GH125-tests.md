# GH125 — Scénarios de test

Légende : **[auto-u]** test unitaire (vitest), **[auto-e2e]** e2e web (Playwright), **[manuel]**.

## Nominaux

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| 1 | Ouvrir le dashboard *Campagnes* | Pas de `param-bar` ; chaque widget porte un sélecteur « Campagne » (« Toutes ») | [auto-e2e] |
| 2 | Choisir une campagne terminée sur *Avancement par campagne* | Ce widget se recentre ; *Entrées en échec* reste sur Toutes | [auto-e2e] |
| 3 | Recharger | Le widget retrouve sa valeur ; `.pref` : `suiviWidgetParamValues[dashboard][widget]` | [auto-e2e] |
| 4 | Drill-down sur un widget recentré | Détail limité à la campagne du widget | [auto-e2e] (gh93 adapté) |
| 5 | Deux widgets de la même requête paramétrée | Valeurs et résultats indépendants | [auto-e2e] |
| 6 | Réinitialiser un widget | Icône visible seulement hors défaut ; clic → défaut, icône masquée | [auto-e2e] |
| 7 | Valeur introuvable sur un widget | Avertissement sur ce widget seul, défaut appliqué ; Réinitialiser l'efface | [auto-e2e] |
| 8 | Paramètre obligatoire | « Choisir … » dans la carte, sélecteur dans l'en-tête ; choix → exécution | [auto-e2e] (gh93 adapté) |
| 9 | Impression | Valeurs sous le titre de chaque widget paramétré, pas d'en-tête global | [auto-u] (données) / [manuel] (rendu PDF) |
| 10 | Export docx direct / gabarit | Paragraphes par widget ; `widgets[].parameters` ; `parameters` racine vide | [auto-u] |
| 11 | Vue `/query` | Barre des paramètres de la requête inchangée | [auto-e2e] (gh93 existant) |

## Service et cas limites

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| 12 | `setParamValues` par widget, deux utilisateurs | Valeurs par utilisateur et par widget, nettoyées (clés invalides retirées) | [auto-u] |
| 13 | `null` / valeurs vides | Entrée du widget retirée, puis du dashboard, puis la clé | [auto-u] |
| 14 | Ancienne clé `suiviParamValues` présente | Jamais lue (valeurs au défaut) ; supprimée à la première écriture | [auto-u] |
| 15 | `setScope` privé → partagé → privé | Valeurs de chaque widget suivent le nouvel id | [auto-u] |
| 16 | `deleteWidget` / `delete` | Valeurs du widget / du dashboard retirées | [auto-u] |
| 17 | `remapWidgetQueryId` (promotion d'une requête) | Valeurs du widget conservées | [auto-u] |
| 18 | Valeur d'un `name:kind` non déclaré | Ignorée à l'exécution, conservée au `.pref` lors d'un autre choix | [auto-u] |
| 19 | `differsFromDefault` | Défaut `null` / non `null`, période, introuvable | [auto-u] |
| 20 | Ouvrir une liste de sélecteur sur une carte réordonnable | Pas de glisser déclenché | [manuel] |
| 21 | Dashboard en lecture seule | Sélecteurs utilisables, valeur mémorisée | [auto-u] (service sans garde) |
| 22 | Aperçu de modification d'un widget | Valeurs du widget modifié | [manuel] |
