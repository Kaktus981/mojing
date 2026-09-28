import type { StubModelResponder } from './stub-model'

/**
 * 通用引导（Task 8 之后的唯一引导入口）在 E2E 里的**受控模型应答**。
 *
 * 为什么抽成共用模块：中央 `OutlineGuide` 下线后，「引导构建」由右栏承担，
 * 于是 `outline-guide` / `provider-output-limit` / `workspace` 三个已经存在的业务
 * spec 都必须从同一套通用引导契约出题。此前每个 spec 各维护一份桩，
 * 一旦题面或契约变化就会各改各的 —— 这里只描述「返回什么」，端点骨架仍由
 * `stub-model.ts` 提供（**不接任何真实外部模型**）。
 *
 * ⚠️ 桩只验证**链路**：题目文本由桩产出，因此「下一问引用了上一答」这类断言
 * 只能证明「答案确实进了出站上下文并被渲染」，**不**证明真实模型的智能。
 * 真正的业务断言是「出站请求体携带了已确认的前序回答」。
 */

/** 一轮引导的模型产出（`AssistantGuideTurnSchema`）。 */
export function guideTurn(input: {
  id: string
  text: string
  focus: string
  options: string[]
  ready?: boolean
}): Record<string, unknown> {
  const ready = input.ready === true
  return {
    analysisSummary: '已按项目现有内容整理出可逐条核对的观察。',
    strengths: [],
    gaps: [],
    focus: input.focus,
    question: ready
      ? null
      : {
          id: input.id,
          text: input.text,
          whyNow: '先问这个：它最先决定后面的走向。',
          options: input.options.map((label, index) => ({ id: `${input.id}-o${index}`, label, reason: `理由：${label}` })),
          allowCustom: true,
          allowSkip: true
        },
    readyToComplete: ready
  }
}

/** 出站 JSON 里的一条已确认回答（只声明断言真正用到的字段）。 */
export type GuideAnswer = { selectedOptionLabel?: string; customText?: string; skip?: boolean }

/**
 * 从用户消息里取出**前置的 JSON 对象**。
 *
 * 墨境会在 JSON 上下文后面追加「只返回符合 response_format 的 JSON 对象…」这类提示，
 * 所以这里不能整段 `JSON.parse`，只能按大括号配平取出第一段 JSON ——
 * 否则桩读不到 `confirmedAnswers` / `action`，也就无从验证
 * 「下一问建立在上一问的回答上」「出站请求真的带上了前序答案」。
 */
export function parseLeadingJson(text: string): Record<string, unknown> {
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1)) as unknown
          return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
        } catch {
          return {}
        }
      }
    }
  }
  return {}
}

/** 解析一次出站请求体，拿到引导服务交给模型的 `{action, confirmedAnswers, ...}`。 */
export function guideUserOf(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as { messages?: Array<{ role: string; content: string }> }
    const lastUser = [...(parsed.messages ?? [])].reverse().find((item) => item.role === 'user')
    if (!lastUser) return {}
    return parseLeadingJson(lastUser.content)
  } catch {
    return {}
  }
}

/** 一次引导请求的 action（`start` / `answer` / `reanalyze` / `complete`）。 */
export function guideActionOf(body: string): string | undefined {
  const action = guideUserOf(body).action
  return typeof action === 'string' ? action : undefined
}

/** 默认题面：三问，第三问回显上一答，够所有既有业务用例走完一段引导。 */
export const DEFAULT_GUIDE_QUESTIONS: ReadonlyArray<{ id: string; focus: string; text: string; options: string[] }> = [
  { id: 'q-1', focus: '第一幕的冲突落点', text: '主角最先失去的是什么？', options: ['一段记忆', '一个同伴', '一份身份'] },
  { id: 'q-2', focus: '主要阻力', text: '主要阻力来自哪里？', options: ['钟的守护者', '被改写过的同伴', '巡夜人自己的记忆'] },
  { id: 'q-3', focus: '结局方向', text: '这条阻力会把结局推向哪里？', options: ['代价由城市承担', '代价由巡夜人承担', '代价被遗忘'] }
]

/**
 * 造一个「按已确认回答数推进」的引导应答函数。
 *
 * - `start` / `answer` / `reanalyze`：按当前 `confirmedAnswers.length` 出第 n 题；
 *   只要作者已经给过一个带标签的选择，下一题就把这条选择回显出来（链路证据）；
 *   答满 `readyAfter` 题后返回 `readyToComplete`。
 * - `complete`：按既有契约返回候选结果。默认是 `assistant-draft` + `{ initialOutline }`
 *   （大纲领域）；其余四个领域用 `resultKind` / `payload` 显式声明，桩不替它们猜。
 *
 * 这两个值都必须与产品契约一致，桩**不**放宽任何 Schema 校验或候选事务。
 */
export function guideResponder(input: {
  candidate?: unknown
  /** 生成结果时声明的结果类型；缺省按大纲领域处理（`assistant-draft`）。 */
  resultKind?: string
  /** 生成结果时交给适配器的原始 payload；给了它就忽略 `candidate`。 */
  payload?: unknown
  readyAfter?: number
  questions?: ReadonlyArray<{ id: string; focus: string; text: string; options: string[] }>
  /** 回显模板：默认「你已经写下的阻力是「{label}」，…」。 */
  echo?: (label: string) => string
  /** 每轮都在这里记一笔收到的 `action`，方便断言「几步各发了几次」。 */
  onTurn?: (action: string, confirmedAnswerCount: number) => void
}): StubModelResponder {
  const readyAfter = input.readyAfter ?? 3
  const questions = input.questions ?? DEFAULT_GUIDE_QUESTIONS
  const echo = input.echo ?? ((label: string) => `你已经写下的阻力是「${label}」，这条阻力会把结局推向哪里？`)
  return (body) => {
    const user = guideUserOf(body)
    const action = typeof user.action === 'string' ? user.action : ''
    const answerCount = Array.isArray(user.confirmedAnswers) ? (user.confirmedAnswers as GuideAnswer[]).length : 0
    input.onTurn?.(action, answerCount)
    if (user.action === 'complete') {
      return {
        turn: guideTurn({ id: 'q-done', text: '', focus: '关键问题已问完', options: [], ready: true }),
        resultKind: input.resultKind ?? 'assistant-draft',
        payload: input.payload ?? { initialOutline: input.candidate }
      }
    }
    const answers = Array.isArray(user.confirmedAnswers) ? (user.confirmedAnswers as GuideAnswer[]) : []
    if (answers.length >= readyAfter) {
      return guideTurn({ id: `${questions[questions.length - 1]!.id}-done`, text: '', focus: '关键问题已问完', options: [], ready: true })
    }
    if (answers.length === 0) {
      const first = questions[0]!
      return guideTurn({ id: first.id, text: first.text, focus: first.focus, options: first.options })
    }
    const last = [...answers].reverse().find((item) => item && (typeof item.selectedOptionLabel === 'string' || typeof item.customText === 'string'))
    const echoed = last?.selectedOptionLabel ?? last?.customText
    const base = questions[Math.min(answers.length, questions.length - 1)]!
    return guideTurn({
      id: `q-${answers.length + 1}`,
      text: echoed ? echo(echoed) : base.text,
      focus: base.focus,
      options: base.options
    })
  }
}
