# Workflow IA — Développement par agents enchaînés

## Principes

- Un agent = une phase = un contexte minimal
- Chaque agent lit ses inputs depuis des fichiers, écrit ses outputs dans des fichiers
- **Deux `[STOP HUMAIN]` seulement par ticket** : la spec (en amont) et la validation finale
  sur `main` local avant push (en aval). Entre les deux, design et sprints s'enchaînent sans
  arrêt — l'agent ne s'arrête que sur une vraie question (§ Règles communes)
- L'humain teste dans son dossier principal, sur `main` local où le ticket vient d'être mergé —
  jamais besoin de rouvrir le worktree du ticket
- Le chat sert uniquement aux questions et validations — jamais aux livrables

---

## Structure des répertoires

Chaque ticket a son propre worktree git, isolé du dossier principal :

```
~/
  mon-projet/          ← dossier principal (branche main) : l'humain y teste à la validation finale
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
| `status:validation`   | spec présentée, ou ticket mergé sur `main` local et en attente de validation avant push |
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

## Branches et pull requests

Tout ticket a une **pull request** `GH{N}` → `main` : c'est elle qui relie le code à l'issue
sur GitHub (panneau « Development » de l'issue, liste des commits, diff). Le merge, lui, se fait
**en local** dans le dossier principal (§ Validation finale) : quand `main` est poussé, GitHub
voit que la tête de la branche est dans `main` et marque la PR « merged » d'elle-même.

- **Premier commit sur la branche** : la pousser et ouvrir la PR en brouillon
  ```
  git push -u origin GH{N}
  gh pr create --draft --base main --head GH{N} --title "GH{N} — <titre de l'issue>" --body "Closes #{N}"
  ```
  Le corps peut être complété (résumé, liens `specs/…`), mais garde la ligne `Closes #{N}`.
- **Commits suivants** : `git push` après chaque commit — la PR se met à jour toute seule.
- **Commentaires `[STOP HUMAIN]`** sur l'issue : citer la PR (`#<numéro de PR>`) en plus du hash.
- **Merge** : merge local `--no-ff` dans le dossier principal, **non poussé** tant que l'humain n'a
  pas validé ; le commit de merge porte `Closes #{N}`, qui ferme l'issue au push (détail :
  § Validation finale). On n'utilise plus `gh pr merge`.

## Branche d'intégration de milestone

Un milestone de plusieurs tickets peut être intégré dans une **branche dédiée** `milestone-<X>`
(ex. `milestone-D`) plutôt que dans `main`, sur décision de l'humain. Elle a son propre worktree
`../mon-projet-milestone-<X>/` et une **PR parapluie** en brouillon `milestone-<X>` → `main`.

Tant que le milestone est ouvert, partout où ce document écrit `main` / « dossier principal » pour
un ticket du milestone, lire `milestone-<X>` / « worktree du milestone » :

- **Création** (une fois, par le premier agent du milestone) :
  ```
  git worktree add ../mon-projet-milestone-<X> -b milestone-<X> origin/main
  git push -u origin milestone-<X>
  gh pr create --draft --base main --head milestone-<X> --title "Milestone <X> — <titre du milestone>" --body "<objet>"
  ```
- **Ticket** : worktree créé depuis la branche du milestone
  (`git worktree add ../mon-projet-GH{N} -b GH{N} milestone-<X>`), PR `--base milestone-<X>`.
- **Validation finale** : mêmes préconditions et mêmes étapes, appliquées au worktree du milestone
  (propre ; `rev-list origin/milestone-<X>..milestone-<X>` vide) : `git merge milestone-<X>` dans le
  worktree du ticket, puis `merge --no-ff GH{N}` dans le worktree du milestone, non poussé.
- **Après validation** : `git -C ../mon-projet-milestone-<X> push`, ajout de `Closes #{N}` au corps
  de la PR parapluie, puis **fermeture de l'issue à la main** (`gh issue close`) : `Closes` ne ferme
  une issue qu'au merge dans la branche par défaut. Nettoyage du worktree et de la branche du ticket
  comme d'habitude.
