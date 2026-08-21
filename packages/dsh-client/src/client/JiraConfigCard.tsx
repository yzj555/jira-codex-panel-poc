/** Jira workbench settings card for DSH. */

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {
  BoardSource,
  DshSkillOption,
  IssueKind,
  JiraConfigCardFace,
  JiraFilterOption,
  PromptTemplateEntry,
} from './jira-config-card-controller.ts'
import css from './JiraConfigCard.module.css'

type JiraConfigCardBaseProps =
  PropsLocale<'jira-workbench'>
  & InjectFace<JiraConfigCardFace>

export type JiraConfigCardProps = JiraConfigCardBaseProps
  & Partial<PropsRuntime<'settings.plugin.item'>>
  & { readonly standalone?: boolean }

type Section = 'connection' | 'sources' | 'templates' | 'images'

interface Choice {
  value: string
  label: string
  meta?: string
}

export function JiraConfigCard(props: JiraConfigCardProps) {
  const { t } = props
  const state = props.useJiraConfigCard(snapshot => snapshot)
  const standalone = props.standalone === true
  const [open, setOpen] = useState(standalone)
  const [section, setSection] = useState<Section>('connection')
  const settingsContentRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<Section, HTMLElement | null>>({
    connection: null,
    templates: null,
    images: null,
    sources: null,
  })

  useEffect(() => {
    const content = settingsContentRef.current
    if (!standalone || state.loading || !content) return
    const order: readonly Section[] = ['connection', 'templates', 'images', 'sources']
    const syncSection = () => {
      const contentTop = content.getBoundingClientRect().top
      let next: Section = order[0]!
      for (const key of order) {
        const target = sectionRefs.current[key]
        if (target && target.getBoundingClientRect().top - contentTop <= 72) next = key
      }
      if (content.scrollHeight - content.scrollTop - content.clientHeight <= 8) next = order[order.length - 1]!
      setSection(current => current === next ? current : next)
    }
    content.addEventListener('scroll', syncSection, { passive: true })
    syncSection()
    return () => { content.removeEventListener('scroll', syncSection) }
  }, [standalone, state.loading])

  const scrollToSection = (next: Section) => {
    const content = settingsContentRef.current
    const target = sectionRefs.current[next]
    if (!content || !target) return
    const top = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    setSection(next)
    content.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' })
  }
  const title = t('card.title')
  const blocked = !state.dirty || state.invalid || state.saving || state.loading
  const projectChoices = state.projects.map(project => ({
    value: project.key,
    label: `${project.key} · ${project.name}`,
    meta: project.id,
  }))
  const discoveredVisionChoices = state.visionModels.map(model => ({
    value: `${model.provider}\u0000${model.id}`,
    label: model.name,
    meta: `${model.providerName} · ${model.id}`,
  }))
  const selectedVision = state.imageProcessing.visionProvider && state.imageProcessing.visionModel
    ? `${state.imageProcessing.visionProvider}\u0000${state.imageProcessing.visionModel}`
    : ''
  const visionChoices = selectedVision && !discoveredVisionChoices.some(choice => choice.value === selectedVision)
    ? [{
        value: selectedVision,
        label: state.imageProcessing.visionModel,
        meta: `${state.imageProcessing.visionProvider} · ${t('card.visionModelUnavailable')}`,
      }, ...discoveredVisionChoices]
    : discoveredVisionChoices

  return (
    <div className={clsx(
      css.card,
      open && css.cardOpen,
      standalone ? css.workspaceCard : css.pluginCard,
    )}>
      {!standalone
        ? (
          <button
            type="button"
            className={css.header}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'}: ${title}`}
            onClick={() => { setOpen(!open) }}
          >
            <span className={css.brandMark}>JW</span>
            <span className={css.headText}>
              <span className={css.name}>{title}</span>
              <span className={css.description}>{t('card.pluginDescription')}</span>
            </span>
            {state.dirty ? <span className={css.pending}>{t('card.unsaved')}</span> : null}
            <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
          </button>
        )
        : null}
      {open || standalone
        ? (
          <div className={css.body}>
            {standalone
              ? (
                <nav className={css.settingsNav} aria-label={t('card.settingsGroups')}>
                  <SettingsNavItem
                    active={section === 'connection'}
                    target="jira-settings-connection"
                    title={t('card.connection')}
                    copy={t('card.connectionNavHint')}
                    onClick={() => { scrollToSection('connection') }}
                  />
                  <SettingsNavItem
                    active={section === 'templates'}
                    target="jira-settings-templates"
                    title={t('card.templatesNav')}
                    copy={t('card.templatesNavHint')}
                    onClick={() => { scrollToSection('templates') }}
                  />
                  <SettingsNavItem
                    active={section === 'images'}
                    target="jira-settings-images"
                    title={t('card.imagesNav')}
                    copy={t('card.imagesNavHint')}
                    onClick={() => { scrollToSection('images') }}
                  />
                  <SettingsNavItem
                    active={section === 'sources'}
                    target="jira-settings-sources"
                    title={t('card.advancedNav')}
                    copy={t('card.advancedNavHint')}
                    onClick={() => { scrollToSection('sources') }}
                  />
                </nav>
              )
              : null}

            <div ref={settingsContentRef} className={css.settingsContent}>
              {state.loading
                ? <div className={css.loading}>{t('card.loading')}</div>
                : null}

              {!state.loading
                ? (
                  <section
                    id="jira-settings-connection"
                    ref={element => { sectionRefs.current.connection = element }}
                    className={css.section}
                  >
                  {standalone
                    ? <SectionHeading title={t('card.connection')} copy={t('card.connectionHint')} />
                    : (
                      <div className={css.pluginConnectionHead}>
                        <div>
                          <h3>{t('card.connection')}</h3>
                          <p>{t('card.connectionHint')}</p>
                        </div>
                        <span className={clsx(css.status, state.tokenConfigured && css.statusOk)}>
                          {t(state.tokenConfigured ? 'card.tokenConfigured' : 'card.tokenUnconfigured')}
                        </span>
                      </div>
                    )}
                  {!state.writable ? <p className={css.readOnly} role="status">{t('card.readOnly')}</p> : null}
                  <div className={css.connectionGrid}>
                    <Field
                      id="jira-config-base-url"
                      label={t('card.baseUrl')}
                      hint={t('card.baseUrlHint')}
                      text={state.baseUrlText}
                      invalid={state.baseUrlInvalid}
                      invalidLabel={t('card.invalidUrl')}
                      disabled={!state.writable}
                      onEdit={text => { props.edit('baseUrl', text) }}
                    />
                    <div className={css.field}>
                      <div className={css.labelRow}>
                        <label className={css.label} htmlFor="jira-config-token">{t('card.token')}</label>
                        {standalone
                          ? (
                            <span className={clsx(css.status, state.tokenConfigured && css.statusOk)}>
                              {t(state.tokenConfigured ? 'card.tokenConfigured' : 'card.tokenUnconfigured')}
                            </span>
                          )
                          : null}
                      </div>
                      <input
                        id="jira-config-token"
                        className={css.input}
                        type="password"
                        autoComplete="off"
                        value={state.tokenText}
                        disabled={!state.writable || !state.tokenWritable}
                        placeholder={state.tokenConfigured ? t('card.tokenKeep') : t('card.tokenRequired')}
                        onChange={event => { props.edit('token', event.target.value) }}
                      />
                      <p className={css.hint}>{t('card.tokenHint')}</p>
                    </div>
                  </div>
                  {!standalone ? <p className={css.pluginSettingsNote}>{t('card.pluginSettingsHint')}</p> : null}
                  </section>
                )
                : null}

              {!state.loading && standalone
                ? (
                  <section
                    id="jira-settings-templates"
                    ref={element => { sectionRefs.current.templates = element }}
                    className={css.section}
                  >
                  <SectionHeading title={t('card.templates')} copy={t('card.templatesHint')} />
                  <div className={css.templateGrid}>
                    <TemplateEditor
                      kind="requirement"
                      title={t('card.requirementTemplate')}
                      accent="requirement"
                      value={state.promptTemplates.requirement}
                      skills={state.skills}
                      onPatch={patch => { props.editTemplate('requirement', patch) }}
                    />
                    <TemplateEditor
                      kind="bug"
                      title={t('card.bugTemplate')}
                      accent="bug"
                      value={state.promptTemplates.bug}
                      skills={state.skills}
                      onPatch={patch => { props.editTemplate('bug', patch) }}
                    />
                  </div>
                  <p className={css.skillRule}>{t('card.skillRule')}</p>
                  </section>
                )
                : null}

              {!state.loading && standalone
                ? (
                  <section
                    id="jira-settings-images"
                    ref={element => { sectionRefs.current.images = element }}
                    className={css.section}
                  >
                  <SectionHeading title={t('card.images')} copy={t('card.imagesHint')} />
                  <div className={css.imageSettings}>
                    <div className={css.imageRouteField}>
                      <div>
                        <strong>{t('card.visionModel')}</strong>
                        <p>{t('card.visionModelHint')}</p>
                      </div>
                      <ChoicePicker
                        id="jira-vision-model"
                        value={selectedVision}
                        options={visionChoices}
                        placeholder={t('card.visionModelNone')}
                        searchPlaceholder={t('card.visionModelSearch')}
                        emptyText={t('card.visionModelEmpty')}
                        clearable
                        actionLabel={selectedVision ? t('card.visionModelChange') : t('card.visionModelChoose')}
                        onChange={value => {
                          const selected = state.visionModels.find(model => `${model.provider}\u0000${model.id}` === value)
                          props.editImageProcessing({
                            visionProvider: selected?.provider || '',
                            visionModel: selected?.id || '',
                          })
                        }}
                      />
                    </div>
                    <label className={css.ocrToggle}>
                      <input
                        type="checkbox"
                        checked={state.imageProcessing.localOcrEnabled}
                        onChange={event => { props.editImageProcessing({ localOcrEnabled: event.target.checked }) }}
                      />
                      <span>
                        <strong>{t('card.localOcr')}</strong>
                        <small>{t('card.localOcrHint')}</small>
                      </span>
                    </label>
                    <ol className={css.imageStrategy}>
                      <li>{t('card.imageStrategyNative')}</li>
                      <li>{t('card.imageStrategyVision')}</li>
                      <li>{t('card.imageStrategyOcr')}</li>
                      <li>{t('card.imageStrategyUnparsed')}</li>
                    </ol>
                  </div>
                  </section>
                )
                : null}

              {!state.loading && standalone
                ? (
                  <section
                    id="jira-settings-sources"
                    ref={element => { sectionRefs.current.sources = element }}
                    className={css.section}
                  >
                  <SectionHeading title={t('card.sources')} copy={t('card.sourcesHint')} />
                  <div className={css.sourceToolbar}>
                    <div className={css.pickerField}>
                      <span className={css.label}>{t('card.projectKey')}</span>
                      <ChoicePicker
                        id="jira-project-picker"
                        value={state.boardSources.projectKey}
                        options={projectChoices}
                        placeholder={t('card.projectPlaceholder')}
                        searchPlaceholder={t('card.searchProject')}
                        emptyText={t('card.noProjects')}
                        allowCustom
                        onChange={props.editProjectKey}
                      />
                    </div>
                    <button
                      type="button"
                      className={css.refresh}
                      disabled={state.optionsLoading}
                      onClick={props.refreshOptions}
                    >
                      <span className={clsx(css.refreshIcon, state.optionsLoading && css.refreshIconBusy)} aria-hidden="true">↻</span>
                      <span>{t(state.optionsLoading ? 'card.refreshing' : 'card.refreshOptions')}</span>
                    </button>
                  </div>
                  {state.optionsMessage ? <p className={css.optionMessage}>{state.optionsMessage}</p> : null}
                  <div className={css.sourceGrid}>
                    <SourceEditor
                      kind="requirement"
                      title={t('card.requirementSource')}
                      accent="requirement"
                      source={state.boardSources.requirement}
                      filters={state.filters}
                      onPatch={patch => { props.editBoardSource('requirement', patch) }}
                      onToggleFilter={filterId => { props.toggleFilter('requirement', filterId) }}
                    />
                    <SourceEditor
                      kind="bug"
                      title={t('card.bugSource')}
                      accent="bug"
                      source={state.boardSources.bug}
                      filters={state.filters}
                      onPatch={patch => { props.editBoardSource('bug', patch) }}
                      onToggleFilter={filterId => { props.toggleFilter('bug', filterId) }}
                    />
                  </div>
                  </section>
                )
                : null}
            </div>

            <div className={css.footer}>
              {state.failed
                ? <p className={css.failed} role="status">{state.failureMessage || t('card.saveFailed')}</p>
                : <p className={css.saveHint}>{t(standalone ? 'card.saveHint' : 'card.connectionSaveHint')}</p>}
              <button
                type="button"
                className={css.discard}
                disabled={!state.dirty || state.saving}
                onClick={props.discard}
              >
                {t('card.discard')}
              </button>
              <button
                type="button"
                className={css.save}
                disabled={blocked}
                onClick={props.save}
              >
                {t(state.saving ? 'card.saving' : 'card.save')}
              </button>
            </div>
          </div>
        )
        : null}
    </div>
  )
}

