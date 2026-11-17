/**
 * 經手：這個 session 裡，主對話或某個 subagent 被交代了一張還沒結案的票、或改過它。
 * 從四種來源判斷（送出的 prompt、派 subagent 的 prompt、Write／Edit 的檔案、Bash／PowerShell 的指令），
 * 記成「票的 ref（本機是路徑）→ 最近一次經手的 loop」，只存在這個 session，不寫進票檔。
 */
import type { ModelUse, TaskBoard } from '../types'
import { isAbsolute, tidy } from './files'
import { ISSUE_COMMAND } from './remoteCore'
import { isEnded } from './tasks'

/** 經手的紀錄：票的 ref（本機是路徑）→ 最近一次經手的 loop（subagent 的 agentId；主對話是 null） */
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
 * 一段文字（或一個檔案路徑）對到哪幾張票。`open` 是所有還沒結案的票的 ref（本機票是相對於專案根目錄的路徑，
 * 遠端的票是 issue 網址）。
 * 本機的票：比對前把反斜線換成斜線、把專案底下的絕對路徑換成相對路徑；整個路徑、路徑的結尾幾段或只有檔名相同才算，
 * 光寫編號或標題不算。別的專案、別的 effort 底下的同名票不算。
 * 遠端的票：issue 網址或 `owner/repo#n` 相同才算，單獨的 `#n` 不算；`isShell`（文字是 shell 指令）時
 * 動到 issue 的指令（`ISSUE_COMMAND`，跟重讀同一份）也算：`gh／glab issue <子命令> n`、`gh api …/issues/n`、`glab api …/issues/n`。
 * 沒指定 repo 的就當本專案的票：`home` 是本專案 repo 裡任一張 issue 的網址（register 給地圖的網址），只配那個 repo；
 * 不知道本專案是哪個 repo（`home` 沒給）時配任一個 repo 的同號票。
 */
export function handledTickets(text: string, open: readonly string[], root: string | undefined, isShell = false, home?: string): string[] {
  const remote = open.filter(ref => issueOf(ref) !== undefined)
  const local = open.filter(ref => issueOf(ref) === undefined)
  const named = remote.length === 0 ? [] : issuesIn(text, isShell)
  const ours = home === undefined ? undefined : issueOf(home)
  const touchedRemote = remote.filter(ref => {
    const issue = issueOf(ref)
    return issue !== undefined && named.some(n => sameIssue(n.repo === undefined && ours !== undefined ? { ...n, host: ours.host, repo: ours.repo } : n, issue))
  })
  const touchedLocal = local.length === 0 ? [] : localHandled(text, local, root)
  return open.filter(ref => touchedRemote.includes(ref) || touchedLocal.includes(ref))
}

/** 文字可能提到票嗎：便宜的先擋，沒有就不必問引擎路線圖 */
export const mayNameTicket = (text: string) => /\.md\b|\/issues\/\d|[\w.-]\/[\w.-]+#\d|\bissue\s|\bapi\s/i.test(text)

/** 一張遠端的票（或文字裡提到的）：`host`、`repo` 沒寫就是本專案 */
type IssueAt = { host?: string; repo?: string; number: string }

/** issue 網址：主機、repo 路徑（GitLab 可有多層群組，`/issues` 前多一段 `/-`）、編號 */
const ISSUE_URL = /https?:\/\/([\w.-]+(?::\d+)?)\/([\w.-]+(?:\/[\w.-]+)+?)(?:\/-)?\/issues\/(\d+)(?!\d)/gi

