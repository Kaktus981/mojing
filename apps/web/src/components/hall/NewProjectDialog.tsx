import { AlertCircle, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Btn } from '../ui/Primitives'
import { NEW_PROJECT_TITLE_MAX, validateNewProjectInput } from './newProjectValidation'

type NewProjectDialogProps = {
  open: boolean
  busy: boolean
  error?: string
  onDismissError: () => void
  onClose: () => void
  onSubmit: (input: { title: string; seed: string }) => Promise<void>
}

export function NewProjectDialog({ open, busy, error, onDismissError, onClose, onSubmit }: NewProjectDialogProps): React.JSX.Element | null {
  const [title, setTitle] = useState('')
  const [seed, setSeed] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [seedTouched, setSeedTouched] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setSeed('')
    setTitleTouched(false)
    setSeedTouched(false)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const containFocus = (event: FocusEvent): void => {
      if (!dialogRef.current?.contains(event.target as Node)) titleRef.current?.focus()
    }
    document.addEventListener('focusin', containFocus)
    titleRef.current?.focus()
    return () => { document.removeEventListener('focusin', containFocus); trigger?.focus() }
  }, [open])

  useLayoutEffect(() => {
    if (open && (!dialogRef.current?.contains(document.activeElement) || document.activeElement?.matches(':disabled'))) titleRef.current?.focus()
  }, [open, busy])

  if (!open) return null
  const fieldErrors = validateNewProjectInput({ title, seed })
  const titleError = fieldErrors.title && (titleTouched || title.length > NEW_PROJECT_TITLE_MAX) ? fieldErrors.title : undefined
  const seedError = fieldErrors.seed && seedTouched ? fieldErrors.seed : undefined
  const canSubmit = !fieldErrors.title && !fieldErrors.seed

  return (
    <div className="mjp-mask" onMouseDown={() => { if (!busy) onClose() }}>
      <form
        ref={dialogRef}
        className="mjp-modal mjp-new-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mjp-new-project-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); return }
          if (event.key !== 'Tab') return
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
          const first = focusable[0]
          const last = focusable.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit && !busy) void onSubmit({ title: title.trim(), seed: seed.trim() })
        }}
      >
        <header className="mjp-modal-hd">
          <div className="ti"><p className="eyebrow">开始一个新故事</p><h3 id="mjp-new-project-title">新建小说</h3></div>
          <Btn variant="ghost" aria-label="关闭新建小说" onClick={onClose} disabled={busy}>×</Btn>
        </header>
        <div className="mjp-modal-bd mjp-form-grid">
          <div className="mjp-field"><label className="lbl" htmlFor="mjp-new-project-title-input">小说名称</label><input id="mjp-new-project-title-input" ref={titleRef} className={`mjp-input${titleError ? ' is-invalid' : ''}`} aria-invalid={titleError ? true : undefined} aria-describedby="mjp-new-project-title-hint" value={title} onBlur={() => setTitleTouched(true)} onChange={(event) => { setTitle(event.target.value); if (error) onDismissError() }} /><span id="mjp-new-project-title-hint" className={`mjp-hint${titleError ? ' is-danger' : ''}`}>{titleError ?? `${title.length}/${NEW_PROJECT_TITLE_MAX} · 最多 120 个字符`}</span></div>
          <div className="full mjp-field"><label className="lbl" htmlFor="mjp-new-project-seed-input">最初的故事想法</label><textarea id="mjp-new-project-seed-input" className={`mjp-textarea${seedError ? ' is-invalid' : ''}`} aria-invalid={seedError ? true : undefined} aria-describedby="mjp-new-project-seed-hint" rows={5} value={seed} onBlur={() => setSeedTouched(true)} onChange={(event) => { setSeed(event.target.value); if (error) onDismissError() }} /><span id="mjp-new-project-seed-hint" className={`mjp-hint${seedError ? ' is-danger' : ''}`}>{seedError ?? '写下故事的起点、人物目标或主要冲突，后续仍可修改。'}</span></div>
          {error ? <div className="full mjp-new-project-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><p><strong>无法创建小说</strong><span>{error}</span></p><button type="button" aria-label="关闭创建错误" onClick={onDismissError}><X size={15} /></button></div> : null}
        </div>
        <footer className="mjp-modal-ft">
          <span className="hint">后续可在“灵感与规格”中完善设定。</span>
          <Btn onClick={onClose} disabled={busy}>取消</Btn>
          <Btn variant="primary" type="submit" loading={busy} disabled={!canSubmit}>创建项目</Btn>
        </footer>
      </form>
    </div>
  )
}
