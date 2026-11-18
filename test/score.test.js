const test = require('node:test');
const assert = require('node:assert');
const { analyze } = require('../score.js');

test('報酬単価 = 価格 × 手数料率', () => {
  assert.strictEqual(analyze({ price: 3000, commissionRate: 20 }).commission, 600);
});

test('良い商品は悪い商品より高スコア', () => {
  const good = analyze({ price: 4000, commissionRate: 20, monthlySales: 5000, rating: 4.7, reviews: 2000, creators: 20, visual: 5 });
  const bad = analyze({ price: 500, commissionRate: 3, monthlySales: 10, rating: 3.6, reviews: 3, creators: 200, visual: 1 });
  assert.ok(good.total > bad.total);
  assert.ok(['S', 'A'].includes(good.rank));
  assert.strictEqual(bad.rank, 'C');
});

test('文字列入力（カンマ・円・%）も数値として扱う', () => {
  assert.strictEqual(analyze({ price: '1,000円', commissionRate: '10%' }).commission, 100);
});

test('空データでも0〜100に収まる', () => {
  const a = analyze({});
  assert.ok(a.total >= 0 && a.total <= 100);
});
