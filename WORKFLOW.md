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
  mon-projet-T43/      ← worktree Agent T43
  mon-projet-T45/      ← worktree Agent T45
  mon-projet-T47/      ← worktree Agent T47
```

Le worktree est créé par l'Agent Spec et supprimé après merge.

## Structure des fichiers par ticket

```
specs/
  T{N}.md           ← spec stabilisée (Agent Spec)
  T{N}-design.md    ← design technique (Agent Design)
  T{N}-tests.md     ← scénarios de test (Agent Design)
  T{N}-sprint{K}.md ← résumé sprint K (Agent Dev)
TICKETS.md          ← statut global
```

Les fichiers `specs/` vivent dans le worktree `mon-projet-T{N}/` et sont mergés vers main avec le code.

---

## Vue d'ensemble

```
[Agent Spec]  →  [STOP HUMAIN]  →  [Agent Design]  →  [STOP HUMAIN]  →  [Agent Dev x N]
```

Chaque agent reçoit une instruction courte qui lui dit quoi lire et quoi produire.

---

# Agent Spec

**Instruction de lancement :**
> Lis `TICKETS.md` section T{N}. Suis `WORKFLOW.md` phase Spec.

**Contexte chargé :** TICKETS.md (section T{N} uniquement) + code pertinent exploré à la demande

**Ce qu'il fait :**

1. Lit le ticket et le passe en "specifying" dans TICKETS.md
2. Lit `specs/SPEC-INDEX.md` — identifie les sections pertinentes par mots-clés du ticket
3. Charge et lit uniquement ces sections ciblées (pas les fichiers SPEC entiers)
4. Explore le code existant pour comprendre le contexte
5. Identifie ambiguïtés, cas limites, règles manquantes
6. Pose ses questions à l'humain
7. Rédige `specs/T{N}.md` avec :
   - description fonctionnelle détaillée
   - comportements attendus par cas d'usage
   - critères d'acceptation mesurables
   - hors scope explicite
   - `## Refs SPEC` : liste des sections consultées (ex: `SPEC-REQ.md §5`, `SPEC-TECH.md §4`)
8. Crée le worktree et la branche :
   ```
   git worktree add ../mon-projet-T{N} -b T{N}
   ```
   Tous les agents suivants pour ce ticket travaillent dans `../mon-projet-T{N}/`.

**`[STOP HUMAIN]`** — présente `specs/T{N}.md` et attend validation

- Refus → reprend les questions, met à jour le fichier
- Validation → termine, l'humain lance Agent Design dans `../mon-projet-T{N}/`

---

# Agent Design

**Instruction de lancement :**
> Travaille dans `../mon-projet-T{N}/`. Lis `specs/T{N}.md`. Suis `WORKFLOW.md` phase Design.

**Contexte chargé :** `specs/T{N}.md` + code existant exploré à la demande

**Ce qu'il fait :**

1. passe le ticket en "designing" dans TICKETS.md
2. Analyse le code existant à la lumière de la spec
3. Propose découpage modules, interfaces, types, impacts
4. Rédige `specs/T{N}-design.md` avec :
   - fichiers à modifier et pourquoi
   - nouvelles interfaces / types
   - décisions techniques et alternatives rejetées
5. Rédige `specs/T{N}-tests.md` avec :
   - scénarios nominaux (golden path)
   - cas limites (liste vide, null, permissions)
   - critères d'acceptation vérifiables
6. Évalue si la feature tient en un sprint ou plusieurs
7. Si plusieurs sprints : documente le découpage dans `specs/T{N}-design.md`

**`[STOP HUMAIN]`** — présente les deux fichiers et attend validation

- Refus design → reprend l'analyse, met à jour le fichier
- Validation → termine, l'humain lance Agent Dev (sprint 1)

---

# Agent Dev — Sprint K

**Instruction de lancement :**
> Travaille dans `../mon-projet-T{N}/`. Lis `specs/T{N}.md`, `specs/T{N}-design.md`, `specs/T{N}-tests.md`.
Sprint {K} : exécute uniquement le périmètre sprint {K} défini dans `specs/T{N}-design.md`. Suis `WORKFLOW.md` phase Dev.

**Contexte chargé :** les 3 fichiers specs + code des fichiers listés dans le design uniquement

**Ce qu'il fait :**

1. passe le ticket en "coding sprint {k}" dans TICKETS.md
2. Implémente le périmètre du sprint
3. Vérifie TypeScript / lint — zéro erreur nouvelle
4. Lance `/code-review` sur le diff
5. Corrige les problèmes identifiés
6. Exécute les tests automatiques disponibles
7. Corrige jusqu'à zéro bug

**Si dernier sprint :**
8. Lit `## Refs SPEC` dans `specs/T{N}.md`
9. Pour chaque section référencée : compare avec l'implémentation finale
   - Si divergence ou ajout : met à jour la section dans le fichier SPEC concerné
   - Note chaque section modifiée dans `T{N}-sprint{K}.md` (§ Mises à jour SPEC)
10. Met à jour la colonne `MAJ` dans `specs/SPEC-INDEX.md` pour toutes les sections modifiées → `T{N}`

11. Commit : `feat(scope): T{N} sprint{K} — description` (inclut les mises à jour SPEC si sprint final)
12. Rédige `specs/T{N}-sprint{K}.md` avec :
    - fichiers modifiés
    - comportement implémenté
    - divergences éventuelles par rapport au design
    - mises à jour SPEC effectuées (section modifiée + résumé de la modification)
    - comment tester manuellement

**`[STOP HUMAIN]`** — présente le résumé et la liste des scénarios de `T{N}-tests.md`

- Non-conforme → reprend l'implémentation
- Divergence d'attente → escalade : l'humain relance Agent Design avec le contexte de l'écart
- Conforme → si autre sprint : l'humain lance Agent Dev sprint suivant
- Dernier sprint : archive le ticket de TICKETS.md vers tickets_archive.md, propose merge vers main

---

# Workflow Bug

**Instruction de lancement :**
> Lis `TICKETS.md` section T{N}. Suis `WORKFLOW.md` phase Bug.

**Contexte chargé :** TICKETS.md (section T{N}) + code suspect exploré à la demande

**Ce qu'il fait :**

1. passe le ticket en "debugging" dans TICKETS.md
2. Analyse description, reproduction, comportement attendu
3. Pose ses questions à l'humain si reproduction floue
4. Crée le worktree et la branche :
   ```
   git worktree add ../mon-projet-T{N} -b T{N}
   ```
5. Identifie la root cause dans le code
6. Applique le correctif minimal — pas de refactoring annexe
7. Lance TypeScript / lint / tests unitaires
8. Rédige `specs/T{N}.md` avec : root cause, correctif appliqué, comment vérifier
9. Commit : `fix(scope): T{N} — description`

**`[STOP HUMAIN]`** — présente root cause + correctif + comment reproduire

- Échec → reprend analyse
- Validation → met TICKETS.md à jour (→ Done), propose merge

---

# Règles communes à tous les agents

- **Chaque ticket a son propre worktree** `../mon-projet-T{N}/` — ne jamais travailler dans le dossier principal
- **Après merge validé** : `git worktree remove ../mon-projet-T{N}`
- Ne modifier que les fichiers liés au ticket en cours
- Tout livrable s'écrit dans un fichier — jamais seulement dans le chat
- Commit atomique avec préfixe `[T{N}]`
- Ne jamais merger vers main sans validation humaine explicite
- En cas de doute sur le périmètre : s'arrêter et poser une question, ne pas supposer
