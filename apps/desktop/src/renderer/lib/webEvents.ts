/**
 * GH44 — canal synthétique émis par le bridge web quand la connexion d'événements (`/events`) est
 * rétablie : des changements ont pu être manqués pendant la coupure, tout est à relire.
 * Module sans effet de bord (importable par le desktop comme par le bridge).
 */
export const EVENTS_RECONNECTED = 'web:events-reconnected'
