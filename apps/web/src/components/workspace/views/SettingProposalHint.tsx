import { Sparkles } from 'lucide-react'
import { Btn } from '../../ui/Primitives'

/**
 * 跨栏目提示（D6「其他栏目仅显示提示与跳转」）。
 *
 * 设定提案只有「世界观 · 扩展世界观」一个管理界面。记忆与伏笔、审稿与导出这两个
 * 栏目**不复制**一份提案界面，只如实告诉作者：在这里发现的东西如果是世界观设定，
 * 该去哪儿暂存；点按钮直接跳过去。
 *
 * 为什么要有它：正文分析、记忆提案、审稿问题里都会冒出「这是个新设定」的判断，
 * 但按 D7 的收口规则，能改正式世界观的页面只能有一个。没有这条提示，作者只能自己猜。
 */
export function SettingProposalHint({
  scope,
  onOpen
}: {
  /** 本栏目实际负责什么（写进文案，避免出现「本栏目」这种含糊说法）。 */
  scope: string
  /** 跳到唯一管理界面：世界观 · 扩展世界观。 */
  onOpen: () => void
}): React.JSX.Element {
  return (
    <div className="mjp-notice is-inline" data-testid="setting-proposal-hint">
      <div className="ic" aria-hidden="true"><Sparkles size={18} strokeWidth={1.8} /></div>
      <div>
        <b>世界观新设定不在这里暂存</b>
        <p>
          本栏目只负责{scope}。如果这里出现的东西其实是一条新的世界设定（人物、地点、器物、规则），
          请到「世界观 · 扩展世界观」暂存为设定提案 —— 暂存不进正式世界观，采用之后才会写进去。
        </p>
        <Btn size="sm" data-testid="setting-proposal-hint-open" onClick={onOpen}>打开设定提案</Btn>
      </div>
    </div>
  )
}
