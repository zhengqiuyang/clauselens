// 规则引擎（确定性通道）：规则 = 检测函数 + 适用条件 + 例外清单。
// 组织方式沿用工具链项目的 detector 风格——每条规则可单测、带快照。
export const RULES = [
  {
    id: 'payment/no-late-interest',
    severity: 'high',
    category: 'payment',
    desc: '付款条款缺少逾期利息/违约金约定',
    applies: (clause) => /付款|价款|支付/.test(clause.title) || /付款/.test(clause.text),
    detect: (clause) => !(/逾期|滞纳|违约金|利息/.test(clause.text)),
    fix: '建议补充：逾期付款按日万分之X支付违约金',
  },
  {
    id: 'payment/amount-case-mismatch',
    severity: 'high',
    category: 'payment',
    desc: '金额大小写不一致（或只有一种写法未做校验提示）',
    applies: () => true,
    detect: (clause) => {
      const uppers = [...clause.text.matchAll(/[¥￥]\s*([零一二三四五六七八九十百千万亿\d,，.]+)\s*元?/g)];
      if (uppers.length === 0) return false;
      // 出现两种金额写法且数值不等 → 报警（此处取最常见的"小写与大写并存"校验）
      const nums = uppers.map((m) => m[1]).filter((s) => /^[\d,，.]+$/.test(s));
      const cn = uppers.map((m) => m[1]).filter((s) => /[零一二三四五六七八九十百千万亿]/.test(s));
      return nums.length > 0 && cn.length > 0 && nums.length + cn.length >= 2 && !sameAmount(nums[0], cn[0]);
    },
    fix: '核对金额大小写是否一致（高频低级错误，也是高频争议点）',
  },
  {
    id: 'breach/no-cap',
    severity: 'medium',
    category: 'breach',
    desc: '违约责任无上限（我方连带风险敞口）',
    applies: (clause) => /违约|赔偿/.test(clause.title) || /违约/.test(clause.text),
    detect: (clause) => !(/不超过|上限|最高|以.*为限/.test(clause.text)),
    fix: '建议约定赔偿上限（如合同总额的X%或直接损失为限）',
  },
  {
    id: 'breach/one-sided',
    severity: 'high',
    category: 'breach',
    desc: '违约责任单向（只约束我方）',
    applies: (clause) => /违约|赔偿/.test(clause.title) || /违约/.test(clause.text),
    detect: (clause) => {
      const mentionsUs = /甲方|买方|委托方/.test(clause.text);
      const mentionsThem = /乙方|卖方|受托方|供应/.test(clause.text);
      return mentionsUs !== mentionsThem; // 只提一边 = 单向
    },
    fix: '违约责任应对等：双方违约情形与责任均应约定',
  },
  {
    id: 'dispute/no-jurisdiction',
    severity: 'medium',
    category: 'dispute',
    desc: '未约定管辖/仲裁地（异地诉讼成本陷阱）',
    applies: () => true,
    detect: (tree) => !tree.articles.some((a) => /管辖|仲裁|诉讼地/.test(a.text)) ? [] : false,
    // 该规则在 tree 级别检查，见 runRules 的特殊处理
    scope: 'tree',
    fix: '建议明确"甲方所在地人民法院管辖"或约定仲裁委',
  },
  {
    id: 'general/vague-terms',
    severity: 'low',
    category: 'general',
    desc: '不可量化的模糊表述（"及时""适当""尽快"）',
    applies: () => true,
    detect: (clause) => {
      const vague = ['及时', '适当', '尽快', '相关费用', '另行协商'];
      const hits = vague.filter((v) => clause.text.includes(v));
      return hits.length > 0 ? hits : false;
    },
    fix: '模糊词替换为可量化约定（如"3 个工作日内""不超过X元"）',
  },
];

// 执行入口：clause 级规则对每个条款跑，tree 级规则对全树跑。
export function runRules(tree) {
  const findings = [];
  for (const rule of RULES) {
    if (rule.scope === 'tree') {
      const hit = rule.detect(tree);
      if (hit) findings.push(finding(rule, null, hit));
      continue;
    }
    for (const clause of tree.articles) {
      if (!rule.applies(clause)) continue;
      const hit = rule.detect(clause);
      if (hit) findings.push(finding(rule, clause, hit));
    }
  }
  return findings;
}

function finding(rule, clause, evidence) {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    category: rule.category,
    desc: rule.desc,
    fix: rule.fix,
    clauseId: clause?.id ?? null,
    clauseLabel: clause?.label ?? null,
    evidence: Array.isArray(evidence) ? evidence : (evidence ? [String(evidence)] : []),
    source: 'deterministic', // LLM 通道的发现会标 'llm'，报告聚合时区分信任级
  };
}

function sameAmount(numStr, cnStr) {
  // 简化实现：数值相等（中文数字仅处理常见万级以内整数）
  const n = Number(numStr.replace(/[,，]/g, ''));
  let cn = 0;
  let wan = false;
  for (const ch of cnStr) {
    if (ch === '万') { wan = true; continue; }
    if (CH[ch] !== undefined) cn = cn * 10 + CH[ch];
  }
  if (wan) cn *= 10000;
  return n === cn;
}
const CH = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