/** `owner/repo#n`（GitLab 是 `group/sub/repo#n`）；前面接著網址或路徑的不算 */
const SHORT_REF = /(?<![\w./:#-])([\w.-]+(?:\/[\w.-]+)+)#(\d+)(?!\d)/g

const issueOf = (ref: string): IssueAt | undefined => {
  const m = new RegExp(`^${ISSUE_URL.source}$`, 'i').exec(ref)
  return m ? { host: m[1]?.toLowerCase(), repo: m[2]?.toLowerCase(), number: String(Number(m[3])) } : undefined
}

const sameIssue = (named: IssueAt, ref: IssueAt) =>
  named.number === ref.number &&
  (named.repo === undefined || named.repo === ref.repo || named.repo === `${ref.host}/${ref.repo}`) &&
  (named.host === undefined || named.host === ref.host)

/** 文字裡提到的票：網址、`owner/repo#n`；shell 指令再加上 gh／glab 的 issue 指令 */
function issuesIn(text: string, isShell: boolean): IssueAt[] {
  const found: IssueAt[] = []
  for (const m of text.matchAll(ISSUE_URL))
    found.push({ host: m[1]?.toLowerCase(), repo: m[2]?.toLowerCase(), number: String(Number(m[3])) })
  for (const m of text.matchAll(SHORT_REF)) found.push({ repo: m[1]?.toLowerCase(), number: String(Number(m[2])) })
  if (isShell) for (const part of text.split(/[;&|\r\n]+/)) found.push(...cliIssue(part))
  return found
}

/** 沒有填 owner/repo 的佔位寫法（`gh api repos/{owner}/{repo}/…`、`:owner/:repo`）就是本專案 */
const PLACEHOLDER = /^(?:\{[\w-]+\}|:[\w-]+)$/

/** 一段 shell 指令（已經按 `;`、`&&`、`|` 拆開）裡 gh／glab 指名的票；哪些指令算動到 issue 照 `ISSUE_COMMAND`（跟重讀同一份） */
function cliIssue(part: string): IssueAt[] {
  const command = ISSUE_COMMAND.exec(part)
  if (command === null) return []
  const rest = part.slice(command.index + command[0].length)
  if (command[2]?.toLowerCase() === 'api') {
    // gh：`repos/<owner>/<repo>/issues/n`；glab：`projects/<:id 或 group%2Fapp>/issues/n`（數字 id 對不到 repo，不算）
    const api = /^\s.*?(?:\b(?:repos\/([^/\s'"]+)\/([^/\s'"]+)|projects\/([^/\s'"]+))\/)?issues\/(\d+)(?!\d)/i.exec(rest)
    if (!api) return []
    const [, owner, repo, project, n] = api
    const number = String(Number(n))
    if (project !== undefined) {
      if (PLACEHOLDER.test(project)) return [{ number }]
      const path = decodeURIComponent(project)
      return path.includes('/') ? [{ repo: path.toLowerCase(), number }] : []
    }
    const isNamed = owner !== undefined && repo !== undefined && !PLACEHOLDER.test(owner) && !PLACEHOLDER.test(repo)
    return [{ ...(isNamed ? { repo: `${owner}/${repo}`.toLowerCase() } : {}), number }]
  }
  const cli = /^\s+[\w-]+(.*)$/.exec(rest)
  if (!cli) return []
  // 子命令後第一個位置參數的數字就是票號；跟在旗標後面的是旗標的值（`--limit 50`），`-R`／`--repo` 指定 repo
  let number: string | undefined
  let repo: string | undefined
  const words = (cli[1] ?? '').trim().split(/\s+/).map(w => w.replace(/^['"]|['"]$/g, ''))
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? ''
    const repoFlag = /^(?:-R|--repo)(?:=(.+))?$/.exec(word)
    if (repoFlag) {
      repo = repoFlag[1] ?? words[(i += 1)]
    } else if (word.startsWith('-')) {
      if (!word.includes('=')) i += 1
    } else if (number === undefined && /^\d+$/.test(word)) {
      number = String(Number(word))
    }
  }
  if (number === undefined) return []
  return [{ ...(repo === undefined ? {} : { repo: repo.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '') }), number }]
}

/** 本機的票：路徑比對（見 `handledTickets`） */
function localHandled(text: string, open: readonly string[], root: string | undefined): string[] {
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
