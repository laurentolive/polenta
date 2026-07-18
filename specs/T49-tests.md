# T49 — Scénarios de test

Voir [T49.md](T49.md) (spec) et [T49-design.md](T49-design.md) (design).

## Scénarios nominaux (golden path)

1. **Ajout d'un test approuvé à une campagne** — créer/ouvrir une campagne
   `planned`, ajouter un test `approved`. L'entrée apparaît avec le titre et
   le statut du test tel qu'il est au moment de l'ajout.
2. **Modification du test source après ajout, campagne toujours ouverte** —
   éditer le test ajouté au scénario 1 (changer le titre et une étape), sans
   changer son statut. Revenir sur la campagne : le titre et le contenu
   affichés restent ceux d'avant la modification (`testSnapshot`), pas les
   nouveaux.
3. **Test repassé en `draft` après ajout** — sur le test du scénario 1,
   repasser le statut en `draft`. La campagne continue d'afficher l'entrée
   normalement (titre, statut affiché = celui du snapshot), sans avertissement
   ni changement de comportement.
4. **Test modifié puis ré-approuvé** — modifier le contenu du test (ex.
   changer une étape), le repasser en `approved`. La campagne affiche
   toujours le contenu du snapshot pris à l'ajout initial, pas la nouvelle
   version approuvée.
5. **Exécution contre le snapshot** — avec le test du scénario 2 (source
   modifiée depuis l'ajout), cliquer "Exécuter" sur l'entrée de campagne : la
   page d'exécution affiche les étapes/préconditions/postconditions du
   snapshot (version avant modification), pas la version live modifiée.
   Soumettre un résultat fonctionne normalement.
6. **Clôture puis modification de la source** — clôturer la campagne
   (`completed`), puis modifier le test source (contenu et statut). Rouvrir
   la relecture du run exécuté au scénario 5 : le contenu affiché est
   identique à avant la modification. Régénérer l'export (plan et rapport,
   xlsx/docx/pdf) : le contenu est identique à un export généré avant la
   modification du test source.
7. **Deux instances du même test, source modifiée entre les deux ajouts**
   (T97 sprint 2) — ajouter une première instance paramétrée d'un test,
   modifier le test source (ex. changer une étape), ajouter une deuxième
   instance du même test avec d'autres valeurs de paramètres. Les deux
   instances affichent un contenu différent (chacune son propre
   `testSnapshot`), tout en partageant le même `testCaseId`.
8. **Suppression du test source après ajout** — supprimer le fichier du test
   ajouté au scénario 1. La campagne continue d'afficher l'entrée normalement
   via `testSnapshot` (titre, contenu, exécution, export tous fonctionnels) —
   changement de comportement par rapport à avant T49 (l'entrée n'est plus
   silencieusement ignorée).

## Cas limites

- **Entrée créée avant T49 (pas de `testSnapshot`)** — sur une campagne
  existante créée avant ce ticket : l'affichage, l'exécution et l'export
  continuent de fonctionner en résolvant l'état *live* du test (comportement
  identique à avant T49). Modifier le test source **change** alors
  l'affichage de cette entrée (pas de régression introduite, mais pas
  d'immuabilité non plus — comportement documenté, pas un bug).
- **Entrée pré-T49 dont le test source a été supprimé** — reste dégradée
  comme aujourd'hui (absente des exports, "Test introuvable" à l'exécution/
  relecture) : aucune régression, aucune amélioration pour ces entrées-là.
- **Campagne créée avec un test non approuvé** (`campaign.new.tsx` n'a pas de
  gating d'approbation, cf. T49-design.md §2.9) — le snapshot est pris quel
  que soit le statut du test à la création, cohérent avec le comportement
  actuel de cette page (non changé par ce ticket).
- **`paramValues` modifiés après l'ajout** — éditer les valeurs de paramètres
  d'une instance déjà exécutée : les valeurs sont mises à jour normalement
  (comportement inchangé, `paramValues` n'est pas figé par ce ticket), la
  substitution `{label}` à la relecture utilise ces valeurs à jour appliquées
  au texte du `testSnapshot`.
- **`{label}` présent dans le snapshot mais retiré du test live depuis** —
  la substitution continue de fonctionner normalement, puisqu'elle s'appuie
  sur le texte du snapshot (qui contient encore ce `{label}`), pas sur le
  texte live.
- **Test d'un composant submodule (cross-repo)** — ajouter à une campagne un
  test dont l'`objectTypeRef` référence un composant submodule : le snapshot
  est bien pris (vérifie que `TestsService.findOne`/
  `resolveComponentRepoPath` fonctionnent correctement appelés depuis
  `campaigns.service.ts`, pas seulement depuis `tests.service.ts`).
- **Retrait puis ré-ajout du même test** — retirer une entrée
  (`removeEntries`) puis rajouter le même test (modifié entre-temps) : la
  nouvelle entrée a un `testSnapshot` reflétant l'état actuel (nouveau
  snapshot, pas l'ancien).
- **Export d'une campagne avec un test inclus plusieurs fois** — vérifier que
  chaque instance affiche son propre statut d'exécution dans le rapport
  (plan/rapport, xlsx/docx/pdf), pas celui de la première instance
  (régression du bug latent identifié en T49-design.md §3).

## Critères d'acceptation vérifiables

- [ ] TypeScript compile sans nouvelle erreur (`apps/desktop`, `packages/types`).
- [ ] Scénarios nominaux 1-8 ci-dessus rejoués manuellement en Electron avec
      succès.
- [ ] Tous les cas limites ci-dessus vérifiés manuellement, en particulier le
      comportement inchangé des entrées pré-T49 et l'export multi-instances.
- [ ] Aucune régression sur le panneau "Ajouter des tests" (gating
      `isTestApproved`, toujours basé sur l'état live).
- [ ] `/code-review` passé sur le diff, corrections appliquées.
