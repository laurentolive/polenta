# GH365 — Scénarios de test

## Unitaires (`objectTypeEditor.gh365.test.ts`)
- U-1 `typeNamingRoot` : label préféré ; label vide ou sans caractère latin → nom.
- U-2 Slug : `Contrôle moteur v2.1` → `CONTROLE_MOTEUR_V2_1` ; `Œil — capteur` → `OEIL_CAPTEUR` ;
  `  Ça  va  ` → `CA_VA`.
- U-3 `defaultObjectTypes` : 6 catégories, racine `Contrôle moteur` → 6 noms = préfixes
  `CONTROLE_MOTEUR_{REQ,TEST,CAMP,ISS,VER,VAL}`, dans l'ordre, statuts / décisions par défaut.
- U-4 Collision : préfixes pris `MOTEUR_REQ` → `MOTEUR_REQ_2`, les autres inchangés.

## E2E web (`e2e-web/gh365-default-types.spec.ts`, démo)
- E-1 Ajout d'un composant local « Contrôle moteur » : 4 cases visibles et cochées (pas de
  Versions / Validations), décocher puis recocher « Composant local » fait apparaître / disparaître
  les deux cases ; après ajout, `schema.yaml` porte 4 types `CONTROLE_MOTEUR_{REQ,TEST,CAMP,ISS}`.
- E-2 Sur ce composant, « + Exigence » propose `CONTROLE_MOTEUR_REQ_2`.
- E-3 Second composant local de même label « Contrôle moteur » (autre nom) : `CONTROLE_MOTEUR_REQ_2`… sans erreur.

## Manuel
- M-1 Ajout d'un composant en repo séparé neuf (forge ou URL d'un repo vide), label « Contrôle
  moteur », toutes cases cochées : 6 types sur son `root` + type de lien `issue-impact`.
- M-2 Même ajout avec label vide : racine = nom de montage.
- M-3 « + Exigence » sur la ligne d'un repo : racine = label du repo.
