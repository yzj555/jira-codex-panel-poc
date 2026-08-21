/** Root-level Jira workspace occupying DSH's main content while preserving its sidebar. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { JiraConfigCardFace } from './jira-config-card-controller.ts'
import { JiraConfigCard } from './JiraConfigCard.tsx'
import { jiraWorkspaceStore, type JiraWorkspaceRoute } from './jira-workspace-store.ts'
import css from './JiraWorkspaceSurface.module.css'

export type JiraWorkspaceSurfaceProps =
  PropsLocale<'jira-workbench'>
  & InjectFace<JiraConfigCardFace>
  & { readonly openSession: (sessionId: string) => Promise<void> }

function workspaceUrl(route: JiraWorkspaceRoute): string {
  const params = new URLSearchParams({ transport: 'http', workspace: '1' })
  if (route.kind === 'detail' || route.kind === 'svn') params.set('issue', route.issueKey)
  if (route.kind === 'detail') {
    params.set('embed', 'detail')
    if (route.sessionId) params.set('currentSession', route.sessionId)
  }
  if (route.kind === 'svn') params.set('svn', '1')
  return `/jira-task-board?${params.toString()}`
}

/** Render the persistent main-area workspace registered in DSH's shell overlay. */
export function JiraWorkspaceSurface(props: JiraWorkspaceSurfaceProps) {
  const snapshot = useSyncExternalStore(
    jiraWorkspaceStore.subscribe,
    jiraWorkspaceStore.getSnapshot,
    jiraWorkspaceStore.getSnapshot,
  )
  const rootRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const detailHistoryTokenRef = useRef('')
  const suppressHistoryPopRef = useRef(false)
  const [sidebarInset, setSidebarInset] = useState(0)
  const [frameReady, setFrameReady] = useState(false)
  const [navigationError, setNavigationError] = useState('')
  const frameUrl = useMemo(() => workspaceUrl(snapshot.route), [snapshot.route])

  useLayoutEffect(() => {
    if (!snapshot.open) return undefined
    const root = rootRef.current
    let shellOverlay = root?.parentElement ?? null
    while (shellOverlay?.parentElement) {
      const bounds = shellOverlay.getBoundingClientRect()
      if (window.getComputedStyle(shellOverlay).position === 'absolute' && bounds.width > 320 && bounds.height > 280) break
      shellOverlay = shellOverlay.parentElement
    }
    const appFrame = shellOverlay?.parentElement
    const sidebar = appFrame?.firstElementChild
    if (!(appFrame instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return undefined
    let animationFrame = 0
    const update = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        const frameBox = appFrame.getBoundingClientRect()
        const sidebarBox = sidebar.getBoundingClientRect()
        setSidebarInset(Math.max(0, Math.round(sidebarBox.right - frameBox.left)))
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(appFrame)
    observer.observe(sidebar)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
    }
  }, [snapshot.open])

  useEffect(() => {
    if (!snapshot.open || snapshot.route.kind === 'settings') return undefined
    setFrameReady(false)
    setNavigationError('')
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== 'object') return
      const message = event.data as { source?: unknown; type?: unknown; sessionId?: unknown; view?: unknown }
      const releaseDetailHistory = () => {
        if (!detailHistoryTokenRef.current) return
        detailHistoryTokenRef.current = ''
        suppressHistoryPopRef.current = true
        window.history.back()
      }
      if (message.source === 'jira-workbench-local-ui' && message.type === 'navigation-state') {
        if (message.view === 'detail' && !detailHistoryTokenRef.current) {
          const token = `jira-workbench:${Date.now()}:${Math.random().toString(36).slice(2)}`
          const currentState = window.history.state && typeof window.history.state === 'object'
            ? window.history.state as Record<string, unknown>
            : {}
          detailHistoryTokenRef.current = token
          window.history.pushState({ ...currentState, jiraWorkbenchDetail: token }, '', window.location.href)
        } else if (message.view === 'board') {
          releaseDetailHistory()
        }
        return
      }
      if (message.source === 'jira-workbench-local-ui' && message.type === 'close') {
        releaseDetailHistory()
        jiraWorkspaceStore.close()
        return
      }
      if (message.source === 'jira-workbench-local-ui' && message.type === 'open-settings') {
        releaseDetailHistory()
        jiraWorkspaceStore.open({ kind: 'settings' })
        return
      }
      if (message.source !== 'jira-workbench-dsh' || message.type !== 'open-session') return
      const sessionId = typeof message.sessionId === 'string' ? message.sessionId.trim() : ''
      if (!sessionId) {
        setNavigationError(props.t('context.invalidSession'))
        return
      }
      void props.openSession(sessionId).then(() => {
        setNavigationError('')
        releaseDetailHistory()
        jiraWorkspaceStore.close()
      }, (error: unknown) => {
        setNavigationError(error instanceof Error ? error.message : props.t('context.navigationFailed'))
      })
    }
    const onPopState = () => {
      if (suppressHistoryPopRef.current) {
        suppressHistoryPopRef.current = false
        return
      }
      if (!detailHistoryTokenRef.current) return
      detailHistoryTokenRef.current = ''
      frameRef.current?.contentWindow?.postMessage({
        source: 'jira-workbench-dsh-host',
        type: 'navigate-back',
      }, window.location.origin)
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('popstate', onPopState)
      if (detailHistoryTokenRef.current) {
        detailHistoryTokenRef.current = ''
        window.history.back()
      }
      suppressHistoryPopRef.current = false
    }
  }, [props, snapshot.open, snapshot.route])

  useEffect(() => {
    if (!snapshot.open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || rootRef.current?.contains(target)) return
      if (target.closest('[data-jira-workbench-trigger]')) return
      jiraWorkspaceStore.close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => { window.removeEventListener('pointerdown', onPointerDown, true) }
  }, [snapshot.open])

  useEffect(() => {
    if (!snapshot.open) return undefined
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      jiraWorkspaceStore.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [snapshot.open])

  if (!snapshot.open) return null

  if (snapshot.route.kind === 'settings') {
    return (
      <section ref={rootRef} className={`${css.root} ${css.settingsRoot}`} style={{ left: sidebarInset }} aria-label={props.t('card.title')}>
        <header className={css.settingsHeader}>
          <div>
            <span className={css.eyebrow}>JIRA WORKBENCH</span>
            <h1>{props.t('card.title')}</h1>
          </div>
          <div className={css.settingsActions}>
            <button type="button" className={css.backButton} onClick={() => { jiraWorkspaceStore.open({ kind: 'board' }) }}>
              <span className={css.backIcon} aria-hidden="true">←</span>
              <span>返回任务工作台</span>
            </button>
            <button type="button" className={css.iconButton} aria-label={props.t('panel.close')} onClick={() => { jiraWorkspaceStore.close() }}>
              <IconCloseOutline16 size={16} />
            </button>
          </div>
        </header>
        <div className={css.settingsBody}>
          <JiraConfigCard {...props} standalone />
        </div>
      </section>
    )
  }

  return (
    <section ref={rootRef} className={css.root} style={{ left: sidebarInset }} aria-label={props.t('panel.title')}>
      {!frameReady && (
        <div className={css.frameLoading} role="status">
          <span className={css.spinner} />
          <strong>正在打开 Jira 工作台…</strong>
          <button type="button" className={css.loadingClose} onClick={() => { jiraWorkspaceStore.close() }}>关闭</button>
        </div>
      )}
      {navigationError && <div className={css.navigationError} role="alert">{navigationError}</div>}
      <iframe
        key={frameUrl}
        ref={frameRef}
        className={css.frame}
        src={frameUrl}
        title={props.t('panel.title')}
        onLoad={() => { setFrameReady(true) }}
      />
    </section>
  )
}
