const test = require('node:test');
const assert = require('node:assert');
const { normalizeProduct, normalizeVideo, toNum, videoPrompt } = require('../scan.js');

test('「1.2万」「3.4K」「¥3,980」「20%」を数値に', () => {
  assert.strictEqual(toNum('1.2万'), 12000);
  assert.strictEqual(toNum('3.4K'), 3400);
  assert.strictEqual(toNum('¥3,980'), 3980);
  assert.strictEqual(toNum('20%'), 20);
  assert.strictEqual(toNum(null), '');
});

test('商品の読み取り結果を入力欄の形に整える', () => {
  const p = normalizeProduct({ name: '美顔器', price: '3,980', commissionRate: 20, monthlySales: '1.2万', salesPeriod: '累計', visual: 7, rating: null });
  assert.strictEqual(p.price, 3980);
  assert.strictEqual(p.monthlySales, 12000);
  assert.strictEqual(p.visual, 5);
  assert.strictEqual(p.rating, '');
  assert.match(p.memo, /累計/);
});

test('動画の読み取り結果と長さ', () => {
  const v = normalizeVideo({ views: '86万', transcript: 'え、まだ？\nカゴから' }, 27.6);
  assert.strictEqual(v.views, 860000);
  assert.strictEqual(v.duration, 28);
  assert.strictEqual(normalizeVideo(null).views, '');
});

test('プロンプトにコマの時刻が入る', () => {
  assert.match(videoPrompt({ screenshots: 1, frameTimes: [0.3, 5], duration: 10 }), /0\.3秒、5\.0秒/);
});
