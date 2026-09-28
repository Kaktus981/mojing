import { createHash, randomUUID } from 'node:crypto'
import {
  ChapterOutlineSchema, NovelOutlineSchema, OutlineStructureEditRequestSchema, OutlineStructureImpactSchema,
  type ChapterOutline, type NovelOutline, type NovelProject, type OutlineStructureEditRequest, type OutlineStructureImpact, type VolumeOutline
} from '../../contracts/src'

/**
 * 规划摘要只包含会影响下游创作的作者内容。展开状态、更新时间、剧情步骤
 * 和复核状态等派生字段不能参与摘要，否则会产生没有意义的过期提醒。
 */
export function volumePlanDigest(volume: Pick<VolumeOutline, 'title' | 'goal' | 'climax' | 'resolution'>): string {
  return digest({
    title: normalize(volume.title),
    goal: normalize(volume.goal),
    climax: normalize(volume.climax),
    resolution: normalize(volume.resolution)
  })
}

export function chapterOutlineDigest(chapter: Pick<ChapterOutline, 'title' | 'storyTime' | 'narrativeMode' | 'pov' | 'objective' | 'conflict' | 'turningPoint' | 'reveal' | 'endingHook' | 'characterIds' | 'setupThreadIds' | 'payoffThreadIds'>): string {
  return digest({
    title: normalize(chapter.title),
    storyTime: normalize(chapter.storyTime ?? ''),
    narrativeMode: chapter.narrativeMode ?? '顺叙',
    pov: normalize(chapter.pov),
    objective: normalize(chapter.objective),
    conflict: normalize(chapter.conflict),
    turningPoint: normalize(chapter.turningPoint),
    reveal: normalize(chapter.reveal),
    endingHook: normalize(chapter.endingHook),
    characterIds: stableList(chapter.characterIds),
    setupThreadIds: stableList(chapter.setupThreadIds),
    payoffThreadIds: stableList(chapter.payoffThreadIds)
  })
}

export function chapterPlanStaleness(volume: VolumeOutline, chapter: ChapterOutline): { volumeChanged: boolean; outlineChanged: boolean } {
  return {
    // 旧项目没有摘要时先把当前内容视为基线，避免升级后出现虚假警告。
    volumeChanged: Boolean(chapter.sourceVolumeDigest && chapter.sourceVolumeDigest !== volumePlanDigest(volume)),
    outlineChanged: Boolean(chapter.beatSourceOutlineDigest && chapter.beatSourceOutlineDigest !== chapterOutlineDigest(chapter))
  }
}

export function withPlanningDigests(volume: VolumeOutline, chapter: ChapterOutline): ChapterOutline {
  return {
    ...chapter,
    sourceVolumeDigest: volumePlanDigest(volume),
    beatSourceOutlineDigest: chapter.beats.length ? chapterOutlineDigest(chapter) : chapter.beatSourceOutlineDigest
  }
}

/** 为旧项目补齐当前规划基线；只补缺失值，不覆盖已有依赖摘要。 */
export function establishPlanningDigestBaseline(project: NovelProject): NovelProject {
  if (!project.outline) return project
  for (const volume of project.outline.volumes) {
    for (const chapter of volume.chapters) {
      chapter.sourceVolumeDigest ??= volumePlanDigest(volume)
      if (chapter.beats.length) chapter.beatSourceOutlineDigest ??= chapterOutlineDigest(chapter)
    }
  }
  return project
}

export interface OutlineStructurePreview {
  candidate: NovelOutline
  impact: OutlineStructureImpact
}

/**
 * 生成大纲结构调整候选与中文影响摘要。这个纯规划函数不会修改传入项目，
 * 也不会改写已有正文、记忆、伏笔或版本；正式写入必须继续走候选应用接口。
 */
