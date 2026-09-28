import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `.superpowers/` 是自带 `.gitignore`（内容为 `*`）的协作草稿目录，里面的 `*.spec.ts`
    // 是 Playwright 用例（配 `playwright.*.config.ts`），本就不该被 vitest 收集——与已有的
    // `tests/e2e/**` 排除同类。此处按**目录边界**精确排除，不针对具体失败文件。
    //
    // `.workbuddy/` 是 AI 任务工作目录（项目记忆、脚手架/交付产出、任务报告，以及 UI 阶段改动的
    // 「改动前快照」）。其中的快照目录会把当次任务的 Playwright `*.spec.ts` 原样留存，
    // 这些文件属于「历史取证副本」而非现役用例，被 vitest 收集后会直接红：
    //   Error: Playwright Test did not expect test() to be called here.
    // 按**整个任务目录**排除（而非列举具体文件名/目录名），后续任意阶段的新快照自动生效。
    // 排除面刻意保持在「目录」粒度：既不点名历史文件，也不波及 `apps/**`、`packages/**`、
    // 仓库正式 `tests/**`（`tests/e2e/**` 的排除是既有的独立规则）。
    exclude: [
      ...configDefaults.exclude,
      'tests/e2e/**',
      'backups/**',
      '.mojing-dev/**',
      '.superpowers/**',
      '.workbuddy/**'
    ]
  }
})
