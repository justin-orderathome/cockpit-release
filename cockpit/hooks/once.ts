/**
 * 同一時間只跑一件的背景工作：翻譯說明、整理用法、產生教學各有一個。
 * 「現在在跑哪一件」只記在這裡；畫面要顯示的狀態由 `onChange` 通知呼叫端去寫。
 */

/** 這次有跑就是 `value`；已經有一件在跑就是 `busy`（那一件的名字），這次不跑 */
export type Ran<T> = { value: T } | { busy: string }

export type SingleJob = {
  /** 正在跑的那一件的名字；沒有在跑是 undefined */
  current: () => string | undefined
  /**
   * 沒有別的在跑才執行 `work`。開始與結束時各通知一次 `onChange`（結束時是 undefined），
   * `work` 出錯也一樣會通知結束，錯誤照樣往外丟。
   */
  run: <T>(name: string, work: () => Promise<T>, onChange?: (running: string | undefined) => Promise<void>) => Promise<Ran<T>>
}

export function singleJob(): SingleJob {
  let running: string | undefined
  return {
    current: () => running,
    run: async (name, work, onChange) => {
      if (running !== undefined) return { busy: running }
      running = name
      try {
        await onChange?.(name)
        return { value: await work() }
      } finally {
        running = undefined
        // 通知失敗不該蓋掉 work 的結果
        await onChange?.(undefined).catch(() => {})
      }
    },
  }
}
