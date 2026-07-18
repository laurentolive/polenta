---
ticket: T102
sprint: 1
---

## Fichiers modifiés

- `apps/desktop/src/renderer/routes/index.tsx` — flux d'init de `/` : navigation vers
  `/dashboard?projectId=…&dashboardId=undefined` au lieu de `/schema` quand
  `getLastOpened()` renvoie un projet.
- `specs/SPEC-ELECTRON-DESKTOP.md` §16.1, §16.3 — diagramme et table des routes du flux
  de démarrage mis à jour (obsolètes : ils référençaient encore `/project/$id`, retiré
  depuis T86 ; ils ne reflétaient pas non plus le comportement actuel `/schema`).
- `specs/SPEC-INDEX.md` — ajout d'une ligne pour §16 (absente jusqu'ici, alors que ce
  paragraphe documente précisément le flux visé par ce ticket).

## Comportement implémenté

Priorité au démarrage (route `/`), inchangée pour les deux premiers cas, corrigée pour
le troisième :
1. Pas de compte configuré → `/login`.
2. Compte configuré, pas de `lastOpenedId` → page de chargement de projet (Récents /
   Ouvrir / Créer), inchangé.
3. Compte configuré, `lastOpenedId` présent → **`/dashboard?projectId=…`** (avant :
   `/schema`).

`dashboardId` explicitement passé à `undefined` dans le search — requis par le validateur
de recherche TanStack Router de `/dashboard` (`dashboardId: string | undefined`, clé non
optionnelle dans le type malgré une valeur optionnelle). Sans `dashboardId`, la page
affiche déjà un message invitant à choisir un dashboard dans le panneau latéral
(comportement existant, inchangé — le choix automatique du premier dashboard est le
périmètre de T109).

## Divergences par rapport au design

Aucune (pas de phase Design distincte — correctif d'une ligne, périmètre validé
directement en spec avec l'humain).

## Mises à jour SPEC effectuées

- **SPEC-ELECTRON-DESKTOP.md §16.1** (diagramme flux démarrage) : `/project/$id` (obsolète
  depuis T86) remplacé par `/dashboard?projectId=…` ; note ajoutée précisant que `/schema`
  reste la page d'atterrissage pour une navigation explicite (Récents, création, clone).
- **SPEC-ELECTRON-DESKTOP.md §16.3** (table des routes du flux démarrage) : ligne `/`
  mise à jour, ligne `/project/$id` (déjà obsolète) remplacée par `/dashboard?projectId=…`.
- **SPEC-INDEX.md** : nouvelle ligne pour §16, MAJ → T102.

## Comment tester manuellement

1. Lancer l'app sans compte configuré → doit atterrir sur `/login`.
2. Se connecter (PAT ou Device Flow) sans avoir ouvert de projet auparavant → doit
   atterrir sur la page de chargement de projet (Récents/Ouvrir/Créer).
3. Ouvrir un projet (clic sur Récents, ou Ouvrir/Créer) → atterrit sur `/schema`
   (inchangé), puis fermer/rouvrir l'app (ou juste relancer) → doit atterrir directement
   sur `/dashboard?projectId=…` du même projet.
4. Fermer le projet (menu Fichier → Fermer le projet, ou bouton Fermer de la sidebar) puis
   relancer l'app → doit revenir sur la page de chargement de projet, pas sur `/dashboard`.
