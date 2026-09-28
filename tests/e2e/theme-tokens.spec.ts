import { expect, test, type Page } from '@playwright/test'

/**
 * 暖纸 / 夜墨主题令牌契约。
 *
 * 分工（避免重复实现同一件事）：
 *   - 真实用户路径的**切换动作**（窄栏底部 RailFooterButton「切换到夜墨 / 切换到暖纸」）
 *     及其在五个一级栏目深页上的布局影响，由 `manual-creation-flow.spec.ts` 的
 *     「M9 布局闸门」覆盖；
 *   - 本文件只负责**令牌契约本身**：在隔离设置的主题下，逐项核对
 *     `apps/web/src/styles/95-paper-theme.css` 定义的颜色令牌与文本令牌，
 *     并用「真渲染读数」和「WCAG 对比度」证明令牌确实生效且没有退化。
 *
 * 隔离手法说明：这里直接写 `documentElement.dataset.theme`（而不是点击切换）——
 * 目的是把「令牌取值」这一维从「点击切换路径」中隔离出来，二者互不耦合。
 * 主题的真实取值只有 `paper` / `night`（`useTheme.ts` 的 `resolveTheme` 返回
 * `'paper' | 'night'`）；旧的 `light` / `dark` 在 CSS 里没有任何选择器匹配。
 */

type ThemeName = 'paper' | 'night'
type ThemeSpec = {
  /** 中文标签，用于失败信息一眼定位。 */
  label: string
  /** 与主题相关的颜色令牌：精确十六进制值。 */
  tokens: Record<string, string>
  /** 仅暖纸同步覆写的遗留 --mj-* 语义槽（夜墨段不定义，故此处为空）。 */
  legacy: Record<string, string>
}

const THEMES: Record<ThemeName, ThemeSpec> = {
  paper: {
    label: '暖纸',
    tokens: {
      '--paper-0': '#f2ede4',
      '--paper-1': '#fbf8f2',
      '--line-1': '#e2d9c8',
      '--ink-900': '#1f1b16',
      '--ink-500': '#6b6258',
      '--accent': '#2f5d55',
      '--accent-2': '#3e7a70'
    },
    legacy: {
      '--mj-bg': '#f2ede4',
      '--mj-text': '#1f1b16',
      '--mj-accent': '#2f5d55'
    }
  },
  night: {
    label: '夜墨',
    tokens: {
      '--paper-0': '#14161a',
      '--paper-1': '#1c1f24',
      '--line-1': '#2e343c',
      '--ink-900': '#e8e5df',
      '--ink-500': '#9aa0a8',
      '--accent': '#5fae9f',
      '--accent-2': '#43907f'
    },
    legacy: {}
  }
}

/** #rrggbb 或 rgb(a)(r, g, b) → {r,g,b}；令牌给的是 hex、计算样式给的是 rgb，需归一化后比较。 */
function parseColor(value: string): { r: number; g: number; b: number } {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1]!
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16)
    }
  }
  const rgb = value.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!rgb) throw new Error(`无法解析颜色：${value}`)
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
}

/** WCAG 2.x 单通道线性化。 */
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG 2.x 相对亮度。 */
function relativeLuminance(color: string): number {
  const { r, g, b } = parseColor(color)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** WCAG 2.x 对比度（前景/背景，与明暗顺序无关）。 */
function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a) as [
    number,
    number
  ]
  return (lighter + 0.05) / (darker + 0.05)
}

/** 读取根元素上的自定义属性计算值（trim 后原样返回，hex 不会被解析成 rgb）。 */
async function readTokens(page: Page, keys: string[]): Promise<Record<string, string>> {
  return page.evaluate((list) => {
    const css = getComputedStyle(document.documentElement)
    return Object.fromEntries(list.map((key) => [key, css.getPropertyValue(key).trim()]))
  }, keys)
}

/** 隔离设置主题（点选切换路径由 manual-creation-flow 布局闸门负责）。 */
async function setThemeIsolated(page: Page, theme: ThemeName): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value
  }, theme)
  await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)
}

