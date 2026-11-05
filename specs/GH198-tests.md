# GH198 — Scénarios de test

> **Historique** (2026-11-05, #270) — l'objet changeset a été retiré par #243 ; sort de ce lot et ce qui en est conservé : `specs/MILESTONE-D.md` §7 et §9. Ce document décrit l'état livré à l'époque.

**[U]** unitaire, **[E]** e2e web, **[M]** manuel.

1. [U] création : type `change` résolu, ID préfixe + numéro, statut initial, `changes/<ID>.yaml`, historique.
2. [U] composant : déduit (un composant local) ; obligatoire si plusieurs ; inconnu refusé.
3. [U] mise à jour : listes dédoublonnées ; composant refusé hors statut initial ; statut changé (historique).
4. [U] suppression : jamais commité → supprimé + pierre tombale ; commité → refus.
5. ~~[U] candidats « repassés en brouillon »~~ — retiré (filtre du sélecteur d'éléments).
6. [U] liste workspace : changes de deux repos, `repoPath` renseigné.
7. [U] graphe : `changes` exposé ; MCP `create_change` / `list_changes`.
8. [E] modèle de données : type de catégorie change (statuts par défaut) ; « Nouveau change » ; ajout à « à modifier » et aux impactés (statut, commentaire) ; changement de statut.
9. [E] « Créer un change » depuis l'éditeur d'une exigence : élément pré-rempli.
10. [M] panneau : filtres, regroupement par repo ; suppression d'un change publié refusée.
