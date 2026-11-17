import { MAP_LABEL, PAGE_SIZE, effortsOf, getJson, getPages, headerRefs, pickMaps, readSpecs, remoteReader, sameIssue } from './remoteCore'
import type { Endpoint, Etags, MapRead, RemoteIssue, RemotePorts, RemoteReader } from './remoteCore'

/**
 * GitLab 的路線圖讀取器（票 23）：tracker 文件寫 GitLab 時，用使用者自己的 `glab` 只發 GET 讀。
 * 這裡只有 GitLab 自己的部分——端點與 argv（`glabEndpoint`）、JSON 換成 `RemoteIssue`（`fromGitlab`）、子票怎麼找；
 * 重讀規則、ETag／304、失敗分類、讀得怎樣與正規化跟 GitHub 共用 `remoteCore`。
 *
 * 跟 GitHub 不同的地方（決策票 03、04；**未實測**，照 docs.gitlab.com 寫）：
 * - 沒有原生的子票：子票以 body 開頭的 `Part of #<父>` 為準（決策票與規格書寫 `Part of #地圖`，實作票寫
 *   `Part of #規格書`）。issue links（`relates_to`）只拿來找候選，連著但沒寫 `Part of` 父票的不算。
 * - 免費版沒有 blocks 連結：卡住關係只讀 body 開頭的 `Blocked by: #n`；所以點開 effort 不必再連網。
 * - 狀態是 `opened`／`closed`、沒有進度欄位（`judgeEffort` 自己算）、子票照連結建立的時間排。
 * - 主機與專案由 `glab` 從專案的 git remote 找出來（`projects/:id/` 由 glab 代換），不寫死 gitlab.com。
 */

/** GitLab 的端點（相對於 `projects/:id/`）；地圖清單照最近更新排序，第 `n` 頁（第一頁不寫 `page`） */
export const GITLAB_PATHS = {
  maps: (n = 1) => `issues?labels=${MAP_LABEL}&state=all&order_by=updated_at&sort=desc&per_page=${PAGE_SIZE}${n > 1 ? `&page=${n}` : ''}`,
  links: (iid: number) => `issues/${iid}/links?per_page=100`,
}

/**
 * 一個 GitLab 端點：`project` 是別的專案的數字 id，沒給是專案自己的（`:id` 由 glab 代換）。
 * 只發 GET：不帶 `-X`／`--method`／`-f`／`-F`／`--input`；`-i` 讓輸出帶狀態行與 header。token 不放 query（`private_token=`），由 glab 自己帶。
 */
export function glabEndpoint(path: string, project?: number): Endpoint {
  return {
    key: project === undefined ? path : `${project}:${path}`,
    argv: etag => ['glab', 'api', '-i', ...(etag !== undefined ? ['-H', `If-None-Match: ${etag}`] : []), `projects/${project ?? ':id'}/${path}`],
  }
}

/** GitLab issue 裡路線圖用到的欄位；`links` 的每一筆另帶連結建立的時間 */
type GlIssue = {
  iid: number
  project_id: number
  title: string
  state: 'opened' | 'closed'
  web_url: string
  description?: string | null
  labels: string[]
  assignees?: unknown[] | null
  updated_at: string
  closed_at?: string | null
  link_created_at?: string
}

/** GitLab 的 issue → 共用的形狀；`project` 用專案的數字 id */
const fromGitlab = (issue: GlIssue): RemoteIssue => ({
  url: issue.web_url,
  number: issue.iid,
  title: issue.title,
  isClosed: issue.state === 'closed',
  body: issue.description ?? '',
  labels: issue.labels,
  hasAssignee: (issue.assignees?.length ?? 0) > 0,
  project: String(issue.project_id),
  updatedAt: issue.updated_at,
  ...(issue.closed_at ? { closedAt: issue.closed_at } : {}),
})

/** 父票的子票：連結裡 `Part of` 指回父票的，照連結建立的時間排（同時間照 API 順序） */
const childrenOf = (parent: RemoteIssue, linked: readonly GlIssue[]): RemoteIssue[] =>
  linked
    .map((raw, at) => ({ issue: fromGitlab(raw), at, time: Date.parse(raw.link_created_at ?? '') || 0 }))
    .filter(c => headerRefs(c.issue, 'Part of').some(ref => sameIssue(ref, ref, parent.url)))
    .sort((a, b) => a.time - b.time || a.at - b.at)
    .map(c => c.issue)

const getLinks = async (ports: RemotePorts, parent: RemoteIssue, endpoint: Endpoint, etags: Etags) =>
  childrenOf(parent, await getJson<GlIssue[]>(ports, endpoint, etags))

/** 一張地圖：地圖的連結一次，每份規格書的連結各一次；別的專案的規格書在它自己的專案（數字 id）讀，讀不到只讓 effort 帶 `!` */
async function readMap(ports: RemotePorts, map: RemoteIssue, etags: Etags): Promise<MapRead> {
  const subs = await getLinks(ports, map, glabEndpoint(GITLAB_PATHS.links(map.number)), etags)
  const builds = await readSpecs(ports, { map, subs }, s =>
    getLinks(ports, s, glabEndpoint(GITLAB_PATHS.links(s.number), s.project === map.project ? undefined : Number(s.project)), etags),
  )
  return { map, subs, builds }
}

/** 讀這個專案的路線圖：地圖列表（滿 100 張翻頁），再讀每張地圖 */
async function readGitlab(ports: RemotePorts, etags: Etags): Promise<MapRead[]> {
  const maps = pickMaps((await getPages<GlIssue>(ports, n => glabEndpoint(GITLAB_PATHS.maps(n)), etags)).map(fromGitlab))
  return Promise.all(maps.map(map => readMap(ports, map, etags)))
}

/** GitLab 的讀取器：卡住關係都寫在 body 裡、讀地圖時已經拿到，所以沒有 `expand` */
export function gitlabRoadmap(): RemoteReader {
  return remoteReader('gitlab', () => ({
    read: async (ports, etags) => {
      const reads = await readGitlab(ports, etags)
      return () => effortsOf(reads, 'gitlab')
    },
  }))
}
