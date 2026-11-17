import type { Effort, EffortStage, Ticket, TicketKind, TicketState } from '../types'

/**
 * 路線圖的共用判斷：各個讀取器（本機檔案、GitHub、GitLab）把一個 effort 正規化成 `NormalizedEffort`，
 * 狀態、階段、進度與「繼續」／「單張」的文字只在 `judgeEffort` 算，三種來源共用（規格書「中間格式（接縫）」）。
 * 這個模組不讀檔、不連網，讀取器各自 import 它。
 */

/** 跑一次外部 CLI（`gh`／`glab`）：argv 執行、不經 shell；由 register.tsx 把 `$.process.run` 包成這個傳進來 */
export type CliRun = (
  argv: string[],
  env?: Record<string, string>,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

/**
 * 正規化後的票狀態，依序取第一個成立的：已結案 → `done`；已認領（遠端：有 assignee）→ `claimed`；
 * `needs-triage` → `untriaged`；`needs-info` → `needsInfo`；`ready-for-human` → `human`；其他 → `open`。
 * 開著的擋路者不在這裡，由 `blockedBy` 表達。`untriaged` 與 `needsInfo` 都是等待中，
 * 只有 `untriaged` 會讓零散的 effort 建議 `/triage`。`unreadable` 是遠端知道有、但沒權限讀的票，也算等待中。
 */
export type NormalizedStatus = 'done' | 'claimed' | 'untriaged' | 'needsInfo' | 'human' | 'open' | 'unreadable'

/**
 * 卡住這張票的票：`refs` 是擋路者的 ref（對不到同一個 effort 裡同一種票的不算）；
 * `count` 是還沒結案的擋路者張數，給還沒抓擋路者清單時用（GitHub 點開 effort 前）；
 * `open` 是讀取器已經知道還沒結案的擋路者票號（GitHub 點開 effort 後抓到的清單，擋路者可以在 effort 外）。
 */
export type BlockedBy = { refs: readonly string[] } | { count: number } | { open: readonly string[] }

export type NormalizedTicket = {
  /** 票的身分：本機是相對於專案根目錄的路徑；遠端是 issue 網址 */
  ref: string
  /** 顯示用的票號：`03`、`#705`、`repo#12` */
  label: string
  /** 只有遠端的票有，給 `Link` 開瀏覽器 */
  url?: string
  title: string
  kind: TicketKind
  status: NormalizedStatus
  blockedBy: BlockedBy
  /** 說明區的字（Question／What to build，結案的決策票是要點）；讀取器算好 */
  detail?: string
}

export type NormalizedEffort = {
  name: string
  /** 地圖的 ref（本機路徑或地圖 issue 網址）；有它才算有地圖，「繼續」的 wayfinder／to-spec 填它 */
  mapRef?: string
  /** 地圖 issue 的網址；只有遠端有，給 effort 行尾的 `↗` */
  mapUrl?: string
  /** 地圖內文：終點、「還沒釐清」的判斷用 */
  mapBody?: string
  /** 地圖本身已經關閉（只有遠端：地圖 issue 已關閉）：不論子票，一律是已完成（決定 D2） */
  mapClosed?: boolean
  /** 規格書的 ref；有它才算有規格書，「繼續」的 to-tickets／implement-spec 填它 */
  specRef?: string
  /** 規格書說它已完成（本機：`Status:` 是完成的值）；沒有自己的實作票時用 */
  specDone?: boolean
  /** 決策票與實作票，照地圖順序（本機：檔名順序） */
  tickets: readonly NormalizedTicket[]
  /** 「單張」接在票後面的結案說法（本機：改 `Status:`；遠端：留言並關閉 issue） */
  closeHint: string
  /** 排序用，新的在前 */
  mtimeMs: number
  /** 只有局部讀不到時有（例如跨 repo 的票無權限）：effort 行尾標 `!`，滑過時說明區寫它 */
  warning?: string
}

/** 本機票的結案說法 */
export const LOCAL_CLOSE_HINT = '完成後把這張票的 Status: 改成 resolved。'

/** 地圖 Decisions so far／Out of scope 裡的一行：開頭的連結指到哪、要點 */
export type Gist = { link: string; text: string }

/** 地圖的要點：結案的決策票先找 Decisions so far（已定），再找 Out of scope（不做） */
export type Gists = { decided: Gist[]; dropped: Gist[] }

/** `[文字](連結)` 只留文字 */
const unlink = (text: string) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

/** 本機地圖的行首連結 `[文字](連結)`，連結在第一個 group */
const MD_LINK = /^\s*(?:[-*+]\s+)?\[[^\]]*\]\(\s*<?([^)>\s]+)>?[^)]*\)/