- **Fin du milestone** : la PR parapluie suit le même cycle qu'un ticket (merge local `--no-ff`
  dans le dossier principal, validation humaine, push de `main`).

> Une PR de ticket ouverte vers `main` et déjà mergée dans la branche du milestone ne peut pas être
> réorientée (GitHub : « no new commits ») : la fermer avec un renvoi vers la PR parapluie.

---

## Vue d'ensemble

```
Feature : [Agent Spec] → [STOP HUMAIN spec] → [Design → Dev sprint 1..N] → merge main local → [STOP HUMAIN validation] → push
Bug     : [Workflow Bug]                                                  → merge main local → [STOP HUMAIN validation] → push
```

Après validation de la spec, **une seule instruction** lance tout l'aval : design, puis tous les
sprints, puis le merge local et la présentation de validation. Le design reste écrit dans
`specs/` (trace, et cadre des sprints) mais n'est plus relu avant le dev ; l'humain peut le
consulter dans la PR à tout moment.

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
   - **Nouvel indicateur** (statut dérivé, agrégat, score, colonne calculée…) : appliquer le
     principe « données brutes dans Polenta, indicateurs de suivi côté projet »
     (`specs/SPEC-TECH-stack.md` §1.1) — *sert-il à une fonction de Polenta ?* Sinon, il
     relève d'un script côté projet, pas de code Polenta.
6. Pose ses questions à l'humain
7. Rédige `specs/GH{N}.md` avec :
   - description fonctionnelle détaillée
   - comportements attendus par cas d'usage
   - critères d'acceptation mesurables
   - hors scope explicite
   - si le ticket introduit un indicateur : la décision Polenta / côté projet et sa justification
   - `## Refs SPEC` : liste des sections consultées (ex: `SPEC-REQ.md §5`, `SPEC-TECH.md §4`)
8. Crée le worktree et la branche :
   ```
   git worktree add ../mon-projet-GH{N} -b GH{N}
   ```
   Tous les agents suivants pour ce ticket travaillent dans `../mon-projet-GH{N}/`.

**`[STOP HUMAIN]`** — pose `status:validation`, commente l'issue (lien vers `specs/GH{N}.md`), présente la spec et attend validation

- Refus → reprend les questions, met à jour le fichier
- Validation → si l'humain l'a demandé dans sa réponse (« go », « enchaîne »…), l'agent enchaîne
  directement sur la phase Design dans `../mon-projet-GH{N}/` ; sinon il termine et l'humain lance
  l'instruction de la phase Design

---

# Agent Design

**Instruction de lancement :**
> Travaille dans `../mon-projet-GH{N}/`. Lis `specs/GH{N}.md`. Suis `WORKFLOW.md` de la phase Design jusqu'à la validation finale.

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

8. Commit des deux fichiers (`[GH{N}] docs(specs): GH{N} — design et scénarios de test`), push,
   commentaire sur l'issue (liens vers les deux fichiers, nombre de sprints)

**Pas de stop** : enchaîne directement sur Agent Dev sprint 1.

Seule exception — **escalade** : la conception révèle que la spec est incomplète, contradictoire,
ou impose un choix structurant qu'elle ne tranche pas (changement de format de fichier,
d'API publique, du modèle de données…). L'agent pose alors la question, met à jour
`specs/GH{N}.md` avec la réponse, et reprend.

---

# Agent Dev — Sprint K

**Lancement :** enchaîné par l'Agent Design (sprint 1) puis par le sprint précédent. Pour
reprendre un ticket interrompu :
> Travaille dans `../mon-projet-GH{N}/`. Lis `specs/GH{N}.md`, `specs/GH{N}-design.md`, `specs/GH{N}-tests.md`.
Reprends au sprint {K} défini dans `specs/GH{N}-design.md`. Suis `WORKFLOW.md` de la phase Dev jusqu'à la validation finale.

