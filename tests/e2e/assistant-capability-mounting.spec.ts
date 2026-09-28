import { expect, test, type Page } from '@playwright/test'
import { buildWritableProject, openModule } from './helpers/manual-workspace'
import { ensureFreeCreation } from './helpers/workspace-ui'
import { configureProvider, startStubModel, type StubModel } from './helpers/stub-model'

/**
 * 运行期「按任务范围挂载能力」的**出站证据**（端到端，独立于呈现层）。
 *
 * 上一轮登记的两个缺口在本文件关闭：
 *   (i) 内置能力卡片上的「适用：」呈现 —— 由 workspace-shell-ui.spec.ts 用例 B 覆盖；
 *   (ii) **运行期自动挂载 / 摘除在 E2E 层没有直证** —— 本文件用**真实出站请求体**补上。
 *
 * 口径（必须写清，避免夸大）：
 *   - 证据一律取**模型端点实际收到的原始请求体**（受控桩 `stub.calls`）。禁止用「卡片可见」「接口返回
 *     taskScopes」「'本次使用' 预览面板」冒充运行期挂载证据。
 *   - 两种来源的判定依据**不同**（实测复核 `packages/core/src/creativeSkillRuntime.ts:21-25`）：
 *       · `source === '内置'` → 按 `CREATIVE_STAGE_BUILT_IN_CAPABILITIES`（**阶段 id 硬编码白名单**，:12-19）判定；
 *       · `source === '用户配置'` → 按 `capability.taskScopes` × `CREATIVE_STAGE_TASK_SCOPES` 交集判定。
 *     用户配置技能按 taskScopes 挂载；内置能力按阶段白名单挂载。
 *   - ⚠️ **判别性对照的迁移**（2026-09-18 同日收窄）：本条用例的旧口径用 `中文表达清晰度`（内置）当判别样本 ——
 *     它的 `taskScopes` 当时含横切项「中文审校」，与 outline 阶段范围**有交集**（按 taskScopes 规则会被挂上），
 *     却不在 outline 的**阶段 id 白名单**内（实际被挡下）⇒ 两套规则预测**相反**，因此能区分判定依据。
 *     **收窄后该前提不再成立**（`中文表达清晰度` → `['世界设定','正文创作']`，与 outline 范围已无交集）⇒ 本条
 *     用例内的对照**退化为非判别性**（断言保留为留档，**不再声称判别力**）。判别性证据随之移到 core 单测。
 *   - ✅ **P-1 已接入（2026-09-18 同日，晚于上述收窄）**：`伏笔证据追踪` 已并入 delivery 的**阶段白名单**
 *     与 `continuityKeeper` 默认席位装配 ⇒ 它现在**真的**进 delivery 出站，本文件末尾新增的 delivery 出站直证
 *     用例覆盖这一点。两套规则在 9 项 × 6 阶段上的分歧因此归零，core 判别性断言已改写为「delivery 默认出站
 *     === delivery 默认席位的能力清单」（**只改白名单**仍会红）。
 *     ⚠️ 判定依据本身**仍未统一**：内置能力仍走**阶段 id 硬编码白名单**、用户配置能力仍走 `taskScopes`
 *     （P-3「删白名单、统一判定」**未启动**）。若将来启动 P-3，本文件的断言会**变红** —— 那是有意为之的提示。
 *   - 桩只证明链路；不做任何 `page.route` 伪造、不 skip、不 `.catch()` 吞错。
 */

const REPLY = { answer: '收到，我先按当前作用域看一下。', references: [], actions: [] }

/** 出站原始体里的第 index 次调用（失败时给出明确消息，不静默）。 */
function rawCall(stub: StubModel, index: number): string {
  const raw = stub.calls[index]
  expect(raw, `第 ${index + 1} 次出站请求应存在`).toBeTruthy()
  return raw!
}

/** 把出站体里所有消息内容拼起来；指针指向**实际发送的文本**，而不是桩自己的返回值。 */
function contentOf(stub: StubModel, index: number): string {
  const parsed = JSON.parse(rawCall(stub, index)) as { messages: Array<{ role: string; content: string }> }
  return parsed.messages.map((message) => message.content).join('\n')
}

/**
 * 发一条消息并等这次调用**真的到达模型**。
 *
 * 断言「本次调用确实发生过」用 `stub.calls.length` 精确 +1（不是「至少一次」的模糊口径）：
 * 受控桩一律回 200，产品不会重试，因此每次发送恰好一次出站。
 */
