# 10. Issues et validation

[English](../tutorials/10-issues-validation.md) | **Français**

Une **issue** trace un problème ou une modification que les exigences ne décrivent pas : un bug, une
non-conformité, un constat de test. Une **validation** est la décision de la qualité, exigence par
exigence, sur une version livrée — jusqu'au feu vert final de la version produit.

Ce tutoriel visite les issues et les validations de la démo, puis explique comment déclarer leurs
types sur votre propre projet. Il suit le [tutoriel 9](09-versions.md).

## Les issues

### Les issues de la démo

Vue **Issues** : les mêmes vues tableau et document que pour les exigences, avec la fiche d'édition.

| Issue | Statut | Origine | Impacte | Version |
|---|---|---|---|---|
| ISS-0001 *Résonance du panneau arrière en essorage* | corrigée | échec de TSYS-0004 en EVT | PRD-0004 | LLV-0001 `1.0` |
| ISS-0002 *Détection de balourd : couverture partielle* | en cours | décision *dérogation* de VAL-0001 sur SYS-0004 | SYS-0004 | LLV-0002 `2.0` |
| ISS-0003 *Vitesse d'essorage sous le KPI sur la machine n°4* | ouverte | échec de TSYS-0005 dans CAMP-0003 (1352 tr/min) | PRD-0002 | LLV-0002 `2.0` |
| MISS-0001 *Temps de coupure de l'onduleur trop long* (`comp-moteur`) | ouverte | échec de TMOT-0003 dans CMOT-0001 (14 µs) | MOT-0004 | MOTV-0002 `1.3` |

### Créer et suivre une issue

Une issue se crée de trois façons :

- depuis la vue, comme tout élément ;
- **après une exécution en échec** : Polenta propose *Créer une issue*, *Lier à une issue existante*
  ou *Ignorer* ; l'issue garde l'exécution comme origine ([tutoriel 4](04-tests-campagnes.md)) ;
  l'import d'un classeur Excel d'exécution le propose aussi pour les échecs importés ;
- **depuis une décision de validation** qui le demande (*Décision à tracer*, plus bas) : c'est
  l'origine d'ISS-0002.

Dans la fiche, la rubrique de lien **impacte** relie l'issue aux exigences qu'elle touche, dans le
même composant. Ces exigences deviennent des points de départ de l'analyse d'impact quand l'issue
entre dans une version : une issue s'inclut dans une version comme une exigence ou un test, par le
backlog. Une issue n'a pas de verrou d'approbation : elle reste modifiable.

Les issues sont stockées dans `issues/<ID>.yaml`.

## La validation d'une version

### Les validations de la démo

Vue **Validation** : le panneau liste les versions du dépôt et l'état de leur validation.

- **VAL-0001** *Validation 1.0*, sur LLV-0001 : signée par Marc Dubois. Toutes les exigences sont
  *conforme*, sauf PRD-0010 et SYS-0013 (*hors scope* : le pilotage à distance arrive en 2.0) et
  SYS-0004 (*dérogation* : couverture partielle acceptée, endurance reportée).
- **VMOT-0001** *Validation 1.2.4*, dans `comp-moteur`, sur MOTV-0001 : signée. MOT-0004 est en
  *dérogation* (coupure à 14 µs), MOT-0007 *hors scope*.
- **VAL-0002** *Validation 2.0*, sur LLV-0002 : en cours. Les décisions de la 1.0 sont reprises,
  sauf pour les exigences impactées par la 2.0 (PRD-0002, SYS-0002, SYS-0004), qui sont *en
  attente*, comme PRD-0010, désormais dans le périmètre. SYS-0013 porte une décision proposée, à
  confirmer. PRD-0006, modifiée après sa décision, est *à revoir*.

Les décisions possibles sont celles du type : *en attente*, *conforme*, *non conforme*, *hors
scope*, *dérogation*. *Non conforme* et *dérogation* proposent de créer une issue.

### Créer la validation

Sur une version du panneau, **Créer la validation**, donner un titre (*Validation 1.0* par défaut).
Une version a au plus une validation en cours ou signée. Les décisions de la validation signée de
la version précédente sont **reprises** pour les exigences ni changées ni impactées depuis ; les
autres partent *en attente*.

### Décider, exigence par exigence

La page de la validation présente une ligne par exigence du composant :

- ses statuts **Rédaction**, **Design**, **Vérification** et la colonne **Impact** (*changée*,
  *impactée*) ;
- sous chaque exigence, ses tests et leurs exécutions, avec la version testée (*autre version*
  signale une exécution faite sur une autre version que celle validée) ;
- la **Décision** et un **Commentaire**.

