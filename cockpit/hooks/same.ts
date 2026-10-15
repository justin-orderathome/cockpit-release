/**
 * 寫入值沒變就不寫：面板的狀態一被寫入就重繪，即使寫的值和原本一樣。
 *
 * 引擎要 `update` 的 atom 在呼叫處寫明（ADR 0002），所以這裡不包 atom，只做比對；
 * `register.tsx` 每個寫入點先 `read` 舊值，用這裡的函式決定要不要 `update`。
 * 比對方式是序列化後比字串：狀態都是 JSON 能表示的值，值是 undefined 的欄位和沒有這個欄位一樣。
 */

/** 兩個值序列化後一樣 */
export const isSame = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

/** 對 `prev` 套用 `change` 之後會不會變 */
export const changes = <T>(prev: T, change: (value: T) => T): boolean => !isSame(prev, change(prev))
