# GH365 — Sprint 1

## Fichiers modifiés
- `apps/desktop/src/renderer/components/schema/objectTypeEditor.tsx` — slug sans accents ni
  ligatures ; `typeNamingRoot`, `COMPONENT_DEFAULT_CATEGORIES`, `REPO_ROOT_ONLY_CATEGORIES`,
  `defaultObjectTypes`.
- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` — six cases (version /
  validation masquées pour un composant local, état conservé) ; `defaultCategories` remplace
  `includeRequirements/Tests/Campaigns`.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` — amorçage local et repo séparé
  via `defaultObjectTypes` (racine = label, préfixes du workspace évités) ; « + élément » : racine =
  label du nœud (repli sur le nom).
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — `includeIssuesLabel`,
  `includeVersionsLabel`, `includeValidationsLabel`.
- Tests : `objectTypeEditor.gh365.test.ts` (U-1 à U-4), `e2e-web/gh365-default-types.spec.ts`
  (E-1 à E-3, M-1 automatisé : repo nu sur la forge locale).

## Comportement implémenté
Conforme à `specs/GH365.md`.

## Divergences par rapport au design
- M-1 (repo séparé), prévu manuel, est automatisé en e2e.
- E-2 clique l'item « + Exigence » par `dispatchEvent` : le menu s'ouvre en bas du conteneur
  défilant et le clic aux coordonnées tombe sur la ligne suivante pendant le défilement (placement
  du menu préexistant, hors ticket).

## Mises à jour SPEC
- `SPEC-TEMPLATES.md` §3 — paragraphe « Types d'objets créés par défaut (GH365) ».
- `SPEC-INDEX.md` — ligne SPEC-TEMPLATES §3 : résumé, mots-clés, MAJ → GH365.

## Vérifications
- Niveau 1 : `pnpm typecheck` OK ; `pnpm lint` n'exécute aucune tâche (pas de lint configuré).
- Niveau 2 : `pnpm test` (1815 tests desktop + paquets) OK ; e2e `gh365-` 4/4, voisines `gh107-create`,
  `gh107-adopt`, `gh104-delete`, `gh106-structure`, `gh265-` 21/21.

## Tester manuellement
1. Modèle de données → Structure → « + » sur le repo racine → « + Composant » : six cases cochées ;
   cocher « Composant local » masque Versions et Validations.
2. Nom `moteur`, label `Contrôle moteur`, local → types `CONTROLE_MOTEUR_REQ`, `_TEST`, `_CAMP`, `_ISS`.
3. « + Exigence » sur ce composant → `CONTROLE_MOTEUR_REQ_2`.
4. Composant en repo séparé neuf avec label → six types sur son `root` (M-1) ; label vide → racine =
   nom de montage (M-2).
5. « + Exigence » sur la ligne d'un repo → racine = label du repo (M-3).
