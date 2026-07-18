# T57-tests — Scénarios de test du menu contextuel graph

## Préconditions communes

- Un projet ouvert avec au moins 3 commits, 2 branches locales (`main` et `feature-x`), 1 tag (`v1.0`), et un remote `origin` configuré.
- La branche courante est `main`.
- L'onglet "Arbre de versions" (`/graph`) est affiché.

---

## Scénarios nominaux (golden path)

### M01 — Menu branche courante

**Action** : clic droit sur le badge `main` (branche courante)  
**Attendu** :
- Le menu s'affiche avec les items : "Pousser", "Diff vs HEAD", "Diff vs branche…"
- Les items "Checkout", "Merger → courant", "Rebaser courant sur", "Supprimer (locale)" sont **absents**
- "Supprimer remote" est **présent**

---

### M02 — Menu branche non-courante, repo propre

**Précondition** : aucun fichier modifié ou stagé  
**Action** : clic droit sur le badge `feature-x`  
**Attendu** : menu complet — tous les items visibles :
- "Checkout branche"
- "Merger → courant"
- "Rebaser courant sur cette branche"
- "Pousser"
- "Supprimer (locale)" (en rouge)
- "Supprimer remote" (en rouge)
- "Diff vs HEAD"
- "Diff vs branche…"

---

### M03 — Menu branche non-courante, repo sale

**Précondition** : au moins un fichier modifié non-stagé  
**Action** : clic droit sur le badge `feature-x`  
**Attendu** :
- "Checkout branche" est **absent**
- "Rebaser courant sur cette branche" est **absent**
- "Merger → courant", "Pousser", "Supprimer", "Diff" sont présents

---

### M04 — Menu tag

**Action** : clic droit sur le badge `v1.0`  
**Attendu** : menu tag affiché — pas menu branche ni commit :
- "Checkout tag" (si repo propre)
- "Créer une branche depuis ce tag…"
- "Supprimer tag (local)" (en rouge)
- "Diff vs HEAD"
- "Diff vs branche…"

---

### M05 — Menu commit (clic sur SHA/message/auteur/date)

**Action** : clic droit sur une cellule SHA ou message d'un commit qui n'est pas le commit courant, repo propre  
**Attendu** : menu commit :
- "Checkout commit (HEAD détaché)"
- "Créer une branche depuis ce SHA…"
- "Créer un tag sur ce SHA…"
- "Rebaser courant sur ce commit"
- "Diff vs HEAD"
- "Diff vs branche…"

---

### M06 — Checkout branche

**Action** : clic droit sur badge `feature-x` → "Checkout branche"  
**Attendu** :
- Spinner visible pendant l'opération
- Après succès : le header affiche `⎇ feature-x`
- Le commit HEAD dans le graph a l'anneau de clic courant sur `feature-x`
- Le menu est fermé

---

### M07 — Checkout tag (HEAD détaché)

**Action** : clic droit sur badge `v1.0` → "Checkout tag"  
**Attendu** :
- Header affiche un état HEAD détaché (sha court ou message "HEAD détaché")
- Commit correspondant au tag marqué comme courant dans le graph

---

### M08 — Checkout commit (HEAD détaché)

**Action** : clic droit sur SHA d'un commit → "Checkout commit (HEAD détaché)"  
**Attendu** : même comportement que M07 sur le commit ciblé

---

### M09 — Merger branche → courant (succès)

**Précondition** : `feature-x` contient un commit supplémentaire par rapport à `main`, pas de conflit  
**Action** : clic droit sur `feature-x` → "Merger → courant"  
**Attendu** :
- Nouveau commit de merge visible dans le graph
- `sync:status` invalidé (pas de modifications en attente)
- Toast de succès ou simple refresh silencieux

---

### M10 — Merger branche → courant (conflit)

