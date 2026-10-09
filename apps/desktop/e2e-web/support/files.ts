/** Fichiers de test réutilisables (uploads via `filechooser.setFiles({ name, mimeType, buffer })`). */

/** PNG 1×1 pixel valide. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** Diagramme draw.io minimal : une page, un nœud `node-e2e`. */
export const DRAWIO_MINIMAL = Buffer.from(
  '<mxfile><diagram id="d1" name="Page-1"><mxGraphModel><root><mxCell id="0"/>' +
  '<mxCell id="1" parent="0"/><mxCell id="node-e2e" value="E2E" vertex="1" parent="1">' +
  '<mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>')
