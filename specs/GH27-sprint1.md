# GH27 — Sprint 1 (unique)

## Fichiers modifiés

| Fichier | Modification |
|---------|--------------|
| `apps/desktop/src/renderer/routes/index.tsx` | Page `/` réécrite : 4 boutons d'action, helper `run()` (état de chargement, erreur, garde anti double-clic par `useRef`). Le `useEffect` de démarrage (T102/T105) est inchangé. |
| `apps/desktop/src/renderer/components/home/TextPromptModal.tsx` | Nouveau popup à un champ (URL Git / nom de projet). |
| `apps/desktop/src/renderer/lib/demoProject.ts` | Nouvelle constante `DEMO_PROJECT_URL`. |
| `apps/desktop/src/main/services/workspace.service.ts` | + `isEmptyDir(dir)`. `createFromClone` supprime le sous-dossier qu'il a créé si le clone échoue. |
| `apps/desktop/src/main/ipc/index.ts` | + handler `workspace:is-empty-dir`. |
| `packages/api-client/src/types.ts`, `ipc-client.ts` | + `workspace.isEmptyDir`. |
| `apps/desktop/src/renderer/i18n/locales/fr.json`, `en.json` | Bloc `home` refait : nouvelles clés, 7 clés obsolètes retirées (aucune autre référence). |
| `specs/SPEC-ELECTRON-DESKTOP.md`, `SPEC-PROJECT-MANAGEMENT.md`, `SPEC-INDEX.md` | Voir § Mises à jour SPEC. |

## Comportement implémenté

Conforme à `specs/GH27.md` et `GH27-design.md` :
- Bouton démo (mis en avant, `bg-prim`) : sélecteur natif.
  - Projet Polenta existant : ouverture.
  - Dossier vide ou inexistant : clone de `demo-ll800-produit` puis des 4 dépendances.
  - Sinon : erreur « dossier non vide ».
- Ouvrir un projet existant : sélecteur natif, puis ouverture.
- Depuis un repo / Créer : popup (URL / nom), puis sélecteur natif, puis clone / création.
- Annulation silencieuse. Pendant une opération, les autres boutons sont désactivés et un libellé
  de chargement s'affiche. Une erreur s'affiche sous le bouton concerné.

## Divergences par rapport au design

- **Ajout** : `createFromClone` nettoie le sous-dossier qu'il a créé quand le clone échoue. Le
  problème a été trouvé par `/code-review` : sans ce nettoyage, un clone de la démo interrompu
  (réseau) laissait un `demo-ll800-produit/` vide, et le dossier était alors refusé définitivement
  comme « non vide ». Un dossier préexistant n'est jamais supprimé. Le scénario L4 de
  `GH27-tests.md` est mis à jour en conséquence.

## Mises à jour SPEC

| Section | Modification |
|---------|--------------|
| SPEC-ELECTRON-DESKTOP §16.2 | + canal `workspace:is-empty-dir`. |
| SPEC-ELECTRON-DESKTOP §16.3 | Route `/` : 4 boutons. |
| SPEC-ELECTRON-DESKTOP §16.5 | Layout réécrit : mockup en boutons, table des enchaînements, popup, nettoyage du clone. Ancien mockup à formulaires et paragraphes « Créer un projet » (création distante, visibilité) obsolètes retirés. |
| SPEC-ELECTRON-DESKTOP §16.6 | Le sélecteur natif est ouvert directement par les boutons (plus de bouton Browse). |
| SPEC-PROJECT-MANAGEMENT §9 | « Formulaire réel » remplacé par la saisie popup puis sélecteur natif. |
| SPEC-INDEX | MAJ → GH27 pour SPEC-ELECTRON-DESKTOP §16 et SPEC-PROJECT-MANAGEMENT §3+. |

## Vérifications effectuées

- `pnpm --filter desktop typecheck` : 0 erreur. Le projet n'a pas de configuration ESLint.
- `/code-review` : 1 problème trouvé, corrigé (voir divergences).
- App construite (`electron-vite build`) et pilotée par le driver Playwright (`run-desktop`),
  sélecteur de dossiers bouchonné :
  - N1 : 4 boutons, aucun champ, démo en tête et mise en avant.
  - N2 : démo dans un dossier vide → `.polenta/`, `demo-ll800-produit/` et les 4 composants
    clonés ; « Chargement de la démo… » affiché, autres boutons désactivés.
  - N3 : démo sur le même dossier → ouverture directe sur `/schema` (arbre Structure complet :
    composants locaux, pompe sous « hydraulique » en `v2.0`, interface locale).
  - L3 : dossier ne contenant qu'un fichier caché → message « Ce dossier n'est pas vide… », dossier
    inchangé, boutons réactivés.
  - N6 / A2 : popup URL avec focus, bouton « Continuer » désactivé à vide, `Échap` ferme.
  - L1 : popup nom rempli d'espaces + `Entrée` → reste ouvert, bouton désactivé.

## Comment tester manuellement

`pnpm --filter @polenta/desktop dev`, fermer le projet courant pour revenir sur `/`, puis dérouler
`specs/GH27-tests.md`. Restent à vérifier à la main : N4 à N7 avec de vraies opérations
(clone/création), A1/A4 (annulation du vrai sélecteur), L4 (coupure réseau), L5, L7, L8 (EN), L9.
