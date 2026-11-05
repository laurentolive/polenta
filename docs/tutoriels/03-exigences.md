# 3. Exigences

[English](../tutorials/03-requirements.md) | **Français**

Ce tutoriel parcourt les exigences de la démo : les listes, les vues enregistrées, l'éditeur, la
syntaxe EARS, les diagrammes, les liens et les règles de passage d'un statut à l'autre.

## Choisir un type d'exigence

Vue **Exigences** (barre d'activité). Le sélecteur en haut du panneau latéral liste chaque type
d'exigence de chaque composant : *Lave-linge LL800 / Exigence Produit*, *Sous-système hydraulique /
Exigence Hydraulique*, *Moteur BLDC & onduleur / Exigence Moteur*… Il se filtre au clavier.

![Sélecteur de composant et de type](../img/req-picker.png)

Sous le sélecteur, l'arborescence range les exigences en **sections** (*Performance*, *Usage*,
*Réglementaire*…). **Nouvel élément** ajoute une exigence ; l'ID (`PRD-0014`…) est attribué par
Polenta et n'est jamais réutilisé, même après suppression : SYS-0015 a été supprimée, le fichier
`.polenta/tombstones/SYS-0015` en garde la trace, et la prochaine exigence système sera SYS-0016.
Une exigence pas encore rangée apparaît en fin de liste, triée par ID, jusqu'à ce qu'on la glisse dans une section.

## Vue tableau et vue document

La **vue tableau** montre une ligne par exigence et une colonne par champ.

![Exigences produit en vue tableau](../img/req-table.png)

- L'entonnoir d'une colonne la filtre (texte, casse, mot entier, expression régulière), y compris la
  colonne **Vérification** (*Non couvert*, *En échec*…).
- L'engrenage **⚙️ › Champs visibles** choisit les colonnes : champs du type, liens, **colonnes
  calculées** par le projet (par exemple *Dernier résultat* de campagne, ou une colonne par campagne,
  voir le [tutoriel 7](07-suivi.md)). Dans la démo, les liens de vérification et les liens d'issue
  sont affichés par défaut. Quand un type est à la fois source et cible d'un même lien, les
  deux sens ont chacun leur colonne (*raffine* / *est raffinée par*).
- Les valeurs bleues soulignées (`8 kg`, `1400 tr/min`) sont des **paramètres** : la valeur vient
  de la base de paramètres ([tutoriel 5](05-parametres.md)).
- Les statuts suivent le cycle défini par le type : `draft`, `review`, `approved`, et deux statuts
  terminaux, `obsolete` (PRD-0011) et `rejected` (PRD-0013).
- **Exporter** produit un fichier Excel, Word ou PDF, avec un gabarit client au besoin.

La **vue document** (icône de page) présente les mêmes exigences comme un document de
spécification, avec leurs liens. Passer d'une vue à l'autre garde l'exigence sélectionnée.

![Vue document](../img/req-document.png)

### Les quatre statuts d'une exigence

Une exigence a quatre statuts, que les colonnes facultatives de **⚙️ › Champs visibles** affichent
côte à côte :

| Statut | Ce qu'il dit | D'où il vient |
|---|---|---|
| **Rédaction** | brouillon, en revue, approuvée… | le statut saisi |
| **Design** | la première version livrée qui contient l'exigence dans son état actuel (`1.0`), « — » sinon | les versions ([tutoriel 9](09-versions.md)) |
| **Vérification** | *Non couvert*, *Couvert*, *Vérifié*, *En échec*, *À revalider* | les tests et leurs résultats ([tutoriel 6](06-tracabilite.md)) |
| **Validation** | la décision de la dernière validation signée, avec sa version (*Conforme (1.0)*) | les validations ([tutoriel 10](10-issues-validation.md)) |

Seule la rédaction est saisie ; les trois autres sont calculés à l'affichage.

### Les vues enregistrées

