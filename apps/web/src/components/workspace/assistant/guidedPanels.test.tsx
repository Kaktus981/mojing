import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuideNoTargetNotice, GuideBusyPanel, GuideWaitingPanel, GuideNeedsReviewPanel } from './GuidedAssistantPanel'
import { GuideQuestionPanel } from './GuideQuestionPanel'
import { GuideResultPanel } from './GuideResultPanel'

/** SSR 会在相邻文本节点间插入注释分隔符；比较文案前先去掉它们。 */
function plain(html: string): string {
  return html.replace(/<!-- -->/g, '')
}

const question = {
  id: 'q1',
  text: '主角最先失去的是什么？',
  whyNow: '这决定第一幕的冲突强度。',
  options: [
    { id: 'a', label: '一段记忆', reason: '直接对应已有的记忆设定' },
    { id: 'b', label: '一个同伴', reason: '更快建立情感张力' },
    { id: 'c', label: '一份身份', reason: '可以牵出后续追查线' }
  ]
}

const analysis = {
  summary: '项目里已经有故事种子和三卷结构。',
  strengths: [{ title: '主角目标明确', evidenceRefs: ['project.seed'] }],
  gaps: [{ key: 'conflict', title: '核心冲突还不具体', impact: '中段推进会缺少抓手', evidenceRefs: ['project.outline'] }]
}

function questionPanel(patch: Partial<Parameters<typeof GuideQuestionPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <GuideQuestionPanel
      focus="第一幕的冲突落点"
      analysis={analysis}
      question={question}
      completedCount={2}
      customAnswer=""
      busy={false}
      selectedOptionId={null}
      onSelectOption={() => undefined}
      onCustomAnswerChange={() => undefined}
      onSubmitOption={() => undefined}
      onSubmitCustom={() => undefined}
      onSkip={() => undefined}
      {...patch}
    />
  )
}

describe('引导提问面板', () => {
  const html = questionPanel()
  const text = plain(html)

  it('展示可核验的分析观察、当前焦点、单个问题与 whyNow', () => {
    expect(text).toContain('项目里已经有故事种子和三卷结构。')
    expect(text).toContain('主角目标明确')
    expect(text).toContain('核心冲突还不具体')
    expect(text).toContain('第一幕的冲突落点')
    expect(text).toContain(question.text)
    expect(text).toContain(question.whyNow)
  })

  it('选项是 3–5 个单选项，每项带理由', () => {
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3)
    expect((html.match(/name="guide-option-q1"/g) ?? []).length).toBe(3)
    for (const option of question.options) {
      expect(text).toContain(option.label)
      expect(text).toContain(option.reason)
    }
  })

  it('选中态由 checked 表达，未选中时不能重复提交', () => {
    expect(html).not.toMatch(/<input[^>]*checked[^>]*value="b"/)
    expect(html).toMatch(/data-testid="guide-submit-option"[^>]*disabled/)

    const selected = questionPanel({ selectedOptionId: 'b' })
    expect(selected).toMatch(/<input[^>]*checked[^>]*value="b"/)
    expect(selected).not.toMatch(/data-testid="guide-submit-option"[^>]*disabled/)
  })

  it('自定义回答与跳过入口都在，且展示真实已完成题数', () => {
    expect(html).toContain('data-testid="guide-custom-input"')
    expect(html).toContain('data-testid="guide-submit-custom"')
    expect(html).toContain('data-testid="guide-skip"')
    expect(text).toContain('已确认 2 个回答')
  })

  it('正文进度用独立的 testid，不与共享头部重复', () => {
    expect(html).toContain('data-testid="guide-progress-body"')
    expect(html).not.toContain('data-testid="guide-progress"')
  })

  it('忙碌时禁止重复提交，但不清空作者已经写下的自定义回答', () => {
    const busy = questionPanel({ busy: true, customAnswer: '作者写了一半的回答' })
    expect(plain(busy)).toContain('作者写了一半的回答')
    expect(busy).toMatch(/data-testid="guide-skip"[^>]*disabled/)
    expect(busy).toMatch(/data-testid="guide-submit-custom"[^>]*disabled/)
    expect((busy.match(/type="radio"[^>]*disabled/g) ?? []).length).toBe(3)
  })

  it('引导态不混入普通聊天、快捷提示、准备度面板、历史候选或通用输入框', () => {
    for (const forbidden of ['mojing-dock-input', 'mjp-dock-quick', '创作准备', '历史候选', '本次使用', 'mjp-msg']) {
      expect(html).not.toContain(forbidden)
    }
  })
})

describe('进度中会话的恢复入口（禁止永久转圈）', () => {
  it('存量「分析中」会话给出可点的重试入口', () => {
    const html = renderToStaticMarkup(
      <GuideBusyPanel
        phase="analyzing"
        retry={{ available: true, label: '重试分析' }}
        busy={false}
        onRetry={() => undefined}
      />
    )
    expect(html).toContain('正在分析你的项目')
    expect(html).toContain('data-testid="guide-retry-busy"')
    expect(plain(html)).toContain('重试分析')
  })

  it('存量「生成中」会话给出「重试生成」入口', () => {
    const html = renderToStaticMarkup(
      <GuideBusyPanel
        phase="generating"
        retry={{ available: true, label: '重试生成' }}
        busy={false}
        onRetry={() => undefined}
      />
    )
    expect(html).toContain('正在整理这次引导的结果')
    expect(plain(html)).toContain('重试生成')
  })

  it('真实请求在途（retry 不可用）时不渲染重试入口，避免重复提交', () => {
    const html = renderToStaticMarkup(
      <GuideBusyPanel phase="analyzing" retry={{ available: false, label: '' }} busy onRetry={() => undefined} />
    )
    expect(html).not.toContain('data-testid="guide-retry-busy"')
  })
})