export function previewOutlineStructureEdit(
  project: NovelProject,
  raw: OutlineStructureEditRequest,
  options: { now?: string; createId?: () => string } = {}
): OutlineStructurePreview {
  const input = OutlineStructureEditRequestSchema.parse(raw)
  if (!project.outline) throw outlineEditError('OUTLINE_REQUIRED', '请先建立小说大纲，再调整章纲结构。')
  if (project.revision !== input.baseRevision) throw outlineEditError('REVISION_CONFLICT', `项目版本已变化：请求基于版本 ${input.baseRevision}，当前为版本 ${project.revision}。`)

  const now = options.now ?? new Date().toISOString()
  const createId = options.createId ?? randomUUID
  const candidate = NovelOutlineSchema.parse(structuredClone(project.outline))
  sortOutline(candidate)
  const original = snapshotLocations(candidate)
  const explicitlyAffected = new Set<string>()
  const changes: string[] = []
  const warnings: string[] = []
  /** 被退休的身份 → 接管身份；应用候选时按它改写正文与全部关联。 */
  const identityMerges: Array<{ kind: '章纲' | '正文'; from: string; to: string; joinBlocks?: boolean }> = []
  /** 拆分/合并时原正文归属的中文说明。 */
  let bodyHandling: string | undefined

  if (input.operation === '插入章节') {
    const anchor = input.relativeChapterId ? locateChapter(candidate, input.relativeChapterId) : undefined
    const targetVolumeNumber = anchor?.volume.volumeNumber ?? input.targetVolumeNumber!
    const targetVolume = candidate.volumes.find((volume) => volume.volumeNumber === targetVolumeNumber)
    if (!targetVolume) throw outlineEditError('OUTLINE_VOLUME_NOT_FOUND', `找不到第 ${targetVolumeNumber} 卷。`)
    const insertIndex = anchor ? anchor.chapterIndex + (input.position === '之后' ? 1 : 0) : targetVolume.chapters.length
    const draft = input.chapterDraft ?? {}
    const chapter = ChapterOutlineSchema.parse({
      id: createId(), volumeNumber: targetVolume.volumeNumber, chapterNumber: 1, title: draft.title?.trim() || '未命名新章',
      storyTime: draft.storyTime, narrativeMode: draft.narrativeMode, pov: draft.pov ?? '', objective: draft.objective ?? '', conflict: draft.conflict ?? '',
      turningPoint: draft.turningPoint ?? '', reveal: draft.reveal ?? '', endingHook: draft.endingHook ?? '',
      characterIds: unique(draft.characterIds ?? []), setupThreadIds: unique(draft.setupThreadIds ?? []), payoffThreadIds: unique(draft.payoffThreadIds ?? []),
      beats: [], status: '未规划', beatStatus: '未生成', downstreamReviewStatus: '待复核', downstreamReviewReason: '新插入章节尚未完善规划', beatFindings: []
    })
    targetVolume.chapters.splice(insertIndex, 0, chapter)
    explicitlyAffected.add(chapter.id)
    changes.push(`在第 ${targetVolume.volumeNumber} 卷${anchor ? `“${anchor.chapter.title}”${input.position}` : '末尾'}插入“${chapter.title}”。`)
  } else if (input.operation === '删除章节') {
    const located = requireChapter(candidate, input.chapterId!)
    explicitlyAffected.add(located.chapter.id)
    located.volume.chapters.splice(located.chapterIndex, 1)
    changes.push(`从当前大纲中移除第 ${located.chapter.chapterNumber} 章“${located.chapter.title}”；历史正文和证据不会被删除。`)
  } else if (input.operation === '调序') {
    const source = requireChapter(candidate, input.chapterId!)
    const relative = requireChapter(candidate, input.relativeChapterId!)
    if (source.volume.id !== relative.volume.id) throw outlineEditError('OUTLINE_CROSS_VOLUME_REORDER', '跨卷调整请使用“跨卷移动”，避免误改卷级结构。')
    if (source.chapter.id === relative.chapter.id) throw outlineEditError('OUTLINE_SAME_CHAPTER', '目标章节和参照章节不能相同。')
    const chapter = source.volume.chapters.splice(source.chapterIndex, 1)[0]!
    const relativeIndex = source.volume.chapters.findIndex((item) => item.id === relative.chapter.id)
    source.volume.chapters.splice(relativeIndex + (input.position === '之后' ? 1 : 0), 0, chapter)
    explicitlyAffected.add(chapter.id); explicitlyAffected.add(relative.chapter.id)
    changes.push(`把“${chapter.title}”移动到“${relative.chapter.title}”${input.position}，只改变阅读顺序。`)
    warnings.push('故事发生时间保持原值；如改成倒叙、插叙或回忆，请在章纲中另行确认。')
  } else if (input.operation === '跨卷移动') {
    const source = requireChapter(candidate, input.chapterId!)
    const targetVolume = candidate.volumes.find((volume) => volume.volumeNumber === input.targetVolumeNumber)
    if (!targetVolume) throw outlineEditError('OUTLINE_VOLUME_NOT_FOUND', `找不到第 ${input.targetVolumeNumber} 卷。`)
    if (targetVolume.id === source.volume.id) throw outlineEditError('OUTLINE_SAME_VOLUME', '目标卷与当前卷相同；同卷内请使用“调序”，避免产生无意义的结构候选。')
    const relative = input.relativeChapterId ? requireChapter(candidate, input.relativeChapterId) : undefined
    if (relative && relative.volume.id !== targetVolume.id) throw outlineEditError('OUTLINE_INVALID_ANCHOR', '参照章节不在目标卷中。')
    const chapter = source.volume.chapters.splice(source.chapterIndex, 1)[0]!
    chapter.volumeNumber = targetVolume.volumeNumber
    const relativeIndex = relative ? targetVolume.chapters.findIndex((item) => item.id === relative.chapter.id) : targetVolume.chapters.length
    targetVolume.chapters.splice(relative ? relativeIndex + (input.position === '之后' ? 1 : 0) : relativeIndex, 0, chapter)
    explicitlyAffected.add(chapter.id); if (relative) explicitlyAffected.add(relative.chapter.id)
    changes.push(`把“${chapter.title}”从第 ${source.volume.volumeNumber} 卷移动到第 ${targetVolume.volumeNumber} 卷。`)
    warnings.push('故事发生时间保持原值；卷级目标、前后承接和角色认知需要重新核对。')
  } else if (input.operation === '拆分章节') {
    const source = requireChapter(candidate, input.chapterId!)
    const split = input.splitAfterBeat!
    if (source.chapter.beats.length < 2 || split >= source.chapter.beats.length) throw outlineEditError('OUTLINE_SPLIT_POSITION_INVALID', '拆章至少需要两个剧情步骤，拆分位置必须位于两个步骤之间。')
    /**
     * 原章纲的稳定身份必须留给其中一张结果章纲，且由作者选择留给哪一张。
     * 两张都用新身份会让原正文、章节记忆、伏笔证据与事件线关联同时失去宿主，
     * 最后只能把正文挪到末尾或变成「没有对应章纲」，那不是结构一致。
     */
    const bodySide = input.splitBodySide ?? '前半'
    const firstKeepsIdentity = bodySide === '前半'
    const first = ChapterOutlineSchema.parse({
      ...source.chapter, id: firstKeepsIdentity ? source.chapter.id : createId(),
      title: input.title?.trim() || `${source.chapter.title}（上）`,
      beats: renumberBeats(source.chapter.beats.slice(0, split)), status: '已规划', beatStatus: '待确认',
      downstreamReviewStatus: '待复核', downstreamReviewReason: '原章已拆分，需要确认前半章目标与结尾'
    })
    const second = ChapterOutlineSchema.parse({
      ...source.chapter, id: firstKeepsIdentity ? createId() : source.chapter.id,
      title: `${source.chapter.title}（下）`,
      beats: renumberBeats(source.chapter.beats.slice(split)), status: '已规划', beatStatus: '待确认',
      downstreamReviewStatus: '待复核', downstreamReviewReason: '原章已拆分，需要确认后半章目标与承接'
    })
    source.volume.chapters.splice(source.chapterIndex, 1, first, second)
    explicitlyAffected.add(source.chapter.id); explicitlyAffected.add(first.id); explicitlyAffected.add(second.id)
    const existingBody = project.chapters.find((chapter) => chapter.id === source.chapter.id || chapter.chapterNumber === source.chapter.chapterNumber)
    bodyHandling = existingBody
      ? `原第 ${source.chapter.chapterNumber} 章正文（${existingBody.blocks.length} 段）归属「${bodySide}」；另一张结果章纲是全新身份，还没有正文，需要继续写。`
      : `原第 ${source.chapter.chapterNumber} 章没有正文；拆分后两张结果章纲都从「还没有正文」开始。`
    changes.push(`把第 ${source.chapter.chapterNumber} 章“${source.chapter.title}”按剧情步骤拆成「前半 / 后半」两张章纲；原章纲稳定身份保留给「${bodySide}」。`)
    if (existingBody) warnings.push(bodyHandling)
  } else if (input.operation === '合并章节') {
    const firstLocated = requireChapter(candidate, input.chapterId!)
    const secondLocated = requireChapter(candidate, input.otherChapterId!)
    if (firstLocated.volume.id !== secondLocated.volume.id) throw outlineEditError('OUTLINE_CROSS_VOLUME_MERGE', '只能合并同一卷内相邻的两章。')
    const indices = [firstLocated.chapterIndex, secondLocated.chapterIndex].sort((a, b) => a - b)
    if (indices[1]! - indices[0]! !== 1) throw outlineEditError('OUTLINE_NON_ADJACENT_MERGE', '只能合并阅读顺序相邻的两章。')
    const earlier = firstLocated.volume.chapters[indices[0]!]!, later = firstLocated.volume.chapters[indices[1]!]!
    /**
     * 合并会消掉后章的身份，所以两份正文如何保留必须由作者明确选择。
     * 未选择时直接拒绝，不代替作者决定「拼接」或把后章正文变成没有对应章纲的记录。
     */
    const earlierBody = project.chapters.find((chapter) => chapter.id === earlier.id || chapter.chapterNumber === earlier.chapterNumber)
    const laterBody = project.chapters.find((chapter) => chapter.id === later.id || chapter.chapterNumber === later.chapterNumber)
    const mergeStrategy = input.mergeBodyStrategy
    if (laterBody && !mergeStrategy) {
      throw outlineEditError(
        'OUTLINE_MERGE_BODY_DECISION_REQUIRED',
        `第 ${later.chapterNumber} 章“${later.title}”已有正文，合并会消掉它的章纲身份。请先明确两份正文如何保留：把后章段落并入合并后的同一份正文，或把后章正文保留为没有对应章纲的记录。`
      )
    }
    if (mergeStrategy === '拼接' && laterBody && earlierBody && laterBody.id === earlierBody.id) {
      throw outlineEditError('OUTLINE_MERGE_BODY_CONFLICT', '两章指向同一份正文，无法拼接；请先修正数据后重试。')
    }
    const merged = ChapterOutlineSchema.parse({
      ...earlier, id: earlier.id, title: input.title?.trim() || `${earlier.title} / ${later.title}`,
      storyTime: combine(earlier.storyTime ?? '', later.storyTime ?? ''), narrativeMode: earlier.narrativeMode === later.narrativeMode ? earlier.narrativeMode : '插叙',
      pov: combine(earlier.pov, later.pov), objective: combine(earlier.objective, later.objective), conflict: combine(earlier.conflict, later.conflict),
      turningPoint: combine(earlier.turningPoint, later.turningPoint), reveal: combine(earlier.reveal, later.reveal), endingHook: later.endingHook || earlier.endingHook,
      characterIds: unique([...earlier.characterIds, ...later.characterIds]), setupThreadIds: unique([...earlier.setupThreadIds, ...later.setupThreadIds]), payoffThreadIds: unique([...earlier.payoffThreadIds, ...later.payoffThreadIds]),
      beats: renumberBeats([...earlier.beats, ...later.beats]), status: '已规划', beatStatus: '待确认',
      downstreamReviewStatus: '待复核', downstreamReviewReason: '两章已合并，需要确认篇幅、转折与证据位置'
    })
    firstLocated.volume.chapters.splice(indices[0]!, 2, merged)
    explicitlyAffected.add(earlier.id); explicitlyAffected.add(later.id); explicitlyAffected.add(merged.id)
    // 后章纲身份被退休，它的关联全部改挂到合并后的章纲身份上，避免悬空引用。
    identityMerges.push({ kind: '章纲', from: later.id, to: merged.id })
    if (laterBody && mergeStrategy === '拼接') {
      if (earlierBody) {
        identityMerges.push({ kind: '正文', from: laterBody.id, to: earlierBody.id, joinBlocks: true })
        bodyHandling = `合并后只有一份正文：先写「${earlier.title}」的 ${earlierBody.blocks.length} 段，再按顺序接上「${later.title}」的 ${laterBody.blocks.length} 段（段落本身不改写、身份保持）。`
      } else {
        identityMerges.push({ kind: '正文', from: laterBody.id, to: merged.id })
        bodyHandling = `合并后只有一份正文：沿用「${later.title}」已有的 ${laterBody.blocks.length} 段（段落本身不改写、身份保持）。`
      }
    } else if (laterBody && mergeStrategy === '保留为无章纲') {
      bodyHandling = `「${later.title}」的 ${laterBody.blocks.length} 段正文将保留为没有对应章纲的记录，会出现在「有正文没有对应章纲」列表里，需要你之后自行处理。`
    } else if (earlierBody) {
      bodyHandling = `合并后沿用「${earlier.title}」已有的 ${earlierBody.blocks.length} 段正文；「${later.title}」没有正文。`
    } else {
      bodyHandling = '两章都还没有正文，合并后从空白正文开始。'
    }
    changes.push(`把相邻的“${earlier.title}”和“${later.title}”合并成章纲“${merged.title}”；合并后沿用「${earlier.title}」的章纲身份。`)
    warnings.push(bodyHandling)
  } else if (input.operation === '卷排序') {
    const sourceNumber = input.volumeNumber!
    const relativeNumber = input.relativeVolumeNumber!
    const source = candidate.volumes.find((volume) => volume.volumeNumber === sourceNumber)
    const relative = candidate.volumes.find((volume) => volume.volumeNumber === relativeNumber)
    if (!source) throw outlineEditError('OUTLINE_VOLUME_NOT_FOUND', `找不到第 ${sourceNumber} 卷。`)
    if (!relative) throw outlineEditError('OUTLINE_VOLUME_NOT_FOUND', `找不到参照的第 ${relativeNumber} 卷。`)
    if (source.id === relative.id) throw outlineEditError('OUTLINE_SAME_VOLUME', '被移动的卷与参照卷不能是同一卷。')

    const volumeIndex = candidate.volumes.indexOf(source)
    candidate.volumes.splice(volumeIndex, 1)
    const relativeIndex = candidate.volumes.findIndex((volume) => volume.id === relative.id)
    candidate.volumes.splice(relativeIndex + (input.position === '之后' ? 1 : 0), 0, source)
    // 卷号按新的阅读顺序重排；renumberOutline 会按卷号排序，所以必须先落定卷号。
    candidate.volumes.forEach((volume, position) => { volume.volumeNumber = position + 1 })
    for (const chapter of source.chapters) explicitlyAffected.add(chapter.id)
    changes.push(`把第 ${sourceNumber} 卷“${source.title}”移动到第 ${relativeNumber} 卷${input.position}，只改变阅读顺序。`)
    warnings.push('卷内章节的阅读编号会随卷顺序整体重排；正文按稳定身份跟随自己的章纲，不会被改写到别的章。')
  } else {
    const targetNumber = input.volumeNumber!
    const located = candidate.volumes.find((volume) => volume.volumeNumber === targetNumber)
    if (!located) throw outlineEditError('OUTLINE_VOLUME_NOT_FOUND', `找不到第 ${targetNumber} 卷。`)

    // 含内容的卷一律拒绝：不级联删除正文、记忆、伏笔与审稿问题，要求先移走内容或取消操作。
    const content = volumeContent(project, located)
    if (content.beatCount || content.bodyCount || content.memoryCount || content.threadCount || content.reviewCount) {
      const parts = [
        `${located.chapters.length} 张章纲`,
        `${content.beatCount} 个剧情步骤`,
        `${content.bodyCount} 章正文`
      ]
      if (content.memoryCount) parts.push(`${content.memoryCount} 条章节记忆`)
      if (content.threadCount) parts.push(`${content.threadCount} 条伏笔`)
      if (content.reviewCount) parts.push(`${content.reviewCount} 条审稿问题`)
      throw outlineEditError(
        'OUTLINE_VOLUME_NOT_EMPTY',
        `第 ${targetNumber} 卷还有 ${parts.join('、')}。本操作不会级联删除这些内容；请先把内容移到其他卷，或取消本次操作。`
      )
    }
    if (located.chapters.length > 0 && !input.confirmVolumeChapters) {
      throw outlineEditError(
        'OUTLINE_VOLUME_CONFIRM_REQUIRED',
        `第 ${targetNumber} 卷还有 ${located.chapters.length} 张没有任何内容的章纲；确认一并移除请勾选「我已确认移除这些章纲」，否则请取消操作。`
      )
    }

    const removedChapters = located.chapters.map((chapter) => ({ id: chapter.id, chapterNumber: chapter.chapterNumber }))
    candidate.volumes.splice(candidate.volumes.indexOf(located), 1)
    candidate.volumes.forEach((volume, position) => { volume.volumeNumber = position + 1 })
    for (const chapter of removedChapters) explicitlyAffected.add(chapter.id)
    changes.push(
      `从大纲中移除第 ${targetNumber} 卷“${located.title}”` +
      (removedChapters.length ? `及其 ${removedChapters.length} 张空章纲` : '') +
      '；正文、记忆与伏笔不会被删除。'
    )
    warnings.push('被移除的卷不再出现在章节目录中；如果仍有正文属于这些章号，它们会显示为「有正文没有对应章纲」。')
  }

  renumberOutline(candidate)
  const after = snapshotLocations(candidate)
  for (const [id, before] of original) {
    const current = after.get(id)
    if (!current || current.chapterNumber !== before.chapterNumber || current.volumeNumber !== before.volumeNumber) explicitlyAffected.add(id)
  }
  for (const [id] of after) if (!original.has(id)) explicitlyAffected.add(id)
  markAffectedCards(candidate, explicitlyAffected, input.operation)
  candidate.status = '草稿'
  candidate.updatedAt = now

  const affectedNumbers = uniqueNumbers([
    ...[...explicitlyAffected].map((id) => original.get(id)?.chapterNumber).filter((value): value is number => Boolean(value)),
    ...[...explicitlyAffected].map((id) => after.get(id)?.chapterNumber).filter((value): value is number => Boolean(value))
  ])
  /**
   * 正文与章纲各自持有稳定身份，正文通过 `chapterNumber` 与章纲关联。
   * 只按 id 统计正文，会漏掉「章纲与正文 id 不同」的真实项目，
   * 影响摘要就会少报受影响的正文、记忆与伏笔，作者据此做的决定是错的。
   */
  const affectedNumberSet = new Set(affectedNumbers)
  const linksAffectedChapter = (item: { id: string; chapterNumber: number }): boolean =>
    explicitlyAffected.has(item.id) || affectedNumberSet.has(item.chapterNumber)
  const affectedBodies = project.chapters.filter(linksAffectedChapter)
  const bodyIds = new Set(affectedBodies.map((chapter) => chapter.id))
  const bodyChapterNumbers = new Set(affectedBodies.map((chapter) => chapter.chapterNumber))
  const linkedChapterIds = new Set([...explicitlyAffected, ...bodyIds])
  const memoryCount = project.memories.filter((memory) => linkedChapterIds.has(memory.chapterId) || bodyChapterNumbers.has(memoryChapterNumber(project, memory.chapterId))).length
  const threadCount = project.plotThreads.filter((thread) => threadReferences(thread, linkedChapterIds, affectedNumberSet)).length
  const reviewCount = project.reviews.filter((review) => Boolean(review.chapterId && (linkedChapterIds.has(review.chapterId) || bodyChapterNumbers.has(memoryChapterNumber(project, review.chapterId))))).length
  if (bodyIds.size) warnings.push(`已有 ${bodyIds.size} 章正式正文位于影响范围内；候选应用后不会自动重写或删除这些正文。`)
  if (memoryCount) warnings.push(`有 ${memoryCount} 条章节记忆需要按新的阅读顺序复核，原证据会继续保留。`)
  if (threadCount) warnings.push(`有 ${threadCount} 条伏笔可能受到埋设、推进或回收顺序影响。`)
  const destructiveWithBody = bodyIds.size > 0 && ['删除章节', '拆分章节', '合并章节'].includes(input.operation)
  const risk: OutlineStructureImpact['risk'] = destructiveWithBody || (input.operation === '跨卷移动' && bodyIds.size > 0) ? '高'
    : explicitlyAffected.size > 1 || input.operation !== '插入章节' ? '中' : '低'
  const impact = OutlineStructureImpactSchema.parse({
    operation: input.operation,
    summary: `${input.operation}将影响 ${explicitlyAffected.size} 张章卡、${bodyIds.size} 章已有正文、${memoryCount} 条记忆和 ${threadCount} 条伏笔。`,
    risk, affectedChapterIds: [...explicitlyAffected], affectedChapterNumbers: affectedNumbers,
    affectedOutlineCount: explicitlyAffected.size, affectedBodyCount: bodyIds.size, affectedMemoryCount: memoryCount,
    affectedThreadCount: threadCount, affectedReviewCount: reviewCount, warnings: unique(warnings), changes, createdAt: now,
    identityMerges: identityMerges.length ? identityMerges : undefined, bodyHandling
  })
  return { candidate: NovelOutlineSchema.parse(candidate), impact }
}

