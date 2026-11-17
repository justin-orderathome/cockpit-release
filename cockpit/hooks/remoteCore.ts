import type { Effort } from '../types'
import { gistDetail, judgeEffort, mapGists, section } from './effortJudge'
import type { BlockedBy, CliRun, NormalizedEffort, NormalizedStatus, NormalizedTicket } from './effortJudge'
import { reasonOf } from './events'
import type { RoadmapEvent } from './roadmap'
import { RemoteError, TIMEOUT_AFTER, problemOf, redact, repoOfRemote } from './remoteStatus'
import type { RemoteProblem, RemoteStatus, RemoteTracker } from './remoteStatus'


/**
 * 遠端路線圖的共用核心：GitHub（`githubRoadmap`）與 GitLab（`gitlabRoadmap`）的讀取器只留各自的 API 路徑與 JSON 解析，
 * 其餘都在這裡——什麼時候連網（`shouldRead`）、送出與解析回應（`getJson`：ETag／304、失敗分類）、
 * 一輪蓋過一輪與讀得怎樣（`remoteReader`）、一張地圖怎麼正規化（`normalizeRemoteEffort`）。
 * 這個模組不碰引擎：`gh`／`glab` 由 `RemotePorts.run` 跑，register.tsx 包好傳進來。
 */

/** register.tsx 傳進來的引擎操作 */
export type RemotePorts = {
  /** 跑 `gh`／`glab`：argv 執行、cwd 是專案根目錄 */
  run: CliRun
  /** 寫一行 debug log；不得含 token */
  log: (text: string) => void
  /** 現在幾點（毫秒，引擎的時鐘）：切到 [任務] 的 60 秒門檻 */
  now: () => Promise<number>
  /** 讀得怎樣（票 20）：讀取中、讀到了、讀不到與原因；`null` 是不讀遠端了。沒給就不報 */
  status?: (status: RemoteStatus | null) => Promise<void>
  /** 畫面上展開著的 effort 名稱：重讀時順便抓它們的擋路者清單（票 19）。沒給就當都沒展開 */
  openEfforts?: () => Promise<readonly string[]>
}

/** 遠端讀取器：`roadmapSource` 在 tracker 文件寫 GitHub 或 GitLab 時把事件交給它 */
export type RemoteReader = {
  /** 一件事之後讀到的 efforts；不必連網、讀失敗（已寫 debug log）或被更新的一輪蓋過都是 undefined */
  next: (event: RoadmapEvent, ports: RemotePorts) => Promise<Effort[] | undefined>
  /** `/clear`：讀到一半的結果不算數 */
  reset: () => void
}

/** 畫面與 debug log 上的名稱 */
export const TRACKER_NAME: Record<RemoteTracker, string> = { github: 'GitHub', gitlab: 'GitLab' }

/** 遠端票「單張」接在後面的結案說法：遠端沒有 `Status:` 行 */
export const REMOTE_CLOSE_HINT = '完成後照 tracker 文件留言並關閉這張 issue。'

/** 地圖 issue 的標籤；子票的 `wayfinder:<type>` 標籤表示決策票 */
export const MAP_LABEL = 'wayfinder:map'
export const DECISION_LABEL = /^wayfinder:(?!map$)/

// ── 什麼時候連網 ─────────────────────────────────────────

/** 切到 [任務] 時，距離上次讀取超過這麼久（毫秒）才重讀 */
export const REREAD_AFTER = 60_000

/**
 * 動到 issue 的 shell 指令（唯一的一份）：`gh`／`glab`（可帶 `.exe`）接 `issue` 或 `api`。
 * 重讀（故事 39）四種都認；經手（`handled.ts`，故事 33）也用它找指令，再從指令裡取票號
 */
export const ISSUE_COMMAND = /(?:^|[^\w.-])(gh|glab)(?:\.exe)?\s+(issue|api)\b/i

