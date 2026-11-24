<!-- web/src/client/components/EvidenceBlock.svelte -->
<!-- 证据引用块（Phase 1 §5.6）：左缘 3px 状态色条，Companies/Evidence/Review/Judgment 四处复用。
     unavailable：标题删除线 + 整块 60% 不透明，仍完整保留（禁止隐藏证据）。 -->
<script lang="ts">
  import StatusTag from "./StatusTag.svelte";

  export interface EvidenceLike {
    evidenceId: string;
    upstreamType: string;
    upstreamId: string;
    versionRef?: string | null;
    locator: string;
    summary: string;
    publishedAt?: string | null;
    pitStatus: string;
    pitNote?: string | null;
  }

  interface Props {
    evidence: EvidenceLike;
  }

  let { evidence }: Props = $props();

  // 上游类型 chip 文案（Phase 1 §5.6 描边款）
  const TYPE_LABEL: Record<string, string> = {
    document: "公告/文件",
    frame: "新闻画面",
    business_fact: "业务事实",
    market_observation: "行情观察",
    other: "其他",
  };
</script>

<div class="evidence-block pit-{evidence.pitStatus}">
  <div class="ev-row">
    <span class="ev-chip">{TYPE_LABEL[evidence.upstreamType] ?? evidence.upstreamType}</span>
    <StatusTag kind="pit" value={evidence.pitStatus} />
    <span class="ts ev-time">{evidence.publishedAt ?? "公开时间未知"}</span>
  </div>
  <div class="ev-title" title={evidence.summary}>{evidence.summary || evidence.upstreamId}</div>
  <div class="ev-locator mono" title={evidence.locator}>
    <span aria-hidden="true">⚓</span> {evidence.locator}
  </div>
  {#if evidence.pitNote}
    <div class="ev-note" class:ev-warn={evidence.pitStatus !== "verified"}>
      {evidence.pitStatus === "verified" ? "" : "⚠ "}{evidence.pitNote}
    </div>
  {/if}
</div>

<style>
  .ev-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .ev-chip {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-tag);
    color: var(--text-secondary);
    font-size: var(--text-caption);
    white-space: nowrap;
  }
  .ev-time {
    margin-left: auto;
  }
  .ev-title {
    font-size: var(--text-body);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
  }
  .ev-locator {
    font-size: var(--text-caption);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
  }
  .ev-note {
    font-size: var(--text-caption);
    color: var(--text-secondary);
  }
  .ev-note.ev-warn {
    color: var(--status-warning);
  }
</style>