function memoryChapterNumber(project: NovelProject, chapterId: string): number {
  return project.chapters.find((chapter) => chapter.id === chapterId)?.chapterNumber ?? -1
}

/**
 * 卷内「真实内容」统计。删除整卷前必须先据此判断，
 * 只要有任何正文、剧情步骤、记忆、伏笔或审稿问题，就必须拒绝并请作者先移走内容。
 */
function volumeContent(project: NovelProject, volume: VolumeOutline): {
  bodyCount: number; memoryCount: number; threadCount: number; reviewCount: number; beatCount: number
} {
  const outlineIds = new Set(volume.chapters.map((chapter) => chapter.id))
  const chapterNumbers = new Set(volume.chapters.map((chapter) => chapter.chapterNumber))
  const bodies = project.chapters.filter((chapter) => outlineIds.has(chapter.id) || chapterNumbers.has(chapter.chapterNumber))
  const bodyIds = new Set(bodies.map((chapter) => chapter.id))
  const linkedIds = new Set([...outlineIds, ...bodyIds])
  return {
    bodyCount: bodies.length,
    memoryCount: project.memories.filter((memory) => linkedIds.has(memory.chapterId) || chapterNumbers.has(memory.chapterNumber)).length,
    threadCount: project.plotThreads.filter((thread) => threadReferences(thread, linkedIds, chapterNumbers)).length,
    reviewCount: project.reviews.filter((review) => Boolean(review.chapterId && linkedIds.has(review.chapterId))).length,
    beatCount: volume.chapters.reduce((sum, chapter) => sum + chapter.beats.length, 0)
  }
}

