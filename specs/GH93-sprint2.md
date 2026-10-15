# GH93 — Sprint 2 : interface, exports, e2e, SPEC

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `renderer/lib/suiviParamValues.ts` (nouveau, + test) | valeurs effectives de la barre : choix > défaut, valeur introuvable signalée (liste en chargement : rien d'invalide), obligatoires manquants, nettoyage des choix orphelins, libellés |
| `renderer/hooks/useDashboardParams.ts` (nouveau) | sélecteurs du dashboard, options (campagnes avec statut, composants, types), choix lus / écrits (`dashboards:param-values-*`, écriture optimiste), `ready` (choix et listes lus : une seule exécution), `paramsFor` / `missingFor` / `describe` |
| `renderer/components/dashboard/ParamBar.tsx` (nouveau) | barre : liste (campagne, composant, type, énumération ; « Tous / Toutes » sauf obligatoire), texte validé à Entrée / perte du focus, période (deux dates, début > fin refusé), « Valeur introuvable », Réinitialiser ; mode impression en texte |
| `renderer/components/dashboard/ParameterDeclEditor.tsx` (nouveau) | déclaration éditable (nom, type, libellé, valeurs, défaut, obligatoire, ordre), erreurs en ligne |
| `renderer/components/dashboard/DashboardGrid.tsx` | valeurs par widget, carte « Choisir <libellé> », attente des choix, drill-down avec les valeurs |
| `renderer/hooks/useScriptRun.ts` | valeurs dans la requête et la clé du résultat du widget |
| `renderer/routes/dashboard.tsx` | barre ; export docx avec valeurs et paramètres ; popup de widget avec les valeurs |
| `renderer/routes/print.dashboard.tsx` | valeurs de l'utilisateur, barre en texte sous le titre |
| `renderer/components/dashboard/WidgetConfigModal.tsx` | colonnes et aperçu avec les valeurs du dashboard |
| `renderer/routes/query.tsx` | déclaration (générée en lecture seule / éditable en mode Script), barre locale non mémorisée, exécution et export avec ces valeurs, enregistrement bloqué si déclaration invalide |
| `renderer/hooks/useSuiviCatalog.ts` | statut des campagnes dans les options |
| `packages/types/src/export.ts`, `main/services/export/dashboard.docx.ts`, `template/template-data-campaign.ts` | `parameters` du payload : paragraphes en tête (docx), `{#parameters}` (gabarit) |
| i18n `fr` / `en` | `suiviParams.*` |
| `e2e-web/gh93-params.spec.ts` (nouveau) | 6 scénarios |
| SPEC, tutoriel | voir ci-dessous |

## Comportement implémenté

Dashboard *Campagnes* : sélecteur **Campagne** en tête (« Toutes » = campagnes en cours) ; une
campagne choisie, même terminée, recentre les six widgets, y compris l'avancement dans le temps et
son drill-down. Choix mémorisé par utilisateur (`.pref`), retrouvé après rechargement, rien à
publier ; Réinitialiser ; valeur introuvable signalée. Toute requête peut déclarer des paramètres
(six types) ; les widgets qui partagent un paramètre partagent le sélecteur ; seuls les widgets
concernés se réexécutent ; paramètre obligatoire sans valeur → « Choisir … ». Vue Requêtes : barre
locale et déclaration éditable. Impression et docx : valeurs rappelées en tête.

## Divergences par rapport au design

- La barre de `/query` garde la dernière déclaration valide tant que l'éditeur contient une erreur
  (une ligne en cours de saisie n'y apparaît pas) ; l'exécution déclenchée par la barre utilise cette
  même déclaration.
- `useDashboardParams.ready` attend aussi les listes d'options nécessaires (constat de revue) : sinon
  une valeur devenue introuvable s'exécutait avant d'être remplacée par le défaut.

## Revue de code (`/code-review`)

Corrigés : attente d'un paramètre obligatoire évaluée avant la lecture des choix (impression
déclarée prête trop tôt) ; listes vides pendant le chargement (défaut écarté dans `/query`) ;
textarea des valeurs d'énumération resté sur une autre ligne après suppression / réordonnancement ;
`ready` sans les listes d'options ; exécution depuis la barre avec une déclaration en cours de saisie
invalide ; nom ajouté en double dans l'éditeur ; double rendu du modèle à chaque exécution.
Non retenus : aperçu de la popup pour une requête dont le paramètre obligatoire n'est pas encore
dans la barre (erreur explicite affichée, sélecteur présent une fois le widget enregistré) ; période
dont le début dépasse la fin refusée sans état intermédiaire (spec §3) ; libellé bilingue remplacé
par un texte à l'édition (spec §1 : un seul texte accepté).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-DASHBOARDS.md` en-tête, §1 | paramètres choisis à l'affichage (renvoi §5.1) |
| `SPEC-DASHBOARDS.md` §2 | hôte gelé, `polenta.params` |
| `SPEC-DASHBOARDS.md` §3 | partage d'exécution par valeurs, erreur `params`, canaux (`params`, `parameters`, `dashboards:param-values-*`) |
| `SPEC-DASHBOARDS.md` §5, §5.1 (nouvelle) | options « choisi à l'affichage » des modèles, empreinte avec la déclaration ; déclaration, types, résolution, barre, valeurs par utilisateur, vue `/query`, comportement des modèles |
| `SPEC-DASHBOARDS.md` §6 | drill-down et exports avec les valeurs |
| `SPEC-DASHBOARDS.md` §7.0, §7.1 | `parameters` de `query.yaml`, `suiviParamValues` ; sélecteur Campagne du seed |
| `SPEC-DASHBOARDS.md` §10 | hors scope GH93 |
| `SPEC-MCP-SERVER.md` §global (outils Suivi) | `parameters` / `params`, `PARAMS_INVALID` |
| `SPEC-INDEX.md` | lignes SPEC-MCP-SERVER §global, SPEC-DASHBOARDS §1–§3, §4–§6, §7, §8–§10 → MAJ GH93 |
| `docs/tutoriels/06-suivi.md` | paragraphe « Paramètres choisis à l'affichage » |

## Tests

- Vitest (desktop) : 51 fichiers, 597 tests verts ; `tsc` sans erreur.
- e2e web complets : 100 réussis, 13 ignorés (dont `gh93-params.spec.ts` : 6 / 6).

## Tester manuellement

1. Vue Suivi → *Campagnes* : sélecteur « Campagne » sur *Toutes* ; choisir une campagne terminée →
   les six widgets n'affichent qu'elle ; clic sur un point de « Avancement dans le temps » → entrées
   de cette campagne seulement.
2. Fermer / rouvrir l'application : la campagne est toujours choisie ; `git status` ne montre rien
   de nouveau ; *Réinitialiser* → *Toutes*.
3. Exporter le dashboard en Word et en PDF : « Campagne : CAMP-… — titre » en tête.
4. Vue Requêtes, mode Script : ajouter un paramètre texte et une liste de valeurs, lire
   `polenta.params` dans le script, changer les valeurs dans la barre (relance), enregistrer ; ajouter
   la requête à un dashboard → sélecteurs dans sa barre.
5. Modèle « Avancement dans le temps » avec « Période choisie à l'affichage » : bornes du / au.
