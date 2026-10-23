# GH93 — Scénarios de test

> Spec : `specs/GH93.md` ; design : `specs/GH93-design.md`. (U) = unitaire vitest, (E) = e2e web
> `e2e-web/gh93-params.spec.ts`, (M) = manuel.

## 1. Nominal

1. **Seed Campagnes, Toutes** (U corpus, E) — nouveau seed : barre avec un sélecteur « Campagne »
   sur « Toutes » ; lignes des six widgets identiques aux références actuelles.
2. **Choisir une campagne** (E) — choisir CAMP-0002 : les six widgets ne montrent que ses entrées ;
   « Avancement dans le temps » = aire empilée de ses seules entrées (U : comparé à
   `campaignTimeline(data, 'CAMP-0002')`).
3. **Campagne terminée** (U, E) — choisir une campagne `completed` alors que la requête filtre
   `in_progress` : ses entrées sont affichées.
4. **Mémorisation** (E) — fermer / rouvrir le dashboard, recharger le client : la campagne choisie est
   conservée ; `git status` ne montre aucune modification (seul `.{user}.pref`, ignoré).
5. **Par utilisateur** (U) — deux utilisateurs, choix différents sur le même dashboard partagé :
   chacun lit le sien (`getParamValues`).
6. **Réinitialiser** (E) — retour à « Toutes ».
7. **Réexécution ciblée** (E / U hook) — dashboard avec un widget sans paramètre : changer la
   campagne ne relance pas ce widget (aucun nouvel appel `suivi:run` pour lui).
8. **Période** (U, E) — `campaign-timeline` avec `periodAtDisplay` : du 2026-09-01 au 2026-09-15 →
   dates des lignes bornées ; une seule borne → l'autre selon le comportement actuel.
9. **Liste filtrée** (U) — `componentAtDisplay` : composant choisi → seuls ses objets ; « Tous » →
   composant fixé du modèle, sinon tous. `objectTypeAtDisplay` : type de catégorie `test` → lignes
   de tests (colonnes des tests).
10. **Requête personnalisée, 6 kinds** (U, E pour `enum` et `text`) — déclaration des six kinds dans
    `/query` ; le script renvoie `polenta.params` en une ligne : valeurs au format spec §3 ; la
    transformation reçoit les mêmes.
11. **Partage de sélecteur** (U `dashboardSelectors`, E) — deux requêtes déclarant `campaign:campaign`
    → un seul sélecteur ; `campaign` de kind `text` dans une 3ᵉ → un 2ᵉ sélecteur distinct.
12. **Drill-down** (E) — campagne choisie, clic sur un point de l'aire : la popup ne liste que des
    entrées de cette campagne.
13. **Popup de configuration** (E) — aperçu et colonnes calculés avec la campagne choisie.
14. **Impression / docx** (U docx, M impression) — en-tête « Campagne : CAMP-0002 — <titre> » ;
    « Toutes » si aucune ; tables des widgets filtrées.
15. **Export Excel `/query`** (M) — exporte les lignes calculées avec les valeurs de la barre.
16. **MCP** (U) — `create_query` avec `parameters` → `query.yaml` les porte ; `run_query { queryId,
    params: { campaign: 'CAMP-0002' } }` → lignes filtrées ; `test_script { script, parameters, params }`.

## 2. Cas limites

17. **Aucun paramètre** (E) — dashboard Status : pas de barre, rendu inchangé.
18. **Valeur introuvable** (E) — campagne choisie puis fichier de campagne supprimé : sélecteur
    « Valeur introuvable : CAMP-0009 », widgets en « Toutes » ; la campagne recréée (même id,
    ex. retour de branche) → choix de nouveau effectif (valeur non effacée du `.pref`).
19. **`required` sans valeur** (U, E) — widget « Choisir Campagne », pas d'appel `suivi:run` ; MCP
    `run_query` sans la valeur → erreur `params` ; option « Toutes » absente du sélecteur.
20. **`required` avec défaut** (U) — exécution avec le défaut.
21. **Clé non déclarée** (U) — `suivi:run` / MCP avec `params: { foo: 'x' }` → erreur `params`.
22. **Valeur hors format** (U) — `period { from: '2026-09-15', to: '2026-09-01' }`, `enum` hors
    valeurs, texte > 1000 → erreur `params` (MCP) ; dans la barre : refus avec message, valeur
    précédente conservée.
23. **Texte** (E) — saisie appliquée à Entrée / blur seulement ; espaces de bord retirés ; vide →
    `null`.
24. **Déclaration invalide** (U) — nom dupliqué, nom `1abc`, kind inconnu, `enum` sans valeurs,
    défaut hors format : refus à l'enregistrement (app, MCP `PARAMS_INVALID`) ; `query.yaml` modifié
    à la main avec une déclaration invalide → widget en erreur `format`, pas d'exécution.
25. **Modèle + `parameters`** (U) — MCP `create_query { template, parameters }` → `INVALID_INPUT`.
26. **Personnalisation par la déclaration** (U) — requête modèle dont seule la déclaration est
    modifiée → `state.customized = true` ; requête modèle sans paramètre : empreinte = celle du script
    seul.
27. **Cache / partage** (U moteur) — deux exécutions simultanées du même script avec des `params`
    différents → deux exécutions, résultats distincts ; mêmes `params` → une seule.
28. **Hôte gelé** (U sandbox) — `polenta.params.campaign = 'x'` ou `polenta.params.period.from = …`
    dans un script → sans effet (mode strict des modules : `TypeError`), affiché comme erreur
    `runtime`.
29. **Changement de portée** (U) — dashboard privé → partagé : les valeurs suivent le nouvel id ;
    suppression du dashboard : clé retirée du `.pref`.
30. **Changement de déclaration** (U `dashboardSelectors`) — `kind` modifié : nouveau sélecteur,
    ancien choix ignoré puis retiré à la prochaine écriture du `.pref`.
31. **Branche en lecture seule** (E si possible, sinon M) — dashboard partagé sur `prj-*` : sélecteurs
    utilisables, choix mémorisé.
32. **Dashboard `newer-format`** (U) — valeurs lues / écrites dans le `.pref`.
33. **Client web** (E) — scénarios 2, 4 et 6 sur le client web (les e2e tournent sur le client web).
34. **Impression avec `required` manquant** (M) — l'impression se termine (widget « Choisir … »
    compté comme rendu).

## 3. Non-régression

35. `pnpm test` : corpus Suivi (références inchangées sans `params`), budgets de performance tenus.
36. e2e existants `gh74-*.spec.ts`, `gh65-*.spec.ts` verts.
37. `polenta.d.ts` à jour (test de génération).

## 4. Critères d'acceptation

Ceux de `specs/GH93.md` §9 ; chacun couvert par au moins un scénario ci-dessus (1–4, 6–16, 18–19,
22, 24).
