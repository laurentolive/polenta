# T113 — Sprint 1 (dernier sprint)

## Fichiers modifiés

- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` — case à cocher
  "Composant local", champ `isLocal` sur `AddDependencyValues`, validation allégée en mode local,
  champs **Repo (URL git)** et **Branche** masqués (pas seulement désactivés) quand cochée — la
  popup se réduit à la case + **Nom (montage)**. Label/Description restent réservés au mode
  édition (`isEdit`), inchangés par la case — corrigé après un premier essai qui les affichait
  aussi en création locale (retour utilisateur, cf. Divergences).
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` :
  - badge "⚠ non associé à un repo" retiré, remplacé par un mini-header par sous-composant local
    (label, `+ élément`, `✎` renommer, `🗑` supprimer) ;
  - nouveau composant `AddElementMenu` (menu Exigence/Test/Campagne scopé à un nœud local) ;
  - hook partagé `useDropdown()` extrait (état ouvert/fermé + fermeture au clic extérieur),
    réutilisé par `AddMenu` et `AddElementMenu` ;
  - `handleAddLocalComponent` (nouveau) : bifurcation de `handleSubmitDependency` sur
    `values.isLocal` — ajoute un `SystemNode` au `schema.yaml` du repo ciblé, sans passer par
    `polenta-repo.yaml`/git ;
  - `handleDeleteOrphanNode` renommé `handleDeleteLocalComponent` (même logique).
- `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx` — nouveau combobox
  "Sous-composant" (masqué si un seul `SystemNode`), branché sur `nodes`/`effectiveNodeId`/
  `handleNodeChange` déjà exposés par `SystemViewContext`.
- `apps/desktop/src/main/services/requirements.service.ts` et `tests.service.ts` — `nextId()`/
  `nextTestId()` réécrits pour résoudre le préfixe via `findObjectTypeDef()`
  (`schema-lookup.util.ts`, scopé par nœud) au lieu d'une recherche à plat sur le nom du type
  seul, qui pouvait renvoyer le préfixe d'un nœud voisin partageant le même nom de type.
- `specs/SPEC-TEMPLATES.md` §3 — documente le pattern multi-sous-composants locaux par repo.
- `specs/SPEC-SYSTEM-VIEW.md` — documente le nouveau combobox "Sous-composant".
- `specs/SPEC-INDEX.md` — entrées SPEC-TEMPLATES §3 et SPEC-SYSTEM-VIEW, colonne MAJ → T113.
- `specs/T70-design.md` §4.5 — annotée "spec caduque (constatée T113)", pointeur vers la nouvelle
  section, historique conservé.

## Comportement implémenté

Conforme au design (`specs/T113-design.md`) après un ajustement post-revue utilisateur :
"+ Composant" reste le seul point d'entrée, la case "Composant local (dans ce repo)" masque
Repo/Branche (au lieu de simplement les désactiver, version initiale) et laisse uniquement Nom.
Un sous-composant local (nouveau ou pré-existant, créé avant ce ticket) s'affiche désormais sans
badge d'erreur, avec les mêmes actions qu'un composant normal.

## Divergences par rapport au design

Trois corrections apportées après la présentation du sprint, absentes du design initial :

0. **Retour utilisateur direct** : la première version faisait jouer la case à cocher sur la
   visibilité de Label/Description (les faisant apparaître) tout en se contentant de *désactiver*
   (griser) Repo (URL git)/Branche plutôt que de les masquer. Corrigé : la case masque désormais
   Repo/Branche, Label/Description restent réservés au mode édition comme avant T113 — la popup en
   mode local ne montre plus que Nom, plus minimale et plus lisible. Revérifié manuellement
   (screenshots avant/après cochage, `schema.yaml` sans clé `description` pour un nœud créé ainsi).

Les deux points suivants restent ceux identifiés par la revue de code (`/code-review`, 8 agents) :

