/*
 * 動画分析ロジック（ブラウザ / Node 両対応）
 * 他のクリエイターの TikTok Shop 動画を、数字（再生・いいね等）と
 * 台本（文字起こし）から分析し、真似できるポイントを抽出する。
 */
(function (root) {
  'use strict';

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[,，\s]/g, ''));
    if (!isFinite(n)) return 0;
    // 「1.2万」「3万」のような表記に対応
    if (/万/.test(String(v))) n *= 10000;
    return Math.max(0, n);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function logScore(value, full) {
    if (value <= 0) return 0;
    return clamp(Math.log10(value + 1) / Math.log10(full + 1) * 100, 0, 100);
  }

  // ---- フックの型 ----
  var HOOK_TYPES = [
    { key: 'question', label: '問いかけ', re: /[?？]|知って(る|た|ます)|ですか|ってない|でしょ|なぜ|なんで|どうして/, tip: '視聴者に問いかけて「自分ごと」にさせる' },
    { key: 'warning', label: '警告・否定', re: /やめ|ダメ|だめ|NG|買うな|しないで|後悔|損し|注意|危険|知らないと|間違/, tip: '損失回避の心理で続きを見させる' },
    { key: 'target', label: 'ターゲット指定', re: /(な|の|てる|ている)人|さん必見|必見|悩み|困って|あるある|わかる|派/, tip: '「〜な人」で対象を絞り、当事者を止める' },
    { key: 'surprise', label: '驚き・感情', re: /え[っ、！!…]|まじ|マジ|ヤバ|やば|衝撃|びっくり|嘘|うそ|神|天才|感動|泣/, tip: '感情的なリアクションで興味を引く' },
    { key: 'result', label: '結果・ビフォーアフター', re: /ビフォー|アフター|before|after|変わ|激変|だけで|たった|見て|この差/i, tip: '結果を先に見せて「どうやったの？」を作る' },
    { key: 'number', label: '数字・具体性', re: /\d|[一二三四五六七八九十百千万]+(つ|個|選|秒|分|日|円|倍|年)/, tip: '数字で具体性と信頼感を出す' },
    { key: 'offer', label: 'お得・限定', re: /セール|割引|%|％|オフ|OFF|半額|今だけ|限定|クーポン|最安|無料|タダ/i, tip: 'お得感・期限で「今」見る理由を作る' },
    { key: 'compare', label: '比較・ランキング', re: /ランキング|比較|位|ベスト|vs|VS|どっち|違い/, tip: '比較で判断材料を与え、最後まで見させる' }
  ];

  // ---- 構成パーツ（文ごとに判定） ----
  var SECTIONS = [
    { key: 'cta', label: 'CTA（行動の呼びかけ）', re: /カゴ|かご|カート|リンク|プロフ|今すぐ|チェックして|ポチ|購入|買ってみて|保存し|フォロー|コメントして|タップ/ },
    { key: 'offer', label: '価格・オファー', re: /\d+円|価格|値段|セール|割引|クーポン|今だけ|限定|半額|コスパ|安い|お得|送料/ },
    { key: 'proof', label: '社会的証明', re: /レビュー|口コミ|売れ|人気|万個|万本|累計|リピ|話題|バズ|みんな|1位|１位|ランキング|星[4５5]|★/ },
    { key: 'problem', label: '問題提起・共感', re: /悩|困|面倒|めんどう|ストレス|嫌|いや|苦手|失敗|大変|できない|イライラ|ずっと/ },
    { key: 'benefit', label: 'ベネフィット・実演', re: /だけで|簡単|すぐ|楽|らく|きれい|綺麗|キレイ|効果|変わ|できる|使い方|見て|ほら|しっかり|一瞬|時短/ },
    { key: 'product', label: '商品紹介', re: /これ|この|紹介|商品|アイテム|見つけ|使って|買った|届い|ゲット/ }
  ];
  var SECTION_LABEL = { hook: 'フック', other: '説明' };
  SECTIONS.forEach(function (s) { SECTION_LABEL[s.key] = s.label; });

  function splitSentences(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/([。！？!?]+)/g, '$1\n')
      .split(/\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function charCount(s) { return String(s || '').replace(/\s/g, '').length; }

  function hookTypesOf(text) {
    return HOOK_TYPES.filter(function (h) { return h.re.test(text); });
  }

  function sectionOf(sentence) {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].re.test(sentence)) return SECTIONS[i].key;
    }
    return 'other';
  }

  function grade(value, bands) {
    // bands: [[threshold, label], ...] 大きい順
    for (var i = 0; i < bands.length; i++) if (value >= bands[i][0]) return bands[i][1];
    return bands[bands.length - 1][1];
  }

  function analyzeVideo(v) {
    var views = num(v.views), likes = num(v.likes), comments = num(v.comments);
    var saves = num(v.saves), shares = num(v.shares), followers = num(v.followers);
    var duration = num(v.duration);

    var interactions = likes + comments + saves + shares;
    var pct = function (x) { return views > 0 ? x / views * 100 : 0; };
    var metrics = {
      engagementRate: pct(interactions),
      likeRate: pct(likes),
      commentRate: pct(comments),
      saveRate: pct(saves),
      shareRate: pct(shares),
      viewsPerFollower: followers > 0 ? views / followers : null
    };

    var hasNumbers = views > 0;
    var scores = {
      reach: logScore(views, 1000000),                       // 100万再生で満点
      engagement: clamp(metrics.engagementRate / 12 * 100, 0, 100), // ER12%で満点
      save: clamp(metrics.saveRate / 1.5 * 100, 0, 100),     // 保存率1.5%で満点（購買意欲の目安）
      share: clamp(metrics.shareRate / 0.8 * 100, 0, 100)    // シェア率0.8%で満点
    };
    var total = hasNumbers
      ? Math.round(scores.reach * 0.25 + scores.engagement * 0.4 + scores.save * 0.2 + scores.share * 0.15)
      : null;
    var rank = total == null ? '-' : total >= 75 ? 'S' : total >= 60 ? 'A' : total >= 45 ? 'B' : 'C';

    // ---- 台本分析 ----
    var sentences = splitSentences(v.transcript);
    var hookText = String(v.hook || '').trim() || sentences[0] || '';
    var totalChars = charCount(v.transcript) || charCount(hookText);
    var cps = duration > 0 && totalChars > 0 ? totalChars / duration : 0;
    var cpsForTiming = cps || 7; // 日本語の標準的な話速（文字/秒）
    var hookSec = charCount(hookText) / cpsForTiming;

    var timeline = [];
    var acc = 0;
    sentences.forEach(function (s, i) {
      var c = charCount(s);
      var start = totalChars ? acc / totalChars * (duration || totalChars / cpsForTiming) : 0;
      acc += c;
      timeline.push({ text: s, section: i === 0 ? 'hook' : sectionOf(s), start: start });
    });

    var present = {};
    timeline.forEach(function (t) { present[t.section] = true; });
    var ctaIdx = -1;
    timeline.forEach(function (t, i) { if (t.section === 'cta') ctaIdx = i; });
    var hookTypes = hookTypesOf(hookText);

    var checks = [];
    function check(ok, label, detail) { checks.push({ ok: !!ok, label: label, detail: detail }); }
    if (hookText) check(hookSec <= 3.5, 'フックが冒頭3秒前後で終わる', 'フック約' + hookSec.toFixed(1) + '秒');
    if (hookText) check(hookTypes.length > 0, 'フックに型がある', hookTypes.length ? hookTypes.map(function (h) { return h.label; }).join('・') : '型が見つからない');
    if (sentences.length) {
      check(present.problem || present.benefit, '悩み or ベネフィットを語っている', '');
      check(present.proof, '社会的証明（売れている・レビュー）がある', '');
      check(present.offer, '価格・お得感に触れている', '');
      check(ctaIdx >= 0, 'CTA（カゴ・リンクへの誘導）がある', '');
      if (ctaIdx >= 0) check(ctaIdx >= timeline.length * 0.6, 'CTAが後半にある', '');
    }
    if (duration > 0) check(duration >= 15 && duration <= 60, '長さが15〜60秒', duration + '秒');
    if (cps > 0) check(cps >= 6 && cps <= 10, 'テンポが良い（6〜10文字/秒）', cps.toFixed(1) + '文字/秒');

    // ---- 真似ポイント / 改善点 ----
    var copy = [], caution = [];
    if (metrics.saveRate >= 1) copy.push('保存率が高い（' + metrics.saveRate.toFixed(2) + '%）＝「あとで買う」と思わせる情報量がある。使い方や比較など保存したくなる要素を真似する');
    if (metrics.shareRate >= 0.5) copy.push('シェアされやすい（' + metrics.shareRate.toFixed(2) + '%）。人に教えたくなる驚き・あるあるネタがある');
    if (metrics.commentRate >= 0.5) copy.push('コメントが多い。質問や意見が出やすい投げかけ・ツッコミどころがある');
    if (metrics.viewsPerFollower != null && metrics.viewsPerFollower >= 3) copy.push('フォロワーの' + metrics.viewsPerFollower.toFixed(1) + '倍再生＝おすすめに乗っている。フックと構成が強い証拠');
    hookTypes.forEach(function (h) { copy.push('フック「' + h.label + '」型：' + h.tip); });
    if (present.proof) copy.push('「売れている・レビューが良い」で信頼を作ってから勧めている');
    if (present.offer) copy.push('価格やお得感を明示して購入のハードルを下げている');
    if (ctaIdx >= 0) copy.push('最後に具体的な行動（カゴ・リンク）を指示している');

    if (hasNumbers && metrics.engagementRate < 3) caution.push('エンゲージメント率が低め（' + metrics.engagementRate.toFixed(1) + '%）。再生は広告や一時的な露出かも');
    if (hookText && hookSec > 3.5) caution.push('フックが長い。真似するなら最初の一文を短くする');
    if (sentences.length && ctaIdx < 0) caution.push('CTAがない。自分の動画では必ず入れる');
    if (sentences.length && !present.proof) caution.push('社会的証明がない。「〇万個売れてる」等を足すと強くなる');
    if (cps > 10) caution.push('早口すぎる可能性（' + cps.toFixed(1) + '文字/秒）。テロップ必須');

    return {
      metrics: metrics,
      scores: scores,
      total: total,
      rank: rank,
      hookText: hookText,
      hookSec: hookSec,
      hookTypes: hookTypes.map(function (h) { return { key: h.key, label: h.label }; }),
      charsPerSec: cps,
      timeline: timeline,
      checks: checks,
      copy: copy,
      caution: caution
    };
  }

  /** 分析済みの動画群から「勝ちパターン」を集計する（スコア上位の傾向） */
  function patterns(videos) {
    var rows = videos.map(function (v) { return { v: v, a: analyzeVideo(v) }; })
      .filter(function (r) { return r.a.total != null; })
      .sort(function (x, y) { return y.a.total - x.a.total; });
    if (rows.length < 2) return null;
    var top = rows.slice(0, Math.max(1, Math.ceil(rows.length / 2)));
    var hookCount = {};
    var durs = [], cpss = [], withCta = 0, withProof = 0, withScript = 0;
    top.forEach(function (r) {
      r.a.hookTypes.forEach(function (h) { hookCount[h.label] = (hookCount[h.label] || 0) + 1; });
      if (num(r.v.duration) > 0) durs.push(num(r.v.duration));
      if (r.a.charsPerSec > 0) cpss.push(r.a.charsPerSec);
      if (r.a.timeline.length) {
        withScript++;
        if (r.a.timeline.some(function (t) { return t.section === 'cta'; })) withCta++;
        if (r.a.timeline.some(function (t) { return t.section === 'proof'; })) withProof++;
      }
    });
    var avg = function (a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; };
    return {
      sampleSize: top.length,
      total: rows.length,
      hooks: Object.keys(hookCount).map(function (k) { return { label: k, count: hookCount[k] }; })
        .sort(function (a, b) { return b.count - a.count; }),
      avgDuration: avg(durs),
      avgCps: avg(cpss),
      ctaRate: withScript ? withCta / withScript : null,
      proofRate: withScript ? withProof / withScript : null,
      avgEngagement: avg(top.map(function (r) { return r.a.metrics.engagementRate; }))
    };
  }

  /** Claude に深掘りしてもらうためのプロンプト */
  function buildPrompt(v, a) {
    var m = a.metrics;
    var lines = [
      'あなたはTikTok Shopアフィリエイト動画の分析のプロです。',
      '次の動画を分析し、自分が同じジャンルで売れる動画を作るためのヒントを日本語で教えてください。',
      '',
      '## 動画データ',
      '- 商品: ' + (v.productName || '不明'),
      '- 投稿者: ' + (v.creator || '不明'),
      '- 長さ: ' + (num(v.duration) || '不明') + '秒',
      '- 再生数: ' + num(v.views) + ' / いいね: ' + num(v.likes) + ' / コメント: ' + num(v.comments) +
        ' / 保存: ' + num(v.saves) + ' / シェア: ' + num(v.shares),
      '- エンゲージメント率: ' + m.engagementRate.toFixed(2) + '% / 保存率: ' + m.saveRate.toFixed(2) + '%',
      '',
      '## 台本（文字起こし）',
      String(v.transcript || '(なし)').slice(0, 6000),
      v.memo ? '\n## 映像メモ\n' + String(v.memo).slice(0, 2000) : '',
      '',
      '## 出してほしいもの',
      '1. フック（冒頭3秒）が効いている理由（心理効果）',
      '2. 構成の流れ（フック→…→CTA）と、それぞれの役割',
      '3. この動画が売れている／伸びている理由トップ3',
      '4. 弱点・自分なら改善するところ',
      '5. この型を使った、別の商品でも使える30秒の台本テンプレート（[商品名]などの穴埋め式）',
      '箇条書き中心で、簡潔にお願いします。'
    ];
    return lines.filter(function (l) { return l !== null; }).join('\n');
  }

  var api = {
    analyzeVideo: analyzeVideo,
    patterns: patterns,
    buildPrompt: buildPrompt,
    splitSentences: splitSentences,
    SECTION_LABEL: SECTION_LABEL,
    num: num
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VideoAnalysis = api;
})(this);
