<!-- web/src/client/components/StatusTag.svelte -->
<!-- 统一状态标签：Case 生命周期 / Run / 证据 PIT / Episode / 主题映射 / Agent 状态。
     色值映射集中于此（Phase 2 附·提示 5），全部带文字，不单靠颜色（Phase 1 反模式 8）。 -->
<script lang="ts">
  type Kind = "case" | "run" | "pit" | "episode" | "mapping" | "agent";

  interface Props {
    kind: Kind;
    value: string;
    /** 覆盖默认文案 */
    label?: string;
  }

  let { kind, value, label }: Props = $props();

  // kind → value → { 类名, 默认文案 }（色值来自 tokens.css 语义类）
  const MAP: Record<Kind, Record<string, { cls: string; label: string }>> = {
    case: {
      candidate: { cls: "status-tag status-candidate", label: "Candidate" },
      researching: { cls: "status-tag status-researching", label: "Researching" },
      reviewing: { cls: "status-tag status-reviewing", label: "Reviewing" },
      frozen: { cls: "status-tag status-frozen", label: "Frozen" },
      observing: { cls: "status-tag status-observing", label: "Observing" },
      completed: { cls: "status-tag status-completed", label: "Completed" },
      rejected: { cls: "status-tag status-rejected", label: "Rejected" },
      blocked: { cls: "status-tag status-blocked", label: "Blocked" },
    },
    run: {
      running: { cls: "status-tag run-running", label: "运行中" },
      success: { cls: "status-tag run-success", label: "成功" },
      failed: { cls: "status-tag run-failed", label: "失败" },
    },
    pit: {
      verified: { cls: "status-tag pit-verified", label: "verified" },
      unverified: { cls: "status-tag pit-unverified", label: "unverified" },
      unresolved: { cls: "status-tag pit-unresolved", label: "unresolved" },
      unavailable: { cls: "status-tag pit-unavailable", label: "unavailable" },
    },
    episode: {
      confirmed: { cls: "ep-status ep-confirmed", label: "活跃·已确认" },
      candidate: { cls: "ep-status ep-candidate", label: "活跃·候选" },
    },
    mapping: {
      confirmed: { cls: "status-tag pit-verified", label: "已标准化" },
      candidate: { cls: "status-tag pit-unverified", label: "候选映射" },
    },
    agent: {
      unhandled: { cls: "agent-dot agent-unhandled", label: "Agent 未处理" },
      researching: { cls: "agent-dot agent-researching", label: "处理中" },
      prepared: { cls: "agent-dot agent-prepared", label: "已有候选 Case" },
      researched: { cls: "agent-dot agent-researched", label: "Agent 已研究" },
      skipped: { cls: "agent-dot agent-skipped", label: "已跳过" },
      rejected: { cls: "agent-dot agent-rejected", label: "被拒绝" },
    },
  };

  const tag = $derived(MAP[kind][value] ?? { cls: "status-tag", label: value });
</script>

<span class={tag.cls}>{label ?? tag.label}</span>