**Contexte chargé :** les 3 fichiers specs + code des fichiers listés dans le design uniquement.
Chaque sprint n'exécute que son propre périmètre.

**Ce qu'il fait :**

1. Pose le label `status:coding` sur l'issue et commente « Sprint {K} démarré »
2. Implémente le périmètre du sprint
3. Vérifie TypeScript / lint — zéro erreur nouvelle
4. Lance `/code-review` sur le diff
5. Corrige les problèmes identifiés
6. Exécute les tests automatiques disponibles : `pnpm test` (unitaires) et, si le ticket touche le
   renderer, les services du main ou le serveur web, les tests de bout en bout du client web
   (`pnpm --filter @polenta/desktop test:e2e:web`, cf. `apps/desktop/e2e-web/README.md`). Les
   scénarios du ticket qui peuvent l'être sont ajoutés en e2e (`e2e-web/gh{N}-*.spec.ts`) plutôt que
   laissés en test manuel.
7. Corrige jusqu'à zéro bug

**Si dernier sprint :**
8. Lit `## Refs SPEC` dans `specs/GH{N}.md`
9. Pour chaque section référencée : compare avec l'implémentation finale
   - Si divergence ou ajout : met à jour la section dans le fichier SPEC concerné
   - Note chaque section modifiée dans `GH{N}-sprint{K}.md` (§ Mises à jour SPEC)
10. Met à jour la colonne `MAJ` dans `specs/SPEC-INDEX.md` pour toutes les sections modifiées → `GH{N}`

11. Rédige `specs/GH{N}-sprint{K}.md` avec :
    - fichiers modifiés
    - comportement implémenté
    - divergences éventuelles par rapport au design
    - mises à jour SPEC effectuées (section modifiée + résumé de la modification)
    - comment tester manuellement
12. Commit : `[GH{N}] feat(scope): GH{N} sprint{K} — description` + ligne `Refs #{N}` dans le corps
    (inclut le résumé de sprint, et les mises à jour SPEC si sprint final), puis `git push`
13. Commente l'issue : « Sprint {K} terminé » + lien vers `GH{N}-sprint{K}.md` + hash

**Pas de stop entre sprints** :
- autre sprint prévu → enchaîne sur le sprint {K+1}
- dernier sprint → enchaîne sur la **Validation finale**

Une divergence de fond avec le design en cours de sprint (le design ne tient pas) : l'agent
corrige `specs/GH{N}-design.md`, le note dans le résumé de sprint et continue ; il ne s'arrête que
si l'écart touche la spec (même règle d'escalade que l'Agent Design).

---

# Validation finale — merge sur `main` local

Commune aux features (après le dernier sprint) et aux bugs (après le correctif). Le ticket est
mergé dans le **dossier principal** (`mon-projet/`, branche `main`) **sans être poussé** :
l'humain teste là où il travaille d'habitude, puis autorise le push.

**Préconditions** (sinon : s'arrêter et le signaler à l'humain, ne rien forcer) :
- le dossier principal est sur `main` et propre : `git -C <dossier principal> status --porcelain` vide
- aucun autre ticket n'y attend déjà sa validation : `git -C <dossier principal> fetch` puis
  `git -C <dossier principal> rev-list origin/main..main` vide — **un seul ticket à la fois** en
  attente de push, sinon pousser l'un pousserait l'autre

**Ce qu'il fait :**

1. Met la branche à jour avec `main` **dans le worktree** (les conflits se règlent là, pas dans le
   dossier principal) :
   ```
   git -C <dossier principal> pull --ff-only
   git merge main                 # dans ../mon-projet-GH{N}/
   ```
   S'il y a eu des changements : relance typecheck / lint / tests, commit, `git push`.
2. Passe la PR en prêt : `gh pr ready GH{N}`
3. Merge local dans le dossier principal, sans push :
   ```
   git -C <dossier principal> merge --no-ff GH{N} -m "Merge GH{N} — <titre de l'issue>" -m "Closes #{N}"
   ```
