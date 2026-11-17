/**
 * 遠端路線圖讀得怎樣（票 20）：讀不到的原因怎麼分、面板上怎麼畫。不碰引擎。
 * 分類（`problemOf`）由 `remoteCore` 的 `getJson` 用；面板（`remoteNotice`）由 register.tsx 照它畫。
 * 依嚴重程度三種畫法（決策票 10）：完全沒資料 → 框內頂端一行；有上次結果 → effort 變暗、下框線短標籤、說明區寫原因；
 * 第一次讀取 → 框內暗色「讀取中…」。
 */
import type { RemoteProblem, RemoteStatus, RemoteTracker } from '../types'

export type { RemoteProblem, RemoteStatus, RemoteTracker }

/** 讀不到遠端時丟的錯誤：帶著分類，`message` 是寫進 debug log 的完整原因 */
export class RemoteError extends Error {
  constructor(
    readonly problem: RemoteProblem,
    message: string,
  ) {
    super(message)
  }
}

/** `gh`／`glab` 起不來之後過了這麼久（毫秒）才 reject 的算逾時（引擎的逾時是 reject，跟起不來分不開，只能看時間） */
export const TIMEOUT_AFTER = 25_000

/** CLI 的 stderr 上畫面、進 debug log 前最多留幾個字 */
const SAID_MAX = 300

/** 看起來像 token 的字串：GitHub 的 `ghp_`／`gho_`／`ghu_`／`ghs_`／`ghr_`、fine-grained `github_pat_`、GitLab 的 `glpat-` */
const TOKEN_LIKE = /\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,})/g

/** `gh`／`glab` 說的話（stderr、錯誤訊息）上畫面或進 debug log 前：遮掉像 token 的字串、截到 `SAID_MAX` 字 */
export function redact(text: string): string {
  const masked = text.replace(TOKEN_LIKE, '***')
  return masked.length > SAID_MAX ? `${masked.slice(0, SAID_MAX)}…` : masked
}

/** `gh`／`glab` 的一次結果（`-i`：狀態碼與 header 名稱小寫；沒有狀態行時 `status` 是 undefined） */
type ApiAnswer = { status?: number; headers: Record<string, string>; stderr: string; exitCode: number }

/**
 * `gh api -i`／`glab api -i` 不成功的結果 → 原因。沒有狀態行時看 stderr（CLI 自己的字樣：未登入叫你 `gh auth login`／`glab auth login`、
 * remote 不是 GitHub／GitLab 時說 known GitHub／GitLab host、連不上說 error connecting）。glab 的字樣**未實測**，照 gh 的推。
 */
export function problemOf({ status, headers, stderr, exitCode }: ApiAnswer): RemoteProblem {
  const said = redact(stderr.trim())
  if (status === undefined) {
    if (/known (?:GitHub|GitLab) host/i.test(said)) return { kind: 'mismatch' }
    if (exitCode === 4 || /(?:gh|glab) auth login/.test(said)) return { kind: 'noAuth' }
    if (/error connecting|timeout|timed out|no such host|dial tcp/i.test(said)) return { kind: 'offline', isTimeout: false }
    return { kind: 'failed', reason: said || `結束碼 ${exitCode}` }
  }
  if (status === 401) return { kind: 'noAuth' }
  if (status === 404) return { kind: 'notFound' }
  if (status === 429 || (status === 403 && headers['x-ratelimit-remaining'] === '0')) {
    // GitHub 是 X-RateLimit-Reset，GitLab 是 RateLimit-Reset（都是秒）
    const reset = Number(headers['x-ratelimit-reset'] ?? headers['ratelimit-reset'])
    return { kind: 'rateLimit', ...(Number.isFinite(reset) && reset > 0 ? { resetAt: reset * 1000 } : {}) }
  }
  return { kind: 'failed', reason: `HTTP ${status}${said ? ` ${said}` : ''}` }
}

/** `git remote get-url` 的網址 → `owner/repo` */
export function repoOfRemote(url: string): string | undefined {
  return /[/:]([^/:\s]+\/[^/\s]+?)(?:\.git)?\/?\s*$/.exec(url.trim())?.[1]
}

/** 面板上的樣子：`top` 是框內頂端一行；`isStale` 時 effort 變暗、下框線加 `tag`、說明區寫 `reason` */
export type RemoteNotice = {
  top?: { text: string; tone: 'dim' | 'warning' | 'error' }
  isStale: boolean
  tag?: string
  reason?: string
}

