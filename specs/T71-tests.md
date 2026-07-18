# T71-tests — Scénarios de test

## Scénarios nominaux (golden path)

1. **Ajout d'une interface sans champ version**
   Dans l'onglet Structure, cliquer "+ Interface" sur un repo composant → le formulaire affiche Repo / Nom (montage) / Branche / Rôles, **sans** champ "Version implémentée". Soumettre → le clone réussit et `schema.yaml` du repo parent contient `implements: [{interface: <nom>, roles: [...]}]`, sans clé `version`.

2. **Version affichée = pin résolu**
   Ouvrir l'onglet Interfaces d'un composant qui implémente déjà une interface présente dans l'arbre du workspace courant → à côté du nom de montage, la version affichée est le pin réel du mount (SHA court ou tag/branche tel que déclaré dans `polenta-repo.yaml`), en lecture seule (pas d'`<input>` éditable).

3. **Mise à jour du pin reflétée sans cache périmé**
   Changer le pin de l'interface (ex. re-cloner/checkout sur un autre tag via le mécanisme existant de mise à jour de dépendance), rouvrir l'onglet Interfaces → la version affichée correspond au nouveau pin, pas à l'ancienne valeur.

## Cas limites

4. **Interface non résolue dans l'arbre courant**
   Un composant déclare `implements: [{interface: 'iface-x', roles: [...]}]` mais `iface-x` n'est pas un mount présent dans l'arbre actuel (jamais cloné, ou retiré) → l'onglet Interfaces affiche un état explicite "non résolu" (pas de valeur vide silencieuse, pas de crash).

5. **`schema.yaml` legacy avec clé `version:` résiduelle**
   Un fichier `schema.yaml` créé avant T71 contient encore `implements: [{interface: ..., version: "2.1", roles: [...]}]` → le projet s'ouvre normalement, la clé `version` résiduelle est ignorée silencieusement (pas d'erreur de parsing, pas d'affichage de cette valeur périmée).

6. **Deux composants, pins divergents sur la même interface (legacy + récent)**
   Composant A implémente `iface-can-bus` (mount à pin `v1.0`), composant B implémente le même repo interface mais à pin `v2.1` via un second mount (`MountOverride`, ex. `iface-can-bus-legacy`) → chacun affiche le pin de son propre mount dans son onglet Interfaces, sans confusion croisée. Le flux de résolution de diamond-conflict existant reste inchangé.

7. **Aucune implémentation déclarée**
   Composant sans `implements` → l'onglet Interfaces affiche "Aucune implémentation d'interface déclarée." comme aujourd'hui (comportement inchangé par T71).

## Critères d'acceptation vérifiables

- [ ] Le type `ImplementsDeclaration` (package `@polenta/types`) ne compile plus avec un champ `version` — toute référence résiduelle dans le code est une erreur TypeScript
- [ ] `AddDependencyModal.tsx` (kind `interface`) : plus de champ, plus de state, plus de validation liés à `version`
- [ ] `schema.tsx` `InterfacesTab` : plus de champ de saisie libre `version` ; affichage en lecture seule du pin résolu (ou "non résolu")
- [ ] `useWorkspaceStructure` expose `flatNodes` sans régression sur les usages existants (`StructureTab.tsx`)
- [ ] Aucune modification de `workspace-tree.service.ts` ni `interface-compliance.service.ts`
- [ ] `tsc`/lint : zéro nouvelle erreur
- [ ] Test manuel des scénarios 1 à 7 ci-dessus

## Comment tester manuellement

1. Ouvrir un workspace Polenta contenant au moins un repo interface (`roles:` dans son `schema.yaml`) et un repo composant.
2. Dans l'onglet Structure, ajouter une nouvelle déclaration d'implémentation via "+ Interface" → vérifier l'absence du champ version dans le formulaire, vérifier le `schema.yaml` résultant sur disque.
3. Aller dans l'onglet Interfaces du composant → vérifier l'affichage en lecture seule du pin résolu.
4. Simuler une interface non clonée (retirer temporairement le mount ou pointer `implements.interface` vers un nom inexistant) → vérifier l'état "non résolu".
5. Simuler un `schema.yaml` legacy en ajoutant manuellement une clé `version: "9.9"` dans `implements` sur disque → recharger le projet, vérifier l'absence d'erreur et que l'affichage ignore cette clé.
