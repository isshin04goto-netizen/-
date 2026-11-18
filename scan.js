/*
 * スクショ・動画からの自動読み取り
 * - プロンプトの組み立てと、Claudeの返答を入力欄の値に整える処理（Node でもテスト可）
 * - 動画ファイルからコマを切り出す処理（ブラウザのみ）
 */
(function (root) {
  'use strict';

  function toNum(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return isFinite(v) ? v : '';
    var s = String(v).replace(/[,，\s円¥%％]/g, '');
    var mult = 1;
    if (/万/.test(s)) mult = 10000;
    else if (/[kK]$/.test(s)) mult = 1000;
    else if (/[mM]$/.test(s)) mult = 1000000;
    var n = parseFloat(s);
    return isFinite(n) ? Math.round(n * mult * 100) / 100 : '';
  }
  function toStr(v, max) { return v == null ? '' : String(v).trim().slice(0, max || 4000); }

  var PRODUCT_PROMPT = [
    'これらの画像は TikTok Shop の商品ページ、またはアフィリエイト（クリエイター）センターの商品画面のスクリーンショットです。',
    '画像に写っている情報だけを読み取り、次の形の JSON オブジェクトだけを返してください。読み取れない項目は null にしてください。推測で数字を作らないでください。',
    '{',
    '  "name": 商品名（短く）,',
    '  "category": 商品カテゴリ（美容、キッチン、ガジェット、ファッション、ペット、食品 など日本語で一語）,',
    '  "price": 販売価格（円の数値。セール価格があればそちら）,',
    '  "commissionRate": アフィリエイト手数料率（%の数値。「コミッション」「報酬率」など）,',
    '  "monthlySales": 販売数（数値。「1.2万件販売」は12000。期間が月でなければその数値のまま）,',
    '  "salesPeriod": 販売数の期間（"月間" "累計" "不明" など）,',
    '  "rating": 評価（0〜5の数値）,',
    '  "reviews": レビュー数（数値）,',
    '  "creators": この商品を紹介しているクリエイター数（数値）,',
    '  "visual": この商品が短い動画で魅力を伝えやすいかのあなたの評価（1〜5の整数。使用前後の変化、驚き、実演のしやすさで判断）,',
    '  "memo": 動画で使えそうな訴求ポイントと気づき（日本語80字以内）',
    '}'
  ].join('\n');

  function videoPrompt(opts) {
    var lines = [
      'これらの画像は、TikTok の商品紹介動画に関するものです。'
    ];
    if (opts.screenshots) lines.push('最初の' + opts.screenshots + '枚は動画画面やプロフィールのスクリーンショットです（再生数・いいね・コメント・保存・シェアの数字、投稿者名、キャプションが写っていることがあります）。');
    if (opts.frameTimes && opts.frameTimes.length) {
      lines.push('残りの' + opts.frameTimes.length + '枚は、長さ' + Math.round(opts.duration) + '秒の動画から時間順に切り出したコマです（それぞれ ' +
        opts.frameTimes.map(function (t) { return t.toFixed(1) + '秒'; }).join('、') + ' の時点）。');
    }
    lines.push(
      '画像に写っている情報だけを読み取り、次の形の JSON オブジェクトだけを返してください。読み取れない項目は null。推測で数字を作らないでください。',
      '{',
      '  "creator": 投稿者のアカウント名（@から）,',
      '  "productName": 紹介している商品名（短く）,',
      '  "views": 再生数, "likes": いいね数, "comments": コメント数, "saves": 保存数, "shares": シェア数（すべて数値。「1.2万」は12000、「3.4K」は3400）,',
      '  "transcript": 動画内のテロップ・字幕を時間順に書き起こしたもの（1文ごとに改行。同じテロップの重複は1回に。テロップがなければキャプション）,',
      '  "hook": 冒頭（最初のコマ）のテロップや一言,',
      '  "memo": 映像・編集の特徴（顔出しの有無、構図、カットの速さ、テロップの大きさ、ビフォーアフターなど。日本語120字以内）',
      '}'
    );
    return lines.join('\n');
  }

  function normalizeProduct(r) {
    r = r || {};
    var memo = toStr(r.memo, 300);
    var period = toStr(r.salesPeriod, 20);
    if (period && !/月/.test(period) && r.monthlySales != null) memo = (memo ? memo + '\n' : '') + '※販売数は「' + period + '」の値（月間ではない可能性）';
    var visual = toNum(r.visual);
    return {
      name: toStr(r.name, 120),
      category: toStr(r.category, 30),
      price: toNum(r.price),
      commissionRate: toNum(r.commissionRate),
      monthlySales: toNum(r.monthlySales),
      rating: toNum(r.rating),
      reviews: toNum(r.reviews),
      creators: toNum(r.creators),
      visual: visual === '' ? 3 : Math.max(1, Math.min(5, Math.round(visual))),
      url: '',
      memo: memo
    };
  }

  function normalizeVideo(r, duration) {
    r = r || {};
    return {
      productName: toStr(r.productName, 120),
      creator: toStr(r.creator, 60),
      url: '',
      views: toNum(r.views),
      likes: toNum(r.likes),
      comments: toNum(r.comments),
      saves: toNum(r.saves),
      shares: toNum(r.shares),
      duration: duration ? Math.round(duration) : '',
      followers: '',
      transcript: toStr(r.transcript, 6000),
      hook: toStr(r.hook, 200),
      memo: toStr(r.memo, 400)
    };
  }

  /** 動画ファイルから n コマを JPEG で切り出す（ブラウザのみ） */
  function extractFrames(file, n) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      video.setAttribute('playsinline', '');
      var cleanup = function () { URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); };
      var fail = function (msg) { cleanup(); reject(new Error(msg)); };
      var timer = setTimeout(function () { fail('動画を読み込めませんでした'); }, 20000);

      video.onerror = function () { clearTimeout(timer); fail('この形式の動画は読み込めませんでした'); };
      video.onloadedmetadata = function () {
        clearTimeout(timer);
        var d = video.duration;
        if (!isFinite(d) || d <= 0) { fail('動画の長さを読み取れませんでした'); return; }
        var times = [];
        for (var i = 0; i < n; i++) times.push(Math.min(d - 0.05, (i === 0 ? 0.3 : d * i / n + d / n / 2)));
        var w = video.videoWidth || 720, h = video.videoHeight || 1280;
        var scale = Math.min(1, 1280 / Math.max(w, h));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        var ctx = canvas.getContext('2d');
        var frames = [];
        var next = function (k) {
          if (k >= times.length) { cleanup(); resolve({ frames: frames, duration: d }); return; }
          var t2 = setTimeout(function () { fail('動画のコマを取り出せませんでした'); }, 10000);
          video.onseeked = function () {
            clearTimeout(t2);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function (blob) {
              if (blob) frames.push({ blob: blob, t: times[k] });
              next(k + 1);
            }, 'image/jpeg', 0.82);
          };
          video.currentTime = times[k];
        };
        next(0);
      };
      video.src = url;
    });
  }

  var api = {
    PRODUCT_PROMPT: PRODUCT_PROMPT,
    videoPrompt: videoPrompt,
    normalizeProduct: normalizeProduct,
    normalizeVideo: normalizeVideo,
    extractFrames: extractFrames,
    toNum: toNum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scan = api;
})(this);
