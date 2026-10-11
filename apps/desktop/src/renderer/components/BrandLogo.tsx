import logo from 'virtual:brand-logo'
import { BRAND } from '../../shared/brand'

/** GH49 — logo de la marque (écrans d'accueil et de connexion) ; rien si la marque n'en fournit pas. */
export function BrandLogo() {
  if (!logo) return null
  return <img src={logo} alt={BRAND.productName} className="h-12 max-w-full mx-auto" />
}