function SettingsNavItem(props: { active: boolean, target: string, title: string, copy: string, onClick: () => void }) {
  return (
    <button
      type="button"
      className={clsx(css.settingsNavItem, props.active && css.settingsNavItemActive)}
      aria-current={props.active ? 'location' : undefined}
      aria-controls={props.target}
      onClick={props.onClick}
    >
      <strong>{props.title}</strong>
      <small>{props.copy}</small>
    </button>
  )
}

function SectionHeading(props: { title: string, copy: string }) {
  return (
    <header className={css.sectionHeading}>
      <h3>{props.title}</h3>
      <p>{props.copy}</p>
    </header>
  )
}

function Field(props: {
  id: string
  label: string
  hint: string
  text: string
  invalid: boolean
  invalidLabel: string
  disabled: boolean
  onEdit: (text: string) => void
}) {
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className={props.invalid ? css.inputInvalid : css.input}
        type="text"
        aria-invalid={props.invalid || undefined}
        value={props.text}
        disabled={props.disabled}
        onChange={event => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? css.invalid : css.hint}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

function SourceEditor(props: {
  kind: IssueKind
  title: string
  accent: 'requirement' | 'bug'
  source: BoardSource
  filters: JiraFilterOption[]
  onPatch: (patch: Partial<BoardSource>) => void
  onToggleFilter: (filterId: string) => void
}) {
  const [search, setSearch] = useState('')
  const visibleFilters = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('zh-CN')
    if (!needle) return props.filters
    return props.filters.filter(filter => [filter.id, filter.name, filter.owner]
      .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(needle)))
  }, [props.filters, search])
  return (
    <article className={clsx(css.sourcePanel, css[props.accent])}>
      <div className={css.panelTitle}>
        <span className={css.kindDot} />
        <strong>{props.title}</strong>
      </div>
      <SegmentedMode value={props.source.mode} onChange={mode => { props.onPatch({ mode }) }} />
      {props.source.mode === 'builtin'
        ? <p className={css.modeHint}>按项目、当前用户和 Issue 类型生成通用 JQL。</p>
        : null}
      {props.source.mode === 'custom'
        ? (
          <label className={css.field}>
            <span className={css.label}>JQL</span>
            <textarea
              className={css.textarea}
              rows={5}
              spellCheck={false}
              value={props.source.jql}
              placeholder="project = PROJECT AND assignee = currentUser()"
              onChange={event => { props.onPatch({ jql: event.target.value }) }}
            />
          </label>
        )
        : null}
      {props.source.mode === 'custom' && props.source.jql.trim() === ''
        ? <p className={css.invalid}>请填写该面板的 JQL。</p>
        : null}
      {props.source.mode === 'filter'
        ? (
          <div className={css.filterPicker}>
            <input
              className={css.searchInput}
              type="search"
              placeholder="搜索 Filter"
              value={search}
              onChange={event => { setSearch(event.target.value) }}
            />
            <div className={css.filterList}>
              {visibleFilters.length
                ? visibleFilters.map(filter => (
                  <label key={filter.id} className={clsx(css.filterRow, props.source.filterIds.includes(filter.id) && css.filterSelected)}>
                    <input
                      type="checkbox"
                      checked={props.source.filterIds.includes(filter.id)}
                      onChange={() => { props.onToggleFilter(filter.id) }}
                    />
                    <span>
                      <strong>{filter.name}</strong>
                      <small>
                        #{filter.id}
                        {filter.owner ? ` · ${filter.owner}` : ''}
                        {filter.favourite ? ' · 收藏' : ''}
                        {filter.projectMatch === 'match'
                          ? ' · 当前项目'
                          : filter.projectMatch === 'other'
                            ? ' · 其他项目'
                            : filter.projectMatch === 'unknown'
                              ? ' · 范围待确认'
                              : ''}
                      </small>
                    </span>
                  </label>
                ))
                : <div className={css.emptyList}>没有可用 Filter</div>}
            </div>
          </div>
        )
        : null}
      {props.source.mode === 'filter' && props.source.filterIds.length === 0
        ? <p className={css.invalid}>请至少选择一个 Jira Filter。</p>
        : null}
    </article>
  )
}

