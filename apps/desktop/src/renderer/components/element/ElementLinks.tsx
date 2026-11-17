import { Fragment } from 'react'
import { ElementLink } from './ElementLink'

/** GH389 §1.8 — liste d'ID d'autres éléments dans une cellule : un lien d'élément chacun, séparés par « , ». */
export function ElementLinks({ ids, className = 'font-mono text-prim' }: { ids: readonly string[]; className?: string }) {
  return (
    <>
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && ', '}
          <ElementLink id={id} className={className} />
        </Fragment>
      ))}
    </>
  )
}