test('暖纸 / 夜墨主题：颜色令牌、字体令牌与真渲染对比度契约', async ({ page }) => {
  // `.mjp-app` 在项目大厅 `/` 上就存在（AppShell），无需建项目或进工作区。
  await page.goto('/')

  const tokenKeys = Object.keys(THEMES.paper.tokens)

  for (const themeName of ['paper', 'night'] as const) {
    const theme = THEMES[themeName]

    await test.step(`${theme.label}（${themeName}）`, async () => {
      await setThemeIsolated(page, themeName)

      // (a) 七个颜色令牌 = 精确十六进制值。
      const tokens = await readTokens(page, [...tokenKeys, ...Object.keys(theme.legacy)])
      for (const [name, expected] of Object.entries(theme.tokens)) {
        expect(tokens[name], `${theme.label} ${name} 令牌值`).toBe(expected)
      }

      // (b) 仅暖纸断言遗留 --mj-* 语义槽有值（夜墨段不定义）。
      for (const [name, expected] of Object.entries(theme.legacy)) {
        expect(tokens[name], `${theme.label} 遗留槽 ${name}`).toBe(expected)
      }

      // (e) 大厅为文学主题设置了局部色槽；真渲染必须与这两个局部令牌一致。
      const paint = await page.evaluate(() => {
        const app = document.querySelector('.mjp-app')
        if (!app) return null
        const css = getComputedStyle(app)
        return {
          color: css.color,
          backgroundColor: css.backgroundColor,
          textToken: css.getPropertyValue('--hall-text').trim(),
          paperToken: css.getPropertyValue('--hall-paper').trim()
        }
      })
      expect(paint, `${theme.label} 必须存在 .mjp-app 容器`).not.toBeNull()
      expect(parseColor(paint!.color), `${theme.label} 大厅文字色 == --hall-text`).toEqual(parseColor(paint!.textToken))
      expect(parseColor(paint!.backgroundColor), `${theme.label} 大厅背景色 == --hall-paper`).toEqual(parseColor(paint!.paperToken))
      expect(contrastRatio(paint!.textToken, paint!.paperToken), `${theme.label} 大厅主文字对比度应 ≥ 7`).toBeGreaterThanOrEqual(7)

      // (f) 可读性：--ink-900 对 --paper-0 的 WCAG 对比度 ≥ 7。
      const ratio = contrastRatio(theme.tokens['--ink-900']!, theme.tokens['--paper-0']!)
      console.log(`[M9 主题令牌] ${theme.label}：ink-900/paper-0 对比度 ${ratio.toFixed(2)}（阈值 7）`)
      expect(ratio, `${theme.label} ink-900 对 paper-0 对比度应 ≥ 7`).toBeGreaterThanOrEqual(7)
    })
  }

  // (c) 令牌互不泄漏：同一主题内三角色互不相同，且同一令牌在日夜之间取值不同。
  await test.step('令牌互不泄漏', async () => {
    const roles = ['--paper-0', '--ink-900', '--accent']
    for (const themeName of ['paper', 'night'] as const) {
      const theme = THEMES[themeName]
      const values = roles.map((role) => theme.tokens[role]!)
      expect(new Set(values).size, `${theme.label} 的 ${roles.join(' / ')} 三者应互不相同`).toBe(3)
    }
    for (const role of roles) {
      expect(
        THEMES.night.tokens[role]!,
        `${role} 在暖纸与夜墨下应取不同值（防令牌互相泄漏）`
      ).not.toBe(THEMES.paper.tokens[role]!)
    }
  })

  // (d) 字体令牌（与主题无关，断言一次）。
  await test.step('字体令牌', async () => {
    const fonts = await readTokens(page, ['--font-ui', '--font-serif', '--font-mono'])
    expect(fonts['--font-ui'], '--font-ui 应含 Microsoft YaHei UI').toContain('Microsoft YaHei UI')
    expect(fonts['--font-serif']?.length, '--font-serif 应非空').toBeGreaterThan(0)
    expect(fonts['--font-mono']?.length, '--font-mono 应非空').toBeGreaterThan(0)
  })
})

/**
 * P0 无障碍下限契约（2026-09-20 新增）。
 *
 * 与上方用例分工：上方守护**主题身份色**（paper / ink-900 / accent 等，不随可访问性
 * 修复变动，断言精确十六进制）；本用例守护**可访问性下限**，只断言对比度与真渲染行为，
 * 不断言具体色值 —— 后者允许在达标前提下继续微调，避免把「调色」变成「改测试」。
 *
 * 全部只读：不建项目、不写数据、不改主题存储，因此不污染共享库。
 */