describe('等待态文案 —— 出错时不自相矛盾', () => {
  it('没有错误时说「这段引导还没有开始」', () => {
    const html = renderToStaticMarkup(
      <GuideWaitingPanel hasError={false} busy={false} onStart={() => undefined} />
    )
    expect(plain(html)).toContain('这段引导还没有开始')
    expect(plain(html)).toContain('先读取当前项目，再回答第一个关键问题')
    expect(plain(html)).not.toContain('我会')
    expect(html).toContain('data-testid="guide-start"')
  })

  it('current 读取失败时如实说「还没有读到进度」，不再同时宣称「还没有开始」', () => {
    const html = renderToStaticMarkup(
      <GuideWaitingPanel hasError busy={false} onStart={() => undefined} />
    )
    const text = plain(html)
    expect(text).toContain('还没有读到这段引导的进度')
    expect(text).not.toContain('这段引导还没有开始')
    expect(text).toContain('已经确认过的回答不会丢')
  })

  it('出错时「开始引导」按钮仍在，且不新增第二个按钮（不提供重新读取入口）', () => {
    const html = renderToStaticMarkup(
      <GuideWaitingPanel hasError busy onStart={() => undefined} />
    )
    expect(html).toContain('data-testid="guide-start"')
    expect((html.match(/<button /g) ?? []).length).toBe(1)
  })
})

describe('引导结果面板', () => {
  it('只展示结果引用并导航到既有页面，不提供第二套采用', () => {
    const html = renderToStaticMarkup(
      <GuideResultPanel
        resultRef={{ kind: 'world-setting-proposal', proposalId: 'proposal-1234567890' }}
        completedCount={4}
        onNavigate={() => undefined}
        onSwitchToFree={() => undefined}
      />
    )
    const text = plain(html)
    expect(text).toContain('已确认 4 个回答')
    expect(text).toContain('去扩展世界观')
    expect(text).toContain('不代表已经采用')
    expect(text).toContain('不等于允许导出')
    expect((html.match(/<button /g) ?? []).length).toBe(1)
  })

  it('助手草稿结果回到自由创作的候选面板', () => {
    const html = renderToStaticMarkup(
      <GuideResultPanel
        resultRef={{ kind: 'assistant-draft', draftId: 'draft-1234567890' }}
        completedCount={1}
        onNavigate={() => undefined}
        onSwitchToFree={() => undefined}
      />
    )
    expect(plain(html)).toContain('去候选草稿')
  })
})

describe('需要复核面板 —— 原因表述准确，不含内部术语', () => {
  const html = renderToStaticMarkup(<GuideNeedsReviewPanel busy={false} onReanalyze={() => undefined} />)
  const text = plain(html)

  it('整句逐字锁定：原因用「项目内容或引导规则」并列，且仍然要求重新分析后继续', () => {
    // 逐字断言而不是碎片断言：否则任何「含 引导规则 + 含 已经确认的回答会保留」
    // 的等价改写都能让断言全绿，文案被悄悄改回窄因果也发现不了。
    expect(text).toContain('项目内容或引导规则已变化，需要重新分析后继续。已经确认的回答会保留。')
  })

  it('把三种真实原因都说进去，不能只说是项目内容变了', () => {
    expect(text).toContain('引导规则')
  })

  it('不再宣称「项目内容变过了」这个不准确的确定因果', () => {
    expect(text).not.toContain('项目内容变过了')
  })

  it('保留「已经确认的回答会保留」，避免影响既有断言', () => {
    expect(text).toContain('已经确认的回答会保留')
  })

  it('DOM 结构与 testid 不变：单按钮、带重新分析入口', () => {
    expect(html).toContain('data-testid="guide-needs-review"')
    expect(html).toContain('data-testid="guide-reanalyze"')
    expect((html.match(/<button /g) ?? []).length).toBe(1)
  })

  it('忙碌时禁止重复提交重新分析', () => {
    const busyHtml = renderToStaticMarkup(<GuideNeedsReviewPanel busy onReanalyze={() => undefined} />)
    expect(busyHtml).toMatch(/data-testid="guide-reanalyze"[^>]*disabled/)
  })

  it('不出现任何内部术语或失败原因代码', () => {
    for (const forbidden of [
      'digest',
      'adapterVersion',
      'context',
      'schema',
      'projection',
      'API',
      '端点',
      '接口',
      '契约',
      '未实现',
      '未接通'
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })
})

describe('没有可引导目标的页面', () => {
  it('如实说明本页没有可引导目标，并给出既有导航落点', () => {
    const html = renderToStaticMarkup(<GuideNoTargetNotice onSwitchToFree={() => undefined} onNavigate={() => undefined} />)
    const text = plain(html)
    expect(text).toContain('没有可以引导的具体目标')
    expect(text).toContain('去章节规划')
    expect(text).toContain('切到自由创作')
  })
})
