import { useState, useRef } from 'react'
import { RichTextField } from './RichTextField'

export interface StepDraft {
  action: string
  expectedResult: string
}

interface StepsTableProps {
  steps: StepDraft[]
  onChange: (steps: StepDraft[]) => void
  disabled?: boolean
  repoPath?: string
}

export function StepsTable({ steps, onChange, disabled, repoPath }: StepsTableProps) {
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const update = (index: number, field: keyof StepDraft, value: string) => {
    onChange(steps.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index))
  }

  const addStep = () => {
    onChange([...steps, { action: '', expectedResult: '' }])
  }

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDrop = (targetIndex: number) => {
    const from = dragIndexRef.current
    if (from === null || from === targetIndex) return
    const next = [...steps]
    const [moved] = next.splice(from, 1)
    next.splice(targetIndex, 0, moved)
    onChange(next)
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  return (
    <div>
      {/* Column labels — lightweight, above the bordered container */}
      <div className="grid grid-cols-[1.75rem_1fr_1fr_1.75rem] px-1 pb-0.5">
        <span />
        <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide px-1">Action</span>
        <span className="text-[10px] font-medium text-ink-3 uppercase tracking-wide px-1">Résultat attendu</span>
        <span />
      </div>

      {/* Step rows */}
      <div className="border border-edge rounded overflow-hidden divide-y divide-edge">
        {steps.map((step, index) => (
          <div
            key={index}
            draggable={!disabled}
            onDragStart={() => handleDragStart(index)}
            onDragOver={e => handleDragOver(e, index)}
            onDrop={() => handleDrop(index)}
            onDragEnd={handleDragEnd}
            className={[
              'group bg-surface transition-colors',
              dragOverIndex === index ? 'border-t-2 border-blue-400' : '',
              dragIndexRef.current === index ? 'opacity-50' : '',
            ].join(' ')}
          >
            <div className="grid grid-cols-[1.75rem_1fr_1fr_1.75rem] items-start">
              {/* Handle / # — shows # at rest, ⠿ on hover */}
              <div className={`flex items-center justify-center self-stretch text-xs text-ink-3 select-none border-r border-edge ${disabled ? '' : 'group-hover:cursor-grab'}`}>
                <span className={disabled ? '' : 'group-hover:hidden'}>{index + 1}</span>
                {!disabled && <span className="hidden group-hover:block text-base leading-none">⠿</span>}
              </div>

              {/* Action */}
              <div className="border-r border-edge [&_.ProseMirror]:min-h-[2.5rem] [&_.ProseMirror]:text-sm [&>div]:rounded-none [&>div]:border-0">
                <RichTextField
                  value={step.action}
                  onChange={v => update(index, 'action', v)}
                  disabled={disabled}
                  placeholder="Action…"
                  repoPath={repoPath}
                />
              </div>

              {/* Résultat attendu */}
              <div className="[&_.ProseMirror]:min-h-[2.5rem] [&_.ProseMirror]:text-sm [&>div]:rounded-none [&>div]:border-0">
                <RichTextField
                  value={step.expectedResult}
                  onChange={v => update(index, 'expectedResult', v)}
                  disabled={disabled}
                  placeholder="Résultat attendu…"
                  repoPath={repoPath}
                />
              </div>

              {/* Delete — visible on hover only */}
              <div className="flex items-center justify-center self-stretch border-l border-edge">
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  disabled={disabled || steps.length <= 1}
                  className="opacity-0 group-hover:opacity-100 text-xs text-ink-3 hover:text-red-500 transition-all disabled:opacity-0"
                  title="Supprimer l'étape"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addStep}
        disabled={disabled}
        className="mt-1.5 btn-sm"
      >
        + Ajouter une étape
      </button>
    </div>
  )
}
