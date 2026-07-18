# T98 — Scénarios de test : GitHub OAuth Device Flow

## Scénarios nominaux (golden path)

1. **Connexion complète réussie**
   - Remote sélectionné = `https://github.com`, clic « Se connecter avec GitHub ».
   - `auth:device-flow-start` renvoie une session, le navigateur système s'ouvre sur
     `github.com/login/device`, le `user_code` s'affiche dans l'appli.
   - L'utilisateur valide dans le navigateur.
   - Au tick de polling suivant, `pollDeviceFlow` renvoie `success` → redirection vers `/`,
     identité résolue affichée dans `AccountPanel`/`account.tsx`.
   - Vérification : `api.auth.getToken('https://github.com')` renvoie un token non vide après coup,
     stocké au même endroit qu'une connexion PAT classique.

2. **Non-régression du formulaire PAT**
   - Même écran, mêmes remotes (github.com et autres) : coller un PAT et se connecter fonctionne
     exactement comme avant ce ticket, y compris pour `https://github.com`.

## Cas limites

3. **Bouton absent hors GitHub**
   - Remote = `https://gitlab.com`, `https://gitea.io` ou une URL « Autre… » → aucun bloc Device
     Flow visible, seul le formulaire PAT est affiché.

4. **`GITHUB_OAUTH_CLIENT_ID` non configuré**
   - Clic sur le bouton avec la variable d'environnement absente/vide → message d'erreur explicite
     immédiat (« GITHUB_OAUTH_CLIENT_ID non configuré… »), pas d'appel réseau à GitHub, le bouton
     reste cliquable pour réessayer une fois la config corrigée.

5. **Attente prolongée (`authorization_pending` répété)**
   - Plusieurs ticks de polling consécutifs renvoient `pending` → l'UI reste en état `waiting` sans
     changement visible ni nouvelle demande de code (un seul `device_code` par session).

6. **Ralentissement demandé (`slow_down`)**
   - Le serveur renvoie `slow_down` avec un nouvel `interval` → le polling continue avec le nouvel
     intervalle, aucune erreur montrée à l'utilisateur, aucun arrêt du flow.

7. **Code expiré (`expired_token`)**
   - Après `expires_in` secondes sans validation → prochain poll renvoie `expired` → message
     « Code expiré, réessayez » affiché, `deviceState` repasse à `idle`, le bouton redevient
     cliquable et redemande un nouveau code au clic suivant.

8. **Refus utilisateur (`access_denied`)**
   - L'utilisateur clique « Cancel »/« Deny » sur la page GitHub → poll renvoie `denied` → message
     d'erreur adapté, retour à `idle`.

9. **Panne réseau pendant le polling**
   - Le `fetch` du polling lève une exception (coupure réseau) → traité comme statut `error`
     terminal : polling arrêté, message affiché, pas de crash de l'appli, retour à `idle`.

10. **Panne réseau pendant la demande initiale de code**
    - `auth:device-flow-start` échoue (GitHub indisponible / pas de réseau) → erreur affichée avant
      même d'entrer en état `waiting`, pas de navigateur ouvert, bouton reste cliquable.

11. **Annulation manuelle**
    - Clic sur « Annuler » pendant l'attente → polling arrêté immédiatement, aucun appel
      `pollDeviceFlow` supplémentaire déclenché, retour à `idle`, aucun token stocké.

12. **Navigation hors de l'écran pendant l'attente**
    - L'utilisateur quitte `/login` (ex. retour arrière) pendant `waiting` → le timer de polling est
      nettoyé au démontage du composant, aucun appel résiduel après navigation.

13. **Double clic / clics répétés sur le bouton**
    - Le bouton est désactivé dès le passage en état `waiting` → une seule session de device code
      active à la fois, pas de sessions concurrentes.

## Critères d'acceptation vérifiables

- [ ] Scénario 1 rejouable manuellement de bout en bout avec une vraie OAuth App GitHub de test
- [ ] Scénarios 4, 7, 8, 9, 10 affichent chacun un message distinct et compréhensible, sans crash
- [ ] Scénario 11 : aucun appel réseau après le clic sur Annuler (vérifiable via mock/spy en test
      unitaire du composant, ou inspection réseau manuelle)
- [ ] Scénario 12 : aucune fuite de timer (pas de warning React "state update on unmounted component")
- [ ] Scénario 2 : suite de test ou vérification manuelle existante pour le flow PAT toujours verte
- [ ] `npm run typecheck` (ou équivalent) : zéro nouvelle erreur après l'ajout des types
      `DeviceFlowSession` / `DeviceFlowPollResult`
