import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  CreateCreativeCapabilityInputSchema, CreativeCapabilityConfigurationSchema, CreativeCapabilitySchema,
  CreativeSkillVersionSchema, CreativeSkillCatalogItemSchema,
  CreativeAssistantSkillConfigurationSchema,
  CreativeOrchestrationRunSchema, CreativeOrchestrationStepSchema, CreativeSeatConfigurationSchema, CreativeSeatSchema,
  MemoryProposalSchema, NovelGenerationJobSchema, NovelGenerationRequestSchema, NovelProjectSchema, NovelRevisionProposalSchema,
  NovelVersionSummarySchema, type MemoryProposal, type MemoryProposalBatchDecision, type MemoryProposalBatchResolveResult, type NovelProject, type NovelProjectSummary,
  type NovelContextEntry, type NovelGenerationEstimate, type NovelGenerationJob, type NovelGenerationJobError,
  UpdateCreativeCapabilityInputSchema,   UpdateCreativeOrchestrationRunSchema, UpdateCreativeOrchestrationStepSchema,
  type AssistantCandidateRecord, type AssistantDraft, type AssistantTaskConfiguration, type AssistantTaskType,
  type AssistantGuideDomain, type AssistantGuideSession, type ChapterAnalysisTask, type GuideSession, type UpdateChapterAnalysis,
  type CreativeCapability, type CreativeCapabilityConfiguration, type CreativeOrchestrationRun, type CreativeOrchestrationStep, type CreativeSkillVersion, type CreativeSkillCatalogItem,
  type CreativeAssistantSkillConfiguration, type CreativeAssistantSkillStage,
  type AssistantSkillLoadReceipt,
  type CreativeSeat, type CreativeSeatConfiguration, type CreateCreativeCapabilityInput, type UpdateCreativeCapabilityInput,
  type UpdateCreativeOrchestrationRun, type UpdateCreativeOrchestrationStep,
  type EntityMention, type NovelMemoryHealth, type NovelGenerationJobStatus, type NovelGenerationKind, type NovelRevisionProposal, type NovelVersionSummary, type NovelGenerationRequest,
  type NovelContextLayerLedger
} from '../../contracts/src'
import { StyleLearningJobSchema, StyleProfileSchema, StyleProfileUsageSchema, StyleSampleSchema, type StyleLearningJob, type StyleProfile, type StyleProfileDraft, type StyleProfileUsage, type StyleSample } from '../../contracts/src'
import { CreativeChatMessageSchema, CreativeConversationSchema, type CreativeChatMessage, type CreativeConversation, type CreativeChatStage } from '../../contracts/src'
import {
  AssistantGuideSessionSchema, AssistantTaskConfigurationSchema, AssistantDraftSchema, AssistantCandidateRecordSchema, ChapterAnalysisTaskSchema, GuideSessionSchema
} from '../../contracts/src'
import { AiUsageRecordSchema, ProviderOutputTestRecordSchema, type AiUsageRecord, type ProviderConfigPublic, type ProviderOutputTestRecord } from '../../contracts/src/provider'
import { applyMemoryProposalBatch, chapterText, invalidateMemoryProposals, reconcileNovelAfterEdit, wordCount } from './novelMemory'
import { buildNovelContext } from './novelContext'
import { chapterPlanStaleness, establishPlanningDigestBaseline } from './novelPlanning'
import { VersionNotFoundError, VersionRestorePreviewStaleError, buildVersionRestorePreview, versionRestoreDigest } from './novelVersionRestore'
import { BUILT_IN_CREATIVE_CAPABILITIES, BUILT_IN_CREATIVE_SEATS, getBuiltInCreativeSeat } from './creativeSeatCatalog'
import { projectAssistantId } from './projectAssistantCatalog'
import { assessStorylineHealth } from './novelStoryline'
import { DEFAULT_STAGE_SEATS, buildCreativeSkillPrompt, creativeSkillDigest, isCreativeCapabilityAllowedForStage } from './creativeSkillRuntime'

const SECRET_STORE_MARKER = 'secret-store:v2'

export class NovelRevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT'
  constructor(readonly expected: number, readonly actual: number) { super(`项目版本已变化：请求基于版本 ${expected}，当前为版本 ${actual}。`) }
}

export class AssistantGuideVersionConflictError extends Error {
  readonly code = 'ASSISTANT_GUIDE_VERSION_CONFLICT'
  constructor(readonly expected: number, readonly actual: number) {
    super(`引导会话版本已变化：请求基于版本 ${expected}，当前为版本 ${actual}。`)
  }
}

/**
 * 多步写入事务中的检查点。
 * 生产代码只负责在关键步骤后调用 `checkpoint(...)`；只有测试会注册注入器，
 * 用于在「已经写入、尚未提交」的位置制造失败，验证整个事务是否真的回滚。
 */
export type DatabaseWriteCheckpoint =
  | '开始写入'
  | '已写入项目'
  | '已写入恢复前快照'
  | '已重建索引'
  | '已写入候选状态'
  | '已标记生成任务'
  | '已写入技能能力'
  | '已写入技能快照'

export class NovelDatabaseService {
  private readonly sqlite: Database.Database
  /**
   * 事务故障注入器（仅测试使用）。
   * 生产环境永远为空；抛出即让整个事务回滚，用于验证「中途失败不留半完成数据」。
   */
  private failureInjector: ((stage: DatabaseWriteCheckpoint) => void) | undefined

  /** 仅测试调用：注册（传 undefined 可清除）事务中途失败注入器。 */
  setFailureInjectorForTest(injector?: (stage: DatabaseWriteCheckpoint) => void): void {
    this.failureInjector = injector
  }

  /** 事务内部的关键步骤标记；注入器抛错即触发回滚。 */
  private checkpoint(stage: DatabaseWriteCheckpoint): void {
    this.failureInjector?.(stage)
  }

  constructor(filePath = ':memory:') {
    if (filePath !== ':memory:') {
      mkdirSync(dirname(filePath), { recursive: true })
      if (existsSync(filePath)) {
        const inspection = new Database(filePath, { readonly: true })
        const version = inspection.pragma('user_version', { simple: true }) as number
        inspection.close()
        if (version < 2) copyFileSync(filePath, `${filePath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`)
      }
    }
    this.sqlite = new Database(filePath)
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS novel_projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS novel_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE, revision INTEGER NOT NULL, reason TEXT NOT NULL, source TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS novel_versions_project_idx ON novel_versions(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS novel_revision_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE, chapter_id TEXT NOT NULL, status TEXT NOT NULL, source_digest TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_proposals_project_idx ON memory_proposals(project_id, status, created_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS novel_search USING fts5(project_id UNINDEXED, source_id UNINDEXED, source_type UNINDEXED, title, body, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS entity_mentions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        entry_id TEXT NOT NULL,
        entry_name TEXT NOT NULL,
        matched_text TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_number INTEGER NOT NULL,
        block_id TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        start_offset INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entity_mentions_project_entry_idx ON entity_mentions(project_id, entry_id, chapter_number);
      CREATE TABLE IF NOT EXISTS novel_indexed_chapters (
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        PRIMARY KEY(project_id, chapter_id)
      );
      CREATE TABLE IF NOT EXISTS novel_generation_checkpoints (
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        step INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, kind, target_id)
      );
      CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, context_window INTEGER NOT NULL, max_output_tokens INTEGER, output_token_parameter TEXT NOT NULL DEFAULT 'auto', supports_streaming INTEGER NOT NULL, supports_json_schema INTEGER NOT NULL, encrypted_api_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_output_tests (
        id TEXT PRIMARY KEY,
        provider_id TEXT,
        provider_name TEXT NOT NULL,
        model TEXT NOT NULL,
        base_url TEXT NOT NULL,
        context_window INTEGER NOT NULL,
        output_token_parameter TEXT NOT NULL,
        supports_streaming INTEGER NOT NULL,
        supports_json_schema INTEGER NOT NULL,
        test_mode TEXT NOT NULL,
        target_output_tokens INTEGER NOT NULL,
        output_tokens INTEGER,
        finish_reason TEXT,
        ok INTEGER NOT NULL,
        message TEXT NOT NULL,
        latency_ms INTEGER,
        config_digest TEXT NOT NULL,
        tested_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS provider_output_tests_provider_idx ON provider_output_tests(provider_id, tested_at DESC);
      CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY, project_id TEXT, episode_number INTEGER, provider_id TEXT NOT NULL, model TEXT NOT NULL, operation TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, estimated_cost REAL, currency TEXT NOT NULL, status TEXT NOT NULL, retry_count INTEGER NOT NULL, cost_known INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS novel_generation_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL,
        message TEXT NOT NULL,
        estimated_input_tokens INTEGER NOT NULL,
        estimated_output_tokens INTEGER NOT NULL,
        context_window INTEGER NOT NULL,
        warnings_json TEXT NOT NULL,
        context_entries_json TEXT NOT NULL,
        proposal_id TEXT,
        memory_proposal_ids_json TEXT NOT NULL,
        error_json TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS novel_generation_jobs_project_idx ON novel_generation_jobs(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS novel_generation_job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES novel_generation_jobs(id) ON DELETE CASCADE,
        progress INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS novel_generation_job_events_job_idx ON novel_generation_job_events(job_id, id);
      CREATE TABLE IF NOT EXISTS novel_creative_seat_configs (
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        seat_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        provider_id TEXT,
        capability_ids_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, seat_id)
      );
      CREATE TABLE IF NOT EXISTS novel_creative_capability_configs (
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        capability_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, capability_id)
      );
      CREATE TABLE IF NOT EXISTS novel_custom_creative_capabilities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS novel_custom_creative_capabilities_project_idx ON novel_custom_creative_capabilities(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS novel_orchestration_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        request_json TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        max_parallel INTEGER NOT NULL,
        require_human_gate INTEGER NOT NULL,
        auto_apply INTEGER NOT NULL CHECK(auto_apply = 0),
        warnings_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS novel_orchestration_runs_project_idx ON novel_orchestration_runs(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS novel_orchestration_steps (
        id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES novel_orchestration_runs(id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL,
        seat_id TEXT NOT NULL,
        title TEXT NOT NULL,
        generation_kind TEXT NOT NULL,
        target_id TEXT,
        dependencies_json TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        job_id TEXT,
        proposal_id TEXT,
        memory_proposal_ids_json TEXT NOT NULL,
        error_json TEXT,
        attempt INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, id)
      );
      CREATE INDEX IF NOT EXISTS novel_orchestration_steps_run_idx ON novel_orchestration_steps(run_id, step_order);
      CREATE TABLE IF NOT EXISTS novel_creative_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        target_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS novel_creative_conversations_project_idx ON novel_creative_conversations(project_id, stage, updated_at DESC);
      CREATE TABLE IF NOT EXISTS novel_creative_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES novel_creative_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        mode TEXT NOT NULL,
        references_json TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        project_revision INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS novel_creative_messages_conversation_idx ON novel_creative_messages(conversation_id, created_at ASC);
      CREATE TABLE IF NOT EXISTS style_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS style_profiles_updated_idx ON style_profiles(updated_at DESC);
      CREATE TABLE IF NOT EXISTS style_profile_usage (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        action TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS style_profile_usage_project_idx ON style_profile_usage(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS style_learning_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        source_character_count INTEGER NOT NULL,
        requested_name TEXT NOT NULL,
        provider_id TEXT,
        candidate_json TEXT,
        profile_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS style_learning_jobs_created_idx ON style_learning_jobs(created_at DESC);
    `)
    // 任务请求是恢复入口的最小持久化依据。旧数据库没有该列时无损补充，
    // 旧任务仍可查看，但不会被错误地标记为可恢复。
    const columns = this.sqlite.prepare('PRAGMA table_info(novel_generation_jobs)').all() as Array<{ name: string }>
    const names = new Set(columns.map((column) => column.name))
    if (!names.has('request_json')) this.sqlite.exec('ALTER TABLE novel_generation_jobs ADD COLUMN request_json TEXT')
    if (!names.has('resume_of_job_id')) this.sqlite.exec('ALTER TABLE novel_generation_jobs ADD COLUMN resume_of_job_id TEXT')
    if (!names.has('resume_count')) this.sqlite.exec('ALTER TABLE novel_generation_jobs ADD COLUMN resume_count INTEGER NOT NULL DEFAULT 0')
    const providerColumns = this.sqlite.prepare('PRAGMA table_info(providers)').all() as Array<{ name: string }>
    const providerNames = new Set(providerColumns.map((column) => column.name))
    if (!providerNames.has('max_output_tokens')) this.sqlite.exec('ALTER TABLE providers ADD COLUMN max_output_tokens INTEGER')
    if (!providerNames.has('output_token_parameter')) this.sqlite.exec("ALTER TABLE providers ADD COLUMN output_token_parameter TEXT NOT NULL DEFAULT 'auto'")
    this.sqlite.prepare("UPDATE providers SET output_token_parameter='auto' WHERE output_token_parameter IS NULL OR output_token_parameter='' ").run()
    const interruptedAt = new Date().toISOString()
    this.sqlite.prepare("UPDATE novel_generation_jobs SET status='失败', message='软件关闭后任务已中断。', error_json=?, ended_at=?, updated_at=? WHERE status IN ('等待','运行中')")
      .run(JSON.stringify({ code: 'JOB_INTERRUPTED', message: '软件关闭后任务已中断，请重新生成。', retryable: true }), interruptedAt, interruptedAt)
    this.sqlite.prepare("UPDATE style_learning_jobs SET status='失败', error='软件关闭后文笔学习已中断，请重新选择原文件开始分析。', updated_at=? WHERE status IN ('等待','分析中')")
      .run(interruptedAt)
    // 进程意外结束时，已经落库的运行仍保留全部证据和关联任务。
    // 仅把无法继续占用执行权的状态转为可见的暂停/失败，等待作者恢复。
    const orchestrationInterruptedAt = new Date().toISOString()
    this.sqlite.prepare("UPDATE novel_orchestration_steps SET status='失败', error_json=?, ended_at=?, updated_at=? WHERE status='运行中'")
      .run(JSON.stringify({ code: 'STEP_INTERRUPTED', message: '软件关闭后该工序已中断，可以从此处重新执行。', retryable: true }), orchestrationInterruptedAt, orchestrationInterruptedAt)
    this.sqlite.prepare("UPDATE novel_orchestration_runs SET status='暂停', ended_at=NULL, updated_at=? WHERE status='运行中'").run(orchestrationInterruptedAt)
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS novel_assistant_skill_configs (
      project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      provider_id TEXT,
      capability_ids_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, stage)
    );`)
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS novel_creative_skill_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, capability_id, revision)
    );
    CREATE INDEX IF NOT EXISTS novel_creative_skill_versions_idx ON novel_creative_skill_versions(project_id, capability_id, revision DESC);`)
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS novel_creative_skill_loads (
      project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
      capability_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      loaded_version TEXT,
      loaded_at TEXT NOT NULL,
      PRIMARY KEY(project_id, capability_id, stage)
    );
    CREATE INDEX IF NOT EXISTS novel_creative_skill_loads_project_idx ON novel_creative_skill_loads(project_id, stage, loaded_at DESC);`)
    this.sqlite.prepare("UPDATE novel_assistant_skill_configs SET enabled=1 WHERE enabled IS NULL").run()
    this.migrateAssistantTaskConfigs()
    this.migrateAssistantDrafts()
    this.migrateAssistantGuideSessions()
    this.recoverInterruptedAssistantGuideSessions()
    this.sqlite.pragma('user_version = 14')
    const existing = this.sqlite.prepare('SELECT data_json FROM novel_projects').all() as Array<{ data_json: string }>
    for (const row of existing) {
      try { this.reindex(NovelProjectSchema.parse(JSON.parse(row.data_json))) } catch { /* 保留数据库原文，项目读取时继续报告具体契约错误。 */ }
    }
  }

  /**
   * v12：任务级模型/技能覆盖（D5「任务专用选择 > 项目默认」）。
   * 只新增表，不动既有数据；旧库升级后没有任何覆盖行，行为与之前完全一致。
   */
  private migrateAssistantTaskConfigs(): void {
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS novel_assistant_task_configs (
      project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
      task_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      provider_id TEXT,
      capability_ids_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, task_type)
    );`)
  }

  /**
   * v12 第二部分：工作草稿与可回看候选记录（D3）。
   * 草稿按「项目 + 作用域 + 任务」唯一，一个目标同时只有一份工作草稿；
   * 候选记录只追加，供回看，不形成第二份正式数据源。
   */
  private migrateAssistantDrafts(): void {
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS novel_assistant_drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
      scope_key TEXT NOT NULL,
      task_type TEXT NOT NULL,
      stage TEXT NOT NULL,
      target_json TEXT NOT NULL,
      base_revision INTEGER NOT NULL,
      source_digest TEXT NOT NULL,
      version INTEGER NOT NULL,
      author_edited INTEGER NOT NULL DEFAULT 0,
      changes_json TEXT NOT NULL,
      groups_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, scope_key, task_type)
    );
    CREATE TABLE IF NOT EXISTS novel_assistant_candidate_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
      scope_key TEXT NOT NULL,
      task_type TEXT NOT NULL,
      version INTEGER NOT NULL,
      base_revision INTEGER NOT NULL,
      source_digest TEXT NOT NULL,
      summary TEXT NOT NULL,
      changes_json TEXT NOT NULL,
      groups_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS novel_assistant_records_project_idx ON novel_assistant_candidate_records(project_id, scope_key, created_at DESC);
    CREATE TABLE IF NOT EXISTS style_samples (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      digest TEXT NOT NULL,
      text TEXT NOT NULL,
      segments_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS novel_chapter_analyses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      context_version INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS novel_chapter_analyses_project_idx ON novel_chapter_analyses(project_id, chapter_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS novel_guide_sessions (
      project_id TEXT PRIMARY KEY REFERENCES novel_projects(id) ON DELETE CASCADE,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`)
  }

