# T113 — Scénarios de test

## Golden path

1. Ouvrir un projet mono-repo (pas de dépendances `polenta-repo.yaml`). Dans Structure, cliquer
   "+" sur la ligne `root` → menu affiche "+ Composant", "+ Interface" (inchangé).
2. Cliquer "+ Composant" → cocher "Composant local (dans ce repo)" → les champs "Repo (URL git)"
   et "Branche" disparaissent (masqués, pas seulement désactivés) ; seul "Nom (montage)" reste.
   Saisir `name: "VE11D"` → Enregistrer.
3. Le nouveau sous-composant apparaît immédiatement dans l'arbre, au même niveau que les
   `objectTypes` de `root`, **sans** badge d'avertissement, avec son propre nom/label affiché et
   ses propres actions (`+ élément`, `✎`, `🗑`).
4. Cliquer "+ élément" sur ce sous-composant → choisir "Exigence" → `ElementConfigModal` s'ouvre,
   configurer prefix `VE11D`, catégorie `requirement`, enregistrer.
5. Créer une exigence dont l'`objectTypeRef` est `VE11D::<type>` depuis l'écran de création
   d'exigences (hors Structure) → la sauvegarde réussit, le fichier atterrit dans
   `requirements/` du repo courant (pas de sous-dossier séparé, pas de nouveau repo créé).
6. L'exigence créée apparaît dans la liste des exigences, dans un dashboard ("Avancement —
   répartition par statut" par ex.), et dans une requête SQL `SELECT * FROM requirements`.
7. Répéter la création d'un second sous-composant local (`name: "VE11C"`) dans le **même** repo →
   les deux coexistent dans l'arbre sans conflit, chacun avec ses propres `objectTypes`.

## Cas limites

- **Nom déjà utilisé** : tenter de créer un sous-composant `name: "root"` → erreur inline, pas de
  sauvegarde. Tenter un `name` identique à un sous-composant local déjà présent dans le même repo
  → erreur inline, pas de sauvegarde.
- **Nom vide** : clic sur "Ajouter" avec un nom vide affiche une erreur inline ("Le nom est
  obligatoire.") sans sauvegarder — pas de bouton désactivé, même mécanisme que la validation
  existante du formulaire (`formError`) pour le mode repo séparé.
- **Label** : pas de champ Label en mode "Composant local" à la création (retiré, cf. design §3.2)
  — le `SystemNode.label` créé est toujours replié sur `name`. Se renomme ensuite via l'icône
  crayon (`NodeEditModal`), comme n'importe quel autre sous-composant.
- **Suppression d'un sous-composant local contenant des `objectTypes` déjà utilisés par des
  exigences existantes** : la suppression retire le `SystemNode` (et la définition de ses types)
  du `schema.yaml` — les fichiers `requirements/*.yaml` déjà écrits avec cet `objectTypeRef` ne
  sont **pas** supprimés (comportement hérité de `handleDeleteOrphanNode`/suppression de type
  existante, inchangé par ce ticket — pas de garde-fou nouveau à ajouter, à documenter tel quel
  s'il n'y en avait pas avant).
- **Projet avec un `SystemNode` local pré-existant** (créé à la main ou par un ancien import,
  avant T113) : à l'ouverture, ce nœud s'affiche désormais comme un sous-composant normal (plus de
  badge, plus de bouton "Supprimer" forcé) — aucune migration de données, juste un changement de
  rendu.
- **Dépendance repo séparé réellement cassée** (`polenta-repo.yaml` déclare une dépendance dont le
  clone échoue) : la bannière d'erreur en haut de `StructureTab` (mécanisme existant, cf. design
  §1) s'affiche toujours — à vérifier qu'elle n'a pas régressé, pas de nouveau test à écrire au-delà
  d'une vérification manuelle de non-régression.
- **Deux repos différents du même workspace** (ex. `polenta-projet1` et `HMI`) créent chacun un
  sous-composant local avec le **même nom** (ex. `VE11D` dans les deux) : autorisé — l'unicité du
  `name` n'est vérifiée que dans le `schema.nodes[]` d'un seul repo, pas à travers le workspace
  (seul `prefix` d'`ObjectTypeDefinition` est contraint à l'unicité globale, déjà géré par
  `allPrefixes`, inchangé).

## Critères d'acceptation (repris/précisés depuis la spec)

- [ ] La case "Composant local" de "+ Composant" est disponible sur toute `RepoRow` (root et
  composants repo-séparé), pour `kind === 'component'` uniquement (absente pour "+ Interface").
- [ ] Créer un sous-composant local n'écrit que dans `.polenta/schema.yaml` du repo ciblé — aucun
  fichier créé hors de ce repo, `polenta-repo.yaml` inchangé.
- [ ] Aucun sous-composant local (nouveau ou pré-existant) n'affiche de badge d'avertissement après
  ce ticket.
- [ ] Une dépendance repo séparé cassée continue de déclencher la bannière d'erreur existante
  (non-régression).
- [ ] Créer/lire/lister une exigence sur un sous-composant local fonctionne de bout en bout dans
  l'UI (formulaire → fichier → liste → dashboard → requête SQL).
- [ ] `pnpm typecheck` (ou équivalent lint desktop) : zéro nouvelle erreur.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev`.
2. Ouvrir (ou créer) un projet simple, aller dans Modèle de données → Structure.
3. Suivre le golden path ci-dessus intégralement.
4. Fermer/rouvrir le projet — vérifier que le sous-composant local et ses exigences persistent et
   s'affichent sans badge après rechargement (index reconstruit depuis le disque).
