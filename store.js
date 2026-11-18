/*
 * データ保存の切り替え
 * - claude.ai で公開した版: アカウントに保存（PCとスマホで同じデータ）
 * - ファイルを直接開いた版: このブラウザの中に保存
 */
(function (root) {
  'use strict';

  var LOCAL_KEYS = { products: 'pa.products.v1', videos: 'pa.videos.v1', settings: 'pa.settings.v1' };
  var KINDS = ['products', 'videos'];

  var cache = { products: [], videos: [], settings: {} };
  var mode = 'local';
  var caps = { sample: null, sampleLimits: null, downloads: null };
  var refs = null;
  var listeners = [];

  function emit(kind, info) { listeners.forEach(function (fn) { fn(kind, info || {}); }); }

  function readLocal(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できない環境 */ }
  }

  function initLocal() {
    mode = 'local';
    KINDS.forEach(function (k) { cache[k] = readLocal(LOCAL_KEYS[k], []); });
    var legacyWeights = readLocal('pa.weights.v1', null);
    cache.settings = readLocal(LOCAL_KEYS.settings, legacyWeights ? { weights: legacyWeights } : {});
    KINDS.forEach(function (k) { emit(k, { ready: true }); });
    emit('settings', { ready: true });
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]);
  }

  function init() {
    var c = root.claude;
    if (!c || typeof c.use !== 'function') { initLocal(); return Promise.resolve(mode); }

    caps.sample = null;
    // AI・ダウンロードは後から使えるようになれば有効化
    c.use('sample').then(function (s) {
      caps.sample = s; emit('caps');
      if (s && s.limits) s.limits().then(function (l) { caps.sampleLimits = l; emit('caps'); }, function () {});
    }, function () {});
    c.use('downloads').then(function (d) { caps.downloads = d; emit('caps'); }, function () {});

    return withTimeout(Promise.all([c.use('db'), c.use('user')]), 12000).then(function (res) {
      var db = res && res[0], user = res && res[1];
      if (!db || !user) { initLocal(); return mode; }
      return user.id().then(function (uid) {
        if (!uid) { initLocal(); return mode; }
        mode = 'cloud';
        var base = 'data/users/' + uid;
        refs = {
          products: db.doc(base + '/products').collection('items'),
          videos: db.doc(base + '/videos').collection('items'),
          settings: db.doc(base + '/settings')
        };
        KINDS.forEach(function (k) {
          var timer = setTimeout(function () { emit(k, { slow: true }); }, 10000);
          refs[k].onSnapshot(function (snap) {
            cache[k] = snap.docs.map(function (d) { return Object.assign({}, d.data(), { id: d.id }); });
            if (!snap.metadata.fromCache) clearTimeout(timer);
            emit(k, { ready: true, fromCache: snap.metadata.fromCache });
          }, function (err) {
            clearTimeout(timer);
            emit(k, { error: err && err.code });
          });
        });
        refs.settings.onSnapshot(function (snap) {
          cache.settings = snap.exists ? Object.assign({}, snap.data()) : {};
          emit('settings', { ready: true });
        }, function () {});
        return mode;
      });
    }, function () { initLocal(); return mode; });
  }

  function plain(obj) { return JSON.parse(JSON.stringify(obj)); }

  function put(kind, item) {
    var arr = cache[kind].slice();
    var i = arr.findIndex(function (x) { return x.id === item.id; });
    if (i >= 0) arr[i] = item; else arr.push(item);
    if (mode === 'local') {
      cache[kind] = arr; writeLocal(LOCAL_KEYS[kind], arr); emit(kind, {});
      return Promise.resolve();
    }
    var body = plain(item); delete body.id;
    return refs[kind].doc(item.id).set(body);
  }

  function putMany(kind, items) {
    if (mode === 'local') {
      var arr = cache[kind].concat(items);
      cache[kind] = arr; writeLocal(LOCAL_KEYS[kind], arr); emit(kind, {});
      return Promise.resolve();
    }
    return items.reduce(function (p, it) { return p.then(function () { return put(kind, it); }); }, Promise.resolve());
  }

  function remove(kind, id) {
    if (mode === 'local') {
      cache[kind] = cache[kind].filter(function (x) { return x.id !== id; });
      writeLocal(LOCAL_KEYS[kind], cache[kind]); emit(kind, {});
      return Promise.resolve();
    }
    return refs[kind].doc(id).delete();
  }

  function clear(kind) {
    if (mode === 'local') {
      cache[kind] = []; writeLocal(LOCAL_KEYS[kind], []); emit(kind, {});
      return Promise.resolve();
    }
    var ids = cache[kind].map(function (x) { return x.id; });
    return ids.reduce(function (p, id) { return p.then(function () { return refs[kind].doc(id).delete(); }); }, Promise.resolve());
  }

  var settingsTimer = null;
  function setSettings(patch) {
    cache.settings = Object.assign({}, cache.settings, patch);
    if (mode === 'local') { writeLocal(LOCAL_KEYS.settings, cache.settings); emit('settings', {}); return; }
    emit('settings', {});
    // スライダー操作中の連続書き込みを1回にまとめる
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(function () { refs.settings.set(plain(cache.settings)).catch(function () {}); }, 600);
  }

  root.Store = {
    init: init,
    on: function (fn) { listeners.push(fn); },
    list: function (kind) { return cache[kind]; },
    settings: function () { return cache.settings; },
    setSettings: setSettings,
    put: put,
    putMany: putMany,
    remove: remove,
    clear: clear,
    mode: function () { return mode; },
    caps: caps,
    uid: function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  };
})(this);
