# GH46 — Design : édition drawio dans le client web

Spec : `specs/GH46.md` (décisions D1 à D5 validées). Tests : `specs/GH46-tests.md`.

## 1. Éditeur embarqué (D1)

### 1.1 Source et version

- Build officiel de la webapp draw.io : asset `draw.war` (zip) de la release
  **jgraph/drawio v32.7.7** (2026-11-25), 52 888 867 octets, SHA-256
  `e84ac13ee1e6c2bded36b6e920a2e8abfa37df277a6d9697ae8dc28f7bbeb9f1`.
- Licence : Apache-2.0 (même dépôt que la visionneuse déjà vendorisée, `renderer/public/vendor/`).
- Contenu non compressé : 126 Mo, 3 337 fichiers. Le volume principal est `js/` (82 Mo, dont
  `integrate.min.js` 21 Mo et les visionneuses `viewer*.min.js` 16 Mo, inutiles à l'éditeur embarqué).

### 1.2 Récupération : `pnpm drawio:fetch` (`apps/desktop/scripts/fetch-drawio-editor.ts`)

Calque sur `fetch-git.ts` (GH337) :

- `scripts/drawio-editor.json` : `{ version, url, sha256 }`, épinglés.
- Téléchargement (`fetch`), vérification SHA-256 avant toute extraction ; échec = arrêt.
- Extraction avec **PizZip** (dépendance existante de `apps/desktop`) : pas de nouvelle dépendance,
  pas de `unzip` système (le build Docker est Linux, et `node:20-bookworm` n'a pas forcément `unzip`).
- Sortie : `apps/desktop/vendor/drawio-editor/` (déjà exclu par `.gitignore` : `vendor/`), avec un
  marqueur `.polenta-drawio-version` (idempotence, comme `vendor/git`).
- Élagage selon `scripts/drawio-prune.txt` (préfixes) : `WEB-INF/`, `META-INF/`, `templates/`,
  `plugins/`, `js/integrate.min.js`, `js/viewer*.min.js`, `*.map`, `service-worker.js`, `workbox*`,
  pages d'intégration (`teams.html`, `onedrive3.html`, `export3.html`, `open.html`, `clear.html`,
  `vsdxImporter.html`). `index.html` et le reste sont conservés.
- AC10 : la taille après élagage est relevée par le script (affichée) et consignée au §8.

### 1.3 Intégration au build web

- `vite.web.config.ts` : plugin `polenta-drawio-editor` qui, à `closeBundle`, copie
  `vendor/drawio-editor/` vers `out/web/drawio-editor/`. Le desktop (`electron.vite.config.ts`) n'est
  pas touché : l'éditeur n'entre pas dans l'installeur.
- `build:web` lance d'abord `tsx scripts/fetch-drawio-editor.ts` (idempotent : sans effet si le marqueur
  correspond). Le Dockerfile (`RUN pnpm build:web`) l'obtient donc au build de l'image, comme `pnpm install`.
- Le serveur web sert `out/web` (fastify-static) : `/drawio-editor/index.html` est servi tel quel,
  sans authentification spécifique (aucun secret dans la webapp).

### 1.4 Paramètres d'URL de l'iframe

`/drawio-editor/index.html?embed=1&proto=json&offline=1&spin=1&noSaveBtn=1&noExitBtn=1&lang=<locale>`

- `embed=1&proto=json` : mode embarqué, messages JSON (vérifié dans `js/app.min.js`, v32.7.7).
- `offline=1` : désactive les services distants de l'éditeur (vérifié : `isOfflineApp()`).
  `log.diagrams.net` n'est utilisé que si l'hôte se termine par `diagrams.net` : l'hôte Polenta ne
  l'est pas.
- `noSaveBtn=1&noExitBtn=1` : les boutons Enregistrer / Fermer sont ceux de Polenta, hors iframe.
- Résidu connu : `index.html` contient `<link rel="canonical" href="https://app.diagrams.net">`
  (non chargé par le navigateur) ; la recherche d'icônes appelle `icons.diagrams.net` **à l'ouverture
  de la recherche seulement**. AC2 couvre ouverture, édition et enregistrement, pas la recherche
  d'icônes (action explicite de l'utilisateur) : le constat figure au §8.

## 2. Protocole de messages (vérifié dans le bundle v32.7.7)

