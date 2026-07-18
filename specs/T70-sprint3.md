# T70-sprint3 — Retrait de /workspace et nettoyage final

## Retour utilisateur post-sprint 3

En testant, l'utilisateur a signalé deux anciens nœuds locaux orphelins ("BMS", "IHM" — badge "⚠ non associé à un repo") impossibles à supprimer. La spec (§4.5 du design) prévoyait ces nœuds en lecture/écriture pour leurs **éléments**, mais aucune action de suppression n'avait été prévue pour le **nœud orphelin lui-même** — un oubli, pas une décision de scope. Corrigé dans la foulée (même sprint, avant archivage du ticket) : un bouton "Supprimer" (au survol, avec confirmation) apparaît à côté du badge et retire le nœud (et ses éléments) du `schema.yaml` du repo concerné. Le nœud `root` reste non concerné (pas de suppression du nœud représentant le repo lui-même).

## Périmètre réalisé

Conforme à `specs/T70-design.md` §7 Sprint 3 : CA-6, CA-7 final.

## Fichiers modifiés

```
apps/desktop/src/renderer/
  routes/workspace.tsx              réécrit — page de redirection uniquement (voir décision ci-dessous)
  routes/compliance.tsx             modifié — accepte repoPath/projectId, bouton retour vers /schema
                                     (avec repli vers /workspace si ces params sont absents — vieux liens)
  components/schema/StructureTab.tsx modifié — bouton "Conformité interfaces" ajouté
TICKETS.md                          statut T70 → [coding sprint 3]
```

Aucun changement sur les onglets Liens/Interfaces ni sur les fichiers touchés en Sprint 1/2 — passe de régression limitée à la zone touchée par ce sprint.

## Décision : "SUPPRIMÉ" (design) → page de redirection, pas suppression littérale

`specs/T70-design.md` listait `routes/workspace.tsx` comme purement supprimé. En pratique, CA-6 exige explicitement que les anciens liens/favoris vers `/workspace?dir=...` **redirigent** vers l'onglet Structure plutôt que de 404 — ce qui est impossible avec une suppression littérale du fichier de route. Le fichier est donc conservé mais entièrement vidé de son contenu fonctionnel (arbre, résolution diamond, bouton rebuild — tous déjà migrés vers `StructureTab.tsx` en Sprint 1/2) au profit d'une page de redirection pure : elle résout `dir` en `repoPath`/`projectId` puis navigue vers `/schema`.

## Comportement implémenté

- `/workspace?dir=...` résout le répertoire et redirige automatiquement vers l'onglet Structure du projet correspondant. Si le projet n'est plus résolvable, message d'erreur explicite avec invitation à retourner à l'accueil.
- Bouton "Conformité interfaces" déplacé dans l'onglet Structure (à côté d'"Actualiser").
- Le bouton retour de `/compliance` pointe vers `/schema` (onglet Structure) ; s'il est atteint depuis un vieux lien ne portant que `dir` (sans `repoPath`/`projectId`), il repasse par `/workspace` plutôt que de naviguer vers un `/schema` sans repo — évite un écran de chargement infini.

## Revue de code — trouvailles

1. **Corrigé** : le bouton retour de `/compliance` menait vers `/schema` avec des paramètres vides pour tout vieux lien externe, bloquant sur "Chargement du schéma…" indéfiniment. Corrigé par le repli décrit ci-dessus.
2. **Corrigé** : la page de redirection utilisait un `useEffect` + `Promise` fait main au lieu du pattern `useQuery` déjà utilisé partout ailleurs dans l'app pour résoudre un `workspaceDir` (project.$id.tsx, baseline.tsx, requirements.tsx, etc.). Réécrit avec `useQuery`, ce qui règle au passage un message d'erreur qui ne se réinitialisait jamais entre deux tentatives.
3. **Accepté sans correction** : `api.workspace.resolve()` renvoie un message générique identique pour "projet déplacé/supprimé" et "mono-repo jamais initialisé en workspace plat" — un vieux favori vers ce second cas afficherait "n'est plus résolvable" à tort. Cas très étroit (uniquement via un favori externe antérieur à l'auto-initialisation de `openProject()`, aucun lien interne n'y mène plus). Documenté ici plutôt que d'étendre la sémantique de `resolve()`.
4. **Accepté sans correction** : l'ancienne page `/workspace` affichait des informations de diagnostic (date de génération du cache, SHA racine, nombre de repos) et un bouton bascule Arbre/Liste (vue tableau plate). Aucun équivalent dans `StructureTab.tsx`. Ce sont des commodités de diagnostic/scan, pas des fonctionnalités cœur — perte assumée et documentée ici plutôt que reconstruite, proportionnée à un sprint de nettoyage final.

## SPEC-INDEX.md

Pas de mise à jour : aucune section de `SPEC-TEMPLATES.md`/`SPEC-FORKS-BRANCHES-BASELINES.md` référencée par `specs/T70.md` n'a vu son contenu (format `schema.yaml`, `roles`, `implements`) changer — seule l'UI d'édition a changé. Suit le précédent T57/T59 : ces tickets restent documentés via leur propre fichier `specs/T{N}.md` référencé depuis `TICKETS.md`, sans entrée dédiée dans `SPEC-INDEX.md`.

## Récapitulatif T70 (3 sprints)

- **Sprint 1** : arbre de structure en lecture/édition (repos + types d'éléments cross-repo), popup de configuration, réordonnancement, édition du label du nœud racine.
- **Sprint 2** : ajout de composants/interfaces (clone réel), création d'éléments, correctif du bug de checkout de branche latent, atomicité de l'écriture du manifeste.
- **Sprint 3** : retrait de `/workspace` (redirection), matrice de conformité déplacée dans l'onglet Structure.

Tous les CA de `specs/T70.md` sont couverts (CA-1 à CA-7). Points hors scope explicitement documentés dans `specs/T70.md` restent hors scope (mise à jour de pin/suppression de dépendance, migration automatique des anciens nœuds locaux).

## Comment tester manuellement

1. Naviguer directement vers `/workspace?dir=<chemin d'un workspace ouvert>` → doit rediriger vers l'onglet Structure.
2. Même chose avec un `dir` invalide/supprimé → message d'erreur clair, pas de page blanche.
3. Depuis l'onglet Structure, cliquer "Conformité interfaces" → matrice affichée ; bouton "Structure" ramène à l'onglet Structure du même projet.
4. Simuler un vieux lien `/compliance?dir=...` (sans repoPath/projectId) → bouton "Structure" ne doit pas rester bloqué sur un chargement infini.
5. Repasser rapidement par les scénarios de test T70-N-01 à T70-N-05 et T70-E-01 à T70-E-07 de `specs/T70-tests.md` pour confirmer l'absence de régression cumulée sur les 3 sprints.

## Vérifications effectuées

- `tsc --noEmit` (`@polenta/desktop`) : aucune erreur.
- `/code-review` (3 angles combinés, effort proportionné à la taille du diff) : 5 constats, 3 corrigés, 2 documentés comme acceptés.
