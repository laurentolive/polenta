# GH377 — Sprint 1 (unique)

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/schema-defaults.ts` (nouveau) | Défauts partagés : `DEFAULT_VERSION_STATUSES`, `DEFAULT_VALIDATION_STATUSES`, `DEFAULT_VALIDATION_DECISIONS` |
| `packages/types/src/validation.ts` | `entryFieldsError` (noms, `decision` réservé, `requiredWhen` strict), réutilisable par #371 |
| `apps/desktop/src/main/services/schema.service.ts` | `prepareNewObjectType` appelé par `addObjectType` |
| `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts` | zod : catégories `version` / `validation`, `decisions`, `entryFields` ; description de l'outil |
| `apps/desktop/src/renderer/components/schema/objectTypeEditor.tsx` | Constantes de l'éditeur dérivées des défauts partagés |
| `apps/desktop/src/main/services/agents-md.template.ts` | Mention dans la liste des outils de schéma |
| `apps/desktop/src/main/services/mcp-schema.gh377.test.ts` (nouveau) | 14 tests (scénarios 1–12 + revue) |

## Comportement implémenté

Conforme à `specs/GH377.md` (D1–D5). `add_object_type` crée le type version et le type validation ; listes
absentes → défauts de l'éditeur ; refus avant écriture (schéma inchangé octet pour octet).

## Divergences / ajouts

Ajoutés après la revue de code (contrôles propres au MCP, dans l'esprit de D4) :

- type version : le **premier statut** (statut de création) ne peut être ni `isApproval` ni `isTerminal` —
  sinon `create_version` ferait naître une version « released » sans tag ni gel ;
- version et validation : **noms de statuts uniques** (`STATUS_NAME_TAKEN`) — l'état se lit par nom ;
- `entryFields: []` → clé omise, comme l'éditeur.

Non retenus (hors périmètre ou préexistants, à ouvrir en issue si souhaité) : contrôle de ces règles dans
`save` (chemin de l'éditeur et `add_status`, D4 les limite au MCP) ; préfixe avec espaces non normalisé (vaut
pour toutes les catégories) ; réponse d'`addObjectType` = schéma avant les transformations de `save`
(`withIssueImpactLink`, sans effet pour version / validation).

## Mises à jour SPEC

- `SPEC-MCP-SERVER.md` §4.3 : ligne `add_object_type` + paragraphe GH377 (défauts, contrôles, codes).
- `SPEC-INDEX.md` : ligne SPEC-MCP-SERVER (résumé, mots-clés), MAJ → GH377.
- SPEC-REQ §11.1 / §13 : inchangées (modèle de données identique ; seule la voie de création change).

## Comment tester manuellement

Avec le serveur MCP sur un projet sans type version / validation :

1. `add_object_type { nodeName: "root", objectType: { name: "version", prefix: "PV", category: "version" } }`
   → schéma avec `en_cours` / `released` / `abandonnee` ; dans l'application, l'onglet Structure montre le type
   avec ces statuts et couleurs.
2. Idem `category: "validation"`, `prefix: "WASHER_VAL"` → trois statuts, cinq décisions ; l'éditeur du type
   affiche les décisions comme pour un type créé dans l'application.
3. `create_version`, `release_version`, puis `create_validation` sur cette version → fonctionnent.
4. Nouvelle création d'un type validation → `[VALIDATION_TYPE_INVALID]`.
5. Dans l'application : Structure → Ajouter → Version / Validation sur un autre projet → mêmes défauts qu'avant.
