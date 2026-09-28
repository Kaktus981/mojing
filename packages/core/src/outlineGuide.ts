import {
  type GuideAnswer, type GuideAnswerState, type GuideQuestion, type GuideReadiness, type GuideSession,
  type GuideSlot, type InitialOutlineCandidate, type NovelProject
} from '../../contracts/src'
import type { NovelDatabaseService } from './novelDatabase'
import { saveAssistantDraft } from './assistantCandidates'

/**
 * 大纲引导（D1/D2，P04 起缺口顺序与方向由当前故事推导）。
 *
 * 四条硬规则：
 *  1. **只有故事想法是进入引导的硬条件**；主角、核心矛盾、结局方向允许「不确定」或「暂时跳过」。
 *  2. **一次只问一个当前最影响结构的缺口**，每题给 3–5 个方向、推荐理由与「为什么先问它」，
 *     并永远允许自己填写/跳过。缺口顺序不是固定模板：故事种子里已经出现的信号会把它提前。
 *  3. **AI 给的选项在被点击前不是事实**；只有明确写进 `answers` 的回答才算已知。
 *  4. 方向与理由由故事种子、已有正式信息、作者已回答内容推导，**不依赖模型**：
 *     没有配置模型时引导照样能用，只是不会出现「必须调用 AI 才能继续」的死路。
 */

export const GUIDE_SLOTS: readonly GuideSlot[] = ['protagonist', 'coreConflict', 'endingDirection']

const SLOT_LABEL: Record<GuideSlot, string> = { protagonist: '主角与目标', coreConflict: '主要阻力', endingDirection: '结局方向' }
const SLOT_QUESTION: Record<GuideSlot, string> = {
  protagonist: '谁是这个故事的主角，他/她最想要的是什么？',
  coreConflict: '阻挡主角的最大阻力是什么？',
  endingDirection: '你希望故事大致走向什么样的结局？'
}

function fail(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }

const now = (): string => new Date().toISOString()

/** 项目里已经有的内容视为已知，不重复索取（D2「已有项目内容作为已知」）。 */
export function existingAnswers(project: NovelProject): GuideAnswer[] {
  const answers: GuideAnswer[] = []
  const characters = (project.worldBible?.entries ?? []).filter((entry) => entry.type === '角色')
  if (characters.length > 0) {
    answers.push({
      slot: 'protagonist', state: '已回答', source: '来自项目', updatedAt: now(),
      value: characters.slice(0, 2).map((entry) => entry.name).join('、')
    })
  }
  if (project.outline?.mainConflict?.trim()) {
    answers.push({ slot: 'coreConflict', state: '已回答', source: '来自项目', updatedAt: now(), value: project.outline.mainConflict.trim() })
  }
  if (project.outline?.endingDirection?.trim()) {
    answers.push({ slot: 'endingDirection', state: '已回答', source: '来自项目', updatedAt: now(), value: project.outline.endingDirection.trim() })
  }
  return answers
}

export function getGuideSession(database: NovelDatabaseService, projectId: string): GuideSession | undefined {
  return database.listGuideSessions(projectId)[0]
}

export function ensureGuideSession(database: NovelDatabaseService, project: NovelProject): GuideSession {
  if (!project.seed.trim()) throw fail('GUIDE_SEED_REQUIRED', '先写下最初的故事想法，再开始引导。')
  return database.saveGuideSession(database.getGuideSession(project.id) ?? {
    id: `guide-${project.id}`, projectId: project.id, answers: [], askedSlots: [],
    status: '进行中', createdAt: now(), updatedAt: now()
  })
}

/** 合并会话回答与项目既有内容；后写的回答优先。 */
export function effectiveAnswers(project: NovelProject, session: GuideSession | undefined): GuideAnswer[] {
  const bySllot = new Map<GuideSlot, GuideAnswer>()
  for (const answer of existingAnswers(project)) bySllot.set(answer.slot, answer)
  for (const answer of session?.answers ?? []) bySllot.set(answer.slot, answer)
  return [...bySllot.values()]
}