| Sens | Message | Rôle |
|---|---|---|
| éditeur → Polenta | `{event:"init"}` | éditeur prêt : Polenta envoie le XML |
| Polenta → éditeur | `{action:"load", xml}` | charge le diagramme |
| éditeur → Polenta | `{event:"load", …}` | chargement terminé |
| Polenta → éditeur | `{action:"export", format:"xml"}` | demande le XML courant |
| éditeur → Polenta | `{event:"export", format:"xml", xml, …}` | réponse (`createLoadMessage("export")` + `xml`) |
| éditeur → Polenta | `{event:"exit", modified}` | sortie demandée (non utilisée : Polenta ferme lui-même) |

**Pas d'événement de modification** dans ce build (aucun `autosave` ni `change`). D'où le §3.3.

Sécurité : Polenta n'accepte un message que si `event.source === iframe.contentWindow` **et**
`event.origin === location.origin`. Polenta n'envoie qu'à `location.origin`.

## 3. Serveur

### 3.1 Canaux web (nouveaux)

Nouveau service `apps/desktop/src/main/services/drawio-edit.service.ts`, sur le modèle de
`DiffEditService.saveWorkingFile` (confinement `realpath`, `isInside` exporté, comparaison de base).

- `web:drawio-open(repoPath, relativePath)` → `{status:'ok', xml, baseHash}` | `{status:'error', message}`.
  Lit les octets (`readFileAt`, working tree), `baseHash` = SHA-256 hex des octets lus.
- `web:drawio-save(repoPath, relativePath, xml, baseHash)` → `{status:'ok', baseHash}` |
  `{status:'conflict'}` | `{status:'refused', message}`.
  Contrôles, dans l'ordre :
  1. chemin résolu **sous `repoPath/diagrams/`** et `realpath` dans le repo (sinon `refused`) ;
  2. le fichier existe (sinon `refused`) ;
  3. `xml` parse en mxfile : `parseDrawioPages(xml)` non vide (sinon `refused`, rien écrit) ;
  4. SHA-256 du contenu courant = `baseHash` (sinon `conflict`) ;
  5. écriture atomique : `fichier.tmp` puis `rename` (un lecteur ne voit jamais un fichier tronqué).
- Enregistrement : `web-handlers.ts` (canaux propres au web, comme `web:drawio-import`), et non le
  noyau partagé. Pas de `GRAPH_WRITE_CHANNELS` : `drawio:read` et ces canaux lisent et écrivent le
  fichier directement, sans cache du graphe (la leçon GH413 ne s'applique pas ici).
- `channel-policy.ts` : `web:drawio-open` et `web:drawio-save` dans `WEB_ONLY_CHANNELS` et `ROOT_ARGS`
  (argument 0 = `repoPath`, soumis au contrôle d'accès du workspace, comme `web:drawio-import`).

### 3.2 Pas de commit

L'écriture modifie l'arbre de travail (D4). Aucun `git add` / `commit` : le même effet que l'éditeur
externe du desktop, et la vue Diff/Git le présente comme une modification locale.

### 3.3 Modifié ou non (écart à la spec, à valider)

Le bundle v32.7.7 n'émet aucun événement de modification (§2). Choix :

- **Fermer** : Polenta demande l'export XML et le compare au XML chargé ; s'il diffère, confirmation
  « Quitter sans enregistrer ? ».
- **Onglet / navigateur** : `beforeunload` **armé tant que l'éditeur est ouvert** (et non « seulement
  si modifié »). Raison : sans événement de modification, un état « modifié » fiable n'existe pas
  sans interroger l'éditeur en continu. Le faux positif (avertir après un enregistrement sans
  changement) est accepté ; le faux négatif (perdre une modification) ne l'est pas.
  Écart avec AC5 de `specs/GH46.md` (« une fois enregistrée, non ») : signalé dans le message de fin.

## 4. Client (renderer)

- `renderer/platform.ts` : `capabilities.webDrawioEditor = isWeb` (faux sur le desktop).
- `renderer/web/drawio-edit.ts` (ou dans `api.ts`) : `openForEdit(repoPath, path)`, `saveEdit(...)` —
  appels `window.polenta.invoke('web:drawio-open' | 'web:drawio-save', …)`.
