// 条款树解析：中文合同的"第X条/一/1./(1)"层级识别。
// 布局启发式 + 兜底策略：解析置信度低时降级为线性分块（报告会标注）。
const ARTICLE_RE = /^[第]?\s*([一二三四五六七八九十百\d]+)\s*[条、.]\s*(.*)$/;
const CHINESE_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function parseClauseTree(text) {
  const lines = String(text).split(/\r?\n/);
  const articles = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const m = line.match(ARTICLE_RE);
    if (m && line.length < 200) {
      current = {
        id: `c${articles.length + 1}`,
        label: `第${m[1]}条`,
        num: normalizeNum(m[1]),
        title: m[2].slice(0, 60),
        lines: [line],
        startLine: i + 1,
      };
      articles.push(current);
    } else if (current && line) {
      current.lines.push(line);
    }
  }

  const confidence = articles.length >= 2 ? 'structured' : 'linear-fallback';
  return {
    confidence,
    articles: articles.map((a) => ({ ...a, text: a.lines.join('\n') })),
    // 降级：条款切不出来时按段落线性分块，至少能定位
    blocks: confidence === 'linear-fallback'
      ? linearBlocks(lines)
      : null,
  };
}

function linearBlocks(lines) {
  const paras = [];
  let buf = [];
  let startLine = 1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      if (buf.length) paras.push({ id: `b${paras.length + 1}`, text: buf.join('\n'), startLine });
      buf = [];
      startLine = i + 2;
    } else buf.push(t);
  }
  if (buf.length) paras.push({ id: `b${paras.length + 1}`, text: buf.join('\n'), startLine });
  return paras;
}

function normalizeNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  return [...s].reduce((acc, ch) => acc + (CHINESE_NUM[ch] ?? 0), 0);
}

// 按类别找条款（审查器的检索入口）
const CATEGORY_KEYWORDS = {
  payment: ['付款', '价款', '支付', '费用', '报酬', '结算'],
  breach: ['违约', '赔偿', '责任'],
  ip: ['知识产权', '著作权', '专利', '商标', '成果归属'],
  confidentiality: ['保密'],
  termination: ['解除', '终止', '期满'],
  dispute: ['争议', '管辖', '诉讼', '仲裁'],
  warranty: ['质保', '保修', '保证', '验收'],
};

export function findClausesByCategory(tree, category) {
  const kws = CATEGORY_KEYWORDS[category];
  if (!kws) throw new Error(`未知条款类别: ${category}`);
  return tree.articles.filter(
    (a) => kws.some((k) => a.title.includes(k)) || kws.some((k) => a.text.includes(k))
  );
}

export function missingCategories(tree) {
  const present = new Set(
    Object.entries(CATEGORY_KEYWORDS)
      .filter(([, kws]) => tree.articles.some((a) => kws.some((k) => a.title.includes(k))))
      .map(([cat]) => cat)
  );
  // 只有标题级匹配才算"明确存在"；正文级弱匹配的类别单独提示
  return Object.keys(CATEGORY_KEYWORDS).filter((c) => !present.has(c));
}
