import type { NovelProject } from '../../../../../../../packages/contracts/src'
import { countChapterWords, countProjectWords } from '../../paragraphModel'
import type { WorkspaceNavigationTarget } from '../../workspaceNavigation'

export type ProjectWorkbenchAction = {
  id: 'continue-writing' | 'outline' | 'world' | 'planning'
  label: string
  detail: string
  target?: WorkspaceNavigationTarget
}

export type ProjectWorkbenchModel = {
  title: string
  description?: string
  genre: string
  status: NovelProject['status']
  wordCount: number
  targetWords: number
  wordProgress?: number
  chapterCount: number
  plannedChapters: number
  chapterProgress?: number
  currentChapter?: {
    id: string
    number: number
    title: string
    status: string
    wordCount: number
    preview: string
  }
  currentChapterSource: '已选章节' | '最新章节' | '尚无章节'
  missing: { description: boolean; outline: boolean; world: boolean; currentChapter: boolean }
  primaryAction: ProjectWorkbenchAction
  indexActions: ProjectWorkbenchAction[]
}

function compactText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function previewChapter(chapter: NovelProject['chapters'][number]): string {
  const text = compactText(chapter.blocks.map((block) => block.text).join(' '))
  return text.length > 180 ? `${Array.from(text).slice(0, 180).join('')}…` : text
}

function progress(value: number, target: number): number | undefined {
  if (target <= 0) return undefined
  return Math.min(100, Math.round((value / target) * 100))
}

export function buildProjectWorkbenchModel(project: NovelProject, selectedChapterId?: string): ProjectWorkbenchModel {
  const wordCount = countProjectWords(project.chapters)
  const targetWords = project.settings.targetWords
  const selected = selectedChapterId ? project.chapters.find((chapter) => chapter.id === selectedChapterId) : undefined
  const latest = [...project.chapters].sort((a, b) => b.chapterNumber - a.chapterNumber)[0]
  const current = selected ?? latest
  const currentChapterSource = selected ? '已选章节' : current ? '最新章节' : '尚无章节'
  const description = compactText(project.outline?.synopsis || project.seed)
  const hasOutline = Boolean(project.outline)
  const hasWorld = Boolean(project.worldBible)
  const hasChapter = Boolean(current)
  let primaryAction: ProjectWorkbenchAction

  if (current) {
    primaryAction = { id: 'continue-writing', label: '继续写作', detail: `打开第 ${current.chapterNumber} 章正文`, target: { stageId: 'writing', subnavId: 'prose-editor', focusId: current.id } }
  } else if (hasOutline) {
    primaryAction = { id: 'planning', label: '从章节规划开始', detail: '先选择一章，再进入正文', target: { stageId: 'outline', subnavId: 'chapter-directory' } }
  } else {
    primaryAction = { id: 'outline', label: '建立故事起点', detail: '先记录种子、方向和创作规格', target: { stageId: 'idea', subnavId: 'story-seed' } }
  }

  const indexActions: ProjectWorkbenchAction[] = []
  if (hasOutline) {
    if (primaryAction.id !== 'outline') {
      indexActions.push({ id: 'outline', label: '查看小说大纲', detail: '回到总纲与卷章结构', target: { stageId: 'outline', subnavId: 'outline-foundation' } })
    }
  }
  indexActions.push({
    id: 'world',
    label: hasWorld ? '查看世界观' : '建立世界观',
    detail: hasWorld ? '核对规则、词条与时间线' : '世界设定还没有建立',
    target: { stageId: 'world', subnavId: 'world-overview' }
  })
  if (hasOutline && primaryAction.id !== 'planning') {
    indexActions.push({ id: 'planning', label: '章节规划', detail: '选择下一章并整理写作顺序', target: { stageId: 'outline', subnavId: 'chapter-directory' } })
  }

  return {
    title: project.title,
    description: description || undefined,
    genre: project.settings.genreTemplate,
    status: project.status,
    wordCount,
    targetWords,
    wordProgress: progress(wordCount, targetWords),
    chapterCount: project.chapters.length,
    plannedChapters: project.settings.plannedChapters,
    chapterProgress: progress(project.chapters.length, project.settings.plannedChapters),
    currentChapter: current ? {
      id: current.id,
      number: current.chapterNumber,
      title: current.title,
      status: current.status,
      wordCount: countChapterWords(current.blocks),
      preview: previewChapter(current)
    } : undefined,
    currentChapterSource,
    missing: { description: !description, outline: !hasOutline, world: !hasWorld, currentChapter: !hasChapter },
    primaryAction,
    indexActions
  }
}

export function workbenchCoverKind(genre: NovelProject['settings']['genreTemplate']): 'mountain' | 'harbor' | 'city' {
  if (['悬疑', '历史架空'].includes(genre)) return 'harbor'
  if (['都市', '科幻'].includes(genre)) return 'city'
  return 'mountain'
}