Un réglage de colonnes, de filtres et de tri s'enregistre comme **vue**, par la liste déroulante à
côté de ⚙️ :

- **Enregistrer sous…** : un nom, et une **portée** — *Personnelle* (pour vous seul) ou *Équipe*
  (écrite dans le dépôt, sous `.polenta/views/`, à publier pour la partager) ;
- la liste regroupe **Mes vues** et **Équipe** ; une vue modifiée depuis son chargement porte la
  mention *modifiée* ; **Enregistrer**, **Renommer**, **Supprimer**, **Colonnes par défaut**.

La démo a deux vues d'équipe sur les exigences produit : *Revue marketing* (priorité, source,
marchés, KPI) et *Suivi de conformité*, qui affiche les statuts côte à côte.

L'onglet **Popup** de ⚙️ choisit les champs affichés dans l'aperçu qui s'ouvre au survol d'un ID.

## L'éditeur

Le crayon d'une ligne ouvre l'éditeur. Ouvrir **SYS-0001** (*Exigence Système*, section
*Architecture*) :

![Éditeur de SYS-0001, avec un diagramme draw.io dans l'énoncé](../img/req-editor.png)

- En haut, l'état de **vérification** de l'exigence (ici *Non couvert* : aucun test ne la vérifie,
  voir le [tutoriel 6](06-tracabilite.md)).
- Les champs viennent du type : texte, texte riche, liste, cases à cocher, date, utilisateur,
  nombre, diagramme, **lien** (un libellé et une URL : page web, fichier ou partage réseau)… Une
  étoile marque un champ obligatoire. Les *Documents de référence* de SYS-0001 sont un champ lien :
  un règlement européen et une note sur un partage réseau.
- Le texte riche accepte des **diagrammes draw.io**, des images, des tableaux et des références
  `[[ID]]` vers un autre élément. Le diagramme d'architecture de SYS-0001 est un fichier `.drawio`
  du dépôt, affiché dans l'énoncé ; la justification de PRD-0004 cite `[[SYS-0002]]`.
- En bas, la section **Exécutions** liste tous les résultats des tests qui vérifient l'exigence
  ([tutoriel 4](04-tests-campagnes.md)).
- **↩ / ↪** annulent et rétablissent ; **Précédent** revient à la liste.

Chaque enregistrement est daté et attribué par git. Rouvrir une exigence approuvée (la repasser en
`review` ou `draft`) incrémente sa **version** : SYS-0002, approuvée à la revue RE1 puis repassée en
revue après les essais EVT, en est à la version 2. Les éléments qui lui sont liés sont alors marqués
**Impact à vérifier** ([tutoriel 6](06-tracabilite.md)).

Changer de statut propose un **Commentaire du changement de statut** (facultatif) : il est gardé
dans l'historique de l'exigence, avec la date et l'auteur du changement. L'historique de SYS-0002
montre ses trois statuts successifs et le commentaire *Essorage porté à 1400 tr/min après EVT.*

L'historique suit le statut et les champs marqués **Hist.** dans le type (ici, la priorité). Dans la
démo, il est écrit pour les exigences produit et système, les tests système, et les exigences et
tests du moteur. Les composants locaux (hydraulique, carte de commande, IHM…), la pompe, le module
Wi-Fi et le bus n'en ont pas : Polenta déduit la valeur actuelle du dernier commit (entrée *déduite*), et *Projet ›
Préférences › Reconstruire depuis git* reconstitue l'historique d'un dépôt à partir de ses commits.

Un type peut afficher un champ à la place de l'ID : les exigences IHM affichent leur titre. Dans les
liens de BIHM-0002, IHM-0004 apparaît sous le nom *Conformité au bus IHM*.

## Rédiger en EARS

Les énoncés suivent la syntaxe **EARS** (*Easy Approach to Requirements Syntax*), cinq formes
courtes et vérifiables :

| Forme | Modèle | Exemple de la démo |
|---|---|---|
| Ubiquitaire | `THE <système> SHALL <action>` | PRD-0001 |
| Événementielle | `WHEN <déclencheur> THE <système> SHALL <action>` | PRD-0003 |
| Conditionnelle | `WHILE <état> THE <système> SHALL <action>` | PRD-0004 |
| Optionnelle | `WHERE <option> THE <système> SHALL <action>` | PRD-0006 |
| Indésirable | `IF <condition> THEN THE <système> SHALL <action>` | PRD-0008 |

Le champ *Énoncé* d'un type porte le validateur `EARS`. L'énoncé de **PRD-0012** (« Le filtre de la
pompe doit être facile d'accès… ») ne le respecte pas : Polenta le signale dans les critères de
**maturité** des requêtes ([tutoriel 7](07-suivi.md)), refuse un import en masse non conforme
([tutoriel 12](12-agent-ia.md)) et, si le type le demande, au passage de statut (ci-dessous).

## Les liens

En bas de l'éditeur, une rubrique par type de lien, dans les deux sens : *raffine* / *est raffinée
par*, *implémente* / *est implémentée par*, *est vérifiée par*…

![Liens de SYS-0001 : implémentée par CC-0001](../img/req-links.png)

Taper un ID ou un titre dans **Rechercher un élément…** crée le lien ; la croix le supprime. Seuls
les éléments autorisés par le type de lien sont proposés, y compris ceux des autres dépôts du
projet : SYS-0002 est implémentée par MOT-0001, une exigence du composant moteur.

## Les règles du type

Dans *Projet › Modèle de données*, la définition d'un type porte deux règles facultatives. La démo
les utilise sur deux types :

- *Exigence Produit* : les *Critères d'acceptance* sont obligatoires à l'approbation ;
- *Exigence Système* : de `draft` à `review`, les champs obligatoires bloquent et les formats
  (EARS) donnent une notification ; vers `approved`, l'absence de test donne une notification.

**Obligatoire si.** La colonne **Oblig. si** de la table des champs rend un champ obligatoire sous
condition : `status = approved` (la justification n'est exigée qu'à l'approbation), ou une valeur
d'un autre champ (`priority = high`). Renommer le statut ou la valeur met la condition à jour.

**Contraintes de transition.** La section **Contraintes de transition** d'un type d'exigence, de
test ou d'issue contrôle le passage d'un statut à un autre :

1. **+ Ajouter une règle** : **Depuis** (facultatif, *Tout statut* par défaut) et **Vers** un statut ;
2. pour chaque condition — **Champs obligatoires remplis**, **Formats valides (EARS…)**, **Couverte
   par un test** — un niveau : **Aucun contrôle**, **Notification** (par défaut) ou **Blocage**.

Dans la liste des statuts de l'éditeur, une transition bloquée est grisée avec son motif ; une
transition notifiée reste possible, avec un avertissement et une notification *points à vérifier*
après le passage. Sans règle, le passage est libre.

## Exercices

**Passer d'une vue à l'autre.**
1. *Exigence Produit* en vue tableau : modifier le titre de PRD-0005.
2. Passer en vue document.

Résultat : le nouveau titre apparaît dans le document, sur la même exigence.

**Utiliser les vues enregistrées.**
1. Liste des vues : appliquer *Suivi de conformité*.
2. Changer les colonnes, puis **Enregistrer sous…** une vue *Personnelle*.
3. Vue **Version**, **Modifications**.

Résultat : les colonnes *Vérification*, *Design* et *Validation* s'affichent. La vue personnelle
n'écrit rien dans le dépôt : seul `.polenta/views/root/exigence-produit.yaml` porte des vues, celles
de l'équipe.

**Filtrer les exigences non couvertes.**
1. *Exigence Système*, entonnoir de la colonne **Vérification** : *Non couvert*.

Résultat : la liste contient SYS-0008.

**Renseigner un champ lien.**
1. Ouvrir SYS-0003, *Documents de référence* : ajouter un libellé et une URL `https://…`.
2. Ajouter un second lien avec le texte `cahier` comme URL.

Résultat : le premier lien est cliquable. Le second est refusé : *URL non prise en charge :
http(s)://, file:// ou chemin réseau \\serveur\partage.*

**Corriger les erreurs de format.**
1. Ouvrir PRD-0012 : l'énoncé n'est pas en EARS, et la *Réf. demande client* `CLI-12` ne suit pas
   le format `CLI-0000`.
2. Réécrire l'énoncé (`THE pompe SHALL …`) et saisir `CLI-0012`.

Résultat : les deux erreurs disparaissent.

**Approuver sans critère d'acceptance.**
1. Ouvrir PRD-0012, qui n'a pas de critère d'acceptance.
2. Choisir le statut `approved`.

Résultat : *Critères d'acceptance* est signalé obligatoire pour ce statut.

**Rencontrer les contraintes de transition.**
1. *Exigence Système*, **Nouvel élément** : un titre seul (SYS-0016 sur une démo neuve).
2. Passer l'exigence en `review`.
3. Ouvrir SYS-0007 (en revue, aucun test) et la passer en `approved`.

Résultat : à l'étape 2, le passage est bloqué (*Changement de statut de SYS-0016 refusé*, code
`TRANSITION_BLOCKED`) : l'énoncé obligatoire manque. À l'étape 3, le passage se fait, avec la
notification *Statut de SYS-0007 changé — points à vérifier*.

**Rouvrir une exigence approuvée.**
1. Ouvrir SYS-0003 (approuvée, version 1) et la repasser en `review`, avec un commentaire.

Résultat : SYS-0003 passe en version 2. Les éléments liés, PRD-0005 et SW-0001, sont marqués
**Impact à vérifier**.

**Lire l'historique.**
1. Ouvrir SYS-0002, historique du statut.
2. Ouvrir POMP-0001 (*Pompe de vidange*), même rubrique.
3. *Projet › Préférences* : **Reconstruire depuis git** sur `comp-pompe-vidange`, puis rouvrir
   POMP-0001.

Résultat : SYS-0002 montre des entrées réelles, dont le commentaire écrit après EVT. POMP-0001
montre une entrée *déduite*. Après la reconstruction, ses entrées portent le badge *git* (date et
auteur du commit) ; le fichier est à publier.

**Voir un champ affiché à la place de l'ID.**
1. Ouvrir BIHM-0002 (*Bus IHM*), rubrique *est implémentée (interface) par*.
2. Ouvrir l'exigence liée.

Résultat : le lien affiche *Conformité au bus IHM*, le titre de IHM-0004, au lieu de son ID.

**Supprimer une exigence.**
1. Créer une exigence système (SYS-0016 sur une démo neuve), puis la supprimer.
2. Créer une autre exigence système.

Résultat : `.polenta/tombstones/SYS-0016` apparaît. La nouvelle exigence prend le numéro suivant :
SYS-0016 n'est pas réutilisé.

**Écrire en texte riche.**
1. Dans la justification de PRD-0005, insérer un tableau, une image et la référence `[[SYS-0001]]`.

Résultat : le tableau et l'image s'affichent ; la référence devient un lien vers SYS-0001.

**Lier un ticket Jira.**
1. Ouvrir PRD-0010, rubrique Jira : le ticket `LL-128` y figure.
2. En ajouter un autre.

Résultat : les deux tickets sont listés.

**Exporter.**
1. Appliquer *Revue marketing*, puis **Exporter** en Word, puis en Excel.

Résultat : chaque fichier contient les exigences et les colonnes affichées.

**Renommer une valeur.**
1. *Projet › Modèle de données*, *Exigence Produit*, champ *Priorité* : renommer `low` en `basse`.

Résultat : une fenêtre de migration liste les exigences concernées (PRD-0010…) et les réécrit.
