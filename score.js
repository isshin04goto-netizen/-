/*
 * 商品スコアリングロジック（ブラウザ / Node 両対応）
 * TikTok Shop アフィリエイト向けに「紹介して稼ぎやすい商品か」を 0〜100 点で評価する。
 */
(function (root) {
  'use strict';

  var DEFAULT_WEIGHTS = {
    reward: 25,      // 1件あたりの報酬
    demand: 25,      // 需要（月間販売数）
    competition: 20, // 競合の少なさ（クリエイター1人あたりの販売数）
    quality: 15,     // 品質（評価 × レビュー数）
    visual: 15       // 動画映え（自己評価 1〜5）
  };

  var LABELS = {
    reward: '報酬',
    demand: '需要',
    competition: '競合の少なさ',
    quality: '品質・信頼',
    visual: '動画映え'
  };

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[,，円%％¥\s]/g, ''));
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // 0 → 0点, full → 100点 の対数スケール
  function logScore(value, full) {
    if (value <= 0) return 0;
    return clamp(Math.log10(value + 1) / Math.log10(full + 1) * 100, 0, 100);
  }

  function normalize(p) {
    return {
      price: Math.max(0, num(p.price, 0)),
      commissionRate: clamp(num(p.commissionRate, 0), 0, 100),
      monthlySales: Math.max(0, num(p.monthlySales, 0)),
      rating: clamp(num(p.rating, 0), 0, 5),
      reviews: Math.max(0, num(p.reviews, 0)),
      creators: Math.max(0, num(p.creators, 0)),
      visual: clamp(num(p.visual, 3), 1, 5)
    };
  }

  function analyze(product, weights) {
    var w = weights || DEFAULT_WEIGHTS;
    var p = normalize(product);

    var commission = p.price * p.commissionRate / 100;
    var salesPerCreator = p.monthlySales / (p.creators + 1);

    // 品質: ★3.5以下は0点、★5で100点。レビューが少ないほど信頼度を下げる（100件で満額）
    var ratingPart = clamp((p.rating - 3.5) / 1.5, 0, 1) * 100;
    var confidence = clamp(Math.log10(p.reviews + 1) / 2, 0, 1);
    var hasRating = p.rating > 0;

    var scores = {
      reward: logScore(commission, 2000),          // 1件2,000円で満点
      demand: logScore(p.monthlySales, 10000),     // 月1万件で満点
      competition: logScore(salesPerCreator, 500), // 1人あたり月500件で満点
      quality: hasRating ? ratingPart * (0.4 + 0.6 * confidence) : 40,
      visual: (p.visual - 1) / 4 * 100
    };

    var total = 0, wsum = 0;
    Object.keys(DEFAULT_WEIGHTS).forEach(function (k) {
      var wk = num(w[k], 0);
      total += scores[k] * wk;
      wsum += wk;
    });
    total = wsum > 0 ? total / wsum : 0;

    // 想定報酬: 市場の販売数をクリエイターで割った分の 10% を自分が取れたと仮定
    var estMonthlyIncome = commission * salesPerCreator * 0.1;

    return {
      commission: commission,
      salesPerCreator: salesPerCreator,
      estMonthlyIncome: estMonthlyIncome,
      scores: scores,
      total: Math.round(total),
      rank: rankOf(total),
      advice: adviceFor(scores, p, commission)
    };
  }

  function rankOf(total) {
    if (total >= 80) return 'S';
    if (total >= 65) return 'A';
    if (total >= 50) return 'B';
    return 'C';
  }

  function adviceFor(s, p, commission) {
    var good = [], bad = [];
    if (s.reward >= 70) good.push('1件あたりの報酬が高く、少ない販売数でも稼げる');
    else if (s.reward < 40) bad.push('報酬単価が低い（' + Math.round(commission) + '円/件）。高単価品やセット販売を検討');
    if (s.demand >= 70) good.push('すでに売れている商品で需要が証明済み');
    else if (s.demand < 40) bad.push('販売実績が少ない。まだ伸びていないか、需要が小さい可能性');
    if (s.competition >= 70) good.push('紹介者に対して販売数が多く、参入余地がある');
    else if (s.competition < 40) bad.push('紹介クリエイターが多く飽和気味。切り口の差別化が必須');
    if (s.quality >= 70) good.push('評価・レビューが良く、返品やクレームのリスクが低い');
    else if (p.rating > 0 && p.rating < 4.2) bad.push('評価が低め（★' + p.rating + '）。信頼を損なうリスク');
    else if (p.reviews < 20) bad.push('レビューが少なく品質が未知数。サンプルで要確認');
    if (s.visual >= 75) good.push('ビフォーアフターや使用シーンが映えて動画にしやすい');
    else if (s.visual < 40) bad.push('動画で魅力が伝わりにくい。比較・検証系の構成が有効');
    return { good: good, bad: bad };
  }

  var api = { analyze: analyze, DEFAULT_WEIGHTS: DEFAULT_WEIGHTS, LABELS: LABELS, rankOf: rankOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(this);