1. **Bug réel corrigé** (avant le point 0 ci-dessus, qui a depuis retiré le champ Description du
   formulaire de création locale — le correctif reste néanmoins en place dans
   `handleAddLocalComponent`, inerte tant qu'aucun appelant n'envoie de description, mais correct
   si ce champ revient un jour) : `handleAddLocalComponent` ne recopiait pas `values.description`
   dans le `SystemNode` créé — le champ était saisi dans le formulaire (visible dès que `isLocal`
   était coché, avant le point 0) mais silencieusement perdu à l'enregistrement. Confirmé
   indépendamment par 3 agents de revue, corrigé, revérifié manuellement dans l'app
   (`description: Ma description de test`
   correctement présente dans `schema.yaml` après création).
2. **Amélioration mineure** : `handleAddLocalComponent` affichait silencieusement rien si le
   schéma du repo ciblé n'était pas encore chargé (`schemasByRepoPath.get(...)` undefined) — ajout
   d'un message d'erreur explicite au lieu d'un clic sans effet apparent.
3. **Refactor non prévu au design** (signalé par 2 agents indépendamment, coût faible, appliqué) :
   extraction de `useDropdown()` pour éliminer la duplication entre `AddMenu` et le nouveau
   `AddElementMenu` (état + listener de clic extérieur identiques).

Point documenté mais **non corrigé**, jugé hors scope : un agent de revue a noté que le badge
d'erreur pour une dépendance `polenta-repo.yaml` déclarée-mais-non-résolue disparaît en même temps
que le badge "orphelin" générique. Le design (§1) avait déjà établi que ce cas réel (repo cassé)
passe par un mécanisme entièrement séparé (bannière d'erreur de `buildTree()`, jamais par une
entrée `schema.nodes[]`) — confirmé de visu pendant ce sprint sur un vrai projet démo
(`aspirateur-demo`, dépendance "motor-control" avec un transport git non reconnu → bannière rouge
affichée normalement, indépendamment de ce diff). Le cas résiduel signalé par l'agent (un
`SystemNode` local dont le nom collide *en plus* avec une dépendance cassée du même nom) demande
deux erreurs de configuration simultanées et n'était de toute façon pas distingué d'un orphelin
générique avant ce ticket — pas de régression nette pour un cas réaliste.

## Bugs supplémentaires trouvés et corrigés (hors périmètre initial, signalés par l'utilisateur)

Après validation de la popup, l'utilisateur a signalé que les sous-composants locaux créés
n'apparaissaient pas dans la **Vue Système** (écran distinct de Structure, utilisé au quotidien
pour créer/parcourir les exigences/tests/campagnes elles-mêmes). Investigation :

4. **Combobox "Sous-composant" manquant** : `SystemViewContext.tsx` gère déjà en interne une
   distinction à trois niveaux (Repo → `SystemNode` → Type — `nodes`, `selectedNodeId`,
   `handleNodeChange` existaient déjà, jamais branchés sur une UI). `SystemPanel.tsx` n'exposait
   que deux combobox : "Composant" (un par repo physique, `repoOptions` dérivé de `flatNodes` —
   comportement documenté par `SPEC-SYSTEM-VIEW.md`, inchangé) et "Élément" (les types du
   *premier* `SystemNode` du repo sélectionné uniquement — `nodes[0]` implicite). Un repo avec
   plusieurs sous-composants locaux n'avait donc aucun moyen d'en choisir un autre que le premier.
   **Correctif** : nouveau combobox "Sous-composant" dans `SystemPanel.tsx`, entre "Composant" et
   "Élément", réutilisant `nodes`/`effectiveNodeId`/`handleNodeChange` (aucun changement au
   contexte, uniquement au rendu) — masqué quand le repo n'a que `root` (aucun changement visuel
   pour un projet sans sous-composant local). `SPEC-SYSTEM-VIEW.md` mis à jour (nouveau combobox
   documenté, schéma ASCII, table de persistance).