test('P0 无障碍：次级文字、焦点环与禁用态的真渲染下限', async ({ page }) => {
  await page.goto('/')

  // (a) 次级文字层 --ink-400 承担全站小字，必须达正文 4.5:1；暖纸与夜墨分别验算。
  for (const themeName of ['paper', 'night'] as const) {
    await test.step(`${themeName}：次级文字 / 禁用文字 / 警告文字对比度`, async () => {
      await setThemeIsolated(page, themeName)
      const t = await readTokens(page, [
        '--ink-400',
        '--ink-300',
        '--paper-0',
        '--paper-1',
        '--warn-ink',
        '--warn-soft'
      ])

      // 取「画布底 / 卡片底」中更差的一档，避免在某一档上悄悄退化。
      const ink400 = Math.min(
        contrastRatio(t['--ink-400']!, t['--paper-0']!),
        contrastRatio(t['--ink-400']!, t['--paper-1']!)
      )
      console.log(`[P0] ${themeName} --ink-400 最差对比度 ${ink400.toFixed(2)}（阈值 4.5）`)
      expect(ink400, `${themeName} --ink-400 作为文字层应 ≥ 4.5:1`).toBeGreaterThanOrEqual(4.5)

      // 禁用文字：WCAG 对禁用态豁免，这里只守可读性下限 3:1。
      const ink300 = contrastRatio(t['--ink-300']!, t['--paper-0']!)
      console.log(`[P0] ${themeName} --ink-300 对比度 ${ink300.toFixed(2)}（禁用文字阈值 3）`)
      expect(ink300, `${themeName} --ink-300 作为禁用/占位文字应 ≥ 3:1`).toBeGreaterThanOrEqual(3)

      // --warn-ink 主要出现在 --warn-soft 底上，按实际搭配验算。
      const warn = contrastRatio(t['--warn-ink']!, t['--warn-soft']!)
      console.log(`[P0] ${themeName} --warn-ink on --warn-soft ${warn.toFixed(2)}（阈值 4.5）`)
      expect(warn, `${themeName} --warn-ink 在 --warn-soft 上应 ≥ 4.5:1`).toBeGreaterThanOrEqual(4.5)
    })
  }

  // (b) 焦点环：必须是实心（不得再用半透明 rgba 合成出 <3:1 的环）。
  for (const themeName of ['paper', 'night'] as const) {
    await test.step(`${themeName}：焦点环为实心且达 3:1`, async () => {
      await setThemeIsolated(page, themeName)
      // 自定义属性的 computed value 不做 var() 替换（替换发生在「实际使用」时），
      // 直接读 --focus-ring-shadow 只会拿到 var(...) 原文。因此用一个探针元素
      // 真实应用该 token，读浏览器算出来的 box-shadow —— 这才是焦点环的实际渲染值。
      const ring = await page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.position = 'fixed'
        probe.style.left = '-9999px'
        probe.style.boxShadow = 'var(--focus-ring-shadow)'
        document.body.appendChild(probe)
        const shadow = getComputedStyle(probe).boxShadow
        probe.remove()
        return shadow
      })
      expect(ring, `${themeName} 焦点环不应再使用半透明 rgba（合成后不足 3:1）`).not.toMatch(/rgba\(/)

      // 「间隔环 + 实心环」双层：间隔环用于把主色环与同色填充（如主按钮）隔开。
      const colors = ring.match(/rgb\([^)]*\)/g) ?? []
      expect(colors.length, `${themeName} 焦点环应为双层（间隔环 + 实心环）`).toBeGreaterThanOrEqual(2)

      // 取最外层（贴着背景那一层）与背景比。
      const t = await readTokens(page, ['--paper-0'])
      const outer = colors[colors.length - 1]!
      const ratio = contrastRatio(outer, t['--paper-0']!)
      console.log(`[P0] ${themeName} 焦点环外层 ${outer} 对画布底 ${ratio.toFixed(2)}（阈值 3）`)
      expect(ratio, `${themeName} 焦点环应达 UI 3:1 门槛`).toBeGreaterThanOrEqual(3)
    })
  }

  // (c) 禁用控件：不得用 opacity 压低对比度。
  //     P1 已移除大厅窄栏的全部禁用占位项，原「.mjp-rail-item:disabled」断言随之失效
  //     （选择器再无匹配 ⇒ 必然失败）。改为直接验证**禁用态样式契约本身**：
  //     带上真实组件类名注入被禁用的控件，读浏览器实际算出的 opacity。
  //     这样既不依赖「哪一页恰好有禁用控件」，也能守住「禁用态不许用 opacity 二次压对比度」。
  await test.step('禁用控件不使用 opacity 压低对比度', async () => {
    await setThemeIsolated(page, 'paper')
    const opacities = await page.evaluate(() => {
      const host = document.createElement('div')
      host.style.position = 'fixed'
      host.style.left = '-9999px'
      // 注意：`:disabled` 只匹配表单元素，选项卡片必须用 button 注入才能命中规则。
      host.innerHTML =
        '<button class="mjp-btn" disabled>禁用按钮</button>' +
        '<div class="mjp-seg"><button disabled>禁用分段</button></div>' +
        '<input class="mjp-input" disabled />' +
        '<span class="mjp-switch"><input type="checkbox" disabled /><span class="track"></span></span>' +
        '<button class="mjp-mode-choice-item" disabled>禁用选项</button>'
      document.body.appendChild(host)
      const pick = (selector: string) => {
        const el = host.querySelector(selector)
        return el ? getComputedStyle(el as Element).opacity : null
      }
      const out = {
        btn: pick('.mjp-btn:disabled'),
        seg: pick('.mjp-seg button:disabled'),
        input: pick('.mjp-input:disabled'),
        track: pick('.mjp-switch input:disabled + .track'),
        choice: pick('.mjp-mode-choice-item:disabled')
      }
      host.remove()
      return out
    })

    for (const [name, value] of Object.entries(opacities)) {
      expect(value, `禁用态 ${name} 应被样式命中（注入元素必须能取到 opacity）`).not.toBeNull()
      expect(value, `禁用态 ${name} 应显式设色，而不是用 opacity 二次压低对比度`).toBe('1')
    }
  })

  // (d) 大厅占位符使用局部 --hall-muted，并保持清晰可读。
  await test.step('大厅占位符文字取 --hall-muted', async () => {
    await setThemeIsolated(page, 'paper')
    const input = page.locator('.mjp-hall-search input').first()
    await expect(input, '大厅搜索框应可见').toBeVisible()
    const placeholder = await input.evaluate((el) => getComputedStyle(el, '::placeholder').color)
    const muted = await input.evaluate((el) => getComputedStyle(el).getPropertyValue('--hall-muted').trim())
    expect(parseColor(placeholder), '大厅占位符颜色应等于 --hall-muted').toEqual(parseColor(muted))
  })
})

