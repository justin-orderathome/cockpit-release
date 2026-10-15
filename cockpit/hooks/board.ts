/**
 * 任務板的一件事會動到的三份狀態：任務板本身、主清單的完成數與總數、經手。
 * 「這件事之後三份各變成什麼、哪幾份變了」只在這裡決定；`register.tsx` 讀一輪、照 `changed` 寫，
 * 每個 atom 照樣在呼叫處寫明（ADR 0002）。一件事只寫一次，所以最多一次重繪。
 */
import type { TaskBoard } from '../types'
import { applyHandled } from './handled'
import type { Handled, HandledEvent } from './handled'
import { isSame } from './same'
import { applyTask, isEnded, progressOf } from './tasks'
import type { Progress, TaskEvent } from './tasks'

export type BoardState = { board: TaskBoard; progress: Progress; handled: Handled }

/** 一件事：任務板的變化、經手的變化，或兩者一起（派 subagent 時 prompt 裡有票） */
export type BoardStep = { task?: TaskEvent; handled?: HandledEvent }

/** 三份狀態各自變了沒 */
export type BoardChanged = { board: boolean; progress: boolean; handled: boolean }

/** 任務板在這件事之後的樣子；寫入時套在當下最新的任務板上 */
export const boardAfter = (board: TaskBoard, step: BoardStep): TaskBoard =>
  step.task === undefined ? board : applyTask(board, step.task)

/**
 * 經手在這件事之後的樣子；`board` 是這件事之後的任務板。
 * subagent 真的結束了（不是在等它派的子 agent）時，它經手的票一起拿掉。
 */
export function handledAfter(handled: Handled, board: TaskBoard, step: BoardStep): Handled {
  let next = step.handled === undefined ? handled : applyHandled(handled, step.handled)
  const task = step.task
  if (task?.kind === 'ended') {
    const row = board.agents.find(g => g.id === task.agentId)
    if (row !== undefined && isEnded(row)) next = applyHandled(next, { kind: 'ended', agentId: task.agentId })
  }
  return next
}

/** 一件事之後的三份狀態，與哪幾份變了（沒變的不必寫，寫了就重繪） */
export function stepBoard(state: BoardState, step: BoardStep): { next: BoardState; changed: BoardChanged } {
  const board = boardAfter(state.board, step)
  const next = { board, progress: progressOf(board), handled: handledAfter(state.handled, board, step) }
  return {
    next,
    changed: {
      board: !isSame(state.board, next.board),
      progress: !isSame(state.progress, next.progress),
      handled: !isSame(state.handled, next.handled),
    },
  }
}