/**
 * 结构候选应用后的关联重定向。
 *
 * `chapterNumber` 只是阅读顺序，正文、记忆、伏笔的「计划回收章」都按它记账；
 * 一旦结构变更重排了章号，必须把关联一起搬过去，否则会出现「正文显示在别的章下」
 * 或「伏笔指向另一章」这种静默串章。规则：
 *   1. 先按影响摘要里的身份归并表改写身份：合并章节时被退休的章纲身份改挂到接管身份，
 *      正文身份按同样方式归并（需要拼接时把段落按顺序并入接管正文，段落 id 与文字都不改写）；
 *   2. 正文与章纲以稳定身份（id）绑定；能对上 id 的正文直接跟随自己章纲的新章号与卷号；
 *   3. 对不上 id 的正文先按「旧章号 → 新章号」的映射跟随（旧项目按章号关联时仍然正确）；
 *   4. 只有作者已明确选择「保留为无章纲」的正文才会落到空闲章号并计入 orphanBodyIds；
 *      其余能对上身份的正文绝不会被挪到末尾；
 *   5. 章节记忆、伏笔证据、审稿问题、事件线章节关联都按同一套映射改写，不留悬空引用。
 * 正文本身、记忆正文、伏笔证据都不会被删除或改写内容。
 */
export type StructureIdentityMerge = { kind: '章纲' | '正文'; from: string; to: string; joinBlocks?: boolean }

