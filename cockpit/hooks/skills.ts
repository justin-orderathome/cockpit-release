import type { CommandEntry, FrontmatterEntry, SkillGroup, SkillItem, SkillOverrides } from '../types'
import { HOWTO_PARTS, howtoCount } from './howto'
import type { Howtos } from './howto'
import { cachedFor } from './translate'
import type { Translations } from './translate'

export const MY_SKILLS = 'my-skills'
export const BUILTIN_SKILLS = 'builtin-skills'

export const EMPTY_OVERRIDES: SkillOverrides = { groups: {}, descriptions: {}, hidden: [] }

/** description 的第一句：到第一個句號、問號、驚嘆號或換行為止。 */
export function firstSentence(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  // 英文句點後面要接空白（避免切到 v2.1 這種），中文句號不用
  const hit = /^(.*?(?:[.!?](?=\s|$)|[。！？]))/.exec(line)
  return (hit?.[1] ?? line).trim()
}

const byLabel = (a: SkillItem, b: SkillItem) => a.label.localeCompare(b.label)

/**
 * 把 $.command.list() 分成三種組別：每個 plugin 一組、「我的 skill」、「內建 skill」。
 * 內建指令（builtin 但不在 skillFrontmatter 裡）與 mod 指令（plugin 但名稱沒有前綴）不列。
 */
export function groupSkills(
  commands: readonly CommandEntry[],
  frontmatter: readonly FrontmatterEntry[],
  overrides: SkillOverrides = EMPTY_OVERRIDES,
  translations: Translations = {},
  howtos: Howtos = {},
): SkillGroup[] {
  const builtinSkills = new Set(frontmatter.filter(f => f.source === 'built-in').map(f => f.name))
  const hidden = new Set(overrides.hidden)
  const plugins = new Map<string, SkillItem[]>()
  const mine: SkillItem[] = []
  const builtins: SkillItem[] = []

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

  for (const c of commands) {
    if (hidden.has(c.name)) continue
    const colon = c.name.indexOf(':')
    if (c.source === 'plugin' && colon > 0) {
      const plugin = c.plugin ?? c.name.slice(0, colon)
      const list = plugins.get(plugin) ?? []
      list.push(item(c, c.name.slice(colon + 1)))
      plugins.set(plugin, list)
    } else if (c.source === 'user') {
      mine.push(item(c, c.name))
    } else if (c.source === 'builtin' && builtinSkills.has(c.name)) {
      builtins.push(item(c, c.name))
    }
  }

  const groups: SkillGroup[] = [...plugins.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map(id => ({ id, title: overrides.groups[id] ?? id, items: (plugins.get(id) ?? []).sort(byLabel) }))
  groups.push({ id: MY_SKILLS, title: overrides.groups[MY_SKILLS] ?? '我的 skill', items: mine.sort(byLabel) })
  groups.push({ id: BUILTIN_SKILLS, title: overrides.groups[BUILTIN_SKILLS] ?? '內建 skill', items: builtins.sort(byLabel) })
  return groups.filter(g => g.items.length > 0 && !hidden.has(g.id))
}

/** 會列在 [SKILL] 裡的指令（不含隱藏的），也就是需要翻譯的對象。 */
export const listedCommands = (
  commands: readonly CommandEntry[],
  frontmatter: readonly FrontmatterEntry[],
  overrides: SkillOverrides = EMPTY_OVERRIDES,
): CommandEntry[] => {
  const names = new Set(groupSkills(commands, frontmatter, overrides).flatMap(g => g.items.map(i => i.name)))
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
  }
}

/** `[ 編輯 SKILL 覆寫 ]` 找不到檔案時建立的範例。 */
export const SAMPLE_OVERRIDES = `{
  "groups": { "mattpocock-skills": "mattpocock" },
  "descriptions": {},
  "hidden": []
}
`
