import { createContext, useContext, useEffect } from 'react'

/* 页头动作槽。
 *
 * 参考样例把「恢复默认 / 应用」放在栏目标题右侧，但按钮的可用状态属于各栏目
 * 自己的状态（例如「模型 API」要先取回已保存的配置才知道能不能测试）。
 * 所以由栏目通过本 context 注册自己的动作节点，设置页只负责摆放位置，
 * 避免把七个栏目的按钮状态全部抬到页面组件里。 */

const PaneActionsContext = createContext<(node: React.ReactNode) => void>(() => {})

export const PaneActionsProvider = PaneActionsContext.Provider

/** 把当前栏目的页头动作注册上去；传 null 表示该栏目不需要页头动作。 */
export function usePaneActions(node: React.ReactNode): void {
  const setActions = useContext(PaneActionsContext)
  useEffect(() => {
    setActions(node)
    return () => setActions(null)
  }, [setActions, node])
}
