# 6. Suivi et recherche

[English](../tutorials/06-tracking.md) | **Français**

La vue **Suivi** répond aux questions de pilotage : où en sont les exigences, qu'est-ce qui n'est
pas testé, qu'est-ce qui a échoué. Elle repose sur des **requêtes** sur l'ensemble du projet,
affichées dans des **dashboards**.

## Les dashboards

Vue **Suivi**, dashboard *Pilotage LL800* :

![Dashboard de pilotage](../img/dashboard.png)

- Chaque **widget** affiche le résultat d'une requête : barres (ici empilées par statut), secteurs,
  courbe, tableau ou chiffre clé (*À revalider* : 4).
- **Ajouter un widget** en ajoute un ; le crayon d'un widget le modifie.
- **Privé** / **Partagé** : un dashboard partagé est enregistré dans le dépôt et visible de toute
  l'équipe ; un dashboard privé reste à son auteur.
- **Exporter** produit une version Word ou PDF du dashboard.

Le second dashboard, *Composants & traçabilité*, suit la couverture composant par composant.

## Les requêtes

Le bas du panneau latéral liste les requêtes partagées. Ouvrir *Exigences — statut de couverture* :

![Requête SQL sur les exigences](../img/query.png)

Une requête se construit de deux façons :

- **Builder** : choix de la table, des filtres et des regroupements, sans écrire de SQL ;
- **SQL avancé** : une requête `SELECT` sur les tables `requirements`, `tests` et `links`, en
  lecture seule.

**Exécuter** affiche le résultat, **Sauvegarder** l'enregistre, l'historique garde les dernières
requêtes lancées ; **Exporter** produit un fichier Excel ou PDF. Exemples :

```sql
-- Exigences approuvées sans test
SELECT id, title FROM requirements
WHERE status = 'approved' AND coverageStatus = 'not_covered'

-- Exigences qui ne sont pas « mûres », avec la raison
SELECT id, title, maturityMissingCriteria FROM requirements
WHERE maturityOk = false
```

La **maturité** regroupe les règles de rédaction : champs obligatoires remplis, énoncé EARS,
critère d'acceptance mesurable, lien de vérification pour une exigence approuvée, aucun impact en
attente. PRD-0012 y apparaît avec le motif `EARS`.

## La recherche

Vue **Recherche** : un texte, ou une expression régulière, cherché dans tous les dépôts du projet.

![Recherche de « essorage »](../img/search.png)

- **Aa** respecte la casse, **ab|** cherche le mot entier, **.\*** active les expressions
  régulières ; les cases limitent la recherche aux exigences, aux tests ou aux campagnes.
- À gauche, chaque occurrence avec son champ ; à droite, les éléments trouvés en entier.
- La flèche à gauche du champ ouvre le **remplacement**, sur tout le projet.

Exemple : `\{[a-z_]+\}` en expression régulière trouve toutes les références de paramètres.
