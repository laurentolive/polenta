import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isHttpLinkUrl, linkDisplayText, readLinkValues } from '@polenta/types'
import { api } from '../../api'
import { isWeb } from '../../platform'

// GH195 — lecture d'un champ `link` (specs/GH195.md §1.4, §1.5) : libellé cliquable, URL en
// infobulle. Desktop : ouverture par le main (`app:open-link`, confirmation hors http(s)). Client
// web : seuls les liens http(s) sont cliquables, les autres proposent « Copier ».

interface Props {
  /** Valeur stockée (objet, liste) ou forme texte `libellé | URL`. */
  value: unknown
  /** Liens séparés par un retour à la ligne (cellule, fiche) ou une virgule (`inline`). */
  inline?: boolean
  className?: string
}

export function LinkList({ value, inline, className }: Props) {
  const links = readLinkValues(value).filter(l => l.url)
  if (links.length === 0) return null
  return (
    <span className={[inline ? 'inline' : 'flex flex-col gap-0.5', className ?? ''].join(' ')} data-link-list>
      {links.map((link, i) => (
        <span key={`${i}-${link.url}`} className="inline-flex items-center gap-1 min-w-0">
          {inline && i > 0 && <span className="text-ink-3">, </span>}
          <LinkAnchor url={link.url} text={linkDisplayText(link)} />
        </span>
      ))}
    </span>
  )
}

function LinkAnchor({ url, text }: { url: string; text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const linkClass = 'text-status-info underline underline-offset-2 hover:opacity-80 truncate'

  if (isWeb && !isHttpLinkUrl(url)) {
    return (
      <span className="inline-flex items-center gap-1 min-w-0" title={url}>
        <span className="truncate">{text}</span>
        <button
          type="button"
          className="text-[10px] px-1 rounded border border-edge text-ink-2 hover:bg-hover shrink-0"
          onClick={e => {
            stop(e)
            void navigator.clipboard?.writeText(url).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
          onDoubleClick={stop}
        >
          {copied ? t('linkField.copied') : t('linkField.copy')}
        </button>
      </span>
    )
  }

  if (isWeb) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={url} className={linkClass} onClick={stop} onDoubleClick={stop}>
        {text}
      </a>
    )
  }

  return (
    <a
      href={url}
      title={url}
      className={linkClass}
      onClick={e => {
        e.preventDefault()
        stop(e)
        void api.app.openLink(url)
      }}
      onDoubleClick={stop}
    >
      {text}
    </a>
  )
}
