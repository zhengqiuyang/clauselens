#!/usr/bin/env node
// clauselens CLI：node src/cli.js 合同.txt [--json]  （不带参数跑内置示例）
import { readFileSync } from 'node:fs';
import { buildReport, formatReportText } from './report.js';

const SAMPLE = `购销合同

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

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));

const text = file ? readFileSync(file, 'utf-8') : SAMPLE;
const report = buildReport(text);

if (jsonMode) {
  console.log(JSON.stringify({ ...report, tree: undefined }, null, 2));
} else {
  console.log(formatReportText(report));
  if (!file) console.log('\n（示例合同。用法：node src/cli.js 你的合同.txt [--json]）');
}
