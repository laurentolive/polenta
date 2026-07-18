# T109 — Scénarios de test

## Golden path

1. **Démarrage avec dernier projet connu, ≥1 dashboard existant**
   - Précondition : `workspace:get-last-opened` renvoie un projet, ce projet a au
     moins un dashboard.
   - Action : lancer l'app (ou naviguer directement sur
     `/dashboard?projectId=…` sans `dashboardId`).
   - Attendu : après un bref "Chargement…", la page affiche directement le
     premier dashboard du panneau latéral (widgets rendus), sans clic
     supplémentaire. L'URL est mise à jour avec le `dashboardId` correspondant
     (vérifiable via `history` — une seule entrée, pas deux, grâce à
     `replace: true`).

2. **Sélection explicite d'un dashboard (régression)**
   - Action : cliquer sur un dashboard autre que le premier dans le panneau
     latéral.
   - Attendu : ce dashboard s'affiche (comportement inchangé), pas de
     redirection parasite vers le premier.

## Cas limites

3. **Projet sans aucun dashboard**
   - Action : ouvrir `/dashboard?projectId=…` sans `dashboardId` sur un projet
     dont la liste de dashboards est vide.
   - Attendu : message d'invite ("Sélectionnez un dashboard… ou créez-en un"),
     identique à l'existant. Pas de boucle de redirection, pas d'erreur console.

4. **Suppression du dashboard actif, d'autres restants**
   - Précondition : ≥2 dashboards, le dashboard affiché est supprimé via le
     panneau latéral.
   - Attendu : la page bascule automatiquement sur le nouveau premier dashboard
     restant (pas de message d'invite intermédiaire visible durablement).

5. **Suppression du seul dashboard existant**
   - Précondition : 1 seul dashboard, il est supprimé.
   - Attendu : retour au message d'invite (comportement inchangé, couvert par
     le cas 3).

6. **Ordre persisté respecté**
   - Précondition : ≥3 dashboards, réordonnés par glisser-déposer dans le
     panneau latéral (le premier visuel n'est pas le premier créé).
   - Action : relancer l'app (ou revenir sur `/dashboard` sans id).
   - Attendu : c'est bien le dashboard en tête de liste *après* réordonnancement
     qui s'affiche, pas le premier créé.

7. **Dashboards jamais réordonnés (ordre persisté vide/partiel)**
   - Précondition : `dashboards-order` vide ou ne référence pas tous les ids.
   - Attendu : `orderItems` place les ids inconnus en fin de liste dans leur
     ordre d'origine (comportement déjà existant du helper) — le "premier"
     correspond à ce que montre déjà le panneau latéral dans ce cas, sans
     incohérence entre sidebar et redirection.

8. **Chargement lent (réseau/disque)**
   - Précondition : `dashboards.list`/`dashboards.getOrder` mettent du temps à
     répondre.
   - Attendu : état "Chargement…" affiché pendant l'attente, jamais le message
     d'invite "Sélectionnez un dashboard…" avant que la vraie réponse (vide ou
     non) ne soit connue — pas de flash trompeur.

9. **Changement de scope privé/partagé (régression)**
   - Action : sur un dashboard déjà affiché (id présent), basculer
     privé↔partagé.
   - Attendu : comportement inchangé (`scopeMutation`, navigation vers le
     nouvel id si celui-ci change) — ce chemin ne passe jamais par le nouveau
     bloc "sans id".

## Critères d'acceptation vérifiables

- [ ] Scénarios 1, 4, 6 : le dashboard affiché sans action utilisateur est
  toujours celui en tête du panneau latéral au moment considéré.
- [ ] Scénarios 3, 5 : liste vide → message d'invite inchangé, aucune erreur.
- [ ] Scénario 8 : aucune apparition, même brève, du message d'invite quand des
  dashboards existent.
- [ ] Scénarios 2, 9 : aucune régression sur la navigation explicite existante.
- [ ] TypeScript/lint : zéro erreur nouvelle sur `dashboard.tsx`.
