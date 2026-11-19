# Leçons

Règles tirées des corrections de l'humain (`WORKFLOW.md` § Méthode de travail). Une entrée par
pattern, courte, ajoutée en fin de fichier ; fusionner ou retirer celles qui ne servent plus.

Format :

```
## AAAA-MM-JJ — <pattern en quelques mots>
- Erreur : ce qui s'est passé
- Règle : ce qu'il faut faire désormais
```

## 2026-11-03 — Décision produit lue dans une note, présentée comme un fait
- Erreur : « client web abandonné » venait d'une note de mémoire et de specs de tickets ; l'agent l'a répété et en a tiré une proposition (retirer des specs e2e), alors que le client web est maintenu.
- Règle : une décision produit trouvée dans une note ou une ancienne spec est à citer avec sa source et sa date, et à confirmer auprès de l'humain avant d'en tirer une proposition.

## 2026-11-03 — Correctif limité au premier emplacement trouvé
- Erreur : pour une info-bulle gênante en vue Excel, seul le `title` de `LinkCell` a été retiré et testé, sur le projet de démo ; d'autres cellules et le lien lui-même gardaient le leur, et l'humain a revu la bulle au premier essai.
- Règle : pour un symptôme d'affichage, recenser tous les éléments qui peuvent le produire avant de corriger, et écrire le test sur le symptôme (toute la vue), pas sur la ligne modifiée.

## 2026-11-06 — Bug de position : seul l'état final testé, sur un seul parcours
- Erreur : GH300, la position de défilement était testée après coup, sur le changement d'onglet et Précédent ; l'humain a vu un à-coup (frames peintes en haut puis sur l'élément sélectionné) et une perte de position en revenant par la barre d'activité (Exigences → Tests → Exigences).
- Règle : pour un bug de position / d'affichage, recenser tous les chemins de retour qu'a l'utilisateur (onglet, historique, barre d'activité, arbre) et tester aussi les états intermédiaires (échantillonnage à chaque frame), pas seulement l'état final.

## 2026-11-09 — Architecture déduite de la doc, pas du code
- Erreur : GH332, l'agent a avancé « pin de submodule modifié des deux côtés » comme cause probable parce que `CLAUDE.md` décrit les composants comme des submodules git ; ils sont gérés à la main par Polenta, et les postes clients n'ont pas de git CLI (le repli proposé était donc inapplicable).
- Règle : avant de bâtir un diagnostic ou un correctif sur un point d'architecture (submodules, outils présents chez le client), le vérifier dans le code ; ne pas proposer de dépendance à un outil externe (git CLI) sans confirmer qu'il est disponible chez les clients.

## 2026-11-09 — Saturation traitée à une seule de ses sources
- Erreur : GH335, « Too many pending tasks in queue packed-refs » corrigé en supprimant une source de demandes (statut), testé sur ce seul chemin ; l'humain a revu l'erreur au checkout suivant, le verrou étant global au processus et alimenté par d'autres appels (index, historique, autres repos).
- Règle : pour une erreur de limite de ressource partagée, identifier la limite elle-même et tous ses consommateurs avant de corriger ; tester la limite (charge au-delà du seuil), pas seulement le chemin qui l'a révélée.

## 2026-11-19 — Cache rafraîchi par événement de watcher seul
- Erreur : GH413, après un merge dans l'intégration, le schéma servi restait l'ancien (libellés, options) jusqu'au redémarrage. Le cache `SchemaService` ne s'invalidait que sur un événement du watcher ; le merge déplace la ref avant de réécrire le répertoire de travail, et d'autres chemins d'écriture (checkout, pull) ne passent pas tous par le même appel.
- Règle : un cache de fichier doit se valider contre le fichier lui-même (signature taille + date), ou être invalidé après chaque écriture de l'arbre ; ne pas compter sur un événement de watcher seul. Tester le symptôme avec une écriture hors app (sans watcher), pas seulement via le service qui a déclenché le bug.
## 2026-11-19 — « Supprimer » qui ne fait que retirer une présentation
- Erreur : GH415, « Supprimer » dans l'arbre retirait seulement l'élément de `.polenta/trees/` ; le fichier de l'objet restait et l'objet redevenait « non classé » au changement de vue. Le message de confirmation disait « sera supprimé ».
- Règle : pour une action de suppression, vérifier sur disque ce qu'elle retire réellement, et tester le chemin de rechargement (changement de vue, retour, relecture de l'arbre) ; un libellé de confirmation doit décrire l'effet réel.
## 2026-11-19 — Popup de sélection dans un champ : clic qui ferme le parent
- Erreur : GH416, le sélecteur de paramètres (`{`) est rendu hors du champ ; un clic souris dans la liste remontait aux popups et menus parents, qui se fermaient avant l'insertion. Corrigé sans reproduction ni test sur le symptôme.
- Règle : un composant flottant rendu hors de son champ arrête la propagation de `mousedown` et `click`, et on teste le clic souris (pas seulement le clavier) avant de conclure.

## 2026-11-19 — Affirmer qu'un utilisateur ne peut pas atteindre un état sans tracer les transitions automatiques
- Erreur : GH414, j'ai affirmé qu'un utilisateur sans git ne pouvait pas être sur une branche de travail en retard ; le code (GH173, `settleAutoBranch`) crée `dev-auto` tout seul dès qu'il modifie l'intégration, et ses commits de la vue arbre y vont. Même chose pour un compteur : il lisait les refs locales, donc restait à zéro jusqu'au prochain fetch.
- Règle : avant d'affirmer qu'un profil d'utilisateur ne peut pas atteindre un état, suivre dans le code les transitions automatiques (bascules de branche, auto-pull, fetch) ; et un compteur lu sur des refs locales doit être rafraîchi par l'événement qui fait le fetch, testé dans la séquence réelle (fetch → compteur), pas sur l'état final seul.

## 2026-11-19 — Résultat « à jour » annoncé sur la ref, pas sur l'arbre de l'utilisateur
- Erreur : GH414, « Intégration à jour » était affiché quand la ref de l'intégration avait avancé, alors que l'auto-pull avait déplacé les modifs de l'utilisateur sur `dev-auto` : son arbre ne contenait pas le commit de l'équipe.
- Règle : pour un message de résultat de synchronisation, vérifier l'arbre de travail de l'utilisateur (pas seulement la ref) et le branche courante après l'opération ; un test de l'état « fichier présent dans l'arbre » couvre ce cas.