function SegmentedMode(props: { value: BoardSource['mode'], onChange: (mode: BoardSource['mode']) => void }) {
  const modes: Array<[BoardSource['mode'], string]> = [
    ['builtin', '通用 JQL'],
    ['custom', '自定义'],
    ['filter', 'Jira Filter'],
  ]
  return (
    <div className={css.segmented} role="radiogroup" aria-label="任务来源方式">
      {modes.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={clsx(css.segment, props.value === value && css.segmentActive)}
          aria-pressed={props.value === value}
          onClick={() => { props.onChange(value) }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function TemplateEditor(props: {
  kind: IssueKind
  title: string
  accent: 'requirement' | 'bug'
  value: PromptTemplateEntry
  skills: DshSkillOption[]
  onPatch: (patch: Partial<PromptTemplateEntry>) => void
}) {
  const skillChoices = props.skills.map(skill => ({
    value: skill.name,
    label: skill.name,
    meta: skill.scopes.length ? skill.scopes.join('、') : skill.source,
  }))
  const selectedSkill = props.value.skill?.name || ''
  return (
    <article className={clsx(css.templatePanel, css[props.accent])}>
      <div className={css.panelTitle}>
        <span className={css.kindDot} />
        <strong>{props.title}</strong>
        <span className={css.templateState}>{props.value.customized ? '自定义' : '系统默认'}</span>
      </div>
      <div className={css.templateMode}>
        <button
          type="button"
          className={clsx(!props.value.customized && css.templateModeActive)}
          onClick={() => { props.onPatch({ customized: false }) }}
        >
          系统默认
        </button>
        <button
          type="button"
          className={clsx(props.value.customized && css.templateModeActive)}
          onClick={() => { props.onPatch({ customized: true }) }}
        >
          自定义模板
        </button>
      </div>
      {props.value.customized
        ? (
          <textarea
            className={css.templateTextarea}
            rows={8}
            maxLength={12_000}
            spellCheck={false}
            value={props.value.content}
            onChange={event => { props.onPatch({ content: event.target.value }) }}
          />
        )
        : <p className={css.templatePreview}>{props.value.content}</p>}
      {props.value.customized && props.value.content.trim() === ''
        ? <p className={css.invalid}>自定义模板不能为空。</p>
        : null}
      <div className={css.pickerField}>
        <span className={css.label}>绑定 DSH Skill</span>
        <ChoicePicker
          id={`jira-${props.kind}-skill`}
          value={selectedSkill}
          options={skillChoices}
          placeholder="不绑定 Skill"
          searchPlaceholder="搜索 DSH Skill"
          emptyText="当前没有可绑定的 Skill"
          clearable
          actionLabel={selectedSkill ? '更改 Skill' : '选择 Skill'}
          onChange={name => {
            const skill = props.skills.find(candidate => candidate.name === name)
            props.onPatch({
              skill: skill
                ? { name: skill.name, path: skill.path || '', scope: 'dsh' }
                : null,
            })
          }}
        />
      </div>
    </article>
  )
}

function ChoicePicker(props: {
  id: string
  value: string
  options: Choice[]
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  allowCustom?: boolean
  clearable?: boolean
  actionLabel?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = props.options.find(option => option.value === props.value)
  const triggerLabel = selected?.label || props.value || props.placeholder
  const needle = search.trim().toLocaleLowerCase('zh-CN')
  const visible = props.options.filter(option => !needle
    || `${option.label} ${option.meta || ''}`.toLocaleLowerCase('zh-CN').includes(needle))
  const customValue = search.trim().toUpperCase()
  const canUseCustom = props.allowCustom === true
    && /^[A-Z][A-Z0-9_]{0,49}$/.test(customValue)
    && !props.options.some(option => option.value === customValue)
  const choose = (value: string) => {
    props.onChange(value)
    setSearch('')
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const close = () => {
      setSearch('')
      setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) close()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div ref={pickerRef} className={css.choicePicker} id={props.id}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx(css.choiceTrigger, props.actionLabel && css.choiceTriggerActionable, open && css.choiceTriggerOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${props.id}-listbox`}
        aria-label={props.actionLabel ? `${props.actionLabel}：${triggerLabel}` : undefined}
        onClick={() => {
          if (open) setSearch('')
          setOpen(!open)
        }}
      >
        <span>
          <strong>{triggerLabel}</strong>
          {selected?.meta ? <small>{selected.meta}</small> : null}
        </span>
        <span className={css.choiceAffordance} aria-hidden="true">
          {props.actionLabel ? <span className={css.choiceAction}>{props.actionLabel}</span> : null}
          <span className={css.choiceChevron} />
        </span>
      </button>
      {open
        ? (
          <div className={css.choicePanel}>
            <input
              autoFocus
              className={css.searchInput}
              type="search"
              placeholder={props.searchPlaceholder}
              value={search}
              onChange={event => { setSearch(event.target.value) }}
              onKeyDown={event => {
                if (event.key === 'Enter' && canUseCustom) choose(customValue)
              }}
            />
            <div id={`${props.id}-listbox`} className={css.choiceList} role="listbox">
              {props.clearable && !needle
                ? (
                  <button type="button" className={clsx(css.choiceRow, props.value === '' && css.choiceSelected)} onClick={() => { choose('') }}>
                    <span><strong>{props.placeholder}</strong><small>使用模板降级策略</small></span><span>✓</span>
                  </button>
                )
                : null}
              {visible.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={clsx(css.choiceRow, props.value === option.value && css.choiceSelected)}
                  role="option"
                  aria-selected={props.value === option.value}
                  onClick={() => { choose(option.value) }}
                >
                  <span><strong>{option.label}</strong>{option.meta ? <small>{option.meta}</small> : null}</span><span>✓</span>
                </button>
              ))}
              {canUseCustom
                ? (
                  <button type="button" className={css.choiceRow} onClick={() => { choose(customValue) }}>
                    <span><strong>使用项目 Key “{customValue}”</strong><small>未出现在 Jira 项目列表中</small></span><span>＋</span>
                  </button>
                )
                : null}
              {!visible.length && !canUseCustom ? <div className={css.emptyList}>{props.emptyText}</div> : null}
            </div>
          </div>
        )
        : null}
    </div>
  )
}