export function retargetProjectAfterStructureEdit(
  project: NovelProject,
  nextOutline: NovelOutline,
  options: { identityMerges?: StructureIdentityMerge[] } = {}
): { project: NovelProject; orphanBodyIds: string[]; movedBodyIds: string[]; mergedBodyIds: string[] } {
  const next = structuredClone(project)
  next.outline = NovelOutlineSchema.parse(nextOutline)
  const merges = options.identityMerges ?? []

  // ---- 1) 章纲身份归并：事件线的章节关联按章纲身份记账，先归并再算章号 ----
  const outlineIdentityMap = new Map<string, string>()
  for (const merge of merges) if (merge.kind === '章纲') outlineIdentityMap.set(merge.from, merge.to)

  // ---- 2) 正文身份归并 ----
  const bodyIdentityMap = new Map<string, string>()
  const mergedBodyIds: string[] = []
  for (const merge of merges) {
    if (merge.kind !== '正文') continue
    const source = next.chapters.find((chapter) => chapter.id === merge.from)
    if (!source) continue
    const target = next.chapters.find((chapter) => chapter.id === merge.to)
    bodyIdentityMap.set(merge.from, merge.to)
    if (target && target.id !== source.id) {
      if (merge.joinBlocks) {
        // 段落按顺序并入，段落 id 与文字原样保留：段落级证据不会失效。
        target.blocks = [...target.blocks, ...source.blocks]
      } else {
        target.blocks = [...target.blocks, ...source.blocks]
      }
      next.chapters = next.chapters.filter((chapter) => chapter.id !== source.id)
      mergedBodyIds.push(source.id)
    } else {
      // 接管身份还没有同身份正文：直接沿用被退休正文本身，不另造一份空正文。
      source.id = merge.to
      source.volumeNumber = target?.volumeNumber ?? source.volumeNumber
      mergedBodyIds.push(merge.from)
    }
  }

  const beforeById = new Map<string, number>()
  for (const volume of project.outline?.volumes ?? []) {
    for (const chapter of volume.chapters) beforeById.set(outlineIdentityMap.get(chapter.id) ?? chapter.id, chapter.chapterNumber)
  }
  const afterById = new Map<string, { volumeNumber: number; chapterNumber: number }>()
  for (const volume of next.outline.volumes) {
    for (const chapter of volume.chapters) afterById.set(chapter.id, { volumeNumber: volume.volumeNumber, chapterNumber: chapter.chapterNumber })
  }
  // 只有「身份仍在」的章纲才能给出可靠的旧号到新号映射；拆章/合章产生的新身份不参与。
  const numberRemap = new Map<number, number>()
  for (const [id, oldNumber] of beforeById) {
    const target = afterById.get(id)
    if (target && target.chapterNumber !== oldNumber) numberRemap.set(oldNumber, target.chapterNumber)
  }

  // 章纲占用的是「阅读位置」，与它同身份的正文共用同一个编号是正确状态；
  // 真正要防止的是两章正文共用编号，或正文占用了别人的章号。
  const outlineNumbers = new Set<number>([...afterById.values()].map((item) => item.chapterNumber))
  const claimedBodyNumbers = new Set<number>()
  const orphanBodyIds: string[] = []
  const movedBodyIds: string[] = []
  const unresolved: NovelProject['chapters'] = []

  for (const body of next.chapters) {
    const target = afterById.get(body.id)
    if (!target) { unresolved.push(body); continue }
    if (body.chapterNumber !== target.chapterNumber || body.volumeNumber !== target.volumeNumber) movedBodyIds.push(body.id)
    body.chapterNumber = target.chapterNumber
    body.volumeNumber = target.volumeNumber
    claimedBodyNumbers.add(body.chapterNumber)
  }

  let nextFreeNumber = Math.max(0, ...outlineNumbers, ...claimedBodyNumbers) + 1
  for (const body of unresolved) {
    orphanBodyIds.push(body.id)
    const remapped = numberRemap.get(body.chapterNumber)
    if (remapped !== undefined && !claimedBodyNumbers.has(remapped)) {
      // 旧项目按章号关联：跟着同一张章纲的新编号走，不会串到别的章。
      body.chapterNumber = remapped
      movedBodyIds.push(body.id)
    } else if (outlineNumbers.has(body.chapterNumber) || claimedBodyNumbers.has(body.chapterNumber)) {
      body.chapterNumber = nextFreeNumber
      nextFreeNumber += 1
      movedBodyIds.push(body.id)
    }
    claimedBodyNumbers.add(body.chapterNumber)
  }

  // ---- 3) 引用改写：正文身份归并后，所有按身份记账的引用都要跟着走 ----
  const remapBodyId = (id: string): string => bodyIdentityMap.get(id) ?? id
  for (const memory of next.memories) {
    memory.chapterId = remapBodyId(memory.chapterId)
    const body = next.chapters.find((chapter) => chapter.id === memory.chapterId)
    if (body) memory.chapterNumber = body.chapterNumber
  }
  for (const thread of next.plotThreads) {
    if (thread.setupChapterId) thread.setupChapterId = remapBodyId(thread.setupChapterId)
    if (thread.resolutionChapterId) thread.resolutionChapterId = remapBodyId(thread.resolutionChapterId)
    for (const progress of thread.progress) progress.chapterId = remapBodyId(progress.chapterId)
    for (const evidence of thread.evidencePool ?? []) evidence.chapterId = remapBodyId(evidence.chapterId)
    if (thread.targetPayoffChapter === undefined) continue
    const remapped = numberRemap.get(thread.targetPayoffChapter)
    if (remapped !== undefined) thread.targetPayoffChapter = remapped
  }
  for (const review of next.reviews) {
    if (review.chapterId) review.chapterId = remapBodyId(review.chapterId)
    for (const evidence of review.evidence) evidence.chapterId = remapBodyId(evidence.chapterId)
  }
  // 事件线的章节关联按章纲身份记账；章号变了必须跟着走，否则事件线会指向错误的章。
  // 身份归并后两章会并成一章，此时同一章只允许留下一条章节计划：把被并入计划的文字与证据
  // 合并到保留的那条上，既不留重复关联，也不静默丢掉作者已经写下的内容。
  for (const storyline of next.storylines ?? []) {
    const deduped: typeof storyline.chapterPlans = []
    const byChapterId = new Map<string, (typeof storyline.chapterPlans)[number]>()
    for (const plan of storyline.chapterPlans) {
      plan.chapterId = outlineIdentityMap.get(plan.chapterId) ?? plan.chapterId
      const target = afterById.get(plan.chapterId)
      if (target && plan.chapterNumber !== target.chapterNumber) plan.chapterNumber = target.chapterNumber
      const kept = byChapterId.get(plan.chapterId)
      if (!kept) {
        byChapterId.set(plan.chapterId, plan)
        deduped.push(plan)
        continue
      }
      kept.subGoal = mergePlanText(kept.subGoal, plan.subGoal)
      kept.method = mergePlanText(kept.method, plan.method)
      kept.obstacle = mergePlanText(kept.obstacle, plan.obstacle)
      kept.outcome = mergePlanText(kept.outcome, plan.outcome)
      kept.nextTrigger = mergePlanText(kept.nextTrigger, plan.nextTrigger)
      kept.changes = [...new Set([...kept.changes, ...plan.changes])]
      kept.evidence = [...kept.evidence, ...plan.evidence]
      if (kept.status === '计划' && plan.status !== '计划') kept.status = plan.status
    }
    storyline.chapterPlans = deduped
    storyline.chapterPlans.sort((left, right) => left.chapterNumber - right.chapterNumber)
  }
  return { project: next, orphanBodyIds, movedBodyIds, mergedBodyIds }
}

