import { reasonOf } from './events'
import { redact } from './remoteStatus'
import { ghAccounts } from './ghAccounts'
import { MAP_LABEL, PAGE_SIZE, effortsOf, getJson, getPages, labelOf, nameOf, pickMaps, readSpecs, remoteReader } from './remoteCore'
import type { Blockers, Endpoint, Etags, MapRead, RemoteIssue, RemotePorts, RemoteReader } from './remoteCore'

/**
 * GitHub 的路線圖讀取器：tracker 文件寫 GitHub 時，用使用者自己的 `gh` 只發 GET 讀 `wayfinder:map` issue 與它的子票。
 * 這裡只有 GitHub 自己的部分——端點與 argv（`ghEndpoint`）、JSON 換成 `RemoteIssue`（`fromGithub`）、
 * 規格書子票與擋路者清單怎麼讀；重讀規則、ETag、失敗分類與正規化在 `remoteCore`，多帳號在 `ghAccounts`。
 */

/**
 * GitHub 的端點（相對於 `repos/{owner}/{repo}/`，`gh` 從專案的 git remote 代換 owner／repo）。
 * 地圖清單照最近更新排序（最近結案的在前面），第 `n` 頁（第一頁不寫 `page`）
 */
export const GITHUB_PATHS = {
  maps: (n = 1) => `issues?labels=${MAP_LABEL}&state=all&sort=updated&direction=desc&per_page=${PAGE_SIZE}${n > 1 ? `&page=${n}` : ''}`,
  subIssues: (n: number) => `issues/${n}/sub_issues?per_page=100`,
  blockedBy: (n: number) => `issues/${n}/dependencies/blocked_by?per_page=100`,
}

/** 專案自己的 repo：`gh` 從專案的 git remote 代換 */
const HOME_REPO = '{owner}/{repo}'

/**
 * 一個 GitHub 端點：`repo` 是別的 repo（`owner/name`），沒給是專案自己的。只發 GET：不帶 `-X`／`--method`／`-f`／`-F`／`--input`；
 * `-i` 讓輸出帶狀態行與 header（304、額度、ETag 都在那裡）。不用 `--cache`（跨 session 的硬碟快取會給舊資料）。
 */
export function ghEndpoint(path: string, repo?: string): Endpoint {
  return {
    key: repo === undefined ? path : `${repo}:${path}`,
    argv: etag => ['gh', 'api', '-i', ...(etag !== undefined ? ['-H', `If-None-Match: ${etag}`] : []), `repos/${repo ?? HOME_REPO}/${path}`],
    ...(repo !== undefined ? { repo } : {}),
  }
}

/** GitHub issue 裡路線圖用到的欄位 */
type GhIssue = {
  number: number
  title: string
  state: 'open' | 'closed'
  html_url: string
  repository_url: string
  body?: string | null
  labels: ({ name: string } | string)[]
  assignees?: unknown[] | null
  updated_at: string
  closed_at?: string | null
  issue_dependencies_summary?: { blocked_by: number; total_blocked_by: number } | null
  /** 子票張數；包含看不到的（別的 repo 沒權限），比回傳的子票多就是有讀不到的 */
  sub_issues_summary?: { total: number } | null
  pull_request?: unknown
}

/** GitHub 的 issue → 共用的形狀；`project` 用 `repository_url` */
function fromGithub(issue: GhIssue): RemoteIssue {
  const deps = issue.issue_dependencies_summary
  return {
    url: issue.html_url,
    number: issue.number,
    title: issue.title,
    isClosed: issue.state === 'closed',
    body: issue.body ?? '',
    labels: issue.labels.map(l => (typeof l === 'string' ? l : l.name)),
    hasAssignee: (issue.assignees?.length ?? 0) > 0,
    project: issue.repository_url,
    updatedAt: issue.updated_at,
    ...(issue.closed_at ? { closedAt: issue.closed_at } : {}),
    ...(deps && deps.total_blocked_by > 0 ? { blockedCount: deps.blocked_by } : {}),
    ...(issue.sub_issues_summary ? { childTotal: issue.sub_issues_summary.total } : {}),
  }
}

