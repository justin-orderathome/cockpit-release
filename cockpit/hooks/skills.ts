import type { CommandEntry, FrontmatterEntry, SkillGroup, SkillItem, SkillOverrides } from '../types'
import { HOWTO_PARTS, howtoCount } from './howto'
import type { Howtos } from './howto'
import { cachedFor } from './translate'
import type { Translations } from './translate'

export const MY_SKILLS = 'my-skills'
export const BUILTIN_SKILLS = 'builtin-skills'

export const EMPTY_OVERRIDES: SkillOverrides = { groups: {}, descriptions: {}, hidden: [], move: {} }

/** 用 `npx skills add` 裝的 skill（全域或專案裡）從哪個 repo 來：skill 名稱 → `owner/repo` */
export type SkillSources = Record<string, string>

export const NO_SOURCES: SkillSources = {}

/** description 的第一句：到第一個句號、問號、驚嘆號或換行為止。 */
export function firstSentence(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  // 英文句點後面要接空白（避免切到 v2.1 這種），中文句號不用
  const hit = /^(.*?(?:[.!?](?=\s|$)|[。！？]))/.exec(line)
  return (hit?.[1] ?? line).trim()
}

const byLabel = (a: SkillItem, b: SkillItem) => a.label.localeCompare(b.label)

/**
 * 把 $.command.list() 分成四種組別：每個 plugin 一組、每個來源一組、「我的 skill」、「內建 skill」。
 * 來源組是使用者層級的 skill 裡，`sources` 查得到來源的那些，組的 id 是 `owner/repo`；
 * 查不到的留在「我的 skill」。plugin 名稱不會有 `/`，所以兩種 id 不會撞在一起。
 * 內建指令（builtin 但不在 skillFrontmatter 裡）與 mod 指令（plugin 但名稱沒有前綴）不列。
 */
export function groupSkills(
  commands: readonly CommandEntry[],
  frontmatter: readonly FrontmatterEntry[],
  overrides: SkillOverrides = EMPTY_OVERRIDES,
  translations: Translations = {},
  howtos: Howtos = {},
  sources: SkillSources = NO_SOURCES,
): SkillGroup[] {
  const builtinSkills = new Set(frontmatter.filter(f => f.source === 'built-in').map(f => f.name))
  const hidden = new Set(overrides.hidden)
  // 所有的組：id → 項目
  const lists = new Map<string, SkillItem[]>()

  // 說明的優先順序：自訂短說明 → 繁體中文翻譯 → 原文的第一句
  const item = (c: CommandEntry, label: string): SkillItem => {
    const translated = cachedFor(translations, c)
    const howto = howtos[c.name]?.howto
    return {
      name: c.name,
      label,
      summary: overrides.descriptions[c.name] ?? translated?.summary ?? firstSentence(c.description),
      description: translated?.description ?? c.description,
      // 四項都空的當作沒有用法
      ...(howtoCount(howto) > 0 ? { howto } : {}),
      // 只依說明整理的用法，用法頁要標示
      ...(howtos[c.name]?.kind === 'description' ? { howtoKind: 'description' as const } : {}),
    }
  }

  // 放進組：move 有指定就放那一組（同名就併、不同名就開自訂組），否則放預設的組；顯示名稱不變
  const put = (id: string, c: CommandEntry, label: string) => {
    const to = movedTo(overrides.move, c.name) ?? id
    const list = lists.get(to) ?? []
    list.push(item(c, label))
    lists.set(to, list)
  }

  for (const c of commands) {
    if (hidden.has(c.name)) continue
    const colon = c.name.indexOf(':')
    if (c.source === 'plugin' && colon > 0) {
      put(c.plugin ?? c.name.slice(0, colon), c, c.name.slice(colon + 1))
    } else if (c.source === 'user' && Object.hasOwn(sources, c.name)) {
      put(sources[c.name] ?? '', c, c.name)
    } else if (c.source === 'user') {
      put(MY_SKILLS, c, c.name)
    } else if (c.source === 'builtin' && builtinSkills.has(c.name)) {
      put(BUILTIN_SKILLS, c, c.name)
    }
  }

  const items = (id: string) => (lists.get(id) ?? []).sort(byLabel)
  // plugin 組、來源組與 move 開的自訂組照 id 的字母排，「我的 skill」與「內建 skill」固定在最後
  const groups: SkillGroup[] = [...lists.keys()]
    .filter(id => id !== MY_SKILLS && id !== BUILTIN_SKILLS)
    .sort((a, b) => a.localeCompare(b))
    .map(id => ({ id, title: overrides.groups[id] ?? id, items: items(id) }))
  groups.push({ id: MY_SKILLS, title: overrides.groups[MY_SKILLS] ?? '我的 skill', items: items(MY_SKILLS) })
  groups.push({ id: BUILTIN_SKILLS, title: overrides.groups[BUILTIN_SKILLS] ?? '內建 skill', items: items(BUILTIN_SKILLS) })
  return groups.filter(g => g.items.length > 0 && !hidden.has(g.id))
}

/**
 * `move` 指定的組 id：完整名稱優先，其次是結尾 `*` 的前綴裡最長的那個。
 * 只認結尾的一個 `*`，中間的 `*` 照字面比對（也就是什麼都不符合）；值是空的當作沒寫。
 */
function movedTo(move: Record<string, string>, name: string): string | undefined {
  const exact = Object.hasOwn(move, name) ? move[name]?.trim() : undefined
  if (exact) return exact
  let best: string | undefined
  let bestLength = -1
  for (const [key, value] of Object.entries(move)) {
    const prefix = key.slice(0, -1)
    const to = value.trim()
    if (!key.endsWith('*') || !name.startsWith(prefix) || prefix.length <= bestLength || to === '') continue
    best = to
    bestLength = prefix.length
  }
  return best
}

