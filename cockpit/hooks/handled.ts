/**
 * 經手：這個 session 裡，主對話或某個 subagent 被交代了一張還沒結案的票、或改過它。
 * 從四種來源判斷（送出的 prompt、派 subagent 的 prompt、Write／Edit 的檔案、Bash／PowerShell 的指令），
 * 記成「票的路徑 → 最近一次經手的 loop」，只存在這個 session，不寫進票檔。
 */
import type { ModelUse, TaskBoard } from '../types'
import { isAbsolute, tidy } from './files'
import { isEnded } from './tasks'

/** 經手的紀錄：票的路徑 → 最近一次經手的 loop（subagent 的 agentId；主對話是 null） */
export type Handled = Readonly<Record<string, string | null>>

/** 會改變經手紀錄的事 */
export type HandledEvent =
  /** 某個 loop（主對話沒有 agentId）經手了這幾張票：新的覆蓋舊的 */
  | { kind: 'touched'; tickets: readonly string[]; agentId?: string }
  /** subagent 結束了：它經手的票都拿掉 */
  | { kind: 'ended'; agentId: string }
  /** 路線圖重讀了：只留還沒結案的票 */
  | { kind: 'closed'; open: readonly string[] }

/** 經手的紀錄怎麼變；沒變就回傳同一份，不必重畫 */
export function applyHandled(handled: Handled, event: HandledEvent): Handled {
  const keep = (ok: (path: string, by: string | null) => boolean) => {
    const kept = Object.entries(handled).filter(([path, by]) => ok(path, by))
    return kept.length === Object.keys(handled).length ? handled : Object.fromEntries(kept)
  }
  switch (event.kind) {
    case 'touched': {
      const by = event.agentId ?? null
      if (event.tickets.every(t => handled[t] === by)) return handled
      // 刪掉再加：最近經手的排在後面
      const rest = Object.entries(handled).filter(([path]) => !event.tickets.includes(path))
      return Object.fromEntries([...rest, ...event.tickets.map(t => [t, by] as const)])
    }
    case 'ended':
      return keep((_, by) => by !== event.agentId)
    case 'closed': {
      const open = new Set(event.open)
      return keep(path => open.has(path))
    }
  }
}

/** 路線圖上一張被經手的票要畫的：要標的模型與深度（主對話經手的沒有），以及說明區最前面那一行 */
export type HandlerMark = { use?: ModelUse; note: string }

/**
 * 經手的票 → 它的標示。subagent 經手的標它最近一次的模型與深度，說明區寫「subagent「<描述>」在做」；
 * 主對話經手的不標模型（一定跟主對話相同），說明區寫「主對話在做」。已經結束的 subagent 經手的不算。
 */
export function handlerMarks(handled: Handled, board: TaskBoard): Map<string, HandlerMark> {
  const marks = new Map<string, HandlerMark>()
  for (const [path, by] of Object.entries(handled)) {
    if (by === null) {
      marks.set(path, { note: '主對話在做' })
      continue
    }
    const agent = board.agents.find(g => g.id === by)
    if (agent === undefined || isEnded(agent)) continue
    marks.set(path, { use: agent.model, note: `subagent「${agent.label}」在做` })
  }
  return marks
}

/** 路徑在文字裡的邊界：空白、引號、括號這類，以及非 ASCII 的字（中文直接接著路徑寫也拆得開） */
const PATH_EDGE = /[\s'"`()<>[\]{}=,;|*]|[^\x00-\x7f]/

/** 檔名後面還接著這些字就不是同一個檔（`08-a.mdx`、`08-a.md-old`） */
const NAME_CHAR = /[\w-]/

/**
 * 一段文字（或一個檔案路徑）對到哪幾張票。`open` 是所有還沒結案的票的路徑（相對於專案根目錄）。
 * 比對前把反斜線換成斜線、把專案底下的絕對路徑換成相對路徑；整個路徑、路徑的結尾幾段或只有檔名相同才算，
 * 光寫編號或標題不算。別的專案、別的 effort 底下的同名票不算。
 */
export function handledTickets(text: string, open: readonly string[], root: string | undefined): string[] {
  const normal = text.replace(/\\/g, '/')
  const base = root === undefined || root === '' ? undefined : `${tidy(root).toLowerCase()}/`
  // 文字裡每個檔名出現的地方，往前取到邊界為止的那一段路徑
  const tokensOf = (file: string) => {
    const found: string[] = []
    for (let at = normal.indexOf(file); at >= 0; at = normal.indexOf(file, at + 1)) {
      const end = at + file.length
      if (end < normal.length && NAME_CHAR.test(normal[end] ?? '')) continue
      let start = at
      while (start > 0 && !PATH_EDGE.test(normal[start - 1] ?? '')) start -= 1
      found.push(normal.slice(start, end))
    }
    return found
  }
  const relative = (token: string) => {
    const trimmed = token.replace(/^(?:\.\/)+/, '')
    return base !== undefined && trimmed.toLowerCase().startsWith(base) ? trimmed.slice(base.length) : trimmed
  }
  return open.filter(path => {
    const file = path.slice(path.lastIndexOf('/') + 1)
    return tokensOf(file).some(token => {
      const rel = relative(token)
      return rel === path || (!isAbsolute(rel) && path.endsWith(`/${rel}`))
    })
  })
}
