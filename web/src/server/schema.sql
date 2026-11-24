-- web/src/server/schema.sql
-- NooShare Research Workbench · cases schema DDL（P0）
-- 边界：仅写 cases schema；research / iwen / ju / public / annual_semi 上游只读。
-- 本文件由 seed-fixtures.ts 以 sql.file() 幂等执行（全部 IF NOT EXISTS / OR REPLACE）。

CREATE SCHEMA IF NOT EXISTS cases;

-- 1. 研究案例主表（"case" 为 SQL 保留字，SQL 中必须带引号引用）
CREATE TABLE IF NOT EXISTS cases."case" (
  case_id               text PRIMARY KEY,            -- C-1001 格式；FIXTURE 统一 C-F 前缀
  title                 text NOT NULL,               -- 短标题（列表展示）
  research_question     text NOT NULL,               -- 研究问题全文
  research_time_t       timestamptz NOT NULL,        -- T 时点（研究截面锚点）
  info_cutoff           timestamptz NOT NULL,        -- 信息截止；应用层约束 info_cutoff <= research_time_t
  status                text NOT NULL DEFAULT 'candidate'
                        CHECK (status IN ('candidate','researching','reviewing','frozen','observing','completed','rejected','blocked')),
  trigger_discovery_ref jsonb,                       -- 触发热点引用 {source, subjectType, subjectKey, themeId?, themeName?, episodeRef?}
  episode_refs          text[] NOT NULL DEFAULT '{}',-- 关联 Episode ID
  themes                text[] NOT NULL DEFAULT '{}',-- 标准化主题名（列表筛选用）
  is_fixture            boolean NOT NULL DEFAULT true, -- P0 种子数据为 fixture；Discovery 真实创建的候选 Case 为 false
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 2. 案例修订版本（冻结后不可变）
CREATE TABLE IF NOT EXISTS cases.case_revision (
  revision_id    text PRIMARY KEY,                   -- 形如 C-1042-R2
  case_id        text NOT NULL REFERENCES cases."case"(case_id) ON DELETE CASCADE,
  revision_no    integer NOT NULL,
  input_manifest jsonb NOT NULL DEFAULT '{}',        -- 输入清单：证据源 / 原始片段 / 口径
  judgment       jsonb NOT NULL DEFAULT '{}',        -- 判断：假设 / 主结论 / 反方意见 / 反证 / 未解决问题 / 适用边界
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','reviewing','frozen')),
  frozen_at      timestamptz,
  created_by     text NOT NULL DEFAULT 'agent' CHECK (created_by IN ('agent','reviewer')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, revision_no)
);

-- Frozen Revision 不可变：DB 层兜底（API 层同样拒绝，两层防线）
CREATE OR REPLACE FUNCTION cases.reject_frozen_revision_update() RETURNS trigger AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'revision % is frozen and immutable', OLD.revision_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_frozen_revision_immutable ON cases.case_revision;
CREATE TRIGGER trg_frozen_revision_immutable
  BEFORE UPDATE ON cases.case_revision
  FOR EACH ROW EXECUTE FUNCTION cases.reject_frozen_revision_update();

-- 3. 企业参与样本（七类角色，data-facts §3）
CREATE TABLE IF NOT EXISTS cases.company_participation (
  case_id                text NOT NULL REFERENCES cases."case"(case_id) ON DELETE CASCADE,
  stock_code             text NOT NULL,              -- 裸代码，同上游 ju.stocks
  company_name           text NOT NULL,
  role                   text NOT NULL CHECK (role IN ('seed','directly_related','similar','potential_beneficiary','non_responder','counterexample','excluded')),
  rationale              text NOT NULL DEFAULT '',   -- 纳入理由
  evidence_refs          jsonb NOT NULL DEFAULT '[]',-- 引用 evidence_reference.evidence_id 数组
  market_response_status text,                       -- 可选：市场反应标记
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, stock_code)
);

