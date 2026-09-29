# Workflow IA — Développement par agents enchaînés

## Principes

- Un agent = une phase = un contexte minimal
- Chaque agent lit ses inputs depuis des fichiers, écrit ses outputs dans des fichiers
- Les `[STOP HUMAIN]` sont des passages de relais entre agents
- Le chat sert uniquement aux questions et validations — jamais aux livrables

---

## Structure des répertoires

Chaque ticket a son propre worktree git, isolé du dossier principal :

```
~/
  mon-projet/          ← dossier principal (branche main, ne pas toucher pendant dev)
  mon-projet-GH43/      ← worktree Agent GH43
  mon-projet-GH45/      ← worktree Agent GH45
  mon-projet-GH47/      ← worktree Agent GH47
```

Le worktree est créé par l'Agent Spec et supprimé après merge.

## Tickets = issues GitHub

Un ticket est une **issue GitHub** du repo `laurentolive/polenta`, manipulée avec la CLI `gh`.
Le numéro de l'issue est l'identifiant du ticket : l'issue `#182` → ticket `GH182`.
Dans la suite, `{N}` désigne le numéro d'issue et `GH{N}` l'identifiant de ticket.

> Tickets antérieurs à la migration : ils ont gardé leur identifiant `T{N}` (titre d'issue
> « T179 — … », fichiers `specs/T179*.md`, commits `[T179]`). Pour eux, lire `T{N}` partout
> où ce document écrit `GH{N}` ; seul le numéro d'issue `{N}` des commandes `gh` diffère.

**Type** (posé à la création) : label `type:feature` ou `type:bug`.

**Statut** : un seul label `status:*` à la fois — l'agent retire l'ancien en posant le nouveau.

| Label                 | Phase                                               |
|-----------------------|-----------------------------------------------------|
| *(aucun)*             | nouveau ticket, pas encore pris en charge           |
| `status:specifying`   | Agent Spec                                          |
| `status:designing`    | Agent Design                                        |
| `status:coding`       | Agent Dev (le sprint en cours est noté en commentaire) |
| `status:debugging`    | Workflow Bug                                        |
| `status:validation`   | livrable présenté, en attente de validation humaine |
| `status:blocked`      | dépend d'un autre ticket (le citer : `dépend de #M`) |

Terminé = issue **fermée** (`gh issue close`), jamais seulement un label.

**Commandes usuelles :**
```
gh issue view {N} --comments                                   # lire le ticket
gh issue edit {N} --remove-label status:<ancien> --add-label status:<nouveau>
gh issue comment {N} --body "..."                              # trace de phase / STOP HUMAIN
gh issue close {N} --comment "..."                             # après validation humaine
gh issue list --label status:validation                        # tickets en attente de validation
```

**Commentaires** : à chaque changement de phase et à chaque `[STOP HUMAIN]`, l'agent poste un
commentaire court sur l'issue : phase, fichiers produits (chemins `specs/…`), sprint en cours,
point bloquant éventuel. Le commentaire est une trace et un index — le livrable lui-même
reste dans le fichier `specs/`, pas dans l'issue.

## Structure des fichiers par ticket

```
specs/
  GH{N}.md           ← spec stabilisée (Agent Spec) / root cause (Bug)
  GH{N}-design.md    ← design technique (Agent Design)
  GH{N}-tests.md     ← scénarios de test (Agent Design)
  GH{N}-sprint{K}.md ← résumé sprint K (Agent Dev)
```

Les fichiers `specs/` vivent dans le worktree `mon-projet-GH{N}/` et sont mergés vers main avec le code.

---

## Vue d'ensemble

```
[Agent Spec]  →  [STOP HUMAIN]  →  [Agent Design]  →  [STOP HUMAIN]  →  [Agent Dev x N]
```

Chaque agent reçoit une instruction courte qui lui dit quoi lire et quoi produire.

---

# Agent Spec

**Instruction de lancement :**
> Lis l'issue #{N} (`gh issue view {N} --comments`). Suis `WORKFLOW.md` phase Spec.

**Contexte chargé :** l'issue #{N} (description + commentaires) + code pertinent exploré à la demande

**Ce qu'il fait :**

1. Lit l'issue et pose le label `status:specifying`
2. Lit `specs/SPEC-INDEX.md` — identifie les sections pertinentes par mots-clés du ticket
3. Charge et lit uniquement ces sections ciblées (pas les fichiers SPEC entiers)
4. Explore le code existant pour comprendre le contexte
5. Identifie ambiguïtés, cas limites, règles manquantes
6. Pose ses questions à l'humain
7. Rédige `specs/GH{N}.md` avec :
   - description fonctionnelle détaillée
   - comportements attendus par cas d'usage
   - critères d'acceptation mesurables
   - hors scope explicite
   - `## Refs SPEC` : liste des sections consultées (ex: `SPEC-REQ.md §5`, `SPEC-TECH.md §4`)
8. Crée le worktree et la branche :
   ```
   git worktree add ../mon-projet-GH{N} -b GH{N}
   ```
   Tous les agents suivants pour ce ticket travaillent dans `../mon-projet-GH{N}/`.

**`[STOP HUMAIN]`** — pose `status:validation`, commente l'issue (lien vers `specs/GH{N}.md`), présente la spec et attend validation

- Refus → reprend les questions, met à jour le fichier
- Validation → termine, l'humain lance Agent Design dans `../mon-projet-GH{N}/`

---

# Agent Design

**Instruction de lancement :**
> Travaille dans `../mon-projet-GH{N}/`. Lis `specs/GH{N}.md`. Suis `WORKFLOW.md` phase Design.

**Contexte chargé :** `specs/GH{N}.md` + code existant exploré à la demande

