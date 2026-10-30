# GH228 — Scénarios de test

## Unitaires (`lib/tabHistory.test.ts`)

- U1 push ajoute une entrée et avance l'index ; replace modifie l'entrée courante.
- U2 push depuis le milieu de la pile supprime les entrées suivantes.
- U3 push vers la même destination que l'entrée courante = remplacement.
- U4 plafond 50 : la plus ancienne est oubliée, l'index reste sur la dernière.
- U5 `stepHistory` hors bornes → `null`.
- U6 entrées avant/après pour le menu : plus proche d'abord, 15 au plus.
- U7 `historyNavDirection` : Alt+← (win) → -1, y compris dans un champ ; Alt+← (mac) dans un
  champ → null, hors champ → -1 ; Cmd+[ (mac) → -1 dans un champ ; Cmd+← (mac) dans un champ →
  null ; Ctrl+Alt+← → null ; Shift+Alt+← → null ; `BrowserForward` → +1 ; defaultPrevented → null.

## E2E (`e2e-web/gh228-navigation.spec.ts`)

- E1 (CA1, CA2) Exigences en vue Tableau → vue Document → Édition d'un élément → panneau
  Version. `Alt+←` ×3 ramène Édition, Document, Tableau (URL `view=…`, `item=…`) ; `Alt+→`
  refait le chemin.
- E2 (CA2) recharger la page sur une URL `view=edit&item=X` réaffiche l'Édition de X.
- E3 (CA5) onglet neuf : `<` grisé ; après un recul, `>` actif ; naviguer grise `>`.
- E4 (CA4) deux onglets : historiques indépendants, changer d'onglet n'ajoute rien.
- E5 (CA7, CA8) fiche `/req/…` modifiée → `<` → popup ; Rester garde la saisie ; Quitter sans
  enregistrer revient sans enregistrer ; sans modification pas de popup.
- E6 (CA9) boutons souris 4/5 (`mouseup` button 3/4).
- E7 (CA10) clic droit sur `<` : liste des pages précédentes ; clic sur la plus ancienne y saute.
- E8 (CA6) lien interne vers un objet d'un autre repo puis `<` : retour (adaptation de GH105-2).

## Manuels (desktop uniquement)

- M1 boutons latéraux de la souris sous Windows : un seul pas par clic (déduplication app-command).
- M2 macOS : `Cmd+[` / `Cmd+]`, `Cmd+←` dans un champ texte déplace le curseur, balayage trackpad.
- M3 CA13 : fermer un onglet ayant un historique, le rouvrir depuis « Récemment fermés », `<` fonctionne.