/** 一張 issue 在哪個 repo（`owner/name`）；跟地圖同一個 repo 是 undefined（交給 `gh` 從專案 remote 代換） */
const repoOf = (issue: RemoteIssue, map: RemoteIssue) => (issue.project === map.project ? undefined : issue.project.replace(/^.*\/repos\//, ''))

const getIssues = async (ports: RemotePorts, endpoint: Endpoint, etags: Etags) => (await getJson<GhIssue[]>(ports, endpoint, etags)).map(fromGithub)

/**
 * 一張地圖：地圖的子票一次，每份規格書的子票各一次（一個 effort 約 3 個請求）；別的 repo 的規格書在它自己的 repo 讀，
 * 讀不到（沒權限）只算那份規格書的票讀不到，不讓整張路線圖失敗。
 */
async function readMap(ports: RemotePorts, map: RemoteIssue, etags: Etags): Promise<MapRead> {
  const subs = await getIssues(ports, ghEndpoint(GITHUB_PATHS.subIssues(map.number)), etags)
  const builds = await readSpecs(ports, { map, subs }, s => getIssues(ports, ghEndpoint(GITHUB_PATHS.subIssues(s.number), repoOf(s, map)), etags))
  return { map, subs, builds }
}

/** 讀這個 repo 的地圖：地圖列表（滿 100 張翻頁，PR 不算），再讀每張地圖 */
async function readGithub(ports: RemotePorts, etags: Etags): Promise<MapRead[]> {
  const listed = await getPages<GhIssue>(ports, n => ghEndpoint(GITHUB_PATHS.maps(n)), etags)
  const maps = pickMaps(listed.filter(i => i.pull_request === undefined).map(fromGithub))
  return Promise.all(maps.map(map => readMap(ports, map, etags)))
}

/** 一張地圖裡被原生 dependencies 卡住（只知道張數）、還開著的票 */
const countBlocked = (read: MapRead) => [...read.subs, ...[...read.builds.values()].flat()].filter(i => !i.isClosed && (i.blockedCount ?? 0) > 0)

/**
 * 抓這張地圖裡被卡住的票的擋路者清單（`known` 裡已經有的不重抓），回傳新抓到的：網址 → 還開著的擋路者票號。
 * 抓失敗的票寫 debug log、不放進結果，畫面維持「等 N 張」。
 */
async function readBlockers(ports: RemotePorts, read: MapRead, known: Blockers, etags: Etags): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>()
  await Promise.all(
    countBlocked(read)
      .filter(i => !known.has(i.url))
      .map(async issue => {
        try {
          const blockers = await getIssues(ports, ghEndpoint(GITHUB_PATHS.blockedBy(issue.number), repoOf(issue, read.map)), etags)
          found.set(issue.url, blockers.filter(b => !b.isClosed).map(b => labelOf(b, read.map)))
        } catch (err) {
          ports.log(`讀 ${labelOf(issue, read.map)} 的擋路者失敗：${redact(reasonOf(err))}`)
        }
      }),
  )
  return found
}

/** GitHub 的讀取器：點開 effort 時補抓擋路者清單（票 19）；`gh api` 404 時試其他帳號（票 21） */
export function githubRoadmap(): RemoteReader {
  return remoteReader('github', () => {
    // 上次讀到的地圖與抓過的擋路者清單：點開 effort 時只補抓擋路者
    let last: readonly MapRead[] = []
    let blockers: Blockers = new Map()
    return {
      // 多帳號：哪個 repo 用哪個帳號讀，`/clear` 換新的 session 時清掉
      ports: ghAccounts(),
      read: async (ports, etags) => {
        const reads = await readGithub(ports, etags)
        // 展開著的 effort 重讀時一起抓擋路者（擋路者可能已經結案）
        const open = new Set((await ports.openEfforts?.()) ?? [])
        const found = await Promise.all(reads.filter(r => open.has(nameOf(r))).map(r => readBlockers(ports, r, new Map(), etags)))
        return () => {
          last = reads
          blockers = new Map(found.flatMap(f => [...f]))
          return effortsOf(last, 'github', blockers)
        }
      },
      // 點開一個 effort：對它被卡住、還沒抓過的票抓擋路者清單；沒有要抓的不連網
      expand: async (name, ports, etags) => {
        const read = last.find(r => nameOf(r) === name)
        if (read === undefined || countBlocked(read).every(i => blockers.has(i.url))) return undefined
        const found = await readBlockers(ports, read, blockers, etags)
        if (found.size === 0) return undefined
        return () => {
          blockers = new Map([...blockers, ...found])
          return effortsOf(last, 'github', blockers)
        }
      },
    }
  })
}