**Ce qu'il fait :**

1. Pose le label `status:designing` sur l'issue
2. Analyse le code existant à la lumière de la spec
3. Propose découpage modules, interfaces, types, impacts
4. Rédige `specs/GH{N}-design.md` avec :
   - fichiers à modifier et pourquoi
   - nouvelles interfaces / types
   - décisions techniques et alternatives rejetées
5. Rédige `specs/GH{N}-tests.md` avec :
   - scénarios nominaux (golden path)
   - cas limites (liste vide, null, permissions)
   - critères d'acceptation vérifiables
6. Évalue si la feature tient en un sprint ou plusieurs
7. Si plusieurs sprints : documente le découpage dans `specs/GH{N}-design.md`

**`[STOP HUMAIN]`** — pose `status:validation`, commente l'issue (liens vers les deux fichiers, nombre de sprints), présente les fichiers et attend validation

- Refus design → reprend l'analyse, met à jour le fichier
- Validation → termine, l'humain lance Agent Dev (sprint 1)

---

# Agent Dev — Sprint K

**Instruction de lancement :**
> Travaille dans `../mon-projet-GH{N}/`. Lis `specs/GH{N}.md`, `specs/GH{N}-design.md`, `specs/GH{N}-tests.md`.
Sprint {K} : exécute uniquement le périmètre sprint {K} défini dans `specs/GH{N}-design.md`. Suis `WORKFLOW.md` phase Dev.

**Contexte chargé :** les 3 fichiers specs + code des fichiers listés dans le design uniquement

**Ce qu'il fait :**

1. Pose le label `status:coding` sur l'issue et commente « Sprint {K} démarré »
2. Implémente le périmètre du sprint
3. Vérifie TypeScript / lint — zéro erreur nouvelle
4. Lance `/code-review` sur le diff
5. Corrige les problèmes identifiés
6. Exécute les tests automatiques disponibles
7. Corrige jusqu'à zéro bug

**Si dernier sprint :**
8. Lit `## Refs SPEC` dans `specs/GH{N}.md`
9. Pour chaque section référencée : compare avec l'implémentation finale
   - Si divergence ou ajout : met à jour la section dans le fichier SPEC concerné
   - Note chaque section modifiée dans `GH{N}-sprint{K}.md` (§ Mises à jour SPEC)
10. Met à jour la colonne `MAJ` dans `specs/SPEC-INDEX.md` pour toutes les sections modifiées → `GH{N}`

11. Commit : `[GH{N}] feat(scope): GH{N} sprint{K} — description` + ligne `Refs #{N}` dans le corps (inclut les mises à jour SPEC si sprint final)
12. Rédige `specs/GH{N}-sprint{K}.md` avec :
    - fichiers modifiés
    - comportement implémenté
    - divergences éventuelles par rapport au design
    - mises à jour SPEC effectuées (section modifiée + résumé de la modification)
    - comment tester manuellement

**`[STOP HUMAIN]`** — pose `status:validation`, commente l'issue (lien vers `GH{N}-sprint{K}.md`, hash du commit), présente le résumé et la liste des scénarios de `GH{N}-tests.md`

- Non-conforme → reprend l'implémentation
- Divergence d'attente → escalade : l'humain relance Agent Design avec le contexte de l'écart
- Conforme → si autre sprint : l'humain lance Agent Dev sprint suivant
- Dernier sprint : propose merge vers main ; après merge validé, ferme l'issue (`gh issue close {N} --comment "…"`)

---

# Workflow Bug

**Instruction de lancement :**
> Lis l'issue #{N} (`gh issue view {N} --comments`). Suis `WORKFLOW.md` phase Bug.

**Contexte chargé :** l'issue #{N} (description + commentaires) + code suspect exploré à la demande

**Ce qu'il fait :**

1. Pose le label `status:debugging` sur l'issue
2. Analyse description, reproduction, comportement attendu
3. Pose ses questions à l'humain si reproduction floue
4. Crée le worktree et la branche :
   ```
   git worktree add ../mon-projet-GH{N} -b GH{N}
   ```
5. Identifie la root cause dans le code
6. Applique le correctif minimal — pas de refactoring annexe
7. Lance TypeScript / lint / tests unitaires
8. Rédige `specs/GH{N}.md` avec : root cause, correctif appliqué, comment vérifier
9. Commit : `[GH{N}] fix(scope): GH{N} — description` + ligne `Refs #{N}` dans le corps

**`[STOP HUMAIN]`** — pose `status:validation`, commente l'issue (root cause en une phrase, lien vers `specs/GH{N}.md`, hash du commit), présente root cause + correctif + comment reproduire

- Échec → reprend analyse
- Validation → propose merge ; après merge validé, ferme l'issue (`gh issue close {N} --comment "…"`)

---

# Règles communes à tous les agents

- **Chaque ticket a son propre worktree** `../mon-projet-GH{N}/` — ne jamais travailler dans le dossier principal
- **Après merge validé** : `git worktree remove ../mon-projet-GH{N}` puis `gh issue close {N}`
- Ne modifier que les fichiers liés au ticket en cours
- Un nouveau besoin découvert en cours de route → nouvelle issue (`gh issue create`), pas d'extension silencieuse du périmètre
- Tout livrable s'écrit dans un fichier — jamais seulement dans le chat
- Commit atomique avec préfixe `[GH{N}]` et `Refs #{N}` dans le corps — jamais `Closes/Fixes #{N}` (la fermeture se fait à la main après validation humaine)
- Ne jamais merger vers main sans validation humaine explicite
- En cas de doute sur le périmètre : s'arrêter et poser une question, ne pas supposer