export function guideReadiness(project: NovelProject, session: GuideSession | undefined): GuideReadiness {
  const answers = effectiveAnswers(project, session)
  const usable = answers.filter((answer) => answer.state === '已回答' && answer.value.trim())
  const answered = usable.map((answer) => answer.slot)
  const missing = GUIDE_SLOTS.filter((slot) => !answered.includes(slot))
  const hasSeed = Boolean(project.seed.trim())
  const confirmedCount = answered.length
  const canGenerate = hasSeed && confirmedCount >= 2
  const pending = [
    ...(hasSeed ? [] : ['故事想法']),
    ...answers.filter((answer) => answer.state !== '已回答').map((answer) => SLOT_LABEL[answer.slot]),
    ...missing.filter((slot) => !answers.some((answer) => answer.slot === slot)).map((slot) => SLOT_LABEL[slot])
  ]
  const reason = !hasSeed
    ? '还没有故事想法，先写下它再开始引导。'
    : canGenerate
      ? `已经有 ${confirmedCount} 项可用信息，可以生成初步大纲候选。`
      : `还差 ${Math.max(0, 2 - confirmedCount)} 项可用信息就能生成初步大纲候选；也可以直接手动生成，缺的项会标为待确认。`
  // 「已知」清单只收录作者写的、作者选的、项目里已有的；AI 给的方向在点击前不在其中。
  const known = usable.map((answer) => ({
    slot: answer.slot, label: SLOT_LABEL[answer.slot], value: answer.value.trim().slice(0, 200),
    source: answer.source, state: answer.state
  }))
  return { hasSeed, answered, missing, canGenerate, reason, pending: [...new Set(pending)], focus: storyFocus(project.seed), known }
}

/* ------------------------------ 当前故事上下文（P04） ------------------------------ */

/**
 * 三项的基础权重＝结构依赖深度：主角决定视角、人物表与每章落点；阻力决定卷目标与章的冲突；
 * 结局方向只影响长线收束。没有额外信号时，就按这个顺序问。
 */
const SLOT_BASE_WEIGHT: Record<GuideSlot, number> = { protagonist: 40, coreConflict: 30, endingDirection: 20 }

/** 故事想法里已经出现的对抗信号：阻力还没正式定下来时，把它抬到最前。 */
const CONFLICT_HINTS = ['阻止', '阻挡', '阻挠', '对抗', '追杀', '争夺', '敌人', '对手', '危机', '威胁', '必须', '不得不', '代价', '复仇', '背叛', '抢', '夺']
/** 故事想法里已经出现的收束信号。 */
const ENDING_HINTS = ['结局', '最后', '终于', '救赎', '牺牲', '离开', '留下', '再也不', '大团圆', '收尾', '最终', '告别', '回来']
/** 动作词：焦点通常是「谁做了什么之后剩下的那件事」。 */
const FOCUS_ACTION_VERBS = ['发现', '寻找', '追查', '调查', '守护', '阻止', '对抗', '遇上', '遇见', '来到', '改变', '失去', '得到', '卷入', '揭开', '唤醒', '找回', '拯救', '逃离', '夺回', '写下', '获得']
/** 状态/时间标记：焦点到它为止。 */
const FOCUS_STOP_MARKERS = ['正在', '已经', '将要', '可以', '会', '被', '把', '让', '使']

