/**
 * Jira workbench UI plugin, browser half. Four surface contributions over the
 * state owned by the external `@jira-workbench/dsh` host plugin:
 *
 * - a `settings.plugin.item` card (the Jira URL + token) bound to the
 *   `jira-workbench` settings namespace the host registers, with the token
 *   written through the credentials domain (fixed `JIRA_WORKBENCH_TOKEN`
 *   reference), and
 * - a `shell.overlay` root workspace occupying DSH's main content area,
 * - a `sidebar.footer.action` entry toggling that workspace, and
 * - a `conversation.session.header.utilities` entry showing the Jira context
 *   linked to the current native DSH session.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings shell's SlotMap merge and ctx.settingsScope.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the conversation header action SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the sidebar shell's SlotMap merge (sidebar.footer.action).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls ui-settings-plugins' SlotMap merge (settings.plugin.item).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { JiraConfigCard } from './JiraConfigCard.tsx'
import { JiraPanel } from './JiraPanel.tsx'
import { JiraSessionContext } from './JiraSessionContext.tsx'
import { JiraWorkspaceSurface } from './JiraWorkspaceSurface.tsx'
import { JIRA_WORKBENCH_NS, JiraConfigCardController } from './jira-config-card-controller.ts'
import { clearJiraSessionContext, loadJiraSessionContext } from './jira-session-context-api.ts'
import { en, NS, zh } from './locales.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'sessions']

/**
 * Mount the config card, persistent workspace, board action, and session context.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-jira-workbench: dictionaries')

  const card = new JiraConfigCardController(
    ctx.settingsScope.bind({ namespace: JIRA_WORKBENCH_NS }),
    api,
  )
  // ui-layout is a host-owned DSH plugin. This package only contributes to its
  // additive root slot, so keep the runtime dependency in dsh.client.inject
  // without coupling this independently built client bundle to its type package.
  const rootSlots = ctx.slots as unknown as {
    inject: (name: 'shell.overlay', install: () => () => void) => () => void
    register: (
      options: { name: 'shell.overlay', id: string, order: number, locale: typeof NS, inject: () => object },
      component: typeof JiraWorkspaceSurface,
    ) => () => void
  }

  const openSessionWhenVisible = (sessionId: string): Promise<void> => {
    const id = sessionId as Parameters<typeof ctx.sessions.open>[0]
    const visible = () => ctx.sessions.list.getSnapshot().byId[id] !== undefined
    if (visible()) {
      ctx.sessions.open(id)
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {}
      const timer = window.setTimeout(() => {
        unsubscribe()
        reject(new Error('DSH 会话已经创建，但会话列表尚未同步，请稍后从侧边栏打开。'))
      }, 5_000)
      unsubscribe = ctx.sessions.list.subscribe(() => {
        if (!visible()) return
        window.clearTimeout(timer)
        unsubscribe()
        ctx.sessions.open(id)
        resolve()
      })
    })
  }

  // DSH 0.0.1-rc.3 declared this slot as a list (`id`), while rc.7+
  // dispatches it as keyed (`key`). The registry ignores the unused identity,
  // so carrying both keeps one bundle compatible with installed DSH profiles.
  const settingsPluginIdentity = { id: JIRA_WORKBENCH_NS }
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: JIRA_WORKBENCH_NS,
    ...settingsPluginIdentity,
    locale: NS,
    inject: () => card.inject(),
  }, JiraConfigCard))

  rootSlots.inject('shell.overlay', () => rootSlots.register({
    name: 'shell.overlay',
    id: 'jira-workbench-surface',
    order: 0,
    locale: NS,
    inject: () => ({
      ...card.inject(),
      openSession: openSessionWhenVisible,
    }),
  }, JiraWorkspaceSurface))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'jira-workbench',
    locale: NS,
  }, JiraPanel))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'jira-workbench-session-context',
    order: -10,
    locale: NS,
    inject: () => ({
      loadContext: loadJiraSessionContext,
      clearContext: clearJiraSessionContext,
    }),
  }, JiraSessionContext))
}
