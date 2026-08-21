/**
 * Staged Jira workbench settings over the DSH settings and credentials domains.
 * Connection secrets stay in DSH credentials; board sources, prompt templates,
 * and Skill references are persisted by the shared Core config store.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

export const JIRA_WORKBENCH_NS = 'jira-workbench'
export const JIRA_WORKBENCH_TOKEN_REF = 'JIRA_WORKBENCH_TOKEN'

export interface JiraWorkbenchSettings {
  baseUrl?: string
}

export type BoardSourceMode = 'builtin' | 'custom' | 'filter'
export type IssueKind = 'requirement' | 'bug'

export interface BoardSource {
  mode: BoardSourceMode
  jql: string
  filterIds: string[]
}

export interface BoardSources {
  projectKey: string
  collaboratorFieldId: string
  collaboratorJqlName: string
  requirement: BoardSource
  bug: BoardSource
}

export interface SkillReference {
  name: string
  path: string
  scope: string
}

export interface PromptTemplateEntry {
  customized: boolean
  content: string
  skill: SkillReference | null
}

export interface PromptTemplates {
  requirement: PromptTemplateEntry
  bug: PromptTemplateEntry
}

export interface JiraProjectOption {
  id: string
  key: string
  name: string
}

export interface JiraFilterOption {
  id: string
  name: string
  owner: string
  favourite: boolean
  projectKeys: string[]
  projectMatch?: 'all' | 'match' | 'unknown' | 'other'
}

export interface DshSkillOption {
  name: string
  description: string
  source: string
  path: string
  scopes: string[]
}

interface WorkbenchConfiguration {
  configured: boolean
  baseUrl: string
  hasToken: boolean
  boardSources: BoardSources
  promptTemplates: PromptTemplates
}

interface TokenState {
  configured: boolean
  writable: boolean
}

export interface JiraConfigCardState {
  available: boolean
  writable: boolean
  loading: boolean
  baseUrlText: string
  tokenWritable: boolean
  tokenText: string
  tokenConfigured: boolean
  boardSources: BoardSources
  promptTemplates: PromptTemplates
  projects: JiraProjectOption[]
  filters: JiraFilterOption[]
  skills: DshSkillOption[]
  optionsLoading: boolean
  optionsMessage: string
  dirty: boolean
  baseUrlInvalid: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  failureMessage: string
}

export type CommitJiraConfiguration = (input: {
  baseUrl: string
  boardSources: BoardSources
  promptTemplates: PromptTemplates
}) => Promise<WorkbenchConfiguration>

const EMPTY_BOARD_SOURCE: BoardSource = { mode: 'builtin', jql: '', filterIds: [] }
const EMPTY_BOARD_SOURCES: BoardSources = {
  projectKey: '',
  collaboratorFieldId: '',
  collaboratorJqlName: '',
  requirement: { ...EMPTY_BOARD_SOURCE },
  bug: { ...EMPTY_BOARD_SOURCE },
}
const EMPTY_TEMPLATE: PromptTemplateEntry = { customized: false, content: '', skill: null }
const EMPTY_TEMPLATES: PromptTemplates = {
  requirement: { ...EMPTY_TEMPLATE },
  bug: { ...EMPTY_TEMPLATE },
}

function cloneBoardSources(value: BoardSources): BoardSources {
  return {
    ...value,
    requirement: { ...value.requirement, filterIds: [...value.requirement.filterIds] },
    bug: { ...value.bug, filterIds: [...value.bug.filterIds] },
  }
}

function clonePromptTemplates(value: PromptTemplates): PromptTemplates {
  return {
    requirement: {
      ...value.requirement,
      skill: value.requirement.skill === null ? null : { ...value.requirement.skill },
    },
    bug: {
      ...value.bug,
      skill: value.bug.skill === null ? null : { ...value.bug.skill },
    },
  }
}

function configurationFromPayload(payload: unknown): WorkbenchConfiguration {
  const value = payload as Partial<WorkbenchConfiguration> | null
  const sources = value?.boardSources ?? EMPTY_BOARD_SOURCES
  const templates = value?.promptTemplates ?? EMPTY_TEMPLATES
  return {
    configured: value?.configured === true,
    baseUrl: String(value?.baseUrl || ''),
    hasToken: value?.hasToken === true,
    boardSources: cloneBoardSources({
      ...EMPTY_BOARD_SOURCES,
      ...sources,
      requirement: { ...EMPTY_BOARD_SOURCE, ...sources.requirement },
      bug: { ...EMPTY_BOARD_SOURCE, ...sources.bug },
    }),
    promptTemplates: clonePromptTemplates({
      requirement: { ...EMPTY_TEMPLATE, ...templates.requirement },
      bug: { ...EMPTY_TEMPLATE, ...templates.bug },
    }),
  }
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    configuration?: unknown
    error?: { message?: string }
  } | null
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error?.message || `Jira workbench request failed (${response.status}).`)
  }
  return payload as T
}

async function loadConfiguration(): Promise<WorkbenchConfiguration> {
  const payload = await jsonRequest<{ configuration: unknown }>('/jira-workbench/config')
  return configurationFromPayload(payload.configuration)
}

async function commitJiraConfiguration(input: {
  baseUrl: string
  boardSources: BoardSources
  promptTemplates: PromptTemplates
}): Promise<WorkbenchConfiguration> {
  const payload = await jsonRequest<{ configuration: unknown }>('/jira-workbench/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return configurationFromPayload(payload.configuration)
}

function isValidBaseUrl(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return true
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function currentBaseUrl(value: JiraWorkbenchSettings | undefined): string {
  return typeof value?.baseUrl === 'string' ? value.baseUrl : ''
}

function sourcesInvalid(value: BoardSources): boolean {
  return (['requirement', 'bug'] as const).some((kind) => {
    const source = value[kind]
    return source.mode === 'custom' && source.jql.trim() === ''
      || source.mode === 'filter' && source.filterIds.length === 0
  })
}

function templatesInvalid(value: PromptTemplates): boolean {
  return (['requirement', 'bug'] as const)
    .some(kind => value[kind].customized && value[kind].content.trim() === '')
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export interface JiraConfigCardActions {
  edit: (field: 'baseUrl' | 'token', text: string) => void
  editProjectKey: (projectKey: string) => void
  editBoardSource: (kind: IssueKind, patch: Partial<BoardSource>) => void
  toggleFilter: (kind: IssueKind, filterId: string) => void
  editTemplate: (kind: IssueKind, patch: Partial<PromptTemplateEntry>) => void
  refreshOptions: () => void
  save: () => void
  discard: () => void
}

export interface JiraConfigCardFace extends JiraConfigCardActions {
  hooks: {
    jiraConfigCard: SnapshotStore<JiraConfigCardState>
  }
}

export class JiraConfigCardController {
  private readonly store: SnapshotStore<JiraConfigCardState>
  private readonly scope: SettingsScope<JiraWorkbenchSettings>
  private readonly api: Pick<IApiClient, 'credentials'>
  private token: TokenState = { configured: false, writable: true }
  private configuration: WorkbenchConfiguration | null = null
  private boardSourcesDraft: BoardSources | null = null
  private promptTemplatesDraft: PromptTemplates | null = null
  private baseUrlDraft: string | null = null
  private tokenDraft = ''
  private projects: JiraProjectOption[] = []
  private filters: JiraFilterOption[] = []
  private skills: DshSkillOption[] = []
  private loading = true
  private optionsLoading = false
  private optionsMessage = ''
  private optionsRequestVersion = 0
  private filterRequestVersion = 0
  private saving = false
  private failed = false
  private failureMessage = ''
  private readonly commitConfiguration: CommitJiraConfiguration

  constructor(
    scope: SettingsScope<JiraWorkbenchSettings>,
    api: Pick<IApiClient, 'credentials'>,
    commitConfiguration: CommitJiraConfiguration = commitJiraConfiguration,
  ) {
    this.scope = scope
    this.api = api
    this.commitConfiguration = commitConfiguration
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => {
      this.publish()
      if (this.configuration !== null) void this.syncSettingsBaseUrl(this.configuration.baseUrl)
    })
    void Promise.allSettled([this.readToken(), this.readConfiguration()])
  }

  private effectiveBoardSources(): BoardSources {
    return cloneBoardSources(this.boardSourcesDraft ?? this.configuration?.boardSources ?? EMPTY_BOARD_SOURCES)
  }

  private effectivePromptTemplates(): PromptTemplates {
    return clonePromptTemplates(this.promptTemplatesDraft ?? this.configuration?.promptTemplates ?? EMPTY_TEMPLATES)
  }

  private projection(): JiraConfigCardState {
    const snapshot = this.scope.getSnapshot()
    // The workbench config endpoint is the authority. DSH settings is only a
    // compatibility mirror and can legitimately arrive later during startup.
    const persistedBaseUrl = this.configuration !== null
      ? this.configuration.baseUrl
      : currentBaseUrl(snapshot.value)
    const baseUrlText = this.baseUrlDraft ?? persistedBaseUrl
    const boardSources = this.effectiveBoardSources()
    const promptTemplates = this.effectivePromptTemplates()
    const preferencesDirty = this.configuration !== null && (
      !sameJson(boardSources, this.configuration.boardSources)
      || !sameJson(promptTemplates, this.configuration.promptTemplates)
    )
    const baseUrlInvalid = this.baseUrlDraft !== null && !isValidBaseUrl(this.baseUrlDraft)
    return {
      available: true,
      writable: this.configuration !== null,
      loading: this.loading,
      baseUrlText,
      tokenWritable: this.token.writable,
      tokenText: this.tokenDraft,
      tokenConfigured: this.token.configured || this.configuration?.hasToken === true,
      boardSources,
      promptTemplates,
      projects: this.projects,
      filters: this.filters,
      skills: this.skills,
      optionsLoading: this.optionsLoading,
      optionsMessage: this.optionsMessage,
      dirty: this.baseUrlDraft !== null || this.tokenDraft.trim() !== '' || preferencesDirty,
      baseUrlInvalid,
      invalid: baseUrlInvalid
        || sourcesInvalid(boardSources)
        || templatesInvalid(promptTemplates),
      saving: this.saving,
      failed: this.failed,
      failureMessage: this.failureMessage,
    }
  }

  private async readConfiguration(): Promise<void> {
    try {
      this.configuration = await loadConfiguration()
      this.loading = false
      this.failed = false
      this.failureMessage = ''
      this.publish()
      void this.syncSettingsBaseUrl(this.configuration.baseUrl)
      await this.loadOptions()
    } catch (error) {
      this.loading = false
      this.failed = true
      this.failureMessage = error instanceof Error ? error.message : String(error)
      this.publish()
    }
  }

  private async readToken(): Promise<void> {
    try {
      const response = await this.api.credentials.describe({ refs: [JIRA_WORKBENCH_TOKEN_REF] })
      if (!response.result.ok) return
      const view = response.result.value.credentials[JIRA_WORKBENCH_TOKEN_REF]
      this.token = {
        configured: view?.configured ?? false,
        writable: view?.writable ?? true,
      }
      this.publish()
    } catch {
      // The connection card remains usable; a later credential write still
      // returns its authoritative failure through save().
    }
  }

  private async fetchOptions<T>(resource: string, params: Record<string, string> = {}): Promise<T> {
    const query = new URLSearchParams({ resource, ...params })
    return jsonRequest<T>(`/jira-workbench/config-options?${query.toString()}`)
  }

  private async loadFilters(projectKey: string): Promise<void> {
    const requestVersion = ++this.filterRequestVersion
    const selectedProject = this.projects.find(project => project.key === projectKey)
    try {
      const payload = await this.fetchOptions<{ filters?: JiraFilterOption[] }>('filters', {
        projectKey,
        ...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
        ...(selectedProject?.name ? { projectName: selectedProject.name } : {}),
      })
      if (requestVersion !== this.filterRequestVersion) return
      this.filters = Array.isArray(payload.filters) ? payload.filters : []
    } catch (error) {
      if (requestVersion !== this.filterRequestVersion) return
      this.filters = []
      this.optionsMessage = error instanceof Error ? error.message : String(error)
    }
  }

  private async loadOptions(): Promise<void> {
    if (!this.configuration?.configured) return
    const requestVersion = ++this.optionsRequestVersion
    this.optionsLoading = true
    this.optionsMessage = ''
    this.publish()
    const [projectsResult, skillsResult] = await Promise.allSettled([
      this.fetchOptions<{ projects?: JiraProjectOption[] }>('projects'),
      this.fetchOptions<{ skills?: DshSkillOption[], message?: string }>('skills'),
    ])
    if (requestVersion !== this.optionsRequestVersion) return
    if (projectsResult.status === 'fulfilled') {
      this.projects = Array.isArray(projectsResult.value.projects) ? projectsResult.value.projects : []
    } else {
      this.optionsMessage = projectsResult.reason instanceof Error
        ? projectsResult.reason.message
        : String(projectsResult.reason)
    }
    if (skillsResult.status === 'fulfilled') {
      this.skills = Array.isArray(skillsResult.value.skills) ? skillsResult.value.skills : []
      if (skillsResult.value.message) this.optionsMessage = skillsResult.value.message
    } else if (!this.optionsMessage) {
      this.optionsMessage = skillsResult.reason instanceof Error
        ? skillsResult.reason.message
        : String(skillsResult.reason)
    }
    await this.loadFilters(this.effectiveBoardSources().projectKey)
    if (requestVersion !== this.optionsRequestVersion) return
    this.optionsLoading = false
    this.publish()
  }

  inject(): JiraConfigCardFace {
    return {
      hooks: { jiraConfigCard: this.store },
      edit: (field, text) => { this.edit(field, text) },
      editProjectKey: projectKey => { this.editProjectKey(projectKey) },
      editBoardSource: (kind, patch) => { this.editBoardSource(kind, patch) },
      toggleFilter: (kind, filterId) => { this.toggleFilter(kind, filterId) },
      editTemplate: (kind, patch) => { this.editTemplate(kind, patch) },
      refreshOptions: () => { void this.loadOptions() },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  edit(field: 'baseUrl' | 'token', text: string): void {
    if (field === 'baseUrl') this.baseUrlDraft = text
    else this.tokenDraft = text
    this.clearFailure()
    this.publish()
  }

  editProjectKey(projectKey: string): void {
    const next = this.effectiveBoardSources()
    next.projectKey = projectKey.trim().toUpperCase()
    this.boardSourcesDraft = next
    this.clearFailure()
    this.publish()
    void this.loadFilters(next.projectKey).then(() => { this.publish() })
  }

  editBoardSource(kind: IssueKind, patch: Partial<BoardSource>): void {
    const next = this.effectiveBoardSources()
    next[kind] = { ...next[kind], ...patch }
    if (patch.mode !== undefined) {
      if (patch.mode !== 'custom') next[kind].jql = ''
      if (patch.mode !== 'filter') next[kind].filterIds = []
    }
    this.boardSourcesDraft = next
    this.clearFailure()
    this.publish()
  }

  toggleFilter(kind: IssueKind, filterId: string): void {
    const next = this.effectiveBoardSources()
    const selected = new Set(next[kind].filterIds)
    if (selected.has(filterId)) selected.delete(filterId)
    else selected.add(filterId)
    next[kind].filterIds = [...selected]
    this.boardSourcesDraft = next
    this.clearFailure()
    this.publish()
  }

  editTemplate(kind: IssueKind, patch: Partial<PromptTemplateEntry>): void {
    const next = this.effectivePromptTemplates()
    const patchedSkill = Object.prototype.hasOwnProperty.call(patch, 'skill')
      ? patch.skill === null || patch.skill === undefined
        ? null
        : { name: patch.skill.name, path: patch.skill.path, scope: patch.skill.scope }
      : next[kind].skill
    next[kind] = {
      ...next[kind],
      ...patch,
      skill: patchedSkill,
    }
    this.promptTemplatesDraft = next
    this.clearFailure()
    this.publish()
  }

  discard(): void {
    this.baseUrlDraft = null
    this.tokenDraft = ''
    this.boardSourcesDraft = null
    this.promptTemplatesDraft = null
    this.clearFailure()
    this.publish()
  }

  async save(): Promise<void> {
    const state = this.projection()
    if (this.saving || state.invalid || !state.dirty) return
    this.saving = true
    this.clearFailure()
    this.publish()
    let landed = true
    let failureMessage = ''
    const baseUrl = state.baseUrlText.trim()
    const token = this.tokenDraft.trim()

    if (token !== '') {
      try {
        const response = await this.api.credentials.set({ ref: JIRA_WORKBENCH_TOKEN_REF, value: token })
        landed = response.result.ok
        if (!landed) failureMessage = 'DSH 未接受 Jira Token。'
      } catch (error) {
        landed = false
        failureMessage = error instanceof Error ? error.message : String(error)
      }
    }

    if (landed) {
      try {
        this.configuration = await this.commitConfiguration({
          baseUrl,
          boardSources: state.boardSources,
          promptTemplates: state.promptTemplates,
        })
      } catch (error) {
        landed = false
        failureMessage = error instanceof Error ? error.message : String(error)
      }
    }

    if (landed) {
      this.baseUrlDraft = null
      this.tokenDraft = ''
      this.boardSourcesDraft = null
      this.promptTemplatesDraft = null
      void this.syncSettingsBaseUrl(baseUrl)
      void this.loadOptions()
    }
    this.saving = false
    this.failed = !landed
    this.failureMessage = landed ? '' : failureMessage
    await this.readToken()
    this.publish()
  }

  /** Best-effort compatibility mirror; it never decides whether Jira saved. */
  private async syncSettingsBaseUrl(baseUrl: string): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    if (snapshot.status !== 'ready' || !snapshot.writable) return
    if (baseUrl === currentBaseUrl(snapshot.value)) return
    try {
      if (baseUrl === '') await this.scope.unset('baseUrl')
      else await this.scope.set('baseUrl', baseUrl)
    } catch {
      // The plugin-owned /jira-workbench/config write already landed. A late or
      // read-only DSH settings mirror must not turn that successful save into a
      // visible failure; the next scope refresh retries convergence.
    }
  }

  private clearFailure(): void {
    this.failed = false
    this.failureMessage = ''
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
