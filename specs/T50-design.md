# T50 — Design technique

Voir [T50.md](T50.md) pour la spec fonctionnelle validée.

## 1. Découpage

Un seul sprint : le périmètre est cohérent (types → backend → hooks → 2 pages renderer) et
chaque couche a un équivalent direct déjà existant pour `test`, ce qui limite le risque de
découverte tardive.

## 2. Fichiers à modifier

### 2.1 Types (`packages/types/src/campaign.ts`)

- `TestCampaign` : retirer `description?: string`, ajouter `objectTypeRef?: string` et
  `fields: Record<string, unknown>` (non optionnel, défaut `{}` à la création — même convention
  que `TestCase.fields`).
- `CreateCampaignDto` : retirer `description`, ajouter `objectTypeRef?: string` et
  `fields?: Record<string, unknown>`.
- Nouveau `UpdateCampaignDto` : `{ title?: string; objectTypeRef?: string; fields?: Record<string, unknown> }`
  (mirroring `UpdateTestCaseDto`).

### 2.2 Zod (`packages/zod-schemas/src/campaign.schema.ts`, nouveau)

- `CreateCampaignSchema`/`UpdateCampaignSchema` mirroring `test.schema.ts:18-37`, utilisés comme
  source de types (`z.infer<>`) par cohérence avec le reste du projet. Pas de `.parse()` runtime
  ajouté à l'IPC — le projet ne valide actuellement aucun DTO au runtime à cette frontière (vérifié :
  aucun `.parse`/`.safeParse` dans `apps/desktop/src/main`), donc ce ticket ne change pas ce
  comportement pour rester cohérent avec `tests`/`requirements`.
- Exporter depuis `packages/zod-schemas/src/index.ts`.

### 2.3 Backend (`apps/desktop/src/main/services/campaigns.service.ts`)

- `create()` (lignes 38-60) : remplacer `description: dto.description` par
  `objectTypeRef: dto.objectTypeRef, fields: dto.fields ?? {}`.
- Nouvelle méthode `update(repoPath, id, dto: UpdateCampaignDto)` mirroring
  `tests.service.ts:56-79` : charge la campagne existante, applique `title`/`objectTypeRef` si
  fournis, merge `fields: { ...(existing.fields as object), ...(dto.fields ?? {}) }`, réécrit le
  YAML, retourne la campagne mise à jour.

### 2.4 IPC (`apps/desktop/src/main/ipc/index.ts`)

- Ajouter `ipcMain.handle('campaigns:update', (_e, repoPath, id, dto, workspaceDir?) => c.campaigns.update(repoPath, id, dto as UpdateCampaignDto, workspaceDir))`
  juste après le bloc `campaigns:*` existant (lignes 290-307), mirroring `tests:update` (lignes 227-228).
  Note : `CampaignsService` n'a pas de paramètre `workspaceDir` actuellement sur ses autres méthodes
  (contrairement à `TestsService`) — vérifier lors de l'implémentation si `update()` doit le
  supporter pour rester cohérent avec la signature IPC, ou l'omettre si les autres méthodes
  campaigns ne l'utilisent pas non plus.

### 2.5 API client (`packages/api-client/src/`)

- `types.ts` (mirroring ligne 282) : ajouter
  `update(repoPath: string, id: string, dto: UpdateCampaignDto): Promise<TestCampaign>` dans
  l'interface `campaigns` (~ligne 319-327).
- `ipc-client.ts` (mirroring ligne 122) : ajouter
  `update: (p, id, dto) => invoke('campaigns:update', p, id, dto)` dans le bloc `campaigns`
  (lignes 155-162).

### 2.6 Hook schéma (`apps/desktop/src/renderer/hooks/useProjectSchema.ts`)

- Ajouter `getCampaignTypeDef(schema, objectTypeRef)` mirroring `getTestTypeDef` (lignes 30-41),
  filtrant `t.category === 'campaign'`.
- `getAllObjectTypes` (ligne 44) accepte déjà `'campaign'` — aucun changement.

### 2.7 Formulaire de création (`apps/desktop/src/renderer/routes/campaign.new.tsx`)

