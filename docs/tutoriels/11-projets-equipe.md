# 11. Projets d'équipe

[English](../tutorials/11-team-projects.md) | **Français**

Ce tutoriel crée un vrai projet sur un serveur GitHub ou Forgejo, y ajoute un composant dans son
propre dépôt et règle qui y a accès. Il suppose un compte connecté ([tutoriel 1](01-compte-connexion.md))
avec le droit de créer des dépôts — sur votre compte personnel ou dans une organisation.

## Créer un projet sur le serveur

Accueil › **Créer un nouveau projet** › **Sur un serveur (GitHub, Forgejo)** (ou **Sur le serveur
…** quand un seul compte est connecté). L'assistant demande :

| Champ | Contenu |
|---|---|
| **Service** | le compte à utiliser, si plusieurs sont connectés |
| **Propriétaire** | votre compte ou une de vos organisations |
| **Nom du repo** | vérifié en direct : *Nom disponible.* ou *Le repo … existe déjà* |
| **Visibilité** | *Privé* ou *Public* |
| **Description** | obligatoire : elle devient la description du dépôt et son `README.md` |
| **Branche d'intégration** | pré-remplie, préfixe `int-` imposé ([tutoriel 8](08-publier-historique.md)) |
| **Membres (facultatif)** | des comptes avec un niveau (*Lecture*, *Écriture*, *Administration*), ou des équipes |

**Créer** déroule les étapes une à une — création du dépôt sur le serveur, préparation locale,
publication de la branche d'intégration, branche par défaut du serveur, ajout des membres,
ouverture — avec l'état de chacune. Une étape qu'il faut faire faire par un administrateur est
signalée comme telle. Si la création s'interrompt (*Création incomplète*), **Continuer** la reprend
là où elle s'est arrêtée.

**Sur ce poste uniquement** crée le même projet sans serveur ; il pourra être publié plus tard.

### Ouvrir un dépôt qui existe déjà

**Ouvrir un projet depuis un repo existant** liste les dépôts accessibles avec votre compte
(*Rechercher un projet (organisation/nom)*, ou **Saisir une URL**). Pour un dépôt qui n'est pas
encore un projet Polenta, ou incomplet, Polenta ne demande que ce qui manque (branche d'intégration,
description, initialisation) : **Compléter et ouvrir**, ou **Ouvrir tel quel**. Il faut le droit
d'écriture sur le dépôt.

Sur un serveur Forgejo d'entreprise, l'accueil affiche aussi **Projets de votre équipe** : les
projets publiés pour vos équipes, à ouvrir d'un clic dans un dossier vide.

## Ajouter un composant dans son propre dépôt

Un composant réutilisable vit dans son propre dépôt, monté dans le produit à une version précise
([tutoriel 2](02-prise-en-main.md#le-modèle-de-données)). *Projet › Modèle de données ›
Structure* › **+ Composant** (ou **+ Interface**) :

- **Créer le repo sur le serveur** : le même assistant que pour un projet, pour le dépôt du
  composant ;
- **Depuis un repo existant** : monter un dépôt déjà présent sur le serveur.

**+ Composant local** ajoute au contraire un composant dans le dépôt produit, sans dépôt à part.

## Les paramètres du repo

Sur la ligne d'un dépôt, dans l'onglet Structure, l'engrenage **Paramètres du repo** (visible au
survol) règle le dépôt sur le serveur, sans quitter Polenta :

- **Général** : la description et la visibilité. Rendre un dépôt public demande confirmation ;
  Polenta propose de mettre aussi à jour le `README.md`.
- **Membres** : les **Collaborateurs** (ajout par identifiant, avec un niveau ; sur GitHub, la
  personne reçoit une invitation à accepter, listée sous *Invitations en attente*) et les
  **Équipes** de l'organisation (**Gérer les équipes sur le serveur** ouvre la page du serveur).

Ces réglages sont réservés aux administrateurs du dépôt ; les autres les voient en lecture seule.
Ils demandent une connexion au serveur.

## Travailler à plusieurs

Une fois le projet partagé :

- chacun travaille sur son poste, puis **Publie** ; Polenta fusionne dans la branche d'intégration et
  propose de résoudre les conflits ([tutoriel 8](08-publier-historique.md)) ;
- les vues enregistrées de portée *Équipe*, les requêtes et dashboards partagés et le modèle de
  données sont des fichiers du dépôt : ils se partagent en publiant ;
- dans une entreprise qui héberge Polenta, les collègues sans poste installé ouvrent le même projet
  dans le **client web** ([tutoriel 1](01-compte-connexion.md#le-client-web)).

## Exercices

Ces exercices demandent un compte sur un serveur GitHub ou Forgejo : ils sont facultatifs.

**Publier une copie de la démo sur vos dépôts.**
1. Créer sur votre compte un projet vide avec l'assistant (**Sur un serveur (GitHub, Forgejo)**),
   puis ouvrir ses **Paramètres du repo**, onglet **Membres** : ajouter un collègue en *Lecture*.
2. Dans la démo, modifier une exigence, puis **Publier**.

Résultat : le projet est créé avec sa branche d'intégration `int-…` et le collègue est invité. Dans
la démo, l'envoi échoue : ses dépôts sont publics et ne vous appartiennent pas. Pour publier la
démo elle-même, il faut d'abord pousser ses cinq dépôts sur votre compte et changer leurs adresses.
