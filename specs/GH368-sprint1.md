# GH368 — Sprint 1 (unique)

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/forge.ts` | `ForgeMemberSuggestion` ; `RepoSettings.accountKey` ajouté, `orgMembers` retiré |
| `apps/desktop/src/main/services/forge/forge-provider.ts` | `listUserOrgs?` |
| `apps/desktop/src/main/services/forge/forgejo.provider.ts` | `listUserOrgs` (`GET /user/orgs`) |
| `apps/desktop/src/main/services/forge/github.provider.ts` | `userOrgs` extrait de `listOwners`, `listUserOrgs` |
| `apps/desktop/src/main/services/forge/forge.service.ts` | `memberSuggestions`, `cachedOrgMembers` (cache par compte, 10 min), `repoSettings.accountKey` |
| `apps/desktop/src/main/ipc/index.ts`, `packages/api-client/src/{types,ipc-client}.ts`, `apps/desktop/src/web-server/channel-policy.ts` | canal `forge:member-suggestions` |
| `apps/desktop/src/renderer/lib/memberSuggestions.ts` | `rankMemberSuggestions` |
| `apps/desktop/src/renderer/components/repo/MemberLoginInput.tsx` | combobox de complétion |
| `apps/desktop/src/renderer/components/repo/RepoMembersEditor.tsx`, `RepoSettingsModal.tsx` | utilisation ; `datalist` retirée |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `repoWizard.members.suggestions` |
| `apps/desktop/e2e-web/support/fake-forgejo-api.ts` | membres propres à chaque organisation (`lecture` : carol) |
| tests | `member-suggestions.gh368.test.ts`, `memberSuggestions.test.ts`, `gh368-member-suggestions.spec.ts` ; `repo-settings.gh108.test.ts` et `gh108-repo-settings.spec.ts` adaptés |

## Comportement implémenté

Conforme à `specs/GH368.md`. Le champ login des collaborateurs, dans l'assistant de création et
dans les Paramètres du repo, propose les membres de toutes les organisations du compte : login, nom
affiché et organisations. Les membres de l'organisation propriétaire sont en tête, avec 8
suggestions au plus. Le champ se pilote au clavier et à la souris, et la saisie libre reste
acceptée.

## Divergences par rapport au design

Corrections issues de la revue de code :

- **Cache des membres dans le main**
  - La clé passe de `(hôte, org)` à `(compte, org)` : deux comptes d'un même hôte peuvent voir des
    listes différentes (membres privés).
  - Durée de vie de **10 min** au lieu de la durée du processus : sur le serveur web, qui tourne
    longtemps, un nouveau membre finit ainsi par être proposé.
  - `forge:org-members` (champ `user`) suit la même règle.
- **Liste dans le renderer** : `staleTime` de 5 min au lieu de `Infinity`. Ainsi, une liste vide
  (hors ligne) ou partielle n'est pas gardée toute la session (spec §1.6).
- **Clavier** : `↓`, liste fermée (après `Échap`), rouvre la liste sur la première suggestion. Avant
  la correction, il fallait appuyer deux fois.
- **Sélection** : elle est bornée quand la liste raccourcit sous elle (membre ajouté entre-temps).
- **Paramètres du repo**
  - Le champ est vidé dès l'ajout, et non plus seulement après la réponse de la forge.
  - Pendant une action en cours, le login choisi reste dans le champ au lieu d'être perdu.

Points de revue laissés en l'état :

- **Détection de `isOrg`** : `repoSettings` lit toujours les membres de l'organisation pour savoir
  si le propriétaire en est une. Forgejo ne fournit pas `ownerKind`, il n'y a donc pas d'autre
  source. Le comportement est le même qu'avant ce ticket.
- **Appels redondants** : `GET /orgs/{org}` (Forgejo) et la sonde de scope `GET /user` (GitHub)
  restent appelés. Chacun ne coûte qu'un aller-retour, au chargement seulement.

## Mises à jour SPEC

- `SPEC-PROJECT-MANAGEMENT.md` :
  - nouveau **§9.5** « Complétion du login d'un membre » ;
  - §9.1 et §9.4 : renvoi vers §9.5 ;
  - §9.3 : cache par `(compte, organisation)` pendant 10 min.
- `SPEC-INDEX.md` : ligne `SPEC-PROJECT-MANAGEMENT.md §3+`, résumé et mots-clés complétés, `MAJ`
  = GH368.

## Vérifications

- `pnpm typecheck` : OK.
- `pnpm test` : 1830 tests desktop, 124 admin-service et 83 merge-core, tous verts.
- e2e web `gh368-`, `gh107-` et `gh108-` : 21 tests passés.
- `pnpm lint` : aucun paquet n'a de tâche lint (0 tâche).

## Comment tester manuellement

1. Compte Forgejo (VPS) membre d'au moins deux organisations. « Créer un nouveau projet » → « Sur le
   serveur ».
   - Taper une lettre dans « Compte à ajouter » : les membres proposés indiquent leurs
     organisations.
   - Propriétaire = une organisation : ses membres passent en tête.
2. Clavier : `↓`/`↑`, `Entrée` ajoute, `Échap` ferme la liste sans fermer l'assistant. Un login
   inconnu se saisit toujours librement.
3. Paramètres d'un repo personnel : les suggestions sont présentes (auparavant aucune), et un clic
   ajoute le membre.
4. GitHub réel (M-01) : les membres d'une organisation sont proposés, et un clic envoie
   l'invitation.
