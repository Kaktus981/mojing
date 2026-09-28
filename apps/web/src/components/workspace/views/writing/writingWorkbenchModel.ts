export type WritingWorkbenchVisual = {
  title: string
  eyebrow: string
  description: string
  background: 'harbor' | 'paper' | 'mountain'
}

const VISUALS: Record<string, WritingWorkbenchVisual> = {
  'prose-editor': {
    title: '正文工作台',
    eyebrow: '正文创作',
    description: '让章节从写作依据落到一页可持续修改的正文。',
    background: 'harbor'
  },
  'writing-controls': {
    title: '写作控制',
    eyebrow: '正文创作',
    description: '先确认本章的叙事口径，再把注意力交给段落。',
    background: 'mountain'
  },
  'writing-handoff': {
    title: '章后交接',
    eyebrow: '正文创作',
    description: '写完这一章，留下下一次进入时仍然清楚的线索。',
    background: 'paper'
  },
  'rewrite-search': {
    title: '改写与查找',
    eyebrow: '正文创作',
    description: '在当前项目范围内检索、比较并收拢需要回看的句子。',
    background: 'paper'
  }
}

export function resolveWritingWorkbenchVisual(subnavId: string): WritingWorkbenchVisual {
  return VISUALS[subnavId] ?? VISUALS['prose-editor']!
}
