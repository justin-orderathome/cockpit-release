/**
 * 「背景」子分頁的背景工作：清單的形狀與所有變化（`applyBackground`）、清單轉成畫面列（`viewBackground`）、
 * 一列要畫哪些字（`backgroundCells`），以及結束通知的解析（`parseNotification`）。純函式，不碰引擎；
 * 結構比照任務模組（`tasks.ts`）。`register.tsx` 只負責把引擎事件翻成 `BackgroundEvent` 與畫出來。
 *
 * 擴充的地方（都是聯集或 `Record`，加一個分支 tsc 就會指出還要補哪裡）：
 * - 新種類：`types` 的 `BackgroundKind` 加一個字串，這裡的 `KIND_LABELS` 補名稱。
 * - 新狀態：`types` 的 `BackgroundStatus` 加一個字串，這裡的 `STATUS_LOOKS` 補段落、圖示、顏色與說明的字。
 * - 新訊號：`BackgroundEvent` 加一個分支，`applyBackground` 的 switch 補處理。
 */
import type { BackgroundKind, BackgroundList, BackgroundOwner, BackgroundStatus, BackgroundWork, Subagent } from '../types'
import { foldLabel, textWidth } from './layout'
import { agentTime, clockOf, formatDuration, isEnded as isAgentEnded, taskColumns } from './tasks'

/** 多行（含連續空白）收成一行：列上的名稱都這樣寫 */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** 開始訊號帶的 `agentId` 是誰開的：沒有是主對話，有就是那個 subagent */
const ownerOf = (agentId: string | undefined): BackgroundOwner => (agentId === undefined ? { kind: 'main' } : { kind: 'agent', agentId })

// ── 結束通知 ────────────────────────────────────────────

/** 一則結束通知說的事：哪一筆、完成或失敗、exit code（summary 有寫才有） */
export type EndNotice = { id: string; status: 'completed' | 'failed'; exitCode?: number }

const TAG = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)

/**
 * 主對話 `prompt.submit`（`origin.kind` 是 `task-notification`）的 `e.text`。實測的樣子（票 05）：
 * `<task-notification><task-id>…</task-id>…<status>completed</status><summary>… (exit code 0)</summary></task-notification>`。
 * 沒有 `<status>` 的（Monitor 每行輸出的 `<event>`）與不認得的狀態回 undefined：呼叫端什麼都不做。
 */
export function parseNotification(text: string): EndNotice | undefined {
  if (!text.includes('<task-notification>')) return undefined
  const status = TAG('status').exec(text)?.[1]?.trim()
  if (status !== 'completed' && status !== 'failed') return undefined
  const id = TAG('task-id').exec(text)?.[1]?.trim()
  if (!id) return undefined
  const exit = /exit code (-?\d+)/i.exec(TAG('summary').exec(text)?.[1] ?? '')
  return exit ? { id, status, exitCode: Number(exit[1]) } : { id, status }
}

// ── 清單與它的變化 ──────────────────────────────────────

export const EMPTY_BACKGROUND: BackgroundList = { works: [] }

/** 已結束（含已隱藏的）最多留幾筆：超過從最舊的丟掉，免得長 session 的狀態越長越大。執行中與排程中的不丟 */
export const BACKGROUND_LIMIT = 50

/** 「背景」子分頁的三段，依這個順序畫 */
export type BackgroundSection = 'running' | 'scheduled' | 'ended'

export const SECTIONS: readonly { id: BackgroundSection; label: string }[] = [
  { id: 'running', label: '執行中' },
  { id: 'scheduled', label: '排程' },
  { id: 'ended', label: '已結束' },
]

/** 種類在列的右邊與說明區第一行的寫法。加新種類時 tsc 會要你在這裡補一行 */
export const KIND_LABELS: Record<BackgroundKind, string> = {
  shell: 'shell',
  monitor: 'Monitor',
  workflow: 'Workflow',
  mcp: 'MCP',
  cron: '排程',
  wakeup: '喚醒',
}

/** 列上的圖示；排程段以時間開頭，不畫圖示 */
export type BackgroundIcon = '●' | '✓' | '✗' | '–' | ''

/** 一種狀態的樣子 */
export type StatusLooks = {
  /** 放在哪一段 */
  section: BackgroundSection
  icon: BackgroundIcon
  /** 圖示的顏色（`accent` 是使用者選的主色）；沒有就是一般字色 */
  color?: 'accent' | 'success' | 'error'
  /** 名稱與時間的色調 */
  tone: 'normal' | 'dim' | 'error'
  /** 說明區第一行的狀態字樣 */
  word: string
}

/**
 * 每種狀態：放在哪一段、圖示與顏色、名稱的色調，以及說明區的字。
 * 加新狀態時 tsc 會要你在這裡補一行，畫面與說明就跟著有了。
 */
export const STATUS_LOOKS: Record<BackgroundStatus, StatusLooks> = {
  running: { section: 'running', icon: '●', color: 'accent', tone: 'normal', word: '執行中' },
  scheduled: { section: 'scheduled', icon: '', tone: 'normal', word: '排程中' },
  completed: { section: 'ended', icon: '✓', color: 'success', tone: 'dim', word: '完成' },
  failed: { section: 'ended', icon: '✗', color: 'error', tone: 'error', word: '失敗' },
  stopped: { section: 'ended', icon: '✗', color: 'error', tone: 'error', word: '被停掉' },
  fired: { section: 'ended', icon: '✓', color: 'success', tone: 'dim', word: '已觸發' },
  expired: { section: 'ended', icon: '–', tone: 'dim', word: '已到期' },
  unknown: { section: 'ended', icon: '–', tone: 'dim', word: '已結束（結果不明，在對話停下時發現）' },
}

/** 已結束（不在執行中、也不在排程中） */
export const isEnded = (w: Pick<BackgroundWork, 'status'>) => STATUS_LOOKS[w.status].section === 'ended'

/** 一筆新開始的背景工作：開始訊號給得出來的欄位（狀態、開始時刻、隱藏由 reducer 補） */
export type NewWork = Pick<BackgroundWork, 'id' | 'kind' | 'label' | 'command' | 'owner'> &
  Pick<Partial<BackgroundWork>, 'description' | 'timeoutMs' | 'isPersistent'>