En tête, **Validations des composants** rappelle la validation de chaque composant embarqué : celle
de VAL-0001 cite VMOT-0001.

Le filtre réduit la liste : *À décider*, *Proposées*, *À revoir*, *Changées ou impactées*. Une
décision devient *À revoir* si l'exigence est modifiée ou devient impactée après coup. Une décision
proposée (*Proposée par …*), par un agent IA par exemple, attend un **Confirmer** ou un **Rejeter**
humain. Une décision qui le demande ouvre la proposition d'issue (*Décision à tracer*).

### Signer

**Signer** n'est possible que sur une version **released**, et quand plus aucune décision n'est en
attente, proposée ou à revoir, et que les champs obligatoires sont remplis ; sinon Polenta liste ce
qui manque (*Signature impossible pour le moment : …*).

À la signature, Polenta fige pour chaque exigence ce que le signataire a vu : rédaction, design,
vérification, impact, tests et exécutions. Un lien retiré ou une exécution ajoutée plus tard ne
change plus la validation signée. La signature enregistre le seul fichier de la validation, sans tag
ni baseline. **Annuler la validation** permet de repartir d'une nouvelle validation.

La décision de la dernière validation signée apparaît dans la colonne **Validation** des vues
Exigences, avec le label de la version : *Conforme (1.0)* pour PRD-0001. La vue d'équipe *Suivi de
conformité* l'affiche à côté des autres statuts. Signée sur la version du **produit**, c'est le feu
vert final, par exemple le go production série.

Les validations sont stockées dans `validations/<ID>.yaml`.

> **Sur votre projet**
>
> Un dépôt a au plus un type de validation : celui de la démo existe déjà, comme son type d'issue. Sur
> votre projet, dans *Projet › Modèle de données › Structure*, sur la ligne du dépôt : **+** puis
> **+ Issue**, ou **+** puis **+ Validation**. Le type d'issue a ses champs (gravité,
> description…) et ses statuts, et accepte les contraintes de transition
> ([tutoriel 3](03-exigences.md#les-règles-du-type)). Le type de validation définit les décisions
> possibles ; une décision peut être marquée pour proposer la création d'une issue.

## Exercices

**Lire une issue née d'un échec.**
1. Ouvrir ISS-0003 : rubriques *Origine* et *impacte*.
2. Ouvrir LLV-0002, **Analyse d'impact**.

Résultat : l'origine est l'exécution en échec de TSYS-0005 dans CAMP-0003 ; l'issue impacte
PRD-0002. Dans LLV-0002, PRD-0002 est un point de départ de l'analyse, *via ISS-0003*.

**Créer une issue depuis un échec.**
1. Mettre en échec TSYS-0008 dans CAMP-0002 ([tutoriel 4](04-tests-campagnes.md#exercices)), puis
   **Créer une issue**.
2. Dans la fiche (ISS-0004 sur une démo neuve), rubrique *impacte* : ajouter SYS-0004.
3. **Backlog des changements** : inclure ISS-0004 dans LLV-0002.

Résultat : l'issue garde l'exécution comme origine, impacte SYS-0004 et figure dans les
**Changements** de LLV-0002.

**Décider dans VAL-0002.**
1. Ouvrir VAL-0002, filtre *Proposées* : **Confirmer** la décision de SYS-0013.
2. Filtre *À décider* : décider PRD-0010 *conforme*.
3. Filtre *À revoir* : reprendre PRD-0006, avec une décision et un commentaire.

Résultat : les compteurs baissent à chaque étape. Il reste trois exigences en attente : PRD-0002,
SYS-0002 et SYS-0004, impactées par la 2.0.

**Tenter de signer.**
1. Ouvrir VAL-0002, **Signer**.
2. Ouvrir VAL-0001 et tenter de changer la décision de PRD-0001.

Résultat : la signature de VAL-0002 est refusée (code `SIGNATURE_REFUSED`) : *La version n'est pas
released*, *Décisions en attente*. VAL-0001 est figée : ses décisions ne se modifient plus (code
`VALIDATION_LOCKED`), et chaque ligne montre ce qui a été vu à la signature.

**Voir le reflet d'une validation.**
1. Exigences produit, vue *Suivi de conformité*.
2. Modifier l'énoncé de PRD-0001.

Résultat : la colonne *Validation* affiche *Conforme (1.0)* pour PRD-0001, *Hors scope (1.0)* pour
PRD-0010. Après la modification, PRD-0001 est signalée comme ayant évolué depuis la décision.

**Lire la validation d'un composant.**
1. Ouvrir VAL-0001, en-tête **Validations des composants**.

Résultat : VMOT-0001 *Validation 1.2.4* y figure, signée, pour le moteur `1.2.4` embarqué dans la
`1.0`.
