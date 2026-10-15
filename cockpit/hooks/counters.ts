/**
 * 計數器：作者量面板花了多少時間、問了引擎幾次用的，不碰引擎。
 *
 * 預設關閉；`register.tsx` 在 session 開始時看一次環境變數 `COCKPIT_COUNTERS`，是 `1` 才打開。
 * 關著時每個記錄的入口第一行就回去，熱路徑上只多一個布林判斷，不問引擎任何事。
 * 打開時記下：
 * - 每個 hook（與計時器回呼）自己的耗時：`next` 之後的那一段；`next` 排在最後的 hook 量 `next` 之前的那一段
 * - 每次 `ui.render` 的耗時與次數，分頁各自也記
 * - host 呼叫（`$.fs.list`、`$.fs.read`、`$.command.list`、`$.agent.list`）的次數，算在最近一件開始的事件上
 *   （背景工作接在觸發它的事件後面跑，所以算給它；同時有好幾件事在跑時只是近似）
 * - 計時器回呼的次數、`session.start` 要等的時間、背景預載完成的時間與期間的讀檔次數
 *
 * 時間用這個環境自己的時鐘（`performance.now`，沒有就 `Date.now`），量時間不必問引擎。
 * 紀錄怎麼寫成檔由 `register.tsx` 決定；這裡只給要寫的路徑與內容（`summary`），並把同時要寫的併成一次。
 */

export const HOST_CALLS = ['fs.list', 'fs.read', 'command.list', 'agent.list'] as const
export type HostCall = (typeof HOST_CALLS)[number]

/** 每個名稱最多留幾筆耗時算百分位（次數照算）；session 很長時不會一直長大 */
const KEEP_SAMPLES = 2000
/** 摘要裡列出最近幾次重繪各花多久 */
const RECENT_RENDERS = 20

type Samples = { count: number; ms: number[] }

const realNow = (): number => {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance
  return typeof perf?.now === 'function' ? perf.now() : Date.now()
}

const emptyHosts = (): Record<HostCall, number> => ({ 'fs.list': 0, 'fs.read': 0, 'command.list': 0, 'agent.list': 0 })

function add(samples: Map<string, Samples>, name: string, ms: number) {
  const s = samples.get(name) ?? { count: 0, ms: [] }
  s.count++
  s.ms.push(ms)
  if (s.ms.length > KEEP_SAMPLES) s.ms.shift()
  samples.set(name, s)
}

/** 由小到大排好的耗時取第 p 百分位（nearest-rank） */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0
}

const fmt = (ms: number) => (Math.round(ms * 10) / 10).toFixed(1)

function msLines(prefix: string, s: Samples | undefined): string[] {
  const sorted = [...(s?.ms ?? [])].sort((a, b) => a - b)
  return [
    `${prefix}.count ${s?.count ?? 0}`,
    `${prefix}.ms.p50 ${fmt(percentile(sorted, 50))}`,
    `${prefix}.ms.p95 ${fmt(percentile(sorted, 95))}`,
    `${prefix}.ms.max ${fmt(sorted[sorted.length - 1] ?? 0)}`,
  ]
}

export type Counters = ReturnType<typeof makeCounters>

