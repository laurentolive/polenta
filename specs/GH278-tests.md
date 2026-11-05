# GH278 — Scénarios de test

## Automatiques

| ID | Scénario | Fichier |
|---|---|---|
| G1 | `--out C:foo`, `--out` sans valeur, `--out` dans le repo Polenta : refus, rien de supprimé | `demo-conformity.test.ts` |
| C1 | Chaque schéma est accepté (`schema.service`), aucun avertissement de transition | idem |
| C2 | Arbres sans `name` ; ID jamais réutilisés (tombstones) | idem |
| C3 | Chaque campagne ne contient que des tests de son dépôt | idem |
| C4 | Vues d'équipe lues sans `teamError` | idem |
| C5 | Versions : états attendus, `freeze.sha` existant, tag présent, composants released | idem |
| C6 | Validations signées : aucune ligne « à revoir », une copie par entrée, signataire et date lus | idem |
| C7 | VAL-0002 : montre *en attente*, *proposée*, *à revoir*, décisions reprises | idem |
| C8 | Issues : origine et liens `issue-impact` résolus | idem |
| C9 | Runs après la première version : `testedConfig` présent, dont un écart | idem |
| C10 | Tout ID cité dans le guide et les tutoriels FR / EN existe, sauf liste explicite | idem |
| C11 | Défauts annoncés toujours présents : PRD-0012, SYS-0012, 4 éléments à revalider, MOT-0004 en échec | idem |
| X1 | Exercices à refus : label pris, released avec changement non commité, signature refusée, TMOT-0003 en campagne produit, run sans version | `demo-exercises.test.ts` |
| X2 | Exercices à effet : inclure dans LLV-0002, décider dans VAL-0002, issue depuis un run, suppression avec tombstone | idem |
| S1 | Références de `suivi-corpus` à jour (diff relu) | `suivi-corpus.test.ts` |
| E1 | Tutoriel 9 dans l'interface : page de version, backlog, analyse | `gh278-versions.spec.ts` |
| E2 | Tutoriel 10 : issue, validation, reflets | `gh278-validation.spec.ts` |
| E3 | Tutoriel 4 : exécution avec version testée | `gh278-tested.spec.ts` |
| E4 | e2e dépendant de la démo sur la démo régénérée : `gh22`, `gh77`, `gh93`, `gh183`, `gh106`, `parity`, `s4-*` | existants |

## Cas limites

- `gh77-history` a besoin d'une exigence sans `history` : pompe, Wi-Fi, bus n'en ont pas.
- Le pin SHA du Wi-Fi doit viser le dernier commit Wi-Fi après la release.
- La branche `dev-essorage-1600` ne doit pas casser la lecture des versions.
- Régénérer deux fois donne le même contenu de fichiers (déterminisme).

## À la main (validation finale)

Parcours des tutoriels 9 et 10 sur la démo générée. Autres exercices vérifiés par l'agent une fois sur la
démo ; ce qui l'a été est listé dans le résumé du dernier sprint.
