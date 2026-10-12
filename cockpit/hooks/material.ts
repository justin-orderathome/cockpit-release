import { tidy } from './files'
import type { Files } from './files'
import { charBytes } from './source'
import type { SkillFile } from './source'

/**
 * 教學的原料：一個 skill 的 SKILL.md，加上它用連結點到的檔。
 * 讀哪些檔、讀到哪裡為止都收在這裡；讀檔的方式由呼叫端給，這裡不碰引擎。
 */

/** 原料的上限（UTF-8 位元組），SKILL.md 與引用的檔合計 */
export const MATERIAL_LIMIT = 150 * 1024

/**
 * 要交給模型的全部文字，以及沒讀到的檔（相對於 skill 資料夾的路徑）：
 * 放不下的與讀不到的都算。
 */
export type Material = { text: string; skipped: string[] }

/** 讀一個檔；不存在或讀不到時回傳 undefined */
export type ReadFile = Files['read']

/** 引用的檔只收文字文件；圖片、腳本之類的不是教學的原料 */
const TEXT_FILE = /\.(md|mdx|txt)$/i

function byteLength(text: string): number {
  let bytes = 0
  for (const ch of text) bytes += charBytes(ch)
  return bytes
}

/**
 * 一個連結的目標換成相對於 skill 資料夾的路徑；不收的回傳 undefined：
 * 網址、絕對路徑、跳到資料夾外面的、不是文字文件的。`#` 之後的錨點去掉。
 */
function linkedPath(target: string): string | undefined {
  let path = tidy(target.trim().replace(/^<|>$/g, '')).replace(/[#?].*$/, '')
  try {
    path = decodeURIComponent(path)
  } catch {}
  if (path === '' || path.startsWith('/') || path.startsWith('~') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return undefined
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
    } else parts.push(part)
  }
  const tidied = parts.join('/')
  return TEXT_FILE.test(tidied) ? tidied : undefined
}

/** SKILL.md 裡用 markdown 連結點到的檔，依第一次出現的順序，重複的只算一次 */
function linkedFiles(text: string, self: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)[^)]*\)/g)) {
    const path = linkedPath(match[1] ?? '')
    if (path !== undefined && path !== self && !found.includes(path)) found.push(path)
  }
  return found
}

/** 每個檔前面標明它的相對路徑，模型才分得出內容來自哪裡 */
const section = (path: string, text: string) => `<<< 檔案：${path} >>>\n${text.trim()}\n`

/**
 * 讀出一個 skill 的教學原料。SKILL.md 一律收；引用的檔只跟一層（參考檔裡再引用的不讀），
 * 依出現的順序收到上限為止：下一個放不下就停，後面的都算沒讀到，不讀半個檔。
 */
export async function readMaterial(file: SkillFile, read: ReadFile): Promise<Material> {
  const path = tidy(file.path)
  const slash = path.lastIndexOf('/')
  const dir = slash < 0 ? '.' : path.slice(0, slash)
  const self = path.slice(slash + 1)
  const sections = [section(self, file.text)]
  const skipped: string[] = []
  let bytes = byteLength(file.text)
  let isFull = false
  for (const linked of linkedFiles(file.text, self)) {
    if (isFull) {
      skipped.push(linked)
      continue
    }
    let text: string | undefined
    try {
      text = await read(`${dir}/${linked}`)
    } catch {}
    if (text === undefined || text.trim() === '') {
      skipped.push(linked)
      continue
    }
    const size = byteLength(text)
    if (bytes + size > MATERIAL_LIMIT) {
      isFull = true
      skipped.push(linked)
      continue
    }
    bytes += size
    sections.push(section(linked, text))
  }
  return { text: sections.join('\n'), skipped }
}
