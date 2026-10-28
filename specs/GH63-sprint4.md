# GH63 — Sprint 4 : serveur web et page Administration

Périmètre : `specs/GH63-design.md` §7 Sprint 4, §3.3, §3.4, §5.1. Scénarios : `specs/GH63-tests.md` §Sprint 4.

## Fichiers

| Fichier | Changement |
|---|---|
| `apps/desktop/src/web-server/config.ts` | `admin: {url, serviceToken, dev} \| null` depuis `POLENTA_ADMIN_URL` / `POLENTA_ADMIN_SERVICE_TOKEN` (32 caractères au moins). En mode dev : seulement avec `POLENTA_WEB_ADMIN_DEV=1`, **démarrage refusé** avec `NODE_ENV=production`. |
| `apps/desktop/src/web-server/admin/admin-routes.ts` (nouveau) | `/admin/api/*` : session (CSRF sur `POST`), sessions d'impression refusées, **liste fermée** de chemins (segments à motif strict) et de paramètres de requête, relais avec le jeton de service et le jeton forge de l'utilisateur (OAuth rafraîchi ; jeton du mode dev). `/admin/status` : découverte en 200. Hors `channel-policy.ts`. |
| `apps/desktop/src/web-server/admin/admin-client.ts` (nouveau) | Client HTTP du service (30 s), 503 « injoignable » sans fuite d'en-tête. |
| `apps/desktop/src/web-server/app.ts` | Branchement des routes ; `/admin/api/` et `/admin/status` exclus du repli SPA. |
| `renderer/platform.ts` | `capabilities.serverAdmin: isWeb`. |
| `renderer/lib/adminApi.ts`, `renderer/hooks/useAdmin.ts` (nouveaux) | Client `/admin/api`, niveau (une fois par session), suivi d'un travail par sondage 1 s avec décalage du journal et reprise après coupure, travail en cours (5 s) pour le bandeau. |
| `renderer/components/admin/*` (nouveaux) | `AdminPage` (onglets Instances, Sauvegardes, Hôte au niveau hôte, Journal, DNS ; `tablist` ARIA), `InstancesPanel`, `BackupsPanel`, `HostPanel`, `JournalPanel` (export CSV), `DnsCheck`, `JobView` (journal `aria-live`, annulation, résultat, valeur à usage unique), `JobBanner`, `ConfirmByName`, `useLaunch` (409 : opération, auteur, heure). |
| `renderer/routes/admin.tsx`, `routeTree.gen.ts` | Route `/admin`. |
| `renderer/components/sidebar/AccountPanel.tsx` | Entrée « Administration du serveur » si `/admin/status` dit disponible. |
| `renderer/components/layout/AppLayout.tsx`, `contexts/TabsContext.tsx` | Bandeau global (version web) ; titre d'onglet. |
| `renderer/i18n/locales/{fr,en}.json` | Bloc `admin.*`. |
| `apps/desktop/e2e-web/gh63-admin.spec.ts`, `support/fake-admin-service.mjs` (nouveaux), `support/env.ts`, `playwright.config.ts`, `README.md` | E2E contre un faux service (démarré par Playwright). |

## Divergences par rapport au design

1. **Pas de `isOrgOwner` dans le web-server ni de `owner-level.ts`** : le droit est revérifié par le
   service à chaque requête (jeton utilisateur → `GET /user` → `is_owner`, Sprint 2). Le recalculer dans
   le web-server doublerait la source de vérité sans rien protéger de plus.
2. **`GET /admin/status` (nouveau, toujours 200)** pour la découverte : un 403/404 sur `/admin/api/me`
   ferait apparaître une erreur dans la console du navigateur de chaque non-propriétaire (S4-2) et de
   chaque utilisateur d'un serveur sans administration (S4-7). `/admin/api/me` garde ses codes.
3. **Entrée dans le panneau Compte** (barre latérale) : `AccountMenu.tsx` n'est monté nulle part.
4. **Pas d'onglet « Mises à jour » séparé** : la mise à jour de la forge se lance depuis la ligne de
   l'instance (version saisie, validée par le service), avec avertissement pour l'instance courante.
5. **Arrêt et désactivation du client web de l'instance courante non proposés** (refusés de toute façon
   par le service, code 18).

## Tests

- **Serveur web** (`src/web-server/admin/admin-routes.test.ts`, 12) : relais et jetons jamais renvoyés au
  navigateur, CSRF (S4-9), 401 sans session (S4-9), chemins hors liste et paramètres non prévus jamais
  relayés, CSV, service injoignable → 503, `ADMIN_UI=off` → 404 et découverte `available: false` (S4-7),
  session d'impression → 403 (S4-3), `POLENTA_WEB_ADMIN_DEV` refusé en production (S4-4), aucun channel
  `admin:*` (S4-8).
- **Suite desktop** (`vitest`) : 750/750 verte ; `tsc --noEmit` sans erreur ; build web OK.
- **E2E** (`gh63-admin.spec.ts`, 5 verts ; `gh56-activity-bar` rejoué, 10 verts) : S4-2 non-propriétaire
  (aucune entrée, aucune erreur console, API 403) ; S4-1 niveau instance (entrée, page, pas d'onglet Hôte,
  pas d'arrêt/suppression de sa propre instance) ; sauvegarde suivie jusqu'à « Réussi », bandeau global,
  refus 409 lisible ; S4-5 niveau hôte (toutes les instances, onglet Hôte, suppression confirmée par le
  nom exact, redémarrage exigeant le nom d'hôte) ; DNS et journal avec lien CSV.

Non couverts : S4-6 (desktop : `capabilities.serverAdmin` faux, aucune requête — par construction),
cloisonnement de bout en bout avec un vrai service et une vraie forge (§Sprint 4 « bout en bout »).

Note poste : le build web de cette branche échoue sans le correctif GH131 (`@aws-sdk/client-s3` externe,
déjà sur `main`) ; il a été appliqué localement le temps du build, non commité ici (viendra avec la
remise à niveau de la branche sur `main`). ESLint : pas de configuration sur cette branche.