/** 章节计划并入同一章时保留两边的文字；空值不产生多余分隔符。 */
function mergePlanText(left: string, right: string): string {
  const trimmedLeft = left.trim()
  const trimmedRight = right.trim()
  if (!trimmedLeft) return right
  if (!trimmedRight) return left
  return `${trimmedLeft}\n${trimmedRight}`
}

function locateChapter(outline: NovelOutline, id: string): { volume: VolumeOutline; volumeIndex: number; chapter: ChapterOutline; chapterIndex: number } | undefined {
  for (let volumeIndex = 0; volumeIndex < outline.volumes.length; volumeIndex += 1) {
    const volume = outline.volumes[volumeIndex]!
    const chapterIndex = volume.chapters.findIndex((chapter) => chapter.id === id)
    if (chapterIndex >= 0) return { volume, volumeIndex, chapter: volume.chapters[chapterIndex]!, chapterIndex }
  }
  return undefined
}

function requireChapter(outline: NovelOutline, id: string) {
  const located = locateChapter(outline, id)
  if (!located) throw outlineEditError('OUTLINE_CHAPTER_NOT_FOUND', '找不到需要调整的章纲，可能已被修改或删除。')
  return located
}

function sortOutline(outline: NovelOutline): void {
  outline.volumes.sort((left, right) => left.volumeNumber - right.volumeNumber)
  outline.volumes.forEach((volume) => volume.chapters.sort((left, right) => left.chapterNumber - right.chapterNumber))
}