/**
 * 會改變背景工作清單的事。加一種訊號（Monitor、TaskStop、快照、排程…）就在這裡加一個分支，
 * `applyBackground` 的 switch 會要你處理它；既有的分支不用動。
 */
export type BackgroundEvent =
  /** 一個背景工作開始了（Bash／PowerShell 結果帶 `backgroundTaskId`…）；同一個 id 再來一次不理 */
  | { kind: 'started'; work: NewWork; now: number }
  /** 主對話收到的結束通知（`parseNotification` 的結果）；對不到執行中的那一筆就不理 */
  | ({ kind: 'notified'; now: number } & EndNotice)
  /** TaskStop 停掉了 `id`（TaskStop 不會有結束通知）；對不到執行中的那一筆（例如 subagent）就不理 */
  | { kind: 'stopped'; id: string; now: number }
  /** 使用者按某一列的 × */
  | { kind: 'dismiss'; id: string }
  /** 使用者在「背景」子分頁按 c：隱藏所有已結束的 */
  | { kind: 'clearEnded' }
  /**
   * 對話停下時的快照（`classic.Stop`／`classic.SubagentStop` 的 `background_tasks` 與 `session_crons`）：拿來校正清單。
   * `crons` 沒有（引擎沒給 `session_crons`）就不動排程
   */
  | { kind: 'snapshot'; tasks: readonly SnapshotTask[]; crons?: readonly SnapshotCron[]; now: number }
  /** CronCreate（含 `/loop` 走的）排了一個排程；結果沒有 `nextFireAt` 就自己從 cron 字串算（加「約」） */
  | { kind: 'cronCreated'; job: CronJob; agentId?: string; now: number }
  /** CronDelete 刪掉一個排程：直接從排程段拿掉，之後 CronList 裡不見了也不算觸發 */
  | { kind: 'cronDeleted'; id: string }
  /**
   * 讀了一次 CronList，和清單裡的排程比對（`cronListed` 的說明）。`jobs` 沒有是 CronList 不能用（`access` 不是 `allow`），
   * 改用自己算的時間判斷；`firedAt` 是排程觸發（`scheduled-trigger`）的那一刻，CronCreate／CronDelete 之後讀的沒有
   */
  | { kind: 'cronListed'; access: 'allow' | 'other'; jobs?: readonly CronJob[]; firedAt?: number; now: number }
  /** 幾件事依序套用、一次寫出（例如 CronCreate 之後接著讀的 CronList） */
  | { kind: 'sequence'; events: readonly BackgroundEvent[] }
  /** ScheduleWakeup（`/loop` 動態模式）排了一次喚醒：結果只有 `scheduledFor`、沒有 id，cockpit 自己編一個（未實測） */
  | { kind: 'wakeupScheduled'; prompt: string; scheduledFor: number; agentId?: string; now: number }
  /** 排程觸發（`scheduled-trigger`）的 prompt 原文：和還在等的喚醒 prompt 相同就算它觸發了（未實測） */
  | { kind: 'wakeupFired'; text: string; now: number }
  /** ScheduleWakeup `stop: true` 取消了還在等的喚醒：直接拿掉（比照 CronDelete），不算結束 */
  | { kind: 'wakeupsCancelled' }

/**
 * 快照裡的一筆（引擎的 `BackgroundTaskSummary`，只取用得到的欄位）。實測（票 05）：沒有擁有者；
 * `type` 是好讀的字（`shell`、`subagent`、`monitor`、`workflow`…），不認得的種類引擎給原始的字。
 */
export type SnapshotTask = {
  id: string
  type: string
  description: string
  command?: string
  /** MCP 的 server 與 tool（Monitor、MCP task 才有） */
  server?: string
  tool?: string
  /** Workflow 名稱 */
  name?: string
}

/** 快照裡的一筆排程（引擎的 `SessionCronSummary`）：沒有下次時間；prompt 超過 1000 字被截斷、尾巴加「... [+N chars]」 */
export type SnapshotCron = { id: string; schedule: string; recurring: boolean; prompt: string }

/**
 * 快照的 `type` 是哪一種背景工作。`subagent` 不列（它是 subagent 列）；不認得的也不列，免得畫成錯的種類。
 * MCP task 的字沒實測（型別註解寫 'MCP task'），含 mcp 的都算。
 */
function snapshotKind(type: string): BackgroundKind | undefined {
  const t = type.toLowerCase()
  if (t === 'shell' || t === 'local_bash') return 'shell'
  if (t.startsWith('monitor')) return 'monitor'
  if (t === 'workflow' || t === 'local_workflow') return 'workflow'
  if (t.includes('mcp')) return 'mcp'
  return undefined
}

/** 快照裡有、清單裡沒有的那一筆：來源不明、開始時間不明，名稱照種類取（MCP 用描述） */
function snapshotWork(task: SnapshotTask, kind: BackgroundKind): BackgroundWork {
  const mcp = [task.server, task.tool].filter(Boolean).join(' · ')
  const command = kind === 'shell' && task.command ? task.command : kind === 'mcp' && mcp ? mcp : (task.name ?? task.description)
  const label = kind === 'shell' && task.command ? oneLine(task.command) : kind === 'workflow' && task.name ? task.name : oneLine(task.description)
  return {
    id: task.id,
    kind,
    label,
    command,
    ...(task.description ? { description: task.description } : {}),
    status: 'running',
    owner: { kind: 'unknown' },
    isDismissed: false,
  }
}

/** 快照裡有、清單裡沒有的排程：來源不明、開始時間不明，下次時間從 cron 字串自己算（加「約」；之後讀到 CronList 再校正） */
function snapshotCron(c: SnapshotCron, now: number): BackgroundWork {
  const next = nextCronTime(c.schedule, now)
  return {
    id: c.id,
    kind: 'cron',
    label: oneLine(c.prompt),
    command: c.schedule,
    status: 'scheduled',
    owner: { kind: 'unknown' },
    isDismissed: false,
    cron: c.schedule,
    recurring: c.recurring,
    ...(next === undefined ? {} : { nextFireAt: next }),
    isNextEstimated: true,
  }
}