**Précondition** : `feature-x` et `main` modifient le même fichier différemment  
**Action** : clic droit sur `feature-x` → "Merger → courant"  
**Attendu** :
- Toast d'erreur listant les fichiers en conflit (ex: "requirements/SYS/SYS-001.md")
- Le graph ne change pas (merge annulé)

---

### M11 — Rebaser courant sur branche

**Précondition** : `main` a 1 commit d'avance sur la base commune de `feature-x`  
**Action** : clic droit sur badge `feature-x` → "Rebaser courant sur cette branche"  
**Attendu** :
- Historique linéarisé dans le graph (pas de commit de merge)
- `sync:graph` invalidé et graph rafraîchi

---

### M12 — Rebaser courant sur commit

**Action** : clic droit sur un commit ancien → "Rebaser courant sur ce commit"  
**Attendu** : même effet que M11 avec le SHA ciblé

---

### M13 — Pousser branche

**Précondition** : `feature-x` a 1 commit ahead d'`origin/feature-x`  
**Action** : clic droit sur `feature-x` → "Pousser"  
**Attendu** :
- Le compteur ahead dans le header revient à 0 (ou 0 différence visible)
- `sync:status` invalidé

---

### M14 — Supprimer branche locale (confirmation)

**Action** : clic droit sur `feature-x` → "Supprimer (locale)"  
**Attendu** :
- Premier clic : l'item se transforme en "Confirmer ?" (toujours en rouge)
- Clic ailleurs → menu fermé, aucune action
- Ré-ouvrir le menu, recommencer → deuxième clic sur "Confirmer ?" : la branche disparaît du graph

---

### M15 — Supprimer branche remote (confirmation)

**Action** : clic droit sur badge de branche → "Supprimer remote"  
**Attendu** :
- Double-confirmation (voir M14)
- Après confirmation : la ref `origin/feature-x` n'est plus visible (vérifiable via `git fetch` en terminal)

---

### M16 — Supprimer tag local

**Action** : clic droit sur badge `v1.0` → "Supprimer tag (local)"  
**Attendu** :
- Double-confirmation
- Après confirmation : `v1.0` disparaît du graph

---

### M17 — Créer une branche depuis un SHA

**Action** : clic droit sur un commit → "Créer une branche depuis ce SHA…"  
**Attendu** :
- Prompt inline apparaît dans le menu : champ input + bouton Valider + Echap
- Saisir "hotfix-test" → Enter
- Menu se ferme, graph rafraîchi, badge `hotfix-test` visible sur le commit

---

### M18 — Créer un tag sur un SHA

**Action** : clic droit sur un commit → "Créer un tag sur ce SHA…"  
**Attendu** :
- Prompt inline identique à M17
- Saisir "v2.0-rc1" → Enter
- Badge `v2.0-rc1` visible sur le commit dans le graph

---

### M19 — Créer une branche depuis un tag

**Action** : clic droit sur badge `v1.0` → "Créer une branche depuis ce tag…"  
**Attendu** : même comportement que M17 mais déclenché depuis le menu tag

---

### M20 — Diff vs HEAD

**Action** : clic droit sur un commit non-courant → "Diff vs HEAD"  
**Attendu** :
- Panel inline s'affiche sous la ligne du commit ciblé
- Liste les fichiers différents entre ce commit et HEAD
- Chaque fichier est un lien cliquable → navigation vers `/diff?projectId=...&filepath=...&commitSha=<sha>`

---

### M21 — Diff vs branche

**Action** : clic droit sur un commit → "Diff vs branche…"  
**Attendu** :
- Sélecteur de branche inline apparaît dans le menu
- Sélectionner `feature-x`
- Panel diff s'affiche sous la ligne avec les fichiers entre le commit ciblé et la tête de `feature-x`

---

### M22 — Fermeture du menu

**Action A** : clic ailleurs sur la page  
**Action B** : appui sur Echap  
**Attendu** : menu disparu, aucune action déclenchée

---

## Cas limites

### L01 — Clic droit sur le commit courant

