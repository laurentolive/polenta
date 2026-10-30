# GH195 — Scénarios de test

Légende : **[U]** unitaire, **[E]** e2e web, **[M]** manuel.

## Nominal
1. [U] `parseLinkLine` : `RE-118 | https://a/b` → `{label, url}` ; `https://a/b` → `{url}` ; `a | b | https://x` → label `a | b`.
2. [U] `isAcceptedLinkUrl` : http, https, `file:///C:/x`, `\\srv\part\x y.pdf` acceptés ; `C:\x`, `javascript:`, `mailto:`, texte refusés.
3. [U] `prepareFieldsWrite` : champ `link` saisi en texte multi-lignes → liste d'objets (`multiple`) / objet (simple).
4. [U] `requiredWhen: {status:[approved]}` : transition vers approved sans le champ → refus avec message nommant le champ ; avec le champ → ok.
5. [U] `requiredWhen` sur `multi_enum` (intersection) et `boolean`.
6. [U] persist exigence / test / campagne refuse une URL invalide (`FieldWriteError`), n'écrit rien.
7. [U] MCP `bulk_import` dryRun : `report: "RE | https://x"` converti ; URL invalide → erreur.
8. [U] `readLinkCell` sur fixture Excel : hyperlien natif, URL auto-convertie, `=HYPERLINK`, `=LIEN_HYPERTEXTE` (stocké `HYPERLINK`), URL brute, `libellé | URL`, multi-lignes, hyperlien + lignes, ligne sans URL → erreur.
9. [U] `writeLinkCell` : lien unique = hyperlien natif ; plusieurs = premier hyperlien + texte ; relu par `readLinkCell` à l'identique.
10. [U] export docx : un `ExternalHyperlink` par lien.
11. [E] Ajouter un champ `link` multiple à un type dans l'éditeur de schéma, saisir deux liens dans la vue Édition, recharger : liens affichés.
12. [E] Saisir `C:\docs\a.pdf` : ligne en erreur, bouton Enregistrer refusé / message.
13. [E] `requiredWhen` sur statut : astérisque apparaît quand on choisit le statut, refus de transition sans la valeur.
14. [U] Collage `text/html` contenant deux `<a href>` → deux liens ; `href` `javascript:` ignoré.

## Cas limites
15. [U] Objet ancien approuvé sans justification : modification du titre acceptée (Q2).
16. [U] Liste sur champ non `multiple` non touchée : pas de réécriture ; touchée avec deux liens → refus « un seul lien ».
17. [U] `requiredWhenIssues` : auto-référence / liste vide / référence `text` = erreur ; champ absent / valeur inconnue = avertissement ; `schema:save` ne refuse que les erreurs.
18. [U] Historique : `trackHistory` sur `link`, chaîne et objet équivalents → pas d'entrée parasite.
19. [U] Fusion GH37 : `requiredWhen` non satisfait → avertissement `requiredEmpty`.
20. [U] Écriture `raw` (renommage de champ) : aucune normalisation.

## Manuel (non automatisable)
21. [M] Desktop : clic sur `https://` ouvre le navigateur ; clic sur `\\srv\…` et `file://` → confirmation puis ouverture.
22. [M] Copier un lien hypertexte depuis Word et depuis Excel, le coller dans un champ lien.
23. [M] Export xlsx / docx ouverts dans Excel / Word : hyperliens cliquables.
24. [M] Client web : lien UNC → bouton « Copier ».
