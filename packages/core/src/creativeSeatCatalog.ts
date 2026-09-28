import {
  CreativeCapabilitySchema,
  CreativeSeatSchema,
  type CreativeCapability,
  type CreativeSeat
} from '../../contracts/src/creativeSeats'

export const CREATIVE_SEAT_IDS = {
  worldSteward: 'seat-world-steward',
  storyArchitect: 'seat-story-architect',
  proseCrafter: 'seat-prose-crafter',
  continuityKeeper: 'seat-continuity-keeper',
  memoryCurator: 'seat-memory-curator',
  threadTracker: 'seat-thread-tracker'
} as const

export const CREATIVE_CAPABILITY_IDS = {
  factBoundary: 'capability-fact-boundary',
  worldQuality: 'capability-world-quality',
  outlineStructure: 'capability-outline-structure',
  scenePlanning: 'capability-scene-planning',
  chapterDrafting: 'capability-chapter-drafting',
  continuityEvidence: 'capability-continuity-evidence',
  memoryEvidence: 'capability-memory-evidence',
  foreshadowEvidence: 'capability-foreshadow-evidence',
  chineseClarity: 'capability-chinese-clarity'
} as const

const builtInCapabilities = CreativeCapabilitySchema.array().parse([
  {
    id: CREATIVE_CAPABILITY_IDS.factBoundary,
    name: '事实边界核对',
    description: '依据作者确认的术语边界，识别概念偷换、无依据扩写和锁定事实冲突。',
    taskScopes: ['世界设定', '连续性'],
    contextScopes: ['故事种子', '正式世界观', '世界观候选'],
    permission: '只读分析', enabled: true, source: '内置',
    constraints: ['未知事项只能标记为待作者确认。', '不得把建议直接写入正式世界观。'], taskPreferences: []
  },
  {
    id: CREATIVE_CAPABILITY_IDS.worldQuality,
    name: '世界观质量审校',
    description: '对世界观候选给出可定位的问题报告和最小范围修改建议。',
    // 「中文审校」是横切轴（六个阶段的 `CREATIVE_STAGE_TASK_SCOPES` 都含它），不作为普通任务范围使用：
    // 声明它等于「全栏目通用」。2026-09-18 去掉后，声明范围与本能力的实际阶段装配等价。
    taskScopes: ['世界设定'],
    contextScopes: ['正式世界观', '世界观候选'],
    permission: '生成候选', enabled: true, source: '内置',
    constraints: ['只生成审校报告或修复候选。'], taskPreferences: ['优先解释冲突依据。']
  },
  {
    id: CREATIVE_CAPABILITY_IDS.outlineStructure,
    name: '分层结构规划',
    description: '把故事目标拆成总纲、卷级方向和局部章卡，并保留局部复核边界。',
    taskScopes: ['结构规划'],
    contextScopes: ['故事种子', '正式世界观', '定稿大纲'],
    permission: '生成候选', enabled: true, source: '内置',
    constraints: ['局部候选不得覆盖其他卷章。'], taskPreferences: ['优先生成可检查的小批次规划。']
  },
  {
    id: CREATIVE_CAPABILITY_IDS.scenePlanning,
    name: '剧情步骤规划',
    description: '把一章要发生的事情拆成几个具体步骤，并写清目标、阻力、转折、结果和揭露的信息。',
    taskScopes: ['场景节拍', '结构规划'],
    contextScopes: ['定稿大纲', '正式世界观', '正式记忆', '伏笔证据'],
    permission: '生成候选', enabled: true, source: '内置',
    constraints: ['剧情步骤必须经过作者确认后才可用于整章生成。'], taskPreferences: []
  },
  {
    id: CREATIVE_CAPABILITY_IDS.chapterDrafting,
    name: '逐场景正文起草',
    description: '依据确认的剧情步骤逐场景起草正文，并将完整结果保留为可拒绝候选。',
    taskScopes: ['正文创作'],
    contextScopes: ['正式世界观', '定稿大纲', '章节正文', '正式记忆', '伏笔证据'],
    permission: '生成候选', enabled: true, source: '内置',
    constraints: ['不得静默覆盖作者正文。', '中断时保留已完成场景。'], taskPreferences: []
  },
  {
    id: CREATIVE_CAPABILITY_IDS.continuityEvidence,
    name: '连续性证据检查',
    description: '按来源和生效章节检查人物状态、角色认知、时间顺序与设定一致性。',
    taskScopes: ['连续性'],
    contextScopes: ['正式世界观', '定稿大纲', '章节正文', '正式记忆', '实体出现记录'],
    permission: '只读分析', enabled: true, source: '内置',
    constraints: ['冲突必须提供可定位证据。', '不得提前泄露未来角色认知。'], taskPreferences: []
  },
  {
    id: CREATIVE_CAPABILITY_IDS.memoryEvidence,
    name: '记忆证据整理',
    description: '从章节中提取带段落证据的状态、事实和角色认知变化。',
    taskScopes: ['记忆'],
    contextScopes: ['章节正文', '正式记忆', '实体出现记录'],
    permission: '建立提案', enabled: true, source: '内置',
    constraints: ['提取结果未经作者确认不得进入正式上下文。'], taskPreferences: []
  },
  {
    id: CREATIVE_CAPABILITY_IDS.foreshadowEvidence,
    name: '伏笔证据追踪',
    description: '核对伏笔埋设、推进和回收的章节证据、计划与当前准备度。',
    taskScopes: ['伏笔', '连续性'],
    contextScopes: ['章节正文', '伏笔证据', '正式记忆'],
    permission: '只读分析', enabled: true, source: '内置',
    constraints: ['不得在缺少正文证据时自动标记为已回收。'], taskPreferences: []
  },
  {
    id: CREATIVE_CAPABILITY_IDS.chineseClarity,
    name: '中文表达清晰度',
    description: '检查主谓完整、指代、搭配和术语用法，并给出局部修改建议。',
    // 同上：去掉横切项「中文审校」，只保留它真正对应的任务范围（世界设定 / 正文创作）。
    taskScopes: ['世界设定', '正文创作'],
    contextScopes: ['世界观候选', '章节正文'],
    permission: '生成候选', enabled: true, source: '内置',
    constraints: ['合法的中文共享主语不得机械误报。'], taskPreferences: ['修改建议保持最小范围。']
  }
])

