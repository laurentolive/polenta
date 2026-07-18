# T76 — Scénarios de test

Réf. `specs/T76.md`, `specs/T76-design.md`.

## Scénarios nominaux (golden path)

1. **Coller une image** dans un champ richtext (repo ouvert) → un fichier
   apparaît dans `images/` du repo, le document Markdown stocké référence ce
   chemin relatif (pas de `data:` inline), l'image s'affiche correctement
   dans l'éditeur.
2. **Bouton "Insérer une image (fichier)"** avec un fichier situé hors du
   repo courant → le fichier est copié dans `images/`, le document référence
   `images/<nom>.png`, l'image s'affiche.
3. **Bouton "Insérer une image (fichier)"** avec un fichier déjà situé sous
   le repo courant (n'importe où, pas seulement `images/`) → référence
   directe par chemin relatif, aucune copie créée.
4. **Rechargement** du document (fermer/rouvrir l'objet, ou recharger
   l'application) → l'image référencée par chemin s'affiche à nouveau
   correctement (round-trip Markdown stable, cohérent avec le bloc
   ```` ```image ```` de T75 dont seul `src` change de sémantique).
5. **Redimensionner/rogner** une image nouvellement insérée (mécanique T75,
   inchangée) → fonctionne à l'identique, le bloc ```` ```image ```` stocke
   `src` (chemin), `width`/`height`/`crop`.
6. **"Remplacer le fichier"** (menu contextuel) sur une image référencée par
   chemin → nouveau fichier copié dans `images/`, `src` mis à jour, position/
   dimensions/crop conservés.

## Cas limites

7. **Collage de deux images successives avec un fichier source de même nom**
   (ou deux collages rapprochés) → les deux fichiers coexistent dans
   `images/` sous des noms distincts (suffixe de désambiguïsation), aucun
   n'écrase l'autre.
8. **Insertion sans repo ouvert / contexte repo indisponible** (`repoPath`
   undefined) → bouton "Insérer une image" désactivé (tooltip "contexte repo
   indisponible", cohérent avec `DrawioInsertButton`) ; un collage
   presse-papiers dans ce contexte n'insère rien (pas de crash, pas de
   fallback base64).
9. **Image référencée introuvable** (fichier supprimé manuellement du disque
   après insertion) → état d'erreur explicite inline ("Image introuvable :
   images/foo.png"), pas de rendu vide, pas de crash de l'éditeur.
10. **Contenu existant en base64** (créé avant ce ticket, y compris un bloc
    ```` ```image ```` de T75 avec `crop` et un `src` en `data:`) → continue
    de s'afficher tel quel (branche `data:` du rendu), aucune conversion
    automatique. Le remplacer via "Remplacer le fichier" le fait basculer
    vers un chemin relatif (chemin de sortie naturel, pas un mécanisme dédié).
11. **Image référencée par URL externe** (`![alt](https://exemple.test/x.png)`,
    tapée manuellement en mode Raw ou déjà présente dans un document existant)
    → continue de s'afficher directement, aucun appel IPC, aucune tentative
    de la traiter comme un chemin de repo.
12. **Copier-coller d'un bloc image entre deux champs richtext** (même repo)
    → la référence de fichier est copiée telle quelle, pas de duplication du
    fichier physique.
13. **Fichier référencé hors du repo courant après un remplacement de
    workspace** (chemin relatif ne pointant plus vers un fichier existant
    dans le nouveau contexte) → même état "introuvable" que le point 9, pas
    de résolution incorrecte vers un autre fichier.

## Critères d'acceptation vérifiables

Repris de `specs/T76.md` §Critères d'acceptation — chaque case cochée doit
correspondre à un scénario ci-dessus observable manuellement (Electron non
attachable en session agent : validation manuelle humaine requise avant
archivage, cohérent avec `T42`/`T75`).
