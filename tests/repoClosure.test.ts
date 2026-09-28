import { describe, expect, it } from 'vitest'
// 守卫以 ESM 脚本形式实现，便于在 npm 脚本与测试中复用同一套判定逻辑。
import { auditRepoClosure } from '../tools/check-repo-closure.mjs'

/**
 * 阶段 0.5C · 仓库闭包门禁
 *
 * 这里只把 Tier 1（磁盘闭包）作为持续门禁：
 * 只要有正式源码引用了不存在的相对路径或未声明的 package 子路径，测试立即失败。
 *
 * Tier 2（提交树闭包 / 可复现）依赖「本次改动是否已经 git add」，
 * 在未落地阶段会让测试常红，因此由 npm run check:closure:strict 承担门禁，
 * 落地完成后应把该命令纳入交付检查表。
 */
describe('仓库闭包（阶段 0.5C）', () => {
  const report = auditRepoClosure({ repoRoot: process.cwd() })

  it('扫描到正式源码与导入边', () => {
    expect(report.scannedCount).toBeGreaterThan(0)
    expect(report.treeScannedCount).toBeGreaterThan(0)
    expect(report.edgeCount).toBeGreaterThan(0)
  })

  it('磁盘闭包：正式源码不存在悬空相对导入与未声明的 package 子路径', () => {
    const dangling = report.tier1.dangling.map(
      (violation) => `${violation.kind} ${violation.file} «${violation.specifier}»`
    )
    expect(dangling).toEqual([])
  })

  it('磁盘闭包：workspace package.json 的 exports / main 目标都存在', () => {
    const missing = report.tier1.packageTargetMissing.map(
      (violation) => `${violation.file} ${violation.specifier}`
    )
    expect(missing).toEqual([])
  })
})
