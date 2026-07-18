# T120 — Sprint 1 (dernier sprint)

## Fichiers modifiés

- `apps/desktop/src/renderer/contexts/SystemViewContext.tsx` :
  - `RepoOption` remplacé par `ComponentOption` (repo + `SystemNode` fusionnés, `groupLabel?`
    optionnel pour le regroupement visuel par repo) ;
  - `repoOptions`/`selectedRepoName`/`handleRepoChange`/`handleNodeChange` remplacés par
    `componentOptions`/`selectedComponentIndex`/`handleComponentChange` dans `SystemViewState` ;
  - `componentOptions` construit par `flatNodes.flatMap(...)` à partir des données déjà chargées
    (`schemasByRepoPath`, pas de nouvelle requête) — un repo à un seul `SystemNode` produit une
    entrée identique à l'ancien `repoOptions` ; un repo à plusieurs `SystemNode` locaux produit une
    entrée par node, avec `groupLabel` uniquement quand le workspace a plusieurs repos ;
  - `handleComponentChange(repoName, nodeId)` résout le premier type du node ciblé et navigue en
    une seule action ; retombe sur une résolution du `repoPath` par nom de repo seul si aucune
    entrée de `componentOptions` ne correspond exactement (repo dont le schéma est encore en
    cours de chargement) ;
  - `selectedComponentIndex` (position dans `componentOptions`, `-1` si aucune correspondance)
    remplace une clé de chaîne `repo::node` initialement envisagée (cf. Divergences).
- `apps/desktop/src/renderer/components/sidebar/SystemPanel.tsx` :
  - fusion des deux blocs `<select>` ("Composant" + "Sous-composant") en un seul, piloté par
    `componentOptions`/`selectedComponentIndex`/`handleComponentChange` ;
  - nouveau helper `renderComponentOptions()` : regroupe les entrées contiguës partageant un
    `groupLabel` dans un `<optgroup>`, sinon rendu en `<option>` de premier niveau ; valeur de
    chaque `<option>` = son index dans le tableau (pas une chaîne composite).
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` : un sous-composant local
  affiche désormais l'icône `Component` (lucide-react) et le même poids visuel (`text-sm
  font-medium text-ink`) qu'une ligne de repo, au lieu d'un simple texte discret ; tooltip
  "Renommer / décrire ce sous-composant" renommé "Renommer / décrire ce composant".
- `specs/SPEC-SYSTEM-VIEW.md` : section "Combobox Sous-composant (T113)" retirée, fusionnée dans
  "Combobox Composant (T72 + T113, fusionnés en un seul niveau — T120)" ; schéma ASCII et ligne de
  persistance mis à jour.
- `specs/SPEC-INDEX.md` : entrée SPEC-SYSTEM-VIEW §global, colonne `MAJ` → T120.

## Comportement implémenté

Conforme à `specs/T120-design.md` : un seul combobox "Composant" dans la Vue Système, listant à
plat repo(s) et sous-composant(s) locaux ; regroupement visuel (`<optgroup>`) uniquement quand un
repo à plusieurs `SystemNode` coexiste avec au moins un autre repo dans le workspace. Dans
l'onglet Structure, un sous-composant local a désormais la même présentation visuelle qu'un
composant en repo séparé (icône dédiée, poids de texte identique), tout en restant imbriqué sous
son repo conteneur (contrainte de stockage réelle, pas une hiérarchie de navigation).

## Divergences par rapport au design

`specs/T120-design.md` proposait initialement une clé composite de chaîne `${repoName}::${nodeId}`
pour piloter la sélection du combobox fusionné, avec un point ouvert signalé explicitement dans le
design ("à trancher en sprint") sur la fragilité de ce séparateur si un nom de repo ou de
sous-composant contenait déjà `::`. La revue de code (`/code-review`, 8 agents) a confirmé ce
risque de façon convergente sur 4 angles indépendants (line-by-line, simplification, reuse,
altitude) : un nom contenant `::` tronque le parsing (`.split('::')`) et route silencieusement
vers un `nodeId` erroné. **Correctif retenu, plus profond que la validation défensive
initialement envisagée** : la sélection du combobox se fait par **index de position** dans
`componentOptions` plutôt que par clé sérialisée — élimine la classe de bug entière au lieu de la
garder-avec-un-garde-fou (suit la recommandation de l'angle Altitude de la revue).

La revue a également détecté un second problème, non anticipé au design : en **mono-repo** avec
plusieurs sous-composants locaux (le cas d'usage principal de T113), le regroupement par repo
utilisait le nom de mount synthétique `'root'` comme `groupLabel`, produisant un
`<optgroup label="root">` visible — une régression par rapport à l'ancien combobox
"Sous-composant", qui n'affichait aucun en-tête dans ce cas. **Correctif** : `groupLabel` n'est
renseigné que lorsque le workspace comporte plusieurs repos (`flatNodes.length > 1`) ; en
mono-repo, la liste reste plate sans en-tête, quel que soit le nombre de sous-composants locaux.

Un troisième point (mineur) : `handleComponentChange` retombe désormais sur une résolution du
`repoPath` par nom de repo seul si `componentOptions` ne contient pas d'entrée correspondant
exactement au `(repoName, nodeId)` demandé — restaure la résilience de l'ancien
`handleRepoChange` (qui ne dépendait que du nom de repo) pour le cas limite d'un repo dont le
schéma est encore en cours de chargement.

Aucune de ces trois corrections ne change le périmètre du ticket ni les critères d'acceptation de
`specs/T120.md` — uniquement le mécanisme interne de sélection et un cas limite du regroupement
visuel.

## Vérification

- `pnpm --filter @polenta/desktop typecheck` : 0 erreur (avant et après les correctifs de revue).
- `pnpm lint` (turbo) : échoue pour une raison d'infrastructure préexistante et sans rapport avec
  ce diff (`eslint` non résolu pour `@polenta/api`/`@polenta/web` — `@polenta/desktop` lui-même
  n'a pas de script `lint` configuré) ; non bloquant pour ce ticket.
- `/code-review` (8 agents, high effort) : 1 bug confirmé (troncature `::`, corrigé par
  l'indexation), 1 régression UI confirmée (optgroup "root" en mono-repo, corrigée), plusieurs
  observations de robustesse mineures (fallback `repoPath`, appliqué) ; angles efficacité et
  conventions CLAUDE.md : rien à signaler.
- Vérification manuelle dans l'app réelle (build + pilotage automatisé, projet de test créé à la
  volée) :
  - Structure : ajout de deux sous-composants locaux ("Turbine", "Filtration") — icône dédiée et
    poids visuel de repo confirmés visuellement (capture d'écran).
  - Vue Système (mono-repo, 3 `SystemNode` au total — root "Produit" + 2 locaux) : un seul
    combobox "Composant" listant les 3 entrées **à plat, sans `<optgroup>`** — confirme le
    correctif de régression mono-repo. Valeurs d'option = index (0, 1, 2), aucune trace de
    séparateur `::` dans le DOM.
  - Sélection de "Turbine" dans le combobox : l'URL se met à jour correctement
    (`repo=T120TestProj&node=Turbine`), le combobox "Élément" se recharge sur le type propre à
    Turbine ("Exigence Turbine"), distinct de celui de Filtration/root — confirme que
    `handleComponentChange` route vers le bon `SystemNode`.
  - Non vérifié en direct (nécessiterait un vrai submodule git) : le regroupement `<optgroup>`
    pour un repo à plusieurs sous-composants locaux **dans un workspace à plusieurs repos** —
    validé par lecture de code uniquement (`groupLabel` posé sur `flatNodes.length > 1`, sinon
    identique au cas mono-repo déjà vérifié en direct).

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop build` puis lancer l'app (`pnpm --filter @polenta/desktop dev`
   ou build+run).
