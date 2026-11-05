# 10. Issues et validation

[English](../tutorials/10-issues-validation.md) | **Français**

Une **issue** trace un problème ou une modification que les exigences ne décrivent pas : un bug, une
non-conformité, un constat de test. Une **validation** est la décision de la qualité, exigence par
exigence, sur une version livrée — jusqu'au feu vert final de la version produit.

Comme les versions, ni les issues ni les validations ne sont déclarées dans la démo : ajouter les
types comme indiqué ci-dessous, après avoir suivi le [tutoriel 9](09-versions.md).

## Les issues

### Déclarer un type d'issue

*Projet › Modèle de données › Structure*, sur la ligne du dépôt : **+** puis **+ Issue**. Le type a
ses champs (gravité, description…) et ses statuts, comme un type d'exigence, et accepte les mêmes
contraintes de transition ([tutoriel 3](03-exigences.md#les-règles-du-type)).

### Créer et suivre une issue

Vue **Issues** : les mêmes vues tableau et document que pour les exigences, avec la fiche d'édition.
Une issue se crée de trois façons :

- depuis la vue, comme tout élément ;
- **après une exécution en échec** : Polenta propose *Créer une issue*, *Lier à une issue existante*
  ou *Ignorer* ; l'issue garde l'exécution comme origine ([tutoriel 4](04-tests-campagnes.md)) ;
  l'import d'un classeur Excel d'exécution le propose aussi pour les échecs importés ;
- **depuis une décision de validation** qui le demande (*Décision à tracer*, plus bas).

Dans la fiche, la rubrique de lien **impacte** relie l'issue aux exigences qu'elle touche, dans le
même composant. Ces exigences deviennent des points de départ de l'analyse d'impact quand l'issue
entre dans une version : une issue s'inclut dans une version comme une exigence ou un test, par le
backlog. Une issue n'a pas de verrou d'approbation : elle reste modifiable.

Les issues sont stockées dans `issues/<ID>.yaml`.

## La validation d'une version

### Déclarer un type de validation

Sur la ligne du dépôt, **+** puis **+ Validation**. Le type définit les **décisions** possibles ;
par défaut : *en attente*, *conforme*, *non conforme*, *hors scope*, *dérogation*. Une décision peut
être marquée pour proposer la création d'une issue (non conforme, par exemple).

### Créer la validation

Vue **Validation** : le panneau liste les versions du dépôt et l'état de leur validation. Sur une
version, **Créer la validation**, donner un titre (*Validation 1.0* par défaut).

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

Le filtre réduit la liste : *À décider*, *Proposées*, *À revoir*, *Changées ou impactées*. Une
décision devient *À revoir* si l'exigence est modifiée ou devient impactée après coup. Une décision
proposée par un agent IA (*Proposée par …*) attend un **Confirmer** ou un **Rejeter** humain. Une
décision qui le demande ouvre la proposition d'issue (*Décision à tracer*).

### Signer

**Signer** n'est possible que sur une version **released**, et quand plus aucune décision n'est en
attente, proposée ou à revoir, et que les champs obligatoires sont remplis ; sinon Polenta liste ce
qui manque (*Signature impossible pour le moment : …*).

À la signature, Polenta fige pour chaque exigence ce que le signataire a vu : rédaction, design,
vérification, impact, tests et exécutions. Un lien retiré ou une exécution ajoutée plus tard ne
change plus la validation signée. La signature enregistre le seul fichier de la validation, sans tag
ni baseline. **Annuler la validation** permet de repartir d'une nouvelle validation.

La décision de la dernière validation signée apparaît dans la colonne **Validation** des vues
Exigences, avec le label de la version : *Conforme (1.0)*. Signée sur la version du **produit**,
c'est le feu vert final, par exemple le go production série.

Les validations sont stockées dans `validations/<ID>.yaml`.