- Retirer l'état `description` et son `<textarea>` (lignes 22, 107-115).
- Ajouter :
  - `useProjectSchema(repoPath)` + `campaignTypes = getAllObjectTypes(schema, 'campaign')`
  - État `type` (objectTypeRef sélectionné) + `fields: Record<string, string>`
  - `buildDefaultFields(typeDef)` (copie locale du helper de `test.new.tsx:24-31`)
  - Si `campaignTypes.length > 0` : `<select>` de type (mirroring `test.new.tsx:130-140`) +
    boucle `typeDef.fields.map(f => <DynamicField .../>)` (mirroring `test.new.tsx:143-150`)
  - Si `campaignTypes.length === 0` : aucune section champs personnalisés affichée
  - Envelopper le formulaire dans `<RichTextProvider>` + monter `<RichTextToolbar repoPath={repoPath} />`
    (mirroring `test.new.tsx:9-10,101,105,187`)
  - `createMutation` : remplacer `description` par `objectTypeRef: type || undefined, fields`

### 2.8 Page de détail (`apps/desktop/src/renderer/routes/campaign.$campaignId.tsx`)

- Retirer le rendu hardcodé de `campaign.description` (lignes 152-154).
- Ajouter, sous le titre :
  - Résolution du `typeDef` via `getCampaignTypeDef(schema, campaign.objectTypeRef)`
  - Affichage en lecture des champs personnalisés : pour chaque `field` du `typeDef`, valeur
    dans `campaign.fields[field.name]` — rendu via `RichTextViewer` si `field.type === 'richtext'`,
    texte simple sinon. Rien affiché si `campaign.fields` est vide ou `typeDef` introuvable
    (campagne créée avant ce ticket, ou sans type défini).
  - Bouton crayon "Modifier" à côté de ces champs, qui bascule un mode édition local (état
    `editingFields: Record<string,string>` initialisé depuis `campaign.fields`) affichant les
    mêmes `DynamicField` qu'en création, avec boutons Enregistrer/Annuler appelant
    `api.campaigns.update(repoPath, campaignId, { fields: editingFields })`.
  - Envelopper la page dans `<RichTextProvider>` + `<RichTextToolbar repoPath={repoPath} />`
    (mirroring `test.$testId.tsx`).
- Ne touche pas au reste de la page (ajout de tests, clôture, suppression, suivi des runs).

### 2.9 Mises à jour SPEC (dernier sprint, donc dès ce sprint)

- `SPEC-TESTS.md` §4.1 : remplacer la ligne `description` du tableau `TestCampaign` par
  `objectTypeRef` et `fields` (mirroring §2.2 pour `TestCase`).
- `SPEC-INDEX.md` : ajouter une entrée pour `SPEC-TESTS.md §4.1` avec mots-clés
  `campagne, description, fields, objectTypeRef, champs personnalisés` → `T50`, ou mettre à jour
  la colonne `MAJ` si une entrée existe déjà couvrant ce paragraphe.

## 3. Décisions techniques et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|----------|---------------------|--------|
| `fields` non optionnel sur `TestCampaign` (toujours `{}` minimum) | `fields?: Record<string,unknown>` optionnel | Cohérence avec `TestCase.fields` (non optionnel) ; évite des `?.` partout dans le rendu |
| Édition des champs personnalisés via mode inline dédié sur la page dashboard | Transformer toute la page en formulaire auto-save comme `test.$testId.tsx` | La page campagne est un tableau de bord (runs, actions), pas un formulaire ; un mode édition localisé aux champs évite de perturber le reste de l'UI |
| Pas de validation zod runtime ajoutée à l'IPC | Ajouter `.parse()` sur les nouveaux handlers | Incohérent avec le reste du projet (aucun DTO n'est validé au runtime aujourd'hui) — hors scope de corriger cela ici |
| Pas de migration des anciennes valeurs `description` | Script de migration `description` → `fields.description` | Aucune donnée de production affectée (confirmé en spec) ; ajouterait de la complexité non demandée |

## 4. Impacts / risques

- Toute campagne déjà créée dans un environnement de dev/test perd l'affichage de son ancien
  `description` (le champ disparaît du type, YAML existant l'ignore silencieusement au chargement
  — comportement accepté, voir spec §hors scope).
- `CampaignsService.update()` est nouveau : vérifier qu'aucune race condition n'existe avec
  `updateRun`/`close`/`addTests` qui lisent-modifient-écrivent le même fichier YAML sans verrou —
  risque préexistant (déjà présent pour les autres méthodes), non aggravé par ce ticket.