2. Créer un projet vide, aller dans Projet → Modèle de données → Structure.
3. "+" sur la ligne du repo racine → "+ Composant" → cocher "Composant local" → nommer
   "Turbine" → Ajouter. Répéter avec "Filtration".
4. Vérifier : les deux lignes affichent une icône dédiée et un texte de même poids que la ligne
   du repo (pas un simple texte gris comme avant ce ticket).
5. Aller dans Système (icône "Système" de la barre d'activité).
6. Vérifier : un seul combobox "Composant" est visible, listant "Produit" (racine), "Turbine",
   "Filtration" à plat, sans séparateur/en-tête de groupe (mono-repo).
7. Sélectionner "Turbine" → vérifier que le combobox "Élément" et l'arbre se rechargent sur les
   types propres à Turbine, en une seule interaction.
8. Recharger un lien direct existant (`?repo=...&node=...`) → vérifier qu'il résout le même
   composant qu'avant ce ticket.

## Statut

TypeScript : 0 erreur. Testé manuellement dans l'app réelle (build + pilotage automatisé),
scénario mono-repo multi-sous-composants confirmé de bout en bout. Scénario multi-repo (workspace
avec plusieurs repos séparés, dont un à plusieurs sous-composants locaux) vérifié par lecture de
code uniquement, pas par pilotage direct — signalé ci-dessus, pas de raison de douter du
comportement (même construction que le cas mono-repo, simple ajout de `groupLabel`). Projet de
test créé dans le répertoire scratchpad de la session, non commité, sans impact sur ce repo.
