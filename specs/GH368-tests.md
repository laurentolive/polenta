# GH368 — Scénarios de test

Les références « CA » renvoient aux critères d'acceptation de `specs/GH368.md` §2.

## Unitaires

### `renderer/lib/memberSuggestions.test.ts`

| # | Scénario | Attendu |
|---|---|---|
| U-01 | texte vide ou fait seulement d'espaces | `[]` |
| U-02 | `ali` | alice (le texte est dans le login) |
| U-03 | `martin`, `MARTIN`, `martín` | la personne dont le nom est « Carol Martín » (le texte est dans le nom, casse et accents ignorés) |
| U-04 | `ownerOrg = acme` | les membres d'acme passent avant les autres, quel que soit l'ordre alphabétique (CA 1) |
| U-05 | même groupe | les logins qui commencent par le texte passent avant ceux qui le contiennent, puis l'ordre alphabétique |
| U-06 | `exclude: ['ALICE']` | alice n'est pas proposée (CA 6) |
| U-07 | 30 personnes correspondent | 8 suggestions au plus (CA 7) |

### `main/services/forge/member-suggestions.gh368.test.ts` (fausse forge, comme `forge.service.test.ts`)

| # | Scénario | Attendu |
|---|---|---|
| S-01 | Forgejo, organisations acme (alice, bob, moi) et beta (carol, bob) | alice, bob (acme, beta), carol ; le compte lui-même absent (CA 2) |
| S-02 | les membres de beta répondent 403 | les membres d'acme sont rendus (CA 10) |
| S-03 | `/user/orgs` répond 500, ou le réseau est coupé | `[]`, aucune exception (CA 10) |
| S-04 | deux appels successifs | les membres de chaque organisation ne sont lus qu'une fois (cache) |
| S-05 | toutes les requêtes enregistrées | aucune vers `/users/search` ni `/search/users` (CA 12) |
| S-06 | GitHub, sans le scope `read:org` | les organisations viennent de `/user/orgs`, puis les membres de `/orgs/{org}/members` |
| S-07 | `repoSettings` | rend `accountKey` et ne rend plus `orgMembers` |

## e2e web : `e2e-web/gh368-member-suggestions.spec.ts`

La fausse forge Forgejo connaît deux organisations : `e2e-org` (ann, bob) et `lecture` (carol,
« Carol Martín »).

| # | Scénario | Attendu |
|---|---|---|
| E-01 | Assistant, propriétaire `e2e-org`, saisie `a` | la liste propose ann puis carol (membre d'`e2e-org` d'abord), avec leur organisation (CA 1) |
| E-02 | Assistant, propriétaire = le compte, saisie `martin` | carol est proposée, « Carol Martín » affiché (CA 2, CA 3) |
| E-03 | `↓`, `Entrée` | ann est ajoutée, le champ est vide ; ann n'est plus proposée (CA 4, CA 6) |
| E-04 | `Échap`, liste ouverte | la liste se ferme et l'assistant reste ouvert (CA 4) |
| E-05 | `externe42` puis `Entrée` | `externe42` est ajouté (CA 5) |
| E-06 | Paramètres d'un repo personnel, saisie `b`, clic sur bob | bob est ajouté sur la forge (CA 8) |

Le client desktop utilise les mêmes composants et le même service : la suite web suffit (CA 13).

## Manuel (validation humaine)

- **M-01** : compte GitHub réel membre d'une organisation, assistant de création. Les membres de
  l'organisation sont proposés, puis le choix d'une suggestion envoie l'invitation (GitHub non
  simulé en e2e).
- **M-02** : lecteur d'écran ou clavier seul. La navigation dans la liste est annoncée.
