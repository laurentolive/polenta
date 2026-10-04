# GH37 — Scénarios de test

Spec : `specs/GH37.md` — Design : `specs/GH37-design.md`

Légende : **[U]** test unitaire vitest (`packages/merge-core`), **[M]** test manuel dans l'app
(projet démo ou repo de test avec un remote local `file://` ou bare), **[S]** sprint concerné.

## Préparation (tests manuels)

Repo de test avec un remote bare local. Deux clones A et B (A = utilisateur testé dans l'app,
B = « collègue », manipulé en CLI ou dans une 2e instance). Pour fabriquer un conflit Publier :
B modifie et publie (push), A modifie le même élément sans fetch, puis A clique « Publier ».

## 1. Moteur de merge (`merge-core`) — [U]

| # | Cas | Attendu | S |
|---|---|---|---|
| U1 | Objet : `priority` changé à gauche, `statement` changé à droite | 0 bloc ; sortie = les deux changements ; `auto` = priority←gauche, statement←droite | 1 |
| U2 | Objet : `statement` changé différemment des deux côtés | 1 bloc `fields.statement` ; sortie contient une région de marqueurs nommée `[fields.statement]` | 1 |
| U3 | Objet : même changement des deux côtés | 0 bloc, `auto` from `both` | 1 |
| U4 | Objet : `version` 1→2 à gauche, 1→3 à droite | pas de bloc, `version: 3` | 1 |
| U5 | Objet : `needsRevalidation` posé d'un seul côté | repris, pas de bloc | 1 |
| U6 | Objet ajouté des deux côtés (base absente), contenus différents | blocs sur chaque clé différente, `kind: object` | 1 |
| U7 | `parseOutput` avec 2 régions ouvertes | `unresolved` = 2 clés, `value` = le reste, pas d'erreur | 1 |
| U8 | `resolveBlock(…, 'left')` sur une région | région remplacée par le fragment gauche, indentation correcte, YAML valide | 1 |
| U9 | `renderOutput` après résolution complète | identique à `js-yaml.dump(value, { lineWidth: 120 })` (format `GitService.writeYaml`) | 1 |
| U10 | Texte : modifications sur des lignes disjointes | 0 bloc (comme diff3/git) | 1 |
| U11 | Texte : même ligne modifiée des deux côtés | 1 bloc `hunk:0` | 1 |
| U12 | Fichier contenant un octet nul | `kind: binary` | 1 |
| U13 | Champ richtext multi-ligne en conflit (`|` bloc littéral) | la région de marqueurs encadre le bloc complet ; retirer la région → YAML valide | 1 |
| U14 | Texte de sortie YAML invalide hors marqueurs | `parseOutput` → `error`, pas d'exception | 2 |
| U15 | `links.yaml` : lien ajouté à gauche + autre lien ajouté à droite | 0 bloc, union, ordre droite puis gauche | 3 |
| U16 | `links.yaml` : même lien modifié différemment | 1 bloc `link:<id>` | 3 |
| U17 | `parameters.yaml` : clés ajoutées des deux côtés | union triée | 3 |
| U18 | `renumberText('… SYS-0043 …', 'SYS-0043', 'SYS-0044')` | remplacé ; `SYS-00431` et `XSYS-0043` intacts | 3 |
| U19 | `renumberPath('test-runs/TEST-0012/RUN-1.yaml')` | `test-runs/TEST-0013/RUN-1.yaml` | 3 |
| U20 | `nextFreeId('SYS', [SYS-0041.yaml, tombstones/SYS-0045, SYS-0043.yaml])` | `SYS-0046` | 3 |

## 2. Golden path — Publier [M]

