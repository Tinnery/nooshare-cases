// web/src/server/seed-fixtures.ts
// FIXTURE 种子脚本（幂等，可重复执行）：bun run src/server/seed-fixtures.ts
// 职责：建 cases schema（执行 schema.sql）→ 插入 3 个 FIXTURE Case + 企业样本 / 证据 / 审核 / 观察 / Agent Run。
// 约束：所有 fixture case_id 以 C-F 开头；仅写 cases schema。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  // 1. 幂等建表（schema.sql 全部 IF NOT EXISTS / OR REPLACE）
  await sql.file(path.join(here, "schema.sql"));
  console.log("[seed] cases schema 就绪");

  // 2. Case 主表（三个状态：researching / reviewing / observing（含 frozen revision））
  await sql`
    INSERT INTO cases."case"
      (case_id, title, research_question, research_time_t, info_cutoff, status,
       trigger_discovery_ref, episode_refs, themes, is_fixture)
    VALUES
      ('C-F1001',
       '人形机器人谐波减速器国产替代验证',
       '以 2024-06-14 为研究截面，检验"人形机器人量产预期带动谐波减速器国产厂商订单前置"这一假设：国产减速器厂商在头部人形机器人厂商供应链中的验证进度、份额与业绩弹性是否已被市场定价，定价是否存在时间上的错位。',
       '2024-06-14 15:00:00+08', '2024-06-14 00:00:00+08', 'researching',
       ${sql.json({ source: 'discovery', subjectType: 'theme', subjectKey: '人形机器人', themeName: '人形机器人', episodeRef: '88119d49237e1114' })},
       ${['88119d49237e1114']},
       ${['人形机器人', '减速器']},
       true),
      ('C-F1002',
       '固态电池装车节奏与电解质路线弹性',
       '检验"2024-2025 年半固态电池在高端车型小批量装车、全固态仍处中试阶段"的判断：氧化物与硫化物两条电解质路线的产业化顺序，以及材料端标的的业绩兑现节奏是否被映射行情高估。',
       '2024-04-26 15:00:00+08', '2024-04-26 00:00:00+08', 'reviewing',
       ${sql.json({ source: 'discovery', subjectType: 'theme', subjectKey: '固态电池', themeName: '固态电池', episodeRef: '0a8250d32513b2c1' })},
       ${['0a8250d32513b2c1']},
       ${['固态电池']},
       true),
      ('C-F1003',
       'ST 重整标的摘帽概率与联动结构',
       '以重整计划执行进度为核心变量，检验"重整执行完毕的 ST 标的摘帽概率显著高于市场隐含定价"：对照组需包含重整失败退市样本，验证市场联动炒作中反例的可识别性。',
       '2024-02-20 15:00:00+08', '2024-02-20 00:00:00+08', 'observing',
       ${sql.json({ source: 'discovery', subjectType: 'theme', subjectKey: '重整', themeName: '重整', episodeRef: '621e4477c7f33b79' })},
       ${['621e4477c7f33b79']},
       ${['重整', 'ST板块']},
       true)
    ON CONFLICT (case_id) DO NOTHING
  `;
  console.log("[seed] case 主表：3 条 fixture");

  // 3. Case Revision（C-F1003 为三版演进：R1/R2 被退回，R3 已冻结）
  await sql`
    INSERT INTO cases.case_revision
      (revision_id, case_id, revision_no, input_manifest, judgment, status, frozen_at, created_by)
    VALUES
      -- C-F1001 R1：研究中的草稿，判断未成形
      ('C-F1001-R1', 'C-F1001', 1,
       ${sql.json({
         info_cutoff: '2024-06-14 00:00:00+08',
         sources: [
           { upstream_type: 'document', ref: '绿的谐波 2023 年年度报告（巨潮资讯）' },
           { upstream_type: 'document', ref: '中大力德 2024-06-11 减速器产能扩充公告' },
           { upstream_type: 'market_observation', ref: 'research.market_limit_up_observation 2024-06 减速器板块涨停序列' }
         ],
         fragments: ['人形机器人量产', '减速器送样验证', '谐波减速器国产化'],
         scope_note: '仅覆盖 A 股上市公司，未覆盖非上市减速器厂商'
       })},
       ${sql.json({
         hypotheses: [
           { text: '头部人形机器人厂商 2024 下半年进入小批量量产，减速器订单前置 1-2 个季度', status: 'under_test' },
           { text: '国产谐波减速器在验证进度上领先行星减速器厂商', status: 'under_test' }
         ],
         conclusion: null,
         counterarguments: [],
         counter_evidence: [],
         open_questions: ['送样验证到批量订单的真实转化周期', '客户集中度与议价能力'],
         applicability: '仅适用于 T 截面前公开信息'
       })},
       'draft', null, 'agent'),
      -- C-F1002 R1：历史草稿（被退回）
      ('C-F1002-R1', 'C-F1002', 1,
       ${sql.json({
         info_cutoff: '2024-04-26 00:00:00+08',
         sources: [{ upstream_type: 'document', ref: '某车企 2024-04-08 半固态车型发布通稿（媒体转载）' }],
         fragments: ['固态电池装车', '氧化物电解质中试'],
         scope_note: '初版仅依赖媒体来源，后补公告与销量口径'
       })},
       ${sql.json({
         hypotheses: [{ text: '半固态 2024 年即可规模上车', status: 'weakened' }],
         conclusion: null,
         counterarguments: ['装车 ≠ 供应商业绩兑现，需区分演示与量产'],
         counter_evidence: [],
         open_questions: [],
         applicability: ''
       })},
       'draft', null, 'agent'),
      -- C-F1002 R2：待人工审核
      ('C-F1002-R2', 'C-F1002', 2,
       ${sql.json({
         info_cutoff: '2024-04-26 00:00:00+08',
         sources: [
           { upstream_type: 'document', ref: '清陶能源增资公告（巨潮资讯 2024-04）' },
           { upstream_type: 'business_fact', ref: '上汽集团智己 L6 半固态版本销量月度口径' },
           { upstream_type: 'document', ref: '当升科技 2023 年报固态电解质产能段落' }
         ],
         fragments: ['固态电池装车', '氧化物电解质', '半固态量产车型'],
         scope_note: '区分"装车演示"与"批量交付"两种口径'
       })},
       ${sql.json({
         hypotheses: [
           { text: '2024 年国内半固态电池仅在高端车型小批量装车，全固态仍处中试阶段', status: 'supported' },
           { text: '氧化物路线的落地上量节奏快于硫化物', status: 'supported' },
           { text: '材料端标的当期业绩弹性有限，行情以映射为主', status: 'supported' }
         ],
         conclusion: '半固态 2024-2025 为小规模导入期，材料端标的当期业绩弹性有限；相关标的上涨主要为映射行情而非订单兑现，需以月度装车量数据持续校验。',
         counterarguments: [
           '若全固态中试进度超预期（硫化物突破），映射行情可能提前定价',
           '半固态与液态产线兼容性高的厂商可能获得超预期转产订单'
         ],
         counter_evidence: [
           { ref: 'E-F1002-03', note: '氧化物中试良率数据尚未公开，属未解决问题' }
         ],
         open_questions: ['全固态中试线的实际良率', '2025 年半固态装机量的第三方口径'],
         applicability: '仅适用于 2024-04-26 前公开信息截面，装车量口径以整车厂月度交付为准'
       })},
       'reviewing', null, 'agent'),
      -- C-F1003 R1 / R2：历史草稿（先后被退回）
      ('C-F1003-R1', 'C-F1003', 1,
       ${sql.json({
         info_cutoff: '2024-02-20 00:00:00+08',
         sources: [{ upstream_type: 'document', ref: '法院裁定受理重整公告汇总（2023 Q3-Q4）' }],
         fragments: ['重整计划执行', 'ST摘帽预期'],
         scope_note: '初版样本缺少退市对照'
       })},
       ${sql.json({
         hypotheses: [{ text: '重整执行完毕的 ST 标的摘帽概率高于市场定价', status: 'under_test' }],
         conclusion: null, counterarguments: [], counter_evidence: [],
         open_questions: [], applicability: ''
       })},
       'draft', null, 'agent'),
      ('C-F1003-R2', 'C-F1003', 2,
       ${sql.json({
         info_cutoff: '2024-02-20 00:00:00+08',
         sources: [
           { upstream_type: 'document', ref: '金一文化重整计划执行完毕公告' },
           { upstream_type: 'document', ref: '*ST博天终止上市决定（反面对照）' }
         ],
         fragments: ['重整计划执行', 'ST摘帽预期', '退市整理期'],
         scope_note: '补充退市对照样本；需校验受理时间与信息截止的先后'
       })},
       ${sql.json({
         hypotheses: [{ text: '重整执行完毕且债权清偿率合理的标的摘帽概率显著更高', status: 'supported' }],
         conclusion: null,
         counterarguments: ['退市对照样本的时间窗口与重整受理时间存在错位，需校验'],
         counter_evidence: [],
         open_questions: ['受理日晚于信息截止的样本是否可比'],
         applicability: ''
       })},
       'draft', null, 'agent'),
      -- C-F1003 R3：已冻结（不可变）
      ('C-F1003-R3', 'C-F1003', 3,
       ${sql.json({
         info_cutoff: '2024-02-20 00:00:00+08',
         sources: [
           { upstream_type: 'document', ref: '金一文化重整计划执行完毕公告（2023-12）' },
           { upstream_type: 'document', ref: '*ST博天终止上市决定（2023-12，反面对照）' },
           { upstream_type: 'market_observation', ref: 'research.market_limit_up_observation 2024-02 ST板块涨停序列' },
           { upstream_type: 'business_fact', ref: '交易所摘帽规则适用口径（上市规则第 9 章）' }
         ],
         fragments: ['重整计划执行', 'ST摘帽预期', '退市整理期', '撤销其他风险警示'],
         scope_note: '受理日晚于信息截止的样本已剔除；反例保留完整'
       })},
       ${sql.json({
         hypotheses: [
           { text: '重整执行完毕且债权清偿率合理的 ST 标的，摘帽概率显著高于市场隐含定价', status: 'supported' },
           { text: '市场联动炒作对"重整概念"不区分执行进度，反例（退市）与正例同步上涨', status: 'supported' }
         ],
         conclusion: '重整概念联动行情不区分执行进度与摘帽可行性；执行完毕+清偿率合理是摘帽的核心可观测前置变量。该结论在样本内成立，样本外需按季度校验。',
         counterarguments: [
           '样本量小（重整执行完毕案例有限），统计显著性有限',
           '监管口径变化（如退市新规）可能改变摘帽概率分布'
         ],
         counter_evidence: [
           { ref: 'E-F1003-04', note: 'ST华仪 2023-07 收到终止上市决定，属退市新规过渡期，对照有效性存疑' }
         ],
         open_questions: ['2024 年退市新规对摘帽节奏的影响', '清偿率数据的可获得性'],
         applicability: '仅适用于 2024-02-20 前公开信息截面；不适用于已完成退市新规切换后的 ST 定价'
       })},
       'frozen', '2024-02-22 10:14:00+08', 'agent')
    ON CONFLICT (revision_id) DO NOTHING
  `;
  console.log("[seed] case_revision：6 条 fixture");

  // 4. 企业参与样本（七类角色全覆盖）
  await sql`
    INSERT INTO cases.company_participation
      (case_id, stock_code, company_name, role, rationale, evidence_refs, market_response_status)
    VALUES
      -- C-F1001：人形机器人减速器
      ('C-F1001', '002668', '中大力德', 'seed', '谐波减速器+RV 减速器双布局，2024-06 公告扩产，直接对应研究问题', ${sql.json(['E-F1001-01'])}, 'confirm'),
      ('C-F1001', '688017', '绿的谐波', 'directly_related', '国产谐波减速器龙头，人形机器人供应链验证进度最靠前', ${sql.json(['E-F1001-02'])}, null),
      ('C-F1001', '002472', '双环传动', 'similar', 'RV 减速器与精密齿轮同源工艺，作为替代路线对照', ${sql.json([])}, null),
      ('C-F1001', '603915', '国茂股份', 'potential_beneficiary', '通用减速器平台具备谐波产品线延伸可能，受益逻辑为衍生预期', ${sql.json([])}, null),
      -- C-F1002：固态电池
      ('C-F1002', '603200', '上海洗霸', 'seed', '固态电解质粉体材料布局，映射行情核心标的', ${sql.json(['E-F1002-01'])}, 'confirm'),
      ('C-F1002', '300073', '当升科技', 'directly_related', '正极材料+固态电解质双布局，年报披露产能口径可锚定', ${sql.json(['E-F1002-02'])}, null),
      ('C-F1002', '688005', '容百科技', 'similar', '高镍正极同源产线，固态适配进度可比', ${sql.json([])}, null),
      ('C-F1002', '002709', '天赐材料', 'non_responder', '液态电解液龙头，固态替代逻辑下为受损方，检验"不反应"假设', ${sql.json([])}, 'null_response'),
      -- C-F1003：ST 重整
      ('C-F1003', '002721', 'ST金一', 'seed', '重整计划 2023-12 执行完毕，摘帽预期直接对应研究问题', ${sql.json(['E-F1003-01'])}, 'confirm'),
      ('C-F1003', '002610', 'ST爱康', 'directly_related', '同为"困境反转"联动标的，观察其跟随反应', ${sql.json([])}, 'confirm'),
      ('C-F1003', '603903', '*ST博天', 'counterexample', '重整失败于 2023-12 终止上市，为研究问题的反面样本（必须保留，不得隐藏）', ${sql.json(['E-F1003-03'])}, null),
      ('C-F1003', '600290', 'ST华仪', 'excluded', '2023-07 已收到终止上市决定，重整受理日晚于信息截止，程序性排除', ${sql.json(['E-F1003-04'])}, null)
    ON CONFLICT (case_id, stock_code) DO NOTHING
  `;
  console.log("[seed] company_participation：12 条（七类角色全覆盖）");

  // 5. 证据引用（verified / unverified / unresolved / unavailable 四态全覆盖）
  await sql`
    INSERT INTO cases.evidence_reference
      (evidence_id, case_id, revision_id, upstream_type, upstream_id, version_ref,
       locator, summary, published_at, availability_at, pit_status, pit_note)
    VALUES
      ('E-F1001-01', 'C-F1001', 'C-F1001-R1', 'document', 'CNINFO-002668-20240611', '20240611',
       'cninfo.com.cn/announcement/002668/20240611 · p1',
       '中大力德减速器扩产公告：新建谐波减速器产线年产能口径',
       '2024-06-11 18:32:00+08', '2024-06-12 09:10:00+08', 'verified',
       '公开于 T-3，满足 T 截面约束'),
      ('E-F1001-02', 'C-F1001', 'C-F1001-R1', 'document', 'ANNUAL-688017-2023', 'FY2023',
       'cninfo.com.cn/annual/688017/2023 · §3.2 · R128',
       '绿的谐波 2023 年报：人形机器人客户送样验证进度表述',
       '2024-04-19 16:00:00+08', '2024-04-20 10:00:00+08', 'verified',
       '公开于 T 前 2 个月，满足截面约束'),
      ('E-F1001-03', 'C-F1001', 'C-F1001-R1', 'business_fact', 'WC-20240614-减速器送样', null,
       'src/wencai/20240614_涨停.xlsx · p1 · R42',
       '问财观察：2024-06-14 减速器板块涨停序列（原始原因片段）',
       null, '2024-06-14 07:00:00+08', 'unverified',
       '问财数据源无公开时间戳，公开时间未知，待人工核验'),
      ('E-F1002-01', 'C-F1002', 'C-F1002-R2', 'document', 'CNINFO-603200-202404', '202404',
       'cninfo.com.cn/announcement/603200/202404 · p2',
       '上海洗霸固态电解质粉体中试线进度披露',
       '2024-04-08 19:00:00+08', '2024-04-09 08:30:00+08', 'verified',
       '公开于 T-18，满足截面约束'),
      ('E-F1002-02', 'C-F1002', 'C-F1002-R2', 'document', 'ANNUAL-300073-2023', 'FY2023',
       'cninfo.com.cn/annual/300073/2023 · §4.1',
       '当升科技 2023 年报：固态电解质中试产能与客户送样表述',
       '2024-04-10 16:00:00+08', '2024-04-11 09:00:00+08', 'verified',
       '公开于 T-16，满足截面约束'),
      ('E-F1002-03', 'C-F1002', 'C-F1002-R2', 'business_fact', 'NEV-SALES-202405', null,
       'marklines.com/nev_monthly/2024-05 · 智己 L6 半固态版销量口径',
       '智己 L6 半固态版本 5 月销量（第三方口径）',
       null, null, 'unresolved',
       '第三方销量口径与车企口径存在出入，待对账'),
      ('E-F1003-01', 'C-F1003', 'C-F1003-R3', 'document', 'CNINFO-002721-202312', '202312',
       'cninfo.com.cn/announcement/002721/202312 · p1',
       '金一文化重整计划执行完毕公告',
       '2023-12-21 17:00:00+08', '2023-12-22 09:00:00+08', 'verified',
       '公开于 T 前 2 个月，满足截面约束'),
      ('E-F1003-02', 'C-F1003', 'C-F1003-R3', 'document', 'MEDIA-ST-202402', null,
       'eastmoney.com/news/202402/…（转载源不可回溯）',
       '市场传闻：ST 板块摘帽预期升温（转载自媒体）',
       null, '2024-02-19 22:00:00+08', 'unverified',
       '转载来源无法回溯原始出处，公开时间未知'),
      ('E-F1003-03', 'C-F1003', 'C-F1003-R3', 'document', 'SSE-603903-202312', '202312',
       'sse.com.cn/disclosure/603903/202312 · 终止上市决定',
       '*ST博天终止上市决定（反面对照样本核心证据）',
       '2023-12-08 17:00:00+08', '2023-12-09 09:00:00+08', 'verified',
       '公开于 T 前 2.5 个月，满足截面约束'),
      ('E-F1003-04', 'C-F1003', 'C-F1003-R3', 'document', 'SSE-600290-202307', '202307',
       'sse.com.cn/disclosure/600290/202307 · 终止上市决定（链接已失效）',
       'ST华仪终止上市决定（对照有效性存疑，原链接失效）',
       '2023-07-14 17:00:00+08', null, 'unavailable',
       '原始披露链接已失效，快照未留存；对照有效性存疑，保留不隐藏')
    ON CONFLICT (evidence_id) DO NOTHING
  `;
  console.log("[seed] evidence_reference：10 条（四态全覆盖）");

  // 6. 审核记录（request_changes ×3 + approve ×1，含类别标签）
  await sql`
    INSERT INTO cases.review_record
      (review_id, case_id, revision_id, decision, reason, categories, reviewer, reviewed_at)
    VALUES
      ('RV-F1002-01', 'C-F1002', 'C-F1002-R1', 'request_changes',
       '证据链不足：核心结论依赖单一媒体转载源，需补充公告与月度装车量口径后再审',
       ${['证据不足']}, 'human:reviewer01', '2024-04-28 11:20:00+08'),
      ('RV-F1003-01', 'C-F1003', 'C-F1003-R1', 'request_changes',
       '企业样本缺少反例：必须纳入重整失败退市样本，否则联动结构无法证伪',
       ${['企业样本问题']}, 'human:reviewer01', '2024-02-21 15:00:00+08'),
      ('RV-F1003-02', 'C-F1003', 'C-F1003-R2', 'request_changes',
       '时间约束未验证：ST华仪重整受理日晚于信息截止，样本可比性未校验',
       ${['时间约束未验证']}, 'human:reviewer01', '2024-02-21 18:40:00+08'),
      ('RV-F1003-03', 'C-F1003', 'C-F1003-R3', 'approve',
       '证据链完整、时间约束校验通过、反例保留完整，同意冻结进入观察期',
       ${[]}, 'human:reviewer01', '2024-02-22 10:14:00+08')
    ON CONFLICT (review_id) DO NOTHING
  `;
  console.log("[seed] review_record：4 条");

  // 7. 观察追加（C-F1003 冻结后的追加，虚实分界语义的数据侧体现）
  await sql`
    INSERT INTO cases.observation
      (observation_id, case_id, revision_id, window_start, window_end, outcome, content, refs)
    VALUES
      ('OB-F1003-01', 'C-F1003', 'C-F1003-R3', '2024-03-01 09:30:00+08', '2024-03-15 15:00:00+08', 'support',
       '金一文化重整执行完毕公告披露后，2024-03-05 起连续 2 日涨停，市场对摘帽预期定价积极，与结论方向一致',
       ${sql.json(['E-F1003-01'])}),
      ('OB-F1003-02', 'C-F1003', 'C-F1003-R3', '2024-03-08 09:30:00+08', '2024-03-22 15:00:00+08', 'oppose',
       '*ST博天退市整理期落地后 ST 板块风险偏好回落，联动标的普遍回撤，表明联动行情不区分执行进度的结论需加限定条件',
       ${sql.json(['E-F1003-03'])})
    ON CONFLICT (observation_id) DO NOTHING
  `;
  console.log("[seed] observation：2 条");

  // 8. Agent Run（一个 running、一个 failed 可重试）
  await sql`
    INSERT INTO cases.agent_run
      (run_id, run_type, date_scope, stage, status, started_at, finished_at,
       processed_count, success_count, failed_count, outputs, error, retryable)
    VALUES
      ('RUN-F0001', 'daily_discovery',
       ${sql.json({ start: '2024-06-14', end: '2024-06-14' })},
       'business_research', 'running', '2024-06-14 08:02:11+08', null,
       3, 2, 0,
       ${sql.json({
         stages_done: ['discovery', 'episode_matching', 'case_preparation'],
         stages_done_note: '前序阶段已完成',
         current: 'business_research：C-F1001 证据检索中'
       })},
       null, false),
      ('RUN-F0002', 'episode_matching',
       ${sql.json({ start: '2024-02-20', end: '2024-02-20' })},
       'critic', 'failed', '2024-02-20 08:00:05+08', '2024-02-20 08:41:33+08',
       4, 3, 1,
       ${sql.json({ failed_items: ['C-F1003-R2 critic 阶段'] })},
       'critic 阶段上游 LLM 服务 504 超时，超时重试 2 次后放弃', true)
    ON CONFLICT (run_id) DO NOTHING
  `;
  console.log("[seed] agent_run：2 条（running / failed+retryable）");

  // 结果核对
  const counts = await sql<{ t: string; c: string }[]>`
    SELECT 'case' AS t, count(*)::text AS c FROM cases."case"
    UNION ALL SELECT 'case_revision', count(*)::text FROM cases.case_revision
    UNION ALL SELECT 'company_participation', count(*)::text FROM cases.company_participation
    UNION ALL SELECT 'evidence_reference', count(*)::text FROM cases.evidence_reference
    UNION ALL SELECT 'review_record', count(*)::text FROM cases.review_record
    UNION ALL SELECT 'observation', count(*)::text FROM cases.observation
    UNION ALL SELECT 'agent_run', count(*)::text FROM cases.agent_run
    UNION ALL SELECT 'discovery_action', count(*)::text FROM cases.discovery_action
  `;
  for (const r of counts) console.log(`[seed] ${r.t}: ${r.c}`);
  console.log("[seed] 完成");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] 失败:", err);
    process.exit(1);
  });