async function sendAndSettle(page: Page, stub: StubModel, text: string): Promise<void> {
  const before = stub.calls.length
  await page.locator('#mojing-dock-input').fill(text)
  await page.locator('.mjp-dock-send').click()
  await expect.poll(() => stub.calls.length, { message: `发送「${text}」必须真的到达模型` }).toBe(before + 1)
  // 等这一轮收尾（输入框恢复可用），避免下一次发送与上一次交错。
  await expect(page.locator('#mojing-dock-input')).toBeEnabled()
  await expect(page.locator('#mojing-dock-input')).toHaveValue('')
}

test('内置能力在适用栏目参与出站请求、不适用栏目不参与，切回恢复且旧作用域不串入', async ({ page }) => {
  const fixture = await buildWritableProject(page, '能力挂载验收')
  const stub = await startStubModel(() => REPLY)
  try {
    await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)

    // 1) 世界观 → 世界总览。`事实边界核对` 声明 `taskScopes: ['世界设定','连续性']`，
    //    在**两套规则下一致**：内置白名单的 `world` 含它，taskScopes 也含「世界设定」。
    await openModule(page, '世界观', '世界总览')
    await ensureFreeCreation(page)
    await sendAndSettle(page, stub, '请核对一下当前的世界设定边界。')

    expect(rawCall(stub, 0), '世界观出站体必须带作者技能数据块').toContain('<author_skill_guidance>')
    expect(contentOf(stub, 0), '世界观阶段 `事实边界核对` 必须参与出站').toContain('事实边界核对')

    // 2) 切到 小说大纲 → 总纲与卷纲。`事实边界核对` 在 outline 的白名单与 taskScopes（结构规划/场景节拍/中文审校）
    //    下**都不**适用：因此这次出站**不含**它；同时必须**含** `分层结构规划`，证明这次真的是 outline 阶段装配，
    //    而不是「没发请求」导致的空断言。
    await openModule(page, '小说大纲', '总纲与卷纲')
    await ensureFreeCreation(page)
    await sendAndSettle(page, stub, '把这一卷的方向理一理。')

    const outline = contentOf(stub, 1)
    expect(outline, '小说大纲阶段 `事实边界核对` 不得参与出站').not.toContain('事实边界核对')
    expect(outline, '小说大纲阶段 `分层结构规划` 必须参与出站（证明这次确实是 outline 装配）').toContain('分层结构规划')

    // 3) 切回 世界观 → 世界总览。要**又含** `事实边界核对`，且**不含** `分层结构规划` —— 证明上一作用域
    //    装配没有串进这一作用域（不是「全局把两份都带上」）。
    await openModule(page, '世界观', '世界总览')
    await ensureFreeCreation(page)
    await sendAndSettle(page, stub, '再看一眼世界规则。')

    const backToWorld = contentOf(stub, 2)
    expect(backToWorld, '切回世界观后 `事实边界核对` 必须恢复参与出站').toContain('事实边界核对')
    expect(backToWorld, '小说大纲的 `分层结构规划` 不得串入世界观作用域').not.toContain('分层结构规划')

    // 四次口径再钉一遍：三次调用都真的发生过（精确计数，非「至少 N」）。
    expect(stub.calls.length, '三次发送各产生一次真实出站').toBe(3)
  } finally {
    await stub.close()
  }
})

