const test = require('node:test');
const assert = require('node:assert');
const { analyzeVideo, patterns, num, splitSentences } = require('../video.js');

test('「1.2万」などの表記を数値にする', () => {
  assert.strictEqual(num('1.2万'), 12000);
  assert.strictEqual(num('86,000'), 86000);
  assert.strictEqual(num(''), 0);
});

test('エンゲージメント率と保存率', () => {
  const a = analyzeVideo({ views: 10000, likes: 800, comments: 50, saves: 100, shares: 50 });
  assert.strictEqual(a.metrics.engagementRate, 10);
  assert.strictEqual(a.metrics.saveRate, 1);
});

test('台本からフック・CTA・社会的証明を見つける', () => {
  const a = analyzeVideo({
    duration: 20,
    transcript: 'え、まだ手で洗ってるの？\nこれ使うだけで簡単にきれいになる。\n累計10万個売れてます。\n今だけ半額。\n黄色いカゴからチェックしてね。'
  });
  assert.strictEqual(a.timeline[0].section, 'hook');
  assert.ok(a.hookTypes.some((h) => h.key === 'surprise'));
  assert.ok(a.timeline.some((t) => t.section === 'cta'));
  assert.ok(a.timeline.some((t) => t.section === 'proof'));
  assert.ok(a.checks.find((c) => c.label.startsWith('CTAが後半')).ok);
});

test('数字がなければスコアは出さない', () => {
  assert.strictEqual(analyzeVideo({ transcript: 'テスト' }).total, null);
});

test('句読点で文を分ける', () => {
  assert.deepStrictEqual(splitSentences('あ。い！う？\nえ'), ['あ。', 'い！', 'う？', 'え']);
});

test('勝ちパターンは2本以上で集計', () => {
  assert.strictEqual(patterns([{ views: 100, likes: 10 }]), null);
  const p = patterns([
    { views: 100000, likes: 9000, saves: 1000, duration: 30, transcript: '知ってた？\nカゴから見てね。' },
    { views: 1000, likes: 10, duration: 60, transcript: '紹介します。' }
  ]);
  assert.strictEqual(p.sampleSize, 1);
  assert.strictEqual(p.ctaRate, 1);
});
