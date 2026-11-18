(function () {
  'use strict';

  var S = window.Scoring;
  var V = window.VideoAnalysis;
  var Store = window.Store;

  // ---------- helpers ----------
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function yen(n) { return '¥' + Math.round(n || 0).toLocaleString('ja-JP'); }
  function int(n) { return Math.round(n || 0).toLocaleString('ja-JP'); }
  function compact(n) {
    n = +n || 0;
    if (n >= 10000) return (Math.round(n / 1000) / 10).toLocaleString('ja-JP') + '万';
    return int(n);
  }
  function pct(n, d) { return (n || 0).toFixed(d == null ? 1 : d) + '%'; }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function pref(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
  function setPref(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* ignore */ } }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function failed(e) { toast('保存できませんでした。通信状態を確認してもう一度お試しください。'); console.error(e); }

  function confirmAsk(msg, yesLabel) {
    return new Promise(function (resolve) {
      var d = $('#dlg-confirm');
      $('#confirm-msg').textContent = msg;
      $('#confirm-yes').textContent = yesLabel || '削除する';
      var done = function (v) { $('#confirm-yes').onclick = $('#confirm-no').onclick = null; d.close(); resolve(v); };
      $('#confirm-yes').onclick = function () { done(true); };
      $('#confirm-no').onclick = function () { done(false); };
      d.oncancel = function () { resolve(false); };
      d.showModal();
    });
  }

  // ---------- tabs ----------
  function showTab(name) {
    ['products', 'videos'].forEach(function (t) {
      $('#panel-' + t).hidden = t !== name;
      $('#tab-' + t).setAttribute('aria-selected', String(t === name));
    });
    setPref('pa.tab', name);
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.onclick = function () { showTab(b.dataset.tab); };
  });

  // =====================================================================
  // 商品分析
  // =====================================================================
  var FIELDS = [
    ['name', '商品名'], ['category', 'カテゴリ'], ['price', '価格'], ['commissionRate', '手数料率'],
    ['monthlySales', '月間販売数'], ['rating', '評価'], ['reviews', 'レビュー数'],
    ['creators', '紹介クリエイター数'], ['visual', '動画映え'], ['url', 'URL'], ['memo', 'メモ']
  ];
  var NUMERIC = ['price', 'commissionRate', 'monthlySales', 'rating', 'reviews', 'creators', 'visual'];
  var editingId = null, viewingId = null;

  function products() { return Store.list('products'); }
  function weights() { return Object.assign({}, S.DEFAULT_WEIGHTS, (Store.settings() || {}).weights || {}); }
  function findProduct(id) { return products().find(function (x) { return x.id === id; }); }

  function renderProducts() {
    var w = weights();
    var q = $('#filter').value.trim().toLowerCase();
    var sort = $('#sort').value;
    var all = products().map(function (p) { return { p: p, a: S.analyze(p, w) }; });
    var rows = all.filter(function (r) {
      return !q || (r.p.name + ' ' + (r.p.category || '')).toLowerCase().indexOf(q) >= 0;
    });
    var key = {
      total: function (r) { return r.a.total; },
      commission: function (r) { return r.a.commission; },
      income: function (r) { return r.a.estMonthlyIncome; },
      demand: function (r) { return r.a.scores.demand; },
      created: function (r) { return r.p.createdAt || 0; }
    }[sort];
    rows.sort(function (x, y) { return key(y) - key(x); });

    $('#list').innerHTML = rows.map(function (r) {
      var p = r.p, a = r.a;
      return '<li class="item" data-id="' + esc(p.id) + '" tabindex="0">' +
        '<div class="rank rank-' + a.rank + '">' + a.rank + '<small>' + a.total + '点</small></div>' +
        '<div><h3>' + esc(p.name) + '</h3>' +
        '<div class="meta">' + (p.sample ? '<span class="chip">サンプル</span>' : '') +
        (p.category ? '<span class="chip">' + esc(p.category) + '</span>' : '') +
        yen(+p.price) + ' ・ 手数料' + (+p.commissionRate || 0) + '% ・ 月' + int(+p.monthlySales) + '件</div></div>' +
        '<div class="money"><b>' + yen(a.commission) + '</b><span>/件</span></div>' +
        '</li>';
    }).join('');

    $('#empty').hidden = all.length > 0;
    if (all.length) {
      var avg = all.reduce(function (s, r) { return s + r.a.total; }, 0) / all.length;
      var top = all.filter(function (r) { return r.a.rank === 'S' || r.a.rank === 'A'; }).length;
      $('#summary').innerHTML =
        '<div class="stat"><b>' + all.length + '</b><span>登録商品</span></div>' +
        '<div class="stat"><b>' + top + '</b><span>S・Aランク</span></div>' +
        '<div class="stat"><b>' + Math.round(avg) + '点</b><span>平均スコア</span></div>';
    } else {
      $('#summary').innerHTML = '';
    }

    var cats = {}, names = {};
    products().forEach(function (p) { if (p.category) cats[p.category] = 1; if (p.name) names[p.name] = 1; });
    $('#cats').innerHTML = Object.keys(cats).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    $('#prodnames').innerHTML = Object.keys(names).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
  }

  var form = $('#form');
  function formData() {
    var d = {};
    FIELDS.forEach(function (f) {
      var el = form.elements[f[0]];
      d[f[0]] = NUMERIC.indexOf(f[0]) >= 0 ? (el.value === '' ? '' : +el.value) : el.value.trim();
    });
    return d;
  }
  function openForm(p) {
    editingId = p ? p.id : null;
    $('#form-title').textContent = p ? '商品を編集' : '商品を追加';
    form.reset();
    FIELDS.forEach(function (f) { if (p && p[f[0]] != null) form.elements[f[0]].value = p[f[0]]; });
    if (!p) form.elements.visual.value = 3;
    updatePreview();
    $('#dlg-form').showModal();
  }
  function updatePreview() {
    var d = formData();
    $('#visual-out').textContent = d.visual;
    if (!d.price && !d.monthlySales) { $('#preview').innerHTML = ''; return; }
    var a = S.analyze(d, weights());
    $('#preview').innerHTML = '仮スコア <b>' + a.rank + '（' + a.total + '点）</b> ・ 報酬 ' +
      yen(a.commission) + '/件 ・ 想定月収 ' + yen(a.estMonthlyIncome);
  }
  form.addEventListener('input', updatePreview);
  $('#btn-cancel').onclick = function () { $('#dlg-form').close(); };
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = formData();
    if (!d.name) return;
    var item;
    if (editingId) {
      item = Object.assign({}, findProduct(editingId), d);
      delete item.sample;
    } else {
      item = Object.assign(d, { id: Store.uid(), createdAt: Date.now() });
    }
    var reopen = editingId;
    Store.put('products', item).then(function () { toast('保存しました'); if (reopen) openDetail(reopen); }, failed);
    $('#dlg-form').close();
  });

  function openDetail(id) {
    var p = findProduct(id);
    if (!p) return;
    viewingId = id;
    var a = S.analyze(p, weights());
    var url = safeUrl(p.url);
    var bars = Object.keys(S.LABELS).map(function (k) {
      var v = Math.round(a.scores[k]);
      return '<div class="bar"><span>' + S.LABELS[k] + '</span><div class="track"><div class="fill" style="width:' + v + '%"></div></div><output>' + v + '</output></div>';
    }).join('');
    var list = function (arr, cls) {
      return '<ul class="adv ' + cls + '">' + arr.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    };
    var related = videos().filter(function (v) { return v.productName && v.productName === p.name; });

    $('#detail').innerHTML =
      '<div class="detail-head"><div class="rank rank-' + a.rank + '">' + a.rank + '<small>' + a.total + '点</small></div>' +
      '<div><h2>' + esc(p.name) + '</h2><div class="meta">' + esc(p.category || 'カテゴリなし') + '</div></div></div>' +
      '<div class="kv">' +
      '<div><b>' + yen(a.commission) + '</b><span>1件あたり報酬</span></div>' +
      '<div><b>' + yen(a.estMonthlyIncome) + '</b><span>想定月収（目安）</span></div>' +
      '<div><b>' + int(a.salesPerCreator) + '件</b><span>紹介者1人あたり販売数/月</span></div>' +
      '<div><b>★' + (p.rating || '-') + '（' + int(+p.reviews) + '件）</b><span>評価</span></div>' +
      '</div>' +
      '<div class="bars">' + bars + '</div>' +
      (a.advice.good.length ? '<h3>強み</h3>' + list(a.advice.good, 'good') : '') +
      (a.advice.bad.length ? '<h3>注意点</h3>' + list(a.advice.bad, 'bad') : '') +
      (related.length ? '<h3>この商品の分析済み動画</h3><p class="meta">' + related.length + '本。「動画分析」タブで確認できます。</p>' : '') +
      (p.memo ? '<h3>メモ</h3><div class="memo">' + esc(p.memo) + '</div>' : '') +
      (url ? '<p><a href="' + esc(url) + '" target="_blank" rel="noopener">商品ページを開く</a></p>' : '') +
      '<p class="hint">想定月収は「紹介者1人あたり販売数の10%を自分が獲得できた場合」の目安です。</p>';
    $('#dlg-detail').showModal();
  }

  function bindList(sel, open) {
    $(sel).addEventListener('click', function (e) {
      var li = e.target.closest('.item'); if (li) open(li.dataset.id);
    });
    $(sel).addEventListener('keydown', function (e) {
      var li = e.target.closest('.item');
      if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(li.dataset.id); }
    });
  }
  bindList('#list', openDetail);
  $('#btn-close').onclick = function () { $('#dlg-detail').close(); };
  $('#btn-edit').onclick = function () { var p = findProduct(viewingId); $('#dlg-detail').close(); openForm(p); };
  $('#btn-del').onclick = function () {
    var p = findProduct(viewingId); if (!p) return;
    $('#dlg-detail').close();
    confirmAsk('「' + p.name + '」を削除しますか？').then(function (ok) {
      if (ok) Store.remove('products', p.id).then(function () { toast('削除しました'); }, failed);
    });
  };

  // CSV
  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
  }
  var ALIASES = {
    name: ['商品名', 'name', '商品', 'product'],
    category: ['カテゴリ', 'カテゴリー', 'category'],
    price: ['価格', 'price', '販売価格'],
    commissionRate: ['手数料率', 'commission', 'commissionrate', 'コミッション率', '報酬率'],
    monthlySales: ['月間販売数', 'sales', 'monthlysales', '販売数'],
    rating: ['評価', 'rating', '星'],
    reviews: ['レビュー数', 'reviews', 'レビュー'],
    creators: ['紹介クリエイター数', 'creators', 'クリエイター数', '競合数'],
    visual: ['動画映え', 'visual'],
    url: ['url', '商品url', 'リンク'],
    memo: ['メモ', 'memo', 'note', '備考']
  };
  function importCSV(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) { toast('データ行が見つかりませんでした。1行目に見出し、2行目からデータを入れてください。'); return; }
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/[\s（(].*$/, ''); });
    var map = {};
    Object.keys(ALIASES).forEach(function (k) {
      var idx = head.findIndex(function (h) { return ALIASES[k].indexOf(h) >= 0; });
      if (idx >= 0) map[k] = idx;
    });
    if (map.name == null) { toast('「商品名」の列が見つかりませんでした。見出しの名前を確認してください。'); return; }
    var now = Date.now(), items = [];
    rows.slice(1).forEach(function (r, i) {
      var d = { id: Store.uid(), createdAt: now + i };
      Object.keys(map).forEach(function (k) {
        var v = (r[map[k]] || '').trim();
        d[k] = NUMERIC.indexOf(k) >= 0 ? (v === '' ? '' : parseFloat(v.replace(/[,，円%％¥\s]/g, '')) || 0) : v;
      });
      if (d.visual === '' || d.visual == null) d.visual = 3;
      if (d.name) items.push(d);
    });
    Store.putMany('products', items).then(function () { toast(items.length + '件の商品を取り込みました'); }, failed);
  }
  function exportCSV() {
    var w = weights();
    var cell = function (v) {
      v = v == null ? '' : String(v);
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var lines = [FIELDS.map(function (f) { return f[1]; }).concat(['総合スコア', 'ランク', '報酬/件']).join(',')];
    products().forEach(function (p) {
      var a = S.analyze(p, w);
      lines.push(FIELDS.map(function (f) { return cell(p[f[0]]); }).concat([a.total, a.rank, Math.round(a.commission)]).join(','));
    });
    var data = '﻿' + lines.join('\r\n');
    var filename = '商品分析_' + new Date().toISOString().slice(0, 10) + '.csv';
    var dl = Store.caps.downloads;
    if (dl) {
      dl.save({ filename: filename, data: data }).catch(function (e) {
        if (e && e.code !== 'declined') toast('書き出せませんでした（' + (e.code || 'エラー') + '）');
      });
      return;
    }
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
    link.download = filename;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }
  $('#csv-in').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { importCSV(reader.result); e.target.value = ''; };
    reader.readAsText(f, 'utf-8');
  });
  $('#btn-export').onclick = function () {
    if (!products().length) { toast('書き出す商品がありません'); return; }
    exportCSV();
  };
  $('#btn-clear').onclick = function () {
    if (!products().length) return;
    confirmAsk('登録した商品' + products().length + '件をすべて削除しますか？元に戻せません。', 'すべて削除').then(function (ok) {
      if (ok) Store.clear('products').then(function () { toast('削除しました'); }, failed);
    });
  };
  function loadProductSamples() {
    var now = Date.now();
    var sample = [
      { name: '毛穴吸引美顔器', category: '美容', price: 3980, commissionRate: 20, monthlySales: 4200, rating: 4.4, reviews: 1820, creators: 60, visual: 5, memo: 'ビフォーアフターが強い。小鼻のアップで見せる' },
      { name: '折りたたみシリコン保存容器 4点', category: 'キッチン', price: 2480, commissionRate: 15, monthlySales: 9800, rating: 4.6, reviews: 5300, creators: 310, visual: 4 },
      { name: 'ワイヤレスイヤホン Pro', category: 'ガジェット', price: 8980, commissionRate: 8, monthlySales: 1500, rating: 4.1, reviews: 640, creators: 140, visual: 2 },
      { name: '韓国ヘアオイル', category: '美容', price: 1980, commissionRate: 25, monthlySales: 12000, rating: 4.7, reviews: 9100, creators: 820, visual: 3 },
      { name: 'ペット用自動給水器', category: 'ペット', price: 4580, commissionRate: 18, monthlySales: 650, rating: 4.5, reviews: 85, creators: 6, visual: 4, memo: '紹介者が少ない。猫動画と相性◎' }
    ].map(function (p, i) { return Object.assign(p, { id: Store.uid() + i, createdAt: now + i, sample: true }); });
    Store.putMany('products', sample).then(function () { toast('サンプル商品を読み込みました'); }, failed);
  }
  $('#btn-sample').onclick = loadProductSamples;
  $('#btn-sample-empty').onclick = loadProductSamples;

  function renderWeights() {
    var w = weights();
    $('#weights').innerHTML = Object.keys(S.LABELS).map(function (k) {
      return '<label><span>' + S.LABELS[k] + '</span><input id="w-' + k + '" type="range" min="0" max="50" step="5" data-k="' + k + '" value="' + w[k] + '"><output>' + w[k] + '</output></label>';
    }).join('');
  }
  $('#weights').addEventListener('input', function (e) {
    var k = e.target.dataset.k;
    if (!k) return;
    var w = weights(); w[k] = +e.target.value;
    e.target.nextElementSibling.textContent = w[k];
    Store.setSettings({ weights: w });
  });
  $('#btn-reset-w').onclick = function () {
    Store.setSettings({ weights: Object.assign({}, S.DEFAULT_WEIGHTS) });
    renderWeights();
  };

  $('#btn-add').onclick = function () { openForm(null); };
  $('#sort').value = pref('pa.sort.v1', 'total').replace(/"/g, '');
  $('#sort').onchange = function () { setPref('pa.sort.v1', $('#sort').value); renderProducts(); };
  $('#filter').oninput = renderProducts;

  // =====================================================================
  // 動画分析
  // =====================================================================
  var VFIELDS = ['productName', 'creator', 'url', 'views', 'likes', 'comments', 'saves', 'shares', 'duration', 'followers', 'transcript', 'hook', 'memo'];
  var VNUM = ['views', 'likes', 'comments', 'saves', 'shares', 'duration', 'followers'];
  var vEditingId = null, vViewingId = null, aiCtl = null;

  function videos() { return Store.list('videos'); }
  function findVideo(id) { return videos().find(function (x) { return x.id === id; }); }

  function erTag(er) {
    if (er >= 10) return '<span class="tag good">とても高い</span>';
    if (er >= 6) return '<span class="tag good">高い</span>';
    if (er >= 3) return '<span class="tag mid">普通</span>';
    return '<span class="tag low">低い</span>';
  }

  function renderVideos() {
    var q = $('#vfilter').value.trim().toLowerCase();
    var sort = $('#vsort').value;
    var all = videos().map(function (v) { return { v: v, a: V.analyzeVideo(v) }; });
    var rows = all.filter(function (r) {
      return !q || ((r.v.productName || '') + ' ' + (r.v.creator || '')).toLowerCase().indexOf(q) >= 0;
    });
    var key = {
      total: function (r) { return r.a.total == null ? -1 : r.a.total; },
      er: function (r) { return r.a.metrics.engagementRate; },
      save: function (r) { return r.a.metrics.saveRate; },
      views: function (r) { return +r.v.views || 0; },
      created: function (r) { return r.v.createdAt || 0; }
    }[sort];
    rows.sort(function (x, y) { return key(y) - key(x); });

    $('#vlist').innerHTML = rows.map(function (r) {
      var v = r.v, a = r.a;
      var title = v.productName || v.creator || '（無題の動画）';
      return '<li class="item" data-id="' + esc(v.id) + '" tabindex="0">' +
        '<div class="rank rank-' + a.rank + '">' + a.rank + (a.total != null ? '<small>' + a.total + '点</small>' : '') + '</div>' +
        '<div><h3>' + esc(title) + '</h3>' +
        '<div class="meta">' + (v.sample ? '<span class="chip">サンプル</span>' : '') +
        (v.creator && v.productName ? esc(v.creator) + ' ・ ' : '') +
        a.hookTypes.slice(0, 2).map(function (h) { return '<span class="chip hook">' + esc(h.label) + '</span>'; }).join('') +
        '</div></div>' +
        '<div class="money"><b>' + compact(v.views) + '</b><span>再生 ・ ER ' + pct(a.metrics.engagementRate) + '</span></div>' +
        '</li>';
    }).join('');
    $('#vempty').hidden = all.length > 0;
    renderPatterns();
  }

  function renderPatterns() {
    var p = V.patterns(videos());
    if (!p) { $('#vpatterns').innerHTML = ''; return; }
    var hooks = p.hooks.length
      ? p.hooks.slice(0, 4).map(function (h) { return '<span class="chip hook">' + esc(h.label) + ' ×' + h.count + '</span>'; }).join('')
      : '<span class="meta">台本を入れるとフックの傾向が出ます</span>';
    var cell = function (val, label) { return '<div><b>' + val + '</b><span>' + label + '</span></div>'; };
    $('#vpatterns').innerHTML =
      '<section class="patterns"><h2>勝ちパターン</h2>' +
      '<p class="meta">スコア上位' + p.sampleSize + '本（全' + p.total + '本中）の共通点</p>' +
      '<div class="kv k3">' +
      cell(p.avgDuration != null ? Math.round(p.avgDuration) + '秒' : '-', '平均の長さ') +
      cell(p.avgCps != null ? p.avgCps.toFixed(1) + '字/秒' : '-', '話すテンポ') +
      cell(p.ctaRate != null ? Math.round(p.ctaRate * 100) + '%' : '-', 'CTAあり') +
      '</div><div>' + hooks + '</div></section>';
  }

  var vform = $('#vform');
  function vformData() {
    var d = {};
    VFIELDS.forEach(function (k) {
      var raw = vform.elements[k].value.trim();
      d[k] = VNUM.indexOf(k) >= 0 ? (raw === '' ? '' : V.num(raw)) : raw;
    });
    return d;
  }
  function openVForm(v) {
    vEditingId = v ? v.id : null;
    $('#vform-title').textContent = v ? '動画を編集' : '動画を分析';
    vform.reset();
    VFIELDS.forEach(function (k) { if (v && v[k] != null) vform.elements[k].value = v[k]; });
    updateVPreview();
    $('#dlg-vform').showModal();
  }
  function updateVPreview() {
    var d = vformData();
    if (!d.views && !d.transcript) { $('#vpreview').innerHTML = ''; return; }
    var a = V.analyzeVideo(d);
    var parts = [];
    if (a.total != null) parts.push('伸びスコア <b>' + a.rank + '（' + a.total + '点）</b> ・ ER ' + pct(a.metrics.engagementRate) + ' ・ 保存率 ' + pct(a.metrics.saveRate, 2));
    if (a.hookTypes.length) parts.push('フック: ' + a.hookTypes.map(function (h) { return esc(h.label); }).join('・'));
    $('#vpreview').innerHTML = parts.join('<br>') || '数字を入れるとスコアが出ます';
  }
  vform.addEventListener('input', updateVPreview);
  $('#btn-vcancel').onclick = function () { $('#dlg-vform').close(); };
  vform.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = vformData();
    if (!d.productName && !d.creator && !d.transcript && !d.views) { toast('商品名・数字・台本のどれかを入れてください'); return; }
    var item;
    if (vEditingId) {
      item = Object.assign({}, findVideo(vEditingId), d);
      delete item.sample;
    } else {
      item = Object.assign(d, { id: Store.uid(), createdAt: Date.now() });
    }
    var id = item.id;
    $('#dlg-vform').close();
    Store.put('videos', item).then(function () { openVDetail(id); }, failed);
  });

  function openVDetail(id) {
    var v = findVideo(id);
    if (!v) return;
    vViewingId = id;
    var a = V.analyzeVideo(v);
    var m = a.metrics;
    var url = safeUrl(v.url);
    var title = v.productName || v.creator || '（無題の動画）';
    var list = function (arr, cls) {
      return '<ul class="adv ' + cls + '">' + arr.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    };
    var html =
      '<div class="detail-head"><div class="rank rank-' + a.rank + '">' + a.rank + (a.total != null ? '<small>' + a.total + '点</small>' : '') + '</div>' +
      '<div><h2>' + esc(title) + '</h2><div class="meta">' + esc([v.creator, v.duration ? v.duration + '秒' : ''].filter(Boolean).join(' ・ ')) + '</div></div></div>';

    if (a.total != null) {
      html += '<div class="kv k3">' +
        '<div><b>' + compact(v.views) + '</b><span>再生</span></div>' +
        '<div><b>' + pct(m.engagementRate) + '</b><span>エンゲージメント率</span> ' + erTag(m.engagementRate) + '</div>' +
        '<div><b>' + pct(m.saveRate, 2) + '</b><span>保存率（購買意欲）</span></div>' +
        '<div><b>' + pct(m.likeRate) + '</b><span>いいね率</span></div>' +
        '<div><b>' + pct(m.shareRate, 2) + '</b><span>シェア率</span></div>' +
        '<div><b>' + (m.viewsPerFollower != null ? m.viewsPerFollower.toFixed(1) + '倍' : '-') + '</b><span>再生/フォロワー</span></div>' +
        '</div>';
      var bars = [['reach', '再生の規模'], ['engagement', '反応の強さ'], ['save', '保存されやすさ'], ['share', '拡散されやすさ']];
      html += '<div class="bars">' + bars.map(function (b) {
        var val = Math.round(a.scores[b[0]]);
        return '<div class="bar"><span>' + b[1] + '</span><div class="track"><div class="fill" style="width:' + val + '%"></div></div><output>' + val + '</output></div>';
      }).join('') + '</div>';
    }

    if (a.hookText) {
      html += '<h3>フック（冒頭 約' + a.hookSec.toFixed(1) + '秒）</h3><div class="hookbox">' + esc(a.hookText) + '</div>' +
        '<div style="margin-top:6px">' + (a.hookTypes.length
          ? a.hookTypes.map(function (h) { return '<span class="chip hook">' + esc(h.label) + '</span>'; }).join('')
          : '<span class="meta">決まった型は見つかりませんでした</span>') + '</div>';
    }
    if (a.timeline.length > 1) {
      html += '<h3>構成</h3><ol class="timeline">' + a.timeline.map(function (t) {
        var s = Math.round(t.start);
        return '<li><time>' + Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + '</time><p><span class="sec sec-' + t.section + '">' +
          esc(V.SECTION_LABEL[t.section]) + '</span>' + esc(t.text) + '</p></li>';
      }).join('') + '</ol><p class="hint">時間は文字数からの推定です。</p>';
    }
    if (a.checks.length) {
      html += '<h3>売れる型チェック</h3><ul class="checks">' + a.checks.map(function (c) {
        return '<li><span class="' + (c.ok ? 'ok' : 'ng') + '">' + (c.ok ? '✓' : '✗') + '</span><span>' + esc(c.label) +
          (c.detail ? ' <small>' + esc(c.detail) + '</small>' : '') + '</span></li>';
      }).join('') + '</ul>';
    }
    if (a.copy.length) html += '<h3>真似したいポイント</h3>' + list(a.copy, 'good');
    if (a.caution.length) html += '<h3>注意点・改善できるところ</h3>' + list(a.caution, 'bad');
    if (v.memo) html += '<h3>映像・編集メモ</h3><div class="memo">' + esc(v.memo) + '</div>';
    if (url) html += '<p><a href="' + esc(url) + '" target="_blank" rel="noopener">TikTokで動画を開く</a></p>';

    var hasSample = !!Store.caps.sample;
    html += '<section class="ai"><h3>Claudeで深掘り</h3>' +
      '<p class="meta">' + (hasSample
        ? 'フックの心理効果、売れている理由、別の商品にも使える台本テンプレートまで出します。あなたのClaudeプランの利用枠で動きます（APIキー不要）。'
        : 'プロンプトをコピーして claude.ai に貼り付けると、フックの心理効果や台本テンプレートまで深掘りできます。') + '</p>' +
      '<div class="row">' +
      (hasSample ? '<button id="ai-run" class="primary">' + (v.aiNote ? 'もう一度分析する' : 'AIで分析する') + '</button><button id="ai-stop" hidden>止める</button>' : '') +
      '<button id="ai-copy">プロンプトをコピー</button></div>' +
      '<textarea id="ai-prompt" rows="4" readonly hidden></textarea>' +
      '<div id="ai-out" class="ai-out">' + esc(v.aiNote || '') + '</div></section>';

    $('#vdetail').innerHTML = html;
    bindAI(v, a);
    if (!$('#dlg-vdetail').open) $('#dlg-vdetail').showModal();
  }

  function bindAI(v, a) {
    var prompt = V.buildPrompt(v, a);
    $('#ai-copy').onclick = function () {
      var fallback = function () {
        var ta = $('#ai-prompt'); ta.hidden = false; ta.value = prompt; ta.focus(); ta.select();
        toast('コピーできなかったので、表示した文章を長押しでコピーしてください');
      };
      try {
        navigator.clipboard.writeText(prompt).then(function () { toast('コピーしました。claude.ai に貼り付けてください'); }, fallback);
      } catch (e) { fallback(); }
    };
    var run = $('#ai-run');
    if (!run) return;
    run.onclick = function () {
      var sample = Store.caps.sample;
      if (!sample) return;
      if (aiCtl) aiCtl.abort();
      aiCtl = new AbortController();
      var out = $('#ai-out'), stop = $('#ai-stop');
      run.disabled = true; stop.hidden = false;
      out.textContent = '考え中…（30秒〜1分ほどかかります）';
      stop.onclick = function () { if (aiCtl) aiCtl.abort(); };
      sample(prompt + '\n\n見出しは「■」で始め、Markdown記号（#や**）は使わないでください。', {
        signal: aiCtl.signal,
        cache: false,
        onText: function (u) { out.textContent = u.text; }
      }).then(function (res) {
        out.textContent = res.text;
        var cur = findVideo(v.id);
        if (cur) Store.put('videos', Object.assign({}, cur, { aiNote: res.text })).catch(failed);
      }, function (e) {
        var code = e && e.code;
        out.textContent = (e && e.text) || v.aiNote || '';
        if (code === 'cancelled') return;
        var msg = {
          not_granted: 'Claudeの利用が許可されませんでした。「プロンプトをコピー」から claude.ai で使えます。',
          sampling_disabled: 'このアカウントではここからClaudeを使えません。「プロンプトをコピー」をお使いください。',
          rate_limited: '利用が混み合っているか、利用枠の上限です。少し時間をおいてお試しください。',
          refused: 'この内容は分析できませんでした。台本の内容を見直してください。',
          prompt_too_large: '台本が長すぎます。短くしてお試しください。'
        }[code] || 'うまくいきませんでした。少し時間をおいてもう一度お試しください。';
        toast(msg);
        if (code === 'not_granted' || code === 'sampling_disabled') { Store.caps.sample = null; run.hidden = true; }
      }).then(function () {
        run.disabled = false; stop.hidden = true; aiCtl = null;
      });
    };
  }

  bindList('#vlist', openVDetail);
  $('#btn-vclose').onclick = function () { if (aiCtl) aiCtl.abort(); $('#dlg-vdetail').close(); };
  $('#dlg-vdetail').addEventListener('close', function () { if (aiCtl) aiCtl.abort(); vViewingId = null; });
  $('#btn-vedit').onclick = function () { var v = findVideo(vViewingId); $('#dlg-vdetail').close(); openVForm(v); };
  $('#btn-vdel').onclick = function () {
    var v = findVideo(vViewingId); if (!v) return;
    $('#dlg-vdetail').close();
    confirmAsk('この動画の分析を削除しますか？').then(function (ok) {
      if (ok) Store.remove('videos', v.id).then(function () { toast('削除しました'); }, failed);
    });
  };
  $('#btn-vclear').onclick = function () {
    if (!videos().length) return;
    confirmAsk('分析した動画' + videos().length + '件をすべて削除しますか？元に戻せません。', 'すべて削除').then(function (ok) {
      if (ok) Store.clear('videos').then(function () { toast('削除しました'); }, failed);
    });
  };

  function loadVideoSamples() {
    var now = Date.now();
    var sample = [
      {
        productName: '毛穴吸引美顔器', creator: '@sample_beauty', duration: 28, followers: 42000,
        views: 860000, likes: 61000, comments: 1300, saves: 14200, shares: 5100,
        transcript: 'え、まだ指で毛穴の汚れ押し出してるの？\nそれ肌が傷つくからやめて。\n私もずっと小鼻の黒ずみに悩んでました。\nでもこれ、当てて滑らせるだけで、ほら見て、この汚れ。\n吸引は3段階で、敏感肌でも痛くない。\nもう累計10万台売れてて、レビューも星4.4。\n今ならセールで3980円、クーポンでさらに安くなるよ。\n気になった人は左下の黄色いカゴからチェックしてね。',
        memo: '顔出しなし、小鼻のドアップ。吸引後のノズルを画面いっぱいに見せる'
      },
      {
        productName: '折りたたみシリコン保存容器 4点', creator: '@sample_kitchen', duration: 42, followers: 180000,
        views: 210000, likes: 9800, comments: 210, saves: 3900, shares: 640,
        transcript: '冷蔵庫がタッパーでパンパンな人、これ見て。\n使わないときはペタンコに畳めるシリコン容器です。\n電子レンジも食洗機もOK。\n4サイズセットで作り置きにちょうどいい。\nキッチン用品ランキングで1位にもなってました。\n詳しくはリンクから見てみてください。',
        memo: '手元のみ。畳む動作をスローで2回見せる'
      },
      {
        productName: 'ワイヤレスイヤホン Pro', creator: '@sample_gadget', duration: 75, followers: 250000,
        views: 95000, likes: 1900, comments: 85, saves: 420, shares: 60,
        transcript: '今日はワイヤレスイヤホンを紹介します。\nパッケージはこんな感じで、中にはケースと充電ケーブルが入っています。\n重さは片耳5グラムくらいです。\nノイズキャンセリングもついています。\nバッテリーは最大30時間もちます。\n音質は普通に良いと思います。',
        memo: '開封から始まり、使用シーンがない'
      }
    ].map(function (v, i) { return Object.assign(v, { id: Store.uid() + i, createdAt: now + i, sample: true, url: '', hook: '' }); });
    Store.putMany('videos', sample).then(function () { toast('サンプル動画を読み込みました'); }, failed);
  }
  $('#btn-vsample').onclick = loadVideoSamples;
  $('#btn-vsample-empty').onclick = loadVideoSamples;

  $('#btn-vadd').onclick = function () { openVForm(null); };
  $('#vsort').value = pref('pa.vsort', 'total');
  $('#vsort').onchange = function () { setPref('pa.vsort', $('#vsort').value); renderVideos(); };
  $('#vfilter').oninput = renderVideos;

  // =====================================================================
  // 起動
  // =====================================================================
  Store.on(function (kind, info) {
    if (info.slow) toast('データの読み込みに時間がかかっています…');
    if (info.error) toast('データを読み込めませんでした。ページを開き直してください。');
    if (kind === 'products' || kind === 'settings') renderProducts();
    if (kind === 'settings' && document.activeElement && !document.activeElement.closest('#weights')) renderWeights();
    if (kind === 'videos' || kind === 'products') renderVideos();
    if (kind === 'videos' && vViewingId && $('#dlg-vdetail').open && !aiCtl) openVDetail(vViewingId);
  });

  showTab(pref('pa.tab', 'products') === 'videos' ? 'videos' : 'products');
  $('#empty').hidden = true; $('#vempty').hidden = true;
  renderWeights();
  Store.init().then(function (mode) {
    $('#mode').textContent = mode === 'cloud' ? '・アカウントに保存（PC・スマホ共通）' : '・このブラウザに保存';
    renderWeights(); renderProducts(); renderVideos();
  });
})();