/** 每種 tracker 的字樣與指令 */
const WORDS: Record<RemoteTracker, { name: string; cli: string; install: string; notFound: string; issues: string }> = {
  github: { name: 'GitHub', cli: 'gh', install: 'winget install GitHub.cli', notFound: '或用 gh auth switch 換帳號', issues: 'GitHub issue' },
  gitlab: { name: 'GitLab', cli: 'glab', install: 'winget install glab.glab', notFound: '或用 glab auth login 登入有權限的帳號', issues: 'GitLab issue' },
}

/** 完全沒資料時頂端那一行（含要執行的指令） */
function fullText(p: RemoteProblem, tracker: RemoteTracker, clock: (ms: number) => string): { text: string; tone: 'warning' | 'error' } {
  const w = WORDS[tracker]
  switch (p.kind) {
    case 'noCli':
      return { text: `找不到 ${w.cli}（或只有 .cmd shim）。安裝：${w.install}，再執行 ! ${w.cli} auth login`, tone: 'warning' }
    case 'noAuth':
      return { text: `${w.cli} 沒有登入 ${w.name}。執行：! ${w.cli} auth login`, tone: 'warning' }
    case 'notFound':
      return { text: `讀不到 ${p.repo ?? '這個專案的 repo'}（404）：可能沒有權限，${w.notFound}`, tone: 'error' }
    case 'mismatch':
      return { text: `tracker 文件寫 ${w.name}，但 git remote 不是 ${w.cli} 認得的 ${w.name} 主機。請修正 docs/agents/issue-tracker.md`, tone: 'error' }
    case 'offline':
      return { text: `連不到 ${w.name}${p.isTimeout ? '（逾時）' : ''}。按 r 重試`, tone: 'warning' }
    case 'rateLimit':
      return { text: `${w.name} API 額度用完${p.resetAt !== undefined ? `，${clock(p.resetAt)} 恢復` : ''}。按 r 重試`, tone: 'warning' }
    case 'failed':
      return { text: `讀取失敗：${p.reason}。按 r 重試`, tone: 'error' }
  }
}

/** 下框線的短標籤（`找不到 gh` 的 CLI 名稱另外補） */
const SHORT: Record<RemoteProblem['kind'], string> = {
  noCli: '找不到',
  noAuth: '未登入',
  notFound: '讀不到 repo',
  mismatch: '文件與 remote 不一致',
  offline: '離線',
  rateLimit: '額度用完',
  failed: '讀取失敗',
}

/**
 * 遠端狀態 → 面板上的樣子。`clock` 把毫秒寫成「13:40」（本地時間，register 傳 `clockOf`）。
 * 讀過之後才失敗的不論原因都保留上次結果、變暗；從沒讀到過的寫頂端一行。字樣與指令照 `tracker`（GitHub／GitLab）
 */
export function remoteNotice(status: RemoteStatus | null, clock: (ms: number) => string): RemoteNotice {
  if (status === null || status.kind === 'ok') return { isStale: false }
  const w = WORDS[status.tracker]
  if (status.kind === 'loading') return { top: { text: `讀取 ${w.issues} 中…`, tone: 'dim' }, isStale: false }
  const { problem, shownAt, tracker } = status
  if (shownAt === undefined) {
    const { text, tone } = fullText(problem, tracker, clock)
    return { top: { text: `⚠ ${text}`, tone }, isStale: false }
  }
  const short = problem.kind === 'offline' && problem.isTimeout ? '逾時' : problem.kind === 'noCli' ? `${SHORT.noCli} ${w.cli}` : SHORT[problem.kind]
  const shown = `顯示 ${clock(shownAt)} 的結果`
  const reason =
    problem.kind === 'offline'
      ? `連不到 ${w.name}${problem.isTimeout ? '（逾時）' : ''}。${shown}，按 r 重試`
      : problem.kind === 'rateLimit'
        ? `${w.name} API 額度用完${problem.resetAt !== undefined ? `，${clock(problem.resetAt)} 恢復` : ''}。${shown}`
        : `${fullText(problem, tracker, clock).text.replace(/。按 r 重試$/, '')}。${shown}，按 r 重試`
  return { isStale: true, tag: `${short} · ${clock(shownAt)}`, reason }
}
