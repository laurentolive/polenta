# GH27 — Scénarios de test

Pas de tests automatiques dans `apps/desktop` (seul `typecheck` existe) : scénarios manuels, à
dérouler dans l'app (`pnpm dev`). Pré-requis : un compte configuré, et aucun dernier projet ouvert
(fermer le projet courant pour revenir sur `/`).

## Nominal

| # | Scénario | Attendu |
|---|----------|---------|
| N1 | Afficher `/` | 4 boutons, aucun champ visible. « Découvrir Polenta… » en premier, mis en avant. Libellés FR. |
| N2 | Démo → créer/choisir un dossier **vide** dans le sélecteur | « Chargement de la démo… » sur le bouton, les autres boutons désactivés. Puis `/schema` du projet « Lave-linge LL800 ». Le dossier contient `.polenta/workspace.yaml` et les 5 repos (`demo-ll800-produit`, `comp-moteur`, `comp-pompe-vidange`, `comp-module-wifi`, `if-bus-interne`). Le projet apparaît dans Récents. |
| N3 | Fermer le projet, Démo → choisir **le même dossier** | Ouverture immédiate, sans clone (pas de trafic réseau notable, pas de nouveau dossier). |
| N4 | Ouvrir un projet existant → choisir un dossier de projet Polenta | Ouverture directe sur `/schema`, sans autre clic. |
| N5 | Ouvrir un projet existant → choisir un repo git sans `.polenta` | Adopté comme projet et ouvert (comportement actuel inchangé). |
| N6 | Depuis un repo → popup : champ « URL du repo Git » avec focus, coller une URL puis `Entrée` | Le popup se ferme, le sélecteur natif s'ouvre. Choisir un dossier : « Clonage… », puis projet ouvert. |
| N7 | Créer → popup : champ « Nom du projet » avec focus, saisir puis `Entrée` | Sélecteur natif, puis « Création… », puis projet ouvert (`<dossier>/<nom>`). |

## Annulations

| # | Scénario | Attendu |
|---|----------|---------|
| A1 | Démo ou Ouvrir existant → annuler le sélecteur natif | Retour à la page, aucun message, boutons réactivés. |
| A2 | Popup URL ou nom → `Échap` | Popup fermé, rien d'autre. |
| A3 | Popup → clic sur l'overlay / bouton « Annuler » | Idem A2. |
| A4 | Popup confirmé → annuler le sélecteur natif | Retour à la page, aucun message, aucune création ni clone. |

## Cas limites

| # | Scénario | Attendu |
|---|----------|---------|
| L1 | Popup avec champ vide (ou seulement des espaces) → `Entrée` / bouton | Rien ne se passe, bouton « Continuer » désactivé. |
| L2 | Démo → choisir un dossier qui est un **repo git non Polenta** | Message « Ce dossier n'est pas vide et ne contient pas de projet Polenta… » sous le bouton démo. Dossier inchangé (pas de `.polenta/`). |
| L3 | Démo → choisir un dossier **non vide** sans projet ni `.git` (ex. un seul fichier caché) | Même message que L2, dossier inchangé. |
| L4 | Démo sans réseau, puis relance dans le même dossier une fois le réseau revenu | Message d'erreur sous le bouton démo ; aucun sous-dossier `demo-ll800-produit/` laissé derrière (nettoyé par `createFromClone`) ; la relance charge la démo normalement. |
| L5 | Ouvrir existant → dossier ni projet ni repo | Message « Ce dossier n'est ni un projet Polenta ni un repo git. » sous le bouton concerné. |
| L6 | Erreur sur une action, puis lancement d'une autre action | L'ancien message disparaît. |
| L7 | Double-clic rapide sur un bouton | Un seul sélecteur / une seule opération. |
| L8 | Langue EN (sélecteur de langue) | Tous les libellés des boutons, popups et sélecteurs en anglais. |
| L9 | Démarrage avec un dernier projet connu | Ouverture directe du projet (`/dashboard`), la page n'apparaît pas (inchangé). |

## Critères d'acceptation vérifiables

- `pnpm --filter desktop typecheck` : 0 erreur nouvelle.
- Un seul canal IPC ajouté (`workspace:is-empty-dir`) : `git diff` sur `main/` et
  `packages/api-client/` se limite à ce canal, et `preload/` n'est pas touché.
- Aucune des clés i18n supprimées n'est encore référencée (grep).
- N1 à N7, A1 à A4, L1 à L3, L5 à L8 conformes.
