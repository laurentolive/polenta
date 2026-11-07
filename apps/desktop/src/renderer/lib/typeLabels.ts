/** Libellé d'un type d'objet dans une liste de choix parmi `siblings` (GH265) : son libellé, ou son
 *  nom technique si un autre type de la liste porte le même libellé — sinon les lignes seraient
 *  identiques. `siblings` contient les types affichés avec le même préfixe (même nœud et même catégorie dans
 *  une liste préfixée par le composant, toute la liste sinon). */
export function typeChoiceLabel(
  type: { name: string; label?: string },
  siblings: ReadonlyArray<{ name: string; label?: string }>,
): string {
  const label = type.label || type.name
  const sameLabel = siblings.filter(s => (s.label || s.name) === label)
  return sameLabel.length > 1 ? type.name : label
}
