# Fixtures GH53 — autorité de certification de test

`ca.pem` et `server.pem` (certificat pour `localhost` / `127.0.0.1`, signé par `ca.pem`), `server.key` (sa clé).
Ce sont des **clés de test**, sans valeur hors des tests : ne pas les réutiliser ailleurs. La clé privée de la CA
a été détruite après génération ; pour régénérer, suivre `specs/GH53-tests.md`.
Validité : 100 ans (jusqu'en 2126).
