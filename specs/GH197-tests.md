# GH197 — Scénarios de test

**[U]** unitaire, **[E]** e2e web, **[M]** manuel.

1. [U] test exécuté dans deux campagnes + exécution isolée : 3 lignes, campagne / entrée renseignées, date décroissante.
2. [U] entrée `pending` d'une campagne ouverte : ligne « en attente » en tête ; pending d'une campagne clôturée : absente.
3. [U] entrée retirée après exécution : ligne `removed`.
4. [U] exigence : test itérant (runs avec `requirementId` A et B) + test simple : pour A, seuls les runs de A et tous ceux du test simple.
5. [U] run rattaché à une campagne supprimée : `campaignMissing`.
6. [U] `runFieldDefs` : champs d'exécution des types présents.
7. [E] section « Exécutions » d'un test dans la vue Édition : lignes, ⚙️ ajoute une colonne de champ d'exécution, dépliage des étapes.
8. [E] section « Exécutions » d'une exigence couverte : lignes du test lié.
9. [M] ID d'une ligne : campagne ouverte → page d'exécution ; clôturée → consultation.
10. [M] préférence de colonnes retrouvée à la réouverture ; Réinitialiser.