/** 快照裡截斷過的 prompt（「... [+N chars]」）和完整的 prompt 是不是同一句 */
function isSamePrompt(clipped: string, full: string): boolean {
  if (clipped === full) return true
  const m = /^([\s\S]*)\.\.\. \[\+\d+ chars\]$/.exec(clipped)
  return m !== null && full.startsWith(m[1] ?? '')
}

/**
 * 快照的排程裡，ScheduleWakeup 排的喚醒（型別註解說一次性的喚醒也在 `session_crons` 裡；未實測）：
 * 喚醒的 id 是 cockpit 編的、對不到，改用 prompt 原文認，認到了就不當成新的排程補
 */
const isWakeupCron = (c: SnapshotCron, list: BackgroundList) => !c.recurring && list.works.some(w => w.kind === 'wakeup' && isSamePrompt(c.prompt, w.command))

/**
 * 用快照校正清單：執行中、快照裡不見的 → 結果不明，結束時刻用收到快照的時刻（估的）；
 * 快照裡有、清單裡沒有的 → 補一筆。快照沒有擁有者，既有的不動。都一樣就回傳同一個物件。
 * 排程（`crons`）一樣：還在等的 CronCreate 排程在快照裡不見了 → 結果不明；清單裡沒有的補進排程段。
 * 已經由 CronList、CronDelete 判過的（已結束、已拿掉）不再判；喚醒不靠這裡（它有自己的過期判定）
 */
function reconciled(list: BackgroundList, tasks: readonly SnapshotTask[], crons: readonly SnapshotCron[] | undefined, now: number): BackgroundList {
  const inSnapshot = new Set([...tasks.map(t => t.id), ...(crons ?? []).map(c => c.id)])
  const known = new Set(list.works.map(w => w.id))
  const added = [
    ...tasks.flatMap(t => {
      const kind = known.has(t.id) ? undefined : snapshotKind(t.type)
      return kind === undefined ? [] : [snapshotWork(t, kind)]
    }),
    ...(crons ?? []).flatMap(c => (known.has(c.id) || isWakeupCron(c, list) ? [] : [snapshotCron(c, now)])),
  ]
  const isGone = (w: BackgroundWork) => !inSnapshot.has(w.id) && (w.status === 'running' || (crons !== undefined && isScheduledCron(w)))
  if (!list.works.some(isGone) && added.length === 0) return list
  const works = list.works.map(w => {
    if (!isGone(w)) return w
    const { nextFireAt: _next, isNextEstimated: _est, ...rest } = w
    return { ...rest, status: 'unknown' as const, endedAt: now, isEndEstimated: true }
  })
  return { ...list, works: trimmed([...works, ...added]) }
}

/**
 * Bash／PowerShell 結果帶 `backgroundTaskId` 時的那一筆（`run_in_background`、Ctrl+B、逾時轉背景都一樣）。
 * 列上的名稱是指令（多行收成一行），`agentId` 有給就是那個 subagent 開的。
 */
export function shellStart(id: string, command: string, description?: string, agentId?: string): NewWork {
  return {
    id,
    kind: 'shell',
    label: oneLine(command),
    command,
    ...(description ? { description } : {}),
    owner: ownerOf(agentId),
  }
}

/** Monitor 開始時給得出來的：工具的輸入（描述、指令或 WebSocket）與結果（逾時、persistent） */
export type MonitorSignal = { description: string; command: string; timeoutMs: number; persistent?: boolean; agentId?: string }

/**
 * Monitor 的結果（`taskId`、`timeoutMs`、`persistent`）那一筆。列上的名稱是描述；
 * 逾時長度從開始算，`persistent`（或逾時是 0）就是沒有逾時。
 */
export function monitorStart(id: string, s: MonitorSignal): NewWork {
  const isPersistent = s.persistent === true || !(s.timeoutMs > 0)
  return {
    id,
    kind: 'monitor',
    label: oneLine(s.description),
    command: s.command,
    ...(isPersistent ? { isPersistent } : { timeoutMs: s.timeoutMs }),
    owner: ownerOf(s.agentId),
  }
}

/** 一筆看得到的都沒有（沒有背景分頁籤） */
export const isEmptyBackground = (list: BackgroundList) => !list.works.some(w => !w.isDismissed)

/**
 * 已隱藏與已結束的合計超過上限時，從最早結束的開始丟掉（跑很久剛結束的不會一結束就被丟）。
 * 只丟已結束的：被 × 隱藏的執行中也算進合計，但和排程中的一樣永遠不丟（丟了就收不到它的結束）。
 */
function trimmed(works: BackgroundWork[]): BackgroundWork[] {
  const over = works.filter(w => isEnded(w) || w.isDismissed).length - BACKGROUND_LIMIT
  if (over <= 0) return works
  const doomed = new Set(
    works
      .map((w, i): Indexed => ({ w, i }))
      .filter(({ w }) => isEnded(w))
      .sort(byRecentEnd)
      .slice(-over)
      .map(({ w }) => w),
  )
  return works.filter(w => !doomed.has(w))
}

/**
 * 背景工作的所有變化都在這裡。沒有變化時回傳同一個物件：呼叫端用它決定要不要寫（寫了就重繪）。
 * 帶時刻的事（快照、通知、排程觸發…）順便判定過期的喚醒（不靠計時器，見 `expiredWakeups`）
 */
export function applyBackground(list: BackgroundList, event: BackgroundEvent): BackgroundList {
  const next = applied(list, event)
  return 'now' in event ? expiredWakeups(next, event.now) : next
}

