export type Fill = { text: string; mode: 'replace' | 'append' }

/**
 * [基本] 與 [SKILL] 共用的填入規則：輸入框空的就直接填；有字時，
 * slash command 放在最前面（原本的字變成它的參數），一般 prompt 換行接在後面。
 */
export function composeFill(current: string, text: string): Fill {
  if (current.trim() === '') return { text, mode: 'replace' }
  if (text.startsWith('/')) return { text: `${text.trimEnd()} ${current.trimStart()}`, mode: 'replace' }
  return { text: `\n${text}`, mode: 'append' }
}