function renumberOutline(outline: NovelOutline): void {
  // 章节数组当前顺序就是作者要求的阅读顺序；这里不能再次按旧 chapterNumber 排序，
  // 否则调序/拆章/合章候选会被旧编号悄悄恢复。卷本身仍按卷号排序。
  outline.volumes.sort((left, right) => left.volumeNumber - right.volumeNumber)
  let chapterNumber = 1
  for (const volume of outline.volumes) {
    for (const chapter of volume.chapters) {
      chapter.volumeNumber = volume.volumeNumber
      chapter.chapterNumber = chapterNumber
      chapter.sourceVolumeDigest = volumePlanDigest(volume)
      chapterNumber += 1
    }
  }
}

function snapshotLocations(outline: NovelOutline): Map<string, { volumeNumber: number; chapterNumber: number }> {
  return new Map(outline.volumes.flatMap((volume) => volume.chapters.map((chapter) => [chapter.id, { volumeNumber: volume.volumeNumber, chapterNumber: chapter.chapterNumber }] as const)))
}

function markAffectedCards(outline: NovelOutline, ids: Set<string>, operation: string): void {
  for (const volume of outline.volumes) for (const chapter of volume.chapters) {
    if (!ids.has(chapter.id)) continue
    chapter.downstreamReviewStatus = '待复核'
    chapter.downstreamReviewReason = `${operation}后阅读顺序或规划依据发生变化`
  }
}

function renumberBeats(beats: ChapterOutline['beats']): ChapterOutline['beats'] {
  return beats.map((beat, index) => ({ ...beat, order: index + 1 }))
}

function combine(left: string, right: string): string {
  const values = unique([left.trim(), right.trim()].filter(Boolean))
  return values.join('；')
}

function unique(values: string[]): string[] { return [...new Set(values)] }
function uniqueNumbers(values: number[]): number[] { return [...new Set(values)].sort((left, right) => left - right) }

function threadReferences(thread: NovelProject['plotThreads'][number], ids: Set<string>, chapterNumbers: Set<number>): boolean {
  return Boolean(
    (thread.setupChapterId && ids.has(thread.setupChapterId)) || (thread.resolutionChapterId && ids.has(thread.resolutionChapterId)) ||
    thread.progress.some((item) => ids.has(item.chapterId)) || (thread.targetPayoffChapter && chapterNumbers.has(thread.targetPayoffChapter))
  )
}

function outlineEditError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalize(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim()
}

function stableList(values: string[]): string[] {
  return [...new Set(values.map(normalize).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
}