4. Si `pnpm-lock.yaml` a changé : `pnpm install` dans le dossier principal. Build / typecheck pour
   que l'humain puisse lancer l'appli directement.
5. Pose `status:validation`, commente l'issue (PR, hash du merge local, lien vers le dernier
   `GH{N}-sprint{K}.md` ou `specs/GH{N}.md` pour un bug)

**`[STOP HUMAIN]`** — présente :
- le résumé de ce qui a été fait (et pour un bug : root cause en une phrase)
- la liste des scénarios de `GH{N}-tests.md` (ou « comment vérifier » du bug) **qui ne sont pas
  couverts par les tests automatiques** — c'est ce que l'humain doit tester à la main
- comment lancer l'appli depuis le dossier principal

Réponses possibles :
- **Validé** → push et nettoyage :
  ```
  git -C <dossier principal> push origin main     # PR marquée merged, issue fermée par « Closes #{N} »
  git worktree remove ../mon-projet-GH{N}
  git branch -d GH{N}
  git push origin --delete GH{N}
  ```
  Puis commentaire de clôture sur l'issue (`gh issue comment {N}`).
- **Non conforme** → l'agent corrige **dans le worktree**, commit, push de la branche, puis
  re-merge dans le dossier principal (nouveau `merge --no-ff`, même message) et re-présente. Pas
  de reset de `main` : le premier merge local reste, le correctif s'ajoute par-dessus.
- **Divergence d'attente** (la spec n'était pas la bonne) → mettre à jour `specs/GH{N}.md` avec
  l'humain, puis reprendre au design ou au sprint concerné.
- **Abandon** → uniquement sur demande explicite : `git -C <dossier principal> reset --hard origin/main`
  (efface le merge local non poussé), la branche et la PR restent ouvertes.

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
7. Lance TypeScript / lint / tests unitaires ; ajoute un test (unitaire ou e2e) qui reproduit le bug
   quand c'est possible
8. Rédige `specs/GH{N}.md` avec : root cause, correctif appliqué, comment vérifier
9. Commit : `[GH{N}] fix(scope): GH{N} — description` + ligne `Refs #{N}` dans le corps, push et
   PR en brouillon (§ Branches et pull requests)

**Pas de stop** : enchaîne directement sur la **Validation finale**, qui présente root cause +
correctif + comment vérifier.

---

# Règles communes à tous les agents

- **Chaque ticket a son propre worktree** `../mon-projet-GH{N}/` — ne jamais développer dans le dossier principal (on n'y fait que le merge local de la validation finale)
- **Chaque ticket a sa pull request** `GH{N}` → `main`, ouverte en brouillon dès le premier commit (§ Branches et pull requests)
- **Ne jamais pousser `main` sans validation humaine explicite** du ticket mergé localement (§ Validation finale) — un seul ticket à la fois en attente de push (même règle pour une branche de milestone, § Branche d'intégration de milestone)
- **Stops** : seulement la spec et la validation finale. En dehors, l'agent ne s'arrête que pour
  une question qui change le résultat (ambiguïté de périmètre, spec contradictoire, choix
  structurant non tranché) — pas pour faire valider un livrable intermédiaire
- Ne modifier que les fichiers liés au ticket en cours
- Un nouveau besoin découvert en cours de route → nouvelle issue (`gh issue create`), pas d'extension silencieuse du périmètre
- Tout livrable s'écrit dans un fichier — jamais seulement dans le chat
- Commit atomique avec préfixe `[GH{N}]` et `Refs #{N}` dans le corps — jamais `Closes/Fixes #{N}` dans un commit de la branche (seuls la PR et le commit de merge local portent `Closes #{N}`, qui ne ferme l'issue qu'au push validé de `main`)
- En cas de doute sur le périmètre : s'arrêter et poser une question, ne pas supposer
