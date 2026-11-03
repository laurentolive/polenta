# GH204 — Scénarios de test

Numéros des critères : `specs/GH204.md` §9.

## Unitaires (`validation-rows.util`, `validations.service`, `versions.service`, `merge-core`)

| # | Scénario | Critère |
|---|---|---|
| U1 | Schéma : zéro ou deux décisions `isPending`, type hors `root`, deux types : refusés ; défaut : accepté | 1 |
| U2 | Schéma : retirer une décision utilisée, changer nom ou préfixe avec des validations : refusé | 1 |
| U3 | Lignes : exigences terminales et d'un type non déclaré exclues | 2 |
| U4 | Version released : contenu et statut lus au gel ; exigence créée après le gel absente | 3 |
| U5 | Statut de design : jamais incluse, modifiée depuis, incluse deux fois à l'identique (la première), statut changé après le gel | 4 |
| U6 | Décider : `decidedBy`, `decidedAt`, `contentHash` ; revenir à `isPending` retire l'entrée | 5 |
| U7 | Reprise : changée, impactée, `pas_d_impact_reel`, modifiée hors version, sans validation signée de `basedOn`, validation annulée ignorée | 6 |
| U8 | « À revoir » : contenu modifié ; reprise devenue impactée ; confirmer lève le signal ; approuver l'exigence ne le déclenche pas | 7 |
| U9 | Signature refusée pour chaque motif, tous listés ; acceptée : commit, pas de tag, entrées hors périmètre retirées | 8 |
| U10 | Validation signée non modifiable ; annulation possible ; seconde validation refusée, acceptée après annulation | 9 |
| U11 | `propose` : écrit sur une exigence sans décision, refusé sur une décision confirmée et sur une validation fermée ; confirmer et rejeter | 12 |
| U12 | Fusion : deux décisions différentes sans conflit, même exigence en conflit | 13 |
| U13 | Graphe : collection, champs, `designVersion` corrigé | 14 |
| U14 | Composant en lecture seule : toutes les écritures refusées | 16 |
| U15 | Version référencée non supprimable ; version abandonnée : validation en cours non signable | §4 |
| U16 | `runMentions` : même version, dans la structure du produit, autre version, sans `testedConfig`, après signature, a évolué | 10 |

## E2E (`e2e-desktop/gh204-validation.spec.ts`)

| # | Scénario | Critère |
|---|---|---|
| E1 | Créer une validation sur une version released ; une ligne par exigence, statuts affichés | 2, 3 |
| E2 | Décider, déplier tests et exécutions, voir les mentions | 5, 10 |
| E3 | Non conforme : le dialogue s'ouvre, créer l'issue ; elle porte son origine et son lien | 11 |
| E4 | Signer avec une décision en attente : refus détaillé ; tout décider, signer : grille en lecture | 8 |
| E5 | Enregistrer une vue, changer les colonnes, la réappliquer | 15 |
| E6 | `/schema` : ajouter le type validation avec le jeu par défaut | 1 |

## Cas limites à vérifier à la main

- Composant avec plusieurs centaines d'exigences : temps d'ouverture d'une version released (lecture au gel).
- Produit à composants : état des validations des composants dans l'en-tête (Q6), composant en lecture seule (Q4).
- Passage de version en cours à released avec des décisions déjà prises, exigence modifiée entre-temps.
