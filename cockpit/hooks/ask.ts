/**
 * 問模型一次的方式：翻譯說明、整理用法、產生教學都用同一種。
 * 正式用引擎的模型呼叫，測試用假的。
 */

/** 模型的回覆：有回答就是 `text`，沒有就是 `reason`（例如 api-error、aborted） */
export type Reply = { text: string } | { reason: string }

export type Ask = (request: { system: string; prompt: string }) => Promise<Reply>