| # | Scénario | Attendu | S |
|---|---|---|---|
| M1 | Conflit sur `statement` de `SYS-0012` (cf. préparation) | Popup « Publication impossible » avec bouton **Résoudre les conflits** ; plus de lien vers le diff en lecture seule | 1 |
| M2 | Clic « Résoudre les conflits » | Onglet « Conflits — <repo> » ; liste = `requirements/SYS-0012.yaml`, badge « modifié des deux côtés », 0/1 mergé | 1 |
| M3 | Disposition | Gauche = mes modifications (`dev-*`), droite = intégration, sortie en bas pleine largeur | 1 |
| M4 | « ← Prendre gauche » sur le bloc | Sortie = valeur gauche, région disparue, « Merger » actif | 1 |
| M5 | Édition libre de la sortie en Raw puis « Merger » | Fichier état **Mergé**, compteur 1/1, « Finaliser » actif | 1 |
| M6 | « Finaliser le merge » | Commit de merge à 2 parents (intégration, `dev-*`) sur l'intégration ; repo checkouté sur l'intégration, `dev-*` supprimée, push fait ; onglet fermé, message de confirmation ; le contenu de `SYS-0012.yaml` sur disque = sortie validée | 1 |
| M7 | `git status` dans le repo après M6 | Propre ; `git log --graph` montre le merge | 1 |
| M8 | Pendant toute la résolution (M2–M5) | `git status` du WD inchangé (aucun marqueur, aucun fichier modifié) | 1 |
| M9 | Workspace multi-repos : conflit sur `compB` après publication de `compA` (GH38) | Après finalisation de `compB`, la publication reprend avec le même titre et publie la racine (pin `compB` inclus) | 1 |
| M10 | Conflit sur 3 fichiers | Liste de 3 ; « Merger » passe au suivant non résolu ; « Finaliser » actif seulement à 3/3 | 1 |

## 3. Blocs, validation, édition [M]

| # | Scénario | Attendu | S |
|---|---|---|---|
| M11 | Changements sur deux champs différents du même objet | Fichier **non listé** (fusion par champ automatique) | 1 |
| M12 | « Tout prendre à droite » | Tous les blocs du fichier résolus avec la droite | 1 |
| M13 | Laisser un marqueur dans la sortie Raw | « Merger » désactivé, info-bulle « bloc non résolu » | 1 |
| M14 | Rendre le YAML invalide | « Merger » désactivé, erreur affichée ; texte conservé | 1 |
| M15 | Changer `id` dans la sortie | Erreur « l'id doit correspondre au nom de fichier » | 1 |
| M16 | Statut inexistant pour le type | Erreur bloquante | 1 |
| M17 | `statement` non EARS / champ `required` vidé | Avertissement non bloquant | 2 |
| M18 | Rouvrir un fichier **Mergé** et le modifier | État repasse à « À résoudre » jusqu'au nouveau « Merger » | 1 |

## 4. Mode Rendu et ancêtre commun [M]

| # | Scénario | Attendu | S |
|---|---|---|---|
| M19 | Bascule Rendu sur une exigence | Les 3 panneaux montrent l'objet rendu (richtext formaté, enum, drawio) comme dans l'outil | 2 |
| M20 | Bloc non résolu en Rendu | Carte de conflit avec valeurs gauche/droite rendues + boutons | 2 |
| M21 | Éditer un champ richtext dans la sortie en Rendu, rebasculer en Raw | Raw reflète la modification ; et inversement | 2 |
| M22 | YAML invalide en Raw puis bascule Rendu | Rendu indisponible avec message ; retour Raw sans perte | 2 |
| M23 | Test (steps) en conflit sur `steps` | Un seul bloc `steps` ; rendu tableau des steps | 2 |
| M24 | « Afficher l'ancêtre commun » | Haut en 3 colonnes : mes modifs · ancêtre · destination ; sortie inchangée en bas | 2 |
| M25 | Ancêtre sur un fichier ajouté des deux côtés | Panneau « Fichier absent de l'ancêtre commun » | 2 |
| M26 | Fermer/rouvrir l'onglet | Choix ancêtre et hauteur du séparateur mémorisés | 2 |
| M27 | Défilement d'un panneau | Les autres suivent sur le même bloc | 2 |
| M28 | Fichier `.drawio` / `trees` en conflit | Bascule Rendu désactivée avec info-bulle ; Raw par hunks | 2 |
| M29 | Thème sombre / langue EN | Couleurs des blocs lisibles ; libellés traduits | 2 |

## 5. Autres points d'entrée [M]

