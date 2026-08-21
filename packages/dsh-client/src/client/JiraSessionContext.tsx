/** Jira context action and floating summary for a linked DSH session. */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconEllipsisOutline16,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { JiraSessionContextResult } from './jira-session-context-api.ts'
import { jiraWorkspaceStore } from './jira-workspace-store.ts'
import css from './JiraSessionContext.module.css'

function useDismissOnOutsidePointer(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', dismiss, true)
    return () => { window.removeEventListener('pointerdown', dismiss, true) }
  }, [open, root, setOpen])
}

/** Business callbacks supplied by the DSH client plugin apply closure. */
export interface JiraSessionContextInjected {
  readonly loadContext: (sessionId: string) => Promise<JiraSessionContextResult>
  readonly clearContext: (input: {
    sessionId: string
    issueKey: string
    expectedRevision: number
  }) => Promise<number>
}

/** Props composed for the right-side conversation-header utility. */
export type JiraSessionContextProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'jira-workbench'>
  & JiraSessionContextInjected

/** Render the linked Jira summary as a right-aligned, non-blocking side popover. */
export function JiraSessionContext({
  sessionId,
  loadContext,
  clearContext,
  t,
}: JiraSessionContextProps) {
  const [result, setResult] = useState<JiraSessionContextResult | null>(null)
  const [loadError, setLoadError] = useState('')
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const generationRef = useRef(0)

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  useEffect(() => jiraWorkspaceStore.subscribe(() => {
    if (jiraWorkspaceStore.getSnapshot().open) {
      setOpen(false)
      setConfirmUnlink(false)
    }
  }), [])

  const refresh = useCallback(async (foreground = true) => {
    const generation = ++generationRef.current
    if (foreground) setPending(true)
    try {
      const next = await loadContext(sessionId)
      if (generation !== generationRef.current) return
      setResult(next)
      setLoadError('')
    } catch (error) {
      if (generation !== generationRef.current) return
      setLoadError(error instanceof Error ? error.message : t('context.loadFailed'))
    } finally {
      if (generation === generationRef.current && foreground) setPending(false)
    }
  }, [loadContext, sessionId, t])

  useEffect(() => {
    setResult(null)
    setLoadError('')
    setOpen(false)
    setMoreOpen(false)
    setConfirmUnlink(false)
    void refresh()
    const interval = window.setInterval(() => { void refresh(false) }, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      generationRef.current += 1
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (open) return
    setMoreOpen(false)
    setConfirmUnlink(false)
  }, [open])

  const context = result?.context ?? null

  const unlink = async () => {
    if (!context || !result) return
    setPending(true)
    try {
      const revision = await clearContext({
        sessionId,
        issueKey: context.issueKey,
        expectedRevision: result.revision,
      })
      setResult({ revision, context: null })
      setOpen(false)
      setConfirmUnlink(false)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('context.unlinkFailed'))
      setConfirmUnlink(false)
      await refresh(false)
    } finally {
      setPending(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    if (moreOpen) {
      event.preventDefault()
      setMoreOpen(false)
      return
    }
    if (confirmUnlink) {
      event.preventDefault()
      setConfirmUnlink(false)
      return
    }
    if (open) {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  if (context === null && !loadError) return null

  const issue = context?.issue
  const projectLabel = context?.projectScopes.length
    ? context.projectScopes.map(scope => scope.projectLabel).join('、')
    : t('context.noWorkspace')
  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={loadError && !context ? `${css.trigger} ${css.triggerError}` : css.trigger}
        aria-expanded={open}
        aria-label={context ? t('context.aria', { issueKey: context.issueKey }) : t('context.retry')}
        onClick={() => {
          if (!context) {
            void refresh()
            return
          }
          setOpen(current => !current)
          setConfirmUnlink(false)
        }}
      >
        {context && issue
          ? (
            <span className={issue.type === 'bug' ? css.triggerTypeBug : css.triggerTypeRequirement}>
              {issue.type === 'bug' ? 'B' : 'R'}
            </span>
          )
          : <StateDot state={loadError ? 'warning' : 'ongoing'} />}
        <span className={css.triggerLabel}>{context ? context.issueKey : t('context.errorShort')}</span>
        {context && issue && <span className={css.triggerStatus}>{issue.statusName}</span>}
        {context && issue && <IconChevronDownOutline14 className={open ? css.triggerChevronOpen : css.triggerChevron} />}
      </button>

      {open && context && issue
        ? (
          <section className={css.popover} aria-label={t('context.title')}>
            <header className={css.header}>
              <div className={css.identity}>
                <span className={issue.type === 'bug' ? css.typeBug : css.typeRequirement}>
                  {issue.type === 'bug' ? 'B' : 'R'}
                </span>
                <strong>{context.issueKey}</strong>
                <span className={css.status}>{issue.statusName}</span>
              </div>
              <div className={css.headerActions}>
                <button type="button" className={css.quietButton} disabled={pending} onClick={() => { void refresh() }}>
                  {pending ? t('context.refreshing') : t('context.refresh')}
                </button>
                <div className={css.moreWrap}>
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('context.more')}
                    aria-expanded={moreOpen}
                    onClick={() => { setMoreOpen(current => !current); setConfirmUnlink(false) }}
                  >
                    <IconEllipsisOutline16 size={16} />
                  </button>
                  {moreOpen && (
                    <div className={css.moreMenu} role="menu">
                      <button
                        type="button"
                        className={css.moreDanger}
                        role="menuitem"
                        disabled={pending}
                        onClick={() => { setMoreOpen(false); setConfirmUnlink(true) }}
                      >
                        {t('context.unlink')}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('context.collapse')}
                  onClick={() => { setOpen(false); triggerRef.current?.focus() }}
                >
                  <IconCloseOutline16 size={14} />
                </button>
              </div>
            </header>

            <div className={css.body}>
              <h3 className={css.issueTitle}>{issue.title}</h3>
              <div className={css.meta}>
                {issue.projectName && <span>{issue.projectName}</span>}
                {issue.assignee && <span>{t('context.assignee', { assignee: issue.assignee })}</span>}
                {issue.priority && <span>{issue.priority}</span>}
              </div>
              {issue.summary && <p className={css.summary}>{issue.summary}</p>}
              {issue.parentIssue && (
                <div className={css.parentContext}>
                  <span>{t('context.parent')}</span>
                  <strong>{issue.parentIssue.key}</strong>
                  <span>{issue.parentIssue.title}</span>
                </div>
              )}
              <div className={css.workspace} title={context.projectScopes.map(scope => scope.cwd).join('\n')}>
                <span>{t('context.workspace')}</span>
                <strong>{projectLabel}</strong>
              </div>
              {context.issueError && <p className={css.warning}>{context.issueError.message}</p>}
              {context.workspaceError && <p className={css.warning}>{context.workspaceError.message}</p>}
              {context.conflictingIssueKeys.length > 0 && (
                <p className={css.warning}>
                  {t('context.conflict', { issueKeys: context.conflictingIssueKeys.join('、') })}
                </p>
              )}
              {loadError && <p className={css.warning}>{loadError}</p>}
            </div>

            {confirmUnlink && (
              <div className={css.confirmation} role="alert">
                <span>{t('context.unlinkConfirm', { issueKey: context.issueKey })}</span>
                <div>
                  <button type="button" className={css.quietButton} onClick={() => { setConfirmUnlink(false) }}>
                    {t('context.cancel')}
                  </button>
                  <button type="button" className={css.confirmButton} disabled={pending} onClick={() => { void unlink() }}>
                    {pending ? t('context.unlinking') : t('context.confirm')}
                  </button>
                </div>
              </div>
            )}

            <footer className={css.footer}>
              <button
                type="button"
                className={css.secondaryButton}
                onClick={() => {
                  jiraWorkspaceStore.open({ kind: 'detail', issueKey: context.issueKey, sessionId })
                  setOpen(false)
                }}
              >
                {t('context.openBoard')}
              </button>
              <button
                type="button"
                className={css.primaryButton}
                onClick={() => {
                  jiraWorkspaceStore.open({ kind: 'svn', issueKey: context.issueKey })
                  setOpen(false)
                }}
              >
                {t('context.openSvn')}
              </button>
              {issue.url && (
                <a className={css.link} href={issue.url} target="_blank" rel="noreferrer" onClick={() => { setOpen(false) }}>
                  {t('context.openJira')}
                </a>
              )}
            </footer>
          </section>
        )
        : null}

    </div>
  )
}