test('内置能力由阶段白名单判定、用户配置技能由自身适用范围判定（含判别性对照）', async ({ page }) => {
  const fixture = await buildWritableProject(page, '能力来源对照')
  const stub = await startStubModel(() => REPLY)
  try {
    await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)

    // 1) 走**真实 API** 建一条用户配置能力，只声明 `结构规划`（不碰 `page.route`）。
    const skillName = `结构适用技能-${Date.now()}`
    const created = await page.request.post(`${fixture.origin}/api/novels/${fixture.id}/creative-capabilities`, {
      headers: { ...fixture.headers, 'Content-Type': 'application/json' },
      data: {
        name: skillName,
        description: '只声明结构规划的对照技能，用来证明用户配置能力按自己声明的适用范围挂载。',
        taskScopes: ['结构规划']
      }
    })
    expect(created.status(), '创建用户配置能力应成功').toBe(201)
    const capabilityId = ((await created.json()) as { id: string }).id

    // 2) 启用它 —— 服务端会 `syncCapabilityStageAssignments()`，把它按 `taskScopes` 挂到兼容阶段（大纲）。
    const enabled = await page.request.put(
      `${fixture.origin}/api/novels/${fixture.id}/creative-capabilities/${capabilityId}/enabled`,
      { headers: { ...fixture.headers, 'Content-Type': 'application/json' }, data: { enabled: true } }
    )
    expect(enabled.status(), '启用用户配置能力应成功').toBe(200)
    expect(((await enabled.json()) as { enabled: boolean }).enabled).toBe(true)

    // 3) 在小说的「总纲与卷纲」（outline 阶段）发一条消息：用户配置能力必须按 taskScopes 进入出站体。
    //    该栏目派生的任务类型是 `局部修改`（`WorkspacePage.tsx:182`），后面第 5 步就针对它写任务覆盖。
    await openModule(page, '小说大纲', '总纲与卷纲')
    await ensureFreeCreation(page)
    await sendAndSettle(page, stub, '这一卷的方向怎么排？')

    const outline = contentOf(stub, 0)
    expect(outline, '用户配置技能按自身 taskScopes 参与出站').toContain(skillName)

    // 4) 同一次出站**不含** `事实边界核对`。⚠️ 但**这一条不具判别力**（I-1）：`事实边界核对` 的
    //    `taskScopes: ['世界设定','连续性']` 与 outline 的 `CREATIVE_STAGE_TASK_SCOPES.outline`
    //    （`['结构规划','场景节拍','中文审校']`）**无交集** ⇒ **即使按 taskScopes 规则它也不会挂**。
    //    该断言对「阶段 id 白名单」与「taskScopes」两套规则给出**相同预测**，因此它**无法区分**挂载依据；
    //    这里仅作第一次发送的留存。⚠️ 第 6 步的对照在 2026-09-18 声明收窄后**同样不具判别力**（见文件头
    //    「判别性对照的迁移」）：判别性证据现由 core 单测 `creativeSkillRuntime.test.ts`「★ 判别性：delivery
    //    默认出站来自默认席位的能力清单」以及本文件末尾的 delivery 出站直证用例承担。
    expect(outline, '内置 `事实边界核对` 在 outline 阶段不参与出站（此条不具判别力，仅留档）').not.toContain('事实边界核对')
    expect(stub.calls.length, '第一次发送恰好一次真实出站').toBe(1)

    // 5) 追加一次**任务级能力覆盖**：给 `局部修改` 写一条任务配置，`capabilityIds` 故意同时含
    //    「本阶段白名单内」与「本阶段白名单外」的各一项内置能力。
    //    · 路由：`mojingServer.ts:297-312`（`PUT /assistant-task-configurations/:taskType`，taskType 经 decodeURIComponent）。
    //    · `saveAssistantTaskConfiguration`（`novelDatabase.ts:827-837`）**不校验适用范围**（只做 schema parse）
    //      ⇒ 可以把「不适用于该阶段的内置能力」写进任务配置。
    const overridden = await page.request.put(
      `${fixture.origin}/api/novels/${fixture.id}/assistant-task-configurations/${encodeURIComponent('局部修改')}`,
      {
        headers: { ...fixture.headers, 'Content-Type': 'application/json' },
        data: { enabled: true, capabilityIds: ['capability-outline-structure', 'capability-chinese-clarity'] }
      }
    )
    expect(overridden.status(), '写入任务级能力覆盖应成功').toBe(200)

    // 6) 同一页面再发一条消息。`selectSkills`（`assistantWorkflow.ts:186`）的取值优先级是
    //    `taskConfig?.capabilityIds ?? config?.capabilityIds ?? fallbackSeat?.capabilityIds`
    //    ⇒ 任务级 `capabilityIds` 会**接管**（shadow 掉 sync 写进阶段配置的那条用户配置技能）。
    //    循环里 `:197` 的不适用能力走 **skip**（reason「该技能不适用于当前栏目。」），**不抛错** ⇒ 发消息不会失败。
    await sendAndSettle(page, stub, '再按新的范围核对一遍这一卷。')

    const overriddenBody = contentOf(stub, 1)
    // 正向控制：被 outline 白名单允许的内置能力照旧参与（证明这次确实装配了技能，不是「空技能」的假绿）。
    expect(overriddenBody, '任务覆盖后被允许的内置能力 `分层结构规划` 照旧参与出站（正向控制）').toContain('分层结构规划')
    // 断言（留档，**已不具判别力** —— 见文件头「判别性对照的迁移」）：`中文表达清晰度` 是 `source='内置'`，
    //   判定走**阶段 id 硬编码白名单**，outline 白名单（`creativeSkillRuntime.ts:15` = [分层结构规划, 剧情步骤规划]）
    //   不含它 ⇒ 实际不挂。**2026-09-18 收窄后**它的声明已改为 `['世界设定','正文创作']`，与 outline 范围
    //   （结构规划/场景节拍/中文审校）**无交集** ⇒ 按 taskScopes 规则它**也不会**被挂上，两套规则预测**相同**，
    //   故本行**不能**再作为判定依据的判别性证据（它仍然是一条真实的现役行为断言，故保留不删）。
    expect(overriddenBody, '内置 `中文表达清晰度` 在 outline 阶段不参与出站（收窄后已非判别性，保留留档）').not.toContain('中文表达清晰度')
    // 正向控制：证明本次任务覆盖**真的生效了**——任务级 `capabilityIds` 接管后，阶段配置里 sync 写入的用户技能被 shadow。
    //   若任务覆盖没生效，这条会红，从而排除「配置写了但没起作用」的假绿。
    expect(overriddenBody, '任务级 capabilityIds 接管后，用户配置技能被 shadow（正向控制）').not.toContain(skillName)
    expect(stub.calls.length, '两次发送各产生一次真实出站').toBe(2)
  } finally {
    await stub.close()
  }
})

