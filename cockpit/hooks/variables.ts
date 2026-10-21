/**
 * prompt 變數：常用 prompt 裡的 `{{中文名}}`，cockpit 從 [基本] 填入或送出時換成當下的值。
 * 只認得 `VARIABLES` 裡的名稱，其他 `{{x}}` 原樣保留；使用者自己在輸入框打的不動（不掛 prompt hook）。
 */
import type { Handled } from './handled'
import { isAbsolute, tidy } from './files'

/** 認得的變數名稱 */
export const VARIABLES = ['票', '分支'] as const
export type VariableName = (typeof VARIABLES)[number]

/** 每個變數取到的值；取不到的不放 */
export type VariableValues = Partial<Record<VariableName, string>>

const PATTERN = /\{\{([^{}]*)\}\}/g
const isVariable = (name: string): name is VariableName => (VARIABLES as readonly string[]).includes(name)

/** 文字裡出現了哪些認得的變數（不重複，照出現順序）；空的就不必讀任何東西 */
export function variablesIn(text: string): VariableName[] {
  const found: VariableName[] = []
  for (const [, name = ''] of text.matchAll(PATTERN)) if (isVariable(name) && !found.includes(name)) found.push(name)
  return found
}

/** 代換：取到的換成值，取不到的留原字並列在 `missing`（照出現順序、不重複） */
export function substitute(text: string, values: VariableValues): { text: string; missing: VariableName[] } {
  const missing: VariableName[] = []
  const out = text.replace(PATTERN, (whole, name: string) => {
    if (!isVariable(name)) return whole
    const value = values[name]
    if (value !== undefined) return value
    if (!missing.includes(name)) missing.push(name)
    return whole
  })
  return { text: out, missing }
}

/** 取不到時的 toast：「取不到『票』」，好幾個就接著寫 */
export const missingNotice = (missing: readonly VariableName[]) => `取不到${missing.map(n => `『${n}』`).join('')}`

/**
 * `{{票}}` 的值：主對話最近經手的那一張票（經手紀錄裡最近經手的排在後面；subagent 經手的不算）。
 * 專案底下的路徑換成相對於專案根目錄；換不了就用原路徑。沒有就是 undefined，不退而找別的票。
 */
export function latestMainTicket(handled: Handled, root: string | undefined): string | undefined {
  const path = Object.entries(handled)
    .reverse()
    .find(([, by]) => by === null)?.[0]
  if (path === undefined) return undefined
  if (root === undefined || root === '' || !isAbsolute(path)) return path
  const base = `${tidy(root)}/`
  const normal = tidy(path)
  return normal.toLowerCase().startsWith(base.toLowerCase()) ? normal.slice(base.length) : path
}

/**
 * `{{分支}}` 的值：`git rev-parse --abbrev-ref HEAD` 的結果 → 分支名稱。
 * 執行失敗（不在 git repo 等）、沒印東西、detached HEAD（印出 `HEAD`）都算取不到。
 */
export function branchOf(ran: { exitCode: number; stdout: string }): string | undefined {
  const name = ran.stdout.trim()
  return ran.exitCode !== 0 || name === '' || name === 'HEAD' ? undefined : name
}
