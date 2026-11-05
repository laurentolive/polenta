# 1. Compte et connexion

[English](../tutorials/01-account-login.md) | **Français**

Polenta n'a pas de serveur à lui : un projet est un ensemble de dépôts git, poussés et tirés sur un
**serveur git** — GitHub, ou un serveur Forgejo (celui de votre entreprise, par exemple). Il faut
donc un compte sur ce serveur, puis connecter Polenta à ce compte. Ce tutoriel montre les deux
étapes.

## Installer Polenta

Télécharger l'installeur Windows de la dernière version sur la page
[Releases](https://github.com/laurentolive/polenta/releases) du dépôt GitHub, et le lancer.
L'installation se fait pour l'utilisateur courant, sans droits administrateur. L'application se met
ensuite à jour toute seule (réglable dans *Compte › Préférences*).

## Se créer un compte

### Sur GitHub

1. Ouvrir [github.com/signup](https://github.com/signup) dans un navigateur.
2. Saisir une adresse e-mail, un mot de passe et un nom d'utilisateur, puis valider le code reçu
   par e-mail.
3. Recommandé : activer la double authentification (*Settings › Password and authentication*).

Un compte gratuit suffit : il permet des dépôts privés et l'invitation de collaborateurs. Pour un
travail d'équipe, on crée en général une **organisation** (*+ › New organization*) qui porte les
dépôts du projet ; Polenta propose ensuite d'y créer les dépôts ([tutoriel 11](11-projets-equipe.md)).

### Sur le serveur Forgejo de votre entreprise

Sur un serveur Forgejo d'entreprise, l'inscription libre est désactivée : c'est
l'**administrateur** qui crée votre compte, et vous le transmet de l'une de ces façons :

- un **identifiant** et un **mot de passe temporaire**, par e-mail ou de vive voix ;
- un **lien d'invitation** `polenta://connect?server=…&login=…` : cliqué sur un poste où Polenta est
  installé, il ouvre l'écran de connexion avec le serveur et l'identifiant déjà remplis (bandeau
  *Invitation à vous connecter au serveur …*). Le lien ne connecte jamais tout seul : le mot de passe
  reste à saisir.

Le mot de passe temporaire doit être changé sur le serveur avant la première connexion : Polenta le
détecte, affiche *Votre mot de passe est temporaire…* et le bouton **Changer mon mot de passe sur le
serveur**, qui ouvre la bonne page. Revenir ensuite dans Polenta avec le nouveau mot de passe.

Votre administrateur vous ajoute aussi aux **équipes** du serveur : ce sont elles qui donnent accès
aux projets.

### Sur un serveur Forgejo public

Polenta accepte tout serveur Forgejo ou Gitea. Sur une instance publique qui autorise l'inscription
(Codeberg, par exemple), se créer un compte depuis son bouton *Register* / *S'inscrire*, puis se
connecter comme pour un serveur d'entreprise.

## Connecter Polenta

L'écran de connexion s'affiche au premier lancement, puis depuis *Compte › Se connecter…* (ou
**Changer de compte…** une fois connecté).

Le champ **Remote git** choisit le serveur : `https://github.com`, ou **Serveur de votre
entreprise…** pour un serveur Forgejo / Gitea.

### Avec GitHub

1. Choisir `https://github.com`, puis **Se connecter avec GitHub**.
2. Polenta ouvre le navigateur sur la page d'autorisation de GitHub et affiche un **code** (*Validez
   dans le navigateur avec ce code :*).
3. Dans le navigateur, se connecter à GitHub si besoin, saisir le code et autoriser Polenta.
4. Polenta, *En attente de validation dans le navigateur…*, ouvre l'accueil dès l'autorisation
   donnée. Si le code a expiré, recommencer.

Alternative, sous **ou** : coller un **Personal Access Token (PAT)** créé dans *GitHub › Settings ›
Developer settings › Personal access tokens*, avec l'accès en lecture et écriture aux dépôts
(*Contents*), en lecture aux métadonnées et aux organisations. Utile quand le navigateur du poste ne
peut pas être utilisé.

### Avec un serveur Forgejo

1. Choisir **Serveur de votre entreprise…** et saisir l'adresse du serveur
   (`forge.mon-entreprise.fr` ; `https://` est ajouté si besoin). Polenta identifie le serveur
   (*Identification du serveur…*) ; une adresse qui n'est pas un serveur Forgejo ou Gitea est
   refusée.
2. Saisir l'**Identifiant** et le **Mot de passe**, et le **Code de double authentification** à 6
   chiffres si le compte l'a activée.
3. **Se connecter**.

Le mot de passe n'est pas conservé : Polenta demande au serveur un **jeton d'accès**, seul
enregistré, dans le coffre de mots de passe de Windows. Pour donner vous-même un jeton :
**Utiliser un jeton d'accès à la place**, avec un jeton créé dans *Paramètres du serveur ›
Applications*, en écriture sur les dépôts et les organisations, en lecture sur l'utilisateur.

## Le panneau Compte

Bouton **Compte**, en haut de la barre d'activité :

- le compte connecté : nom, identifiant, e-mail, serveur ;
- **Changer de compte…** ajoute un autre compte — on peut être connecté à la fois à GitHub et à un
  serveur Forgejo ; les assistants de création de projet proposent alors de choisir le compte ;
- **Se déconnecter** supprime le jeton du poste. Sur Forgejo, le jeton reste visible dans *Paramètres
  du serveur › Applications*, où on peut le révoquer ;
- **Préférences** : thème clair ou sombre, langue (français ou anglais), mises à jour automatiques,
  **Délai de connexion réseau** (10 à 120 s, à augmenter sur un réseau lent ou filtré), dossier des
  gabarits d'export.

Si l'accès au serveur est révoqué ou expiré, un bandeau le signale et propose **Se reconnecter** ;
les modifications locales sont conservées.

## Le client web

Une entreprise qui héberge Polenta sur son serveur peut aussi l'ouvrir **dans un navigateur**, sans
rien installer. La connexion se fait alors par le serveur Forgejo de l'entreprise (même compte, même
mot de passe), sans jeton à gérer. L'accueil liste **Mes projets** ; le reste de l'interface est le
même que l'application de bureau, à quelques exceptions près (pas de terminal, zoom du navigateur,
fichiers téléversés et téléchargés au lieu de dossiers locaux).

## Et ensuite

Une fois connecté, Polenta affiche son accueil. Le [tutoriel 2](02-prise-en-main.md) y ouvre le
projet de démonstration, cloné depuis des dépôts publics : aucun droit particulier n'est nécessaire.
