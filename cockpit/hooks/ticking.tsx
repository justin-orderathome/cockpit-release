/**
 * 畫面那一側自己走的字（`Client` 的 surface module）：[任務] 每秒的耗時欄與「還需約」、用量的 5H 倒數。
 *
 * plugin 這一側重繪時把那一刻的時間（`at`）與當時的數字放進 props；這裡從那一刻起每隔一段自己加，
 * 不寫 plugin 的狀態，所以不會引起整個面板重繪。plugin 再重繪、帶來新的 `at` 時，從新的數字接著走。
 * 面板關了、切到別的分頁，或那一列不再進行中，這個實例就跟著卸載，計時器一起停。
 * 這裡沒有 `$`，也不讀牆上的時鐘：經過的時間就是「跳了幾次 × 間隔」。
 */
import type { ClientSurface, RenderElement } from 'claude-code'

import { advanceRow, agentTime, formatDuration, remainingAfter, taskCells } from './tasks'
import type { RowTiming } from './tasks'
import { countdown } from './usage'

export type TickingProps =
  /** 進行中任務列的進度條、百分比與時間；`width` 是這一列可用的寬度（已扣掉縮排） */
  | { kind: 'task'; at: number; row: RowTiming; width: number; gap: number; accent: string }
  /** 進行中 subagent 列的耗時 */
  | { kind: 'agent'; at: number; elapsedMs: number }
  /** 標題列的「 · 還需約 …」：主清單還沒完成的列 */
  | { kind: 'remaining'; at: number; rows: RowTiming[] }
  /** 5H 的重置倒數：進度條後面的「 2h10m」，補到 `width` 格 */
  | { kind: 'countdown'; at: number; resetsAt: string; width: number }

/** 自己跳了幾次；`at` 是那時 props 的時間，props 換了新的時間就從 0 重數 */
type Ticks = { at: number; count: number }

/** 每種多久跳一次 */
const EVERY: Record<TickingProps['kind'], number> = { task: 1000, agent: 1000, remaining: 1000, countdown: 60_000 }

/** 每個實例的計時器是從哪個 props 的時間開始數的，與停掉它的方法 */
const timers = new WeakMap<object, { at: number; cancel: () => void }>()

/**
 * 從 props 的那一刻起，畫面這一側過了多久。props 換了新的時間就重開計時器：
 * 舊的那一跳可能差不到一個間隔就到，接著算會快（耗時欄最多快 1 秒，倒數最多早 59 秒少一分鐘）。
 */
function sinceProps(s: ClientSurface<Ticks>, at: number, every: number): number {
  const timer = timers.get(s)
  if (timer === undefined || timer.at !== at) {
    timer?.cancel()
    const cancel = s.every(every, () => {
      const last = s.state
      s.setState({ at, count: last !== undefined && last.at === at ? last.count + 1 : 1 })
    })
    timers.set(s, { at, cancel })
  }
  return s.state !== undefined && s.state.at === at ? s.state.count * every : 0
}

export default function Ticking(props: TickingProps, s: ClientSurface<Ticks>): RenderElement {
  const { Box, Text } = s.elements
  const ms = sinceProps(s, props.at, EVERY[props.kind])
  if (props.kind === 'agent') return <Text dimColor>{agentTime(props.elapsedMs + ms)}</Text>
  if (props.kind === 'remaining') {
    const left = remainingAfter(props.rows, ms)
    return <Text dimColor>{left === undefined ? '' : ` · 還需約 ${formatDuration(left)}`}</Text>
  }
  if (props.kind === 'countdown') {
    const left = countdown(props.resetsAt, props.at + ms)
    return <Text dimColor>{(left === undefined ? '' : ` ${left}`).padEnd(props.width)}</Text>
  }
  const cells = taskCells(advanceRow(props.row, ms), props.width)
  return (
    <Box flexDirection="row" gap={props.gap}>
      {cells.bar && (
        <Text>
          <Text color={props.accent}>{cells.bar.filled}</Text>
          <Text dimColor>{cells.bar.rest}</Text>
        </Text>
      )}
      {cells.percent !== undefined && <Text>{cells.percent}</Text>}
      <Text color={cells.isOverdue ? 'error' : undefined} dimColor={!cells.isOverdue}>
        {cells.time}
      </Text>
    </Box>
  )
}
