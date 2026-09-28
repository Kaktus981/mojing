import { describe, expect, it } from 'vitest'
import {
  ProsePatchSchema, applyProsePatch, chapterProseDigest, proseBlockDigest, validateProsePatch,
  type ProseBlock, type ProsePatch
} from './novel'

const blocks = (): ProseBlock[] => ([
  { id: 'b1', text: '他在清晨抵达北境。' },
  { id: 'b2', text: '哨塔上没有人。' },
  { id: 'b3', text: '风里带着铁锈味。' }
])

function patch(overrides: Partial<ProsePatch> = {}): ProsePatch {
  const current = blocks()
  return {
    id: 'patch-1', chapterId: 'chapter-1', baseRevision: 4,
    baseChapterDigest: chapterProseDigest(current),
    baseBlockDigests: Object.fromEntries(current.map((block) => [block.id, proseBlockDigest(block)])),
    operations: [{ op: '替换', blockId: 'b2', blocks: [{ id: 'b2n', text: '哨塔上只剩一具空鞍。' }] }],
    reason: '补上线索',
    ...overrides
  } as ProsePatch
}

function target(overrides: Partial<{ chapterId: string; revision: number; blocks: ProseBlock[]; chapterDigest: string }> = {}) {
  const current = overrides.blocks ?? blocks()
  return { chapterId: overrides.chapterId ?? 'chapter-1', revision: overrides.revision ?? 4, chapterDigest: overrides.chapterDigest ?? chapterProseDigest(current), blocks: current }
}

describe('阶段 1.2 安全段落补丁契约', () => {
  it('补丁只由稳定段落 ID 和明确操作组成，不含字符串位置替换', () => {
    expect(ProsePatchSchema.safeParse(patch()).success).toBe(true)
    expect(ProsePatchSchema.safeParse(patch({ operations: [{ op: '插入', anchorBlockId: 'b1', position: '之后', blocks: [{ id: 'x', text: '新段。' }] }] })).success).toBe(true)
    expect(ProsePatchSchema.safeParse(patch({ operations: [{ op: '删除', blockId: 'b3' }] })).success).toBe(true)
    // 位置型替换（按字符偏移）不是合法操作。
    expect(ProsePatchSchema.safeParse(patch({ operations: [{ op: '替换', startOffset: 3, endOffset: 9, text: 'x' } as never] })).success).toBe(false)
    // 未携带生成时正文摘要的补丁不合法。
    expect(ProsePatchSchema.safeParse({ ...patch(), baseChapterDigest: undefined } as never).success).toBe(false)
  })

  it('正文未变化时补丁可应用，且只按段落 ID 生效', () => {
    const check = validateProsePatch(patch(), target())
    expect(check.applicable).toBe(true)
    expect(check.state).toBe('可应用')
    const applied = applyProsePatch(patch(), target())
    expect(applied.ok).toBe(true)
    expect(applied.ok && applied.blocks.map((block) => block.id)).toEqual(['b1', 'b2n', 'b3'])
    expect(applied.ok && applied.blocks[1]?.text).toBe('哨塔上只剩一具空鞍。')
  })

  it('正文整体变化后补丁失效，不做任何替换', () => {
    const changed = target({ blocks: [{ id: 'b1', text: '他在清晨抵达北境。' }, { id: 'b2', text: '哨塔上有人在生火。' }, { id: 'b3', text: '风里带着铁锈味。' }] })
    const check = validateProsePatch(patch(), changed)
    expect(check.applicable).toBe(false)
    expect(check.state).toBe('正文已变化')
    expect(applyProsePatch(patch(), changed).ok).toBe(false)
  })

  it('目标段落在正文中已不存在时报告段落缺失', () => {
    const changed = target({ blocks: [{ id: 'b1', text: '他在清晨抵达北境。' }, { id: 'b3', text: '风里带着铁锈味。' }], chapterDigest: patch().baseChapterDigest })
    const check = validateProsePatch(patch(), changed)
    expect(check.applicable).toBe(false)
    expect(check.state).toBe('段落缺失')
    expect(check.blockers.map((blocker) => blocker.blockId)).toContain('b2')
  })

  it('目标段落被改写但章节摘要未同步时报告段落已变化', () => {
    const patchIgnoringB2 = patch({ baseChapterDigest: 'stale-but-matching' })
    const changed = target({ blocks: [{ id: 'b1', text: '他在清晨抵达北境。' }, { id: 'b2', text: '哨塔上有人在生火。' }, { id: 'b3', text: '风里带着铁锈味。' }] })
    const check = validateProsePatch(patchIgnoringB2, { ...changed, chapterDigest: 'stale-but-matching' })
    expect(check.applicable).toBe(false)
    expect(check.state).toBe('段落已变化')
  })

  it('章节不匹配与重复操作会阻止应用', () => {
    expect(validateProsePatch(patch(), target({ chapterId: 'chapter-2' })).state).toBe('章节不匹配')
    const duplicated = patch({ operations: [{ op: '删除', blockId: 'b2' }, { op: '替换', blockId: 'b2', blocks: [{ id: 'b2n', text: 'x' }] }] })
    const check = validateProsePatch(duplicated, target())
    expect(check.applicable).toBe(false)
    expect(check.state).toBe('顺序冲突')
  })

  it('插入操作按锚点段落落位，锚点缺失时不改写正文', () => {
    const insert = patch({ operations: [{ op: '插入', anchorBlockId: 'b1', position: '之后', blocks: [{ id: 'new-1', text: '补充说明。' }] }] })
    const applied = applyProsePatch(insert, target())
    expect(applied.ok && applied.blocks.map((block) => block.id)).toEqual(['b1', 'new-1', 'b2', 'b3'])
    const missingAnchor = patch({ operations: [{ op: '插入', anchorBlockId: 'zz', position: '之后', blocks: [{ id: 'new-1', text: 'x' }] }] })
    expect(validateProsePatch(missingAnchor, target()).state).toBe('段落缺失')
    expect(applyProsePatch(missingAnchor, target()).ok).toBe(false)
  })

  it('段落摘要稳定：相同内容得到相同摘要，不同内容得到不同摘要', () => {
    expect(proseBlockDigest({ id: 'b1', text: '同一段。' })).toBe(proseBlockDigest({ id: 'b1', text: '同一段。' }))
    expect(proseBlockDigest({ id: 'b1', text: '同一段。' })).not.toBe(proseBlockDigest({ id: 'b2', text: '同一段。' }))
    expect(chapterProseDigest(blocks())).toBe(chapterProseDigest(blocks()))
    expect(chapterProseDigest(blocks())).not.toBe(chapterProseDigest([{ id: 'b1', text: '不同。' }]))
  })
})