function applied(list: BackgroundList, event: BackgroundEvent): BackgroundList {
  switch (event.kind) {
    case 'started': {
      if (list.works.some(w => w.id === event.work.id)) return list
      const { description, ...rest } = event.work
      const work: BackgroundWork = {
        ...rest,
        ...(description ? { description } : {}),
        status: 'running',
        startedAt: event.now,
        isDismissed: false,
      }
      return { ...list, works: [...list.works, work] }
    }
    case 'notified': {
      // 快照先把它判成結果不明、通知才到的：補上結果，結束時刻留快照那個（比通知早，仍是估的）
      const known = list.works.find(w => w.id === event.id && (w.status === 'running' || (w.status === 'unknown' && w.isEndEstimated === true)))
      if (known === undefined) return list
      const ended: BackgroundWork = {
        ...known,
        status: event.status,
        endedAt: known.endedAt ?? event.now,
        ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
      }
      return { ...list, works: trimmed(list.works.map(w => (w === known ? ended : w))) }
    }
    case 'stopped': {
      const known = list.works.find(w => w.id === event.id && w.status === 'running')
      if (known === undefined) return list
      const ended: BackgroundWork = { ...known, status: 'stopped', endedAt: event.now }
      return { ...list, works: trimmed(list.works.map(w => (w === known ? ended : w))) }
    }
    case 'dismiss': {
      if (!list.works.some(w => w.id === event.id && !w.isDismissed)) return list
      // 隱藏執行中的也會讓「已隱藏＋已結束」變多
      return { ...list, works: trimmed(list.works.map(w => (w.id === event.id ? { ...w, isDismissed: true } : w))) }
    }
    case 'clearEnded': {
      if (!list.works.some(w => isEnded(w) && !w.isDismissed)) return list
      return { ...list, works: list.works.map(w => (isEnded(w) && !w.isDismissed ? { ...w, isDismissed: true } : w)) }
    }
    case 'snapshot':
      return reconciled(list, event.tasks, event.crons, event.now)
    case 'cronCreated': {
      const { job, now } = event
      if (list.works.some(w => w.id === job.id)) return list
      const next = job.nextFireAt ?? nextCronTime(job.cron, now)
      const work: BackgroundWork = {
        id: job.id,
        kind: 'cron',
        label: oneLine(job.prompt),
        command: job.cron,
        status: 'scheduled',
        startedAt: now,
        owner: ownerOf(event.agentId),
        isDismissed: false,
        cron: job.cron,
        recurring: job.recurring !== false,
        ...(next === undefined ? {} : { nextFireAt: next }),
        ...(job.nextFireAt === undefined ? { isNextEstimated: true } : {}),
      }
      return { ...list, works: [...list.works, work] }
    }
    case 'cronDeleted': {
      if (!list.works.some(w => w.id === event.id && isScheduledCron(w))) return list
      return { ...list, works: list.works.filter(w => !(w.id === event.id && isScheduledCron(w))) }
    }
    case 'cronListed': {
      let isChanged = list.cronListAccess !== event.access
      const works = list.works.map(w => {
        if (!isScheduledCron(w)) return w
        const next = event.jobs === undefined ? estimated(w, event) : compared(w, event.jobs, event)
        if (next !== w) isChanged = true
        return next
      })
      return isChanged ? { ...list, works: trimmed(works), cronListAccess: event.access } : list
    }
    case 'sequence':
      return event.events.reduce(applyBackground, list)
    case 'wakeupScheduled': {
      const work: BackgroundWork = {
        id: wakeupId(list, event.scheduledFor),
        kind: 'wakeup',
        label: event.prompt === AUTONOMOUS_LOOP ? '/loop（自主）' : oneLine(event.prompt),
        command: event.prompt,
        status: 'scheduled',
        startedAt: event.now,
        owner: ownerOf(event.agentId),
        isDismissed: false,
        recurring: false,
        scheduledFor: event.scheduledFor,
        nextFireAt: event.scheduledFor,
      }
      return { ...list, works: [...list.works, work] }
    }
    case 'wakeupFired': {
      const text = event.text.trim()
      // 同一句排了好幾次：預定最早的那一筆先觸發
      const hit = list.works
        .filter(w => isScheduledWakeup(w) && w.command.trim() === text)
        .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))[0]
      if (hit === undefined) return list
      return { ...list, works: trimmed(list.works.map(w => (w === hit ? endedCron(w, 'fired', event.now) : w))) }
    }
    case 'wakeupsCancelled': {
      if (!list.works.some(isScheduledWakeup)) return list
      return { ...list, works: list.works.filter(w => !isScheduledWakeup(w)) }
    }
  }
}

// ── ScheduleWakeup：沒在這台機器實測過，照引擎的型別寫（有機會實測時先驗這裡） ──

/** `/loop` 自主模式的 prompt（型別註解寫的 sentinel）：列上改寫成好讀的字，觸發照樣比原文 */
const AUTONOMOUS_LOOP = '<<autonomous-loop-dynamic>>'

/** 喚醒過了預定時刻多久還沒觸發就算結果不明 */
export const WAKEUP_GRACE_MS = 5 * 60_000

/** 還在排程段等的喚醒 */
const isScheduledWakeup = (w: BackgroundWork) => w.kind === 'wakeup' && w.status === 'scheduled'

/** 清單裡有還在等的喚醒：排程觸發時才要比對 prompt 原文 */
export const hasWakeups = (list: BackgroundList) => list.works.some(isScheduledWakeup)

