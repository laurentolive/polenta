#!/bin/sh
# GH337 — shim GIT_ASKPASS de Polenta (design §6). Exécuté par le sh de git (Git for Windows comme
# Linux). Le script Node ne dépend d'aucun module et passe par le serveur d'identifiants de l'hôte.
ELECTRON_RUN_AS_NODE=1 exec "$POLENTA_NODE" "$POLENTA_ASKPASS_JS" "$@"
