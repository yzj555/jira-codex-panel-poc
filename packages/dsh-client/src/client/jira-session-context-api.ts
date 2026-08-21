/** Same-origin wire client for the DSH session-to-Jira context endpoint. */

/** One DSH workspace bound to a Jira issue. */
export interface JiraProjectScope {
  readonly id: string
  readonly cwd: string
  readonly projectLabel: string
}

/** Jira detail fields rendered by the compact session context card. */
export interface JiraSessionIssue {
  readonly key: string
  readonly title: string
  readonly type: string
  readonly typeName: string
  readonly status: string
  readonly statusName: string
  readonly priority: string
  readonly assignee: string
  readonly summary: string
  readonly projectName: string
  readonly url: string
  readonly parentIssue: { readonly key: string; readonly title: string } | null
}

/** Current Jira binding resolved for one visible DSH session. */
export interface JiraSessionContext {
  readonly sessionId: string
  readonly issueKey: string
  readonly issue: JiraSessionIssue
  readonly issueError: { readonly code: string; readonly message: string } | null
  readonly projectScopes: readonly JiraProjectScope[]
  readonly workspaceError: { readonly code: string; readonly message: string } | null
  readonly conflictingIssueKeys: readonly string[]
}

/** Versioned session-context read result used for later CAS unlink. */
export interface JiraSessionContextResult {
  readonly revision: number
  readonly context: JiraSessionContext | null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, maximum = 20_000): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function errorDetail(value: unknown): { code: string; message: string } | null {
  const source = record(value)
  if (source === null) return null
  const message = text(source.message, 2_000)
  return message ? { code: text(source.code, 200), message } : null
}

function issueDetail(value: unknown, issueKey: string): JiraSessionIssue {
  const source = record(value) ?? {}
  const parent = record(source.parentIssue)
  return {
    key: text(source.key, 100) || issueKey,
    title: text(source.title, 1_000) || '已关联 Jira 任务',
    type: text(source.type, 100),
    typeName: text(source.typeName, 100),
    status: text(source.status, 100),
    statusName: text(source.statusName, 100) || '状态未知',
    priority: text(source.priority, 100),
    assignee: text(source.assignee, 200),
    summary: text(source.summary),
    projectName: text(source.projectName, 300),
    url: text(source.url, 2_000),
    parentIssue: parent && text(parent.key, 100)
      ? { key: text(parent.key, 100), title: text(parent.title, 1_000) }
      : null,
  }
}

function projectScopes(value: unknown): JiraProjectScope[] {
  const binding = record(value)
  const workspace = record(binding?.workspace)
  const source = Array.isArray(workspace?.projectScopes) ? workspace.projectScopes : []
  return source.flatMap((candidate, index) => {
    const scope = record(candidate)
    const cwd = text(scope?.cwd, 2_000)
    if (!scope || !cwd) return []
    return [{
      id: text(scope.id, 1_000) || `scope:${index + 1}`,
      cwd,
      projectLabel: text(scope.projectLabel, 500) || cwd,
    }]
  })
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = record(await response.json().catch(() => null))
  if (payload === null) throw new Error('Jira 会话关联服务返回了无效数据。')
  if (!response.ok || payload.ok !== true) {
    const detail = record(payload.error)
    throw new Error(text(detail?.message, 2_000) || `Jira 会话关联请求失败（HTTP ${response.status}）。`)
  }
  return payload
}

/**
 * Reads the Jira issue currently linked to a DSH session.
 * @param sessionId - Current DSH session id.
 * @returns the versioned binding context, or null context when unbound.
 */
export async function loadJiraSessionContext(sessionId: string): Promise<JiraSessionContextResult> {
  const response = await fetch(`/jira-workbench/session-context?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const payload = await readResponse(response)
  const revision = Number(payload.revision)
  if (!Number.isInteger(revision) || revision < 0) throw new Error('Jira 会话关联版本无效。')
  if (payload.context === null) return { revision, context: null }
  const source = record(payload.context)
  const issueKey = text(source?.issueKey, 100).toUpperCase()
  const resolvedSessionId = text(source?.sessionId, 1_000)
  if (!source || !/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey) || !resolvedSessionId) {
    throw new Error('Jira 会话关联内容不完整。')
  }
  return {
    revision,
    context: {
      sessionId: resolvedSessionId,
      issueKey,
      issue: issueDetail(source.issue, issueKey),
      issueError: errorDetail(source.issueError),
      projectScopes: projectScopes(source.workspace),
      workspaceError: errorDetail(source.workspaceError),
      conflictingIssueKeys: Array.isArray(source.conflictingIssueKeys)
        ? source.conflictingIssueKeys.map(value => text(value, 100)).filter(Boolean)
        : [],
    },
  }
}

/**
 * Removes a Jira binding only when the caller still owns its exact revision.
 * @param input - Session, issue, and CAS revision from the last read.
 * @returns the next binding revision.
 */
export async function clearJiraSessionContext(input: {
  sessionId: string
  issueKey: string
  expectedRevision: number
}): Promise<number> {
  const response = await fetch('/jira-workbench/session-context', {
    method: 'DELETE',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = await readResponse(response)
  const revision = Number(payload.revision)
  if (!Number.isInteger(revision) || revision < 0) throw new Error('解除关联后的版本回执无效。')
  return revision
}