5. **Bug plus sérieux, trouvé en testant le point 4** : créer une exigence sur `VE11D` a produit
   un fichier `VE11D-0056`... avec l'id **`VE11WIHA-0019`** (préfixe de la carte voisine, pas
   celui sélectionné). Root cause : `nextId()`/`nextTestId()`
   (`requirements.service.ts`/`tests.service.ts`) cherchaient le préfixe en aplatissant
   `schema.nodes.flatMap(n => n.objectTypes ?? [])` puis en filtrant sur le **nom du type seul**
   (`"exigence"`) — sans tenir compte du nom du nœud. Comme les 5 cartes déclarent toutes un type
   nommé `exigence` (label différent, préfixe différent), la recherche retombait systématiquement
   sur le premier nœud du tableau (`VE11WIHA`), quel que soit le nœud réellement ciblé par
   `objectTypeRef`. Ce bug préexistait à T113 mais n'était jamais atteignable avant (un repo
   n'avait jamais qu'un seul nœud significatif) — T113 le rend immédiatement réel dès que deux
   sous-composants partagent un nom de type, un cas très naturel (ex. appeler "exigence" le type
   d'exigence de chaque carte). **Correctif** : réutilisation de l'utilitaire déjà existant et
   correct `findObjectTypeDef()` (`schema-lookup.util.ts`, déjà utilisé par
   `requirements-index.service.ts`/`query-engine.service.ts`), qui résout `objectTypeRef` en
   scopant d'abord sur le nom du nœud — au lieu de dupliquer une seconde logique de résolution.
   Revérifié manuellement : création sur `VE11D` produit désormais bien `VE11D-0056` (compteur
   `VE11D` correctement incrémenté depuis 55, `VE11WIHA` inchangé).

## Mises à jour SPEC effectuées

- `SPEC-TEMPLATES.md` §3 : nouveau paragraphe "Plusieurs `SystemNode` locaux par repo (T113)".
- `SPEC-INDEX.md` : entrée dédiée pour SPEC-TEMPLATES §3 + entrée SPEC-SYSTEM-VIEW mise à jour,
  `MAJ` passée à T113 pour les deux.
- `T70-design.md` §4.5 : annotée caduque avec renvoi vers T113 (convention déjà utilisée dans
  `SPEC-FORKS-BRANCHES-BASELINES.md` §4.3).
- `SPEC-SYSTEM-VIEW.md` : nouveau combobox "Sous-composant" documenté (schéma, comportement,
  persistance) ; la ligne de persistance "Composant (SystemNode local)" renommée pour refléter
  que Composant (repo) et Sous-composant (`SystemNode`) sont maintenant deux concepts distincts.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop build && pnpm --filter @polenta/desktop dev` (ou build+run).
2. Ouvrir un projet, Modèle de données → Structure.
3. "+" sur une ligne de repo → "+ Composant" → cocher "Composant local (dans ce repo)".
4. Vérifier : champs Repo/Branche disparaissent (masqués), seul "Nom (montage)" reste visible.
5. Remplir un nom → Ajouter.
6. Vérifier : le nouveau nœud apparaît dans l'arbre sans badge, avec `+ élément`/`✎`/`🗑`.
7. Aller dans Système (4ᵉ icône barre d'activité) → vérifier le combobox "Sous-composant" liste
   bien tous les sous-composants du repo sélectionné (masqué si un seul).
8. Sélectionner un sous-composant local dans ce combobox → vérifier que "Élément" et l'arbre se
   rechargent sur ses propres types.
9. Créer une exigence via "+ Créer le premier élément" → vérifier que l'ID généré porte bien le
   préfixe du sous-composant sélectionné (pas celui d'un autre nœud du même repo).

## Statut

TypeScript : 0 erreur. Testé manuellement dans l'app réelle (build + pilotage automatisé), à
plusieurs reprises au fil des corrections (visibilité des champs, combobox Sous-composant, bug de
préfixe d'ID). Artefacts de test nettoyés à chaque fois du projet
`C:\Dev\polenta-projet1\polenta-projet1` (schema.yaml, requirements/, .polenta/trees/). Rien n'est
commité.