/**
 * P2-A 控件边界语义契约（2026-09-20 新增）。
 *
 * 与上面两条分工：主题身份色守「品牌不变」，P0 守「文字与焦点环下限」，本条守
 * **「控件边界」必须是独立语义 token 且达 UI 3:1**：
 *   - P0 已把 --ink-400 上调为文字色（暖纸 #6f6759 / 夜墨 #8b929b），它不能再兼职描边；
 *   - line token（--line-1/2/3）实测只有 1.2–2.4:1，只能给静态卡片和分隔线用；
 *   - 因此交互控件必须有自己的 --control-border，且暖纸夜墨分别取值、分别验算。
 *
 * 只断言「真渲染读数 + WCAG 对比度」，不断言具体十六进制，允许在达标范围内继续调色。
 */
test('P2-A 控件边界：独立语义 token 且在暖纸 / 夜墨下均达 3:1', async ({ page }) => {
  await page.goto('/')

  for (const themeName of ['paper', 'night'] as const) {
    await test.step(`${themeName}：控件边界 token 达 3:1`, async () => {
      await setThemeIsolated(page, themeName)
      const t = await readTokens(page, [
        '--control-border',
        '--control-border-strong',
        '--ink-400',
        '--line-2',
        '--paper-0',
        '--paper-1',
        '--paper-2'
      ])

      expect(t['--control-border'], `${themeName} 必须定义 --control-border`).toBeTruthy()
      expect(t['--control-border-strong'], `${themeName} 必须定义 --control-border-strong`).toBeTruthy()

      // 控件可能落在画布底、卡片底、次级底上，取最差的一档。
      const worst = (value: string) =>
        Math.min(
          contrastRatio(value, t['--paper-0']!),
          contrastRatio(value, t['--paper-1']!),
          contrastRatio(value, t['--paper-2']!)
        )

      const base = worst(t['--control-border']!)
      const strong = worst(t['--control-border-strong']!)
      console.log(`[P2-A] ${themeName} --control-border ${t['--control-border']} 最差 ${base.toFixed(2)}（阈值 3）`)
      console.log(`[P2-A] ${themeName} --control-border-strong ${t['--control-border-strong']} 最差 ${strong.toFixed(2)}`)
      expect(base, `${themeName} --control-border 应达 UI 3:1`).toBeGreaterThanOrEqual(3)
      // hover / 激活要更进一步，不能反而变淡。
      expect(strong, `${themeName} --control-border-strong 不应弱于 --control-border`).toBeGreaterThanOrEqual(base)

      // 语义不混用：控件描边不得直接取文字层 --ink-400 的值。
      expect(
        parseColor(t['--control-border']!),
        `${themeName} 控件描边不得复用文字 token --ink-400`
      ).not.toEqual(parseColor(t['--ink-400']!))
      // 也不得退回浅色 line token（实测 1.2–2.4:1）。
      expect(
        parseColor(t['--control-border']!),
        `${themeName} 控件描边不得退回 --line-2`
      ).not.toEqual(parseColor(t['--line-2']!))
    })
  }

  await test.step('真控件取 --control-border：按钮 / 输入框 / 开关轨道', async () => {
    await setThemeIsolated(page, 'paper')
    const rendered = await page.evaluate(() => {
      const host = document.createElement('div')
      host.style.position = 'fixed'
      host.style.left = '-9999px'
      host.innerHTML =
        '<button class="mjp-btn">按钮</button>' +
        '<input class="mjp-input" />' +
        '<div class="mjp-seg"><button>分段</button></div>' +
        '<span class="mjp-switch"><input type="checkbox" /><span class="track"></span></span>'
      document.body.appendChild(host)
      const read = (selector: string, prop: 'borderTopColor' | 'backgroundColor') => {
        const el = host.querySelector(selector)
        return el ? getComputedStyle(el as Element)[prop] : null
      }
      const out = {
        btn: read('.mjp-btn', 'borderTopColor'),
        input: read('.mjp-input', 'borderTopColor'),
        seg: read('.mjp-seg', 'borderTopColor'),
        track: read('.mjp-switch .track', 'backgroundColor')
      }
      host.remove()
      return out
    })
    const t = await readTokens(page, ['--control-border'])
    const expected = parseColor(t['--control-border']!)
    for (const [name, value] of Object.entries(rendered)) {
      expect(value, `.${name} 应被样式命中`).not.toBeNull()
      expect(parseColor(value!), `${name} 应取 --control-border`).toEqual(expected)
    }
  })
})

