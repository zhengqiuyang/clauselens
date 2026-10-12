// 审查编排：解析 → 规则通道 → 缺失检测 → 报告聚合。CLI 与 Web 共用的入口。
import { parseClauseTree, missingCategories } from './clausetree.js';
import { runRules } from './rules.js';
import { aggregateReport } from './citation.js';

export function buildReport(contractText, { llmFindings = [], missingOverride = null } = {}) {
  const tree = parseClauseTree(contractText);
  const deterministic = runRules(tree);
  const missing = missingOverride ?? missingCategories(tree);
  const report = aggregateReport(tree, deterministic, llmFindings, missing);
  report.tree = tree; // CLI/Web 展示层用（条款定位联动）
  return report;
}

// 控制台友好输出（CLI 用；Web 层自己渲染 JSON）
export function formatReportText(report) {
  const color = { red: '🔴 红', yellow: '🟡 黄', green: '🟢 绿' }[report.overall] ?? report.overall;
  const lines = [];
  lines.push(`═══ clauselens 审查报告 ═══`);
  lines.push(`整体风险：${color}（高 ${report.counts.high} / 中 ${report.counts.medium} / 低 ${report.counts.low}）`);
  lines.push(`解析置信：${report.confidence === 'structured' ? '结构化条款树' : '⚠️ 降级为线性分块（条款定位不可用）'}`);
  if (report.missingCategories.length) {
    lines.push(`\n【缺失条款】`);
    const NAMES = { payment: '付款', breach: '违约责任', ip: '知识产权', confidentiality: '保密', termination: '解除终止', dispute: '争议解决', warranty: '质保验收' };
    lines.push('  ' + report.missingCategories.map((c) => NAMES[c] ?? c).join('、'));
  }
  for (const [sev, title] of [['high', '高风险'], ['medium', '中风险'], ['low', '低风险']]) {
    const items = report.findings[sev] ?? [];
    if (!items.length) continue;
    lines.push(`\n【${title}】`);
    for (const f of items) {
      lines.push(`  • ${f.desc}${f.clauseLabel ? `（${f.clauseLabel}）` : ''}`);
      lines.push(`    → ${f.fix}`);
      if (f.evidence?.length) lines.push(`    证据：${f.evidence.join('、')}`);
    }
  }
  lines.push(`\n${report.disclaimer}`);
  return lines.join('\n');
}
