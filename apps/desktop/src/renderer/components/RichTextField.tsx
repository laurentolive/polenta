import { useTranslation } from 'react-i18next'
import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import { TextSelection } from '@tiptap/pm/state'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useRichText } from '../contexts/RichTextContext'
import { DrawioEmbed } from '../tiptap/DrawioEmbedExtension'
import { ResizableImage } from '../tiptap/ResizableImageExtension'
import { extractTableRows, padTableRows } from '../tiptap/extractTableRows'
import { fillPastedTable } from '../tiptap/fillPastedTable'
import { buildTableMenuItems } from '../tiptap/tableMenuItems'
import { NodeContextMenu } from '../tiptap/NodeContextMenu'
import { DrawioInsertButton } from './DrawioInsertButton'
import { ImageInsertButton } from './ImageInsertButton'
import { TableInsertButton } from './TableInsertButton'
import { ParamInsertButton } from './parameters/ParamInsertButton'
import { useParamRefs } from '../contexts/ParamRefContext'
import { ParamRefDecoration, paramRefPluginKey } from '../tiptap/ParamRefDecoration'
import { VIEWER_CLASS_COMPACT } from '../lib/staticRichText'

interface Props {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  /** Requis pour résoudre et ouvrir les diagrammes draw.io insérés dans le contenu. */
  repoPath?: string
  /** Donne le focus clavier à l'éditeur dès son montage (ex. popup d'édition ouverte au clic). */
  autoFocus?: boolean
  /** Ctrl/Cmd+Entrée depuis l'éditeur : valide la saisie du contexte (ferme le popover,
   *  commit du champ inline, soumet le formulaire…). Absent → Ctrl+Entrée garde le
   *  comportement TipTap par défaut (saut de ligne). */
  onSubmit?: () => void
  /** T169 — `compact` : édition dans une cellule de la Vue Excel — typographie identique au
   *  rendu lecture de la cellule (`VIEWER_CLASS_COMPACT`), sans hauteur minimale, cadre et
   *  marges de la cellule. Uniquement en mode contexte (toolbar partagée). */
  variant?: 'default' | 'compact'
  /** T176 — avec `autoFocus` : position initiale du curseur. `'end'` (défaut) ou une fonction
   *  évaluée une fois l'éditeur monté, qui renvoie des coordonnées client (le conteneur a pu
   *  défiler entre le clic et le montage) ; hors contenu → fin. */
  initialCaret?: 'end' | (() => { left: number; top: number } | null)
}