**Action** : clic droit sur la ligne du commit marqué `isCurrent`  
**Attendu** : "Checkout commit" est absent (pas de checkout sur soi-même), "Rebaser courant sur ce commit" absent

---

### L02 — Repo sans remote configuré

**Action** : "Pousser" ou "Supprimer remote" dans un repo sans remote  
**Attendu** : toast d'erreur explicite ("Aucun remote configuré")

---

### L03 — Branche courante, menu branche

**Action** : clic droit sur badge de la branche courante  
**Vérification** : items "Checkout", "Merger → courant", "Rebaser", "Supprimer (locale)" absents — déjà testé en M01, mais vérifier aussi que le menu s'ouvre bien (pas de crash)

---

### L04 — Commit sans refs (pas de branche ni de tag)

**Action** : clic droit sur un commit intermédiaire sans badge  
**Attendu** : menu commit standard s'affiche (pas de menu branche ni tag)

---

### L05 — Merge avec HEAD détaché

**Précondition** : HEAD est en mode détaché (après checkout commit)  
**Action** : tenter de merger  
**Attendu** : toast d'erreur "HEAD détaché — impossible de merger"

---

### L06 — Créer une branche avec nom existant

**Action** : prompt "Créer une branche depuis ce SHA…" → saisir un nom déjà existant  
**Attendu** : toast d'erreur "Ce nom de branche existe déjà"

---

### L07 — Prompt inline : touche Echap

**Action** : ouvrir le prompt inline (créer branche) → appuyer sur Echap  
**Attendu** : le prompt se ferme, le menu se ferme aussi (une seule pression Echap suffit)

---

### L08 — Confirmation destructive : clic hors de l'item

**Action** : déclencher la confirmation d'un item destructif → cliquer sur un autre item du menu  
**Attendu** : le premier item revient à son état normal (hors confirmation), le second item est activé

---

### L09 — Diff vs HEAD sur commit le plus ancien

**Action** : "Diff vs HEAD" sur le premier commit du repo  
**Attendu** : panel diff affiche les fichiers ajoutés par rapport à HEAD (peut être un grand nombre de fichiers si HEAD est très en avance)

---

### L10 — Menu sur badge de tag vs badge de branche adjacent

**Précondition** : un commit a à la fois un badge de branche et un badge de tag  
**Action** : clic droit sur chacun des deux badges  
**Attendu** : menu branche pour le badge branche, menu tag pour le badge tag — pas de confusion

---

## Critères d'acceptation (récapitulatif)

- [ ] Clic droit sur badge branche courante : pas de Checkout, pas de Supprimer locale, Merger absent
- [ ] Clic droit sur badge branche non-courante + repo propre : tous les items visibles
- [ ] Clic droit sur badge branche + repo sale : Checkout et Rebaser absents
- [ ] Clic droit sur badge tag : menu tag (pas branche ni commit)
- [ ] Clic droit sur cellule SHA/message/auteur/date : menu commit
- [ ] Checkout branche → branche courante change dans le header
- [ ] Checkout tag → HEAD détaché, commit marqué courant
- [ ] Créer branche depuis SHA → badge visible dans le graph
- [ ] Créer tag sur SHA → badge visible dans le graph
- [ ] Merger branche + succès → nouveau commit de merge dans graph
- [ ] Merger branche + conflit → toast d'erreur avec chemins de fichiers
- [ ] Rebaser courant sur SHA → historique linéarisé
- [ ] Pousser branche → ahead count mis à jour
- [ ] Supprimer branche locale : double-confirmation, puis disparaît du graph
- [ ] Supprimer branche remote : double-confirmation (vérifiable via git fetch)
- [ ] Supprimer tag → badge disparu du graph
- [ ] Diff vs HEAD → panel inline avec fichiers, clic fichier → vue diff
- [ ] Diff vs branche → sélecteur + panel inline
- [ ] Clic ailleurs ou Echap → menu fermé
- [ ] Spinner visible sur l'item en cours de mutation
- [ ] Items destructifs en rouge
