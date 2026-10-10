# GH49 — Scénarios de test : marque blanche

Spec : [GH49.md](GH49.md) — Design : [GH49-design.md](GH49-design.md)

Légende : **Auto** = couvert par `scripts/check-gh49.ts` ; **Manuel** = vérification dans l'app
(`pnpm dev`) ou sur l'installeur packagé. Marque de test : `brands/demo` (« Demo Specs »).

## 1. Chargement et validation de la marque

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| B1 | `loadBrand()` sans `POLENTA_BRAND` | marque `polenta` : `appId com.polenta.desktop`, `productName Polenta`, `executableName polenta`, `keytarService polenta`, `update` github laurentolive/polenta | Auto |
| B2 | `loadBrand('demo')` | valide, `update` absent, `releasesUrl` absent, `hasLogo true` | Auto |
| B3 | `POLENTA_BRAND=inconnue` | `BrandError` « [brand inconnue] dossier brands/inconnue introuvable » ; `pnpm build` échoue | Auto + Manuel |
| B4 | `brand.yaml` sans `productName` | `BrandError` nommant `productName` | Auto |
| B5 | `id` ≠ nom du dossier, ou `id` avec majuscule/espace | `BrandError` | Auto |
| B6 | `icon.ico` manquant | `BrandError` nommant le fichier | Auto |
| B7 | `theme: { couleur-inexistante: … }` | `BrandError` « token inconnu » | Auto |
| B8 | `theme: { prim: { light: '300 0 0' } }` | `BrandError` « triplet RGB invalide » | Auto |
| B9 | `update: { provider: ftp }` / github sans `repo` | `BrandError` | Auto |
| B10 | Point d'entrée `tsx` sans `register-brand` | erreur explicite « marque non injectée », pas de repli Polenta | Auto |

## 2. Packaging

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| P1 | `builderConfig(polenta)` | `appId`, `productName`, `extraMetadata.name: polenta`, `artifactName Polenta-Setup-${version}.${ext}`, `shortcutName Polenta`, `publish` github identiques à l'ancien `electron-builder.yml` | Auto |
| P2 | `builderConfig(demo)` | `artifactName Demo-Specs-Setup-…`, `shortcutName Demo Specs`, `publish: null`, icônes de `brands/demo` | Auto |
| P3 | `pnpm package` (Polenta) | `dist/Polenta-Setup-X.Y.Z.exe` + `.blockmap` + `latest.yml` ; installé dans `%LOCALAPPDATA%\Programs\polenta` comme avant ; raccourci « Polenta » | Manuel |
| P4 | `POLENTA_BRAND=demo pnpm package` | `dist/Demo-Specs-Setup-X.Y.Z.exe`, pas de `latest.yml` ; installé dans son propre dossier ; raccourci « Demo Specs » avec l'icône demo ; « Applications installées » affiche « Demo Specs » | Manuel |
| P5 | Bundle MCP de la marque demo | `out/mcp-server/index.cjs` contient `"keytarService":"demo"` | Auto (grep) |
| P6 | Working tree après `POLENTA_BRAND=demo pnpm build` | `git status` propre (aucun fichier généré modifié) | Manuel |

## 3. Nominal — application Polenta (non-régression, critère 1)

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| N1 | Mise à jour d'une install Polenta existante vers la version GH49 | projets récents, comptes (keytar), préférences retrouvés | Manuel |
| N2 | Titre de fenêtre, favicon, écran d'accueil, couleurs | identiques à avant GH49 (aucun logo) | Manuel |
| N3 | Mise à jour auto | vérification lancée ~10 s après démarrage, badge, lien « notes de version » vers `github.com/laurentolive/polenta/releases/tag/vX` | Manuel (`POLENTA_FORCE_DEV_UPDATE=1`) |
| N4 | Création de projet | `AGENTS.md` présente « Polenta » avec lien `polenta.dev` ; commit d'init par `Polenta <polenta@localhost>` | Manuel |

