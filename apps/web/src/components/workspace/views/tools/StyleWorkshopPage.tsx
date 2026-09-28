import { BookOpen, FileText, Palette, Sparkles, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  NovelProject, StyleProfile, StyleProfileUsage, StyleSample, StyleSamplePreview
} from '../../../../../../../packages/contracts/src'
import { mojingClient } from '../../../../api/mojingClient'
import { useNovelStore } from '../../../../novelStore'
import { Btn, Field, Status, Tag } from '../../../ui/Primitives'
import { useDelayedFlag, type AsyncState } from '../../../ui/asyncState'
import '../../../../styles/skill-center.css'

function message(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败。'
}

/**
 * 文笔工坊（D4）。
 *
 * 顺序：添加样文（粘贴 / TXT / Markdown / DOCX / EPUB）→ 选择参与分析的片段 →
 * 生成候选画像 → 绑定到当前项目。
 *
 * 三条硬规则：
 *  1. **导入不调用模型**：只有作者点了「分析所选片段」才会把勾选内容发出去。
 *  2. **绑定的是快照**：画像之后被修改，本项目仍用这一版，直到作者明确更新。
 *
 * 文件型导入（TXT / Markdown / DOCX / EPUB）在服务端内存里取文：EPUB 按 ZIP 解析并抽取正文，
 * DOCX 走文档转换，全程零模型请求、不写文件系统。DRM / 损坏 / 非 ZIP 都会给出明确人话错误。
 */
const FILE_KINDS: Record<string, 'TXT' | 'Markdown' | 'DOCX' | 'EPUB'> = {
  txt: 'TXT', text: 'TXT', md: 'Markdown', markdown: 'Markdown', docx: 'DOCX', epub: 'EPUB'
}

function kindFromFilename(filename: string): 'TXT' | 'Markdown' | 'DOCX' | 'EPUB' | undefined {
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
  return FILE_KINDS[extension]
}

type LearnStep = 'add' | 'segments' | 'analyze'
type DrawerState = { kind: 'learn'; step: LearnStep } | { kind: 'profile'; profileId: string }
type LibraryTab = 'profiles' | 'samples' | 'usage'

const LEARN_STEPS: Array<{ id: LearnStep; label: string }> = [
  { id: 'add', label: '添加样文' },
  { id: 'segments', label: '选择片段' },
  { id: 'analyze', label: '生成候选' }
]

const TRAIT_LABELS: Array<[keyof StyleProfile['traits'], string]> = [
  ['sentenceRhythm', '句式节奏'],
  ['narrativeDistance', '叙述距离'],
  ['dialogueStyle', '对白方式'],
  ['descriptionStyle', '描写方式'],
  ['pacing', '推进节奏'],
  ['diction', '用词倾向'],
  ['paragraphPattern', '段落结构'],
  ['rhetoric', '修辞强度']
]

function formatDate(value: string): string {
  return value.slice(0, 10) || '未记录'
}

/** 浏览器里把文件读成 base64：分块拼接，避免 `String.fromCharCode(...)` 在长数组上爆栈。 */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