export function RichTextField({ value, onChange, disabled, placeholder, repoPath, autoFocus, onSubmit, variant = 'default', initialCaret = 'end' }: Props) {
  const { t } = useTranslation()
  const ctx = useRichText()
  const hasContext = ctx !== null

  // Ctrl/Cmd+Entrée → onSubmit. La closure `onSubmit` est lue via une ref tenue à jour à
  // chaque render, pour ne pas avoir à recréer l'éditeur ; l'extension elle-même est créée
  // une seule fois (initialiseur paresseux de useState).
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => { onSubmitRef.current = onSubmit })
  const [submitExtension] = useState(() =>
    Extension.create({
      name: 'submitOnModEnter',
      // > HardBreak / CodeBlock (priorité 100) : notre keymap `Mod-Enter` est enregistré en
      // premier et consomme l'évènement quand un onSubmit est fourni (sinon `false` → le
      // comportement TipTap par défaut reprend la main, rien ne change).
      priority: 1000,
      addKeyboardShortcuts: () => ({
        'Mod-Enter': () => {
          if (onSubmitRef.current) { onSubmitRef.current(); return true }
          return false
        },
      }),
    }),
  )

  // T171 — références de paramètres : décorées via le ParamRefProvider englobant (s'il existe).
  // L'extension est créée une fois et lit le contexte courant via une ref.
  const paramRefs = useParamRefs()
  const paramRefsRef = useRef(paramRefs)
  const unresolvedLabelRef = useRef(t('parameters.unresolved'))
  const disabledRef = useRef(!!disabled)
  useEffect(() => {
    paramRefsRef.current = paramRefs
    unresolvedLabelRef.current = t('parameters.unresolved')
    disabledRef.current = !!disabled
  })
  const [paramRefExtension] = useState(() => ParamRefDecoration.configure({
    getApi: () => paramRefsRef.current,
    getUnresolvedLabel: () => unresolvedLabelRef.current,
    getReadOnly: () => disabledRef.current,
  }))

  const [rawValue, setRawValue] = useState(value)
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null)
  // Last raw-mode state seen by the "back from raw" resync effect below: it only acts on an
  // actual raw → rich transition, never on mount (isThisRaw starts false). T176 — a "mounted"
  // flag was consumed by React StrictMode's simulated first pass (dev), and the second pass
  // then called setContent (normalized markdown ≠ rawValue): caret thrown to the end.
  const wasRawRef = useRef(false)
  // Same concern for the "value reset externally" effect below: TipTap-markdown's initial
  // parse of `content` is not always identity (e.g. a plain `\n` inside a paragraph is not
  // markdown syntax for a line break, so it round-trips as a space) — comparing the freshly
  // parsed doc's markdown against the raw `value` prop on the very first run reliably differs
  // for that reason alone, not because `value` actually changed. Without this guard, mounting
  // the field would call `setContent` on every load — a no-op content-wise (it just re-parses
  // the same already-reformatted text) but still a real transaction, so it would still trip the
  // `onUpdate` docChanged guard below and persist an unwanted (if content-identical) save.
  // T176 — the guard compares against the last `value` the effect has seen rather than being
  // a "first run" flag: React StrictMode (dev) runs mount effects twice, the simulated first
  // pass consumed the flag and the second one called `setContent` (the initial parse had
  // already emitted a normalized markdown, so `value` ≠ last emitted) — caret thrown to the
  // end of the content and a spurious save, randomly depending on the content's round-trip.
  const syncedValueRef = useRef(value)
  // Holds the markdown this field itself last emitted via onChange. The parent typically
  // echoes that same string straight back as the next `value` prop (through pendingEdits ->
  // objects merge, cf. SystemViewContext), but tiptap-markdown's parse-then-serialize round
  // trip is not always identity (see syncedValueRef comment above): re-parsing the just-
  // emitted markdown can yield a slightly different string than getMarkdown() reported the
  // first time, especially right after a paste (tables, images, escaped punctuation...).
  // Comparing the incoming `value` against THIS ref, instead of against a freshly recomputed
  // getMarkdown(), lets the resync effect recognize "this is just my own edit echoed back" and
  // skip setContent, which otherwise resets the caret to the document start mid-edit.
  const lastEmittedValueRef = useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit,
      ResizableImage.configure({ inline: false, allowBase64: true, repoPath }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformPastedText: true }),
      DrawioEmbed.configure({ repoPath }),
      submitExtension,
      paramRefExtension,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: variant === 'compact' ? `outline-none ${VIEWER_CLASS_COMPACT}` :
          'outline-none min-h-[80px] text-sm text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:font-medium [&_h3]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-status-neutral-bg [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-status-neutral-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-ink-2 [&_pre]:bg-status-neutral-bg [&_pre]:p-2 [&_pre]:rounded [&_img]:max-w-full [&_img]:rounded [&_table]:border-collapse [&_table]:my-2 [&_th]:border [&_th]:border-edge [&_th]:bg-hover [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-edge [&_td]:px-2 [&_td]:py-1',
      },
      handlePaste(view, event) {
        // Excel place plusieurs representations sur le presse-papiers pour
        // une plage copiee : du HTML (un vrai <table>) ET une image bitmap
        // de previsualisation. Si le HTML colle contient une table, on
        // l'insere explicitement plutot que de court-circuiter sur la
        // premiere image trouvee. Restreint au cas <table> (et non "tout HTML
        // present") pour ne pas regresser le collage d'une image accompagnee
        // de HTML sans table (ex. copie d'image depuis Word/une page web),
        // qui doit continuer a passer par la conversion base64 ci-dessous.
        //
        // Le tableau n'est pas reconstruit en reparsant le HTML colle dans le
        // document (via parseSlice) : sans un `context` correspondant
        // exactement a la profondeur d'insertion, parseSlice calcule un
        // openStart/openEnd egal a la profondeur de la structure du tableau,
        // ce qui fait fusionner le contenu voisin (avant/apres le curseur)
        // dans la derniere cellule au lieu de l'inserer proprement a cote —
        // corrompant du contenu existant sans rapport avec le collage.
        // A la place : on extrait le texte des cellules (extractTableRows),
        // on insere un tableau vide de la bonne taille via la commande
        // standard insertTable (deja utilisee par TableInsertButton, avec
        // ligne d'en-tete systematique, cf. T42.md decision 2), puis on
        // remplit chaque cellule (fillPastedTable). Les fusions de cellules
        // (colspan/rowspan) ne sont pas supportees (T42.md decision 1) : une
        // ligne source plus courte a cause d'une fusion est completee de
        // cellules vides (padTableRows) plutot que de decaler le contenu des
        // lignes suivantes.
        const html = event.clipboardData?.getData('text/html')
        if (html && /<table[\s>]/i.test(html) && editor) {
          const rows = extractTableRows(html)
          if (rows) {
            event.preventDefault()
            const cols = Math.max(...rows.map(r => r.length))
            const padded = padTableRows(rows, cols)
            editor.chain().focus().insertTable({ rows: padded.length, cols, withHeaderRow: true }).run()
            fillPastedTable(view, padded.flat())
            return true
          }
        }
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const blob = item.getAsFile()
            // Sans contexte repo, une image collée ne peut pas être écrite en
            // fichier (T76) — collage absorbé (preventDefault déjà appelé,
            // pas de fallback base64), cohérent avec l'insertion via bouton
            // (ImageInsertButton, désactivé sans repoPath).
            if (!blob || !repoPath) continue
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = reader.result as string
              const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
              void api.image.writePaste(repoPath, blob.type, base64).then(result => {
                // L'écriture disque est asynchrone : l'éditeur peut avoir été
                // démonté entre-temps (ex. popover fermée pendant le collage)
                // — dispatcher sur une vue détruite lève une exception.
                if (result.status !== 'ok' || view.isDestroyed) return
                const { state } = view
                const node = state.schema.nodes['image']?.create({ src: result.path })
                if (node) view.dispatch(state.tr.replaceSelectionWith(node))
              })
            }
            reader.readAsDataURL(blob)
            return true
          }
        }
        return false
      },
      handleDOMEvents: {
        contextmenu(view, event) {
          if (!view.editable) return false
          const target = event.target as HTMLElement
          const cell = target.closest('td, th')
          if (!cell) return false
          event.preventDefault()
          // Deplace explicitement la selection ProseMirror sur la cellule
          // DOM deja identifiee (`cell`) avant d'ouvrir le menu : le
          // placement natif du caret par le navigateur au clic droit n'est
          // pas garanti (notamment si une selection existait deja ailleurs),
          // et les commandes du menu (addRowBefore, deleteColumn...)
          // s'appliquent a la selection courante — sans ca elles agiraient
          // potentiellement sur une autre cellule que celle reellement
          // cliquee. posAtDOM(cell, 0) est ancre sur la cellule elle-meme
          // (pas sur les coordonnees ecran du clic) : contrairement a
          // posAtCoords, il ne peut pas resoudre vers une autre cellule que
          // celle deja confirmee par le hit-test DOM ci-dessus.
          const pos = view.posAtDOM(cell, 0)
          const selection = TextSelection.near(view.state.doc.resolve(pos))
          view.dispatch(view.state.tr.setSelection(selection))
          setTableMenu({ x: event.clientX, y: event.clientY })
          return true
        },
      },
    },
    onUpdate({ editor, transaction }) {
      // `Editor.setEditable()` (called from the effect below whenever `disabled` toggles,
      // including on mount) emits TipTap's 'update' event even though nothing in the document
      // actually changed. Without this guard that spurious event is indistinguishable from a
      // real edit — the (already lossily re-parsed, see syncedValueRef above) markdown gets
      // pushed to `onChange` and silently persisted, even though the user never typed anything.
      if (!transaction.docChanged) return
      const md = (editor.storage.markdown as MarkdownStorage).getMarkdown()
      lastEmittedValueRef.current = md
      setRawValue(md)
      onChange(md)
    },
    editable: !disabled,
  })

  // T171 — bases de paramètres chargées ou modifiées, ou passage lecture/édition : recalcule
  // les décorations (transaction sans changement de document, donc sans onUpdate ni sauvegarde).
  const paramRefsVersion = paramRefs?.version
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(paramRefPluginKey, true))
  }, [editor, paramRefsVersion, disabled])

  // Donne le focus dès que l'éditeur est prêt (une seule fois, au montage) — sans ça une popup
  // d'édition ouverte au clic (ex. cellule richtext de la vue Excel) s'affiche sans focus et
  // exige un second clic dans le contenu avant de pouvoir taper.
  useEffect(() => {
    if (!autoFocus || !editor) return
    const coords = typeof initialCaret === 'function' ? initialCaret() : null
    const pos = coords ? editor.view.posAtCoords(coords)?.pos : undefined
    editor.commands.focus(pos ?? 'end')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // Sync when value is reset externally (e.g., type change). Reacts only to an actual change
  // of the `value` prop since the last run (see syncedValueRef above) — on mount there's
  // nothing external to resync from yet.
  useEffect(() => {
    if (value === syncedValueRef.current) return
    syncedValueRef.current = value
    if (!editor) return
    // The parent echoing back exactly what we just emitted is not an external change —
    // skip it so a paste (or any edit) never gets its caret reset by its own round-trip.
    if (value === lastEmittedValueRef.current) return
    const current = (editor.storage.markdown as MarkdownStorage).getMarkdown()
    if (current !== value) {
      editor.commands.setContent(value, false)
      setRawValue(value)
    }
    lastEmittedValueRef.current = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
    // Le champ peut devenir non-editable pendant que le menu contextuel
    // tableau est ouvert (ex. changement de statut concurrent) — fermer le
    // menu plutot que de laisser des actions s'executer sur un champ cense
    // etre en lecture seule.
    if (disabled) setTableMenu(null)
  }, [editor, disabled])

  // Ferme le menu contextuel tableau des que la selection change pour une
  // autre raison que son ouverture (ex. Tab/flèches deplacent la selection
  // vers une autre cellule) : les items du menu sont ancres visuellement sur
  // la cellule cliquee a l'ouverture, ils deviendraient trompeurs sur une
  // autre cellule sans repositionnement.
  useEffect(() => {
    if (!editor || !tableMenu) return
    const close = () => setTableMenu(null)
    editor.on('selectionUpdate', close)
    return () => { editor.off('selectionUpdate', close) }
  }, [editor, tableMenu])

  // `ctx.isRaw` est global au provider (une seule case "Raw" dans la toolbar), mais
  // `ctx.activeEditor` désigne le champ réellement ciblé. Sans ce filtrage, tous les
  // RichTextField de la vue basculeraient en <textarea autoFocus> au clic sur "Raw" :
  // chacun réclamerait le focus au montage, le dernier de la page gagnerait, et le
  // caret sauterait hors du champ en cours d'édition (vue qui « part vers le bas »).
  const isThisRaw = hasContext && ctx.isRaw && ctx.activeEditor === editor

  // Resync editor when coming back from raw mode — only on an actual isThisRaw change (see
  // wasRawRef above): on mount it would risk a spurious setContent due to TipTap markdown
  // normalization differences.
  useEffect(() => {
    if (isThisRaw === wasRawRef.current) return
    wasRawRef.current = isThisRaw
    if (!editor || !ctx) return
    if (!isThisRaw) {
      const current = (editor.storage.markdown as MarkdownStorage).getMarkdown()
      if (current !== rawValue) {
        editor.commands.setContent(rawValue, false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThisRaw])

  // Deactivate context when this RichTextField unmounts (e.g. popover closed).
  // onBlur does not fire during React unmount, so without this cleanup
  // ctx.isActive would remain true with a stale activeEditor reference.
  useEffect(() => {
    return () => {
      if (ctx) ctx.deactivate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const btn = (active: boolean) =>
    `inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1.5 text-xs rounded text-ink-2 hover:bg-hover transition-colors ${active ? 'bg-hover text-ink' : ''}`

  const tableMenuElement = tableMenu && editor && (
    <NodeContextMenu
      x={tableMenu.x}
      y={tableMenu.y}
      items={buildTableMenuItems(editor)}
      onClose={() => setTableMenu(null)}
    />
  )

  // With context provider: no inline toolbar, register editor on focus/blur
  if (hasContext) {
    return (
      <div
        className={`${variant === 'compact' ? '' : 'border border-edge rounded'} overflow-hidden ${disabled ? 'opacity-60' : ''}`}
        onFocus={() => {
          // Guard: only activate if this editor is not already active, to
          // avoid re-calling activate() when focus moves to the raw textarea
          // (autoFocus bubbles a focus event to this div, which must not reset
          // isRaw via activate()).
          if (editor && ctx && ctx.activeEditor !== editor) ctx.activate(editor)
        }}
        onBlur={e => {
          // relatedTarget est null quand le focus quitte toute la fenêtre (ex.
          // ouverture d'un dialogue natif comme le sélecteur de fichier) plutôt
          // que déplacé vers un autre élément de la page — dans ce cas on ne
          // désactive pas le contexte, sinon la toolbar (et tout composant qui
          // y vit, ex. DrawioInsertButton) se démonte au milieu d'un flux async
          // qui dépend justement d'un tel dialogue.
          if (ctx && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
            ctx.deactivate()
          }
        }}
      >
        {isThisRaw ? (
          <textarea
            autoFocus
            value={rawValue}
            onChange={e => {
              // Marque cette valeur comme émise par ce champ : l'effet [value] la
              // reconnaît comme un écho de notre propre édition et n'appelle pas
              // setContent sur l'éditeur (masqué) à chaque frappe en mode raw.
              lastEmittedValueRef.current = e.target.value
              setRawValue(e.target.value)
              onChange(e.target.value)
            }}
            className={variant === 'compact'
              ? 'w-full px-2 py-1 text-xs font-mono text-ink bg-transparent outline-none resize-y min-h-[4rem]'
              : 'w-full px-3 py-2 text-sm font-mono text-ink bg-surface outline-none resize-y min-h-[80px]'}
          />
        ) : (
          <div className={variant === 'compact' ? 'px-2 py-1' : 'px-3 py-2 bg-surface'}>
            {/* T176 — compact (cellule de la Vue Excel) : fond transparent, la cellule garde le fond
                de sa ligne (sélection, colonne figée) comme en lecture — pas de pavé blanc. */}
            <EditorContent editor={editor} />
          </div>
        )}
        {tableMenuElement}
      </div>
    )
  }

  // Without context provider: original behavior with inline toolbar
  return (
    <div className={`border border-edge rounded overflow-hidden ${disabled ? 'opacity-60' : ''}`}>
      {/* Toolbar — masquée en lecture seule : sinon les boutons restent cliquables et peuvent
          exécuter une commande d'édition sur le document même si editable=false. */}
      {!disabled && (
      <div className="flex gap-0.5 px-2 py-1 border-b border-edge bg-surface flex-wrap items-center">
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }}
          className={btn(!!editor?.isActive('bold'))}
        ><strong>B</strong></button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }}
          className={btn(!!editor?.isActive('italic'))}
        ><em>I</em></button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleStrike().run() }}
          className={btn(!!editor?.isActive('strike'))}
        ><s>S</s></button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleCode().run() }}
          className={btn(!!editor?.isActive('code'))}
          title={t('system.shared.inlineCode')}
        ><span className="font-mono">{"`…`"}</span></button>
        <span className="w-px h-4 bg-edge mx-1" />
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleHeading({ level: 2 }).run() }}
          className={btn(!!editor?.isActive('heading', { level: 2 }))}
        >H2</button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleHeading({ level: 3 }).run() }}
          className={btn(!!editor?.isActive('heading', { level: 3 }))}
        >H3</button>
        <span className="w-px h-4 bg-edge mx-1" />
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run() }}
          className={btn(!!editor?.isActive('bulletList'))}
        >{"• —"}</button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleOrderedList().run() }}
          className={btn(!!editor?.isActive('orderedList'))}
        >1.</button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleBlockquote().run() }}
          className={btn(!!editor?.isActive('blockquote'))}
        >&#10077;</button>
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); editor?.chain().focus().toggleCodeBlock().run() }}
          className={btn(!!editor?.isActive('codeBlock'))}
          title={t('system.shared.codeBlock')}
        ><span className="font-mono text-xs">{"{ }"}</span></button>
        <span className="w-px h-4 bg-edge mx-1" />
        <ImageInsertButton editor={editor} repoPath={repoPath} className={btn(false)} />
        <DrawioInsertButton editor={editor} repoPath={repoPath} className={btn(false)} />
        <TableInsertButton editor={editor} className={btn(false)} />
        <ParamInsertButton editor={editor} className={btn(false)} />
      </div>
      )}
      {/* Content */}
      <div className="px-3 py-2 bg-surface">
        <EditorContent editor={editor} />
      </div>
      {tableMenuElement}
    </div>
  )
}
