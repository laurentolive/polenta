# GH373 — Scénarios de test

## Unitaires (`defaultLinkTypes.gh373.test.ts`)

- U-1 `offeredDefaultLinks` : toutes catégories + parent avec exigence → 3 liens ; sans test → pas
  de vérification ; sans exigence → aucun ; parent sans exigence → pas de lien parent.
- U-2 `showsIssueImpact` : vrai seulement avec issue + requirement.
- U-3 `linkTypeNamingRoot('Contrôle moteur')` → `controle-moteur`.
- U-4 `defaultLinkTypes` composant local `moteur` : refs `moteur::…`, `defaultVisible` seulement
  sur la vérification, lien parent dans `parent` avec `root::SYS`.
- U-5 repo séparé (`node: 'root'`) : refs `root::…`.
- U-6 collision : noms pris `controle-moteur-verification` → `-2` ; deux noms produits ne se
  heurtent pas.
- U-7 extrémité absente (pas de type test créé, `parentRefs` vide) → lien omis.
- U-8 forme : clés exactement celles de l'onglet Liens (`defaultVisible` absent quand faux).

## E2E (`e2e-web/gh373-default-links.spec.ts`, client web, projet de démo)

- E-1 Fenêtre : 3 cases + `issue-impact` grisée cochée ; décocher Tests masque Vérification, la
  re-cocher la ré-affiche dans son état ; décocher Exigences masque tout.
- E-2 Composant local, tout coché : schéma du repo avec les 3 types de liens (noms, refs, libellés)
  et `issue-impact` ; création d'un lien test → exigence du composant et d'un lien exigence du
  parent → exigence du composant via `requirements:link-create` sans erreur.
- E-3 Lien décoché (implémentation interne) → non créé, les autres oui.
- E-4 Second composant même label → suffixe `-2`.
- E-5 Repo séparé neuf (repo nu de la forge locale, comme GH365 M-1) : vérification et
  implémentation dans le schéma du composant (refs `root::`), implémentation-parent dans le schéma
  du parent.

## Manuel

- M-1 Repo séparé dont le `root` a déjà des types : aucun type de lien créé (repo existant
  configuré, difficile à monter en e2e).
- M-2 Vérification visuelle de la section (mise en page, infobulle de `issue-impact`), en anglais aussi.
- M-3 Équivalence (critère 9) : comparer le YAML d'un type créé par la fenêtre avec le même saisi à
  la main dans l'onglet Liens.
