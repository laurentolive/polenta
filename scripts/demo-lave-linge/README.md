# Projet de démonstration « Lave-linge LL800 »

Générateur du workspace de démonstration (5 dépôts git) utilisé par le bouton « démo » de l'accueil,
les e2e et les tutoriels (`docs/tutoriels/`).

## Générer

```
pnpm --filter @polenta/desktop demo:generate -- --out <dossier> --force
```

- `--out` : dossier hors du repo Polenta. Sous bash, des `/` ou des guillemets : un `C:\…` non quoté
  perd ses antislashs, et le générateur le refuse.
- Les versions, issues, validations et la version testée sont écrites par les services de l'application
  (`app-services.ts`, `milestone-d.mjs`) : une donnée que l'application refuserait fait échouer la
  génération.
- `demo-conformity.test.ts` et `demo-exercises.test.ts` relisent la démo générée ; `suivi-corpus.test.ts`
  en compare les dashboards à ses références.

## Publier

Les lecteurs, les e2e (`POLENTA_E2E_DEMO_SOURCE`) et `deploy/polenta-host.sh` clonent les dépôts publics
`demo-ll800-*`. Une modification du générateur ne les atteint qu'après publication.

1. Générer dans un dossier neuf, ouvrir la démo dans Polenta, lancer les e2e sur ce dossier.
2. `node scripts/demo-lave-linge/publish.mjs --from <dossier>` : affiche les commandes.
3. Avec l'accord explicite du responsable du repo (force-push sur des dépôts publics) :
   `node scripts/demo-lave-linge/publish.mjs --from <dossier> --yes`. L'ancienne tête de `main` de chaque
   dépôt est gardée sous le tag `archive/<date>`.
4. Publier en même temps que la mise à jour des tutoriels sur `main`. Un lecteur qui a déjà cloné la démo
   la supprime et la rouvre depuis l'accueil.