/** 會列在 [SKILL] 裡的指令（不含隱藏的），也就是需要翻譯的對象。 */
export const listedCommands = (
  commands: readonly CommandEntry[],
  frontmatter: readonly FrontmatterEntry[],
  overrides: SkillOverrides = EMPTY_OVERRIDES,
  sources: SkillSources = NO_SOURCES,
): CommandEntry[] => {
  // 藏掉整個來源組時，那幾個 skill 也不列，所以要帶著來源分組
  const names = new Set(
    groupSkills(commands, frontmatter, overrides, {}, {}, sources).flatMap(g => g.items.map(i => i.name)),
  )
  return commands.filter(c => names.has(c.name))
}

/** 搜尋：比對名稱、說明與四項用法（不分大小寫），只留有符合項目的組。 */
export function filterSkills(groups: readonly SkillGroup[], query: string): SkillGroup[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...groups]
  return groups
    .map(g => ({
      ...g,
      items: g.items.filter(i =>
        [i.name, i.summary, i.description, ...HOWTO_PARTS.flatMap(p => i.howto?.[p.key] ?? [])].some(s =>
          s.toLowerCase().includes(q),
        ),
      ),
    }))
    .filter(g => g.items.length > 0)
}

/** 讀 skills.json；格式不對的部分當作沒寫。 */
export function parseOverrides(text: string): SkillOverrides {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return EMPTY_OVERRIDES
  }
  const obj = (v: unknown): Record<string, string> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter((p): p is [string, string] => typeof p[1] === 'string'))
      : {}
  const d = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  return {
    groups: obj(d.groups),
    descriptions: obj(d.descriptions),
    hidden: Array.isArray(d.hidden) ? d.hidden.filter((h): h is string => typeof h === 'string') : [],
    move: obj(d.move),
  }
}

/**
 * 讀 `npx skills` 記下的 `~/.agents/.skill-lock.json`（`{ skills: { <名稱>: { source: 'owner/repo' } } }`）。
 * 那是別的工具的格式，可能會改：讀不懂的部分當作沒有來源資訊，退回「我的 skill」。
 * 沒有這個檔（`undefined`）也一樣當作沒有來源。
 */
export function parseSkillLock(text: string | undefined): SkillSources {
  if (text === undefined) return NO_SOURCES
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return NO_SOURCES
  }
  const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!isObject(data) || !isObject(data.skills)) return NO_SOURCES
  const sources: SkillSources = {}
  for (const [name, entry] of Object.entries(data.skills)) {
    const source = isObject(entry) ? entry.source : undefined
    if (typeof source === 'string' && source.trim() !== '') sources[name] = source.trim()
  }
  return sources
}

/**
 * 全域的 lock 檔和各專案根目錄的 `skills-lock.json`（`npx skills add` 不加 `-g` 時寫的）合併。
 * 同一個名稱兩邊都有時用全域的：同名時 Claude Code 生效的是使用者層那一份。
 * 專案的幾份之間，排在前面的（專案根目錄先於 repo 根目錄）為準。
 */
export function mergeSkillSources(globalSources: SkillSources, projects: readonly SkillSources[]): SkillSources {
  // 先複製再反轉：reverse() 會改到傳進來的陣列
  return Object.assign({}, ...[...projects].reverse(), globalSources)
}

/**
 * `[ 編輯 SKILL 覆寫 ]` 找不到檔案時建立的範例。JSON 不能寫註解，說明放在 `說明` 這個鍵：
 * `parseOverrides` 只讀認得的鍵，其餘的不理。
 */
export const SAMPLE_OVERRIDES = `{
  "說明": [
    "這個檔決定 cockpit 的 [SKILL] 怎麼分組與顯示。存檔後切到別的分頁再切回 [SKILL] 就生效。",
    "這一段只是說明，cockpit 不讀；不需要可以整段刪掉。下面四個鍵都可以省略。",
    "",
    "groups：幫整組改名。鍵是組的 id（plugin 名稱、來源的 owner/repo、move 開的自訂組，或 my-skills、builtin-skills），值是顯示的組名。",
    "  例：\\"groups\\": { \\"mattpocock-skills\\": \\"mattpocock\\", \\"emilkowalski/skills\\": \\"emil\\" }",
    "",
    "descriptions：自訂一句話的短說明，優先於自動翻譯。鍵是 skill 的完整名稱（填進輸入框的那個）。",
    "  例：\\"descriptions\\": { \\"mattpocock-skills:wayfinder\\": \\"大型工作的地圖\\" }",
    "",
    "hidden：要藏起來的 skill（完整名稱）或整組（組的 id）。",
    "  例：\\"hidden\\": [\\"mattpocock-skills:teach\\", \\"builtin-skills\\"]",
    "",
    "move：把 skill 移到指定的組。鍵是 skill 的完整名稱，結尾可以加一個 * 比對開頭相同的；值是組的 id，和現有的組同名就併進去，否則開一個自訂組。",
    "  例：\\"move\\": { \\"gitnexus-*\\": \\"gitnexus\\", \\"show-me\\": \\"emilkowalski/skills\\", \\"mattpocock-skills:grilling\\": \\"常用\\" }",
    "  完整名稱優先於 *；符合多個 * 時取最長的。單獨列在 hidden 的 skill 移到哪都照樣藏著，整組藏掉時移出去的會在新組出現。"
  ],
  "groups": { "mattpocock-skills": "mattpocock" },
  "descriptions": {},
  "hidden": [],
  "move": {}
}
`
