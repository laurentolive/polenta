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
