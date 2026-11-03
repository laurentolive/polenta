# GH203 — Scénarios de test

## Unitaires

`main/services/saved-views.service.test.ts` :

- création, mise à jour, renommage, suppression dans chaque portée ; `.pref` : `excel` et `picker` voisins conservés ;
- nom vide, trop long, doublon (casse et espaces de bord ignorés) ; même nom accepté dans l'autre portée ;
- suppression de la dernière vue d'équipe : fichier retiré ;
- `typeKey` avec `..` ou séparateur : refus, rien d'écrit hors de `.polenta/views/` ;
- fichier illisible ou `version` inconnue : `teamError`, écriture refusée, fichier inchangé ;
- composant en lecture seule : `teamReadonly`, écriture d'équipe `READONLY_REPO`, personnelle acceptée ;
- renommage de champ (échange compris) sur `excel`, `word`, `popup`, autres clés intactes ; renommage et suppression de type, de nœud.

`renderer/components/system/savedViewSettings.test.ts` : comparaison (ordre, défauts, clé absente), patch d'application.

## E2E (`e2e-web/gh203-saved-views.spec.ts`)

| # | Scénario | Critère |
|---|---|---|
| 1 | Enregistrer sous… Personnelle : vue dans la liste, rien dans le statut git | 1 |
| 2 | Deux vues : aller-retour restitue colonnes, ordre, Document, Popup, dossiers, colonnes figées | 2 |
| 3 | Cocher une colonne : « modifiée », fichier inchangé ; Enregistrer ; retour manuel à l'état de la vue | 3 |
| 4 | Enregistrer sous… Équipe : fichier créé, présent dans le statut git | 4 |
| 5 | Fichier d'équipe modifié sur disque : écran inchangé, « modifiée », resélection applique | 5 |
| 6 | Renommer, Supprimer dans les deux portées ; doublon refusé | 6 |
| 7 | Colonnes par défaut : colonnes du schéma, sans vue active, vues gardées | 7 |
| 8 | `picker` et dossiers repliés intacts après application | 8 |
| 9 | Colonne invalide dans le fichier : ignorée, fichier intact | 9 |
| 10 | Fichier illisible : avertissement, vue utilisable, fichier intact | 11 |
| 11 | Vue active supprimée sur disque : oubliée sans message, réglages gardés | spec §3 |
| 12 | Type issue : scénarios 1 et 4 | 13 |
| 13 | Type campagne : pas de liste | 14 |

Suite e2e-web = client web : le critère 13 est couvert par exécution. Le critère 10 (lecture seule) et le
critère 12 (renommages) sont couverts en unitaire.

## À la main

- Publication réelle d'une vue d'équipe vers un second utilisateur (critère 4, fin du scénario).
- Confort de la liste dans la barre d'outils, sur un projet réel.