export function StyleWorkshopPage({ project }: { project: NovelProject }): React.JSX.Element {
  const [samples, setSamples] = useState<StyleSample[]>([])
  const [profiles, setProfiles] = useState<StyleProfile[]>([])
  const [usage, setUsage] = useState<StyleProfileUsage[]>([])
  const [name, setName] = useState('样文')
  const [content, setContent] = useState('')
  const [fileName, setFileName] = useState<string>()
  const [fileKind, setFileKind] = useState<'TXT' | 'Markdown' | 'DOCX' | 'EPUB'>()
  const [fileBase64, setFileBase64] = useState<string>()
  const [preview, setPreview] = useState<StyleSamplePreview>()
  const [selected, setSelected] = useState<string[]>([])
  const [profileName, setProfileName] = useState('样文画像')
  const [evidence, setEvidence] = useState<string[]>([])
  const [sentCount, setSentCount] = useState<number>()
  const [activeSampleId, setActiveSampleId] = useState<string>()
  const [generatedProfileId, setGeneratedProfileId] = useState<string>()
  const [drawer, setDrawer] = useState<DrawerState>()
  const [activeTab, setActiveTab] = useState<LibraryTab>('profiles')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const showBusy = useDelayedFlag(busy)
  const asyncState: AsyncState = busy ? 'busy' : 'idle'

  const refresh = async (): Promise<void> => {
    const [sampleList, profileList, usageList] = await Promise.all([
      mojingClient.styleSamples.list(), mojingClient.styleProfiles.list(), mojingClient.styleProfiles.usage(project.id)
    ])
    setSamples(sampleList)
    setProfiles(profileList)
    setUsage(usageList)
  }

  useEffect(() => { void refresh().catch((error) => setFailure(message(error))) }, [project.id])

  const boundId = project.settings.activeStyleProfileId
  const hasFile = Boolean(fileBase64 && fileKind && fileName)
  const canSubmit = Boolean(content.trim()) || hasFile

  function openLearn(): void {
    setFailure(undefined)
    setNotice(undefined)
    setGeneratedProfileId(undefined)
    setActiveSampleId(undefined)
    setPreview(undefined)
    setSelected([])
    setDrawer({ kind: 'learn', step: 'add' })
  }

  function openProfile(profile: StyleProfile): void {
    setFailure(undefined)
    setNotice(undefined)
    setDrawer({ kind: 'profile', profileId: profile.id })
  }

  function closeDrawer(): void {
    setDrawer(undefined)
  }

  function setLearnStep(step: LearnStep): void {
    setDrawer((current) => current?.kind === 'learn' ? { ...current, step } : current)
  }

  function clearFile(): void {
    setFileName(undefined); setFileKind(undefined); setFileBase64(undefined)
  }

  /** 选择真实文件：读成 base64，交给服务端取文并预览；解析失败如实报错。 */
  async function pickFile(file: File | undefined): Promise<void> {
    if (!file) return
    const kind = kindFromFilename(file.name)
    if (!kind) { setFailure('只支持 TXT / Markdown / DOCX / EPUB 文件。'); return }
    setBusy(true); setFailure(undefined); setNotice(undefined); setActiveSampleId(undefined); setPreview(undefined); setSelected([])
    try {
      const dataBase64 = await fileToBase64(file)
      const sampleName = file.name.replace(/\.[^.]+$/, '').trim() || file.name || '样文'
      setFileName(file.name); setFileKind(kind); setFileBase64(dataBase64)
      setName(sampleName); setContent('')
      const result = await mojingClient.styleSamples.previewFile({ name: sampleName, filename: file.name, kind, dataBase64 })
      setPreview(result); setSelected([])
      setLearnStep('segments')
    } catch (error) {
      clearFile(); setPreview(undefined); setFailure(message(error))
    } finally { setBusy(false) }
  }

  async function doPreview(): Promise<void> {
    setBusy(true); setFailure(undefined); setActiveSampleId(undefined)
    try {
      const result = hasFile
        ? await mojingClient.styleSamples.previewFile({ name: name.trim() || '样文', filename: fileName!, kind: fileKind!, dataBase64: fileBase64! })
        : await mojingClient.styleSamples.preview({ name: name.trim() || '样文', kind: 'TXT', content })
      setPreview(result)
      setSelected([])
      setLearnStep('segments')
    } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  async function importSample(continueToAnalyze = false): Promise<void> {
    setBusy(true); setFailure(undefined)
    try {
      const saved = hasFile
        ? await mojingClient.styleSamples.createFile({ name: name.trim() || '样文', filename: fileName!, kind: fileKind!, dataBase64: fileBase64! })
        : await mojingClient.styleSamples.create({ name: name.trim() || '样文', kind: 'TXT', content })
      setNotice(`已导入「${saved.name}」，共 ${saved.segments.length} 段；勾选要参与分析的片段。`)
      setContent('')
      clearFile()
      setActiveSampleId(saved.id)
      setSelected((current) => current.filter((segmentId) => saved.segments.some((segment) => segment.id === segmentId)))
      await refresh()
      setLearnStep(continueToAnalyze ? 'analyze' : preview ? 'segments' : 'add')
    } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  async function analyze(): Promise<void> {
    const sample = samples.find((item) => item.id === activeSampleId)
    if (!sample || selected.length === 0 || selected.some((id) => !sample.segments.some((segment) => segment.id === id))) {
      setFailure('请先导入并选择这篇样文的片段。')
      return
    }
    setBusy(true); setFailure(undefined); setNotice(undefined)
    try {
      const result = await mojingClient.styleProfiles.analyze({
        sampleId: sample.id, segmentIds: selected, profileName: profileName.trim() || '样文画像'
      })
      setEvidence(result.evidence)
      setSentCount(result.sentCharacterCount)
      setGeneratedProfileId(result.profile.id)
      setNotice('候选画像已保存到文风库；尚未绑定到本项目。')
      await refresh()
    } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  async function bind(profileId: string | undefined): Promise<void> {
    setBusy(true); setFailure(undefined); setNotice(undefined)
    try {
      const next = !profileId
        ? await mojingClient.styleProfiles.unbind(project.id)
        : await mojingClient.styleProfiles.bind(project.id, profileId)
      // 服务端已经保存过一次，这里只把最新项目同步进界面，不再触发第二次保存。
      useNovelStore.getState().replaceProject(next)
      setNotice(profileId ? '已绑定这一版画像快照；之后画像被修改，本项目不会自动升级。' : '已停用文风范本；正文没有被改动。')
      await refresh()
    } catch (error) { setFailure(message(error)) } finally { setBusy(false) }
  }

  function renderLearnDrawer(step: LearnStep): React.JSX.Element {
    return (
      <>
        <nav className="style-workshop-drawer-steps" aria-label="学习新文步骤">
          {LEARN_STEPS.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={item.id === step ? 'is-active' : undefined}
              onClick={() => item.id === 'add' || preview || activeSampleId ? setLearnStep(item.id) : undefined}
              disabled={item.id !== 'add' && !preview && !activeSampleId}
            >
              <span>{index + 1}</span>{item.label}
            </button>
          ))}
        </nav>

        {step === 'add' && (
          <section className="mjp-card style-workshop-drawer-card">
            <header className="mjp-card-hd"><div className="ti"><Upload size={18} strokeWidth={1.7} className="ico" />添加样文</div></header>
            <div className="mjp-card-bd">
              <Field label="样文文件（TXT / Markdown / DOCX / EPUB）">
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.docx,.epub"
                  aria-label="选择样文文件"
                  data-testid="style-file-input"
                  onChange={(event) => void pickFile(event.target.files?.[0])}
                />
              </Field>
              {fileName && <p className="mjp-muted style-workshop-file-name" data-testid="style-file-name">已选择文件：{fileName}（{fileKind}）</p>}
              <Field label="或直接粘贴样文正文">
                <textarea
                  className="skill-center-textarea"
                  aria-label="样文正文"
                  rows={7}
                  value={content}
                  onChange={(event) => { setContent(event.target.value); setActiveSampleId(undefined); setPreview(undefined); setSelected([]); if (event.target.value.trim()) clearFile() }}
                />
              </Field>
              <div className="mjp-row style-workshop-drawer-actions">
                <Btn size="sm" icon={FileText} disabled={busy || !canSubmit} onClick={() => void doPreview()} data-testid="style-preview">预览分段</Btn>
                <Btn size="sm" variant="primary" disabled={busy || !canSubmit} onClick={() => void importSample()} data-testid="style-import">导入样文</Btn>
              </div>
              <p className="mjp-muted style-workshop-drawer-note" data-testid="epub-status">
                当前可导入：TXT、Markdown、DOCX、EPUB。导入时只读取文本，不会立即调用模型。
              </p>
              {samples.length > 0 && (
                <div className="style-workshop-sample-list" data-testid="style-imported-samples">
                  <div className="style-workshop-subheading">已导入样文</div>
                  {samples.map((sample) => (
                    <div key={sample.id} className="style-workshop-sample-row">
                      <span><b>{sample.name}</b><small>{sample.segments.length} 段 · {sample.kind}</small></span>
                      <Btn
                        size="sm"
                        disabled={busy}
                        onClick={() => { setActiveSampleId(sample.id); setSelected(sample.segments.map((item) => item.id)); setLearnStep('analyze') }}
                      >
                        全选并分析
                      </Btn>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {step === 'segments' && (
          <section className="mjp-card style-workshop-drawer-card" data-testid="style-segment-step">
            <header className="mjp-card-hd"><div className="ti"><BookOpen size={18} strokeWidth={1.7} className="ico" />选择片段</div></header>
            <div className="mjp-card-bd">
              {preview ? (
                <>
                  <p className="style-workshop-step-summary">共 {preview.segments.length} 段，{preview.characterCount} 字。选择要发送给模型的片段。</p>
                  {preview.segments.slice(0, 12).map((segment) => (
                    <label key={segment.id} className="mjp-health-row style-workshop-segment-row">
                      <span className="nm">
                        <input
                          type="checkbox"
                          checked={selected.includes(segment.id)}
                          onChange={(event) => setSelected((prev) => event.target.checked ? [...prev, segment.id] : prev.filter((item) => item !== segment.id))}
                        />
                        <b>{segment.label}</b>
                        <span className="mjp-muted"> · {segment.excerpt}</span>
                      </span>
                    </label>
                  ))}
                  {preview.warnings.map((warning) => <p key={warning} className="mjp-hint is-warn">{warning}</p>)}
                </>
              ) : <Status tone="warn">还没有可选片段，请先返回添加样文。</Status>}
              <div className="mjp-row style-workshop-drawer-actions">
                <Btn size="sm" variant="ghost" onClick={() => setLearnStep('add')}>返回添加样文</Btn>
                <Btn
                  size="sm"
                  variant="primary"
                  disabled={busy || !preview || selected.length === 0}
                  onClick={() => activeSampleId ? setLearnStep('analyze') : void importSample(true)}
                >
                  {activeSampleId ? '进入生成候选' : '导入样文并继续'}
                </Btn>
              </div>
            </div>
          </section>
        )}

        {step === 'analyze' && (
          <section className="mjp-card style-workshop-drawer-card" data-testid="style-analyze-step">
            <header className="mjp-card-hd"><div className="ti"><Sparkles size={18} strokeWidth={1.7} className="ico" />生成候选</div></header>
            <div className="mjp-card-bd">
              <Field label="画像名称">
                <input aria-label="画像名称" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
              </Field>
              <Tag tone="outline">已选 {selected.length} 段</Tag>
              <div className="mjp-row style-workshop-drawer-actions">
                <Btn size="sm" variant="ghost" onClick={() => setLearnStep('segments')}>返回选择片段</Btn>
                <Btn size="sm" variant="primary" disabled={busy || selected.length === 0 || !activeSampleId} onClick={() => void analyze()} data-testid="style-analyze">
                  生成并保存画像
                </Btn>
              </div>
              {sentCount !== undefined && (
                <div className="style-workshop-result" data-testid="style-evidence">
                  <Status tone="ok">候选画像已保存到文风库</Status>
                  <p>本次实际发送 {sentCount} 字；依据：{evidence.join('；') || '无'}</p>
                  {generatedProfileId && profiles.find((profile) => profile.id === generatedProfileId) && (
                    <Btn size="sm" onClick={() => openProfile(profiles.find((profile) => profile.id === generatedProfileId)!)}>查看画像</Btn>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </>
    )
  }

  function renderProfileDrawer(profile: StyleProfile | undefined): React.JSX.Element {
    if (!profile) return <Status tone="warn">这份画像已不存在，请返回画像库。</Status>
    const glanceTraits = TRAIT_LABELS.filter(([key]) => profile.traits[key]?.trim()).slice(0, 3)
    return (
      <div className="style-workshop-profile-detail" data-testid="style-profile-detail">
        <div className="style-workshop-profile-meta">
          <Tag tone={boundId === profile.id ? 'ok' : 'outline'}>{boundId === profile.id ? '用于正文' : '未用于正文'}</Tag>
          <span>来源 · {profile.sourceKind}{profile.sourceName ? ` · ${profile.sourceName}` : ''}</span>
          <span>更新 · {formatDate(profile.updatedAt)}</span>
        </div>
        {profile.description && <p className="style-workshop-profile-description">{profile.description}</p>}
        <div className="style-workshop-profile-glance" data-testid="style-profile-glance">
          <div className="style-workshop-subheading">文风速览</div>
          {glanceTraits.length > 0 ? glanceTraits.map(([key, label]) => (
            <div key={key} className="style-workshop-trait-row">
              <span>{label}</span><b>{profile.traits[key]}</b>
            </div>
          )) : <Status tone="warn">暂无可判断的特征</Status>}
        </div>
        <div className="style-workshop-drawer-actions">
          <Btn size="sm" variant={boundId === profile.id ? 'default' : 'primary'} disabled={busy || boundId === profile.id} onClick={() => void bind(profile.id)}>
            {boundId === profile.id ? '已用于正文' : '用于正文'}
          </Btn>
          <Btn size="sm" variant="ghost" disabled={busy || boundId !== profile.id} onClick={() => void bind(undefined)}>停用正文文风</Btn>
        </div>
        <details className="style-workshop-profile-full" data-testid="style-profile-full">
          <summary>查看完整画像</summary>
          {profile.description && <p className="style-workshop-profile-description">{profile.description}</p>}
          <div className="style-workshop-traits">
            <div className="style-workshop-subheading">画像特征</div>
            {TRAIT_LABELS.map(([key, label]) => (
              <div key={key} className="style-workshop-trait-row">
                <span>{label}</span><b>{profile.traits[key] || '未记录'}</b>
              </div>
            ))}
          </div>
          {profile.guidelines.length > 0 && <div className="style-workshop-list"><div className="style-workshop-subheading">建议遵守</div><ul>{profile.guidelines.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {profile.avoidPatterns.length > 0 && <div className="style-workshop-list"><div className="style-workshop-subheading">需要避免</div><ul>{profile.avoidPatterns.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </details>
      </div>
    )
  }

  return (
    <div className="style-workshop-page" aria-busy={busy} data-state={asyncState} data-testid="style-workshop-async-scope">
      {notice && <div className="mjp-banner info"><div>{notice}</div></div>}
      {failure && <div className="mjp-banner warn" role="alert" data-testid="style-error"><div>{failure}</div></div>}
      {showBusy && <div className="mjp-status warn" role="status" data-testid="style-workshop-wait"><span className="mjp-spin" aria-hidden="true">◌</span>正在处理，请稍候…</div>}

      <header className="style-workshop-header">
        <div>
          <p className="style-workshop-kicker">文笔工坊</p>
          <h2>文风库</h2>
          <p className="style-workshop-lead">集中查看可复用的文风画像，选择一份用于当前项目的正文。</p>
        </div>
        <Btn size="md" variant="primary" icon={Upload} onClick={openLearn} data-testid="style-learn-new">学习新文</Btn>
      </header>

      <nav className="style-workshop-tabs" aria-label="文风工坊内容" data-testid="style-workshop-tabs">
        <button type="button" className={activeTab === 'profiles' ? 'is-active' : undefined} onClick={() => setActiveTab('profiles')}>文风库</button>
        <button type="button" className={activeTab === 'samples' ? 'is-active' : undefined} onClick={() => setActiveTab('samples')} data-testid="style-imported-samples-tab">已导入样文</button>
        <button type="button" className={activeTab === 'usage' ? 'is-active' : undefined} onClick={() => setActiveTab('usage')} data-testid="style-usage-history-tab">使用记录</button>
      </nav>

      <section className="mjp-card style-profile-library" data-testid="style-profile-library">
        <header className="mjp-card-hd">
          <div className="ti"><Palette size={18} strokeWidth={1.7} className="ico" />{activeTab === 'profiles' ? '画像库' : activeTab === 'samples' ? '已导入样文' : '使用记录'}</div>
          <div className="right"><Tag tone="outline">{activeTab === 'profiles' ? `${profiles.length} 份画像` : activeTab === 'samples' ? `${samples.length} 篇样文` : `${usage.length} 条记录`}</Tag></div>
        </header>
        <div className="mjp-card-bd">
          {activeTab === 'profiles' && (profiles.length === 0 ? (
            <div className="style-workshop-empty">
              <Status tone="warn">还没有文风范本</Status>
              <p>从一篇样文开始，生成一份可复用的画像。</p>
              <Btn size="sm" variant="primary" onClick={openLearn}>学习新文</Btn>
            </div>
          ) : (
            <div className="style-workshop-profile-list">
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="style-workshop-profile-row"
                  data-testid="style-profile"
                  onClick={() => openProfile(profile)}
                >
                  <span className="style-workshop-profile-main">
                    <b>{profile.name}</b>
                    <span className="style-workshop-profile-meta">来源 · {profile.sourceKind}{profile.sourceName ? ` · ${profile.sourceName}` : ''}</span>
                  </span>
                  <span className="style-workshop-profile-meta">更新 · {formatDate(profile.updatedAt)}</span>
                  <span className="style-workshop-profile-status">
                    <Tag tone={boundId === profile.id ? 'ok' : 'outline'} dot>{boundId === profile.id ? '用于正文' : '未使用'}</Tag>
                  </span>
                </button>
              ))}
            </div>
          ))}

          {activeTab === 'samples' && (samples.length === 0 ? (
            <div className="style-workshop-empty">
              <Status tone="warn">还没有已导入样文</Status>
              <p>导入一篇样文后，它会出现在这里并可继续分析。</p>
              <Btn size="sm" variant="primary" onClick={openLearn}>学习新文</Btn>
            </div>
          ) : (
            <div className="style-workshop-sample-library" data-testid="style-sample-list">
              {samples.map((sample) => (
                <div key={sample.id} className="style-workshop-sample-library-row">
                  <div><b>{sample.name}</b><span>{sample.kind} · {sample.segments.length} 段 · {sample.text.length.toLocaleString()} 字</span></div>
                  <span>{formatDate(sample.createdAt)}</span>
                </div>
              ))}
            </div>
          ))}

          {activeTab === 'usage' && (
            usage.length > 0 ? (
              <div data-testid="style-usage-record">
                {usage.map((record) => (
                  <div className="style-workshop-usage-record" key={record.id}>
                    <Tag tone={record.action === '绑定' ? 'ok' : 'outline'} dot>{record.action === '绑定' ? '用于正文' : '已停用'}</Tag>
                    <div><b>{record.profileName}</b><span>项目第 {record.revision} 版 · {record.action}</span></div>
                    <span>{formatDate(record.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : boundId ? (
              <div className="style-workshop-usage-record" data-testid="style-usage-record">
                <Tag tone="ok" dot>当前使用</Tag>
                <div><b>{project.settings.styleProfileSnapshot?.name ?? '当前文风画像'}</b><span>当前绑定状态；过往操作尚无记录</span></div>
              </div>
            ) : (
              <div className="style-workshop-empty">
                <Status tone="warn">当前项目还没有绑定文风画像</Status>
                <p>在文风库中打开一份画像，即可将它用于正文。</p>
                <Btn size="sm" onClick={() => setActiveTab('profiles')}>查看文风库</Btn>
              </div>
            )
          )}
        </div>
      </section>

      {drawer && (
        <div className="style-workshop-drawer-layer">
          <button type="button" className="style-workshop-drawer-scrim" aria-label="关闭文风工坊抽屉" onClick={closeDrawer} />
          <aside className="style-workshop-drawer" data-testid="style-workshop-drawer" aria-label={drawer.kind === 'learn' ? '学习新文' : '画像详情'}>
            <header className="style-workshop-drawer-header">
              <div>
                <p className="style-workshop-kicker">{drawer.kind === 'learn' ? '学习新文' : '画像详情'}</p>
                <h2>{drawer.kind === 'learn' ? '生成一份新画像' : profiles.find((profile) => profile.id === drawer.profileId)?.name ?? '文风画像'}</h2>
              </div>
              <Btn size="sm" variant="ghost" icon={X} aria-label="关闭文风工坊抽屉" onClick={closeDrawer} />
            </header>
            {drawer.kind === 'learn' ? renderLearnDrawer(drawer.step) : renderProfileDrawer(profiles.find((profile) => profile.id === drawer.profileId))}
          </aside>
        </div>
      )}
    </div>
  )
}
