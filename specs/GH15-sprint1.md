# GH15 — Sprint 1 (unique) : délais d'attente réseau réglables

Spec : `specs/GH15.md` · Design : `specs/GH15-design.md` · Tests : `specs/GH15-tests.md`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `apps/desktop/src/shared/network-timeout.ts` | **Nouveau** — bornes 10–120, défaut 10, `normalizeNetworkTimeout`. |
| `apps/desktop/src/main/services/net-timeouts.ts` | **Nouveau** — délai courant du process, `scaledTimeout`, délais de base, `isNetworkTimeoutAdjustable`, crochet de test. |
| `packages/types/src/app.ts` | `AppSettings.networkTimeoutSeconds?`. |
| `apps/desktop/src/main/services/app-settings.service.ts` | Lecture normalisée, écriture seulement si ≠ 10, rappel `onNetworkTimeout` (construction + écriture). |
| `apps/desktop/src/main/host/host-context.ts`, `electron-host.ts`, `container.ts` | `HostContext.applyNetworkTimeout` (desktop seulement) passé à `AppSettingsService`. |
| `apps/desktop/src/main/services/net-proxy.ts` | Dispatcher toujours explicite avec délai de connexion (direct `Agent`, proxy `proxyTls`/`requestTls`), cache par (proxy, délai) ; `isTimeoutError`, `describeTimeout` ; `describeFetchError` lit le code sur l'erreur **ou** sa cause. |
| `apps/desktop/src/main/services/git-http.ts` | `headersTimeout`/`bodyTimeout` explicites ; erreurs de délai traduites (requête et lecture du corps), code d'origine conservé. |
| `apps/desktop/src/main/services/forge/forge-http.ts` | `scaledTimeout(opts.timeoutMs ?? 20 s)`. |
| `apps/desktop/src/main/services/export/template/image-source.ts` | `AbortSignal.timeout(scaledTimeout(10 s))`. |
| `apps/desktop/src/renderer/platform.ts` | `capabilities.networkTimeout: !isWeb`. |
| `apps/desktop/src/renderer/components/sidebar/AccountPanel.tsx` | Champ « Délai de connexion réseau (s) » dans Préférences. |
| `apps/desktop/src/renderer/components/layout/ModificationControl.tsx` | Publier : cause affichée sous « réseau indisponible ». |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | `networkTimeout`, `networkTimeoutHint`. |
| Tests | `net-timeouts.test.ts`, `app-settings.service.gh15.test.ts`, `net-proxy.gh15.test.ts`, `git-http.gh15.test.ts` (nouveaux). |

## Comportement implémenté

- Préférence `networkTimeoutSeconds` (10–120 s, défaut 10) dans le panneau Compte › Préférences,
  desktop uniquement. Saisie validée au blur / Entrée ; une valeur invalide remet le champ à la
  valeur enregistrée. Le réglage est appliqué immédiatement (requête suivante), sans redémarrage.
- Tous les délais réseau du desktop sont multipliés par `réglage / 10` : connexion (direct et
  proxy), API de la forge (y compris les sondes à 10 s), git HTTPS, images d'export. À 10, délais
  identiques à avant.
- Délai dépassé : message « Délai d'attente dépassé (délai de connexion réseau : N s) — augmentez-le
  dans Compte → Délai de connexion réseau… » pour l'API de la forge et les opérations git. Sur le
  serveur web (réglage non proposé) le message ne cite pas le réglage.

## Divergences par rapport au design

1. **Message sans le réglage sur le web** (`isNetworkTimeoutAdjustable`) : non prévu au design ;
   trouvé en revue — le message aurait cité un réglage masqué sur le web.
2. **Publier** : le fetch préalable (T154) qui échoue sur délai produisait le message générique
   « réseau indisponible » sans la cause, donc sans la mention du réglage. La cause (message traduit
   du main) est maintenant affichée sous ce message, pour toutes les erreurs réseau de Publier.
   Le classement et le comportement de Publier sont inchangés.
3. **Test du lien lent** : les minuteries de connexion d'undici ont une résolution d'~1 s ; le
   test simule donc un lien qui retarde de 3 s (délai réduit à 1 s → échec ; 6 s → succès) au
   lieu de quelques centaines de ms.
4. Le `/code-review` lancé par l'outil a examiné le checkout principal (`main`) au lieu du worktree :
   ses remarques portaient sur un autre diff et sont sans objet. Revue faite à la main sur le diff
   GH15 (d'où la divergence 1).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TECH-stack.md` §9 | Nouvelle ligne « Délais réseau (GH15) » ; `networkTimeoutSeconds` ajouté à la liste des préférences app-level (« Données utilisateur »). |
| `SPEC-INDEX.md` | Ligne `SPEC-TECH-stack.md §9` : résumé, mots-clés, MAJ → GH15. |

`SPEC-FORKS-BRANCHES-BASELINES.md` §2.5–2.6 et `SPEC-ACCOUNTS-AUTH.md` : pas de divergence (classement
réseau inchangé, aucun changement d'authentification).

## Tests

- `pnpm test` : 836 tests verts (dont 28 nouveaux GH15) ; typecheck sans erreur.
- `pnpm --filter @polenta/desktop test:e2e:web` : voir commentaire de l'issue (réglage masqué sur le web).

## Comment tester manuellement

Voir `specs/GH15-tests.md` § Tests manuels :
- **M1** — panneau Compte : valeur 10, saisie 40 → `app-settings.json`, valeurs invalides rejetées,
  redémarrage, retour à 10 (clé supprimée), présent sans compte connecté.
- **M2** — proxy local qui retarde la mise en relation de 15 s (`HTTPS_PROXY=http://127.0.0.1:<port>`) :
  clone en échec à 10 s avec le message citant le réglage, puis 30 s sans redémarrer → clone et
  « Rafraîchir » aboutissent.
- **M3** — hors ligne avec 60 s : échec immédiat (DNS).
- **M4** — confirmation par le collaborateur en Chine sur un vrai projet GitHub.