function short(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * 从故事种子里提炼一个短焦点，用来生成贴合当前故事的方向。
 *
 * 种子是作者的一句话，直接塞进模板会得到「主角想弄清<整句话>的真相」这种读不通的标签；
 * 这里先取第一个短句，再去掉动作词之前的主体、砍掉状态标记之后的部分，得到一个可复用的短语。
 */
export function storyFocus(seed: string): string {
  const clause = seed.split(/[，。；、！？!?：:\n]/).map((item) => item.trim()).find((item) => item.length >= 2) ?? seed.trim()
  let core = clause
  const verbs = FOCUS_ACTION_VERBS
    .map((item) => ({ item, index: clause.indexOf(item) }))
    .filter((found) => found.index >= 1)
    .sort((left, right) => left.index - right.index)
  const first = verbs[0]
  if (first) {
    const rest = clause.slice(first.index + first.item.length).replace(/^[了的地得]/, '').trim()
    if (rest.length >= 2) core = rest
  }
  const stops = FOCUS_STOP_MARKERS
    .map((item) => core.indexOf(item))
    .filter((index) => index >= 2)
    .sort((left, right) => left - right)
  if (stops.length) core = core.slice(0, stops[0]!)
  core = core.replace(/^[了的地得，、]+/, '').replace(/[，、]+$/, '').trim()
  if (core.length < 2) return '这个故事'
  return core.length > 16 ? `${core.slice(0, 16)}…` : core
}

function answeredValue(answers: GuideAnswer[], slot: GuideSlot): string {
  const answer = answers.find((item) => item.slot === slot && item.state === '已回答' && item.value.trim())
  return answer?.value.trim() ?? ''
}

/** 已经被定下来的主角叫什么；作者写的优先，其次是世界观里已有的角色。 */
function protagonistName(project: NovelProject, answers: GuideAnswer[]): string {
  const answered = answers.find((item) => item.slot === 'protagonist' && item.state === '已回答' && item.value.trim())
  if (answered) return answered.value.split(/[、,，]/)[0]!.trim()
  const character = (project.worldBible?.entries ?? []).find((entry) => entry.type === '角色' && entry.name.trim())
  return character?.name.trim() ?? '主角'
}

interface PrioritizedGap { slot: GuideSlot; whyThisFirst: string }

/** 按「对结构的影响」给还没定下来的缺口排序，并给出对作者说得清的理由。 */
function prioritizedGaps(project: NovelProject, session: GuideSession | undefined): PrioritizedGap[] {
  const answers = effectiveAnswers(project, session)
  const settled = new Set(answers.map((answer) => answer.slot))
  const open = GUIDE_SLOTS.filter((slot) => !settled.has(slot))
  if (!open.length) return []
  const conflictHit = CONFLICT_HINTS.find((word) => project.seed.includes(word))
  const endingHit = ENDING_HINTS.find((word) => project.seed.includes(word))
  const who = short(protagonistName(project, answers), 20)
  const protagonistSettled = answers.some((answer) => answer.slot === 'protagonist' && answer.state === '已回答' && answer.value.trim())
  const conflictSettled = answers.some((answer) => answer.slot === 'coreConflict' && answer.state === '已回答' && answer.value.trim())

  const scored = open.map((slot) => {
    let score = SLOT_BASE_WEIGHT[slot]
    const reasons: string[] = []
    if (slot === 'protagonist') {
      reasons.push('主角还没定下来，视角、人物表和每一章的落点都悬着；先定它，后面的方向才有参照。')
    }
    if (slot === 'coreConflict') {
      if (conflictHit) {
        score += 40
        reasons.push(`故事想法里已经出现了对抗信号（「${conflictHit}」），先把最大阻力定下来，卷目标与章的冲突才有落点。`)
      }
      if (protagonistSettled) {
        score += 15
        reasons.push(`主角已经定在「${who}」，缺的是压在他/她身上的阻力。`)
      }
      if (!reasons.length) reasons.push('阻力决定卷目标与每章的对撞点；它不定下来，后面的结构只能空转。')
    }
    if (slot === 'endingDirection') {
      if (endingHit) {
        score += 35
        reasons.push(`故事想法里点到了收束（「${endingHit}」），先定结局方向，前面各卷要付出多少代价才好分配。`)
      }
      if (conflictSettled) {
        score += 15
        reasons.push('阻力已经写下来了，接着要确定它怎么收场。')
      }
      if (!reasons.length) reasons.push('结局方向决定各卷的代价怎么分摊；早一点定下来可以少返工。')
    }
    return { slot, score, whyThisFirst: reasons.join(' ') }
  })
  // 同分时按固定顺序，保证同一个项目每次给出同样的建议。
  scored.sort((left, right) => right.score - left.score || GUIDE_SLOTS.indexOf(left.slot) - GUIDE_SLOTS.indexOf(right.slot))
  return scored.map((item) => ({ slot: item.slot, whyThisFirst: item.whyThisFirst }))
}

function buildQuestionText(project: NovelProject, slot: GuideSlot, answers: GuideAnswer[]): string {
  const who = protagonistName(project, answers)
  const conflict = answeredValue(answers, 'coreConflict')
  if (slot === 'coreConflict' && answeredValue(answers, 'protagonist')) {
    return `主角已经定在「${short(who, 20)}」，阻挡他/她达成目标的最大阻力是什么？`
  }
  if (slot === 'endingDirection' && conflict) {
    return `「${short(conflict, 24)}」这条阻力，最后会怎么收场？`
  }
  return SLOT_QUESTION[slot]
}

/** 当前该问的缺口；缺口顺序由当前故事决定，三个都有答案时返回 null（不强制逐题闯关）。 */
export function nextGuideQuestion(project: NovelProject, session: GuideSession | undefined): GuideQuestion | null {
  const answers = effectiveAnswers(project, session)
  const [next] = prioritizedGaps(project, session)
  if (!next) return null
  return {
    slot: next.slot,
    question: buildQuestionText(project, next.slot, answers),
    whyThisFirst: next.whyThisFirst,
    options: buildOptions(project, next.slot, answers),
    allowSkip: true
  }
}

/**
 * 方向候选从当前故事推导：故事焦点、题材、已经定下来的主角/阻力/结局、已有角色。
 * 作者已经确认过的东西必须真的出现在方向或理由里，否则「贴合当前故事」只是说法。
 */
function buildOptions(project: NovelProject, slot: GuideSlot, answers: GuideAnswer[]): GuideQuestion['options'] {
  const focus = storyFocus(project.seed)
  const brief = short(focus, 16)
  const genre = project.settings.genreTemplate
  const who = protagonistName(project, answers)
  const conflict = answeredValue(answers, 'coreConflict')
  const ending = answeredValue(answers, 'endingDirection')
  const options: GuideQuestion['options'] = []

  if (slot === 'protagonist') {
    options.push(
      { label: `${who}想弄清${focus}的真相`, reason: `把悬念挂在人物动机上；「${brief}」这条线索可以直接铺进第一章。` },
      { label: `${who}只想保住现在的生活，却被${focus}卷进来`, reason: '被动卷入的主角，阻力天然更强；先写日常再打破，读者更容易代入。' },
      { label: `${who}主动追查${focus}，并为此长期付出代价`, reason: `主动型主角适合${genre}的长线成长，代价可以分摊到各卷。` },
      { label: `双线：${who}与对手围绕${focus}各有目的`, reason: '适合多视角；前期铺垫更多，但中期冲突更密。' }
    )
    if (ending) {
      options.push({
        label: `为了走到「${short(ending, 18)}」，${who}必须先拿下${focus}`,
        reason: `你已经写下的结局方向是「${short(ending, 24)}」，这条动机会顺着它收束。`
      })
    }
    return options
  }

  if (slot === 'coreConflict') {
    options.push(
      { label: `${focus}本身有代价，每次使用都在失去什么`, reason: `把阻力内化成设定；${who}每推进一次，代价就跟着涨一档。` },
      { label: `一个具体的人或组织在阻止${who}`, reason: `对手明确，${who}的每一步都能落到具体的人身上，不靠气氛撑。` },
      { label: `${who}身边的人与他的目标相冲突`, reason: '关系型阻力；代价落在关系上，适合情感线重的写法。' },
      { label: `时间与信息不对称：${who}知道得太少、太晚`, reason: '适合悬疑推进；但要给读者留一条能自己推断的线。' }
    )
    if (ending) {
      options.push({
        label: `越靠近「${short(ending, 18)}」，${who}要付的代价越大`,
        reason: `你已经写下的结局方向是「${short(ending, 24)}」，这条阻力能直接把它顶到高潮。`
      })
    }
    return options
  }

  options.push(
    { label: `${who}达成目标，但失去与${focus}相连的某样东西`, reason: `苦甜结局；把「${brief}」的代价留到最后一章结清。` },
    { label: '达成目标且代价可控，留下继续写下去的空间', reason: '爽感更足，适合长篇连载；注意别让代价显得廉价。' },
    { label: `没有完全达成，但${who}完成了内在转变`, reason: '偏文学向；需要足够的人物铺垫，前期要早点写转变的苗头。' },
    { label: '开放式：关键选择留给读者判断', reason: '讨论度高；但要避免显得没写完。' }
  )
  if (conflict) {
    options.push({
      label: `在「${short(conflict, 18)}」上赢下来，但赢的方式改变了他自己`,
      reason: `你已经写下的阻力是「${short(conflict, 24)}」，这条结局会把它的代价留下来。`
    })
  }
  return options
}

/** 记录作者的一次明确回答（或明确的「不确定 / 跳过」）。 */
export function answerGuideSlot(input: {
  database: NovelDatabaseService
  project: NovelProject
  slot: GuideSlot
  state: GuideAnswerState
  value?: string
  source?: '作者填写' | '作者选择'
}): GuideSession {
  const session = ensureGuideSession(input.database, input.project)
  if (input.state === '已回答' && !(input.value ?? '').trim()) {
    throw fail('GUIDE_ANSWER_REQUIRED', '选择或填写一个内容后再记录；也可以选「不确定」或「暂时跳过」。')
  }
  const answers = session.answers.filter((item) => item.slot !== input.slot)
  answers.push({
    slot: input.slot, state: input.state, value: (input.value ?? '').trim(),
    source: input.source ?? '作者填写', updatedAt: now()
  })
  return input.database.saveGuideSession({
    ...session,
    answers,
    askedSlots: session.askedSlots.includes(input.slot) ? session.askedSlots : [...session.askedSlots, input.slot],
    updatedAt: now()
  })
}

/**
 * 把初纲候选映射成草稿变更。
 *
 * 只写既有字段：总纲/主冲突/结局方向、卷目标、故事线。
 * **不生成章节网格、不写正文、不建世界词条、不建伏笔**（D2）。
 * 缺的项进 `pending`，由候选面板显示，不会被悄悄定案。
 */
export function initialOutlineChanges(input: {
  project: NovelProject
  candidate: InitialOutlineCandidate
}): { changes: ReturnType<typeof buildChanges> } {
  return { changes: buildChanges(input.project, input.candidate) }
}

function buildChanges(project: NovelProject, candidate: InitialOutlineCandidate) {
  const outline = project.outline
  return [
    {
      kind: 'outline' as const,
      synopsis: candidate.core,
      mainConflict: candidate.skeleton.转折 || outline?.mainConflict || '',
      endingDirection: candidate.skeleton.结局 || outline?.endingDirection || ''
    },
    ...candidate.volumes.map((volume) => ({
      kind: 'volume' as const,
      volume: {
        id: outline?.volumes.find((item) => item.volumeNumber === volume.volumeNumber)?.id ?? `v${volume.volumeNumber}-${project.id}`,
        volumeNumber: volume.volumeNumber, title: volume.title, goal: volume.goal,
        climax: '', resolution: '',
        chapters: outline?.volumes.find((item) => item.volumeNumber === volume.volumeNumber)?.chapters ?? []
      }
    })),
    ...candidate.storylines.map((line, index) => ({
      kind: 'storyline' as const,
      storyline: {
        id: (project.storylines ?? []).find((item) => item.title === line.title)?.id ?? `line-${index + 1}-${project.id}`,
        title: line.title, type: '主线', whyNecessary: line.why,
        openingState: '', finalGoal: '', endCondition: '', characterIds: [], entryIds: [], relatedPlotThreadIds: [],
        keyNodes: [], chapterPlans: [], currentProgress: 0, costPaid: '', unresolvedQuestions: [], nextAction: '',
        status: '未开始' as const, evidenceChain: [], updatedAt: now()
      }
    }))
  ]
}

/** 生成初纲草稿：只落草稿，采用仍走 P03 的预览与确认。 */
export function saveInitialOutlineDraft(input: {
  database: NovelDatabaseService
  project: NovelProject
  candidate: InitialOutlineCandidate
  session?: GuideSession
  sourceDigest: string
  updateLegacySession?: boolean
}): { draftId: string; pending: string[] } {
  const { changes } = initialOutlineChanges(input)
  const result = saveAssistantDraft({
    database: input.database, project: input.project,
    target: { kind: 'story-core', projectId: input.project.id },
    taskType: '初纲生成', stage: 'outline',
    // 初纲会同时触及总纲、卷与故事线：作为**一个依赖组**整体确认，不允许拆散。
    dependencyGroups: changes.length ? [{ id: 'initial-outline', label: '初步大纲（总纲 + 卷目标 + 故事线）', changeIndexes: changes.map((_, index) => index) }] : [],
    changes: changes as never,
    sourceDigest: input.sourceDigest,
    summary: `初步大纲候选：${input.candidate.core.slice(0, 40)}`
  })
  if (input.session && input.updateLegacySession !== false) {
    input.database.saveGuideSession({ ...input.session, status: '已生成', updatedAt: now() })
  }
  return { draftId: result.draft.id, pending: input.candidate.pending }
}
