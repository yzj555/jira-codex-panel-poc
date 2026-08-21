/** Sidebar entry that toggles the Jira workspace in DSH's main content area. */

import { useSyncExternalStore } from 'react'
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { jiraWorkspaceStore } from './jira-workspace-store.ts'
import css from './JiraPanel.module.css'

/** Props the renderer binds for the sidebar footer action. */
export type JiraPanelProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'jira-workbench'>

/** Render the sidebar footer action; the root workspace surface owns all content. */
export function JiraPanel(props: JiraPanelProps) {
  const { t, wide } = props
  const snapshot = useSyncExternalStore(
    jiraWorkspaceStore.subscribe,
    jiraWorkspaceStore.getSnapshot,
    jiraWorkspaceStore.getSnapshot,
  )
  const active = snapshot.open && snapshot.route.kind === 'board'

  return (
    <div className={css.root}>
      <button
        type="button"
        data-jira-workbench-trigger
        className={active ? `${css.trigger} ${css.triggerActive}` : css.trigger}
        aria-label={t('panel.aria')}
        aria-pressed={active}
        onClick={() => { jiraWorkspaceStore.toggleBoard() }}
      >
        <IconChecklistOutline14 />
        {wide && <span className={css.label}>{t('panel.trigger')}</span>}
      </button>
    </div>
  )
}