const builtInSeats = CreativeSeatSchema.array().parse([
  {
    id: CREATIVE_SEAT_IDS.worldSteward, name: '设定校准席', phase: '设定阶段', enabled: true, locked: true,
    responsibility: '守护术语边界和世界事实，只输出审校报告或可确认候选。',
    capabilityIds: [CREATIVE_CAPABILITY_IDS.factBoundary, CREATIVE_CAPABILITY_IDS.worldQuality, CREATIVE_CAPABILITY_IDS.chineseClarity],
    allowedActions: ['读取正式资料', '读取候选资料', '生成修改候选', '生成审校报告', '更新运行状态']
  },
  {
    id: CREATIVE_SEAT_IDS.storyArchitect, name: '结构规划席', phase: '规划阶段', enabled: true, locked: true,
    responsibility: '负责分层大纲和每章剧情步骤，只在目标卷章范围内生成规划候选。',
    capabilityIds: [CREATIVE_CAPABILITY_IDS.outlineStructure, CREATIVE_CAPABILITY_IDS.scenePlanning],
    allowedActions: ['读取正式资料', '生成修改候选', '更新运行状态']
  },
  {
    id: CREATIVE_SEAT_IDS.proseCrafter, name: '正文起草席', phase: '写作阶段', enabled: true, locked: true,
    responsibility: '依据确认的剧情步骤逐场景起草正文，保留检查点并等待作者决定。',
    capabilityIds: [CREATIVE_CAPABILITY_IDS.chapterDrafting, CREATIVE_CAPABILITY_IDS.chineseClarity],
    allowedActions: ['读取正式资料', '生成修改候选', '更新运行状态']
  },
  {
    id: CREATIVE_SEAT_IDS.continuityKeeper, name: '连续性审阅席', phase: '复核阶段', enabled: true, locked: true,
    // 职责文案随能力清单一并更新（P-1，2026-09-18）：席位的作者可见职责必须覆盖它实际负责的能力，
    // 否则会出现「文案只讲连续性、装配里却多了伏笔证据追踪」的新不一致。
    responsibility: '检查时间、状态、角色认知和锁定事实冲突，并核对伏笔的埋设、推进与回收是否闭环。',
    // 2026-09-18 · P-1：新增 `伏笔证据追踪`。对**阶段技能装配**而言，该席位只被「审稿与导出」用作默认席位
    // （`DEFAULT_STAGE_SEATS.delivery`）⇒ 装配变化的爆炸半径仅限于 delivery。另有一个**边缘消费者**：
    // `apps/api/src/creativeOrchestration.ts:107` 的席位可用性门也读这份 `capabilityIds`，因此「只启用伏笔证据追踪、
    // 停用其余两项」的项目里，该席位的编排步骤会由「抛错」变为「可执行」——这是放开装配的应有结果，但边界要记住。
    capabilityIds: [CREATIVE_CAPABILITY_IDS.continuityEvidence, CREATIVE_CAPABILITY_IDS.factBoundary, CREATIVE_CAPABILITY_IDS.foreshadowEvidence],
    allowedActions: ['读取正式资料', '读取候选资料', '生成审校报告', '更新运行状态']
  },
  {
    id: CREATIVE_SEAT_IDS.memoryCurator, name: '记忆归档席', phase: '归档阶段', enabled: true, locked: true,
    responsibility: '提取带章节和段落证据的记忆变化，所有结果保持待确认。',
    capabilityIds: [CREATIVE_CAPABILITY_IDS.memoryEvidence],
    allowedActions: ['读取正式资料', '建立记忆提案', '更新运行状态']
  },
  {
    id: CREATIVE_SEAT_IDS.threadTracker, name: '伏笔审阅席', phase: '复核阶段', enabled: true, locked: true,
    responsibility: '追踪伏笔埋设、推进、计划回收和实际回收的证据闭环。',
    capabilityIds: [CREATIVE_CAPABILITY_IDS.foreshadowEvidence],
    allowedActions: ['读取正式资料', '生成审校报告', '更新运行状态']
  }
])

export const BUILT_IN_CREATIVE_CAPABILITIES: readonly CreativeCapability[] = Object.freeze(builtInCapabilities)
export const BUILT_IN_CREATIVE_SEATS: readonly CreativeSeat[] = Object.freeze(builtInSeats)

export function getBuiltInCreativeCapability(id: string): CreativeCapability | undefined {
  return BUILT_IN_CREATIVE_CAPABILITIES.find((item) => item.id === id)
}

export function getBuiltInCreativeSeat(id: string): CreativeSeat | undefined {
  return BUILT_IN_CREATIVE_SEATS.find((item) => item.id === id)
}
