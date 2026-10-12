import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClauseTree, findClausesByCategory, missingCategories } from '../src/clausetree.js';
import { runRules } from '../src/rules.js';
import { citationValid, citationGate, aggregateReport, normalize } from '../src/citation.js';

const CONTRACT = `购销合同

第一条 标的物
乙方向甲方供应工业传感器 500 套。

第二条 价款与支付
合同总价 ¥200,000.00 元（大写：贰拾万元整）。甲方收货后及时支付。

第三条 交付
乙方应尽快完成交付，交付地点由双方另行协商。

第四条 违约责任
甲方逾期付款的，每日按未付款项的千分之五支付违约金。

第五条 争议解决
双方友好协商解决。`;

test('条款树：识别五条，标题与正文分离', () => {
  const tree = parseClauseTree(CONTRACT);
  assert.equal(tree.confidence, 'structured');
  assert.equal(tree.articles.length, 5);
  assert.equal(tree.articles[0].label, '第一条');
  assert.ok(tree.articles[1].text.includes('200,000'));
});

test('条款树：无条款结构时降级线性分块', () => {
  const tree = parseClauseTree('这是一段没有条款结构的普通文本。\n\n第二段也是普通段落，没有编号。');
  assert.equal(tree.confidence, 'linear-fallback');
  assert.ok(tree.blocks.length >= 2);
});

test('按类别检索 + 缺失检测', () => {
  const tree = parseClauseTree(CONTRACT);
  const payments = findClausesByCategory(tree, 'payment');
  assert.ok(payments.length >= 1);
  const missing = missingCategories(tree);
  assert.ok(missing.includes('ip'));       // 无知识产权条款
  assert.ok(missing.includes('confidentiality'));
  assert.ok(!missing.includes('payment')); // 第二条标题含"价款与支付"
});

test('规则引擎：缺逾期利息/单向违约/模糊词/无管辖全部命中', () => {
  const tree = parseClauseTree(CONTRACT);
  const findings = runRules(tree);
  const ids = findings.map((f) => f.ruleId);
  assert.ok(ids.includes('payment/no-late-interest')); // "及时支付"无逾期约定
  assert.ok(ids.includes('breach/one-sided'));        // 违约只罚甲方
  assert.ok(ids.includes('dispute/no-jurisdiction')); // 无管辖
  assert.ok(ids.includes('general/vague-terms'));     // 及时/尽快/另行协商
  for (const f of findings) {
    assert.equal(f.source, 'deterministic');
    assert.ok(['high', 'medium', 'low'].includes(f.severity));
  }
});

test('规则引擎：健康合同不误报单向违约', () => {
  const ok = parseClauseTree(`测试合同
第一条 价款与支付
总价 10 万元。任何一方逾期履行的，均按日万分之五向守约方支付违约金，赔偿总额不超过合同总价的 20%。`);
  const findings = runRules(ok);
  assert.ok(!findings.some((f) => f.ruleId === 'breach/one-sided'));
  assert.ok(!findings.some((f) => f.ruleId === 'breach/no-cap'));
});

// ---- 引用校验门 ----
test('引用校验：字面命中/全半角容错/编造引用', () => {
  const src = '甲方应在收到发票后 30 日内支付全部价款。';
  assert.ok(citationValid('收到发票后 30 日内支付', src));
  assert.ok(citationValid('甲方应在收到发票后３０日内支付全部价款。', src)); // 全角数字
  assert.ok(!citationValid('甲方应在 60 日内付款', src)); // 编造
  assert.ok(!citationValid('', src));
});

test('normalize：空白与标点归一', () => {
  assert.equal(normalize('  A B，C。'), 'ab,c.');
});

test('校验门：真引用保留、假引用重试成功/失败路径', async () => {
  const src = '乙方逾期交付的，按合同总价的千分之三支付违约金。';
  const findings = [
    { severity: 'high', quote: '按合同总价的千分之三支付违约金', desc: '逾期交付违约金' },
    { severity: 'medium', quote: '按合同总价的百分之五十支付违约金', desc: '编造的高额违约金' },
    { severity: 'low' }, // 无引用
  ];
  const model = {
    async retryFinding(f) {
      return f.desc.includes('编造') ? { ...f, quote: '按合同总价的千分之三支付违约金' } : null;
    },
  };
  const { kept, dropped, droppedCount } = await citationGate(findings, src, model);
  assert.equal(kept.length, 2);
  assert.ok(kept[1].retried); // 编造引用重试后修正
  assert.equal(droppedCount, 1);
  assert.equal(dropped[0].reason, 'no-quote');
});

test('报告聚合：分档/总览色/免责声明', () => {
  const tree = parseClauseTree(CONTRACT);
  const det = runRules(tree);
  const report = aggregateReport(tree, det, [], missingCategories(tree));
  assert.equal(report.overall, 'red'); // 有 high
  assert.ok(report.counts.high >= 1);
  assert.ok(report.missingCategories.includes('ip'));
  assert.match(report.disclaimer, /不构成法律意见/);
});
