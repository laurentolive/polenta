// GH44 — entrée du build web : `window.polenta` (HTTP/WebSocket) doit exister avant que le
// renderer ne s'initialise. Les imports ES s'évaluent dans l'ordre.
import './bridge'
import '../main'