/**
 * 地圖某一段裡每一行的開頭連結與要點：要點取連結之後第一個 `：` 或 `:` 後面的字，
 * 沒有冒號就整行；去掉 `**`，連結只留文字，反引號照留。開頭不是連結的行不算。
 * `lead` 是行首連結的樣子，連結取第一個有值的 group（遠端另外認裸寫的 issue 網址與票號）。
 */
function gistsOf(map: string, heading: string, lead: RegExp): Gist[] {
  return (section(map, heading) ?? '').split('\n').flatMap(line => {
    const found = lead.exec(line)
    if (found === null) return []
    const rest = line.slice(found[0].length)
    const colon = rest.search(/[：:]/)
    const raw = colon < 0 ? line.replace(/^\s*[-*+]\s+/, '') : rest.slice(colon + 1)
    const text = unlink(raw).replace(/\*\*/g, '').trim()
    return text === '' ? [] : [{ link: found.slice(1).find(Boolean) ?? '', text }]
  })
}

/** 地圖的兩段要點；`lead` 沒給就是本機的 `[文字](連結)` */
export const mapGists = (map: string, lead: RegExp = MD_LINK): Gists => ({
  decided: gistsOf(map, 'Decisions so far', lead),
  dropped: gistsOf(map, 'Out of scope', lead),
})

/** 地圖要點裡指到這張票的那一則：Decisions so far（已定）先、Out of scope（不做）後；同一張票有好幾行取第一行 */
export function gistDetail(gists: Gists, isMine: (link: string) => boolean): string | undefined {
  const decided = gists.decided.find(g => isMine(g.link))
  if (decided) return `已定：${decided.text}`
  const dropped = gists.dropped.find(g => isMine(g.link))
  return dropped ? `不做：${dropped.text}` : undefined
}

const SKILL = '/mattpocock-skills'

