// 引用校验门：LLM 审查结论的每条引用必须与原文做规范化字面比对。
// 校验不过 → 丢弃该条（宁缺勿错）。这是防幻觉的代码级约束，不是 prompt 恳求。
// 校验策略：一次重试（可传入重试器），仍不过则丢弃并记录。

// 规范化：去空白、全角转半角、统一大小写——比对的是"字面上真的在原文里"。
export function normalize(s) {
  return String(s)
    .replace(/\s+/g, '')
    .replace(/[，。；：、""''（）]/g, (c) => ({ '，': ',', '。': '.', '；': ';', '：': ':', '、': ',', '（': '(', '）': ')' }[c] ?? ''))
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

// 引用是否真实存在于原文（含 >=8 字的模糊容错：原文含引用的核心片段）
export function citationValid(quote, sourceText) {
  const q = normalize(quote);
  const src = normalize(sourceText);
  if (!q || !src) return false;
  if (src.includes(q)) return true;
  // 长引用逐段降级：任意 12 字滑窗子串命中即可（容忍 OCR 噪声/微小改动）
  if (q.length >= 12) {
    for (let i = 0; i + 12 <= q.length; i++) {
      if (src.includes(q.slice(i, i + 12))) return true;
    }
  }
  return false;
}

// 校验门：LLM 输出的 findings 数组 → 过滤 + 重试。
// model.retryFinding(finding) 返回修正后的 finding 或 null（放弃）。
export async function citationGate(findings, sourceText, model = null) {
  const kept = [];
  const dropped = [];
  for (const f of findings ?? []) {
    if (!f?.quote) { dropped.push({ finding: f, reason: 'no-quote' }); continue; }
    if (citationValid(f.quote, sourceText)) {
      kept.push({ ...f, source: 'llm', citationVerified: true });
      continue;
    }
    let retried = null;
    if (model?.retryFinding) {
      retried = await model.retryFinding(f);
      if (retried?.quote && citationValid(retried.quote, sourceText)) {
        kept.push({ ...retried, source: 'llm', citationVerified: true, retried: true });
        continue;
      }
    }
    dropped.push({ finding: f, reason: 'citation-mismatch' });
  }
  return { kept, dropped, droppedCount: dropped.length };
}

// 报告聚合：规则通道 + LLM 通道（已过校验门）+ 缺失条款检测。
export function aggregateReport(tree, deterministicFindings, llmFindings, missing) {
  const bySeverity = { high: [], medium: [], low: [] };
  for (const f of [...deterministicFindings, ...llmFindings]) {
    bySeverity[f.severity]?.push(f);
  }
  return {
    confidence: tree.confidence,
    counts: {
      high: bySeverity.high.length,
      medium: bySeverity.medium.length,
      low: bySeverity.low.length,
    },
    overall: bySeverity.high.length > 0 ? 'red' : bySeverity.medium.length > 0 ? 'yellow' : 'green',
    missingCategories: missing,
    findings: bySeverity,
    disclaimer: '本报告为合同信息整理与风险提示，不构成法律意见。重要事项请咨询律师。',
  };
}