/** 一份計數器；`now` 給測試換掉時鐘用 */
export function makeCounters(now: () => number = realNow) {
  let isOn = false
  let sessionId = ''
  let path = ''
  /** 最近一件開始的事件：host 呼叫算在它頭上 */
  let current = 'session.start'
  let startedAt = 0
  let startWaitMs: number | undefined
  let preloadMs: number | undefined
  let preloadFrom = emptyHosts()
  let preloadHosts: Record<HostCall, number> | undefined
  let totals = emptyHosts()
  let byEvent = new Map<string, Record<HostCall, number>>()
  let hooks = new Map<string, Samples>()
  let renders = new Map<string, Samples>()
  let recent: string[] = []
  let isSaving = false
  let isDirty = false

  function reset() {
    current = 'session.start'
    startedAt = now()
    startWaitMs = undefined
    preloadMs = undefined
    preloadFrom = emptyHosts()
    preloadHosts = undefined
    totals = emptyHosts()
    byEvent = new Map()
    hooks = new Map()
    renders = new Map()
    recent = []
  }

  return {
    get isOn() {
      return isOn
    },
    /** 紀錄要寫到哪裡；還沒開始是 '' */
    get path() {
      return path
    },
    get sessionId() {
      return sessionId
    },
    /** session 開始時判斷一次：`flag` 是環境變數 `COCKPIT_COUNTERS` 的值。回傳開始的時間（關著是 0） */
    decide(flag: string | undefined): number {
      isOn = flag === '1'
      if (!isOn) return 0
      reset()
      return startedAt
    },
    /**
     * 這份紀錄屬於哪個 session、寫到哪個目錄。換了 session（`/clear`）就從頭記一份新的。
     * 回傳是不是換了一份新的。
     */
    session(id: string, dir: string): boolean {
      if (!isOn) return false
      const isNew = sessionId !== '' && sessionId !== id
      if (isNew) reset()
      sessionId = id
      path = `${dir}/${id}.txt`
      return isNew
    },
    /** 現在的時間，量耗時的起點；關著是 0（不看時鐘） */
    stamp(): number {
      return isOn ? now() : 0
    },
    /** 一件事件（或計時器回呼）開始：之後的 host 呼叫算給它。回傳起點，交給 `leave` */
    enter(name: string): number {
      if (!isOn) return 0
      current = name
      return now()
    },
    /** 那件事件自己的工作做完：記下耗時 */
    leave(name: string, at: number) {
      if (!isOn) return
      add(hooks, name, now() - at)
    },
    /** 一次 `ui.render` 畫完 */
    rendered(tab: string, at: number) {
      if (!isOn) return
      const ms = now() - at
      add(renders, 'all', ms)
      add(renders, tab, ms)
      recent.push(`${tab}:${fmt(ms)}`)
      if (recent.length > RECENT_RENDERS) recent.shift()
    },
    /** 問了引擎一次 */
    host(call: HostCall) {
      if (!isOn) return
      totals[call]++
      const counts = byEvent.get(current) ?? emptyHosts()
      counts[call]++
      byEvent.set(current, counts)
    },
    /** `session.start` 做完、要交給 `next` 了 */
    startWaited() {
      if (!isOn) return
      startWaitMs = now() - startedAt
    },
    /** 背景預載開始：記下這時已經問了幾次，完成時算差 */
    preloadBegan() {
      if (!isOn) return
      preloadFrom = { ...totals }
    },
    /** 背景預載全部完成 */
    preloaded() {
      if (!isOn) return
      preloadMs = now() - startedAt
      preloadHosts = emptyHosts()
      for (const call of HOST_CALLS) preloadHosts[call] = totals[call] - preloadFrom[call]
    },
    /** 要寫紀錄：沒有正在寫的就回 true（開始寫），正在寫就記著寫完再寫一次 */
    beginSave(): boolean {
      if (!isOn || path === '') return false
      if (isSaving) {
        isDirty = true
        return false
      }
      isSaving = true
      return true
    },
    /** 寫完一次：中間又有新的就回 true，再寫一次 */
    endSave(): boolean {
      if (isDirty) {
        isDirty = false
        return true
      }
      isSaving = false
      return false
    },
    /** 摘要：每行 `COUNTER <名稱> <值>` */
    summary(): string {
      const lines: string[] = [`session ${sessionId || '-'}`]
      lines.push(`start.wait_ms ${startWaitMs === undefined ? '-' : fmt(startWaitMs)}`)
      lines.push(`preload.ms ${preloadMs === undefined ? '-' : fmt(preloadMs)}`)
      for (const call of HOST_CALLS) lines.push(`preload.${call} ${preloadHosts === undefined ? '-' : preloadHosts[call]}`)
      lines.push(...msLines('render', renders.get('all')))
      for (const [tab, s] of [...renders].filter(([k]) => k !== 'all').sort(([a], [b]) => a.localeCompare(b)))
        lines.push(...msLines(`render.${tab}`, s))
      lines.push(`render.recent ${recent.join(',') || '-'}`)
      const timers = [...hooks].filter(([k]) => k.startsWith('timer.'))
      lines.push(`timer.callbacks ${timers.reduce((n, [, s]) => n + s.count, 0)}`)
      const named = [...hooks].map(([name, s]) => [name.startsWith('timer.') ? name : `hook.${name}`, s] as const)
      for (const [name, s] of named.sort(([a], [b]) => a.localeCompare(b))) lines.push(...msLines(name, s))
      for (const call of HOST_CALLS) lines.push(`host.total.${call} ${totals[call]}`)
      for (const [event, counts] of [...byEvent].sort(([a], [b]) => a.localeCompare(b)))
        for (const call of HOST_CALLS) if (counts[call] > 0) lines.push(`host.${event}.${call} ${counts[call]}`)
      return lines.map(l => `COUNTER ${l}`).join('\n') + '\n'
    },
  }
}