/**
 * 這件事要不要連網重讀（票 08）：session 開始不讀；按 r 一律讀；切到 [任務] 距離上次讀取（`lastRead`，沒讀過是 undefined）
 * 超過 60 秒才讀；這個 session 讀過之後（讀失敗也算讀過），跑完的 shell 指令（被擋下的不算）含動到 issue 的指令就讀。不定時重讀
 */
export function shouldRead(event: RoadmapEvent, lastRead: number | undefined, now: number): boolean {
  if (event.kind === 'reload') return true
  if (event.kind === 'open') return lastRead === undefined || now - lastRead > REREAD_AFTER
  if (event.kind === 'ran') return lastRead !== undefined && !event.isBlocked && ISSUE_COMMAND.test(event.command ?? '')
  return false
}

// ── 送出與解析回應 ─────────────────────────────────────────

/** `gh api -i`／`glab api -i` 的輸出：狀態碼、header（名稱小寫）與 body */
export type ApiOutput = { status: number; headers: Record<string, string>; body: string }

/** `-i` 的輸出拆成狀態碼、header 與 body；沒有狀態行（例如連不上）是 undefined。glab 的 api 指令移植自 gh，格式相同 */
export function parseApiOutput(stdout: string): ApiOutput | undefined {
  const text = stdout.replace(/\r\n/g, '\n')
  const status = /^HTTP\/[\d.]+\s+(\d{3})/.exec(text)
  if (status === null) return undefined
  const blank = text.indexOf('\n\n')
  const head = blank < 0 ? text : text.slice(0, blank)
  const headers: Record<string, string> = {}
  for (const line of head.split('\n').slice(1)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return { status: Number(status[1]), headers, body: blank < 0 ? '' : text.slice(blank + 2) }
}

/**
 * 一個要讀的端點：`key` 是記 ETag 的鍵（同一個 session 內唯一）；`argv(etag)` 組出只讀的 CLI 參數；
 * `repo` 是別的 repo／專案時的名稱（404 時說出讀不到哪個），專案自己的沒有。由各讀取器的建構器（`ghEndpoint`、`glabEndpoint`）產生
 */
export type Endpoint = { key: string; argv: (etag?: string) => string[]; repo?: string }

/** 這個 session 讀過的每個端點：上次 200 的 ETag 與解析好的 JSON。`/clear` 清掉 */
export type Etags = Map<string, { etag: string; json: unknown }>

/** 404 時說出讀不到的是哪個 repo：照專案的 git remote（`gh`／`glab` 也是從它找專案）；讀不到就不說 */
async function remoteRepo(ports: RemotePorts): Promise<string | undefined> {
  try {
    const ran = await ports.run(['git', 'remote', 'get-url', 'origin'])
    return ran.exitCode === 0 ? repoOfRemote(ran.stdout) : undefined
  } catch (err) {
    ports.log(`讀 git remote 失敗：${reasonOf(err)}`)
    return undefined
  }
}

const withRepo = (repo: string | undefined) => (repo === undefined ? {} : { repo })

/**
 * 跑一個端點、回 JSON；起不來、沒有狀態行、非 2xx、JSON 壞掉都丟出帶分類的 `RemoteError`（票 20，分類在 `remoteStatus`）。
 * 記過 ETag 的端點帶 `If-None-Match`：304（gh 的結束碼是 1，所以看狀態行）就沿用上次解析好的、不重新解析。
 * CLI 的 stderr 進錯誤訊息前遮掉像 token 的字串、截長度（`redact`）
 */
export async function getJson<T>(ports: RemotePorts, endpoint: Endpoint, etags: Etags): Promise<T> {
  const known = etags.get(endpoint.key)
  const argv = endpoint.argv(known?.etag)
  const name = endpoint.key
  let ran: Awaited<ReturnType<CliRun>>
  const started = await ports.now()
  try {
    ran = await ports.run(argv)
  } catch (err) {
    // 引擎的逾時也是 reject：跑了夠久才 reject 的算逾時，其他算起不來（沒裝、只有 .cmd shim）
    if ((await ports.now()) - started >= TIMEOUT_AFTER) throw new RemoteError({ kind: 'offline', isTimeout: true }, `${name}：${argv[0]} 逾時（${reasonOf(err)}）`)
    throw new RemoteError({ kind: 'noCli' }, `${argv[0]} 起不來（${reasonOf(err)}）`)
  }
  const res = parseApiOutput(ran.stdout)
  const stderr = redact(ran.stderr.trim())
  if (res === undefined)
    throw new RemoteError(problemOf({ headers: {}, stderr: ran.stderr, exitCode: ran.exitCode }), `${name}：${stderr || `結束碼 ${ran.exitCode}`}`)
  if (res.status === 304 && known !== undefined) return known.json as T
  if (res.status < 200 || res.status >= 300) {
    const problem = problemOf({ status: res.status, headers: res.headers, stderr: ran.stderr, exitCode: ran.exitCode })
    // 多帳號（票 21）在 `ghAccounts` 包的 `run` 裡已經試過：到這裡的 404 是每個帳號都讀不到
    const found: RemoteProblem = problem.kind === 'notFound' ? { ...problem, ...withRepo(endpoint.repo ?? (await remoteRepo(ports))) } : problem
    throw new RemoteError(found, `${name}：HTTP ${res.status} ${stderr}`.trim())
  }
  let json: T
  try {
    json = JSON.parse(res.body) as T
  } catch (err) {
    throw new RemoteError({ kind: 'failed', reason: `回應不是 JSON（${reasonOf(err)}）` }, `${name}：回應不是 JSON（${reasonOf(err)}）`)
  }
  const etag = res.headers['etag']
  if (etag) etags.set(endpoint.key, { etag, json })
  else etags.delete(endpoint.key)
  return json
}

/** 地圖清單最多翻幾頁（每頁 100 張）：超過的照「最近更新的在前」只列前面的，寫 debug log */
export const MAP_PAGES = 5
/** 一頁的張數；回滿一頁才翻下一頁 */
export const PAGE_SIZE = 100

/** 地圖清單：照最近更新排序（已結案的最近結案的在前面幾頁），回滿一頁就翻下一頁，最多 `MAP_PAGES` 頁 */
export async function getPages<T>(ports: RemotePorts, page: (n: number) => Endpoint, etags: Etags): Promise<T[]> {
  const all: T[] = []
  for (let n = 1; n <= MAP_PAGES; n += 1) {
    const got = await getJson<T[]>(ports, page(n), etags)
    all.push(...got)
    if (got.length < PAGE_SIZE) return all
  }
  ports.log(`地圖超過 ${MAP_PAGES * PAGE_SIZE} 張：只列最近更新的 ${all.length} 張`)
  return all
}

// ── 一輪蓋過一輪、讀得怎樣 ─────────────────────────────────────

/**
 * 一個讀取器這個 session 的私有狀態（GitHub 的擋路者清單與多帳號、GitLab 沒有）：`/clear` 時整份換新的。
 * `read`／`expand` 回傳「套用」函式：核心確認這一輪還算數才呼叫它，讀取器在裡面記下結果、算出 efforts
 */
export type TrackerSession = {
  /** 包住引擎操作（GitHub 的多帳號）；沒給就照用 */
  ports?: (ports: RemotePorts) => RemotePorts
  /** 讀整份路線圖 */
  read: (ports: RemotePorts, etags: Etags) => Promise<() => Effort[]>
  /** 點開一個 effort：要補抓的話抓、回套用函式；不必連網是 undefined */
  expand?: (name: string, ports: RemotePorts, etags: Etags) => Promise<(() => Effort[]) | undefined>
}

/**
 * 讀取器的狀態機（兩種 tracker 共用）：重讀規則（`shouldRead`）、ETag、一輪蓋過一輪、讀取中／讀到了／讀不到（票 20）。
 * 讀失敗也算一次讀取（決定 D1）：60 秒內切回 [任務] 不再讀，按 r 或跑動到 issue 的指令照樣重讀
 */
export function remoteReader(tracker: RemoteTracker, open: () => TrackerSession): RemoteReader {
  // 目前第幾輪：讀到一半又有新的一輪開始時，舊的結果不能蓋掉新的
  let round = 0
  // 上次開始讀取的時間（含讀失敗的）；每個端點的 ETag
  let lastRead: number | undefined
  let etags: Etags = new Map()
  // 畫面上那份結果是幾點讀的（票 20：讀不到時保留它、標「離線 · 13:40」）；沒讀到過是 undefined
  let shownAt: number | undefined
  let session = open()

  return {
    next: async (event, engine) => {
      const ports = session.ports?.(engine) ?? engine
      if (event.kind === 'expand') {
        if (session.expand === undefined) return undefined
        const mine = round
        const apply = await session.expand(event.effort, ports, etags)
        return apply !== undefined && mine === round ? apply() : undefined
      }
      const now = await ports.now()
      if (!shouldRead(event, lastRead, now)) return undefined
      const mine = ++round
      lastRead = now
      const myEtags = etags
      if (shownAt === undefined) await ports.status?.({ kind: 'loading', tracker })
      try {
        const apply = await session.read(ports, myEtags)
        if (mine !== round) return undefined
        shownAt = now
        await ports.status?.({ kind: 'ok', at: now })
        return apply()
      } catch (err) {
        ports.log(`讀 ${TRACKER_NAME[tracker]} 路線圖失敗：${redact(reasonOf(err))}`)
        if (mine !== round) return undefined
        const problem: RemoteProblem = err instanceof RemoteError ? err.problem : { kind: 'failed', reason: redact(reasonOf(err)) }
        await ports.status?.({ kind: 'failed', tracker, problem, ...(shownAt !== undefined ? { shownAt } : {}) })
        return undefined
      }
    },
    reset: () => {
      round += 1
      lastRead = undefined
      etags = new Map()
      shownAt = undefined
      session = open()
    },
  }
}

// ── 一張地圖 → 正規化 ─────────────────────────────────────────

/**
 * 各讀取器把自己的 issue JSON 換成這個形狀，之後的正規化兩種 tracker 共用。
 * `url` 是網頁網址（GitHub `…/issues/n`、GitLab `…/-/issues/n`），也是票的身分
 */
export type RemoteIssue = {
  url: string
  number: number
  title: string
  isClosed: boolean
  body: string
  labels: readonly string[]
  hasAssignee: boolean
  /** 在哪個 repo／專案（比對用的鍵）：跟地圖一樣就是同 repo，票號寫 `#n` */
  project: string
  updatedAt: string
  closedAt?: string
  /** GitHub 原生 dependencies 有記錄時，還開著的擋路者張數 */
  blockedCount?: number
  /** GitHub 的 `sub_issues_summary.total`：包含看不到的子票，比讀到的多就是有讀不到的 */
  childTotal?: number
}

/** 地圖標題去掉 `地圖：`、`Map:`、`Wayfinder:` 這類前綴 */
export const mapName = (title: string) => title.replace(/^\s*(?:地圖|map|wayfinder)\s*[：:]\s*/i, '').trim() || title

/** 正規化的狀態，依序取第一個成立的；開著的擋路者另由 `blockedBy` 表達 */
function statusOf(issue: RemoteIssue): NormalizedStatus {
  if (issue.isClosed) return 'done'
  if (issue.hasAssignee) return 'claimed'
  if (issue.labels.includes('needs-triage')) return 'untriaged'
  if (issue.labels.includes('needs-info')) return 'needsInfo'
  return issue.labels.includes('ready-for-human') ? 'human' : 'open'
}

/** 有 `wayfinder:<type>` 標籤的子票是決策票，沒有的是規格書（不論有沒有子票） */
export const isDecision = (issue: Pick<RemoteIssue, 'labels'>) => issue.labels.some(l => DECISION_LABEL.test(l))

/** issue 網址：主機、repo 或專案路徑（GitLab 可有多層群組，`/issues` 前多一段 `/-`）、編號 */
const ISSUE_URL = /^https?:\/\/([^/]+)\/(.+?)(?:\/-)?\/issues\/(\d+)(?:[/?#].*)?$/

/** 一張 issue 網址的 repo 部分（`https://github.com/o/r`、`https://host/group/sub/app`） */
const repoWeb = (url: string) => url.replace(/(?:\/-)?\/issues\/\d+.*$/, '')

/** 顯示用的票號：同 repo 是 `#705`，別的 repo 是 `repo#12` */
export const labelOf = (issue: Pick<RemoteIssue, 'project' | 'url' | 'number'>, map: Pick<RemoteIssue, 'project'>) =>
  issue.project === map.project ? `#${issue.number}` : `${repoWeb(issue.url).split('/').at(-1) ?? ''}#${issue.number}`

/** 一張 issue 的身分 `host/owner/repo#n`（小寫）；`owner/repo#n` 用 `base` 的主機補齊、`#n` 用 `base` 的 repo 補齊；認不得是 undefined */
function issueKey(link: string, base: string): string | undefined {
  const [, host = '', repo = ''] = ISSUE_URL.exec(base) ?? []
  const url = ISSUE_URL.exec(link)
  if (url) return `${url[1]}/${url[2]}#${url[3]}`.toLowerCase()
  const full = /^((?:[\w.-]+\/)+[\w.-]+)#(\d+)$/.exec(link)
  if (full) return `${host}/${full[1]}#${full[2]}`.toLowerCase()
  const short = /^#(\d+)$/.exec(link)
  return short ? `${host}/${repo}#${short[1]}`.toLowerCase() : undefined
}

/** 一個票號寫法 → 那張 issue 的網址：`#n` 照 `base` 的 repo，`owner/repo#n` 照 `base` 的主機，網址照用 */
function refUrl(ref: string, base: string): string {
  if (/^https?:\/\//.test(ref)) return ref
  const path = /\/-\/issues\/\d+/.test(base) ? '/-/issues/' : '/issues/'
  if (ref.startsWith('#')) return `${repoWeb(base)}${path}${ref.slice(1)}`
  const [, repo = '', number = ''] = /^(.+)#(\d+)$/.exec(ref) ?? []
  return `${base.replace(/^(https?:\/\/[^/]+)\/.*$/, '$1')}/${repo}${path}${number}`
}

/** 遠端地圖要點的行首連結：`[文字](網址)`、裸寫的 issue 網址、`owner/repo#n`（GitLab 可多層）、`#n`，各占一個 group */
const REMOTE_LEAD =
  /^\s*(?:[-*+]\s+)?(?:\[[^\]]*\]\(\s*<?([^)>\s]+)>?[^)]*\)|(https?:\/\/[^\s)]+?\/issues\/\d+)(?!\d)|((?:[\w.-]+\/)+[\w.-]+#\d+)(?!\d)|(#\d+)(?!\d))/

/** 一個值裡的 issue 連結：完整網址、`owner/repo#n`、`#n` */
const REFS = /(https?:\/\/\S+?\/issues\/\d+)|((?:[\w.-]+\/)+[\w.-]+#\d+)|(#\d+)/g

/** body 開頭（第一個 `##` 之前）某一行 `<名稱>: <值>` 的值；可加粗，冒號可省（`Part of #1`） */
export function headerValue(body: string, name: string): string {
  const header = body.replace(/\r\n/g, '\n').split(/^##\s/m)[0] ?? ''
  return new RegExp(`^\\s*\\*{0,2}${name}(?::\\*{0,2}\\s*|\\*{0,2}:?\\s+)(.*)$`, 'im').exec(header)?.[1] ?? ''
}

/** body 開頭某一行指到的票，換成 issue 網址 */
export const headerRefs = (issue: Pick<RemoteIssue, 'body' | 'url'>, name: string) =>
  [...headerValue(issue.body, name).matchAll(REFS)].map(m => refUrl(m[1] ?? m[2] ?? m[3] ?? '', issue.url))

/** 這張票的身分跟另一張一樣嗎（網址比對，大小寫不計） */
export const sameIssue = (link: string, base: string, other: string) => issueKey(link, base) === issueKey(other, other)

/** 擋路者清單：被卡住的票的網址 → 還開著的擋路者票號（點開 effort 後才有） */
export type Blockers = ReadonlyMap<string, readonly string[]>

/** 卡住這張票的：抓過的清單；原生 dependencies 的張數；都沒有就讀 body 開頭的 `Blocked by:` */
function blockedByOf(issue: RemoteIssue, blockers: Blockers): BlockedBy {
  const open = blockers.get(issue.url)
  if (open !== undefined) return { open }
  if (issue.blockedCount !== undefined) return { count: issue.blockedCount }
  return { refs: headerRefs(issue, 'Blocked by') }
}

function ticketOf(issue: RemoteIssue, map: RemoteIssue, kind: NormalizedTicket['kind'], gists: ReturnType<typeof mapGists>, blockers: Blockers): NormalizedTicket {
  // 結案的決策票先找地圖要點，找不到退回 Question（第一版不讀留言裡的 Answer）
  const gist = kind === 'decision' && issue.isClosed ? gistDetail(gists, link => sameIssue(link, map.url, issue.url)) : undefined
  const detail = gist ?? section(issue.body, 'Question') ?? section(issue.body, 'What to build')
  return {
    ref: issue.url,
    label: labelOf(issue, map),
    url: issue.url,
    title: issue.title,
    kind,
    status: statusOf(issue),
    blockedBy: blockedByOf(issue, blockers),
    ...(detail ? { detail } : {}),
  }
}

/** 讀不到的票（沒權限的別的 repo）的說明 */
export const UNREADABLE = '無權限'

/**
 * 規格書底下讀不到的實作票：`childTotal` 說有、讀到的沒有的張數，各算一張等待中的票。
 * 票號寫規格書的 repo 加 `#?`（看不到真正的票號）。沒有 `childTotal`（GitLab）就不知道張數、不補
 */
function unreadableOf(spec: RemoteIssue, read: number, map: RemoteIssue): NormalizedTicket[] {
  const missing = Math.max(0, (spec.childTotal ?? 0) - read)
  const label = labelOf(spec, map).replace(/#\d+$/, '#?')
  return Array.from({ length: missing }, (_, i) => ({
    ref: `${spec.url}#unreadable-${i + 1}`,
    label,
    title: `讀不到的票（${UNREADABLE}）`,
    kind: 'build',
    status: 'unreadable',
    blockedBy: { refs: [] },
    detail: `${UNREADABLE}：${labelOf(spec, map)} 底下有票讀不到`,
  }))
}

/** 一張地圖讀到的原始資料：地圖、它的子票（照 tracker 的順序）、每份規格書的子票（以規格書網址查；讀不到的不在裡面） */
export type MapRead = { map: RemoteIssue; subs: readonly RemoteIssue[]; builds: ReadonlyMap<string, readonly RemoteIssue[]> }

/**
 * 一張地圖與它的子票 → 正規化的 effort。有 `wayfinder:<type>` 標籤的是決策票；
 * 沒有的是規格書，規格書的子票（`builds`）一律是實作票、不看標籤，照規格書順序接起來；
 * 讀不到子票的規格書（`builds` 裡沒有它）、`childTotal` 說有卻讀不到的子票，讓 effort 帶「無權限」的警告（行尾 `!`）。
 * 地圖 issue 已關閉就算已完成（決定 D2）；開著的照子票判斷。
 * 有好幾份規格書時，「繼續」填還有沒結案實作票的第一份；都沒有就填第一份還開著的（待拆票）。
 */
export function normalizeRemoteEffort(read: MapRead, tracker: RemoteTracker, blockers: Blockers = new Map()): NormalizedEffort {
  const { map, subs, builds } = read
  const decisions = subs.filter(isDecision)
  const specs = subs.filter(i => !isDecision(i))
  const buildsOf = (spec: RemoteIssue) => builds.get(spec.url) ?? []
  const hidden = specs.flatMap(s => unreadableOf(s, buildsOf(s).length, map))
  const isShort = (map.childTotal ?? 0) > subs.length || specs.some(s => !builds.has(s.url))
  const spec =
    specs.find(s => buildsOf(s).some(i => !i.isClosed)) ?? specs.find(s => !s.isClosed && buildsOf(s).length === 0) ?? specs[0]
  const gists = mapGists(map.body, REMOTE_LEAD)
  const where = tracker === 'github' ? 'gh 的帳號看不到那個 repo' : 'glab 的帳號看不到那個專案'
  return {
    name: mapName(map.title),
    mapRef: map.url,
    mapUrl: map.url,
    mapBody: map.body,
    ...(map.isClosed ? { mapClosed: true } : {}),
    ...(spec ? { specRef: spec.url, specDone: spec.isClosed } : {}),
    tickets: [
      ...decisions.map(i => ticketOf(i, map, 'decision', gists, blockers)),
      ...specs.flatMap(s => [...buildsOf(s).map(i => ticketOf(i, map, 'build', gists, blockers)), ...hidden.filter(t => t.ref.startsWith(`${s.url}#`))]),
    ],
    closeHint: REMOTE_CLOSE_HINT,
    mtimeMs: Date.parse(map.updatedAt) || 0,
    ...(hidden.length > 0 || isShort ? { warning: `${UNREADABLE}：有跨 repo 的票讀不到，算等待中（${where}）` } : {}),
  }
}

/** 已結案的地圖只列最近結案的幾張 */
const CLOSED_MAPS = 5

/** 列出來的地圖：開著的全列，已結案的只取最近結案的 5 張 */
export function pickMaps(maps: readonly RemoteIssue[]): RemoteIssue[] {
  const closedAt = (i: RemoteIssue) => Date.parse(i.closedAt ?? i.updatedAt) || 0
  const closed = maps
    .filter(i => i.isClosed)
    .sort((a, b) => closedAt(b) - closedAt(a))
    .slice(0, CLOSED_MAPS)
  return [...maps.filter(i => !i.isClosed), ...closed]
}

/** 讀到的地圖 → efforts，照地圖的更新時間新的在前 */
export const effortsOf = (reads: readonly MapRead[], tracker: RemoteTracker, blockers: Blockers = new Map()): Effort[] =>
  reads.map(r => judgeEffort(normalizeRemoteEffort(r, tracker, blockers))).sort((a, b) => b.mtimeMs - a.mtimeMs)

/**
 * 每份規格書的子票：各讀一次（`readChildren`），讀不到的寫 debug log、不放進結果（effort 帶 `!`），不讓整張路線圖失敗。
 * 跟地圖同一個 repo 的規格書讀失敗照樣丟出（那是整個讀取有問題）
 */
export async function readSpecs(
  ports: RemotePorts,
  read: Pick<MapRead, 'map' | 'subs'>,
  readChildren: (spec: RemoteIssue) => Promise<readonly RemoteIssue[]>,
): Promise<MapRead['builds']> {
  const specs = read.subs.filter(i => !isDecision(i))
  const entries = await Promise.all(
    specs.map(async s => {
      if (s.project === read.map.project) return [[s.url, await readChildren(s)] as const]
      try {
        return [[s.url, await readChildren(s)] as const]
      } catch (err) {
        ports.log(`讀 ${labelOf(s, read.map)} 的子票失敗：${redact(reasonOf(err))}`)
        return []
      }
    }),
  )
  return new Map(entries.flat())
}

export const nameOf = (read: MapRead) => mapName(read.map.title)
