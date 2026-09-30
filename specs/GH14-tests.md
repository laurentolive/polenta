# GH14 — Scénarios de test

> Spec : [GH14.md](GH14.md) · Design : [GH14-design.md](GH14-design.md)

Pas de tests unitaires renderer dans le projet (pas de script `test` dans
`apps/desktop`) : la vérification se fait par typecheck et par tests manuels dans l'app.

## Scénarios nominaux

| # | Étapes | Résultat attendu |
|---|---|---|
| N1 | Vider la clé `polenta:suiviCollapsed`, puis ouvrir l'activité Suivi. | En-tête « Suivi » sans icônes. Sections Dashboards (en haut) et Requêtes toutes deux dépliées, chacune sur environ la moitié de la hauteur. |
| N2 | Cliquer sur l'en-tête « Requêtes ». | Chevron → `ChevronRight`. Le filtre et la liste Requêtes disparaissent. Dashboards occupe toute la hauteur restante, et l'en-tête Requêtes reste visible juste en dessous. |
| N3 | Cliquer à nouveau sur l'en-tête « Requêtes ». | La section se déplie et le partage revient à 50/50. |
| N4 | Replier Dashboards, puis redémarrer l'app (ou changer de projet). | Dashboards est toujours repliée. |
| N5 | Clic sur un dashboard ou sur une requête dans le panneau. | Navigation vers `/dashboard` ou `/query` avec l'élément surligné, comme avant. |
| N6 | Ouvrir la vue Requêtes. | Plus de carte « Requêtes sauvegardées ». La carte Historique occupe toute la largeur sous le résultat. |
| N7 | Exécuter une requête, puis la sauvegarder (titre + portée). | Elle apparaît immédiatement dans la section Requêtes du panneau et y est surlignée. Le titre de l'onglet reprend son nom. |
| N8 | Historique : filtrer, supprimer une entrée (✕), cliquer une entrée. | Fonctionnement identique à avant GH14. |

| S1 | Deux sections dépliées : glisser le séparateur vers le bas. | Dashboards grandit, Requêtes rétrécit. Le curseur `row-resize` est gardé pendant tout le glissement. |
| S2 | Glisser le séparateur jusqu'en haut ou en bas. | Blocage à 140 px minimum pour chaque section, sans chevauchement de contenu. |
| S3 | Double-clic sur le séparateur. | Retour à 50/50. |
| S4 | Redimensionner, puis redémarrer l'app. | Le ratio est restauré. |
| S5 | Replier une des deux sections. | Le séparateur disparaît et la section dépliée prend toute la hauteur. Au redépli, le ratio mémorisé est réappliqué. |

## Cas limites

| # | Situation | Résultat attendu |
|---|---|---|
| L1 | Section Requêtes repliée, puis ouverture d'une requête **sauvegardée** par l'URL, ou sauvegarde d'une nouvelle requête. | La section Requêtes se déplie automatiquement et l'élément est surligné. |
| L1b | Section Requêtes repliée, puis clic sur une entrée de l'**historique** (id d'historique, pas une requête sauvegardée). | La section reste repliée : il n'y a rien à surligner, et le choix de l'utilisateur est préservé (revue de code sprint 1). |
| L2 | Section Dashboards repliée, puis suppression du dashboard actif ailleurs (redirection vers le premier restant). | La section Dashboards se déplie sur le nouveau dashboard actif. |
| L3 | Clic sur « + » d'une section repliée. | Dashboards → modale « Nouveau dashboard ». Requêtes → vue Requêtes vide. La section se déplie ensuite dès que l'élément créé devient actif. |
| L4 | Les deux sections sont repliées. | Les deux en-têtes restent en haut du panneau, et le reste est vide. Pas d'erreur. |
| L5 | Liste vide (aucun dashboard ou aucune requête). | L'état vide avec le lien « Créer le premier… » s'affiche dans la section dépliée. |
| L6 | Liste longue (> hauteur disponible) avec les deux sections dépliées. | Défilement interne à chaque section, et les deux en-têtes restent visibles. |
| L7 | Supprimer, depuis le panneau, une requête utilisée par un widget. | Message d'erreur dans la section Requêtes, et la requête n'est pas supprimée. |
| L8 | `localStorage['polenta:suiviCollapsed']` contient une valeur invalide (`"xx"`). | Pas de crash : les deux sections sont dépliées par défaut. |
| L9 | Filtre saisi dans une section, puis repli et dépli. | Le filtre est conservé. |
| L10 | Glisser-déposer pour réordonner dans chaque section. | L'ordre est persisté, comme avant. |

## Critères vérifiables

- `pnpm --filter desktop typecheck` (ou `tsc --noEmit -p apps/desktop/tsconfig.json`) : zéro
  erreur nouvelle.
- `grep` : plus aucune occurrence de `activeTab`, `dashboardsTab` ou `fillHeight` dans
  `renderer/`, et plus aucune occurrence de `savedQueriesCount`, `noSavedQuery` ou
  `deleteQueryConfirm` dans `renderer/` (code et locales).