/**
 * P2-A 夜墨弱化文字（--ink-300）色相契约。
 *
 * P0 为了把禁用文字从 2.89:1 抬到可读，把夜墨 --ink-300 设成了 #8a8172 —— 那正是**暖纸**
 * 的值（R 比 B 高 24，暖褐色相），与夜墨整体的冷灰蓝底（#14161a / #1c1f24）不协调。
 * 对比度是达标的，问题只在色相。本条锁两件事：色相必须偏冷、对比度不得因此回退。
 * 暖纸 --ink-300 保持暖褐，本轮不动。
 */
test('P2-A 夜墨弱化文字：色相属夜墨冷灰系且对比度不回退', async ({ page }) => {
  await page.goto('/')

  await test.step('暖纸保持暖褐（本轮不动）', async () => {
    await setThemeIsolated(page, 'paper')
    const t = await readTokens(page, ['--ink-300', '--paper-0'])
    const { r, b } = parseColor(t['--ink-300']!)
    console.log(`[P2-A] paper --ink-300 ${t['--ink-300']} R=${r} B=${b}`)
    expect(r, '暖纸弱化文字应保持暖褐色相（R > B）').toBeGreaterThan(b)
  })

  await test.step('夜墨转冷灰且仍可读', async () => {
    await setThemeIsolated(page, 'night')
    const t = await readTokens(page, ['--ink-300', '--paper-0', '--paper-1', '--paper-3'])
    const { r, b } = parseColor(t['--ink-300']!)
    console.log(`[P2-A] night --ink-300 ${t['--ink-300']} R=${r} B=${b}`)
    expect(b, '夜墨弱化文字应属冷灰系（B ≥ R），不得沿用暖纸的暖褐值 #8a8172').toBeGreaterThanOrEqual(r)

    const onSurface = Math.min(
      contrastRatio(t['--ink-300']!, t['--paper-0']!),
      contrastRatio(t['--ink-300']!, t['--paper-1']!)
    )
    // --paper-3 是所有 :disabled 规则共用的禁用控件底色。
    const onDisabled = contrastRatio(t['--ink-300']!, t['--paper-3']!)
    console.log(`[P2-A] night --ink-300 对表面 ${onSurface.toFixed(2)} / 对禁用控件底 ${onDisabled.toFixed(2)}（阈值 3）`)
    expect(onSurface, '夜墨弱化文字对表面应 ≥ 3:1').toBeGreaterThanOrEqual(3)
    expect(onDisabled, '夜墨弱化文字对禁用控件底色应 ≥ 3:1').toBeGreaterThanOrEqual(3)
  })
})
