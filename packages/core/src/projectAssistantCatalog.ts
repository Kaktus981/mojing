import { createHash } from 'node:crypto'
import {
  ProjectCreativeAssistantSchema, type CreativeChatStage, type NovelGenerationKind,
  type NovelProject, type ProjectAssistantModeContent, type ProjectCreativeAssistant
} from '../../contracts/src'

interface AssistantBlueprint {
  name: string
  role: string
  welcome: (title: string) => string
  focusAreas: string[]
  modes: Record<'灵感讨论' | '问题分析' | '生成准备', ProjectAssistantModeContent>
  allowedGenerationKinds: NovelGenerationKind[]
}

const BLUEPRINTS: Record<CreativeChatStage, AssistantBlueprint> = {
  idea: {
    name: '故事方向顾问', role: '只服务当前小说的创作起点与规格',
    welcome: (title) => `我是《${title}》的故事方向顾问。我会先帮助你澄清主角欲望、核心冲突、题材气质和创作边界，再把成熟想法交给后续规划。`,
    focusAreas: ['主角欲望与代价', '核心冲突与独特限制', '题材气质与读者期待'],
    modes: {
      灵感讨论: { title: '打开故事的可能性', description: '围绕题材、人物欲望和核心冲突自由推演，不急着确定唯一答案。', prompts: ['给我三个不落俗套的冲突方向', '帮我明确主角最想得到什么', '从这个故事种子延伸三种题材方向'], placeholder: '描述你卡住的灵感，或想继续探索的方向……' },
      问题分析: { title: '找出故事种子的薄弱处', description: '检查概念是否模糊、人物动机是否成立，以及创作边界是否互相矛盾。', prompts: ['检查故事种子里有没有模糊概念', '分析主角动机是否足以支撑长篇', '找出当前创作规格里的矛盾'], placeholder: '说明你担心的问题，我会结合故事种子逐项分析……' },
      生成准备: { title: '把想法整理成可生成任务', description: '先明确目标、范围和不可违反的边界，再准备世界观或术语候选。', prompts: ['整理生成世界观前必须确认的事项', '把故事种子整理成世界观生成要求', '准备一份核心术语提取要求'], placeholder: '说明想生成什么，以及必须保留或禁止改动的内容……' }
    },
    allowedGenerationKinds: ['story-direction', 'writing-specs', 'world-constraint-extraction', 'world-foundation']
  },
  world: {
    name: '世界构筑顾问', role: '只服务当前小说的规则、实体与历史设定',
    welcome: (title) => `我是《${title}》的世界构筑顾问。我会围绕已确认的术语边界，协助你完善规则、人物、势力、地点、体系和时间线，未知事项不会被擅自写成事实。`,
    focusAreas: ['规则如何影响日常生活', '力量、制度与资源的制约', '地域、历史与文化差异'],
    modes: {
      灵感讨论: { title: '探索世界如何真实运转', description: '从制度、日常生活、力量代价和地域差异推演新的原创可能。', prompts: ['从日常生活角度完善这个世界', '设计三种会改变社会结构的规则', '推演一个设定会带来哪些连锁影响'], placeholder: '描述想扩展的设定方向，或希望这个世界呈现的感觉……' },
      问题分析: { title: '核对设定是否自洽', description: '检查术语边界、规则冲突、主体缺失和未经确认的推断。', prompts: ['检查世界规则是否互相冲突', '找出可能被误当成资源的先天设定', '分析国家与力量体系是否互相支撑'], placeholder: '指出需要核对的设定，我会说明冲突位置和判断依据……' },
      生成准备: { title: '准备局部世界观候选', description: '先确定目标模块和作者边界，生成时只创建待确认候选。', prompts: ['准备补充力量体系的生成要求', '整理一个新角色词条的必填信息', '准备世界观局部补全任务'], placeholder: '说明要生成的世界观模块、目标和不能改变的事实……' }
    },
    allowedGenerationKinds: ['world-section', 'world-foundation', 'world-audit']
  },
  outline: {
    name: '长篇结构顾问', role: '只服务当前小说的总纲、卷章与剧情步骤',
    welcome: (title) => `我是《${title}》的长篇结构顾问。我会依据本项目已经确认的世界观和人物资料，与你讨论总纲、卷级目标、章卡因果和伏笔节奏；确认后才会生成局部大纲候选。`,
    focusAreas: ['卷级目标、转折与结果', '人物选择推动的因果链', '伏笔埋设、推进与回收'],
    modes: {
      灵感讨论: { title: '推演剧情结构的多种走向', description: '讨论主线、卷章转折和剧情步骤，保留多个可比较方向。', prompts: ['给这一卷设计三个中点转折', '推演主角失败后的不同走向', '为当前主线增加一条互相影响的副线'], placeholder: '描述想探索的剧情位置、人物选择或转折方向……' },
      问题分析: { title: '检查大纲哪里失去推动力', description: '分析目标、冲突、转折、信息揭露和伏笔安排是否形成因果链。', prompts: ['找出当前大纲最松散的位置', '检查人物目标是否真正推动剧情', '分析各章是否存在重复功能'], placeholder: '说明你觉得松散或不合理的位置，我会按因果关系分析……' },
      生成准备: { title: '整理局部大纲任务', description: '明确目标卷或章节，只生成该范围的待确认候选。', prompts: ['准备生成下一卷章纲的要求', '整理当前章剧情步骤生成要求', '把转折方向整理成大纲修改任务'], placeholder: '说明目标卷或章节、预期转折和必须保留的安排……' }
    },
    allowedGenerationKinds: ['outline-foundation', 'outline-volume', 'scene-beats']
  },
  writing: {
    name: '章节共创编辑', role: '只服务当前选中章节的构思与文字修改',
    welcome: (title) => `我是《${title}》的章节共创编辑。我只会围绕当前选中章节、已确认剧情步骤和人物在当时掌握的信息进行讨论，任何生成或改稿都先形成候选。`,
    focusAreas: ['人物在当前信息下的反应', '场景目标、阻力与情绪变化', '对白、动作与感官细节'],
    modes: {
      灵感讨论: { title: '推演当前章节的下一步', description: '围绕当前章的人物反应、场景选择和情绪张力探索不同写法。', prompts: ['推演当前章下一步的三种走向', '设计一个更有张力的人物选择', '给当前场景三个不同的结束方式'], placeholder: '描述当前章卡住的位置，或想尝试的情绪和走向……' },
      问题分析: { title: '定位正文为什么不够成立', description: '结合当前章纲、人物状态和前文证据，检查逻辑与中文表达。', prompts: ['检查人物反应是否符合性格', '分析这一段为什么缺少张力', '找出当前章中指代或主语不清的位置'], placeholder: '描述有问题的内容，我会先分析原因再建议……' },
      生成准备: { title: '准备正文候选', description: '明确修改范围、目标效果和保护内容，再生成整章或局部改稿候选。', prompts: ['提出一个最小范围的改写方案', '整理续写当前章的明确要求', '准备按剧情步骤生成本章的任务'], placeholder: '说明生成或改写范围、期望效果，以及绝对不能改变的内容……' }
    },
    allowedGenerationKinds: ['chapter', 'chapter-revision', 'scene-beats']
  },
  memory: {
    name: '记忆伏笔管理员', role: '只服务当前小说的事实、认知与伏笔证据',
    welcome: (title) => `我是《${title}》的记忆伏笔管理员。我会区分客观事实和角色认知，核对生效章节与原文证据，并协助规划伏笔推进和回收；未经确认的提案不会进入正式记忆。`,
    focusAreas: ['客观事实与角色认知差', '伏笔证据与回收准备度', '状态的生效与失效章节'],
    modes: {
      灵感讨论: { title: '寻找记忆与伏笔的后续可能', description: '讨论角色认知差、伏笔推进方式和回收时机，不把猜测写成正式事实。', prompts: ['哪些伏笔适合在近期推进', '设计三种不突兀的伏笔回收方式', '利用角色认知差制造一个转折'], placeholder: '说明想推进的角色记忆或伏笔，我会推演可选方向……' },
      问题分析: { title: '核对事实、角色认知和证据', description: '检查人物现在知道什么、事实从何时生效，以及是否存在前后矛盾。', prompts: ['总结当前角色状态和依据', '检查有没有未来信息提前泄露', '找出缺少章节证据的记忆'], placeholder: '提出需要核对的角色、事实或伏笔，我会给出来源依据……' },
      生成准备: { title: '准备记忆或伏笔审查', description: '明确目标章节和审查重点，结果仍只进入待确认提案。', prompts: ['准备分析当前章节记忆', '整理一次伏笔回收审查要求', '准备全书连续性检查重点'], placeholder: '说明要分析的章节、角色或伏笔范围，以及关注重点……' }
    },
    allowedGenerationKinds: ['memory-extraction', 'memory-rebuild', 'continuity-audit', 'foreshadow-review']
  },
  delivery: {
    name: '成稿审读顾问', role: '只服务当前小说的连续性、质量与导出前复核',
    welcome: (title) => `我是《${title}》的成稿审读顾问。我会依据本项目的正文、正式记忆、伏笔和规划证据排列问题优先级，只提供可定位的报告与修改候选。`,
    focusAreas: ['读者体验与主题呼应', '连续性、人物弧光与中文质量', '问题优先级与最小修改范围'],
    modes: {
      灵感讨论: { title: '讨论成稿还可以怎样提升', description: '从读者体验、结尾余味和主题呼应寻找优化方向。', prompts: ['给结尾设计三种不同余味', '如何让主题在结尾自然呼应', '从读者体验看还有哪些提升空间'], placeholder: '描述你希望成稿带给读者的最终感受……' },
      问题分析: { title: '确定最值得优先修正的问题', description: '检查连续性、人物变化、伏笔闭环和中文表达，并提供定位依据。', prompts: ['列出最值得优先处理的三个问题', '检查结尾是否回收核心承诺', '分析人物弧光是否存在无理由跳变'], placeholder: '说明审稿范围或担心的问题，我会按严重程度分析……' },
      生成准备: { title: '整理可执行的审稿任务', description: '明确审查范围、判断标准和输出形式，再生成审稿报告或修改候选。', prompts: ['给我一份本轮审稿顺序', '准备一次全书连续性审查', '整理伏笔闭环审查要求'], placeholder: '说明要审查的范围、优先级和希望得到的结果……' }
    },
    allowedGenerationKinds: ['continuity-audit', 'foreshadow-review']
  }
}

export function projectAssistantId(projectId: string, stage: CreativeChatStage): string {
  return `project-assistant-${createHash('sha256').update(`${projectId}:${stage}`).digest('hex').slice(0, 16)}`
}

export function buildProjectAssistants(project: NovelProject, conversationCounts: Partial<Record<CreativeChatStage, number>> = {}): ProjectCreativeAssistant[] {
  return (Object.keys(BLUEPRINTS) as CreativeChatStage[]).map((stage) => {
    const blueprint = BLUEPRINTS[stage]
    return ProjectCreativeAssistantSchema.parse({
      id: projectAssistantId(project.id, stage), projectId: project.id, stage,
      name: blueprint.name, role: blueprint.role, welcome: blueprint.welcome(project.title),
      focusAreas: blueprint.focusAreas, modes: blueprint.modes,
      allowedGenerationKinds: blueprint.allowedGenerationKinds,
      conversationCount: conversationCounts[stage] ?? 0
    })
  })
}

export function getProjectAssistant(project: NovelProject, stage: CreativeChatStage, conversationCount = 0): ProjectCreativeAssistant {
  return buildProjectAssistants(project, { [stage]: conversationCount }).find((assistant) => assistant.stage === stage)!
}
