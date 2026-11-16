# GH373 — Sprint 1

## Fichiers modifiés
- `apps/desktop/src/renderer/components/schema/defaultLinkTypes.ts` (nouveau) — liens proposés
  (`offeredDefaultLinks`, `showsIssueImpact`), racine des noms (`linkTypeNamingRoot`), refs exigence
  du parent (`requirementRefs`), types de liens à écrire (`defaultLinkTypes` → `own` / `parent`).
- `apps/desktop/src/renderer/components/schema/objectTypeEditor.tsx` — export de `slugifyComponentName`.
- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` — section « Types de liens créés
  par défaut », prop `parentHasRequirementTypes`, valeur `defaultLinks`.
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx` — composant local : types de liens
  ajoutés au schéma du repo dans le même enregistrement ; repo séparé : `own` dans le schéma du
  composant, `parent` dans le schéma du parent (relu juste avant).
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — libellés.
- Tests : `defaultLinkTypes.gh373.test.ts` (U-1 à U-8), `e2e-web/gh373-default-links.spec.ts` (E-1 à E-5).

## Comportement implémenté
Conforme à `specs/GH373.md`. Racine vide (nom sans lettre latine) : noms `verification`,
`implementation`… suffixés s'ils sont pris.

## Divergences par rapport au design
Aucune.

## Revue de code (`/code-review`, sur le design)
Pistes écartées, toutes conformes à la spec ou au comportement existant :
- collision de nom avec un type d'un **autre** workspace où le composant serait ajouté plus tard :
  limite de la fusion par nom (`unionLinkTypes`, hors scope) ;
- `issue-impact` affiché coché alors qu'un repo qui avait déjà un type issue et l'a supprimé ne le
  reçoit pas : règle GH244 « non réajouté s'il est retiré » ;
- repo séparé déjà configuré : rien créé, sans message (spec §4) ;
- enregistrement du schéma parent en lecture-écriture hors file d'attente, erreur seulement
  journalisée : même modèle que l'amorçage existant des types (GH365) ;
- noms déjà présents dans le schéma du composant cloné : pris en compte (`taken` inclut ses `linkTypes`).

## Mises à jour SPEC
- `SPEC-TEMPLATES.md` §3 — paragraphe « Types de liens créés par défaut (GH373) ».
- `SPEC-REQ-requirements.md` §5.1 — renvoi vers SPEC-TEMPLATES §3.
- `SPEC-INDEX.md` — lignes SPEC-TEMPLATES §3 et SPEC-REQ §5 : résumé, mots-clés, MAJ → GH373.

## Vérifications
- Niveau 1 : `pnpm typecheck` OK ; unitaires `defaultLinkTypes.gh373` 9/9.
- Niveau 2 : `pnpm test` — 5 échecs au premier passage, sur des services du main sans rapport (délais :
  durées de plusieurs millions de ms, poste en veille) ; ces 5 fichiers repassent seuls (98/98) et la
  suite desktop relancée passe (voir commit). E2E `gh373-` 5/5 et `gh365-` 4/4.

## Tester manuellement
1. Structure → « + » sur le repo racine → « + Composant » : section « Types de liens créés par défaut »,
   trois cases cochées et « Impact d'issue » grisée ; décocher Tests / Exigences masque les liens.
2. Composant local « Contrôle moteur » → onglet Liens : `controle-moteur-verification`,
   `-implementation`, `-implementation-parent` ; comparer avec un type saisi à la main (M-3).
3. Repo séparé neuf → onglet Liens, repo du composant : vérification et implémentation ; repo
   parent : implémentation depuis le parent.
4. Repo séparé déjà configuré : aucun type de lien créé (M-1). Interface en anglais (M-2).
