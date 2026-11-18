(function () {
  'use strict';

  var S = window.Scoring;
  var KEY_PRODUCTS = 'pa.products.v1';
  var KEY_WEIGHTS = 'pa.weights.v1';
  var KEY_SORT = 'pa.sort.v1';

  var FIELDS = [
    ['name', '商品名'], ['category', 'カテゴリ'], ['price', '価格'], ['commissionRate', '手数料率'],
    ['monthlySales', '月間販売数'], ['rating', '評価'], ['reviews', 'レビュー数'],
    ['creators', '紹介クリエイター数'], ['visual', '動画映え'], ['url', 'URL'], ['memo', 'メモ']
  ];
  var NUMERIC = ['price', 'commissionRate', 'monthlySales', 'rating', 'reviews', 'creators', 'visual'];

  // ---------- storage ----------
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存不可の環境では無視 */ }
  }

  var products = load(KEY_PRODUCTS, []);
  var weights = Object.assign({}, S.DEFAULT_WEIGHTS, load(KEY_WEIGHTS, {}));
  var editingId = null;
  var viewingId = null;

  function persist() { save(KEY_PRODUCTS, products); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- helpers ----------
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function int(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

  // ---------- list ----------
  function render() {
    var q = $('#filter').value.trim().toLowerCase();
    var sort = $('#sort').value;
    var rows = products.map(function (p) { return { p: p, a: S.analyze(p, weights) }; })
      .filter(function (r) {
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
        '<div class="meta">' + (p.category ? '<span class="chip">' + esc(p.category) + '</span>' : '') +
        yen(+p.price || 0) + ' ・ 手数料' + (+p.commissionRate || 0) + '% ・ 月' + int(+p.monthlySales || 0) + '件</div></div>' +
        '<div class="money"><b>' + yen(a.commission) + '</b><span>/件</span></div>' +
        '</li>';
    }).join('');

    $('#empty').hidden = products.length > 0;

    if (products.length) {
      var all = products.map(function (p) { return S.analyze(p, weights); });
      var avg = all.reduce(function (s, a) { return s + a.total; }, 0) / all.length;
      var top = all.filter(function (a) { return a.rank === 'S' || a.rank === 'A'; }).length;
      $('#summary').innerHTML =
        '<div class="stat"><b>' + products.length + '</b><span>登録商品</span></div>' +
        '<div class="stat"><b>' + top + '</b><span>S・Aランク</span></div>' +
        '<div class="stat"><b>' + Math.round(avg) + '点</b><span>平均スコア</span></div>';
    } else {
      $('#summary').innerHTML = '';
    }

    var cats = {};
    products.forEach(function (p) { if (p.category) cats[p.category] = 1; });
    $('#cats').innerHTML = Object.keys(cats).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
  }

  // ---------- form ----------
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
    FIELDS.forEach(function (f) {
      if (p && p[f[0]] != null) form.elements[f[0]].value = p[f[0]];
    });
    if (!p) form.elements.visual.value = 3;
    updatePreview();
    $('#dlg-form').showModal();
  }

  function updatePreview() {
    var d = formData();
    $('#visual-out').textContent = d.visual;
    if (!d.price && !d.monthlySales) { $('#preview').innerHTML = ''; return; }
    var a = S.analyze(d, weights);
    $('#preview').innerHTML = '仮スコア <b>' + a.rank + '（' + a.total + '点）</b> ・ 報酬 ' +
      yen(a.commission) + '/件 ・ 想定月収 ' + yen(a.estMonthlyIncome);
  }

  form.addEventListener('input', updatePreview);
  $('#btn-cancel').onclick = function () { $('#dlg-form').close(); };
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = formData();
    if (!d.name) return;
    if (editingId) {
      var i = products.findIndex(function (p) { return p.id === editingId; });
      if (i >= 0) products[i] = Object.assign({}, products[i], d);
    } else {
      d.id = uid(); d.createdAt = Date.now();
      products.push(d);
    }
    persist(); render();
    $('#dlg-form').close();
    if (editingId) openDetail(editingId);
  });

  // ---------- detail ----------
  function openDetail(id) {
    var p = products.find(function (x) { return x.id === id; });
    if (!p) return;
    viewingId = id;
    var a = S.analyze(p, weights);
    var url = safeUrl(p.url);
    var bars = Object.keys(S.LABELS).map(function (k) {
      var v = Math.round(a.scores[k]);
      return '<div class="bar"><span>' + S.LABELS[k] + '</span><div class="track"><div class="fill" style="width:' + v + '%"></div></div><output>' + v + '</output></div>';
    }).join('');
    var list = function (arr, cls) {
      return arr.length ? '<ul class="adv ' + cls + '">' + arr.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '';
    };

    $('#detail').innerHTML =
      '<div class="detail-head"><div class="rank rank-' + a.rank + '">' + a.rank + '<small>' + a.total + '点</small></div>' +
      '<div><h2>' + esc(p.name) + '</h2><div class="meta">' + esc(p.category || 'カテゴリなし') + '</div></div></div>' +
      '<div class="kv">' +
      '<div><b>' + yen(a.commission) + '</b><span>1件あたり報酬</span></div>' +
      '<div><b>' + yen(a.estMonthlyIncome) + '</b><span>想定月収（目安）</span></div>' +
      '<div><b>' + int(a.salesPerCreator) + '件</b><span>紹介者1人あたり販売数/月</span></div>' +
      '<div><b>★' + (p.rating || '-') + '（' + int(+p.reviews || 0) + '件）</b><span>評価</span></div>' +
      '</div>' +
      '<div class="bars">' + bars + '</div>' +
      (a.advice.good.length ? '<h3>強み</h3>' + list(a.advice.good, 'good') : '') +
      (a.advice.bad.length ? '<h3>注意点</h3>' + list(a.advice.bad, 'bad') : '') +
      (p.memo ? '<h3>メモ</h3><div class="memo">' + esc(p.memo) + '</div>' : '') +
      (url ? '<p><a href="' + esc(url) + '" target="_blank" rel="noopener">商品ページを開く</a></p>' : '') +
      '<p class="hint">想定月収は「紹介者1人あたり販売数の10%を自分が獲得できた場合」の目安です。</p>';
    $('#dlg-detail').showModal();
  }

  $('#list').addEventListener('click', function (e) {
    var li = e.target.closest('.item');
    if (li) openDetail(li.dataset.id);
  });
  $('#list').addEventListener('keydown', function (e) {
    var li = e.target.closest('.item');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(li.dataset.id); }
  });
  $('#btn-close').onclick = function () { $('#dlg-detail').close(); };
  $('#btn-edit').onclick = function () {
    var p = products.find(function (x) { return x.id === viewingId; });
    $('#dlg-detail').close();
    openForm(p);
  };
  $('#btn-del').onclick = function () {
    var p = products.find(function (x) { return x.id === viewingId; });
    if (!p || !confirm('「' + p.name + '」を削除しますか？')) return;
    products = products.filter(function (x) { return x.id !== viewingId; });
    persist(); render();
    $('#dlg-detail').close();
  };

  // ---------- CSV ----------
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
    if (rows.length < 2) { alert('データ行が見つかりませんでした。'); return; }
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/[\s（(].*$/, ''); });
    var map = {};
    Object.keys(ALIASES).forEach(function (k) {
      var idx = head.findIndex(function (h) { return ALIASES[k].indexOf(h) >= 0; });
      if (idx >= 0) map[k] = idx;
    });
    if (map.name == null) { alert('「商品名」の列が見つかりませんでした。'); return; }
    var added = 0;
    rows.slice(1).forEach(function (r) {
      var d = { id: uid(), createdAt: Date.now() + added };
      Object.keys(map).forEach(function (k) {
        var v = (r[map[k]] || '').trim();
        d[k] = NUMERIC.indexOf(k) >= 0 ? (v === '' ? '' : parseFloat(v.replace(/[,，円%％¥\s]/g, '')) || 0) : v;
      });
      if (d.visual === '' || d.visual == null) d.visual = 3;
      if (d.name) { products.push(d); added++; }
    });
    persist(); render();
    alert(added + '件の商品を取り込みました。');
  }

  function exportCSV() {
    var cell = function (v) {
      v = v == null ? '' : String(v);
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var lines = [FIELDS.map(function (f) { return f[1]; }).concat(['総合スコア', 'ランク', '報酬/件']).join(',')];
    products.forEach(function (p) {
      var a = S.analyze(p, weights);
      lines.push(FIELDS.map(function (f) { return cell(p[f[0]]); })
        .concat([a.total, a.rank, Math.round(a.commission)]).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '商品分析_' + new Date().toISOString().slice(0, 10) + '.csv';
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
    if (!products.length) { alert('書き出す商品がありません。'); return; }
    exportCSV();
  };
  $('#btn-clear').onclick = function () {
    if (products.length && confirm('登録した商品をすべて削除しますか？（元に戻せません）')) {
      products = []; persist(); render();
    }
  };
  $('#btn-sample').onclick = function () {
    var now = Date.now();
    var sample = [
      { name: '毛穴吸引美顔器', category: '美容', price: 3980, commissionRate: 20, monthlySales: 4200, rating: 4.4, reviews: 1820, creators: 60, visual: 5, memo: 'ビフォーアフターが強い。小鼻のアップで見せる' },
      { name: '折りたたみシリコン保存容器 4点', category: 'キッチン', price: 2480, commissionRate: 15, monthlySales: 9800, rating: 4.6, reviews: 5300, creators: 310, visual: 4 },
      { name: 'ワイヤレスイヤホン Pro', category: 'ガジェット', price: 8980, commissionRate: 8, monthlySales: 1500, rating: 4.1, reviews: 640, creators: 140, visual: 2 },
      { name: '韓国ヘアオイル', category: '美容', price: 1980, commissionRate: 25, monthlySales: 12000, rating: 4.7, reviews: 9100, creators: 820, visual: 3 },
      { name: 'ペット用自動給水器', category: 'ペット', price: 4580, commissionRate: 18, monthlySales: 650, rating: 4.5, reviews: 85, creators: 6, visual: 4, memo: '紹介者が少ない。猫動画と相性◎' }
    ];
    sample.forEach(function (p, i) { p.id = uid(); p.createdAt = now + i; products.push(p); });
    persist(); render();
  };

  // ---------- weights ----------
  function renderWeights() {
    $('#weights').innerHTML = Object.keys(S.LABELS).map(function (k) {
      return '<label><span>' + S.LABELS[k] + '</span><input type="range" min="0" max="50" step="5" data-k="' + k + '" value="' + weights[k] + '"><output>' + weights[k] + '</output></label>';
    }).join('');
  }
  $('#weights').addEventListener('input', function (e) {
    var k = e.target.dataset.k;
    if (!k) return;
    weights[k] = +e.target.value;
    e.target.nextElementSibling.textContent = weights[k];
    save(KEY_WEIGHTS, weights); render();
  });
  $('#btn-reset-w').onclick = function () {
    weights = Object.assign({}, S.DEFAULT_WEIGHTS);
    save(KEY_WEIGHTS, weights); renderWeights(); render();
  };

  // ---------- init ----------
  $('#btn-add').onclick = function () { openForm(null); };
  $('#sort').value = load(KEY_SORT, 'total');
  $('#sort').onchange = function () { save(KEY_SORT, $('#sort').value); render(); };
  $('#filter').oninput = render;
  renderWeights();
  render();
})();
