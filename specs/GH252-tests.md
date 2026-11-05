# GH252 — Scénarios de test

| # | Scénario | Attendu | Couverture |
|---|---|---|---|
| U1 | Panneau Version, sous-panneau Produit | composant, backlog et versions chargés, aucun 404 | e2e web |
| U2 | Créer une version, inclure, ouvrir la page | changement listé | e2e web |
| U3 | Analyse d'impact, statut saisi | statut enregistré | e2e web, ou IPC si l'écran demande un élément impacté |
| U4 | Passage released | commit et tag ; « Tag … pas encore poussé » | e2e web |
| U5 | Push | tag sur la forge, mention retirée | e2e web |
| U6 | Validation : créer, décider, signer | signée, auteur = compte de la session | e2e web |
| U7 | Décision « non conforme » | popup d'issue, issue liée à la décision | e2e web |
| U8 | Label de version, colonne Design | ouvre la page | e2e web |
| U9 | Chemin hors de l'espace de l'utilisateur | refus sur tous les canaux à racine | unitaire |
| C1 | Les 27 canaux | exposés, plus aucun dans `WEB_HIDDEN` | unitaire |
| C2 | e2e desktop `gh204`, `gh210` | toujours verts | e2e desktop |
