import type { RoadmapEvent } from './roadmap'

/**
 * 引擎的事件對面板代表什麼。登記 hook 的程式在 `register.tsx`，這裡只回答「這件事算什麼」。
 */

/** 工具跑完的結果裡，面板看的兩欄 */
type Ran = { deny?: unknown; isError?: boolean }

/**
 * 工具有沒有真的跑完而且成功：沒被擋下，也沒回報錯誤。是型別守衛：成立時 `ran.result` 縮成那個工具的結果
 */
export const succeeded = <R extends Ran>(ran: R): ran is Exclude<R, { deny: string } | { isError: true }> =>
  ran.deny === undefined && ran.isError !== true

/** 寫檔的工具：成功寫了哪個檔，由 roadmap 看要不要重讀 */
export const wroteFile = (path: string, ran: Ran): RoadmapEvent => ({ kind: 'wrote', path, isOk: succeeded(ran) })

/** shell 的工具：指令失敗也可能已經改了檔案，所以只排除被擋下、根本沒跑的 */
export const ranShell = (ran: Ran): RoadmapEvent => ({ kind: 'ran', isBlocked: ran.deny !== undefined })

/** 例外或其他丟出來的東西 → 說給使用者聽的原因 */
export const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** 某一刻的日期（YYYY-MM-DD，本地時間）；`ms` 來自引擎的時鐘 */
export function dateOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