  /** v13：按项目、领域和精确作用域保存通用助手引导，并保留重启历史。 */
  private migrateAssistantGuideSessions(): void {
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS novel_assistant_guide_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES novel_projects(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      context_digest TEXT NOT NULL,
      active INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS novel_assistant_guide_current_idx
      ON novel_assistant_guide_sessions(project_id, domain, scope_key, active, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS novel_assistant_guide_one_active_idx
      ON novel_assistant_guide_sessions(project_id, domain, scope_key) WHERE active=1;`)
  }

  /** 进程退出时不能续跑的模型阶段，启动后转为作者可见且可重试的失败。 */
  private recoverInterruptedAssistantGuideSessions(): void {
    const rows = this.sqlite.prepare("SELECT * FROM novel_assistant_guide_sessions WHERE active=1 AND status IN ('分析中','生成中')").all() as AssistantGuideSessionRow[]
    if (!rows.length) return
    const interruptedAt = new Date().toISOString()
    this.sqlite.transaction(() => {
      for (const row of rows) {
        const current = this.toAssistantGuideSession(row)
        const recovered = AssistantGuideSessionSchema.parse({
          ...current,
          version: current.version + 1,
          status: '失败',
          error: '软件关闭后引导任务已中断，请重试。',
          updatedAt: interruptedAt
        })
        this.updateAssistantGuideSessionRow(recovered, current.version)
      }
    })()
  }

  saveAssistantDraft(draft: AssistantDraft): AssistantDraft {
    this.getProject(draft.projectId)
    const parsed = AssistantDraftSchema.parse(draft)
    const now = new Date().toISOString()
    this.sqlite.prepare(`INSERT INTO novel_assistant_drafts
      (id,project_id,scope_key,task_type,stage,target_json,base_revision,source_digest,version,author_edited,changes_json,groups_json,summary,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,scope_key,task_type) DO UPDATE SET
        version=excluded.version, author_edited=excluded.author_edited, changes_json=excluded.changes_json,
        groups_json=excluded.groups_json, summary=excluded.summary, status=excluded.status,
        base_revision=excluded.base_revision, source_digest=excluded.source_digest, updated_at=excluded.updated_at`)
      .run(parsed.id, parsed.projectId, parsed.scopeKey, parsed.taskType, parsed.stage, JSON.stringify(parsed.target),
        parsed.baseRevision, parsed.sourceDigest, parsed.version, parsed.authorEdited ? 1 : 0,
        JSON.stringify(parsed.changes), JSON.stringify(parsed.dependencyGroups), parsed.summary, parsed.status,
        parsed.createdAt, now)
    return this.getAssistantDraftById(parsed.projectId, parsed.id) ?? parsed
  }

  private toAssistantDraft(row: any): AssistantDraft {
    return AssistantDraftSchema.parse({
      id: row.id, projectId: row.project_id, scopeKey: row.scope_key, taskType: row.task_type, stage: row.stage,
      target: JSON.parse(row.target_json), baseRevision: row.base_revision, sourceDigest: row.source_digest,
      version: row.version, authorEdited: Boolean(row.author_edited), changes: JSON.parse(row.changes_json),
      dependencyGroups: JSON.parse(row.groups_json), status: row.status, summary: row.summary,
      createdAt: row.created_at, updatedAt: row.updated_at
    })
  }

  getAssistantDraft(projectId: string, scopeKey: string, taskType: AssistantTaskType): AssistantDraft | undefined {
    this.getProject(projectId)
    const row = this.sqlite.prepare('SELECT * FROM novel_assistant_drafts WHERE project_id=? AND scope_key=? AND task_type=?').get(projectId, scopeKey, taskType) as any
    return row ? this.toAssistantDraft(row) : undefined
  }

  getAssistantDraftById(projectId: string, draftId: string): AssistantDraft | undefined {
    this.getProject(projectId)
    const row = this.sqlite.prepare('SELECT * FROM novel_assistant_drafts WHERE project_id=? AND id=?').get(projectId, draftId) as any
    return row ? this.toAssistantDraft(row) : undefined
  }

  listAssistantDrafts(projectId: string, scopeKey?: string): AssistantDraft[] {
    this.getProject(projectId)
    const rows = (scopeKey
      ? this.sqlite.prepare('SELECT * FROM novel_assistant_drafts WHERE project_id=? AND scope_key=? ORDER BY updated_at DESC').all(projectId, scopeKey)
      : this.sqlite.prepare('SELECT * FROM novel_assistant_drafts WHERE project_id=? ORDER BY updated_at DESC').all(projectId)) as any[]
    return rows.map((row) => this.toAssistantDraft(row))
  }

  removeAssistantDraft(projectId: string, draftId: string): void {
    this.sqlite.prepare('DELETE FROM novel_assistant_drafts WHERE project_id=? AND id=?').run(projectId, draftId)
  }

  appendAssistantCandidateRecord(input: Omit<AssistantCandidateRecord, 'id' | 'createdAt' | 'updatedAt'>): AssistantCandidateRecord {
    const now = new Date().toISOString()
    const record = AssistantCandidateRecordSchema.parse({ ...input, id: randomUUID(), createdAt: now, updatedAt: now })
    this.sqlite.prepare(`INSERT INTO novel_assistant_candidate_records
      (id,project_id,scope_key,task_type,version,base_revision,source_digest,summary,changes_json,groups_json,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(record.id, record.projectId, record.scopeKey, record.taskType, record.version, record.baseRevision,
        record.sourceDigest, record.summary, JSON.stringify(record.changes), JSON.stringify(record.dependencyGroups),
        record.status, now, now)
    return record
  }

  listAssistantCandidateRecords(projectId: string, scopeKey?: string): AssistantCandidateRecord[] {
    this.getProject(projectId)
    const rows = (scopeKey
      ? this.sqlite.prepare('SELECT * FROM novel_assistant_candidate_records WHERE project_id=? AND scope_key=? ORDER BY created_at DESC').all(projectId, scopeKey)
      : this.sqlite.prepare('SELECT * FROM novel_assistant_candidate_records WHERE project_id=? ORDER BY created_at DESC').all(projectId)) as any[]
    return rows.map((row) => AssistantCandidateRecordSchema.parse({
      id: row.id, projectId: row.project_id, scopeKey: row.scope_key, taskType: row.task_type, version: row.version,
      baseRevision: row.base_revision, sourceDigest: row.source_digest, summary: row.summary,
      changes: JSON.parse(row.changes_json), dependencyGroups: JSON.parse(row.groups_json),
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
    }))
  }

  /* ------------------------------ 通用助手引导会话 ------------------------------ */

  getAssistantGuideSession(projectId: string, sessionId: string): AssistantGuideSession | undefined {
    this.getProject(projectId)
    const row = this.sqlite.prepare('SELECT * FROM novel_assistant_guide_sessions WHERE project_id=? AND id=?')
      .get(projectId, sessionId) as AssistantGuideSessionRow | undefined
    return row ? this.toAssistantGuideSession(row) : undefined
  }

  getCurrentAssistantGuideSession(projectId: string, domain: AssistantGuideDomain, scopeKey: string): AssistantGuideSession | undefined {
    this.getProject(projectId)
    const row = this.sqlite.prepare(`SELECT * FROM novel_assistant_guide_sessions
      WHERE project_id=? AND domain=? AND scope_key=? AND active=1
      ORDER BY updated_at DESC LIMIT 1`).get(projectId, domain, scopeKey) as AssistantGuideSessionRow | undefined
    return row ? this.toAssistantGuideSession(row) : undefined
  }

  listAssistantGuideSessions(projectId: string, domain?: AssistantGuideDomain, scopeKey?: string): AssistantGuideSession[] {
    this.getProject(projectId)
    let sql = 'SELECT * FROM novel_assistant_guide_sessions WHERE project_id=?'
    const params: string[] = [projectId]
    if (domain) {
      sql += ' AND domain=?'
      params.push(domain)
      if (scopeKey !== undefined) {
        sql += ' AND scope_key=?'
        params.push(scopeKey)
      }
    }
    const rows = this.sqlite.prepare(`${sql} ORDER BY updated_at DESC, rowid DESC`).all(...params) as AssistantGuideSessionRow[]
    return rows.map((row) => this.toAssistantGuideSession(row))
  }

  saveAssistantGuideSession(session: AssistantGuideSession, expectedVersion?: number): AssistantGuideSession {
    const parsed = AssistantGuideSessionSchema.parse(session)
    this.getProject(parsed.projectId)
    const existing = this.sqlite.prepare('SELECT version FROM novel_assistant_guide_sessions WHERE project_id=? AND id=?')
      .get(parsed.projectId, parsed.id) as { version: number } | undefined
    if (!existing) {
      if (expectedVersion !== undefined) throw Object.assign(new Error('找不到该引导会话。'), { code: 'ASSISTANT_GUIDE_NOT_FOUND' })
      this.insertAssistantGuideSessionRow(parsed)
      return parsed
    }
    if (expectedVersion === undefined) {
      throw Object.assign(new Error('更新引导会话必须提供预期版本。'), { code: 'ASSISTANT_GUIDE_VERSION_REQUIRED' })
    }
    if (existing.version !== expectedVersion) {
      throw new AssistantGuideVersionConflictError(expectedVersion, existing.version)
    }
    if (parsed.version !== expectedVersion + 1) {
      throw Object.assign(new Error('引导会话的新版本必须恰好递增 1。'), { code: 'ASSISTANT_GUIDE_VERSION_INVALID' })
    }
    this.updateAssistantGuideSessionRow(parsed, expectedVersion)
    return parsed
  }

  /**
   * 将领域结果写入与引导会话最终 CAS 放在同一个同步 SQLite 事务中。
   * 模型调用必须在进入本方法前完成；回调内不允许异步等待。
   */
  completeAssistantGuideSession(
    projectId: string,
    sessionId: string,
    expectedVersion: number,
    complete: (input: { session: AssistantGuideSession; project: NovelProject }) => AssistantGuideSession
  ): AssistantGuideSession {
    return this.sqlite.transaction(() => {
      const row = this.sqlite.prepare('SELECT * FROM novel_assistant_guide_sessions WHERE project_id=? AND id=?')
        .get(projectId, sessionId) as AssistantGuideSessionRow | undefined
      if (!row) throw Object.assign(new Error('找不到该引导会话。'), { code: 'ASSISTANT_GUIDE_NOT_FOUND' })
      const current = this.toAssistantGuideSession(row)
      if (current.version !== expectedVersion || !row.active) {
        throw new AssistantGuideVersionConflictError(expectedVersion, current.version)
      }
      const project = this.getProject(projectId)
      const next = AssistantGuideSessionSchema.parse(complete({ session: current, project }))
      if (
        next.id !== current.id || next.projectId !== current.projectId || next.domain !== current.domain ||
        next.scopeKey !== current.scopeKey || JSON.stringify(next.target) !== JSON.stringify(current.target)
      ) {
        throw Object.assign(new Error('完成引导时不能改变会话归属或精确目标。'), { code: 'ASSISTANT_GUIDE_SCOPE_MISMATCH' })
      }
      if (next.version !== expectedVersion + 1) {
        throw Object.assign(new Error('引导会话的新版本必须恰好递增 1。'), { code: 'ASSISTANT_GUIDE_VERSION_INVALID' })
      }
      this.updateAssistantGuideSessionRow(next, expectedVersion)
      return next
    })()
  }

  restartAssistantGuideSession(
    projectId: string,
    sessionId: string,
    expectedVersion: number,
    replacement: AssistantGuideSession
  ): AssistantGuideSession {
    const parsedReplacement = AssistantGuideSessionSchema.parse(replacement)
    this.getProject(projectId)
    if (parsedReplacement.projectId !== projectId) {
      throw Object.assign(new Error('新旧引导会话必须属于同一个项目。'), { code: 'ASSISTANT_GUIDE_PROJECT_MISMATCH' })
    }
    return this.sqlite.transaction(() => {
      const row = this.sqlite.prepare('SELECT * FROM novel_assistant_guide_sessions WHERE project_id=? AND id=?')
        .get(projectId, sessionId) as AssistantGuideSessionRow | undefined
      if (!row) throw Object.assign(new Error('找不到该引导会话。'), { code: 'ASSISTANT_GUIDE_NOT_FOUND' })
      const current = this.toAssistantGuideSession(row)
      if (current.version !== expectedVersion) throw new AssistantGuideVersionConflictError(expectedVersion, current.version)
      if (!row.active) throw new AssistantGuideVersionConflictError(expectedVersion, current.version)
      if (parsedReplacement.domain !== current.domain || parsedReplacement.scopeKey !== current.scopeKey) {
        throw Object.assign(new Error('重启后的引导会话必须保持原领域和作用域。'), { code: 'ASSISTANT_GUIDE_SCOPE_MISMATCH' })
      }
      const ended = AssistantGuideSessionSchema.parse({
        ...current,
        version: current.version + 1,
        status: '已结束',
        error: null,
        updatedAt: parsedReplacement.createdAt
      })
      this.updateAssistantGuideSessionRow(ended, expectedVersion)
      this.insertAssistantGuideSessionRow(parsedReplacement)
      return parsedReplacement
    })()
  }

  private insertAssistantGuideSessionRow(session: AssistantGuideSession): void {
    this.sqlite.prepare(`INSERT INTO novel_assistant_guide_sessions
      (id,project_id,domain,scope_key,version,status,context_digest,active,data_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      session.id, session.projectId, session.domain, session.scopeKey, session.version, session.status,
      session.contextDigest, Number(session.status !== '已结束'), JSON.stringify(session), session.createdAt, session.updatedAt
    )
  }

  private updateAssistantGuideSessionRow(session: AssistantGuideSession, expectedVersion: number): void {
    const result = this.sqlite.prepare(`UPDATE novel_assistant_guide_sessions SET
      domain=?, scope_key=?, version=?, status=?, context_digest=?, active=?, data_json=?, created_at=?, updated_at=?
      WHERE project_id=? AND id=? AND version=?`).run(
      session.domain, session.scopeKey, session.version, session.status, session.contextDigest,
      Number(session.status !== '已结束'), JSON.stringify(session), session.createdAt, session.updatedAt,
      session.projectId, session.id, expectedVersion
    )
    if (result.changes) return
    const actual = this.sqlite.prepare('SELECT version FROM novel_assistant_guide_sessions WHERE project_id=? AND id=?')
      .pluck().get(session.projectId, session.id) as number | undefined
    if (actual === undefined) throw Object.assign(new Error('找不到该引导会话。'), { code: 'ASSISTANT_GUIDE_NOT_FOUND' })
    throw new AssistantGuideVersionConflictError(expectedVersion, actual)
  }

  private toAssistantGuideSession(row: AssistantGuideSessionRow): AssistantGuideSession {
    return AssistantGuideSessionSchema.parse(JSON.parse(row.data_json))
  }

  /* ------------------------------ 大纲引导会话（D1/D2） ------------------------------ */

  getGuideSession(projectId: string): GuideSession | undefined {
    this.getProject(projectId)
    const row = this.sqlite.prepare('SELECT data_json FROM novel_guide_sessions WHERE project_id=?').get(projectId) as { data_json: string } | undefined
    return row ? GuideSessionSchema.parse(JSON.parse(row.data_json)) : undefined
  }

  listGuideSessions(projectId: string): GuideSession[] {
    const session = this.getGuideSession(projectId)
    return session ? [session] : []
  }

  saveGuideSession(session: GuideSession): GuideSession {
    this.getProject(session.projectId)
    const parsed = GuideSessionSchema.parse({ ...session, updatedAt: new Date().toISOString() })
    this.sqlite.prepare(`INSERT INTO novel_guide_sessions (project_id,data_json,created_at,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at`)
      .run(parsed.projectId, JSON.stringify(parsed), parsed.createdAt, parsed.updatedAt)
    return parsed
  }

  /* ------------------------------ 样文（D4） ------------------------------ */

  saveStyleSample(sample: StyleSample): StyleSample {
    const parsed = StyleSampleSchema.parse(sample)
    this.sqlite.prepare(`INSERT INTO style_samples (id,name,kind,digest,text,segments_json,created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, digest=excluded.digest,
        text=excluded.text, segments_json=excluded.segments_json`).run(
      parsed.id, parsed.name, parsed.kind, parsed.digest, parsed.text, JSON.stringify(parsed.segments), parsed.createdAt)
    return parsed
  }

  listStyleSamples(): StyleSample[] {
    const rows = this.sqlite.prepare('SELECT * FROM style_samples ORDER BY created_at DESC').all() as any[]
    return rows.map((row) => this.toStyleSample(row))
  }

  getStyleSample(id: string): StyleSample | undefined {
    const row = this.sqlite.prepare('SELECT * FROM style_samples WHERE id=?').get(id) as any
    return row ? this.toStyleSample(row) : undefined
  }

  private toStyleSample(row: any): StyleSample {
    return StyleSampleSchema.parse({
      id: row.id, name: row.name, kind: row.kind, text: row.text, digest: row.digest,
      segments: JSON.parse(row.segments_json), createdAt: row.created_at
    })
  }

  removeStyleSample(id: string): void {
    this.sqlite.prepare('DELETE FROM style_samples WHERE id=?').run(id)
  }

  /* ------------------------------ 章后分析任务（D6/D7） ------------------------------ */

  createChapterAnalysis(task: ChapterAnalysisTask): ChapterAnalysisTask {
    this.getProject(task.projectId)
    const parsed = ChapterAnalysisTaskSchema.parse(task)
    this.sqlite.prepare(`INSERT INTO novel_chapter_analyses
      (id,project_id,chapter_id,source_digest,context_version,trigger,status,result_json,error,created_at,started_at,ended_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      parsed.id, parsed.projectId, parsed.chapterId, parsed.sourceDigest, parsed.contextVersion, parsed.trigger,
      parsed.status, parsed.result ? JSON.stringify(parsed.result) : null, parsed.error ?? null,
      parsed.createdAt, parsed.startedAt ?? null, parsed.endedAt ?? null)
    return parsed
  }

  updateChapterAnalysis(id: string, input: UpdateChapterAnalysis): ChapterAnalysisTask {
    const row = this.sqlite.prepare('SELECT * FROM novel_chapter_analyses WHERE id=?').get(id) as any
    if (!row) throw Object.assign(new Error('找不到该分析任务。'), { code: 'ANALYSIS_NOT_FOUND' })
    const current = this.toChapterAnalysis(row)
    const next = ChapterAnalysisTaskSchema.parse({ ...current, ...input, updatedAt: undefined })
    this.sqlite.prepare(`UPDATE novel_chapter_analyses SET status=?,result_json=?,error=?,started_at=?,ended_at=? WHERE id=?`)
      .run(next.status, next.result ? JSON.stringify(next.result) : null, next.error ?? null,
        next.startedAt ?? null, next.endedAt ?? null, id)
    return next
  }

  private toChapterAnalysis(row: any): ChapterAnalysisTask {
    return ChapterAnalysisTaskSchema.parse({
      id: row.id, projectId: row.project_id, chapterId: row.chapter_id, sourceDigest: row.source_digest,
      contextVersion: row.context_version, trigger: row.trigger, status: row.status,
      result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error ?? null,
      createdAt: row.created_at, startedAt: row.started_at ?? null, endedAt: row.ended_at ?? null
    })
  }

  listChapterAnalyses(projectId: string, chapterId?: string): ChapterAnalysisTask[] {
    this.getProject(projectId)
    const rows = (chapterId
      ? this.sqlite.prepare('SELECT * FROM novel_chapter_analyses WHERE project_id=? AND chapter_id=? ORDER BY created_at DESC').all(projectId, chapterId)
      : this.sqlite.prepare('SELECT * FROM novel_chapter_analyses WHERE project_id=? ORDER BY created_at DESC').all(projectId)) as any[]
    return rows.map((row) => this.toChapterAnalysis(row))
  }

  getChapterAnalysis(id: string): ChapterAnalysisTask | undefined {
    const row = this.sqlite.prepare('SELECT * FROM novel_chapter_analyses WHERE id=?').get(id) as any
    return row ? this.toChapterAnalysis(row) : undefined
  }

  listAssistantTaskConfigurations(projectId: string): AssistantTaskConfiguration[] {
    const rows = this.sqlite.prepare('SELECT * FROM novel_assistant_task_configs WHERE project_id=?').all(projectId) as any[]
    return rows.map((row) => this.toAssistantTaskConfiguration(row))
  }

  getAssistantTaskConfiguration(projectId: string, taskType: AssistantTaskType): AssistantTaskConfiguration | undefined {
    const row = this.sqlite.prepare('SELECT * FROM novel_assistant_task_configs WHERE project_id=? AND task_type=?').get(projectId, taskType) as any
    if (!row) return undefined
    return this.toAssistantTaskConfiguration(row)
  }

  private toAssistantTaskConfiguration(row: any): AssistantTaskConfiguration {
    return AssistantTaskConfigurationSchema.parse({
      projectId: row.project_id, taskType: row.task_type, enabled: Boolean(row.enabled),
      providerId: row.provider_id ?? undefined,
      capabilityIds: row.capability_ids_json ? JSON.parse(row.capability_ids_json) : undefined,
      updatedAt: row.updated_at
    })
  }

  saveAssistantTaskConfiguration(input: Omit<AssistantTaskConfiguration, 'updatedAt'>): AssistantTaskConfiguration {
    const updatedAt = new Date().toISOString()
    const saved = AssistantTaskConfigurationSchema.parse({ ...input, updatedAt })
    this.sqlite.prepare(`INSERT INTO novel_assistant_task_configs (project_id,task_type,enabled,provider_id,capability_ids_json,updated_at)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(project_id,task_type) DO UPDATE SET enabled=excluded.enabled, provider_id=excluded.provider_id,
        capability_ids_json=excluded.capability_ids_json, updated_at=excluded.updated_at`)
      .run(saved.projectId, saved.taskType, saved.enabled ? 1 : 0, saved.providerId ?? null,
        saved.capabilityIds ? JSON.stringify(saved.capabilityIds) : null, updatedAt)
    return saved
  }

  removeAssistantTaskConfiguration(projectId: string, taskType: AssistantTaskType): void {
    this.sqlite.prepare('DELETE FROM novel_assistant_task_configs WHERE project_id=? AND task_type=?').run(projectId, taskType)
  }

  listStyleProfiles(): StyleProfile[] {
    const rows = this.sqlite.prepare('SELECT data_json FROM style_profiles ORDER BY updated_at DESC, name ASC').all() as Array<{ data_json: string }>
    return rows.map((row) => StyleProfileSchema.parse(JSON.parse(row.data_json)))
  }

  getStyleProfile(id: string): StyleProfile | undefined {
    const row = this.sqlite.prepare('SELECT data_json FROM style_profiles WHERE id=?').get(id) as { data_json: string } | undefined
    return row ? StyleProfileSchema.parse(JSON.parse(row.data_json)) : undefined
  }

  createStyleProfile(draft: StyleProfileDraft, source: { kind?: StyleProfile['sourceKind']; name?: string; digest?: string; characterCount?: number } = {}): StyleProfile {
    const now = new Date().toISOString()
    const profile = StyleProfileSchema.parse({
      ...draft, id: randomUUID(), sourceKind: source.kind ?? '用户创建', sourceName: source.name ?? '', sourceDigest: source.digest ?? '',
      sourceCharacterCount: source.characterCount ?? 0, createdAt: now, updatedAt: now
    })
    this.sqlite.prepare('INSERT INTO style_profiles (id,name,source_kind,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(profile.id, profile.name, profile.sourceKind, JSON.stringify(profile), profile.createdAt, profile.updatedAt)
    return profile
  }

  updateStyleProfile(id: string, patch: Partial<StyleProfileDraft>): StyleProfile {
    const current = this.getStyleProfile(id)
    if (!current) throw Object.assign(new Error('找不到该文风范本。'), { code: 'STYLE_PROFILE_NOT_FOUND' })
    const updated = StyleProfileSchema.parse({ ...current, ...patch, traits: patch.traits ? { ...current.traits, ...patch.traits } : current.traits, id, updatedAt: new Date().toISOString() })
    this.sqlite.prepare('UPDATE style_profiles SET name=?,source_kind=?,data_json=?,updated_at=? WHERE id=?')
      .run(updated.name, updated.sourceKind, JSON.stringify(updated), updated.updatedAt, id)
    return updated
  }

  removeStyleProfile(id: string): void {
    this.sqlite.prepare('DELETE FROM style_profiles WHERE id=?').run(id)
  }

  createStyleLearningJob(input: { sourceName: string; sourceDigest: string; sourceCharacterCount: number; requestedName: string; providerId?: string }): StyleLearningJob {
    const now = new Date().toISOString()
    const job = StyleLearningJobSchema.parse({ id: randomUUID(), status: '等待', ...input, createdAt: now, updatedAt: now })
    this.sqlite.prepare('INSERT INTO style_learning_jobs (id,status,source_name,source_digest,source_character_count,requested_name,provider_id,candidate_json,profile_id,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(job.id, job.status, job.sourceName, job.sourceDigest, job.sourceCharacterCount, job.requestedName, job.providerId ?? null, null, null, null, now, now)
    return job
  }

  getStyleLearningJob(id: string): StyleLearningJob | undefined {
    const row = this.sqlite.prepare('SELECT * FROM style_learning_jobs WHERE id=?').get(id) as any
    return row ? StyleLearningJobSchema.parse({ id: row.id, status: row.status, sourceName: row.source_name, sourceDigest: row.source_digest, sourceCharacterCount: row.source_character_count, requestedName: row.requested_name, providerId: row.provider_id ?? undefined, candidate: row.candidate_json ? JSON.parse(row.candidate_json) : undefined, profileId: row.profile_id ?? undefined, error: row.error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }) : undefined
  }

  updateStyleLearningJob(id: string, patch: Partial<Pick<StyleLearningJob, 'status' | 'candidate' | 'profileId' | 'error'>>): StyleLearningJob {
    const current = this.getStyleLearningJob(id)
    if (!current) throw Object.assign(new Error('找不到该文笔学习任务。'), { code: 'STYLE_LEARNING_JOB_NOT_FOUND' })
    const updated = StyleLearningJobSchema.parse({ ...current, ...patch, updatedAt: new Date().toISOString() })
    this.sqlite.prepare('UPDATE style_learning_jobs SET status=?,candidate_json=?,profile_id=?,error=?,updated_at=? WHERE id=?')
      .run(updated.status, updated.candidate ? JSON.stringify(updated.candidate) : null, updated.profileId ?? null, updated.error ?? null, updated.updatedAt, id)
    return updated
  }

  createCreativeConversation(input: { projectId: string; stage: CreativeChatStage; targetId?: string; title?: string }): CreativeConversation {
    this.getProject(input.projectId)
    const now = new Date().toISOString()
    const conversation = { id: randomUUID(), projectId: input.projectId, assistantId: projectAssistantId(input.projectId, input.stage), stage: input.stage, targetId: input.targetId ?? '', title: input.title?.trim() || '新的创作对话', createdAt: now, updatedAt: now, messageCount: 0 }
    this.sqlite.prepare('INSERT INTO novel_creative_conversations (id,project_id,stage,target_id,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(conversation.id, conversation.projectId, conversation.stage, conversation.targetId, conversation.title, now, now)
    return CreativeConversationSchema.parse(conversation)
  }

  listCreativeConversations(projectId: string, stage?: CreativeChatStage, successfulOnly = false): CreativeConversation[] {
    this.getProject(projectId)
    const successFilter = successfulOnly ? " AND EXISTS (SELECT 1 FROM novel_creative_messages sm WHERE sm.conversation_id=c.id AND sm.role='assistant')" : ''
    const rows = (stage
      ? this.sqlite.prepare(`SELECT c.*, (SELECT count(*) FROM novel_creative_messages m WHERE m.conversation_id=c.id) AS message_count FROM novel_creative_conversations c WHERE c.project_id=? AND c.stage=?${successFilter} ORDER BY c.updated_at DESC`).all(projectId, stage)
      : this.sqlite.prepare(`SELECT c.*, (SELECT count(*) FROM novel_creative_messages m WHERE m.conversation_id=c.id) AS message_count FROM novel_creative_conversations c WHERE c.project_id=?${successFilter} ORDER BY c.updated_at DESC`).all(projectId)) as any[]
    return rows.map((row) => this.toCreativeConversation(row))
  }

  getCreativeConversation(projectId: string, conversationId: string): CreativeConversation | undefined {
    this.getProject(projectId)
    const row = this.sqlite.prepare('SELECT c.*, (SELECT count(*) FROM novel_creative_messages m WHERE m.conversation_id=c.id) AS message_count FROM novel_creative_conversations c WHERE c.project_id=? AND c.id=?').get(projectId, conversationId) as any
    return row ? this.toCreativeConversation(row) : undefined
  }

  private toCreativeConversation(row: any): CreativeConversation {
    return CreativeConversationSchema.parse({ id: row.id, projectId: row.project_id, assistantId: projectAssistantId(row.project_id, row.stage), stage: row.stage, targetId: row.target_id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at, messageCount: Number(row.message_count) })
  }

  listCreativeMessages(projectId: string, conversationId: string): CreativeChatMessage[] {
    const conversation = this.getCreativeConversation(projectId, conversationId)
    if (!conversation) return []
    const rows = this.sqlite.prepare('SELECT m.* FROM novel_creative_messages m JOIN novel_creative_conversations c ON c.id=m.conversation_id WHERE c.project_id=? AND c.id=? ORDER BY m.created_at ASC, m.rowid ASC').all(projectId, conversationId) as any[]
    return rows.map((row) => CreativeChatMessageSchema.parse({ id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content, mode: row.mode, references: JSON.parse(row.references_json), actions: JSON.parse(row.actions_json), projectRevision: row.project_revision, createdAt: row.created_at }))
  }

  appendCreativeMessage(input: Omit<CreativeChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): CreativeChatMessage {
    const projectId = this.sqlite.prepare('SELECT project_id FROM novel_creative_conversations WHERE id=?').pluck().get(input.conversationId) as string | undefined
    const conversation = projectId ? this.getCreativeConversation(projectId, input.conversationId) : undefined
    if (!conversation) throw new Error('创作对话不存在。')
    const message = CreativeChatMessageSchema.parse({ ...input, id: input.id ?? randomUUID(), createdAt: input.createdAt ?? new Date().toISOString() })
    this.sqlite.prepare('INSERT INTO novel_creative_messages (id,conversation_id,role,content,mode,references_json,actions_json,project_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(message.id, message.conversationId, message.role, message.content, message.mode, JSON.stringify(message.references), JSON.stringify(message.actions), message.projectRevision, message.createdAt)
    this.sqlite.prepare('UPDATE novel_creative_conversations SET updated_at=?, title=CASE WHEN title=\'新的创作对话\' AND ? <> \'\' THEN substr(?,1,40) ELSE title END WHERE id=?').run(message.createdAt, message.role === 'user' ? message.content : '', message.role === 'user' ? message.content : '', message.conversationId)
    return message
  }

  removeCreativeConversation(projectId: string, conversationId: string): void {
    this.getProject(projectId)
    this.sqlite.prepare('DELETE FROM novel_creative_conversations WHERE project_id=? AND id=?').run(projectId, conversationId)
  }

  removeCreativeMessage(projectId: string, messageId: string): void {
    this.getProject(projectId)
    this.sqlite.prepare('DELETE FROM novel_creative_messages WHERE id=? AND conversation_id IN (SELECT id FROM novel_creative_conversations WHERE project_id=?)').run(messageId, projectId)
  }

  createProject(document: NovelProject): NovelProject {
    // 规划基线补齐会更新嵌套章纲；先深拷贝，避免“保存项目”改变调用方手里的原对象。
    const parsed = establishPlanningDigestBaseline(NovelProjectSchema.parse(structuredClone(document)))
    this.sqlite.prepare('INSERT INTO novel_projects (id,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?)').run(parsed.id, parsed.title, JSON.stringify(parsed), parsed.createdAt, parsed.updatedAt)
    this.reindex(parsed)
    return parsed
  }

  duplicateProject(id: string): NovelProject {
    const source = this.getProject(id)
    const now = new Date().toISOString()
    const copy = structuredClone(source)
    copy.id = randomUUID()
    copy.title = `${source.title}（副本）`
    copy.revision = 0
    copy.createdAt = now
    copy.updatedAt = now
    // 复制的是正式创作资料；旧版本快照、候选和任务历史不带入新项目，避免回退时串线。
    return this.createProject(copy)
  }

  listProjects(): NovelProjectSummary[] {
    const rows = this.sqlite.prepare('SELECT data_json FROM novel_projects ORDER BY updated_at DESC').all() as Array<{ data_json: string }>
    return rows.map((row) => {
      const project = NovelProjectSchema.parse(JSON.parse(row.data_json))
      const pendingMemoryCount = (this.sqlite.prepare("SELECT count(*) count FROM memory_proposals WHERE project_id=? AND status='待确认'").get(project.id) as { count: number }).count
      const planningProgress = Math.min(100,
        (project.worldBible ? 50 : 0) +
        (project.outline ? 30 : 0) +
        (project.worldBible?.status === '定稿' ? 10 : 0) +
        (project.outline?.status === '定稿' ? 10 : 0)
      )
      const totalWords = wordCount(project)
      const targetWords = Math.max(1, project.settings.targetWords || 1)
      const writingProgress = Math.min(100, Math.round((totalWords / targetWords) * 100))
      const unresolvedThreads = project.plotThreads.filter((item) => !['已回收', '已放弃'].includes(item.status)).length
      const overdueThreads = project.plotThreads.filter((item) => item.status === '逾期').length
      const pendingReviews = project.reviews.filter((item) => item.status === '待处理').length
      const staleOutlineCards = project.outline?.volumes.reduce((count, volume) => count + volume.chapters.filter((chapter) => {
        const stale = chapterPlanStaleness(volume, chapter)
        return stale.volumeChanged || stale.outlineChanged || chapter.downstreamReviewStatus === '待复核'
      }).length, 0) ?? 0
      const recoverableJobs = this.listRecoverableGenerationJobs(project.id).length
      const description = Array.from((project.outline?.synopsis.trim() || project.seed.trim()).replace(/\s+/g, ' ')).slice(0, 160).join('') || undefined
      return {
        description,
        id: project.id, title: project.title, status: project.status, genreTemplate: project.settings.genreTemplate,
        chapterCount: project.chapters.length, wordCount: totalWords, pendingMemoryCount, updatedAt: project.updatedAt,
        archived: Boolean(project.archived), creationMode: '标准创作', planningProgress, writingProgress,
        health: { pendingMemory: pendingMemoryCount, unresolvedThreads, overdueThreads, pendingReviews, staleOutlineCards, recoverableJobs }
      }
    })
  }

  getProject(id: string): NovelProject {
    const row = this.sqlite.prepare('SELECT data_json FROM novel_projects WHERE id=?').get(id) as { data_json: string } | undefined
    if (!row) throw new Error('小说项目不存在或已被删除。')
    return establishPlanningDigestBaseline(NovelProjectSchema.parse(JSON.parse(row.data_json)))
  }

  saveProject(input: NovelProject, baseRevision: number, reason = '自动保存', source = '用户编辑'): NovelProject {
    const current = this.getProject(input.id)
    if (current.revision !== baseRevision) throw new NovelRevisionConflictError(baseRevision, current.revision)
    const now = new Date().toISOString()
    const next = establishPlanningDigestBaseline(NovelProjectSchema.parse(reconcileNovelAfterEdit(current, { ...input, revision: current.revision + 1, updatedAt: now })))
    // 单次保存自身也是多步写入（快照 + 项目 + 待处理记忆失效 + 重索引），必须整体提交或整体回滚。
    return this.sqlite.transaction(() => this.writeProjectInternal(next, current, reason, source))()
  }

  /**
   * 事务内部的统一写入序列：快照 → 项目 → 待处理记忆失效 → 重索引。
   * `saveProject` 与「候选应用」共用它，避免出现两套提交顺序。
   */
  private writeProjectInternal(next: NovelProject, current: NovelProject, reason: string, source: string): NovelProject {
    if (reason !== '自动保存') {
      this.checkpoint('开始写入')
      // 连续正文输入会频繁自动保存。历史版本只记录有意义的检查点，
      // 避免长篇项目因每次按键都保存整本小说副本而无限膨胀。
      this.snapshot(current, reason, source)
      this.checkpoint('已写入恢复前快照')
    }
    this.sqlite.prepare('UPDATE novel_projects SET title=?, data_json=?, updated_at=? WHERE id=?').run(next.title, JSON.stringify(next), next.updatedAt, next.id)
    this.checkpoint('已写入项目')
    this.invalidatePending(next)
    this.reindex(next)
    this.checkpoint('已重建索引')
    return next
  }

  /**
   * 候选应用的完整事务：**项目内容 + revision、恢复前快照、候选状态、生成任务** 同一事务提交。
   * 任何一步失败都整体回滚，不会留下「项目已改但候选仍待处理」这种半完成状态。
   */
  applyAcceptedRevision(input: {
    project: NovelProject
    baseRevision: number
    reason: string
    source: string
    proposal: NovelRevisionProposal
    /** 事务内部的附加写入（如草稿状态）；只在项目与候选都已写入后执行，失败整体回滚。 */
    onCommit?: () => void
  }): NovelProject {
    const current = this.getProject(input.project.id)
    if (current.revision !== input.baseRevision) throw new NovelRevisionConflictError(input.baseRevision, current.revision)
    const now = new Date().toISOString()
    const next = establishPlanningDigestBaseline(NovelProjectSchema.parse(reconcileNovelAfterEdit(current, { ...input.project, revision: current.revision + 1, updatedAt: now })))
    return this.sqlite.transaction(() => {
      this.checkpoint('开始写入')
      const written = this.writeProjectInternal(next, current, input.reason, input.source)
      this.saveRevision({ ...input.proposal, status: '已应用', baseRevision: current.revision })
      this.checkpoint('已写入候选状态')
      this.markGenerationProposalHandled(input.proposal.id)
      this.checkpoint('已标记生成任务')
      input.onCommit?.()
      return written
    })()
  }

  replaceProject(next: NovelProject, baseRevision: number, reason: string, source: string): NovelProject {
    return this.saveProject(next, baseRevision, reason, source)
  }

  removeProject(id: string): void {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM novel_search WHERE project_id=?').run(id)
      this.sqlite.prepare('DELETE FROM novel_projects WHERE id=?').run(id)
    })()
  }

  setProjectArchived(id: string, archived: boolean): NovelProject {
    const current = this.getProject(id)
    const next = structuredClone(current)
    next.archived = archived
    next.archivedAt = archived ? new Date().toISOString() : undefined
    return this.saveProject(next, current.revision, archived ? '归档项目' : '恢复项目', '项目管理')
  }

  snapshot(project: NovelProject, reason: string, source: string): NovelVersionSummary {
    const version = NovelVersionSummarySchema.parse({ id: randomUUID(), projectId: project.id, revision: project.revision, reason, source, createdAt: new Date().toISOString() })
    this.sqlite.prepare('INSERT INTO novel_versions (id,project_id,revision,reason,source,data_json,created_at) VALUES (?,?,?,?,?,?,?)').run(version.id, version.projectId, version.revision, version.reason, version.source, JSON.stringify(project), version.createdAt)
    return version
  }

  listVersions(projectId: string): NovelVersionSummary[] {
    return (this.sqlite.prepare('SELECT id,project_id,revision,reason,source,created_at FROM novel_versions WHERE project_id=? ORDER BY created_at DESC').all(projectId) as any[]).map((row) => NovelVersionSummarySchema.parse({ id: row.id, projectId: row.project_id, revision: row.revision, reason: row.reason, source: row.source, createdAt: row.created_at }))
  }

  getVersion(projectId: string, versionId: string): NovelProject {
    const row = this.sqlite.prepare('SELECT project_id,data_json FROM novel_versions WHERE id=?').get(versionId) as { project_id: string; data_json: string } | undefined
    if (!row || row.project_id !== projectId) throw new Error('找不到指定版本。')
    return establishPlanningDigestBaseline(NovelProjectSchema.parse(JSON.parse(row.data_json)))
  }

  removeVersion(projectId: string, versionId: string): void { this.sqlite.prepare('DELETE FROM novel_versions WHERE id=? AND project_id=?').run(versionId, projectId) }

  /** 受控恢复的差异预览：只读比对，不写任何东西。 */
  previewVersionRestore(projectId: string, versionId: string, now: string): ReturnType<typeof buildVersionRestorePreview> {
    const current = this.getProject(projectId)
    if (!this.listVersions(projectId).some((item) => item.id === versionId)) throw new VersionNotFoundError()
    return buildVersionRestorePreview(current, this.getVersion(projectId, versionId), versionId, now)
  }

  /**
   * 受控事务恢复：**恢复前快照 + 目标内容 + 新的当前 revision** 在同一个事务里提交。
   * 请求携带的 previewDigest 必须与此刻重算的结果一致，否则拒绝并要求重新预览。
   * 任何一步失败都整体回滚，不会留下「快照已建但内容没换」这种半完成状态。
   */
  restoreVersionWithPreview(input: { projectId: string; versionId: string; expectedDigest: string }): NovelProject {
    const current = this.getProject(input.projectId)
    if (!this.listVersions(input.projectId).some((item) => item.id === input.versionId)) throw new VersionNotFoundError()
    const snapshot = this.getVersion(input.projectId, input.versionId)
    if (versionRestoreDigest(current, snapshot, input.versionId) !== input.expectedDigest) throw new VersionRestorePreviewStaleError()

    const now = new Date().toISOString()
    const next = establishPlanningDigestBaseline(NovelProjectSchema.parse(reconcileNovelAfterEdit(current, {
      ...snapshot,
      id: current.id,
      // 恢复只能让版本号前进，绝不倒退成历史版本号，否则并发写入会互相覆盖。
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: now
    })))

    return this.sqlite.transaction(() => {
      this.checkpoint('开始写入')
      this.snapshot(current, `恢复前：第 ${snapshot.revision} 版`, '版本历史')
      this.checkpoint('已写入恢复前快照')
      this.sqlite.prepare('UPDATE novel_projects SET title=?, data_json=?, updated_at=? WHERE id=?').run(next.title, JSON.stringify(next), next.updatedAt, next.id)
      this.checkpoint('已写入项目')
      this.invalidatePending(next)
      this.reindex(next)
      this.checkpoint('已重建索引')
      return next
    })()
  }
  /**
   * @deprecated 不走差异预览的兼容通道，仅供内部与测试使用。
   * 正式恢复一律走 `restoreVersionWithPreview`（带 previewDigest 校验与事务）。
   */
  restoreVersion(projectId: string, versionId: string): NovelProject {
    const current = this.getProject(projectId)
    const snapshot = this.getVersion(projectId, versionId)
    return this.saveProject({ ...snapshot, revision: current.revision }, current.revision, '恢复历史版本', '版本历史')
  }

  saveRevision(proposal: NovelRevisionProposal): NovelRevisionProposal {
    const parsed = NovelRevisionProposalSchema.parse(proposal)
    const now = new Date().toISOString()
    this.sqlite.prepare('INSERT INTO novel_revision_proposals (id,project_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at').run(parsed.id, parsed.projectId, JSON.stringify(parsed), parsed.createdAt, now)
    return parsed
  }
  getRevision(id: string): NovelRevisionProposal {
    const row = this.sqlite.prepare('SELECT data_json FROM novel_revision_proposals WHERE id=?').get(id) as { data_json: string } | undefined
    if (!row) throw new Error('找不到修改候选。')
    return NovelRevisionProposalSchema.parse(JSON.parse(row.data_json))
  }
  listRevisions(projectId: string, includeResolved = false): NovelRevisionProposal[] {
    const rows = (this.sqlite.prepare('SELECT data_json FROM novel_revision_proposals WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Array<{ data_json: string }>).map((row) => NovelRevisionProposalSchema.parse(JSON.parse(row.data_json)))
    return includeResolved ? rows : rows.filter((item) => item.status === '待处理' || item.status === '已冲突')
  }
  removeRevision(id: string): void { this.sqlite.prepare('DELETE FROM novel_revision_proposals WHERE id=?').run(id) }

  /** 多个候选作为一个作者决定提交；内层既有保存事务会变成 SQLite savepoint。 */
  runRevisionBatch<T>(work: () => T): T { return this.sqlite.transaction(work)() }

  saveMemoryProposals(items: MemoryProposal[]): MemoryProposal[] {
    const statement = this.sqlite.prepare('INSERT INTO memory_proposals (id,project_id,chapter_id,status,source_digest,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data_json=excluded.data_json,updated_at=excluded.updated_at')
    const transaction = this.sqlite.transaction((records: MemoryProposal[]) => records.forEach((raw) => { const item = MemoryProposalSchema.parse(raw); statement.run(item.id, item.projectId, item.chapterId, item.status, item.sourceDigest, JSON.stringify(item), item.createdAt, new Date().toISOString()) }))
    transaction(items)
    return items
  }
  listMemoryProposals(projectId: string, includeResolved = false): MemoryProposal[] {
    const sql = includeResolved ? 'SELECT data_json FROM memory_proposals WHERE project_id=? ORDER BY created_at DESC' : "SELECT data_json FROM memory_proposals WHERE project_id=? AND status IN ('待确认','已失效') ORDER BY created_at DESC"
    return (this.sqlite.prepare(sql).all(projectId) as Array<{ data_json: string }>).map((row) => MemoryProposalSchema.parse(JSON.parse(row.data_json)))
  }
  getMemoryProposal(id: string): MemoryProposal {
    const row = this.sqlite.prepare('SELECT data_json FROM memory_proposals WHERE id=?').get(id) as { data_json: string } | undefined
    if (!row) throw new Error('找不到记忆提案。')
    return MemoryProposalSchema.parse(JSON.parse(row.data_json))
  }
  updateMemoryProposal(item: MemoryProposal): MemoryProposal { this.saveMemoryProposals([item]); return item }

  resolveMemoryProposalBatch(projectId: string, currentRevision: number, decisions: readonly MemoryProposalBatchDecision[]): MemoryProposalBatchResolveResult {
    const project = this.getProject(projectId)
    const proposals = this.listMemoryProposals(projectId, true)
    const result = applyMemoryProposalBatch(project, proposals, decisions, currentRevision)
    if (!result.ok) return { status: '全部回滚', appliedProposalIds: [], blockers: result.blockers }

    return this.sqlite.transaction(() => {
      const saved = result.appliedProposalIds.length > 0
        ? this.saveProject(result.project, project.revision, '批量确认章节记忆', '用户确认')
        : project
      for (const decision of decisions) {
        const proposal = proposals.find((item) => item.id === decision.proposalId)!
        this.updateMemoryProposal({ ...proposal, status: decision.status })
        this.markMemoryProposalHandled(proposal.id)
      }
      return { status: '全部成功' as const, appliedProposalIds: decisions.map((item) => item.proposalId), blockers: [], committedRevision: saved.revision }
    })()
  }

  listCreativeCapabilities(projectId: string): CreativeCapability[] {
    this.getProject(projectId)
    const enabled = new Map((this.sqlite.prepare('SELECT capability_id,enabled FROM novel_creative_capability_configs WHERE project_id=?').all(projectId) as Array<{ capability_id: string; enabled: number }>).map((row) => [row.capability_id, Boolean(row.enabled)]))
    const custom = (this.sqlite.prepare('SELECT data_json FROM novel_custom_creative_capabilities WHERE project_id=? ORDER BY created_at').all(projectId) as Array<{ data_json: string }>).map((row) => CreativeCapabilitySchema.parse(JSON.parse(row.data_json)))
    return [...BUILT_IN_CREATIVE_CAPABILITIES, ...custom].map((item) => CreativeCapabilitySchema.parse({ ...item, enabled: enabled.get(item.id) ?? item.enabled }))
  }

  /** 记录一次真实请求在组装技能数据块后进入 provider 前的加载收据。 */
  markCreativeSkillsLoaded(projectId: string, stage: CreativeAssistantSkillStage, capabilities: readonly CreativeCapability[]): AssistantSkillLoadReceipt {
    this.getProject(projectId)
    const loadedAt = new Date().toISOString()
    const statement = this.sqlite.prepare('INSERT INTO novel_creative_skill_loads (project_id,capability_id,stage,source_digest,loaded_version,loaded_at) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,capability_id,stage) DO UPDATE SET source_digest=excluded.source_digest,loaded_version=excluded.loaded_version,loaded_at=excluded.loaded_at')
    const capabilityIds: string[] = []
    this.sqlite.transaction(() => {
      for (const capability of capabilities) {
        if (!capability.enabled || !capability.sourceDigest) continue
        statement.run(projectId, capability.id, stage, capability.sourceDigest, capability.skillVersion ?? null, loadedAt)
        capabilityIds.push(capability.id)
      }
    })()
    return { stage, capabilityIds, loadedAt }
  }

  listStyleProfileUsage(projectId: string): StyleProfileUsage[] {
    const rows = this.sqlite.prepare('SELECT id,project_id,profile_id,profile_name,action,revision,created_at FROM style_profile_usage WHERE project_id=? ORDER BY created_at DESC, rowid DESC').all(projectId) as Array<{
      id: string; project_id: string; profile_id: string; profile_name: string; action: string; revision: number; created_at: string
    }>
    return rows.map((row) => StyleProfileUsageSchema.parse({
      id: row.id, projectId: row.project_id, profileId: row.profile_id, profileName: row.profile_name,
      action: row.action, revision: row.revision, createdAt: row.created_at
    }))
  }

  saveStyleProfileBinding(next: NovelProject, baseRevision: number, event: { action: '绑定' | '停用'; profileId: string; profileName: string }): NovelProject {
    return this.sqlite.transaction(() => {
      const saved = this.saveProject(next, baseRevision, event.action === '绑定' ? '绑定文风范本' : '停用文风范本', '文笔工坊')
      this.sqlite.prepare('INSERT INTO style_profile_usage (id,project_id,profile_id,profile_name,action,revision,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), saved.id, event.profileId, event.profileName, event.action, saved.revision, new Date().toISOString())
      return saved
    })()
  }

  /** 技能目录的状态投影：enabled 是能力权限，loaded 只来自真实请求加载收据。 */
  listCreativeSkillCatalog(projectId: string): CreativeSkillCatalogItem[] {
    const capabilities = this.listCreativeCapabilities(projectId)
    const loadedStages = new Map<string, string[]>()
    const loadedVersions = new Map<string, string>()
    const loadedAt = new Map<string, string>()
    const rows = this.sqlite.prepare('SELECT capability_id,stage,source_digest,loaded_version,loaded_at FROM novel_creative_skill_loads WHERE project_id=? ORDER BY loaded_at').all(projectId) as Array<{ capability_id: string; stage: CreativeAssistantSkillStage; source_digest: string; loaded_version: string | null; loaded_at: string }>
    const byId = new Map(capabilities.map((item) => [item.id, item]))
    for (const stage of ['idea', 'world', 'outline', 'writing', 'memory', 'delivery'] as const) {
      const configuration = this.getAssistantSkillConfiguration(projectId, stage)
      const seat = configuration ? undefined : this.getCreativeSeat(projectId, DEFAULT_STAGE_SEATS[stage])
      const assigned = configuration?.enabled === false ? [] : configuration?.capabilityIds ?? seat?.capabilityIds ?? []
      for (const row of rows.filter((item) => item.stage === stage)) {
        const capability = byId.get(row.capability_id)
        if (!capability?.enabled || !capability.sourceDigest || capability.sourceDigest !== row.source_digest || !assigned.includes(row.capability_id)) continue
        const stages = loadedStages.get(capability.id) ?? []
        if (!stages.includes(stage)) stages.push(stage)
        loadedStages.set(capability.id, stages)
        if (row.loaded_version) loadedVersions.set(capability.id, row.loaded_version)
        loadedAt.set(capability.id, row.loaded_at)
      }
    }
    return capabilities.map((capability) => {
      const stages = loadedStages.get(capability.id) ?? []
      const loaded = stages.length > 0
      return CreativeSkillCatalogItemSchema.parse({
        ...capability, status: loaded ? '已加载' : capability.enabled ? '已启用' : '已停用', loaded,
        loadedStages: stages, loadedVersion: loadedVersions.get(capability.id) ?? capability.skillVersion, loadedAt: loadedAt.get(capability.id),
        versionCount: this.listCreativeSkillVersions(projectId, capability.id).length
      })
    })
  }

  saveCreativeCapabilityConfiguration(input: Omit<CreativeCapabilityConfiguration, 'updatedAt'>): CreativeCapabilityConfiguration {
    this.getProject(input.projectId)
    if (!this.listCreativeCapabilities(input.projectId).some((item) => item.id === input.capabilityId)) throw new Error('找不到指定创作能力。')
    const parsed = CreativeCapabilityConfigurationSchema.parse({ ...input, updatedAt: new Date().toISOString() })
    this.sqlite.prepare('INSERT INTO novel_creative_capability_configs (project_id,capability_id,enabled,updated_at) VALUES (?,?,?,?) ON CONFLICT(project_id,capability_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at')
      .run(parsed.projectId, parsed.capabilityId, Number(parsed.enabled), parsed.updatedAt)
    this.sqlite.prepare('DELETE FROM novel_creative_skill_loads WHERE project_id=? AND capability_id=?').run(parsed.projectId, parsed.capabilityId)
    return parsed
  }

  listCreativeCapabilityConfigurations(projectId: string): CreativeCapabilityConfiguration[] {
    return (this.sqlite.prepare('SELECT project_id,capability_id,enabled,updated_at FROM novel_creative_capability_configs WHERE project_id=? ORDER BY capability_id').all(projectId) as Array<{ project_id: string; capability_id: string; enabled: number; updated_at: string }>).map((row) => CreativeCapabilityConfigurationSchema.parse({ projectId: row.project_id, capabilityId: row.capability_id, enabled: Boolean(row.enabled), updatedAt: row.updated_at }))
  }

  createCustomCreativeCapability(projectId: string, input: CreateCreativeCapabilityInput): CreativeCapability {
    this.getProject(projectId)
    const parsed = CreateCreativeCapabilityInputSchema.parse(input)
    const now = new Date().toISOString()
    const calculatedDigest = parsed.skillText ? creativeSkillDigest(parsed) : undefined
    if (parsed.sourceDigest && (!calculatedDigest || parsed.sourceDigest !== calculatedDigest)) throw Object.assign(new Error('技能摘要与正文不匹配。'), { code: 'SKILL_DIGEST_MISMATCH' })
    const sourceDigest = calculatedDigest
    const duplicate = sourceDigest
      ? this.listCreativeCapabilities(projectId).find((item) => item.source === '用户配置' && item.skillText && creativeSkillDigest(item) === sourceDigest)
      : undefined
    if (duplicate) return CreativeCapabilitySchema.parse(duplicate)
    const capability = CreativeCapabilitySchema.parse({ ...parsed, sourceKind: parsed.sourceKind ?? 'local', sourceDigest, id: `custom-capability-${randomUUID()}`, enabled: true, source: '用户配置', createdAt: now, updatedAt: now })
    return this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO novel_custom_creative_capabilities (id,project_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?)')
        .run(capability.id, projectId, JSON.stringify(capability), now, now)
      this.checkpoint('已写入技能能力')
      if (capability.skillText && capability.sourceDigest) this.recordCreativeSkillVersion(projectId, capability)
      return capability
    })()
  }

  updateCustomCreativeCapability(projectId: string, capabilityId: string, input: UpdateCreativeCapabilityInput): CreativeCapability {
    const row = this.sqlite.prepare('SELECT data_json,created_at FROM novel_custom_creative_capabilities WHERE id=? AND project_id=?').get(capabilityId, projectId) as { data_json: string; created_at: string } | undefined
    if (!row) throw new Error('找不到可编辑的用户配置能力；内置能力不能改写。')
    const current = CreativeCapabilitySchema.parse(JSON.parse(row.data_json))
    const patch = UpdateCreativeCapabilityInputSchema.parse(input)
    const now = new Date().toISOString()
    const nextDigest = (patch.skillText ?? current.skillText) ? creativeSkillDigest({ ...current, ...patch }) : undefined
    if (patch.sourceDigest && patch.sourceDigest !== nextDigest) throw Object.assign(new Error('技能摘要与正文不匹配。'), { code: 'SKILL_DIGEST_MISMATCH' })
    const next = CreativeCapabilitySchema.parse({ ...current, ...patch, sourceDigest: nextDigest, id: current.id, source: '用户配置', createdAt: row.created_at, updatedAt: now })
    return this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE novel_custom_creative_capabilities SET data_json=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(next), now, capabilityId, projectId)
      this.checkpoint('已写入技能能力')
      if (patch.enabled !== undefined) this.saveCreativeCapabilityConfiguration({ projectId, capabilityId, enabled: patch.enabled })
      if (next.skillText && next.sourceDigest) this.recordCreativeSkillVersion(projectId, next)
      return this.listCreativeCapabilities(projectId).find((item) => item.id === capabilityId)!
    })()
  }

  listCreativeSkillVersions(projectId: string, capabilityId: string): CreativeSkillVersion[] {
    this.getProject(projectId)
    const versions = (this.sqlite.prepare('SELECT data_json FROM novel_creative_skill_versions WHERE project_id=? AND capability_id=? ORDER BY revision').all(projectId, capabilityId) as Array<{ data_json: string }>)
      .map((row) => CreativeSkillVersionSchema.parse(JSON.parse(row.data_json)))
    const currentRow = this.sqlite.prepare('SELECT data_json FROM novel_custom_creative_capabilities WHERE project_id=? AND id=?').get(projectId, capabilityId) as { data_json: string } | undefined
    const current = currentRow ? CreativeCapabilitySchema.parse(JSON.parse(currentRow.data_json)) : undefined
    const activeRevision = current
      ? versions.reduce((active, version) => version.sourceDigest === current.sourceDigest ? version.revision : active, undefined as number | undefined)
      : undefined
    return versions.map((version) => ({ ...version, active: version.revision === activeRevision }))
  }

  private recordCreativeSkillVersion(projectId: string, capability: CreativeCapability): CreativeSkillVersion | undefined {
    if (!capability.skillText || !capability.sourceDigest) throw new Error('技能版本缺少正文或摘要。')
    const latestRow = this.sqlite.prepare('SELECT data_json FROM novel_creative_skill_versions WHERE project_id=? AND capability_id=? ORDER BY revision DESC LIMIT 1').get(projectId, capability.id) as { data_json: string } | undefined
    const latest = latestRow ? CreativeSkillVersionSchema.parse(JSON.parse(latestRow.data_json)) : undefined
    if (latest?.sourceDigest === capability.sourceDigest) return latest
    const current = this.sqlite.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM novel_creative_skill_versions WHERE project_id=? AND capability_id=?').get(projectId, capability.id) as { revision: number }
    const now = new Date().toISOString()
    const version = CreativeSkillVersionSchema.parse({
      id: `skill-version-${randomUUID()}`, projectId, capabilityId: capability.id, revision: current.revision + 1,
      skillVersion: capability.skillVersion ?? '1.0', sourceDigest: capability.sourceDigest,
      sourceKind: capability.sourceKind, sourceUrl: capability.sourceUrl, sourceRef: capability.sourceRef,
      sourcePinnedAt: capability.sourcePinnedAt, capability, createdAt: now
    })
    this.sqlite.prepare('INSERT INTO novel_creative_skill_versions (id,project_id,capability_id,revision,data_json,created_at) VALUES (?,?,?,?,?,?)')
      .run(version.id, projectId, capability.id, version.revision, JSON.stringify(version), now)
    this.checkpoint('已写入技能快照')
    return version
  }

  rollbackCreativeSkill(projectId: string, capabilityId: string, versionId: string): CreativeCapability {
    const row = this.sqlite.prepare('SELECT data_json,created_at FROM novel_custom_creative_capabilities WHERE id=? AND project_id=?').get(capabilityId, projectId) as { data_json: string; created_at: string } | undefined
    if (!row) throw new Error('找不到可回滚的用户配置能力。')
    const targetRow = this.sqlite.prepare('SELECT data_json FROM novel_creative_skill_versions WHERE id=? AND project_id=? AND capability_id=?').get(versionId, projectId, capabilityId) as { data_json: string } | undefined
    if (!targetRow) throw new Error('找不到指定技能版本。')
    const target = CreativeSkillVersionSchema.parse(JSON.parse(targetRow.data_json)).capability
    const current = CreativeCapabilitySchema.parse(JSON.parse(row.data_json))
    if (current.sourceDigest === target.sourceDigest) return this.listCreativeCapabilities(projectId).find((item) => item.id === capabilityId)!
    const next = CreativeCapabilitySchema.parse({ ...target, id: capabilityId, source: '用户配置', enabled: current.enabled, createdAt: row.created_at, updatedAt: new Date().toISOString() })
    return this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE novel_custom_creative_capabilities SET data_json=?,updated_at=? WHERE id=? AND project_id=?').run(JSON.stringify(next), next.updatedAt, capabilityId, projectId)
      this.checkpoint('已写入技能能力')
      this.recordCreativeSkillVersion(projectId, next)
      return this.listCreativeCapabilities(projectId).find((item) => item.id === capabilityId)!
    })()
  }

  removeCustomCreativeCapability(projectId: string, capabilityId: string): void {
    if (BUILT_IN_CREATIVE_CAPABILITIES.some((item) => item.id === capabilityId)) throw new Error('内置创作能力不能删除，只能在当前项目中停用。')
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM novel_creative_capability_configs WHERE project_id=? AND capability_id=?').run(projectId, capabilityId)
      const rows = this.sqlite.prepare('SELECT seat_id,capability_ids_json FROM novel_creative_seat_configs WHERE project_id=?').all(projectId) as Array<{ seat_id: string; capability_ids_json: string }>
      for (const row of rows) {
        const ids = (JSON.parse(row.capability_ids_json) as string[]).filter((id) => id !== capabilityId)
        this.sqlite.prepare('UPDATE novel_creative_seat_configs SET capability_ids_json=?,updated_at=? WHERE project_id=? AND seat_id=?').run(JSON.stringify(ids), new Date().toISOString(), projectId, row.seat_id)
      }
      const skillRows = this.sqlite.prepare('SELECT stage,capability_ids_json FROM novel_assistant_skill_configs WHERE project_id=?').all(projectId) as Array<{ stage: string; capability_ids_json: string }>
      for (const row of skillRows) {
        const ids = (JSON.parse(row.capability_ids_json) as string[]).filter((id) => id !== capabilityId)
        this.sqlite.prepare('UPDATE novel_assistant_skill_configs SET capability_ids_json=?,updated_at=? WHERE project_id=? AND stage=?').run(JSON.stringify(ids), new Date().toISOString(), projectId, row.stage)
      }
      this.sqlite.prepare('DELETE FROM novel_creative_skill_versions WHERE capability_id=? AND project_id=?').run(capabilityId, projectId)
      this.sqlite.prepare('DELETE FROM novel_creative_skill_loads WHERE capability_id=? AND project_id=?').run(capabilityId, projectId)
      this.sqlite.prepare('DELETE FROM novel_custom_creative_capabilities WHERE id=? AND project_id=?').run(capabilityId, projectId)
    })()
  }

  listAssistantSkillConfigurations(projectId: string): CreativeAssistantSkillConfiguration[] {
    this.getProject(projectId)
    const rows = this.sqlite.prepare('SELECT project_id,stage,enabled,provider_id,capability_ids_json,updated_at FROM novel_assistant_skill_configs WHERE project_id=? ORDER BY stage').all(projectId) as Array<{ project_id: string; stage: string; enabled: number; provider_id: string | null; capability_ids_json: string; updated_at: string }>
    return rows.map((row) => this.toAssistantSkillConfiguration(row))
  }

  getAssistantSkillConfiguration(projectId: string, stage: CreativeAssistantSkillStage): CreativeAssistantSkillConfiguration | undefined {
    this.getProject(projectId)
    const row = this.sqlite.prepare('SELECT project_id,stage,enabled,provider_id,capability_ids_json,updated_at FROM novel_assistant_skill_configs WHERE project_id=? AND stage=?').get(projectId, stage) as { project_id: string; stage: string; enabled: number; provider_id: string | null; capability_ids_json: string; updated_at: string } | undefined
    return row ? this.toAssistantSkillConfiguration(row) : undefined
  }

  private toAssistantSkillConfiguration(row: any): CreativeAssistantSkillConfiguration {
    return CreativeAssistantSkillConfigurationSchema.parse({ projectId: row.project_id, stage: row.stage, enabled: Boolean(row.enabled), providerId: row.provider_id, capabilityIds: JSON.parse(row.capability_ids_json), updatedAt: row.updated_at })
  }

  saveAssistantSkillConfiguration(input: Omit<CreativeAssistantSkillConfiguration, 'updatedAt'>): CreativeAssistantSkillConfiguration {
    const projectExists = this.sqlite.prepare('SELECT 1 FROM novel_projects WHERE id=?').get(input.projectId)
    if (!projectExists) throw Object.assign(new Error('无法保存阶段技能：小说项目不存在或已被删除。'), { code: 'SKILL_PROJECT_NOT_FOUND' })
    this.getProject(input.projectId)
    const uniqueCapabilityIds = Array.isArray(input.capabilityIds) ? [...new Set(input.capabilityIds)] : input.capabilityIds
    const validation = CreativeAssistantSkillConfigurationSchema.safeParse({ ...input, capabilityIds: uniqueCapabilityIds, updatedAt: new Date().toISOString() })
    if (!validation.success) {
      const limitExceeded = validation.error.issues.some((issue) => issue.path[0] === 'capabilityIds' && issue.code === 'too_big')
      throw Object.assign(new Error(limitExceeded ? '每个阶段最多装配 12 项技能。' : '阶段技能配置格式无效。'), { code: limitExceeded ? 'SKILL_LIMIT_EXCEEDED' : 'SKILL_INVALID_CONFIGURATION' })
    }
    const parsed = validation.data
    const capabilities = new Map(this.listCreativeCapabilities(parsed.projectId).map((item) => [item.id, item]))
    if (parsed.capabilityIds.some((id) => !capabilities.has(id))) throw Object.assign(new Error('阶段技能包含不属于当前项目的能力。'), { code: 'SKILL_UNKNOWN_CAPABILITY' })
    for (const id of parsed.capabilityIds) { const capability = capabilities.get(id)!; if (!isCreativeCapabilityAllowedForStage(parsed.stage, capability)) throw Object.assign(new Error(`能力“${capability.name}”不适用于所选阶段。`), { code: 'SKILL_SCOPE_MISMATCH' }) }
    buildCreativeSkillPrompt(parsed.capabilityIds.map((id) => capabilities.get(id)!))
    this.sqlite.prepare('DELETE FROM novel_creative_skill_loads WHERE project_id=? AND stage=?').run(parsed.projectId, parsed.stage)
    this.sqlite.prepare('INSERT INTO novel_assistant_skill_configs (project_id,stage,enabled,provider_id,capability_ids_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,stage) DO UPDATE SET enabled=excluded.enabled,provider_id=excluded.provider_id,capability_ids_json=excluded.capability_ids_json,updated_at=excluded.updated_at')
      .run(parsed.projectId, parsed.stage, Number(parsed.enabled), parsed.providerId ?? null, JSON.stringify(parsed.capabilityIds), parsed.updatedAt)
    return parsed
  }

  listCreativeSeats(projectId: string): CreativeSeat[] {
    const knownCapabilityIds = new Set(this.listCreativeCapabilities(projectId).map((item) => item.id))
    const rows = this.sqlite.prepare('SELECT * FROM novel_creative_seat_configs WHERE project_id=?').all(projectId) as CreativeSeatConfigRow[]
    const configs = new Map(rows.map((row) => [row.seat_id, row]))
    return BUILT_IN_CREATIVE_SEATS.map((seat) => {
      const config = configs.get(seat.id)
      if (!config) return CreativeSeatSchema.parse(seat)
      const capabilityIds = (JSON.parse(config.capability_ids_json) as string[]).filter((id) => knownCapabilityIds.has(id))
      return CreativeSeatSchema.parse({ ...seat, enabled: Boolean(config.enabled), providerId: config.provider_id ?? undefined, capabilityIds })
    })
  }

  listCreativeSeatConfigurations(projectId: string): CreativeSeatConfiguration[] {
    this.getProject(projectId)
    return (this.sqlite.prepare('SELECT project_id,seat_id,enabled,provider_id,capability_ids_json,updated_at FROM novel_creative_seat_configs WHERE project_id=? ORDER BY seat_id').all(projectId) as CreativeSeatConfigRow[]).map((row) => CreativeSeatConfigurationSchema.parse({
      projectId: row.project_id, seatId: row.seat_id, enabled: Boolean(row.enabled), providerId: row.provider_id, capabilityIds: JSON.parse(row.capability_ids_json), updatedAt: row.updated_at
    }))
  }

  getCreativeSeat(projectId: string, seatId: string): CreativeSeat | undefined {
    return this.listCreativeSeats(projectId).find((seat) => seat.id === seatId)
  }

  saveCreativeSeatConfiguration(input: Omit<CreativeSeatConfiguration, 'updatedAt'>): CreativeSeatConfiguration {
    this.getProject(input.projectId)
    if (!getBuiltInCreativeSeat(input.seatId)) throw new Error('找不到指定创作席位。')
    const knownCapabilityIds = new Set(this.listCreativeCapabilities(input.projectId).map((item) => item.id))
    const unknown = input.capabilityIds.find((id) => !knownCapabilityIds.has(id))
    if (unknown) throw new Error('席位配置引用了不存在的创作能力。')
    const parsed = CreativeSeatConfigurationSchema.parse({ ...input, updatedAt: new Date().toISOString() })
    this.sqlite.prepare('INSERT INTO novel_creative_seat_configs (project_id,seat_id,enabled,provider_id,capability_ids_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,seat_id) DO UPDATE SET enabled=excluded.enabled,provider_id=excluded.provider_id,capability_ids_json=excluded.capability_ids_json,updated_at=excluded.updated_at')
      .run(parsed.projectId, parsed.seatId, Number(parsed.enabled), parsed.providerId ?? null, JSON.stringify(parsed.capabilityIds), parsed.updatedAt)
    return parsed
  }


  createCreativeOrchestrationRun(input: CreativeOrchestrationRun): CreativeOrchestrationRun {
    this.getProject(input.projectId)
    const run = CreativeOrchestrationRunSchema.parse(input)
    const stepIds = new Set(run.steps.map((step) => step.id))
    if (stepIds.size !== run.steps.length) throw new Error('创作运行中存在重复工序编号。')
    for (const step of run.steps) {
      if (step.runId !== run.id) throw new Error('创作工序不属于当前运行。')
      if (step.dependsOn.some((id) => !stepIds.has(id) || id === step.id)) throw new Error('创作工序包含无效的前置依赖。')
      if (!getBuiltInCreativeSeat(step.seatId)) throw new Error('创作工序引用了不存在的席位。')
    }
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO novel_orchestration_runs
        (id,project_id,request_json,base_revision,status,max_parallel,require_human_gate,auto_apply,warnings_json,created_at,started_at,ended_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(run.id, run.projectId, JSON.stringify(run.request), run.baseRevision, run.status, run.policy.maxParallel, 1, 0, JSON.stringify(run.warnings), run.createdAt, run.startedAt ?? null, run.endedAt ?? null, run.updatedAt)
      const insert = this.sqlite.prepare(`INSERT INTO novel_orchestration_steps
        (id,run_id,step_order,seat_id,title,generation_kind,target_id,dependencies_json,status,reason,evidence_json,estimated_tokens,job_id,proposal_id,memory_proposal_ids_json,error_json,attempt,created_at,started_at,ended_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      for (const step of run.steps) insert.run(step.id, step.runId, step.order, step.seatId, step.title, step.kind, step.targetId ?? null, JSON.stringify(step.dependsOn), step.status, step.reason, JSON.stringify(step.evidence), step.estimatedTokens, step.jobId ?? null, step.proposalId ?? null, JSON.stringify(step.memoryProposalIds), step.error ? JSON.stringify(step.error) : null, step.attempt, step.createdAt, step.startedAt ?? null, step.endedAt ?? null, step.updatedAt)
    })()
    return this.getCreativeOrchestrationRun(run.id)!
  }

  getCreativeOrchestrationRun(id: string): CreativeOrchestrationRun | undefined {
    const row = this.sqlite.prepare('SELECT * FROM novel_orchestration_runs WHERE id=?').get(id) as CreativeRunRow | undefined
    return row ? this.toCreativeOrchestrationRun(row) : undefined
  }

  listCreativeOrchestrationRuns(projectId: string): CreativeOrchestrationRun[] {
    return (this.sqlite.prepare('SELECT * FROM novel_orchestration_runs WHERE project_id=? ORDER BY created_at DESC').all(projectId) as CreativeRunRow[]).map((row) => this.toCreativeOrchestrationRun(row))
  }

  updateCreativeOrchestrationRun(id: string, input: UpdateCreativeOrchestrationRun): CreativeOrchestrationRun {
    const current = this.getCreativeOrchestrationRun(id)
    if (!current) throw new Error('找不到指定创作运行。')
    const patch = UpdateCreativeOrchestrationRunSchema.parse(input)
    const now = new Date().toISOString()
    const next = CreativeOrchestrationRunSchema.parse({
      ...current,
      status: patch.status ?? current.status,
      warnings: patch.warnings ?? current.warnings,
      startedAt: patch.startedAt === null ? undefined : patch.startedAt ?? current.startedAt,
      endedAt: patch.endedAt === null ? undefined : patch.endedAt ?? current.endedAt,
      updatedAt: now
    })
    this.sqlite.prepare('UPDATE novel_orchestration_runs SET status=?,warnings_json=?,started_at=?,ended_at=?,updated_at=? WHERE id=?')
      .run(next.status, JSON.stringify(next.warnings), next.startedAt ?? null, next.endedAt ?? null, now, id)
    return this.getCreativeOrchestrationRun(id)!
  }

  getCreativeOrchestrationStep(runId: string, stepId: string): CreativeOrchestrationStep | undefined {
    const row = this.sqlite.prepare('SELECT * FROM novel_orchestration_steps WHERE run_id=? AND id=?').get(runId, stepId) as CreativeStepRow | undefined
    return row ? this.toCreativeOrchestrationStep(row) : undefined
  }

  updateCreativeOrchestrationStep(runId: string, stepId: string, input: UpdateCreativeOrchestrationStep): CreativeOrchestrationStep {
    const current = this.getCreativeOrchestrationStep(runId, stepId)
    if (!current) throw new Error('找不到指定创作工序。')
    const patch = UpdateCreativeOrchestrationStepSchema.parse(input)
    const now = new Date().toISOString()
    const next = CreativeOrchestrationStepSchema.parse({
      ...current,
      status: patch.status ?? current.status,
      jobId: patch.jobId === null ? undefined : patch.jobId ?? current.jobId,
      proposalId: patch.proposalId === null ? undefined : patch.proposalId ?? current.proposalId,
      memoryProposalIds: patch.memoryProposalIds ?? current.memoryProposalIds,
      error: patch.error === null ? undefined : patch.error ?? current.error,
      attempt: patch.attempt ?? current.attempt,
      startedAt: patch.startedAt === null ? undefined : patch.startedAt ?? current.startedAt,
      endedAt: patch.endedAt === null ? undefined : patch.endedAt ?? current.endedAt,
      updatedAt: now
    })
    this.sqlite.prepare('UPDATE novel_orchestration_steps SET status=?,job_id=?,proposal_id=?,memory_proposal_ids_json=?,error_json=?,attempt=?,started_at=?,ended_at=?,updated_at=? WHERE run_id=? AND id=?')
      .run(next.status, next.jobId ?? null, next.proposalId ?? null, JSON.stringify(next.memoryProposalIds), next.error ? JSON.stringify(next.error) : null, next.attempt, next.startedAt ?? null, next.endedAt ?? null, now, runId, stepId)
    return this.getCreativeOrchestrationStep(runId, stepId)!
  }

  private toCreativeOrchestrationRun(row: CreativeRunRow): CreativeOrchestrationRun {
    const steps = (this.sqlite.prepare('SELECT * FROM novel_orchestration_steps WHERE run_id=? ORDER BY step_order,id').all(row.id) as CreativeStepRow[]).map((step) => this.toCreativeOrchestrationStep(step))
    return CreativeOrchestrationRunSchema.parse({
      id: row.id, projectId: row.project_id, request: JSON.parse(row.request_json), baseRevision: row.base_revision, status: row.status,
      policy: { maxParallel: row.max_parallel, requireHumanGate: Boolean(row.require_human_gate), autoApply: Boolean(row.auto_apply) },
      warnings: JSON.parse(row.warnings_json), steps, createdAt: row.created_at,
      startedAt: row.started_at ?? undefined, endedAt: row.ended_at ?? undefined, updatedAt: row.updated_at
    })
  }

  private toCreativeOrchestrationStep(row: CreativeStepRow): CreativeOrchestrationStep {
    return CreativeOrchestrationStepSchema.parse({
      id: row.id, runId: row.run_id, order: row.step_order, seatId: row.seat_id, title: row.title, kind: row.generation_kind,
      targetId: row.target_id ?? undefined, dependsOn: JSON.parse(row.dependencies_json), status: row.status, reason: row.reason,
      evidence: JSON.parse(row.evidence_json), estimatedTokens: row.estimated_tokens, jobId: row.job_id ?? undefined,
      proposalId: row.proposal_id ?? undefined, memoryProposalIds: JSON.parse(row.memory_proposal_ids_json), error: row.error_json ? JSON.parse(row.error_json) : undefined,
      attempt: row.attempt, createdAt: row.created_at, startedAt: row.started_at ?? undefined, endedAt: row.ended_at ?? undefined, updatedAt: row.updated_at
    })
  }

  createGenerationJob(id: string, projectId: string, kind: NovelGenerationKind, estimate: NovelGenerationEstimate, request?: NovelGenerationRequest, resumeOfJobId?: string): NovelGenerationJob {
    const now = new Date().toISOString(), message = '任务已进入生成队列。'
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO novel_generation_jobs
        (id,project_id,kind,status,progress,message,estimated_input_tokens,estimated_output_tokens,context_window,warnings_json,context_entries_json,proposal_id,memory_proposal_ids_json,error_json,created_at,started_at,ended_at,updated_at,request_json,resume_of_job_id,resume_count)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, projectId, kind, '等待', 0, message, estimate.estimatedInputTokens, estimate.estimatedOutputTokens, estimate.contextWindow, JSON.stringify(estimate.warnings), JSON.stringify(estimate.entries), null, '[]', null, now, null, null, now, request ? JSON.stringify(request) : null, resumeOfJobId ?? null, resumeOfJobId ? ((this.sqlite.prepare('SELECT resume_count FROM novel_generation_jobs WHERE id=?').get(resumeOfJobId) as { resume_count: number } | undefined)?.resume_count ?? 0) + 1 : 0)
      this.insertGenerationJobEvent(id, 0, message, now)
    })()
    return this.getGenerationJob(id)!
  }

  startGenerationJob(id: string): boolean {
    const now = new Date().toISOString(), message = '正在启动生成任务…'
    return this.updateActiveGenerationJob(id, '运行中', 2, message, now, undefined, undefined, undefined, now)
  }

  appendGenerationJobProgress(id: string, progress: number, message: string): boolean {
    return this.updateActiveGenerationJob(id, '运行中', progress, message, new Date().toISOString())
  }

  completeGenerationJob(id: string, result: { proposalId?: string; memoryProposalIds?: string[] }): boolean {
    const now = new Date().toISOString(), pending = Boolean(result.proposalId || result.memoryProposalIds?.length)
    return this.updateActiveGenerationJob(id, pending ? '待确认' : '完成', 100, pending ? '生成完成，结果等待确认。' : '生成任务已完成。', now, result.proposalId, result.memoryProposalIds ?? [], undefined, undefined, now)
  }

  failGenerationJob(id: string, error: NovelGenerationJobError): boolean {
    const now = new Date().toISOString()
    return this.updateActiveGenerationJob(id, '失败', undefined, error.message, now, undefined, undefined, error, undefined, now)
  }

  cancelGenerationJob(id: string): boolean {
    const now = new Date().toISOString()
    return this.updateActiveGenerationJob(id, '取消', undefined, '任务已取消。', now, undefined, undefined, undefined, undefined, now)
  }

  getGenerationJob(id: string): NovelGenerationJob | undefined {
    const row = this.sqlite.prepare('SELECT * FROM novel_generation_jobs WHERE id=?').get(id) as GenerationJobRow | undefined
    return row ? this.toGenerationJob(row) : undefined
  }

  listGenerationJobs(projectId: string): NovelGenerationJob[] {
    return (this.sqlite.prepare('SELECT * FROM novel_generation_jobs WHERE project_id=? ORDER BY created_at DESC').all(projectId) as GenerationJobRow[]).map((row) => this.toGenerationJob(row))
  }

  listRecoverableGenerationJobs(projectId: string): NovelGenerationJob[] {
    return (this.sqlite.prepare("SELECT * FROM novel_generation_jobs WHERE project_id=? AND status='失败' AND request_json IS NOT NULL ORDER BY updated_at DESC").all(projectId) as GenerationJobRow[])
      .map((row) => this.toGenerationJob(row)).filter((job) => job.resumable)
  }

  getGenerationRequest(jobId: string): { projectId: string; request: NovelGenerationRequest } | undefined {
    const row = this.sqlite.prepare('SELECT project_id,request_json FROM novel_generation_jobs WHERE id=?').get(jobId) as { project_id: string; request_json: string | null } | undefined
    if (!row?.request_json) return undefined
    try { return { projectId: row.project_id, request: NovelGenerationRequestSchema.parse(JSON.parse(row.request_json)) } } catch { return undefined }
  }

  markGenerationProposalHandled(proposalId: string): void {
    const rows = this.sqlite.prepare("SELECT id FROM novel_generation_jobs WHERE proposal_id=? AND status='待确认'").all(proposalId) as Array<{ id: string }>
    rows.forEach((row) => this.markGenerationJobConfirmed(row.id, '生成候选已处理。'))
  }

  markMemoryProposalHandled(proposalId: string): void {
    const rows = this.sqlite.prepare("SELECT id,memory_proposal_ids_json FROM novel_generation_jobs WHERE status='待确认'").all() as Array<{ id: string; memory_proposal_ids_json: string }>
    for (const row of rows) {
      const ids = JSON.parse(row.memory_proposal_ids_json) as string[]
      if (!ids.includes(proposalId) || ids.some((id) => (this.sqlite.prepare('SELECT status FROM memory_proposals WHERE id=?').get(id) as { status: string } | undefined)?.status === '待确认')) continue
      this.markGenerationJobConfirmed(row.id, '记忆提案已全部处理。')
    }
  }

  private markGenerationJobConfirmed(id: string, message: string): void {
    const now = new Date().toISOString()
    this.sqlite.transaction(() => {
      const result = this.sqlite.prepare("UPDATE novel_generation_jobs SET status='完成',message=?,updated_at=? WHERE id=? AND status='待确认'").run(message, now, id)
      if (result.changes) this.insertGenerationJobEvent(id, 100, message, now)
    })()
  }

  private updateActiveGenerationJob(
    id: string, status: NovelGenerationJobStatus, progress: number | undefined, message: string, now: string,
    proposalId?: string, memoryProposalIds?: string[], error?: NovelGenerationJobError, startedAt?: string, endedAt?: string
  ): boolean {
    return this.sqlite.transaction(() => {
      const current = this.sqlite.prepare('SELECT progress FROM novel_generation_jobs WHERE id=? AND status IN (?,?)').get(id, '等待', '运行中') as { progress: number } | undefined
      if (!current) return false
      const nextProgress = progress ?? current.progress
      this.sqlite.prepare(`UPDATE novel_generation_jobs SET status=?,progress=?,message=?,proposal_id=COALESCE(?,proposal_id),memory_proposal_ids_json=COALESCE(?,memory_proposal_ids_json),error_json=COALESCE(?,error_json),started_at=COALESCE(started_at,?),ended_at=COALESCE(?,ended_at),updated_at=? WHERE id=?`)
        .run(status, nextProgress, message, proposalId ?? null, memoryProposalIds ? JSON.stringify(memoryProposalIds) : null, error ? JSON.stringify(error) : null, startedAt ?? null, endedAt ?? null, now, id)
      this.insertGenerationJobEvent(id, nextProgress, message, now)
      return true
    })()
  }

  private insertGenerationJobEvent(jobId: string, progress: number, message: string, createdAt: string): void {
    this.sqlite.prepare('INSERT INTO novel_generation_job_events (job_id,progress,message,created_at) VALUES (?,?,?,?)').run(jobId, progress, message, createdAt)
  }

  private toGenerationJob(row: GenerationJobRow): NovelGenerationJob {
    const events = this.sqlite.prepare('SELECT id,progress,message,created_at FROM novel_generation_job_events WHERE job_id=? ORDER BY id').all(row.id) as Array<{ id: number; progress: number; message: string; created_at: string }>
    return NovelGenerationJobSchema.parse({
      id: row.id, projectId: row.project_id, kind: row.kind, status: row.status, progress: row.progress, message: row.message,
      estimatedInputTokens: row.estimated_input_tokens, estimatedOutputTokens: row.estimated_output_tokens, contextWindow: row.context_window,
      warnings: JSON.parse(row.warnings_json), contextEntries: JSON.parse(row.context_entries_json) as NovelContextEntry[],
      proposalId: row.proposal_id ?? undefined, memoryProposalIds: JSON.parse(row.memory_proposal_ids_json), error: row.error_json ? JSON.parse(row.error_json) : undefined,
      createdAt: row.created_at, startedAt: row.started_at ?? undefined, endedAt: row.ended_at ?? undefined, updatedAt: row.updated_at,
      request: row.request_json ? JSON.parse(row.request_json) : undefined,
      resumable: Boolean(row.request_json && row.status === '失败' && (() => { try { return Boolean((JSON.parse(row.error_json ?? '{}') as { retryable?: boolean }).retryable) } catch { return false } })()),
      resumeOfJobId: row.resume_of_job_id ?? undefined, resumeCount: row.resume_count ?? 0,
      events: events.map((event) => ({ id: event.id, progress: event.progress, message: event.message, createdAt: event.created_at }))
    })
  }

  search(projectId: string, query: string, limit = 20): Array<{ sourceId: string; sourceType: string; title: string; body: string }> {
    if (!query.trim()) return []
    try {
      const sanitized = query.replace(/["']/g, ' ').trim()
      const ftsRows = this.sqlite.prepare('SELECT source_id,source_type,title,body FROM novel_search WHERE project_id=? AND novel_search MATCH ? ORDER BY bm25(novel_search) LIMIT ?').all(projectId, sanitized, limit) as any[]
      if (ftsRows.length) return ftsRows.map((row) => ({ sourceId: row.source_id, sourceType: row.source_type, title: row.title, body: row.body }))
    } catch { /* 中文短词可能无法被当前 FTS 分词器拆出，继续使用精确包含匹配。 */ }
    const like = `%${query.trim().replace(/[%_]/g, '')}%`
    return (this.sqlite.prepare('SELECT source_id,source_type,title,body FROM novel_search WHERE project_id=? AND (title LIKE ? OR body LIKE ?) ORDER BY rowid DESC LIMIT ?').all(projectId, like, like, limit) as any[]).map((row) => ({ sourceId: row.source_id, sourceType: row.source_type, title: row.title, body: row.body }))
  }

  listMentions(projectId: string, entryId?: string): EntityMention[] {
    const sql = entryId
      ? 'SELECT * FROM entity_mentions WHERE project_id=? AND entry_id=? ORDER BY chapter_number,start_offset'
      : 'SELECT * FROM entity_mentions WHERE project_id=? ORDER BY chapter_number,start_offset'
    const rows = (entryId ? this.sqlite.prepare(sql).all(projectId, entryId) : this.sqlite.prepare(sql).all(projectId)) as any[]
    return rows.map((row) => ({
      id: row.id, projectId: row.project_id, entryId: row.entry_id, entryName: row.entry_name, matchedText: row.matched_text,
      chapterId: row.chapter_id, chapterNumber: row.chapter_number, blockId: row.block_id, excerpt: row.excerpt, startOffset: row.start_offset
    }))
  }

  /**
   * 返回指定章节的五层上下文账本。账本沿用正式项目读取、时间生效和
   * FTS 索引过滤规则，仅用于解释/审计；不会写入项目正文或记忆。
   */
  contextLedger(projectId: string, chapterId?: string, tokenBudget = 60_000, includeWritingStyle = false): NovelContextLayerLedger[] {
    const project = this.getProject(projectId)
    return buildNovelContext(this, project, chapterId, Math.max(4_096, Math.floor(tokenBudget)), includeWritingStyle).layers
  }

  memoryHealth(projectId: string): NovelMemoryHealth {
    const project = this.getProject(projectId)
    const pendingProposals = (this.sqlite.prepare("SELECT count(*) count FROM memory_proposals WHERE project_id=? AND status='待确认'").get(projectId) as { count: number }).count
    const indexed = new Map((this.sqlite.prepare('SELECT chapter_id,source_digest FROM novel_indexed_chapters WHERE project_id=?').all(projectId) as Array<{ chapter_id: string; source_digest: string }>).map((row) => [row.chapter_id, row.source_digest]))
    const jobStats = this.sqlite.prepare("SELECT max(CASE WHEN status='失败' THEN ended_at END) last_failure,max(CASE WHEN status IN ('完成','待确认') THEN ended_at END) last_success FROM novel_generation_jobs WHERE project_id=?").get(projectId) as { last_failure?: string | null; last_success?: string | null }
    const activeJobs = (this.sqlite.prepare("SELECT count(*) count FROM novel_generation_jobs WHERE project_id=? AND status IN ('等待','运行中')").get(projectId) as { count: number }).count
    const failedJobs = (this.sqlite.prepare("SELECT count(*) count FROM novel_generation_jobs WHERE project_id=? AND status='失败'").get(projectId) as { count: number }).count
    const recoverableJobs = this.listRecoverableGenerationJobs(projectId).length
    const staleOutlineCards = project.outline?.volumes.reduce((count, volume) => count + volume.chapters.filter((chapter) => {
      const stale = chapterPlanStaleness(volume, chapter)
      return stale.volumeChanged || stale.outlineChanged || chapter.downstreamReviewStatus === '待复核'
    }).length, 0) ?? 0
    const pendingSceneQualityFindings = this.listRevisions(projectId).reduce((count, revision) => count + (revision.sceneQualityFindings ?? []).filter((finding) => finding.status === '待处理').length, 0)
    const pendingWorldExpansions = (project.worldExpansionProposals ?? []).filter((item) => item.status === '待确认').length
    const storylineRisks = (project.storylines ?? []).filter((line) => assessStorylineHealth(line, Math.max(1, project.chapters.at(-1)?.chapterNumber ?? 1)).breakRisk !== '低').length
    return {
      pendingProposals,
      staleMemories: project.memories.filter((item) => item.status !== '正式').length,
      missingSummaries: project.chapters.filter((chapter) => chapter.blocks.some((block) => block.text.trim()) && !project.memories.some((memory) => memory.chapterId === chapter.id && memory.status === '正式' && memory.summary.trim())).length,
      unresolvedThreads: project.plotThreads.filter((item) => !['已回收', '已放弃'].includes(item.status)).length,
      overdueThreads: project.plotThreads.filter((item) => item.status === '逾期').length,
      unindexedChapters: project.chapters.filter((chapter) => indexed.get(chapter.id) !== chapter.sourceDigest).length,
      indexedMentions: (this.sqlite.prepare('SELECT count(*) count FROM entity_mentions WHERE project_id=?').get(projectId) as { count: number }).count,
      unresolvedReviews: project.reviews.filter((review) => review.status === '待处理').length,
      staleOutlineCards,
      pendingSceneQualityFindings,
      pendingWorldExpansions,
      storylineRisks,
      activeJobs, failedJobs, recoverableJobs,
      lastFailureAt: jobStats.last_failure ?? undefined,
      lastSuccessAt: jobStats.last_success ?? undefined
    }
  }

  saveGenerationCheckpoint(projectId: string, kind: string, targetId: string, step: number, payload: unknown): void {
    this.sqlite.prepare('INSERT INTO novel_generation_checkpoints (project_id,kind,target_id,step,payload_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,kind,target_id) DO UPDATE SET step=excluded.step,payload_json=excluded.payload_json,updated_at=excluded.updated_at')
      .run(projectId, kind, targetId, step, JSON.stringify(payload), new Date().toISOString())
  }

  getGenerationCheckpoint<T>(projectId: string, kind: string, targetId: string): { step: number; payload: T } | undefined {
    const row = this.sqlite.prepare('SELECT step,payload_json FROM novel_generation_checkpoints WHERE project_id=? AND kind=? AND target_id=?').get(projectId, kind, targetId) as { step: number; payload_json: string } | undefined
    return row ? { step: row.step, payload: JSON.parse(row.payload_json) as T } : undefined
  }

  clearGenerationCheckpoint(projectId: string, kind: string, targetId: string): void {
    this.sqlite.prepare('DELETE FROM novel_generation_checkpoints WHERE project_id=? AND kind=? AND target_id=?').run(projectId, kind, targetId)
  }

  private reindex(project: NovelProject): void {
    const insert = this.sqlite.prepare('INSERT INTO novel_search (project_id,source_id,source_type,title,body) VALUES (?,?,?,?,?)')
    const insertMention = this.sqlite.prepare('INSERT INTO entity_mentions (id,project_id,entry_id,entry_name,matched_text,chapter_id,chapter_number,block_id,excerpt,start_offset) VALUES (?,?,?,?,?,?,?,?,?,?)')
    const insertIndexed = this.sqlite.prepare('INSERT INTO novel_indexed_chapters (project_id,chapter_id,source_digest) VALUES (?,?,?)')
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM novel_search WHERE project_id=?').run(project.id)
      this.sqlite.prepare('DELETE FROM entity_mentions WHERE project_id=?').run(project.id)
      this.sqlite.prepare('DELETE FROM novel_indexed_chapters WHERE project_id=?').run(project.id)
      for (const entry of project.worldBible?.entries ?? []) insert.run(project.id, entry.id, 'world', entry.name, `${entry.aliases.join(' ')} ${entry.tags.join(' ')} ${entry.summary} ${entry.notes} ${JSON.stringify(entry.details)}`)
      for (const chapter of project.chapters) {
        insert.run(project.id, chapter.id, 'chapter', `第${chapter.chapterNumber}章 ${chapter.title}`, chapterText(chapter))
        insertIndexed.run(project.id, chapter.id, chapter.sourceDigest)
        for (const entry of project.worldBible?.entries ?? []) {
          const terms = [...new Set([entry.name, ...entry.aliases].map((term) => term.trim()).filter(Boolean))]
          for (const block of chapter.blocks) {
            for (const term of terms) {
              let offset = block.text.indexOf(term)
              while (offset >= 0) {
                const start = Math.max(0, offset - 36), end = Math.min(block.text.length, offset + term.length + 52)
                const id = createHash('sha256').update(`${project.id}\0${entry.id}\0${chapter.id}\0${block.id}\0${offset}\0${term}`).digest('hex')
                insertMention.run(id, project.id, entry.id, entry.name, term, chapter.id, chapter.chapterNumber, block.id, block.text.slice(start, end), offset)
                offset = block.text.indexOf(term, offset + Math.max(1, term.length))
              }
            }
          }
        }
      }
      for (const memory of project.memories) insert.run(project.id, memory.chapterId, 'memory', `第${memory.chapterNumber}章记忆`, `${memory.summary} ${memory.keyEvents.join(' ')} ${JSON.stringify(memory.facts)}`)
      for (const thread of project.plotThreads) insert.run(project.id, thread.id, 'thread', thread.title, `${thread.detail} ${thread.setupMethod} ${thread.resolutionMethod}`)
    })
    transaction()
  }

  private invalidatePending(project: NovelProject): void {
    const current = this.listMemoryProposals(project.id, true)
    this.saveMemoryProposals(invalidateMemoryProposals(current, project))
  }

  saveProvider(input: { id?: string; name: string; baseUrl: string; model: string; contextWindow: number; maxOutputTokens?: number; outputTokenParameter?: 'auto' | 'max_completion_tokens' | 'max_tokens'; supportsStreaming: boolean; supportsJsonSchema: boolean; hasApiKey: boolean }): ProviderConfigPublic {
    const now = new Date().toISOString(), id = input.id ?? randomUUID()
    const existing = this.sqlite.prepare('SELECT created_at FROM providers WHERE id=?').get(id) as { created_at: string } | undefined
    this.sqlite.prepare("INSERT INTO providers (id,name,base_url,model,context_window,max_output_tokens,output_token_parameter,supports_streaming,supports_json_schema,encrypted_api_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,model=excluded.model,context_window=excluded.context_window,max_output_tokens=excluded.max_output_tokens,output_token_parameter=excluded.output_token_parameter,supports_streaming=excluded.supports_streaming,supports_json_schema=excluded.supports_json_schema,encrypted_api_key=excluded.encrypted_api_key,updated_at=excluded.updated_at").run(id, input.name, input.baseUrl.replace(/\/$/, ''), input.model, input.contextWindow, input.maxOutputTokens ?? null, input.outputTokenParameter ?? 'auto', Number(input.supportsStreaming), Number(input.supportsJsonSchema), input.hasApiKey ? SECRET_STORE_MARKER : '', existing?.created_at ?? now, now)
    return this.getProvider(id)!
  }
  listProviders(): ProviderConfigPublic[] { return (this.sqlite.prepare('SELECT * FROM providers ORDER BY updated_at DESC').all() as any[]).map(toProvider) }
  getProvider(id?: string): ProviderConfigPublic | undefined { const row = (id ? this.sqlite.prepare('SELECT * FROM providers WHERE id=?').get(id) : this.sqlite.prepare('SELECT * FROM providers ORDER BY updated_at DESC LIMIT 1').get()) as any; return row ? toProvider(row) : undefined }
  insertProviderOutputTest(input: Omit<ProviderOutputTestRecord, 'id' | 'stale' | 'staleReason'> & { id?: string }): ProviderOutputTestRecord {
    const record = ProviderOutputTestRecordSchema.parse({ ...input, id: input.id ?? randomUUID(), stale: false })
    this.sqlite.prepare(`INSERT INTO provider_output_tests
      (id,provider_id,provider_name,model,base_url,context_window,output_token_parameter,supports_streaming,supports_json_schema,test_mode,target_output_tokens,output_tokens,finish_reason,ok,message,latency_ms,config_digest,tested_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      record.id, record.providerId ?? null, record.providerName, record.model, record.baseUrl, record.contextWindow,
      record.outputTokenParameter, Number(record.supportsStreaming), Number(record.supportsJsonSchema), record.testMode,
      record.targetOutputTokens, record.outputTokens ?? null, record.finishReason ?? null, Number(record.ok), record.message,
      record.latencyMs ?? null, record.configDigest, record.testedAt, record.expiresAt
    )
    return record
  }
  listProviderOutputTests(providerId?: string, limit = 30): ProviderOutputTestRecord[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)))
    const rows = providerId
      ? this.sqlite.prepare('SELECT * FROM provider_output_tests WHERE provider_id=? ORDER BY tested_at DESC LIMIT ?').all(providerId, safeLimit)
      : this.sqlite.prepare('SELECT * FROM provider_output_tests ORDER BY tested_at DESC LIMIT ?').all(safeLimit)
    return (rows as any[]).map((row) => ProviderOutputTestRecordSchema.parse({
      id: row.id, providerId: row.provider_id ?? undefined, providerName: row.provider_name, model: row.model,
      baseUrl: row.base_url, contextWindow: row.context_window, outputTokenParameter: row.output_token_parameter,
      supportsStreaming: Boolean(row.supports_streaming), supportsJsonSchema: Boolean(row.supports_json_schema),
      testMode: row.test_mode, targetOutputTokens: row.target_output_tokens, outputTokens: row.output_tokens ?? undefined,
      finishReason: row.finish_reason ?? undefined, ok: Boolean(row.ok), message: row.message, latencyMs: row.latency_ms ?? undefined,
      configDigest: row.config_digest, testedAt: row.tested_at, expiresAt: row.expires_at, stale: false
    }))
  }
  insertUsage(input: Omit<AiUsageRecord, 'id' | 'createdAt'>): AiUsageRecord { const record = AiUsageRecordSchema.parse({ ...input, id: randomUUID(), createdAt: new Date().toISOString() }); this.sqlite.prepare('INSERT INTO ai_usage VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(record.id, record.projectId ?? null, record.episodeNumber ?? null, record.providerId, record.model, record.operation, record.inputTokens, record.outputTokens, record.estimatedCost ?? null, record.currency, record.status, record.retryCount, Number(record.costKnown), record.createdAt); return record }
  listUsage(): AiUsageRecord[] { return (this.sqlite.prepare('SELECT * FROM ai_usage ORDER BY created_at DESC').all() as any[]).map((row) => AiUsageRecordSchema.parse({ id: row.id, projectId: row.project_id ?? undefined, episodeNumber: row.episode_number ?? undefined, providerId: row.provider_id, model: row.model, operation: row.operation, inputTokens: row.input_tokens, outputTokens: row.output_tokens, estimatedCost: row.estimated_cost ?? undefined, currency: row.currency, status: row.status, retryCount: row.retry_count, costKnown: Boolean(row.cost_known), createdAt: row.created_at })) }
  close(): void { this.sqlite.close() }
}

function toProvider(row: any): ProviderConfigPublic {
  return { id: row.id, name: row.name, baseUrl: row.base_url, model: row.model, contextWindow: row.context_window, maxOutputTokens: row.max_output_tokens ?? undefined, outputTokenParameter: row.output_token_parameter ?? 'auto', supportsStreaming: Boolean(row.supports_streaming), supportsJsonSchema: Boolean(row.supports_json_schema), currency: 'CNY', showCost: false, hasApiKey: row.encrypted_api_key === SECRET_STORE_MARKER }
}

interface GenerationJobRow {
  id: string; project_id: string; kind: string; status: string; progress: number; message: string
  estimated_input_tokens: number; estimated_output_tokens: number; context_window: number
  warnings_json: string; context_entries_json: string; proposal_id: string | null; memory_proposal_ids_json: string
  error_json: string | null; created_at: string; started_at: string | null; ended_at: string | null; updated_at: string
  request_json: string | null; resume_of_job_id: string | null; resume_count: number
}

interface AssistantGuideSessionRow {
  id: string; project_id: string; domain: string; scope_key: string; version: number; status: string
  context_digest: string; active: number; data_json: string; created_at: string; updated_at: string
}

interface CreativeSeatConfigRow {
  project_id: string; seat_id: string; enabled: number; provider_id: string | null; capability_ids_json: string; updated_at: string
}

interface CreativeRunRow {
  id: string; project_id: string; request_json: string; base_revision: number; status: string
  max_parallel: number; require_human_gate: number; auto_apply: number; warnings_json: string
  created_at: string; started_at: string | null; ended_at: string | null; updated_at: string
}

interface CreativeStepRow {
  id: string; run_id: string; step_order: number; seat_id: string; title: string; generation_kind: string; target_id: string | null
  dependencies_json: string; status: string; reason: string; evidence_json: string; estimated_tokens: number
  job_id: string | null; proposal_id: string | null; memory_proposal_ids_json: string; error_json: string | null; attempt: number
  created_at: string; started_at: string | null; ended_at: string | null; updated_at: string
}