| # | Scénario | Attendu | S |
|---|---|---|---|
| M30 | `/graph` → merge d'une branche en conflit dans la branche courante | Message + « Résoudre les conflits » ; gauche = branche mergée, droite = courante ; après finalisation, branche courante avancée, WD aligné, graphe rafraîchi | 3 |
| M31 | `/graph` → mergeInto (branche non checkoutée) | Idem ; ref `into` avancée, WD non touché | 3 |
| M32 | Rafraîchir sur un repo **SSH** divergent en conflit | Aucun marqueur dans le WD ; message + « Résoudre » ; gauche = local, droite = `origin/<b>` ; après finalisation, branche locale = merge, WD aligné | 3 |
| M33 | Rafraîchir sans conflit (HTTPS et SSH) | Comportement inchangé (pull réussi, WD à jour) | 3 |
| M34 | Finaliser alors que la branche cible checkoutée a des modifications non commitées | Refus `dirty-worktree`, message, rien d'écrit | 3 |

## 6. Conflits particuliers [M]

| # | Scénario | Attendu | S |
|---|---|---|---|
| M35 | B supprime `SYS-0020` (pierre tombale), A le modifie | Badge « supprimé à droite » ; « Garder » → fichier présent après finalisation, pierre tombale absente | 3 |
| M36 | Idem, « Supprimer » | Fichier absent, pierre tombale présente | 3 |
| M37 | A et B créent chacun `SYS-0043` | Badge « ajouté des deux côtés » ; « Garder les deux » montre `SYS-0044` + fichiers impactés (links, trees…) avant confirmation | 3 |
| M38 | Confirmer M37 et finaliser | `SYS-0043` = objet de B, `SYS-0044` = objet de A ; liens et place dans l'arbre de A pointent sur `SYS-0044` ; ceux de B sur `SYS-0043` | 3 |
| M39 | M37 avec une pierre tombale `SYS-0044` côté B | ID attribué `SYS-0045` | 3 |
| M40 | Fichiers impactés par la renumérotation non conflictuels | Listés « renuméroté », À résoudre, sortie pré-remplie, « Merger » actif | 3 |
| M41 | Image modifiée des deux côtés | Aperçu, choix gauche/droite seulement | 3 |
| M42 | `links.yaml` : liens ajoutés des deux côtés | Pas de conflit ; les deux liens présents | 3 |

## 7. Abandon, reprise, cas limites [M]

| # | Scénario | Attendu | S |
|---|---|---|---|
| M43 | « Abandonner » avec 1 fichier mergé | Confirmation ; onglet fermé ; repo, branches, WD strictement inchangés ; brouillon supprimé | 1 |
| M44 | Merger 2/5 fichiers, fermer l'app, relancer, bouton « Reprendre la résolution des conflits » (à côté de « Publier ») | Les 2 fichiers sont Mergés avec leurs sorties ; le fichier en cours d'édition retrouve son texte ; « Finaliser » termine la publication | 1 |
| M45 | Comme M44 mais B a publié entre-temps (intégration a bougé) | Brouillon signalé périmé, résolution neuve | 3 |
| M46 | Finaliser alors qu'une des branches a bougé depuis l'ouverture | Refus `stale`, message, rien d'écrit | 1 |
| M47 | Brouillons | Présents uniquement sous `userData/merge-drafts/`, jamais dans le repo | 1 |
| M47b | Après le conflit, modifier un fichier sur `dev-*` sans committer, puis « Finaliser » | Refus « modifications non commitées », rien d'écrit | 1 |
| M47c | Fichier Mergé, le modifier puis cliquer tout de suite « Finaliser » | « Finaliser » est désactivé dès la modification (fichier repassé « À résoudre ») | 1 |
| M48 | Rebase en conflit depuis `/graph` | Inchangé (abort automatique, pas d'éditeur) | 3 |

## 8. Non-régression

- Publier sans conflit, mono et multi-repos (GH38) : inchangé.
- Auto-pull (T155) : toujours fast-forward only, jamais de session de résolution.
- `/version-diff` reste accessible depuis le panneau Version.
- `pnpm -w turbo test` (nouveaux tests `merge-core`) et typecheck à zéro erreur.
