# T131 — Scénarios de test

## Golden path

1. Ouvrir l'onglet Structure d'un projet ayant au moins un composant local avec des éléments et un
   sous-composant local imbriqué.
2. Vérifier que la ligne du composant local affiche un chevron `▼` (ouvert) et que ses éléments et
   son sous-composant sont visibles (comportement identique à avant ce ticket).
3. Cliquer sur la ligne (hors icônes d'action) → le chevron passe à `▶`, le contenu (éléments,
   sous-composant imbriqué) disparaît.
4. Re-cliquer sur la ligne → le chevron repasse à `▼`, tout le contenu réapparaît identique à
   l'étape 2.

## Cas limites

- **Composant local sans aucun contenu** (pas d'éléments, pas de sous-composant, pas de
  dépendance imbriquée) : le chevron s'affiche et bascule normalement, même s'il n'y a rien à
  montrer/cacher (pas de crash, pas de condition spéciale nécessaire).
- **Imbrication profonde (3+ niveaux)** : replier un composant local de niveau 1 masque tout son
  sous-arbre (niveaux 2, 3…) en une seule action ; le rouvrir réaffiche tout, avec les
  sous-composants de niveau 2+ à nouveau dans leur état par défaut ouvert (pas de mémorisation de
  l'état d'un sous-composant après un cycle replier/déplier du parent — cohérent avec le
  comportement déjà existant de `RepoRow`, qui a la même limite).
- **Clic sur `+` (ajouter élément/composant/interface)** : le menu s'ouvre normalement, sans
  toggler l'état ouvert/fermé de la ligne.
- **Clic sur le crayon (renommer)** : la modale d'édition s'ouvre normalement, sans toggler l'état.
- **Clic sur la corbeille (supprimer)** : la modale de confirmation s'ouvre normalement, sans
  toggler l'état ; confirmer supprime le composant comme avant ce ticket.
- **Changement de repo/composant sélectionné puis retour** : l'arbre Structure remonte, tous les
  composants locaux redeviennent ouverts par défaut (pas de persistance, cf. T131.md point 6).
- **`RepoRow` non affecté** : le collapse/expand des lignes de repo (déjà existant) continue de
  fonctionner à l'identique après ce ticket.

## Critères d'acceptation vérifiables

Repris de `T131.md` §Critères d'acceptation — voir ce fichier pour la liste complète cochable.