## 4. Nominal — application Demo Specs

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| D1 | `POLENTA_BRAND=demo pnpm dev`, FR puis EN | titre `Demo Specs vX.Y.Z — …` ; écran d'accueil : logo demo + « Découvrir Demo Specs avec le projet de démonstration » ; aucun « Polenta » visible | Manuel |
| D2 | Ouvrir un dossier quelconque non-projet | « Ce dossier n'est ni un projet Demo Specs ni un repo git. » | Manuel |
| D3 | Écran de connexion | logo + « Bienvenue dans Demo Specs » | Manuel |
| D4 | Couleur primaire, thème clair puis sombre | boutons primaires dans la couleur demo pour chaque thème ; fonds, textes, statuts = valeurs Polenta | Manuel |
| D5 | Panneau Compte | pas de case « Vérifier les mises à jour » ; « Installer les exemples » copie dans `Exemples Demo Specs/` | Manuel |
| D6 | Aucune vérification de mise à jour | aucun log `[update]` après 15 s | Manuel |
| D7 | Créer un projet | `AGENTS.md` : « géré avec Demo Specs », sans lien ; `.polenta/`, `polenta-repo.yaml` toujours cités ; `.mcp.json` lance le serveur MCP de Demo Specs | Manuel |
| D8 | Export Excel d'une campagne | propriété auteur du classeur = « Demo Specs » | Manuel |
| D9 | Serveur MCP lancé depuis `.mcp.json` d'un projet Demo Specs | lit les comptes de Demo Specs (pas ceux de Polenta) | Manuel |

## 5. Cas limites

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| L1 | Polenta et Demo Specs installés et lancés en même temps | deux fenêtres, deux icônes de barre des tâches distinctes ; projets récents et comptes séparés | Manuel |
| L2 | Projet créé par Demo Specs ouvert dans Polenta (et inverse) | s'ouvre sans erreur ; `AGENTS.md` non réécrit (marqueur de version égal) | Manuel |
| L3 | Projet existant (AGENTS.md v3) ouvert après GH49 | `AGENTS.md` **non réécrit** (version de gabarit inchangée, texte Polenta identique — décision sprint 2) | Manuel |
| L4 | Marque sans `logo.svg` (Polenta) | écrans d'accueil et de connexion identiques à avant ; pas d'`<img>` cassée | Manuel |
| L5 | Marque avec `theme` vide ou absent | aucune règle CSS ajoutée | Auto (sortie du module virtuel) |
| L6 | `productName` avec apostrophe / accent (`L'Outil Été`) | titre, textes i18n, `Exemples L'Outil Été/`, nom d'installeur sans espaces corrects | Auto (builderConfig) + Manuel |
| L7 | Update `generic` sans `releasesUrl` | badge « prêt » sans lien de notes de version | Manuel |

## 6. Scan « aucun Polenta visible » (critère 3)

| # | Scénario | Attendu | Type |
|---|----------|---------|------|
| S1 | Valeurs de `fr.json` et `en.json` | aucune ne contient « polenta » (insensible à la casse) | Auto |
| S2 | Littéraux de `src/main`, `src/renderer` | aucun `'Polenta'`, `"Polenta"`, `` `Polenta `` hors liste blanche (identifiants de format, commentaires) | Auto |
| S3 | `buildAgentsMdTemplate({productName: 'Demo Specs'})` | « Polenta » absent hors `.polenta/`, `polenta-repo.yaml`, marqueur `polenta:agents-md-version` | Auto |

## 7. Correspondance critères d'acceptation (spec §4)

| Critère | Scénarios |
|---------|-----------|
| 1 — Polenta inchangé | B1, P1, P3, N1–N4 |
| 2 — installeur demo | P2, P4 |
| 3 — aucun Polenta visible | D1–D3, S1–S3 |
| 4 — fichiers générés | D5, D7, D8, L2 |
| 5 — couleurs | D4, L5 |
| 6 — logo | D1, D3, L4 |
| 7 — coexistence | L1, D9 |
| 8 — mises à jour | N3, D5, D6, L7 |
| 9 — build en échec | B3–B10 |
