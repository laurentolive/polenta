# Milestone D — point global de spec après les lots 1 à 5 (2026-10-30)

> Relecture des épiques #191 (conformité) et #193 (changement) au regard de ce qui est livré
> (lots 1 à 5, PR #215) et des décisions prises en cours de route (avenants GH199 §8bis, §8ter,
> échanges du 2026-10-30 sur #200). Objet : vérifier que les lots restants (6 à 16, PR #240)
> servent encore les fonctions globales, et lister les amendements à apporter aux specs et aux
> issues **avant** de reprendre le développement.
>
> Ce document ne remplace pas `specs/GH191.md` / `specs/GH193.md` : une fois validé, ses décisions
> y sont reportées (§6) et il reste comme trace.

## 1. Les fonctions globales visées

Le milestone sert une chaîne unique, du constat à la preuve :

1. **Prouver** : chaque exécution de test est un fait daté, complet (champs, configuration testée),
   consultable par exigence et par test (#191 phase 1).
2. **Statuer** : à chaque jalon, la qualité statue objet par objet à partir de ces preuves, signe,
   et le registre est figé par une baseline (#191 phases 4–5).
3. **Faire évoluer sous contrôle** : toute modification d'une exigence ou d'un test se fait dans
   un **changeset** qui dit pourquoi, ce qui est touché, ce qui doit être revérifié (#193).
4. **Boucler** : une non-conformité ouvre un changeset, qui produit une version de composant et une
   campagne de vérification, dont les exécutions alimentent la revue suivante (#193 L6–L8).

La **conformité future** (point 2) a besoin que le point 3 soit **complet** : un auditeur doit
pouvoir répondre, pour toute exigence ou tout test, « quel changeset l'a créé ou modifié, quelle
était la version avant, quelle est la version approuvée ». C'est ce qui motive la décision du §3.

## 2. Ce qui est livré (lots 1 à 5)

| Lot | Issue | Livré | Écart avec le cadrage initial |
|---|---|---|---|
| 1 | #195 | champ `link`, `requiredWhen` | — (suite : #214, migration au renommage) |
| 2 | #196 | `runFields` / `stepFields`, classeur Excel | — |
| 3 | #197 | grille d'historique des exécutions (onglets test / exigence) | — |
| 4 | #198 | objet change, vue, création `request`, listes manuelles, composant | renommé **changeset** (GH199 §8ter) |
| 5 | #199 | analyse d'impact dans le changeset (live / figée), mode `range` (baselines et commits), retrait du flux élément unique et des analyses entre baselines, vue Analyse d'impact fondue dans la vue Changesets | listes vides = **pas d'analyse** (le repli « tout le composant » est retiré) ; `impact-analyses/` **ignorés** (pas de lecture ni de conversion) ; **backlog** par composant et **assignation** des éléments, dialogue à l'approbation (§8bis) |

**Ce que §8bis a changé dans le modèle.** GH193 §2 pensait le rattachement **par commit** (ligne
`Change:`, change actif, change implicite). Le backlog et l'assignation l'ont déplacé **vers
l'élément** : un élément à traiter est rangé dans `toModify` d'un changeset ouvert ; à
l'approbation d'un élément non assigné, l'interface propose de l'assigner. Les deux approches font
doublon (deux « paniers à qualifier », deux moments de choix) : c'est l'origine du malaise sur la
première spec de #200.

**Constat dans le code** : le verrou d'un élément approuvé n'est pas uniforme. La vue Word
verrouille l'édition d'un élément au statut `isApproval` (« Rouvrir en brouillon », version + 1) ;
la vue Excel et les éditeurs ne semblent pas le faire (`canEdit` ne dépend pas du statut —
à confirmer au design de #200). Une modification d'un élément approuvé peut donc aujourd'hui
échapper à la réouverture, donc au backlog.

## 3. Décision du 2026-10-30 : tout passe par un changeset, au niveau de l'élément

Remplace GH193 §2.2–§2.4 et la première spec de #200.

1. **Toute modification d'une exigence ou d'un test se fait dans un changeset**, y compris la
   création et le travail sur un premier brouillon (abandon de la distinction « officiel / jamais
   approuvé » et de la préférence `officialOnly`).
2. **Moment de l'assignation** : quand l'élément **devient modifiable** — à sa **création** et à
   sa **réouverture** (approuvé → brouillon). Il est alors ajouté à `toModify` d'un changeset ouvert
   de son repo :
   - un seul changeset ouvert éligible → assignation **automatique** (signalée) ;
   - plusieurs → l'utilisateur **choisit** ;
   - aucun → créer un changeset (formulaire pré-rempli) ; annuler annule la création / réouverture.
3. **Un élément approuvé n'est pas modifiable** sans réouverture, dans **toutes** les vues
   (Word, Excel, éditeurs, tableaux, MCP) : c'est ce qui garantit le point 2.
4. **Trace par élément** dans le changeset : la version **de départ** (commit de l'état approuvé
   avant réouverture, ou « création ») et le commit d'**approbation** ; **diff** entre les deux
   proposé au client (rendu générique GH222).
5. **Plus de change actif, plus de ligne `Change:`, plus de change implicite, plus de choix à
   Publier** : le rattachement est porté par `toModify`, Publier reste inchangé.
6. **Modifications hors interface** (git direct sur un élément approuvé, sans réouverture) :
   **signalées** seulement — l'élément apparaît dans le backlog marqué « modifié hors interface ».
7. **Le backlog reste**, mais devient un **filet** : éléments à traiter non assignés (antérieurs à
   la règle, hors interface, retirés d'un changeset), pas le circuit normal.
8. Le dialogue à l'approbation d'un élément non assigné (§8bis) reste pour ces cas de filet.

## 4. Revue des lots restants

Légende : ✅ pertinent tel quel · ✏️ à amender · 🔀 à fusionner / redécouper.

| Lot | Issue | Fonction servie | Verdict | Amendement |
|---|---|---|---|---|
| 6 | #200 Rattachement | Faire évoluer sous contrôle | ✏️ **réécrit** | nouveau périmètre = §3 : assignation à la création / réouverture, verrou uniforme de l'approuvé, trace départ / approbation + diff, signalement hors interface, préférence d'activation. Retirés : change actif, `Change:`, implicite, choix à Publier, régularisation de commits |
| 7 | #201 Versions, configurations | Boucler (quelle version livre quoi), Prouver (sur quoi on a testé) | ✅ | `integratedIn` inchangé. Le contenu livré par une version se lit désormais **par élément** (trace départ / approbation des changesets intégrés), plus par commits rattachés |
| 8 | #202 Configuration testée | Prouver | ✅ | — |
| 9 | #203 Vues enregistrées ⚙️ | confort transverse | ✅ | générique, indépendant du changeset ; peut glisser en fin de milestone si on veut avancer la boucle |
| 10 | #204 Revue de conformité | Statuer | ✏️ léger | E6/E8 : « objets modifiés depuis le jalon précédent » = changesets clos entre les deux revues (trace par élément) ; « modifié depuis la décision » (`objectVersion`) affiche le changeset qui l'a modifié |
| 11 | #205 Vue Conformité | Statuer | ✅ | « Créer un change » → « Créer un changeset » (libellé, lot 15) |
| 12 | #206 Contraintes de transition | Faire évoluer sous contrôle | ✏️ | `assignedToChange` reste une condition **disponible**, mais n'est **plus ajoutée par défaut** : l'assignation est garantie à la création / réouverture (§3.2). Le MCP applique la règle §3 indépendamment des transitions |
| 13 | #207 Campagnes du changeset | Boucler | ✅ | `modifiedApproved` se lit sur la trace par élément (commit d'approbation présent pour chaque `toModify`) |
| 14 | #208 Multi-repo | Faire évoluer (produit multi-composants) | ✏️ | à la réouverture d'un élément d'un repo sans changeset ouvert alors qu'un changeset pilote existe ailleurs : proposer **« Étendre NC-0004 à ce composant »** en premier (remplace le cas « choix à Publier » de GH193 §11) |
| 15 | #209 Intégration conformité ↔ changeset | Boucler | ✅ | — |
| 16 | #210 Reflets des décisions | Statuer | ✅ | — |
| — | #214 `requiredWhen` au renommage | correctif #195 | ✅ | indépendant, petit : à traiter quand un créneau se présente |

**Ordre.** L'ordre du milestone reste valable. Le lot 6 réécrit est un **prérequis** de la
conformité future (§1) et doit rester en tête. Option : avancer #207 (campagnes) juste après #200
pour boucler tôt le cycle changeset → campagne → preuve, avant la configuration (#201, #202).

## 5. Ce qui ne bouge pas

- Objet changeset, listes, analyse d'impact live / figée, mode `range`, backlog (lots 4–5).
- Revue de conformité, décisions, preuves, signature et gel par baseline (#191 §3).
- Principe GH79 : aucune métrique de suivi des changesets dans Polenta (délais, volumes) — côté
  projet via le graphe.
- Contraintes de transition toujours facultatives et retirables (GH193 décision 10).

## 6. Amendements à reporter après validation

- `specs/GH193.md` : §2.2–§2.4 remplacés par le §3 ci-dessus ; §0 et §10 (relation « Commit
  rattaché à » → « Élément : version de départ / d'approbation ») ; §7.2 (`assignedToChange` non
  par défaut) ; §11 (cas limites : choix à Publier, change actif clos → retirés ; réouverture dans
  un repo sans changeset → #208) ; §12 (L4 réécrit) ; §15 Q1 / Q2 caduques.
- `specs/MODELE-OBJETS.md` : relation « Commit rattaché à Changeset » remplacée ; « Change » →
  « Changeset ».
- `specs/GH200.md` : réécrit (la version du 2026-10-30 matin est remplacée).
- `specs/GH199.md` §8bis : backlog = filet ; renvoi à #200 mis à jour.
- Issues : #200 (périmètre), #206 (`assignedToChange` non par défaut), #208 (« Étendre » à la
  réouverture), #204 (E6/E8), #201 (contenu livré par élément).

## 7. Questions

| # | Question | Proposition |
|---|---|---|
| P1 | La règle §3 est-elle **désactivable** par projet ? | oui, préférence `changeTracking: on | off` (défaut `on` dès qu'un type changeset existe dans le repo ; sans type, rien n'est exigé) |
| P2 | Création **en masse** (import, MCP `bulk-import`, duplication) | même règle : un changeset choisi pour tout le lot ; le MCP exige un `changesetId` à la création / réouverture, ou range l'élément dans le backlog |
| P3 | Élément réouvert puis réapprouvé **plusieurs fois** dans le même changeset | une seule ligne : départ = premier état approuvé, approbation = dernière ; les cycles intermédiaires restent dans l'historique GH77 |
| P4 | Élément rouvert alors qu'il est déjà dans `toModify` d'un changeset ouvert | reste dans ce changeset, sans question |
| P5 | Statut `isTerminal` (obsolète) depuis l'approuvé | c'est une modification : passe par un changeset (trace départ / « rendu obsolète ») |
| P6 | Ordre : avancer #207 juste après #200 ? | oui (boucle complète plus tôt) — à confirmer |

## Refs

`specs/GH191.md`, `specs/GH193.md`, `specs/GH198.md`, `specs/GH199.md` (§8bis, §8ter),
`specs/GH200.md` (version du 2026-10-30 matin), `specs/MODELE-OBJETS.md` ; issues #200–#210, #214.
