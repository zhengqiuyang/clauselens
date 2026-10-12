import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildReport, formatReportText } from '../src/report.js';

const CONTRACT = `购销合同
第一条 标的物
乙方向甲方供应工业传感器 500 套。
第二条 价款与支付
合同总价 ¥200,000.00 元。甲方收货后及时支付。
第三条 违约责任
甲方逾期付款的，每日按未付款项的千分之五支付违约金。
第四条 争议解决
双方友好协商解决。`;

test('buildReport：编排完整（规则+缺失+聚合+树）', () => {
  const r = buildReport(CONTRACT);
  assert.equal(r.overall, 'red');
  assert.ok(r.counts.high >= 2);
  assert.ok(r.missingCategories.includes('ip'));
  assert.ok(r.tree.articles.length === 4);
  assert.ok(r.findings.high.every((f) => f.fix));
});

test('formatReportText：控制台输出含分档与免责声明', () => {
  const text = formatReportText(buildReport(CONTRACT));
  assert.match(text, /高风险/);
  assert.match(text, /缺失条款/);
  assert.match(text, /不构成法律意见/);
});

test('CLI：内置示例跑通，退出码 0', () => {
  const out = execFileSync(process.execPath, ['src/cli.js'], { cwd: process.cwd(), encoding: 'utf-8' });
  assert.match(out, /审查报告/);
  assert.match(out, /缺失条款/);
});

test('CLI：--json 输出可解析 JSON', () => {
  const out = execFileSync(process.execPath, ['src/cli.js', '--json'], { cwd: process.cwd(), encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  assert.ok(parsed.counts);
  assert.equal(parsed.tree, undefined); // 树不进 JSON 输出
});