- `renderer/components/drawio/DrawioEditorDialog.tsx` : fenêtre modale plein écran.
  - `iframe` `src` = §1.4, `title` « Éditeur draw.io ».
  - Barre : **Enregistrer** (désactivé tant que l'éditeur n'a pas émis `load`), **Fermer**, nom du
    fichier, message d'état. Pas d'indicateur « modifié » permanent : le bundle n'émet aucun
    événement de modification ; la comparaison se fait à la fermeture (référence = XML canonique
    réexporté juste après `load`, §3.3).
  - Enregistrer : `export` XML → `web:drawio-save(baseHash)` → `ok` : nouveau `baseHash`, reste ouvert ;
    `conflict` : message « Le diagramme a changé depuis son ouverture » + bouton « Recharger »
    (ferme sans écrire, rouvre) ; `refused` : message, rien écrit.
  - Timeout : pas d'`init` sous 20 s → message « L'éditeur ne répond pas » et fermeture.
- Points d'entrée (uniquement si `capabilities.webDrawioEditor` **et** non lecture seule) :
  - `tiptap/DrawioEmbedView.tsx` : entrée de menu « Modifier le diagramme » (`editor.isEditable`) ;
  - `components/system/EditView.tsx` : bouton « Modifier » à côté de « Ouvrir dans Draw.io »
    (`readOnly` existant). Le bouton desktop « Ouvrir dans Draw.io » reste `externalDrawioEditor` only.

## 5. Erreurs et cas limites

| Cas | Traitement |
|---|---|
| Session expirée pendant l'édition (401) | message « Session expirée » ; le XML n'est pas perdu : bouton « Copier le XML » (repli) |
| Fichier supprimé pendant l'édition | `refused` (« fichier introuvable ») |
| XML invalide renvoyé par l'éditeur | `refused`, rien écrit ; l'éditeur reste ouvert |
| Diagramme multi-pages | le XML complet (toutes les pages) est renvoyé et écrit (AC6) |
| Fichier hors `diagrams/` | `drawio:read` l'affiche, mais `web:drawio-save` refuse (AC8) |

## 6. Risques

- **Taille de l'image** : ~100 Mo d'éditeur après élagage (à mesurer, §8). Acceptable pour un serveur
  on-premise ; le volume `web-data` n'est pas concerné.
- **CSP (#88)** : `frame-src 'self'` et l'accès aux `blob:`/`data:` de l'éditeur seront à autoriser
  dans #88 ; le ticket ne pose pas de CSP.
- **Version** : éditeur v32.7.7 ≠ desktop v32.7.4 ; le format de fichier est le même (mxfile).
- **Licence** : Apache-2.0 à reprendre dans `THIRD-PARTY-NOTICES.txt` (`generate-third-party-notices`
  lit les dossiers vendorisés : à vérifier en Dev, AC11).

## 7. Découpage en sprints

- **Sprint 1** : fetch + élagage + copie dans `out/web` + serveur ; tests du script et du service
  (AC8, AC10, AC11 partiel) ; `web:drawio-open` / `web:drawio-save` (AC3 côté serveur, AC7, AC8).
- **Sprint 2** : modale, protocole, points d'entrée, beforeunload (AC1, AC2, AC4, AC5', AC6) ; e2e.
- **Validation finale** : niveau 2 (`pnpm test`, e2e `gh46-`) puis merge local dans `milestone-A`.

## 8. Résultats mesurés (à compléter en Dev)

- Taille après élagage : **79,3 Mo** (2 776 fichiers, 398 entrées élaguées), contre 126 Mo décompressés.
  Le service worker de l'éditeur est conservé (offline=1 l'enregistre ; son absence faisait une erreur console).
  Reste le plus gros poste : `js/` (≈ 45 Mo après élagage). Pistes si la taille gêne : retirer `shapes/`
  et `img/` des bibliothèques non utilisées, après relevé des fichiers réellement chargés en e2e.
- Notices tierces : `out/web/THIRD-PARTY-NOTICES.txt` contient la licence de la webapp (Apache-2.0,
  `scripts/drawio-editor-LICENSE.txt`), libavoid (LGPL-2.1) et les bibliothèques d'icônes et de formes
  (licence propre à draw.io, `shapes/LICENSE`), ces deux dernières lues dans `vendor/drawio-editor` au build.
- Constat `icons.diagrams.net` : aucune requête vers `diagrams.net` pendant ouverture, édition et
  enregistrement (GH46-2). La recherche d'icônes, non testée, appelle ce domaine ; à traiter avec #88.
