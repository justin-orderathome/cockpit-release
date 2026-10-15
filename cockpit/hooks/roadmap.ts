import type { Effort, EffortStage, ModelUse, Ticket, TicketKind, TicketState } from '../types'
import { tidy } from './files'
import type { FileEntry, Files } from './files'
import type { HandlerMark } from './handled'
import { ROW_GAP, fitText, foldLabel, textWidth } from './layout'
import { modelLabels } from './modelLabel'
import type { LabelSlot } from './modelLabel'

/**
 * 讀目前專案放 effort 的目錄（預設 `.scratch/`）底下的每個 effort，判斷它走到哪、下一步要做什麼。
 * 格式依 mattpocock-skills 的本機 markdown tracker：
 * `map.md`（地圖）、`spec.md`（規格書）、`issues/NN-<slug>.md`（票）。
 */

/** 路線圖只讀不寫；路徑相對於專案根目錄，由呼叫端給一個接在根目錄底下的 `Files` */
export type RoadmapFs = Pick<Files, 'list' | 'read'>

export const ROADMAP_ROOT = '.scratch'

/** 專案說明 issue tracker 放在哪的文件；寫票的 skill 也照它，所以路線圖跟著它找 */
export const TRACKER_DOC = 'docs/agents/issue-tracker.md'

/**
 * 從 `docs/agents/issue-tracker.md` 的內容找 effort 放在哪個目錄：取第一個 `<目錄>/<effort>/` 這種路徑的目錄。
 * 沒有文件或認不出來就是 `.scratch`；標題寫明是線上的 tracker（沒有本機目錄）就是 undefined，不顯示路線圖。
 */
export function trackerRoot(doc: string | undefined): string | undefined {
  if (doc === undefined) return ROADMAP_ROOT
  const found = /`(?:\.\/)?((?:[\w.@-]+\/)*[\w.@-]+)\/<[^>`\s]+>/.exec(doc)?.[1]
  if (found !== undefined && !found.split('/').includes('..')) return found
  return /^#\s.*\b(?:github|gitlab|linear|jira)\b/im.test(doc) ? undefined : ROADMAP_ROOT
}

/** 階段的顯示名稱 */
export const STAGE_LABELS: Record<EffortStage, string> = {
  mapping: '找路中',
  needsSpec: '待寫規格',
  needsTickets: '待拆票',
  building: '實作中',
  done: '已完成',
  loose: '零散',
}

const SKILL = '/mattpocock-skills'
const DONE_STATUSES = new Set(['resolved', 'done', 'wontfix', 'closed'])
const DECISION_TYPES = new Set(['research', 'prototype', 'grilling', 'task'])
const UNTRIAGED_STATUSES = new Set(['needs-triage', 'needs-info'])
const HUMAN_STATUS = 'ready-for-human'

/** 寫檔工具動到的路徑在不在放 effort 的目錄底下 */
export const touchesRoadmap = (path: string, root: string) => {
  const p = tidy(path)
  return p.startsWith(`${root}/`) || p.includes(`/${root}/`)
}

/** `Status: open`、`**Status:** ready-for-agent` 這類一行的值 */
const field = (text: string, name: string) =>
  new RegExp(`^\\s*\\*{0,2}${name}:\\*{0,2}\\s*(.*?)\\s*$`, 'im').exec(text)?.[1]

