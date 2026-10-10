# Marques (marque blanche — GH49)

Chaque dossier `brands/<id>/` décrit une **marque** sous laquelle l'application desktop est
construite : nom affiché, icônes, logo, couleurs, identifiants, source de mise à jour. La marque est
choisie **au build** et figée dans le binaire ; rien ne permet de la changer après installation.

| Marque | Rôle |
|--------|------|
| `polenta` | marque par défaut (build sans `POLENTA_BRAND`) — **ne pas modifier** `id`, `productName`, `appId` : ils déterminent où les installations existantes retrouvent projets, comptes et préférences |
| `demo` | marque fictive de test (« Demo Specs ») — vérifications de `specs/GH49-tests.md` |

## ⚠ Marque d'un client : accord explicite obligatoire

Ce repo est **public**. Un dossier `brands/<client>/` commité rend publics le nom du produit du
client, son logo, ses couleurs et l'adresse de ses mises à jour. **Ne jamais commiter la marque d'un
client sans son accord explicite et écrit** pour apparaître publiquement ; mentionner cet accord
(date, interlocuteur) dans le message de commit qui ajoute la marque.

## Contenu d'un dossier de marque

| Fichier | Obligatoire | Rôle |
|---------|-------------|------|
| `brand.yaml` | oui | identité de la marque (ci-dessous) |
| `icon.ico` | oui | icône Windows (exécutable, installeur, raccourcis) — plusieurs tailles jusqu'à 256 px |
| `icon.png` | oui | icône macOS/Linux, ≥ 512 px |
| `icon-256.png` | oui | icône 256 px |
| `icon.svg` | oui | icône vectorielle (icône d'onglet si pas de `favicon.svg`) |
| `favicon.svg` | non | icône de l'onglet du renderer |
| `logo.svg` | non | logo affiché sur les écrans d'accueil et de connexion ; absent → pas de logo |

### `brand.yaml`

```yaml
id: acme                      # [a-z0-9-]+, = nom du dossier ; nomme aussi le service keytar des comptes
productName: Acme Specs       # nom affiché partout ; nomme le dossier de données (userData) et le raccourci
appId: com.acme.specs         # identifiant OS, unique par marque
executableName: acme-specs    # optionnel (défaut : id) — dossier d'installation NSIS
website: https://acme.example # optionnel — lien cité dans AGENTS.md
update:                       # optionnel — absent : aucune mise à jour automatique
  provider: github            # github : owner + repo (releases publiques)
  owner: acme
  repo: acme-specs-releases
  # provider: generic         # generic : dossier web contenant latest.yml + l'installeur
  # url: https://updates.acme.example/specs
  # releasesUrl: https://acme.example/notes   # optionnel — lien « notes de version »
theme:                        # optionnel — surcharges de tokens de src/renderer/theme.config.ts
  prim: { light: '217 95 2', dark: '251 146 60' }   # triplets "R G B" ; un thème omis garde la valeur Polenta
  prim-fg: { light: '255 255 255', dark: '15 23 42' }
```

Limiter `theme` aux tokens d'identité (`prim`, `prim-fg`, `activity-*`) : les couleurs de statut
(succès, alerte, danger…) portent un sens et doivent rester lisibles.

Toute anomalie (clé obligatoire absente, `id` ≠ dossier, icône manquante, token inconnu, triplet
invalide, `productName` inutilisable comme nom de fichier…) **fait échouer le build**.

## Construire une marque

```sh
POLENTA_BRAND=acme pnpm --filter @polenta/desktop dev       # voir la marque en développement
POLENTA_BRAND=acme pnpm --filter @polenta/desktop package   # dist/Acme-Specs-Setup-X.Y.Z.exe
pnpm --filter @polenta/desktop exec tsx scripts/check-gh49.ts   # vérifications automatiques
```

En CI : workflow « Release desktop », déclenchement manuel avec le paramètre `brand` → l'installeur
est fourni en artefact du run (jamais publié dans les releases de ce repo). Pour les mises à jour
automatiques, le client publie `latest.yml` + l'installeur sur sa propre source (`update`).

Ce qui ne change pas d'une marque à l'autre (format des projets, compatibles entre marques) :
`.polenta/`, `polenta-repo.yaml`, `.mcp.json` (`mcpServers.polenta`), nom du serveur MCP.
