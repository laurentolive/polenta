import AsyncLock from 'async-lock'

/**
 * GH336 — isomorphic-git protège la lecture de `.git/packed-refs` (et ses autres fichiers de refs)
 * par des verrous `async-lock` **globaux au processus**, créés à la première utilisation avec la
 * limite par défaut de 1000 demandes en attente. Polenta interroge plusieurs repos en parallèle
 * (statut toutes les 3 s, index, historique par fichier…) : au-delà de 1000, `async-lock` rejette
 * la demande suivante — « Too many pending tasks in queue packed-refs » — même si c'est celle d'un
 * checkout en cours, qui s'arrête alors à mi-chemin (index écrit, HEAD pas déplacé).
 * Une file d'attente n'a pas de raison d'être plafonnée ici : les demandes sont toutes légitimes et
 * finissent par passer. Doit être chargé avant le premier appel git — importé par `eol-status.util`,
 * lui-même chargé par tout ce qui lit le statut ou fait un checkout.
 * Même instance que celle d'isomorphic-git : dépendance directe à la même version (1.4.1).
 */
AsyncLock.DEFAULT_MAX_PENDING = Infinity