/** ScheduleWakeup 沒有 id：cockpit 用預定時刻編一個，撞到了加序號 */
function wakeupId(list: BackgroundList, scheduledFor: number): string {
  const base = `wakeup-${scheduledFor}`
  const taken = new Set(list.works.map(w => w.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

/**
 * 過了預定時刻 5 分還沒觸發的喚醒 → 已結束、結果不明（結束時刻是預定加 5 分，標成估的）。不靠計時器：
 * 帶時刻的事套用時順便判定（`applyBackground`），畫面那一側也依當下時刻自己畫成這樣（`viewBackground`）。
 * 沒有要判的就回傳同一個物件。
 */
function expiredWakeups(list: BackgroundList, now: number): BackgroundList {
  const isOverdue = (w: BackgroundWork) => isScheduledWakeup(w) && w.scheduledFor !== undefined && now >= w.scheduledFor + WAKEUP_GRACE_MS
  if (!list.works.some(isOverdue)) return list
  const works = list.works.map(w => {
    if (!isOverdue(w)) return w
    const { nextFireAt: _next, ...rest } = w
    return { ...rest, status: 'unknown' as const, endedAt: (w.scheduledFor ?? now) + WAKEUP_GRACE_MS, isEndEstimated: true }
  })
  return { ...list, works: trimmed(works) }
}

/** Workflow 開始時給得出來的：結果的 `workflowName`、`runId`（未實測，照型別），沒有名稱時用輸入的 `name` */
export type WorkflowSignal = { name: string; runId?: string; agentId?: string }

/** Workflow 的結果（`taskId`、`workflowName`、`runId`）那一筆。列上的名稱是 workflow 名稱，結束照 shell 的通知收 */
export function workflowStart(id: string, s: WorkflowSignal): NewWork {
  return {
    id,
    kind: 'workflow',
    label: s.name,
    command: s.runId === undefined ? s.name : `${s.name} · run ${s.runId}`,
    owner: ownerOf(s.agentId),
  }
}

// ── 排程 ───────────────────────────────────────────────

/** CronCreate 的結果、CronList 的一筆（`$.tool.call` 回來的形狀，票 05 實測） */
export type CronJob = { id: string; cron: string; prompt: string; recurring?: boolean; nextFireAt?: number }

/** 重複的排程建立後多久被引擎自動刪掉 */
export const CRON_EXPIRY_MS = 7 * 24 * 60 * 60_000

/** CronList 不能用時，排程觸發的那一刻和自己記的下次時間差多少以內算「就是它」 */
const FIRE_TOLERANCE_MS = 60_000

/** 還在排程段的 CronCreate 排程 */
const isScheduledCron = (w: BackgroundWork) => w.kind === 'cron' && w.status === 'scheduled'

/** 清單裡有還在等的排程：沒有就不必讀 CronList（從沒出現過排程的 session 一次都不讀） */
export const hasSchedules = (list: BackgroundList) => list.works.some(isScheduledCron)

type Listed = Extract<BackgroundEvent, { kind: 'cronListed' }>

/** 排程結束了：一次性的「已觸發」（記觸發的時刻），重複的「已到期」 */
function endedCron(w: BackgroundWork, status: 'fired' | 'expired', at: number): BackgroundWork {
  const { nextFireAt: _next, isNextEstimated: _est, ...rest } = w
  return { ...rest, status, endedAt: at }
}

/**
 * 有 CronList 可比：清單裡的排程在 CronList 裡不見了，一次性的是觸發了、重複的是 7 天到期；
 * 重複的 `nextFireAt` 往後跳了就是觸發了（記上次觸發、推下次時間）。只看 id，不看 prompt 原文。
 * 自己算的下次時間被 CronList 校正時，沒看到觸發就不算觸發（自己算的沒算進引擎的錯開偏移）。
 */
function compared(w: BackgroundWork, jobs: readonly CronJob[], e: Listed): BackgroundWork {
  const job = jobs.find(j => j.id === w.id)
  if (job === undefined) return w.recurring === false ? endedCron(w, 'fired', e.firedAt ?? w.nextFireAt ?? e.now) : endedCron(w, 'expired', e.now)
  if (job.nextFireAt === undefined) return w
  if (job.nextFireAt === w.nextFireAt) {
    if (w.isNextEstimated !== true) return w
    const { isNextEstimated: _est, ...rest } = w
    return rest
  }
  const { isNextEstimated: _est, ...rest } = w
  const hasFired =
    w.nextFireAt !== undefined && job.nextFireAt > w.nextFireAt && (e.firedAt !== undefined || (w.isNextEstimated !== true && w.nextFireAt <= e.now))
  return { ...rest, nextFireAt: job.nextFireAt, ...(hasFired ? { lastFiredAt: e.firedAt ?? w.nextFireAt } : {}) }
}

/**
 * CronList 不能用：重複的建立滿 7 天就算到期；排程觸發時，下次時間到了的（差 1 分以內）就是觸發的那個：
 * 一次性的已觸發，重複的記上次觸發、下次時間從 cron 字串自己算（加「約」）。
 */
function estimated(w: BackgroundWork, e: Listed): BackgroundWork {
  if (w.recurring !== false && w.startedAt !== undefined && e.now >= w.startedAt + CRON_EXPIRY_MS) return endedCron(w, 'expired', e.now)
  if (e.firedAt === undefined || w.nextFireAt === undefined || w.nextFireAt > e.firedAt + FIRE_TOLERANCE_MS) return w
  if (w.recurring === false) return endedCron(w, 'fired', e.firedAt)
  const { nextFireAt: _next, ...rest } = w
  const next = nextCronTime(w.cron ?? '', Math.max(e.firedAt, w.nextFireAt))
  return { ...rest, lastFiredAt: e.firedAt, isNextEstimated: true, ...(next === undefined ? {} : { nextFireAt: next }) }
}

/** cron 一欄允許的值；寫不出來的是 undefined */
function cronField(text: string, min: number, max: number): Set<number> | undefined {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (m === null) return undefined
    const from = m[1] === '*' ? min : Number(m[2])
    const to = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? max : from
    const step = m[4] !== undefined ? Number(m[4]) : 1
    if (from < min || to > max || from > to || step < 1) return undefined
    for (let v = from; v <= to; v += step) out.add(v)
  }
  return out
}

/** 從某一刻往後找最多這麼多天 */
const CRON_HORIZON_DAYS = 366

/**
 * cron 字串（5 欄、本地時間）在 `after` 之後的下一次（epoch ms）。cockpit 自己算的：引擎替每個排程加的錯開偏移算不出來，
 * 畫面上前面加「約」。日與星期都有限制時照 cron 的慣例，符合其一就算。一年內找不到（例如 2/31）是 undefined。
 */
export function nextCronTime(cron: string, after: number): number | undefined {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return undefined
  const [minuteText, hourText, domText, monthText, dowText] = parts as [string, string, string, string, string]
  const minutes = cronField(minuteText, 0, 59)
  const hours = cronField(hourText, 0, 23)
  const doms = cronField(domText, 1, 31)
  const months = cronField(monthText, 1, 12)
  const dowsRaw = cronField(dowText, 0, 7)
  if (!minutes || !hours || !doms || !months || !dowsRaw) return undefined
  const dows = new Set([...dowsRaw].map(d => d % 7))
  const isDomAny = domText.startsWith('*')
  const isDowAny = dowText.startsWith('*')
  const sortedHours = [...hours].sort((a, b) => a - b)
  const sortedMinutes = [...minutes].sort((a, b) => a - b)
  const start = new Date(after)
  for (let i = 0; i <= CRON_HORIZON_DAYS; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    if (!months.has(day.getMonth() + 1)) continue
    const domOk = doms.has(day.getDate())
    const dowOk = dows.has(day.getDay())
    if (!(isDomAny || isDowAny ? domOk && dowOk : domOk || dowOk)) continue
    for (const h of sortedHours)
      for (const m of sortedMinutes) {
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime()
        if (t > after) return t
      }
  }
  return undefined
}

/** 重複方式的字（列的右邊、說明區第二行）：每 30 分、每小時、每 2 小時、每天 09:00、每週、一次；認不出來的寫「重複」 */
export function repeatText(cron: string, recurring: boolean): string {
  if (!recurring) return '一次'
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return '重複'
  const [mi, h, dom, mon, dow] = parts
  const num = /^\d+$/
  const every = /^\*\/(\d+)$/
  if (dom !== '*' || mon !== '*') return '重複'
  if (dow !== '*') return '每週'
  if (h === '*') {
    if (mi === '*') return '每分'
    const n = every.exec(mi ?? '')
    if (n) return `每 ${n[1]} 分`
    return num.test(mi ?? '') ? '每小時' : '重複'
  }
  if (!num.test(mi ?? '')) return '重複'
  const nh = every.exec(h ?? '')
  if (nh) return `每 ${nh[1]} 小時`
  return num.test(h ?? '') ? `每天 ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : '重複'
}

/** 排程時刻的字：今天的寫 14:30，不是今天的寫 10/22 09:00 */
function whenText(ms: number, now: number): string {
  const d = new Date(ms)
  const n = new Date(now)
  const isToday = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return isToday ? clockOf(ms) : `${d.getMonth() + 1}/${d.getDate()} ${clockOf(ms)}`
}

// ── 畫面列 ─────────────────────────────────────────────

/** 「背景」子分頁的一行：段標題（「執行中 2」），或一筆背景工作 */
export type BackgroundRow =
  | { kind: 'section'; id: string; section: BackgroundSection; label: string; count: number }
  | {
      kind: 'work'
      id: string
      section: BackgroundSection
      /** 所屬的段：跨頁時下一頁開頭補「執行中（續）」 */
      group: { id: string; label: string }
      work: BackgroundWork
      /** 從開始到現在（執行中）或到結束；開始時間不明的沒有 */
      elapsedMs?: number
      /** 執行中、有逾時的 Monitor 還剩多久；畫面那一側從這裡往下走 */
      remainingMs?: number
      /** 右邊種類欄的寬度：種類對齊成一欄 */
      kindWidth: number
      /** 游標停在這一行時說明區的內容 */
      detail: string
      /** 排程段的開頭：下次觸發的時刻（今天的 14:30，別天的 10/22 09:00；自己算的前面加「約」） */
      at?: string
    }
  /**
   * 已結束段超過 `ENDED_SHOWN` 筆時，更早的收成的那一行：「▸ 更早的 N 筆」，點了攤開（比照路線圖的「▸ 已結案 N」）。
   * 攤開後這一行還在（「▾ 更早的 N 筆」），更早的接在它後面
   */
  | { kind: 'older'; id: string; section: 'ended'; group: { id: string; label: string }; count: number; isOpen: boolean; text: string }

export type BackgroundView = {
  rows: BackgroundRow[]
  /** 還沒結束的數（執行中加排程中）：分頁籤的數字 */
  openCount: number
  /** 有執行中的：分頁籤加 ● */
  isRunning: boolean
  /** 有看得到的已結束：下框線才有「c 清除已結束」 */
  hasEnded: boolean
  /** 一筆看得到的都沒有：不畫背景分頁籤 */
  isEmpty: boolean
}

/** 開始時間不明時說明區第三行的字 */
const UNKNOWN_START = '開始時間不明（是在對話停下時的清單裡補到的）'

/** 耗時的字：結束時刻是估的前面加 `~` */
const durationText = (elapsedMs: number, isEstimated: boolean) => `${isEstimated ? '~' : ''}${formatDuration(elapsedMs)}`

/**
 * 說明區三行：`<種類>「<描述>」 · <狀態> <耗時>`（失敗附 exit）、完整指令、`<開始時間> 開始`。
 * 說明區是一般文字、不會每秒更新，所以執行中的不寫耗時（看列上那一欄）。
 */
function detailOf(w: BackgroundWork, elapsedMs: number | undefined, now: number, agents: readonly OwnerAgent[]): string {
  if (w.kind === 'cron') return cronDetail(w, now, agents)
  if (w.kind === 'wakeup') return wakeupDetail(w, now, agents)
  const took = isEnded(w) && elapsedMs !== undefined ? ` ${durationText(elapsedMs, w.isEndEstimated === true)}` : ''
  // 紅色 ✗ 的原因：失敗附 exit code，被停掉的寫是 TaskStop 停的
  const why = w.status === 'failed' && w.exitCode !== undefined ? `（exit ${w.exitCode}）` : w.status === 'stopped' ? '（TaskStop）' : ''
  const head = `${KIND_LABELS[w.kind]}「${w.description ?? w.label}」 · ${STATUS_LOOKS[w.status].word}${took}${why}`
  const left = leftText(w, remainingOf(w, now))
  const start = w.startedAt === undefined ? UNKNOWN_START : `${clockOf(w.startedAt)} 開始${left === undefined ? '' : ` · ${left}`}`
  const owner = ownerLine(w, agents)
  return [head, w.command, start, ...(owner === undefined ? [] : [owner]), ...(w.kind === 'workflow' ? [untested('Workflow')] : [])].join('\n')
}

/** 說明區要知道的 subagent：描述與結束了沒（從任務板來） */
export type OwnerAgent = Pick<Subagent, 'id' | 'label' | 'state'>

/**
 * 說明區第四行：誰開的。主對話開的不寫；subagent 開的寫它的描述，它已經結束了加「（已結束）」。
 * 任務板上找不到那個 subagent（例如 cockpit 重新載入前派的）就不寫描述。
 */
function ownerLine(w: BackgroundWork, agents: readonly OwnerAgent[]): string | undefined {
  if (w.owner.kind === 'unknown') return '來源不明（引擎自動開的，或 cockpit 重新載入前開的）'
  if (w.owner.kind === 'main') return undefined
  const { agentId } = w.owner
  const g = agents.find(a => a.id === agentId)
  if (g === undefined) return '由 subagent 開'
  return `由 subagent「${g.label}」開${isAgentEnded(g) ? '（已結束）' : ''}`
}

/**
 * 每個 subagent 還在跑的背景工作數（subagent 列的「· 背景 N」）。被隱藏的也算：它還在跑，subagent 還在等它。
 * 沒有的 subagent 不在裡面。
 */
export function runningByAgent(list: BackgroundList): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const w of list.works)
    if (w.status === 'running' && w.owner.kind === 'agent') counts.set(w.owner.agentId, (counts.get(w.owner.agentId) ?? 0) + 1)
  return counts
}

/** Monitor 還剩多久（ms）：執行中、有逾時、開始時間已知才有；不會是負的 */
const remainingOf = (w: BackgroundWork, now: number): number | undefined =>
  w.status === 'running' && w.timeoutMs !== undefined && w.startedAt !== undefined ? Math.max(0, w.startedAt + w.timeoutMs - now) : undefined

/** 「剩 25m」：畫面那一側每秒往下走時也用這個 */
export const monitorLeft = (remainingMs: number): string => `剩 ${formatDuration(Math.max(0, remainingMs))}`

/** 執行中的 Monitor 時間前面的字（「剩 25m」或「持續」）；不是的沒有 */
function leftText(w: BackgroundWork, remainingMs: number | undefined): string | undefined {
  if (w.kind !== 'monitor' || w.status !== 'running') return undefined
  if (w.isPersistent === true) return '持續'
  return remainingMs === undefined ? undefined : monitorLeft(remainingMs)
}

/** 排程列右邊的字：重複方式（不是種類） */
const repeatOf = (w: BackgroundWork) => repeatText(w.cron ?? '', w.recurring !== false)

/** 下次觸發的字；自己算的前面加「約」 */
const nextText = (w: BackgroundWork, now: number) =>
  w.nextFireAt === undefined ? undefined : `${w.isNextEstimated === true ? '約 ' : ''}${whenText(w.nextFireAt, now)}`

/**
 * 排程的說明區：`排程「<prompt>」 · 排程中`、`每 30 分 · 下次 14:30 · <cron 字串>`、`<建立時間> 建立`，
 * 重複的觸發過再加一行 `上次觸發 14:30`。
 */
function cronDetail(w: BackgroundWork, now: number, agents: readonly OwnerAgent[]): string {
  // subagent 建的排程一樣寫是誰建的；從快照補到的寫來源不明（主對話建的不寫）
  const owner = ownerLine(w, agents)
  const next = w.status === 'scheduled' && w.nextFireAt !== undefined ? ` · 下次${w.isNextEstimated === true ? '約' : ''} ${whenText(w.nextFireAt, now)}` : ''
  return [
    `${KIND_LABELS[w.kind]}「${w.description ?? w.label}」 · ${STATUS_LOOKS[w.status].word}`,
    `${repeatOf(w)}${next} · ${w.cron ?? w.command}`,
    w.startedAt === undefined ? UNKNOWN_START : `${clockOf(w.startedAt)} 建立`,
    ...(w.lastFiredAt === undefined ? [] : [`上次觸發 ${whenText(w.lastFiredAt, now)}`]),
    ...(owner === undefined ? [] : [owner]),
  ].join('\n')
}

/** 排程類（CronCreate 的排程、ScheduleWakeup 的喚醒）：時刻寫在開頭，沒有經過時間 */
const isSchedule = (w: BackgroundWork) => w.kind === 'cron' || w.kind === 'wakeup'

/** 喚醒列右邊與說明區的字 */
const WAKEUP_REPEAT = '/loop 喚醒'

/** 列右邊的字：排程是重複方式（喚醒寫「/loop 喚醒」），其他是種類 */
const rightOf = (w: BackgroundWork) => (w.kind === 'cron' ? repeatOf(w) : w.kind === 'wakeup' ? WAKEUP_REPEAT : KIND_LABELS[w.kind])

/** 未實測的種類在說明區最後加的一行 */
const untested = (tool: string) => `${tool} 未實測（照型別判斷）`

/**
 * 喚醒的說明區：`喚醒「<prompt>」 · <狀態>`、`/loop 喚醒 · 預定 14:20`、`<建立時間> 建立`，最後註明未實測。
 * 結果不明的寫清楚是過了預定時間還沒觸發（不是對話停下時發現的）
 */
function wakeupDetail(w: BackgroundWork, now: number, agents: readonly OwnerAgent[]): string {
  const word = w.status === 'unknown' ? `過了預定時間 ${WAKEUP_GRACE_MS / 60_000} 分還沒觸發（結果不明）` : STATUS_LOOKS[w.status].word
  // subagent 排的喚醒一樣寫是誰排的（比照排程）
  const owner = w.owner.kind === 'agent' ? ownerLine(w, agents) : undefined
  return [
    `${KIND_LABELS[w.kind]}「${w.label}」 · ${word}`,
    `${WAKEUP_REPEAT}${w.scheduledFor === undefined ? '' : ` · 預定 ${whenText(w.scheduledFor, now)}`}`,
    w.startedAt === undefined ? UNKNOWN_START : `${clockOf(w.startedAt)} 建立`,
    ...(owner === undefined ? [] : [owner]),
    untested('ScheduleWakeup'),
  ].join('\n')
}

type Indexed = { w: BackgroundWork; i: number }

/** 排程段：下次觸發早的在前（算不出下次的放最後） */
const byNextFire = (a: Indexed, b: Indexed) => (a.w.nextFireAt ?? Infinity) - (b.w.nextFireAt ?? Infinity) || a.i - b.i

/** 已結束的：最近結束的在前（同時結束的，後開始的在前） */
const byRecentEnd = (a: Indexed, b: Indexed) => (b.w.endedAt ?? 0) - (a.w.endedAt ?? 0) || b.i - a.i

/** 已結束段平常只列最近幾筆，其餘收成「▸ 更早的 N 筆」 */
export const ENDED_SHOWN = 5

/**
 * 把清單分段攤成要畫的行：執行中（依開始的順序）、排程、已結束（最近結束的在前）；沒有東西的段不畫。
 * 已結束超過 `ENDED_SHOWN` 筆時更早的收成一行；`showOlder` 是使用者攤開了（只記在畫面的狀態，不跨 session）。
 * `agents` 是任務板上的 subagent：說明區寫「由 subagent「…」開」用。
 */
export function viewBackground(
  stored: BackgroundList,
  now: number,
  { showOlder = false, agents = [] }: { showOlder?: boolean; agents?: readonly OwnerAgent[] } = {},
): BackgroundView {
  // 過期的喚醒：狀態還沒寫（要等下一件帶時刻的事），畫面先依時刻畫成結果不明
  const list = expiredWakeups(stored, now)
  const shown = list.works.map((w, i): Indexed => ({ w, i })).filter(({ w }) => !w.isDismissed)
  const kindWidth = Math.max(0, ...shown.map(({ w }) => textWidth(rightOf(w))))
  const rows = SECTIONS.flatMap(({ id: section, label }): BackgroundRow[] => {
    const mine = shown.filter(({ w }) => STATUS_LOOKS[w.status].section === section)
    if (mine.length === 0) return []
    const ordered = section === 'ended' ? [...mine].sort(byRecentEnd) : section === 'scheduled' ? [...mine].sort(byNextFire) : mine
    const group = { id: `background/${section}`, label }
    const workRow = ({ w }: Indexed): BackgroundRow => {
      // 排程沒有經過時間（時刻寫在開頭）
      const elapsedMs = w.startedAt === undefined || isSchedule(w) ? undefined : Math.max(0, (w.endedAt ?? now) - w.startedAt)
      const remainingMs = remainingOf(w, now)
      const at = w.status === 'scheduled' ? nextText(w, now) : undefined
      return {
        kind: 'work',
        id: `background-${w.id}`,
        section,
        group,
        work: w,
        elapsedMs,
        ...(remainingMs === undefined ? {} : { remainingMs }),
        kindWidth,
        detail: detailOf(w, elapsedMs, now, agents),
        ...(at === undefined ? {} : { at }),
      }
    }
    const head: BackgroundRow = { kind: 'section', id: `background-section-${section}`, section, label, count: mine.length }
    if (section !== 'ended' || ordered.length <= ENDED_SHOWN) return [head, ...ordered.map(workRow)]
    const older = ordered.slice(ENDED_SHOWN)
    const fold: BackgroundRow = {
      kind: 'older',
      id: 'background-older',
      section,
      group,
      count: older.length,
      isOpen: showOlder,
      text: foldLabel(showOlder, `更早的 ${older.length} 筆`),
    }
    return [head, ...ordered.slice(0, ENDED_SHOWN).map(workRow), fold, ...(showOlder ? older.map(workRow) : [])]
  })
  return {
    rows,
    openCount: shown.filter(({ w }) => !isEnded(w)).length,
    isRunning: shown.some(({ w }) => w.status === 'running'),
    hasEnded: shown.some(({ w }) => isEnded(w)),
    isEmpty: isEmptyBackground(list),
  }
}

// ── 一列的格子 ─────────────────────────────────────────

/** 寬度不到這麼多時拿掉右邊的種類欄 */
export const KIND_MIN_WIDTH = 48

/** 寬度不到這麼多時拿掉 Monitor 的剩餘時間（比種類欄先退讓） */
export const LEFT_MIN_WIDTH = 60

/** 時間欄的寬度：和任務列、subagent 列同一欄 */
const TIME_WIDTH = agentTime(0).length

/** 時間欄：補到欄寬；開始時間不明的是 `—`（畫面那一側每秒走的也用這個） */
export const backgroundTime = (elapsedMs: number | undefined, isEstimated = false): string =>
  (elapsedMs === undefined ? '—' : durationText(elapsedMs, isEstimated)).padStart(TIME_WIDTH)

/** 一筆背景工作要畫的字 */
export type BackgroundCells = {
  icon: BackgroundIcon
  /** 圖示的顏色；沒有就是一般的字色 */
  color?: 'accent' | 'success' | 'error'
  /** 名稱與時間的色調：完成的變暗，失敗與被停掉的紅色 */
  tone: 'normal' | 'dim' | 'error'
  /** 名稱：太長由畫面從尾巴截短 */
  title: string
  /** 排程段的開頭：下次觸發的時刻（青色）；其他列沒有 */
  at?: string
  /** 右邊的種類，補到同一欄寬；面板窄（< 48）時沒有 */
  kind?: string
  /** 執行中的 Monitor 時間前面的「剩 25m」或「持續」；面板窄（< 60）時沒有 */
  left?: string
  time: string
  /** 時間要不要交給畫面那一側每秒走（執行中、開始時間已知的） */
  isTicking: boolean
  /** 夠寬才畫 × */
  canDismiss: boolean
}

export function backgroundCells(row: Extract<BackgroundRow, { kind: 'work' }>, width: number): BackgroundCells {
  const w = row.work
  const looks = STATUS_LOOKS[w.status]
  const label = rightOf(w)
  const isScheduleKind = isSchedule(w)
  const left = width >= LEFT_MIN_WIDTH ? leftText(w, row.remainingMs) : undefined
  // 排程結束後的名稱寫出怎麼結束的：「· 已觸發 14:30」「· 已到期」；喚醒過了時間沒觸發的「· 結果不明」
  const title =
    isScheduleKind && w.status === 'fired' && w.endedAt !== undefined
      ? `${w.label} · 已觸發 ${clockOf(w.endedAt)}`
      : isScheduleKind && w.status === 'expired'
        ? `${w.label} · 已到期`
        : w.kind === 'wakeup' && w.status === 'unknown'
          ? `${w.label} · 結果不明`
          : w.label
  return {
    icon: looks.icon,
    ...(looks.color === undefined ? {} : { color: looks.color }),
    tone: looks.tone,
    title,
    ...(row.at === undefined ? {} : { at: row.at }),
    ...(width >= KIND_MIN_WIDTH ? { kind: label + ' '.repeat(Math.max(0, row.kindWidth - textWidth(label))) } : {}),
    ...(left === undefined ? {} : { left }),
    // 排程沒有時間欄（時刻在開頭）：補空白，× 照樣對齊
    time: isScheduleKind ? ' '.repeat(TIME_WIDTH) : backgroundTime(row.elapsedMs, w.isEndEstimated === true),
    isTicking: w.status === 'running' && row.elapsedMs !== undefined,
    canDismiss: taskColumns(width).showX,
  }
}
