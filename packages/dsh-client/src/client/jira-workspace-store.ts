/** Shared navigation state for the native DSH Jira workspace surface. */

export type JiraWorkspaceRoute =
  | { readonly kind: 'board' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'detail'; readonly issueKey: string; readonly sessionId?: string }
  | { readonly kind: 'svn'; readonly issueKey: string }

export interface JiraWorkspaceSnapshot {
  readonly open: boolean
  readonly route: JiraWorkspaceRoute
  readonly revision: number
}

let snapshot: JiraWorkspaceSnapshot = {
  open: false,
  route: { kind: 'board' },
  revision: 0,
}

const listeners = new Set<() => void>()

function publish(next: Omit<JiraWorkspaceSnapshot, 'revision'>): void {
  snapshot = { ...next, revision: snapshot.revision + 1 }
  for (const listener of listeners) listener()
}

export const jiraWorkspaceStore = {
  getSnapshot(): JiraWorkspaceSnapshot {
    return snapshot
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  open(route: JiraWorkspaceRoute = { kind: 'board' }): void {
    publish({ open: true, route })
  },
  close(): void {
    if (!snapshot.open) return
    publish({ open: false, route: snapshot.route })
  },
  toggleBoard(): void {
    if (snapshot.open && snapshot.route.kind === 'board') {
      publish({ open: false, route: snapshot.route })
      return
    }
    publish({ open: true, route: { kind: 'board' } })
  },
}
