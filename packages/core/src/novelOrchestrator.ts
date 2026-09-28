import { randomUUID } from 'node:crypto'
import type { NovelOrchestrationPlan, NovelOrchestrationPlanRequest, NovelOrchestrationStep } from '../../contracts/src/novelApi'
import type { NovelProject } from '../../contracts/src/novel'

/**
 * 墨境自己的确定性编排预演器。它只把作者目标翻译成可解释步骤，
 * 不调用模型、不写入项目，也不自动应用任何候选。
 */
export function buildNovelOrchestrationPlan(project: NovelProject, request: NovelOrchestrationPlanRequest): NovelOrchestrationPlan {
  const steps: NovelOrchestrationStep[] = []
  const warnings: string[] = []
  const now = new Date().toISOString()
  const chapter = request.chapterId ? project.chapters.find((item) => item.id === request.chapterId) : undefined
  const chapterPlan = chapter ? project.outline?.volumes.flatMap((volume) => volume.chapters).find((item) => item.id === chapter.id || item.chapterNumber === chapter.chapterNumber) : undefined
  const add = (role: string, title: string, kind: NovelOrchestrationStep['kind'], status: NovelOrchestrationStep['status'], reason: string, evidence: string[], dependsOn: string[] = [], targetId?: string): void => {
    const id = `step-${steps.length + 1}`
    steps.push({ id, role, title, kind, targetId, dependsOn, status, reason, evidence, estimatedTokens: estimateFor(kind, project) })
  }

  if (request.intent === '章节创作') {
    if (!project.worldBible || project.worldBible.status !== '定稿') warnings.push('世界观尚未定稿；编排可以预演，但正文步骤会继承设定漂移风险。')
    if (!project.outline || project.outline.status !== '定稿') warnings.push('小说大纲尚未定稿；请在启动正文前确认总纲和章纲。')
    if (!chapter) warnings.push('没有找到指定章节，当前计划只能作为预览。')
    const beatsReady = chapterPlan?.beatStatus === '已确认' && Boolean(chapterPlan.beats.length)
    const beatId = `step-${steps.length + 1}`
    add('结构规划席', '核对本章剧情步骤', 'scene-beats', beatsReady ? '已满足' : '可执行', beatsReady ? '本章已有确认的剧情步骤，跳过重复生成。' : '正文生成前先把章节目标拆成可检查的具体步骤。', chapter ? [`第 ${chapter.chapterNumber} 章：${chapter.title}`] : [], [], chapter?.id)
    add('正文起草席', '按确认的剧情步骤生成章节候选', 'chapter', beatsReady ? '需要作者确认' : '等待前置', beatsReady ? '将逐场景生成一个可拒绝的章节候选，不覆盖人工正文。' : '需要先确认本章剧情步骤。', chapter ? [`第 ${chapter.chapterNumber} 章正文`, '只读纳入生效记忆'] : [], beatsReady ? [] : [beatId], chapter?.id)
    const chapterStep = `step-${steps.length}`
    add('记忆归档席', '提取章节记忆提案', 'memory-extraction', '等待前置', '正文候选完成后再提取事实、状态和角色认知，仍需人工确认。', ['来源：本章正文段落'], [chapterStep], chapter?.id)
    add('连续性审阅席', '检查前后文连续性', 'continuity-audit', '等待前置', '只报告冲突与证据，不直接改写正文。', ['来源：世界观、记忆、相邻章节'], [chapterStep], chapter?.id)
  } else if (request.intent === '长篇复核') {
    add('记忆归档席', '重建长篇记忆索引', 'memory-rebuild', '可执行', '按章节重新核对客观事实与角色认知，结果进入待确认提案。', ['来源：全部已保存章节', '按章节水位线过滤未来信息'])
    add('连续性审阅席', '运行长篇连续性审查', 'continuity-audit', '可执行', '检查人物状态、时间顺序、设定冲突和信息提前泄露。', ['来源：大纲、章节摘要、正式记忆'])
    add('伏笔审阅席', '核对伏笔回收闭环', 'foreshadow-review', '可执行', '检查埋设证据、推进记录、计划回收章和实际回收证据。', ['来源：伏笔台账与章节证据'])
  } else if (request.intent === '世界观审校') {
    add('设定校准席', '审校当前世界观候选', 'world-audit', '需要作者确认', '只有待处理的世界观候选才能进入审校；正式世界观不会被直接改写。', ['来源：世界观候选、已确认术语边界'])
    warnings.push('如果当前没有世界观候选，请先生成或编辑候选，再执行审校。')
  } else {
    if (!project.worldBible) warnings.push('世界观尚未建立，大纲规划暂时只能停留在预演阶段。')
    add('结构规划席', '生成总纲与卷级方向', 'outline-foundation', project.outline ? '需要作者确认' : '可执行', project.outline ? '已有大纲，生成结果会作为候选供比较。' : '先确定主题、主冲突、结局方向和卷级目标。', ['来源：故事种子与世界观'])
    const volume = project.outline?.volumes.find((item) => item.volumeNumber === request.volumeNumber)
    add('结构规划席', `生成第 ${request.volumeNumber} 卷章纲`, 'outline-volume', volume?.chapters.length ? '需要作者确认' : '等待前置', '本卷候选只合并目标卷，不覆盖其他卷章。', [`目标：第 ${request.volumeNumber} 卷`, '每批最多十章'], ['step-1'], volume?.id)
  }

  return { id: randomUUID(), projectId: project.id, intent: request.intent, baseRevision: project.revision, localOnly: true, policy: { maxParallel: request.maxParallel, requireHumanGate: true, autoApply: false }, steps, warnings, createdAt: now }
}

function estimateFor(kind: NovelOrchestrationStep['kind'], project: NovelProject): number {
  const words = project.chapters.reduce((sum, chapter) => sum + chapter.blocks.reduce((inner, block) => inner + block.text.length, 0), 0)
  return kind === 'memory-rebuild' || kind === 'continuity-audit' ? Math.min(12_000, 1_200 + words) : kind === 'chapter' ? 3_000 : 1_000
}