/** `## <heading>` 底下到下一個 `##` 之間的正文，去掉 HTML 註解 */
function section(text: string, heading: string): string | undefined {
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

/** 票的問題或要做的內容 */
function detailOf(text: string): string | undefined {
  const question = section(text, 'Question') ?? section(text, 'What to build')
  if (question) return question
  const inline = /^\s*\*\*What to build:\*\*\s*([\s\S]*?)(?:\n\s*\n|$)/im.exec(text.replace(/\r\n/g, '\n'))?.[1]?.trim()
  return inline || undefined
}

/** 第一個 `#` 標題，去掉 `01 —`、`01:` 這類編號前綴；沒有標題就用檔名 */
function titleOf(text: string, file: string): string {
  const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim()
  const raw = heading ?? file.replace(/\.md$/i, '').replace(/^\d+-/, '')
  return raw.replace(/^\d+\s*(?:[—–:.\-]\s*)?/, '').trim() || raw
}

type Parsed = Omit<Ticket, 'state' | 'waitingOn'> & {
  status: string
  isDone: boolean
  blockedBy: number[]
}

/**
 * `Blocked by:` 裡的票號：`—`、`None …`、`（無；…）` 這類寫法表示沒有被卡住；
 * 其餘只認 1–3 位數、前面不是 `#` 的數字（`PR #12`、年份不算）。
 */
function blockersOf(value: string): number[] {
  if (/^\s*(?:—|-|–|none\b|n\/a\b|[（(]?無)/i.test(value)) return []
  return [...value.matchAll(/(?<![#\d])\d{1,3}(?!\d)/g)].map(m => Number(m[0]))
}

function parseTicket(path: string, file: string, text: string): Parsed {
  // 決策票的 `Type:` 在標頭區（第一個 `##` 之前），而且是四種類型之一；內文裡的 Type 不算
  const header = text.split(/^##\s/m)[0] ?? ''
  const type = (field(header, 'Type') ?? '').toLowerCase().split(/\s/)[0] ?? ''
  const status = (field(text, 'Status') ?? '').toLowerCase().split(/\s/)[0] ?? ''
  const boxes = [...text.matchAll(/^\s*[-*]\s+\[( |x|X)\]/gm)].map(m => m[1] !== ' ')
  return {
    number: /^(\d+)/.exec(file)?.[1] ?? '',
    path,
    title: titleOf(text, file),
    kind: DECISION_TYPES.has(type) ? 'decision' : 'build',
    status,
    isDone: DONE_STATUSES.has(status) || (boxes.length > 0 && boxes.every(Boolean)),
    blockedBy: blockersOf(field(text, 'Blocked by') ?? ''),
    detail: detailOf(text),
  }
}

/**
 * 同一種票之間判斷狀態：卡住它的票（只認同一種、存在的編號）都結案了才可接手；
 * 沒被卡住、但標明要人做的（`ready-for-human`）是「待人處理」，不交給 agent
 */
function withStates(tickets: readonly Parsed[]): Ticket[] {
  const byNumber = new Map(tickets.map(t => [Number(t.number), t]))
  return tickets.map(({ status, isDone, blockedBy, ...t }): Ticket => {
    const waitingOn = blockedBy.flatMap(n => {
      const blocker = byNumber.get(n)
      return blocker && !blocker.isDone ? [blocker.number] : []
    })
    const state: TicketState = isDone
      ? 'done'
      : status === 'claimed'
        ? 'claimed'
        : waitingOn.length > 0 || UNTRIAGED_STATUSES.has(status)
          ? 'waiting'
          : status === HUMAN_STATUS
            ? 'human'
            : 'takeable'
    return { ...t, state, waitingOn }
  })
}

const count = (tickets: readonly Ticket[]) => ({
  done: tickets.filter(t => t.state === 'done').length,
  total: tickets.length,
})

/** 一個 effort 的檔案內容 → 它的階段、進度與下一步。 */
export function parseEffort(input: {
  name: string
  map?: string
  hasSpec: boolean
  /** 規格書的內容；`Status:` 寫完成時，沒有自己的實作票也算已完成 */
  spec?: string
  issues: readonly { file: string; text: string }[]
  mtimeMs: number
  /** 放 effort 的目錄；沒給就是 `.scratch` */
  root?: string
}): Effort {
  const dir = `${input.root ?? ROADMAP_ROOT}/${input.name}`
  const parsed = [...input.issues]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(i => parseTicket(`${dir}/issues/${i.file}`, i.file, i.text))
  const ofKind = (kind: TicketKind) => withStates(parsed.filter(t => t.kind === kind))
  const decisions = ofKind('decision')
  const builds = ofKind('build')

  const hasMap = input.map !== undefined
  // 決策票都結案、而且「還沒釐清」的部分是空的，才算抵達終點；
  // 整行包在括號裡的是註記（例如「（已無待決事項）」），不算還沒釐清
  const fog = (section(input.map ?? '', 'Not yet specified') ?? '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '' && !/^[（(].*[）)]$/.test(l))
  const isArrived = hasMap && decisions.every(t => t.state === 'done') && fog.length === 0
  // 實作票開在別的 effort 時，規格書自己的 Status 說它做完了沒
  const specDone = DONE_STATUSES.has((field(input.spec ?? '', 'Status') ?? '').toLowerCase().split(/\s/)[0] ?? '')
  const stage: EffortStage =
    hasMap && !isArrived
      ? 'mapping'
      : builds.length > 0
        ? builds.every(t => t.state === 'done')
          ? 'done'
          : 'building'
        : input.hasSpec
          ? specDone
            ? 'done'
            : 'needsTickets'
          : hasMap
            ? 'needsSpec'
            : parsed.length > 0 && [...decisions, ...builds].every(t => t.state === 'done')
              ? 'done'
              : 'loose'

  const nextBuild = builds.find(t => t.state === 'takeable')
  const next =
    stage === 'mapping'
      ? `${SKILL}:wayfinder ${dir}/map.md`
      : stage === 'needsSpec'
        ? `${SKILL}:to-spec ${dir}/map.md`
        : stage === 'needsTickets'
          ? `${SKILL}:to-tickets ${dir}/spec.md`
          : stage === 'building' && nextBuild
            ? `${SKILL}:implement ${nextBuild.path} 完成後把這張票的 Status: 改成 resolved。`
            : stage === 'loose' && parsed.some(t => t.status === 'needs-triage')
              ? `${SKILL}:triage`
              : undefined

  const destination = section(input.map ?? '', 'Destination')
    ?.split('\n')
    .map(l => l.replace(/\*\*/g, '').trim())
    .find(l => l !== '')
  return {
    name: input.name,
    destination,
    stage,
    decisions,
    builds,
    progress: count(
      builds.length > 0 && (stage === 'building' || stage === 'done')
        ? builds
        : hasMap || input.hasSpec
          ? decisions
          : [...decisions, ...builds],
    ),
    next,
    mtimeMs: input.mtimeMs,
  }
}

/** `root` 底下每個資料夾裡的檔案與票（只列目錄，不讀內容）。沒有那個目錄就是空的。 */
async function listEfforts(fs: Pick<RoadmapFs, 'list'>, root: string) {
  const listed = (path: string) => fs.list(path)
  const dirs = (await listed(root)).filter(entry => entry.kind === 'dir')
  return Promise.all(
    dirs.map(async entry => {
      const dir = `${root}/${entry.name}`
      const all = await listed(dir)
      // 沒有 issues 資料夾的就不必再列一次
      const issueList = all.some(f => f.kind === 'dir' && f.name === 'issues') ? await listed(`${dir}/issues`) : []
      return {
        name: entry.name,
        dir,
        files: all.filter(f => f.kind === 'file'),
        issueFiles: issueList.filter(f => f.kind === 'file' && /\.md$/i.test(f.name)),
      }
    }),
  )
}

type Listing = Awaited<ReturnType<typeof listEfforts>>

/** 一個 effort 的指紋：它的檔名、大小與修改時間。不必讀內容就看得出有沒有變。 */
const effortStamp = (e: Listing[number]) => {
  const mark = (f: FileEntry) => `${f.name}:${f.mtimeMs}:${f.size ?? ''}`
  return [e.name, ...e.files.map(mark), 'issues', ...e.issueFiles.map(mark)].join('|')
}

/** 放 effort 的目錄的指紋：目錄本身，加上每個 effort 的指紋 */
const stampOf = (listing: Listing, root: string) => [root, ...listing.map(effortStamp).sort()].join('\n')

/** 上次讀到的 effort，鍵是「目錄/名稱」；指紋沒變的不必重讀（沒有地圖、規格書或票的資料夾記成 undefined） */
type Known = Map<string, { stamp: string; effort: Effort | undefined }>

/**
 * 讀列出來的每個資料夾：有地圖、規格書或票的才算 effort，最近修改的在前。
 * 有給 `known` 時，指紋沒變的 effort 直接用上次的結果，只重讀有變的；讀完把這次的記回去。
 */
async function readListed(fs: RoadmapFs, listing: Listing, root: string, known?: Known): Promise<Effort[]> {
  const read = async (path: string) => (await fs.read(path)) ?? ''
  const seen: Known = new Map()
  const found = await Promise.all(
    listing.map(async (entry): Promise<Effort | undefined> => {
      const { name, dir, files, issueFiles } = entry
      const stamp = effortStamp(entry)
      const before = known?.get(dir)
      if (before !== undefined && before.stamp === stamp) {
        seen.set(dir, before)
        return before.effort
      }
      const hasMap = files.some(f => f.name === 'map.md')
      const hasSpec = files.some(f => f.name === 'spec.md')
      let effort: Effort | undefined
      if (hasMap || hasSpec || issueFiles.length > 0) {
        const [map, spec, issues] = await Promise.all([
          hasMap ? read(`${dir}/map.md`) : undefined,
          hasSpec ? read(`${dir}/spec.md`) : undefined,
          Promise.all(issueFiles.map(async f => ({ file: f.name, text: await read(`${dir}/issues/${f.name}`) }))),
        ])
        effort = parseEffort({
          name,
          root,
          map,
          hasSpec,
          spec,
          issues,
          mtimeMs: Math.max(0, ...files.map(f => f.mtimeMs), ...issueFiles.map(f => f.mtimeMs)),
        })
      }
      seen.set(dir, { stamp, effort })
      return effort
    }),
  )
  if (known !== undefined) {
    known.clear()
    for (const [dir, entry] of seen) known.set(dir, entry)
  }
  return found.filter((f): f is Effort => f !== undefined).sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** 讀整個放 effort 的目錄（預設 `.scratch/`）。沒有那個目錄就是空的。 */
export async function readRoadmap(fs: RoadmapFs, root = ROADMAP_ROOT): Promise<Effort[]> {
  return readListed(fs, await listEfforts(fs, root), root)
}

/** 可能讓畫面上的路線圖變舊的事 */
export type RoadmapEvent =
  /** session 開始、切到 [任務]、按「重新載入」：一律重讀 */
  | { kind: 'open' }
  /** 寫檔工具跑完：成功寫了放 effort 的目錄底下的檔案才重讀 */
  | { kind: 'wrote'; path: string; isOk: boolean }
  /** shell 指令跑完：放 effort 的目錄的指紋變了才重讀。指令失敗也可能已經改了檔案，所以只排除被擋下、根本沒跑的 */
  | { kind: 'ran'; isBlocked: boolean }

/**
 * 路線圖什麼時候要重讀。回傳的函式收一件事與放 effort 的目錄：需要重讀就讀，回傳新的 efforts；
 * 不需要重讀，或讀到一半又有更新的一輪開始（舊的結果不能蓋掉新的），回傳 undefined，畫面維持原樣。
 * 引擎不會通知檔案變動，所以只在這些時機看；自己在編輯器改的要按「重新載入」。
 */
export function roadmapWatch() {
  // 目前第幾輪讀取、上次讀取時那個目錄的指紋，以及上次讀到的每個 effort
  let round = 0
  let seen: string | undefined
  const known: Known = new Map()
  // shell 指令的檢查同一時間只跑一次；跑的時候又有指令跑完，就記下來，跑完再看一次
  let checking: Promise<Effort[] | undefined> | undefined
  let isDirty = false

  const check = async (event: RoadmapEvent, fs: RoadmapFs, root: string): Promise<Effort[] | undefined> => {
    // 「一律重讀」的事一開始就佔下這一輪；shell 指令要先看指紋，沒變就不算一輪
    let mine = event.kind === 'ran' ? undefined : ++round
    const listing = await listEfforts(fs, root)
    const stamp = stampOf(listing, root)
    if (mine === undefined) {
      if (stamp === seen) return undefined
      mine = ++round
    }
    seen = stamp
    // 重新開啟時每個 effort 都重讀；寫檔與 shell 指令只重讀指紋變了的
    if (event.kind === 'open') known.clear()
    const efforts = await readListed(fs, listing, root, known)
    return mine === round ? efforts : undefined
  }

  return async (event: RoadmapEvent, fs: RoadmapFs, root = ROADMAP_ROOT): Promise<Effort[] | undefined> => {
    if (event.kind === 'wrote' && !(event.isOk && touchesRoadmap(event.path, root))) return undefined
    if (event.kind !== 'ran') return check(event, fs, root)
    if (event.isBlocked) return undefined
    if (checking !== undefined) {
      isDirty = true
      return undefined
    }
    checking = (async () => {
      let latest: Effort[] | undefined
      do {
        isDirty = false
        latest = (await check(event, fs, root)) ?? latest
      } while (isDirty)
      return latest
    })()
    try {
      return await checking
    } finally {
      checking = undefined
    }
  }
}

/** 路線圖在 [任務] 裡的一行；文字都已經裁到放得下 */
export type RoadmapRow =
  /** 一個 effort：`label` 是「▸ 名稱」；`stage` 太窄時拿掉；`count` 沒有票時是空的 */
  | { kind: 'effort'; effort: Effort; isOpen: boolean; label: string; stage?: string; count: string }
  /** 展開後的行都帶著 `indent`（縮排幾格）：文字是照它裁的，畫的時候也照它縮 */
  | { kind: 'destination'; effort: Effort; text: string; indent: number }
  /** 一組票的小計：「▾ 決策 1/3」「▸ 實作 4/4」；`foldId` 是收合狀態的鍵 */
  | { kind: 'tickets'; effort: Effort; id: string; text: string; foldId: string; isOpen: boolean; indent: number }
  /** 收起來的已結案的票：「▸ 已結案 9」；攤開後這一行還在，票照編號列在後面 */
  | { kind: 'closed'; effort: Effort; id: string; text: string; foldId: string; isOpen: boolean; indent: number }
  /**
   * 一張票：`label` 是「02 標題」（票號留在前面，才對得上 `waiting` 的「等 01、02」）；要人做的票 `waiting` 是「待人處理」。
   * 被這個 session 經手的票：`model` 是行尾補到欄寬的模型標示（主對話經手的、跟主對話相同的、放不下的沒有），
   * `detail` 是說明區的字，最前面一行寫誰經手
   */
  | {
      kind: 'ticket'
      effort: Effort
      ticket: Ticket
      label: string
      waiting: string
      indent: number
      model?: string
      detail?: string
    }

export type RoadmapView = {
  rows: RoadmapRow[]
  /** 已完成的 effort 數；預設不顯示它們 */
  doneCount: number
}

/** 路線圖各欄的寬度：一組票的縮排、票的縮排、圖示加間隔、「繼續」加間隔、effort 名稱至少幾格 */
const GROUP_INDENT = 2
const TICKET_INDENT = 4
const ICON = 1 + ROW_GAP
const NEXT = textWidth('繼續') + ROW_GAP
const MIN_NAME = 8
/** 已結案的票有幾張以上才收成一行；只有一張時收了也沒省到 */
const MIN_CLOSED = 2

/**
 * 把 efforts 攤平成要畫的行：每個 effort 一行，展開的接著它的終點、決策票與實作票。
 * 票多的時候只列還要做的：整組都結案的那組預設收起，其餘的組把已結案的票收成一行。
 * `folds` 是使用者手動攤開（true）或收起（false）過的，鍵是那一行的 `foldId`；沒動過的每次照當下的票算。
 * `width` 是可用的寬度；名稱以外的欄（數字、「繼續」、階段）放不下時，先拿掉階段。
 * `handled` 是這個 session 經手的票 → 要標的模型與說明區那一行；`base` 是主對話最近一次的模型與深度，和它相同的不標。
 */
export function viewRoadmap(
  efforts: readonly Effort[],
  {
    open,
    showDone,
    width,
    folds = {},
    handled,
    base,
  }: {
    open: ReadonlySet<string>
    showDone: boolean
    width: number
    folds?: Readonly<Record<string, boolean>>
    handled?: ReadonlyMap<string, HandlerMark>
    base?: ModelUse
  },
): RoadmapView {
  const rows: RoadmapRow[] = []
  /** 每一張列出來的票：在 `rows` 的第幾行、完整的名稱、扣掉標示前名稱有幾格、經手者的模型 */
  const marked: (LabelSlot & { at: number; label: string })[] = []
  for (const effort of efforts.filter(f => showDone || f.stage !== 'done')) {
    const isOpen = open.has(effort.name)
    // 沒有票（例如只有規格書）就不顯示進度
    const progress = effort.progress.total > 0 ? `${effort.progress.done}/${effort.progress.total}` : ''
    const stage = STAGE_LABELS[effort.stage]
    const fixed = (progress ? textWidth(progress) + ROW_GAP : 0) + (effort.next ? NEXT : 0)
    const showStage = width - fixed - (textWidth(stage) + ROW_GAP) >= MIN_NAME
    const rest = fixed + (showStage ? textWidth(stage) + ROW_GAP : 0)
    rows.push({
      kind: 'effort',
      effort,
      isOpen,
      label: fitText(foldLabel(isOpen, effort.name), Math.max(4, width - rest)),
      stage: showStage ? stage : undefined,
      count: progress,
    })
    if (!isOpen) continue
    if (effort.destination)
      rows.push({ kind: 'destination', effort, text: `終點：${effort.destination}`, indent: GROUP_INDENT })
    for (const [name, tickets] of [
      ['決策', effort.decisions],
      ['實作', effort.builds],
    ] as const) {
      if (tickets.length === 0) continue
      const { done, total } = count(tickets)
      const groupId = `${effort.name}/${name}`
      const isGroupOpen = folds[groupId] ?? done < total
      rows.push({
        kind: 'tickets',
        effort,
        id: name,
        text: foldLabel(isGroupOpen, `${name} ${done}/${total}`),
        foldId: groupId,
        isOpen: isGroupOpen,
        indent: GROUP_INDENT,
      })
      if (!isGroupOpen) continue
      // 整組都結案時沒有「還要做的」可以留，攤開就直接列票
      const canFold = done >= MIN_CLOSED && done < total
      const closedId = `${groupId}/已結案`
      const showClosed = !canFold || (folds[closedId] ?? false)
      if (canFold) {
        rows.push({
          kind: 'closed',
          effort,
          id: `${name}/已結案`,
          text: foldLabel(showClosed, `已結案 ${done}`),
          foldId: closedId,
          isOpen: showClosed,
          indent: TICKET_INDENT,
        })
      }
      for (const ticket of tickets) {
        if (!showClosed && ticket.state === 'done') continue
        const waiting =
          ticket.waitingOn.length > 0 ? `等 ${ticket.waitingOn.join('、')}` : ticket.state === 'human' ? '待人處理' : ''
        const room = width - TICKET_INDENT - ICON - (waiting ? textWidth(waiting) + ROW_GAP : 0)
        const label = ticket.number ? `${ticket.number} ${ticket.title}` : ticket.title
        // 結案的票不標誰經手（經手的紀錄要等路線圖重讀才拿掉）
        const mark = ticket.state === 'done' ? undefined : handled?.get(ticket.path)
        const detail = mark === undefined ? ticket.detail : [mark.note, ticket.detail].filter(Boolean).join('\n')
        marked.push({ at: rows.length, label, room, use: mark?.use })
        rows.push({ kind: 'ticket', effort, ticket, label, waiting, indent: TICKET_INDENT, detail })
      }
    }
  }
  // 模型標示整個路線圖算一塊，一起決定完整或縮寫；名稱照扣掉標示後的寬度裁
  const { labels } = modelLabels(marked, base)
  marked.forEach(({ at, label, room }, i) => {
    const row = rows[at]
    if (row?.kind !== 'ticket') return
    const model = labels[i]
    // 標示已經補到同一欄寬
    const used = model === undefined ? 0 : textWidth(model) + ROW_GAP
    rows[at] = { ...row, label: fitText(label, Math.max(4, room - used)), model }
  })
  return { rows, doneCount: efforts.filter(f => f.stage === 'done').length }
}
