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