-- 4. 证据引用（PIT 状态四态，刻意避开市场红绿语义）
CREATE TABLE IF NOT EXISTS cases.evidence_reference (
  evidence_id     text PRIMARY KEY,                  -- E-...
  case_id         text NOT NULL REFERENCES cases."case"(case_id) ON DELETE CASCADE,
  revision_id     text REFERENCES cases.case_revision(revision_id) ON DELETE SET NULL,
  upstream_type   text NOT NULL CHECK (upstream_type IN ('document','frame','business_fact','market_observation','other')),
  upstream_id     text NOT NULL,                     -- 上游系统对象 ID
  version_ref     text,                              -- 版本引用（可空）
  locator         text NOT NULL,                     -- 定位符：路径 / URL / 页码锚点（mono 展示）
  summary         text NOT NULL DEFAULT '',          -- 摘要
  published_at    timestamptz,                       -- 可空 = 公开时间未知
  availability_at timestamptz,                       -- 可空 = 获取时间未知
  pit_status      text NOT NULL DEFAULT 'unverified' CHECK (pit_status IN ('verified','unverified','unresolved','unavailable')),
  pit_note        text,                              -- 时间约束一句话说明
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 5. 人工审核记录（三操作：approve / request_changes / reject）
CREATE TABLE IF NOT EXISTS cases.review_record (
  review_id   text PRIMARY KEY,                      -- RV-...
  case_id     text NOT NULL REFERENCES cases."case"(case_id) ON DELETE CASCADE,
  revision_id text NOT NULL REFERENCES cases.case_revision(revision_id) ON DELETE CASCADE,
  decision    text NOT NULL CHECK (decision IN ('approve','request_changes','reject')),
  reason      text NOT NULL DEFAULT '',              -- 必填意见 / 原因（应用层校验非空）
  categories  text[] NOT NULL DEFAULT '{}',          -- 证据不足 / 企业样本问题 / 时间约束未验证
  reviewer    text NOT NULL DEFAULT 'human',
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 6. 观察追加（Frozen 后唯一允许的写入路径）
CREATE TABLE IF NOT EXISTS cases.observation (
  observation_id text PRIMARY KEY,                   -- OB-...
  case_id        text NOT NULL REFERENCES cases."case"(case_id) ON DELETE CASCADE,
  revision_id    text REFERENCES cases.case_revision(revision_id) ON DELETE SET NULL,
  window_start   timestamptz NOT NULL,               -- 观察窗口起
  window_end     timestamptz NOT NULL,               -- 观察窗口止
  outcome        text NOT NULL CHECK (outcome IN ('support','oppose','mixed','no_change','indeterminate')),
  content        text NOT NULL,
  refs           jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 7. Agent 运行记录（P0 为 seed 静态数据，无真实执行引擎）
CREATE TABLE IF NOT EXISTS cases.agent_run (
  run_id          text PRIMARY KEY,                  -- RUN-...
  run_type        text NOT NULL,                     -- 任务类型，如 daily_discovery / episode_matching
  date_scope      jsonb NOT NULL DEFAULT '{}',       -- {start, end} 研究日期范围
  stage           text NOT NULL DEFAULT 'discovery', -- 7 阶段之一或聚合状态
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  processed_count integer NOT NULL DEFAULT 0,
  success_count   integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  outputs         jsonb NOT NULL DEFAULT '{}',
  error           text,
  retryable       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 8. Discovery 人类校准动作（跳过 / 撤销）——Discovery 队列 Agent 状态推导的数据源之一
CREATE TABLE IF NOT EXISTS cases.discovery_action (
  action_id    text PRIMARY KEY,                     -- DA-...
  subject_type text NOT NULL CHECK (subject_type IN ('theme','fragment')),
  subject_key  text NOT NULL,                        -- theme_id 或 normalized_fragment
  action       text NOT NULL CHECK (action IN ('skip','restore')),
  reason       text,                                 -- 热度不足 / 已研究过 / 超出能力范围 / 其他
  note         text,
  created_by   text NOT NULL DEFAULT 'human',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_case_status              ON cases."case"(status);
CREATE INDEX IF NOT EXISTS idx_case_updated             ON cases."case"(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_trigger_gin         ON cases."case" USING gin(trigger_discovery_ref);
CREATE INDEX IF NOT EXISTS idx_revision_case            ON cases.case_revision(case_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_case            ON cases.evidence_reference(case_id);
CREATE INDEX IF NOT EXISTS idx_review_case              ON cases.review_record(case_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_observation_case         ON cases.observation(case_id, window_start DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_status         ON cases.agent_run(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_action_subject ON cases.discovery_action(subject_type, subject_key, created_at DESC);