/** `## <heading>` 底下到下一個 `##` 之間的正文，去掉 HTML 註解 */
export function section(text: string, heading: string): string | undefined {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const title = new RegExp(`^##\\s+${heading}\\s*$`, 'i')
  const at = lines.findIndex(l => title.test(l))
  if (at < 0) return undefined
  const end = lines.findIndex((l, i) => i > at && /^##\s/.test(l))
  return lines
    .slice(at + 1, end < 0 ? undefined : end)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

/**
 * 同一種票之間判斷狀態：卡住它的票（只認同一種、存在的）都結案了才可接手；
 * 沒被卡住、但標明要人做的是「待人處理」，不交給 agent
 */
function withStates(tickets: readonly NormalizedTicket[]): Ticket[] {
  const byRef = new Map(tickets.map(t => [t.ref, t]))
  return tickets.map(({ status, blockedBy, ...t }): Ticket => {
    const waitingOn =
      'refs' in blockedBy
        ? blockedBy.refs.flatMap(ref => {
            const blocker = byRef.get(ref)
            return blocker && blocker.status !== 'done' ? [blocker.label] : []
          })
        : 'open' in blockedBy
          ? [...blockedBy.open]
          : []
    const waitingCount = 'count' in blockedBy ? blockedBy.count : 0
    const state: TicketState =
      status === 'done'
        ? 'done'
        : status === 'claimed'
          ? 'claimed'
          : waitingOn.length > 0 || waitingCount > 0 || status === 'untriaged' || status === 'needsInfo' || status === 'unreadable'
            ? 'waiting'
            : status === 'human'
              ? 'human'
              : 'takeable'
    return { ...t, state, waitingOn, ...(waitingCount > 0 && status !== 'done' ? { waitingCount } : {}) }
  })
}

/** 一組票的結案張數／總張數 */
export const count = (tickets: readonly Ticket[]) => ({
  done: tickets.filter(t => t.state === 'done').length,
  total: tickets.length,
})

/** 一個正規化後的 effort → 它的階段、進度與下一步。三種來源共用這一份規則。 */
export function judgeEffort(input: NormalizedEffort): Effort {
  const ofKind = (kind: TicketKind) => withStates(input.tickets.filter(t => t.kind === kind))
  const decisions = ofKind('decision')
  const builds = ofKind('build')

  const hasMap = input.mapRef !== undefined
  const hasSpec = input.specRef !== undefined
  // 決策票都結案、而且「還沒釐清」的部分是空的，才算抵達終點；
  // 整行包在括號裡的是註記（例如「（已無待決事項）」），不算還沒釐清
  const fog = (section(input.mapBody ?? '', 'Not yet specified') ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !/^[（(].*[）)]$/.test(l))
  const isArrived = hasMap && decisions.every(t => t.state === 'done') && fog.length === 0
  const stage: EffortStage = input.mapClosed
    ? 'done'
    : hasMap && !isArrived
      ? 'mapping'
      : builds.length > 0
        ? builds.every(t => t.state === 'done')
          ? 'done'
          : 'building'
        : hasSpec
          ? input.specDone
            ? 'done'
            : 'needsTickets'
          : hasMap
            ? 'needsSpec'
            : input.tickets.length > 0 && [...decisions, ...builds].every(t => t.state === 'done')
              ? 'done'
              : 'loose'

  // 「單張」：照順序第一張可接手的實作票（開著、沒有開著的擋路者、沒人認領）
  const nextBuild = builds.find(t => t.state === 'takeable')
  const ticketOnly =
    stage === 'building' && nextBuild ? `${SKILL}:implement ${nextBuild.ref} ${input.closeHint}` : undefined
  // 有規格書時「繼續」整份交給 implement-spec 平行做，「單張」只做第一張可接手的；沒有規格書只能一張一張做
  const specWide = ticketOnly && hasSpec ? `${SKILL}:implement-spec ${input.specRef}` : undefined
  const next =
    stage === 'mapping'
      ? `${SKILL}:wayfinder ${input.mapRef}`
      : stage === 'needsSpec'
        ? `${SKILL}:to-spec ${input.mapRef}`
        : stage === 'needsTickets'
          ? `${SKILL}:to-tickets ${input.specRef}`
          : ticketOnly
            ? (specWide ?? ticketOnly)
            : stage === 'loose' && input.tickets.some(t => t.status === 'untriaged')
              ? `${SKILL}:triage`
              : undefined

  const destination = section(input.mapBody ?? '', 'Destination')
    ?.split('\n')
    .map(l => l.replace(/\*\*/g, '').trim())
    .find(l => l !== '')
  return {
    name: input.name,
    destination,
    ...(input.mapUrl !== undefined ? { mapUrl: input.mapUrl } : {}),
    stage,
    decisions,
    builds,
    progress: count(
      builds.length > 0 && (stage === 'building' || stage === 'done')
        ? builds
        : hasMap || hasSpec
          ? decisions
          : [...decisions, ...builds],
    ),
    next,
    nextTicket: specWide ? ticketOnly : undefined,
    mtimeMs: input.mtimeMs,
    ...(input.warning !== undefined ? { warning: input.warning } : {}),
  }
}