/**
 * P-1 接入（2026-09-18）的**出站直证**：`伏笔证据追踪` 真的进入 delivery 阶段的出站请求体。
 *
 * 判别点（为什么这条能证明是「本轮改了什么」，而不是「本来就这样」）：
 *   · `伏笔证据追踪` 声明 `taskScopes: ['伏笔','连续性']`、`source: '内置'`；
 *   · 接入前它**不在** delivery 的阶段白名单（`creativeSkillRuntime.ts:18`）里，也不在 `continuityKeeper`
 *     席位的 `capabilityIds` 里 ⇒ 无论走白名单还是走席位，它都进不了出站 ⇒ 本用例第 1 步必然红；
 *   · 接入后它同时进入**两处**（白名单 + 默认席位装配）⇒ 第 1 步绿。**只改一处仍然是红的**（白名单只是
 *     默认路径上的校验门，出站集合来自席位 `capabilityIds`）—— 这条不再用「卡片可见」「接口返回 taskScopes」
 *     或纯函数推算代替，读的就是**受控桩实际收到的原始请求体**。
 *   · 反向控制：第 2 步在同一浏览器会话里切到 world 阶段，同一句出站**不得**含它（不是全局带上）。
 */
test('delivery 出站带上「伏笔证据追踪」，非 delivery 栏目不串入（P-1 出站直证）', async ({ page }) => {
  const fixture = await buildWritableProject(page, '伏笔挂载验收')
  const stub = await startStubModel(() => REPLY)
  try {
    await configureProvider(page, fixture.origin, fixture.headers, stub.baseUrl)

    // 1) 审稿与导出 → 导出成稿。这一栏派生的任务类型是 `连续性检查`、目标 `outline`
    //    （`WorkspacePage.tsx:189-190`），服务端据此落到 **delivery** 阶段。
    await openModule(page, '审稿与导出', '导出成稿')
    await ensureFreeCreation(page)
    await sendAndSettle(page, stub, '帮我核对一下伏笔的埋设与回收情况。')

    expect(rawCall(stub, 0), '审稿与导出出站体必须带作者技能数据块').toContain('<author_skill_guidance>')
    const delivery = contentOf(stub, 0)
    expect(delivery, 'delivery 阶段 `伏笔证据追踪` 必须参与出站').toContain('伏笔证据追踪')
    expect(delivery, '出站必须带上该能力自己的约束文本').toContain('不得在缺少正文证据时自动标记为已回收。')
    // 正向控制：本阶段原有的内置能力照旧参与（证明这次真的是 delivery 装配，不是「空技能」的假绿）。
    expect(delivery, 'delivery 原有内置能力 `连续性证据检查` 照旧参与（正向控制）').toContain('连续性证据检查')

    // 2) 切到 世界观 → 世界总览（world 阶段）：`伏笔证据追踪` 不得跟过来。
    await openModule(page, '世界观', '世界总览')
    await ensureFreeCreation(page)
    await sendAndSettle(page, stub, '再核对一下世界设定边界。')

    const world = contentOf(stub, 1)
    expect(world, 'world 阶段不得出现 `伏笔证据追踪`').not.toContain('伏笔证据追踪')
    expect(world, 'world 阶段 `事实边界核对` 必须参与（证明这次确实装配了技能）').toContain('事实边界核对')

    // 3) 切回 审稿与导出：`伏笔证据追踪` 恢复参与，且 world 独有的 `世界观质量审校` 不得串入。
    await openModule(page, '审稿与导出', '导出成稿')
    await ensureFreeCreation(page)
    await sendAndSettle(page, stub, '再看一眼伏笔闭环。')

    const backToDelivery = contentOf(stub, 2)
    expect(backToDelivery, '切回审稿与导出后 `伏笔证据追踪` 必须恢复参与出站').toContain('伏笔证据追踪')
    expect(backToDelivery, 'world 的 `世界观质量审校` 不得串入 delivery 作用域').not.toContain('世界观质量审校')
    expect(stub.calls.length, '三次发送各产生一次真实出站').toBe(3)
  } finally {
    await stub.close()
  }
})
