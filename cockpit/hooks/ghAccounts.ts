import type { CliRun } from './effortJudge'
import { reasonOf } from './events'
import { parseApiOutput } from './remoteCore'
import { redact } from './remoteStatus'
import type { RemotePorts } from './remoteCore'

/** 多帳號只試 github.com 的帳號：`GH_TOKEN` 只對它有效 */
const GH_HOST = 'github.com'

/** `gh auth status --json hosts` → 作用中以外、登入正常的 github.com 帳號（這個輸出不含 token）；不是 JSON 會丟出 */
export function otherAccounts(stdout: string): string[] {
  const hosts = (JSON.parse(stdout) as { hosts?: Record<string, { login?: unknown; active?: unknown; state?: unknown }[]> }).hosts
  return (hosts?.[GH_HOST] ?? []).filter(a => a.active !== true && a.state === 'success' && typeof a.login === 'string').map(a => a.login as string)
}

/**
 * 多帳號（票 21、ADR 0004「後果」）：包住 `ports.run`，`gh api` 回 404 時依序改用其他已登入帳號重試，
 * 這個 session 記住每個 repo 哪個帳號讀得到，之後直接用它。帳號清單用 `gh auth status --json hosts`、
 * token 用 `gh auth token --user`（都只讀，不改作用中帳號），各問一次就記在記憶體裡。
 * token 只放進子程序的 env `GH_TOKEN`：不進 argv、debug log、`RemoteError`，取 token 失敗也只寫帳號名稱與結束碼。
 * 都讀不到就回作用中帳號那次的 404，交給 `getJson` 報 notFound。只有 GitHub 有多帳號，GitLab 不經過這裡。
 */
export function ghAccounts() {
  // repo（`repos/` 後兩段）→ 讀得到的帳號；沒記的用作用中帳號（`ACTIVE`）
  const ACTIVE = ''
  const chosen = new Map<string, string>()
  let others: Promise<string[]> | undefined
  const tokens = new Map<string, Promise<string | undefined>>()

  const listOthers = (ports: RemotePorts) =>
    (others ??= ports
      .run(['gh', 'auth', 'status', '--json', 'hosts'])
      .then(ran => otherAccounts(ran.stdout))
      .catch(err => (ports.log(`讀 gh 帳號清單失敗：${redact(reasonOf(err))}`), [])))
  const tokenOf = (ports: RemotePorts, login: string) => {
    let token = tokens.get(login)
    if (token === undefined) {
      token = ports.run(['gh', 'auth', 'token', '--user', login, '--hostname', GH_HOST]).then(
        ran => {
          const printed = ran.stdout.trim()
          if (ran.exitCode === 0 && printed !== '') return printed
          ports.log(`取 gh 帳號 ${login} 的 token 失敗（結束碼 ${ran.exitCode}）`)
          return undefined
        },
        () => (ports.log(`取 gh 帳號 ${login} 的 token 失敗（gh 起不來）`), undefined),
      )
      tokens.set(login, token)
    }
    return token
  }
  const envOf = async (ports: RemotePorts, login: string, env?: Record<string, string>) => {
    if (login === ACTIVE) return { env }
    const token = await tokenOf(ports, login)
    return token === undefined ? undefined : { env: { ...env, GH_TOKEN: token } }
  }
  const isNotFound = (ran: Awaited<ReturnType<CliRun>>) => parseApiOutput(ran.stdout)?.status === 404
  const isRead = (ran: Awaited<ReturnType<CliRun>>) => {
    const status = parseApiOutput(ran.stdout)?.status ?? 0
    return status === 304 || (status >= 200 && status < 300)
  }

  return (ports: RemotePorts): RemotePorts => ({
    ...ports,
    run: async (argv, env) => {
      if (argv[0] !== 'gh' || argv[1] !== 'api') return ports.run(argv, env)
      const repo = /^repos\/([^/]+\/[^/]+)\//.exec(argv.at(-1) ?? '')?.[1] ?? ''
      const first = chosen.get(repo) ?? ACTIVE
      const firstEnv = await envOf(ports, first, env)
      const ran = await ports.run(argv, firstEnv?.env)
      if (!isNotFound(ran)) return ran
      for (const login of [ACTIVE, ...(await listOthers(ports))]) {
        if (login === first) continue
        const next = await envOf(ports, login, env)
        if (next === undefined) continue
        const retried = await ports.run(argv, next.env)
        if (isRead(retried)) {
          if (login === ACTIVE) chosen.delete(repo)
          else chosen.set(repo, login)
          return retried
        }
      }
      return ran
    },
  })
}
