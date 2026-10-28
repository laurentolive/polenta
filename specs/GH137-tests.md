# GH137 — Scénarios de test

Automatique : `renderer/components/system/linkColumns.gh137.test.ts` (critères 1, 4, 5 et
compatibilité). Manuel (desktop) : critères 2, 3, 6.

1. Schéma `raffinement` (sources EF, ET ; cibles EM, EF) : « Champs visibles » des EF propose
   « raffine » et « est raffinée par ».
2. Les deux cochées : EF-0002 affiche `EM-0002` sous « raffine », `ET-0001` sous « est raffinée par »,
   aucune cellule ne contient `|`.
3. Filtre de colonne `ET-` sur « est raffinée par » : EF-0002 gardée ; sur « raffine » : non.
4. EM (cible seulement) et ET (source seulement) : une seule case, titre et contenu inchangés.
5. Préférence existante `link::raffinement` pour les EF : les deux colonnes s'affichent.
6. Popover depuis « est raffinée par » : ajouter ET-0002 crée `ET-0002 → EF-0002`, affiché dans
   cette colonne.
7. Onglet Document : une case `raffinement` comme avant ; export Excel/Word sans colonne de lien.
