/* game.js — giao diện Queens: render DOM, input chạm/kéo, gợi ý, lưu trữ.
   Luật nằm hết trong engine.js; file này không tự kiểm luật. */
(function () {
  'use strict';
  var E = window.QueensEngine;

  // ---- Tham số giao diện ----
  var BOARD_MAX_PX = 456;        // px — bề rộng bàn tối đa trên desktop
  var BOARD_SIDE_PAD = 24;       // px — chừa lề hai bên trên mobile
  var BOARD_MAX_VH = 0.56;       // tỉ lệ chiều cao màn hình bàn được chiếm
  var SCORE_BASE = 900;          // điểm = BASE - giây - HINT_PENALTY * số gợi ý (tối thiểu 1)
  var HINT_PENALTY = 60;         // giây phạt mỗi gợi ý
  var DAILY_SIZE = 8, DAILY_DIFF = 'medium';
  var STORE_KEY = 'queens.v1';

  // Bảng màu vùng (pastel, tương phản đủ với chữ × tối) — thứ tự khớp REGION_NAMES.
  var COLORS = ['#b9a3e8', '#ffc58c', '#8fb8ff', '#a8dc93', '#d9dce4', '#ff8f78', '#ecf086', '#c9b98f', '#f2a6c8', '#7fe0d4'];

  var CROWN = '<svg viewBox="0 0 64 64"><path class="body" fill="url(#qg)" stroke="#5a3a00" stroke-width="2.5" stroke-linejoin="round" ' +
    'd="M10 46 L6 18 L20 30 L32 10 L44 30 L58 18 L54 46 Z"/><rect x="10" y="48" width="44" height="7" rx="2.5" fill="#e8a425" stroke="#5a3a00" stroke-width="2.5"/>' +
    '<circle cx="6" cy="16" r="4" fill="#ffe08a" stroke="#5a3a00" stroke-width="2"/><circle cx="32" cy="8" r="4" fill="#ffe08a" stroke="#5a3a00" stroke-width="2"/>' +
    '<circle cx="58" cy="16" r="4" fill="#ffe08a" stroke="#5a3a00" stroke-width="2"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $('board');

  // ---- Trạng thái ----
  var store = load();
  var G = null;           // ván hiện tại: { mode, n, diff, seed, P, cells, history, elapsed, hints, solved, dateKey }
  var cellEls = [];
  var hintState = null;   // gợi ý đang hiện
  var lastTick = 0;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    store.settings = store.settings || {};
    if (G) {
      store.current = store.current || {};
      store.current.lastMode = G.mode;
      store.current[G.mode] = {
        n: G.n, diff: G.diff, seed: G.seed, cells: G.cells, elapsed: G.elapsed,
        hints: G.hints, solved: G.solved, dateKey: G.dateKey
      };
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
    if (window.ArcadeGame) ArcadeGame.syncSave({ best: store.best || {}, wins: store.wins || 0, daily: store.daily || {} });
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function keyOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // 🔥 chuỗi ngày: số ngày liên tiếp (tính tới hôm nay, hoặc hôm qua nếu hôm nay chưa giải) có giải đề hôm nay
  function streakOf(daily) {
    daily = daily || {};
    var d = new Date(), n = 0;
    if (daily[keyOf(d)] == null) d.setDate(d.getDate() - 1);
    while (daily[keyOf(d)] != null) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function fmt(sec) {
    sec = Math.floor(sec);
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
  function bestKey(n, diff) { return n + '-' + diff; }

  // ---- Bắt đầu / khôi phục ván ----
  function startGame(mode, n, diff, seed, restore) {
    var dateKey = mode === 'daily' ? todayKey() : null;
    if (mode === 'daily') { n = DAILY_SIZE; diff = DAILY_DIFF; seed = E.dailySeed(); }
    if (seed == null) seed = (Math.random() * 2147483647) | 0;
    var P = E.generate(n, seed, { difficulty: diff });
    G = {
      mode: mode, n: n, diff: diff, seed: seed, P: P, dateKey: dateKey,
      cells: new Array(n * n).fill(0), history: [], elapsed: 0, hints: 0, solved: false
    };
    if (restore && restore.cells && restore.cells.length === n * n) {
      G.cells = restore.cells.slice();
      G.elapsed = restore.elapsed || 0;
      G.hints = restore.hints || 0;
      G.solved = !!restore.solved;
    }
    hideHint();
    buildBoard();
    render();
    syncSegs();
    save();
    if (window.ArcadeGame && ArcadeGame.track) ArcadeGame.track('start', { mode: mode, n: n, diff: diff });
  }

  function resumeOrStart(mode) {
    var cur = store.current && store.current[mode];
    if (mode === 'daily') {
      if (cur && cur.dateKey === todayKey()) return startGame('daily', 0, 0, 0, cur);
      return startGame('daily');
    }
    if (cur && cur.n && !cur.solved) return startGame('practice', cur.n, cur.diff, cur.seed, cur);
    var s = store.settings || {};
    startGame('practice', s.n || 8, s.diff || 'medium');
  }

  // ---- Dựng bàn ----
  function buildBoard() {
    var n = G.n, P = G.P;
    var size = Math.min(BOARD_MAX_PX, window.innerWidth - BOARD_SIDE_PAD, Math.floor(window.innerHeight * BOARD_MAX_VH));
    var cs = Math.floor((size - 6) / n);
    boardEl.style.gridTemplateColumns = 'repeat(' + n + ',' + cs + 'px)';
    boardEl.style.gridTemplateRows = 'repeat(' + n + ',' + cs + 'px)';
    boardEl.innerHTML = '';
    cellEls = [];
    for (var i = 0; i < n * n; i++) {
      var el = document.createElement('div');
      var r = (i / n) | 0, c = i % n;
      el.className = 'cell';
      if (c < n - 1 && P.region[i] !== P.region[i + 1]) el.classList.add('wr');
      if (r < n - 1 && P.region[i] !== P.region[i + n]) el.classList.add('wb');
      if (c === n - 1) el.style.borderRight = '0';
      if (r === n - 1) el.style.borderBottom = '0';
      el.style.background = COLORS[P.region[i] % COLORS.length];
      el.dataset.i = i;
      boardEl.appendChild(el);
      cellEls.push(el);
    }
    // gradient vàng cho vương miện (khai báo một lần)
    if (!document.getElementById('qgdefs')) {
      var d = document.createElement('div');
      d.id = 'qgdefs';
      d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      d.innerHTML = '<svg><defs><linearGradient id="qg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#f0a91f"/></linearGradient></defs></svg>';
      document.body.appendChild(d);
    }
  }

  // ---- Vẽ trạng thái ----
  function render() {
    var n = G.n, cells = G.cells;
    var autoOn = $('optAuto').checked;
    var blocked = autoOn ? E.blockedCells(G.P, cells) : null;
    var bad = {};
    E.conflicts(G.P, cells).forEach(function (i) { bad[i] = true; });
    var focus = {}, target = {};
    if (hintState) {
      (hintState.focus || []).forEach(function (i) { focus[i] = true; });
      if (hintState.place != null) target[hintState.place] = true;
      if (hintState.remove != null) target[hintState.remove] = true;
      (hintState.elim || []).forEach(function (i) { target[i] = true; });
    }
    var queens = 0;
    for (var i = 0; i < cellEls.length; i++) {
      var el = cellEls[i], v = cells[i];
      var want = v === 2 ? 'q' : (v === 1 ? 'x' : (blocked && blocked[i] ? 'ax' : ''));
      if (el.dataset.v !== want) {
        el.dataset.v = want;
        el.innerHTML = want === 'q' ? CROWN : (want === 'x' || want === 'ax') ? '<span class="x"></span>' : '';
      }
      if (v === 2) queens++;
      el.classList.toggle('auto', want === 'ax');
      el.classList.toggle('err', !!bad[i]);
      el.classList.toggle('hfocus', !!focus[i] && !target[i]);
      el.classList.toggle('htarget', !!target[i]);
    }
    $('vQueens').textContent = queens + '/' + n;
    $('vHints').textContent = G.hints;
    $('vTime').textContent = fmt(G.elapsed);
    $('btnUndo').disabled = !G.history.length || G.solved;
    $('btnHint').disabled = G.solved;
    $('btnClear').disabled = G.solved;
    var st = $('status');
    if (G.solved) st.textContent = G.mode === 'daily' ? 'Đã giải đề hôm nay — quay lại ngày mai nhé!' : 'Đã giải xong! Bấm “Ván mới” để chơi tiếp.';
    else if (Object.keys(bad).length) st.textContent = 'Có hậu đang vi phạm luật (viền đỏ).';
    else st.textContent = 'Chạm 1 lần: đánh ×  ·  2 lần: đặt hậu  ·  Kéo: đánh × nhiều ô';
  }

  // ---- Sửa ô có lịch sử hoàn tác ----
  function setCells(changes) {
    if (!changes.length) return;
    for (var k = 0; k < changes.length; k++) G.cells[changes[k].i] = changes[k].to;
    G.history.push(changes);
    hideHint();
    afterMove();
  }
  function afterMove() {
    render();
    if (!G.solved && E.isSolved(G.P, G.cells)) win();
    save();
  }

  // ---- Input: chạm để xoay vòng, kéo để đánh × ----
  var drag = null;
  function cellAt(x, y) {
    var el = document.elementFromPoint(x, y);
    el = el && el.closest ? el.closest('.cell') : null;
    return el && boardEl.contains(el) ? +el.dataset.i : -1;
  }
  boardEl.addEventListener('pointerdown', function (e) {
    if (G.solved) return;
    var i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) {}
    drag = { start: i, moved: false, mode: G.cells[i] === 1 ? 'clear' : 'mark', seen: {}, changes: [] };
  });
  function dragApply(i) {
    if (drag.seen[i]) return;
    drag.seen[i] = true;
    var v = G.cells[i];
    if (drag.mode === 'mark' && v === 0) { drag.changes.push({ i: i, from: 0, to: 1 }); G.cells[i] = 1; }
    if (drag.mode === 'clear' && v === 1) { drag.changes.push({ i: i, from: 1, to: 0 }); G.cells[i] = 0; }
  }
  boardEl.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var i = cellAt(e.clientX, e.clientY);
    if (i < 0 || (i === drag.start && !drag.moved)) return;
    if (!drag.moved) { drag.moved = true; dragApply(drag.start); }
    dragApply(i);
    render();
  });
  function endDrag(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (d.moved) {
      if (d.changes.length) { G.history.push(d.changes); hideHint(); afterMove(); }
      return;
    }
    if (e.type === 'pointercancel') return;
    var i = d.start, v = G.cells[i];
    setCells([{ i: i, from: v, to: (v + 1) % 3 }]);
  }
  boardEl.addEventListener('pointerup', endDrag);
  boardEl.addEventListener('pointercancel', endDrag);
  boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function undo() {
    if (!G.history.length || G.solved) return;
    var ch = G.history.pop();
    for (var k = ch.length - 1; k >= 0; k--) G.cells[ch[k].i] = ch[k].from;
    hideHint();
    render(); save();
  }

  // ---- Gợi ý ----
  function showHint() {
    if (G.solved) return;
    var h = E.hint(G.P, G.cells, $('optAuto').checked);
    if (!h) return;
    G.hints++;
    hintState = h;
    $('hintText').textContent = h.text;
    $('btnApply').textContent = h.remove != null ? 'Gỡ giúp' : h.place != null ? 'Đặt giúp' : 'Đánh × giúp';
    $('hintBox').classList.remove('hidden');
    render(); save();
  }
  function hideHint() {
    hintState = null;
    $('hintBox').classList.add('hidden');
  }
  function applyHint() {
    var h = hintState;
    if (!h) return;
    var ch = [];
    if (h.remove != null) ch.push({ i: h.remove, from: G.cells[h.remove], to: 0 });
    if (h.place != null) ch.push({ i: h.place, from: G.cells[h.place], to: 2 });
    (h.elim || []).forEach(function (i) { if (G.cells[i] === 0) ch.push({ i: i, from: 0, to: 1 }); });
    if (!ch.length) { hideHint(); render(); return; }
    setCells(ch);
  }

  // ---- Thắng ----
  function win() {
    G.solved = true;
    hideHint();
    var sec = Math.floor(G.elapsed);
    store.wins = (store.wins || 0) + 1;
    store.best = store.best || {};
    var key = bestKey(G.n, G.diff), prev = store.best[key], isRecord = false;
    if (!G.hints && (prev == null || sec < prev)) { store.best[key] = sec; isRecord = prev != null; }
    if (G.mode === 'daily') { store.daily = store.daily || {}; if (store.daily[G.dateKey] == null || sec < store.daily[G.dateKey]) store.daily[G.dateKey] = sec; }
    var streak = streakOf(store.daily);
    save();
    var now = new Date();
    G.shareText = 'Queens ' + (G.mode === 'daily' ? String(now.getDate()).padStart(2, '0') + '/' + String(now.getMonth() + 1).padStart(2, '0') + ' · ' : '') +
      G.n + '×' + G.n + ' · ' + fmt(sec) + ' · ' + G.hints + ' gợi ý' + (streak > 0 ? ' 🔥' + streak : '') + ' play.bomclaw.org/queens';

    var score = Math.max(1, SCORE_BASE - sec - HINT_PENALTY * G.hints);
    if (window.ArcadeGame) {
      ArcadeGame.onScore('alltime', score);
      if (G.mode === 'daily') ArcadeGame.onScore('daily', score);
      if (ArcadeGame.track) ArcadeGame.track('win', { n: G.n, diff: G.diff, sec: sec, hints: G.hints });
      if (ArcadeGame.track && G.mode === 'daily') ArcadeGame.track('daily_win', { streak: streak, hints: G.hints });
    }

    // Vương miện nhảy lần lượt theo hàng.
    G.P.solution.slice().sort(function (a, b) { return a - b; }).forEach(function (c, k) {
      setTimeout(function () { cellEls[c] && cellEls[c].classList.add('win'); }, k * 90);
    });

    var labels = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };
    $('winTitle').textContent = isRecord ? 'Kỷ lục mới!' : G.hints ? 'Giải xong!' : 'Xuất sắc!';
    $('winSub').textContent = (G.mode === 'daily' ? 'Đề hôm nay · ' : '') + G.n + '×' + G.n + ' · ' + labels[G.diff] +
      (G.hints ? ' · kỷ lục chỉ tính ván không dùng gợi ý' : '');
    $('wTime').textContent = fmt(sec);
    $('wBest').textContent = store.best[key] != null ? fmt(store.best[key]) : '—';
    $('wHints').textContent = G.hints;
    $('wSolved').textContent = store.wins;
    $('wStreak').textContent = streak > 0 ? '🔥' + streak : '—';
    $('btnWinNext').textContent = G.mode === 'daily' ? 'Luyện tập' : 'Ván mới';
    setTimeout(function () { $('winModal').classList.remove('hidden'); }, G.n * 90 + 350);
    render();
  }

  // ---- Đồng hồ: chỉ chạy khi tab đang hiện và chưa giải xong ----
  setInterval(function () {
    var now = Date.now();
    if (G && !G.solved && !document.hidden && $('rulesModal').classList.contains('hidden')) {
      G.elapsed += Math.min(1, (now - lastTick) / 1000);
      $('vTime').textContent = fmt(G.elapsed);
      if (Math.floor(G.elapsed) % 5 === 0) save();
    }
    lastTick = now;
  }, 250);
  lastTick = Date.now();

  // ---- Điều khiển ----
  function syncSegs() {
    var daily = G.mode === 'daily';
    $('practiceOpts').classList.toggle('hidden', daily);
    Array.prototype.forEach.call($('segMode').children, function (b) { b.classList.toggle('on', b.dataset.mode === G.mode); });
    Array.prototype.forEach.call($('segSize').children, function (b) { b.classList.toggle('on', +b.dataset.n === G.n); });
    Array.prototype.forEach.call($('segDiff').children, function (b) { b.classList.toggle('on', b.dataset.d === G.diff); });
  }
  function newPractice(n, diff) {
    store.settings = store.settings || {};
    store.settings.n = n; store.settings.diff = diff;
    startGame('practice', n, diff);
  }

  $('segMode').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.dataset.mode === G.mode) return;
    save();
    resumeOrStart(b.dataset.mode);
  });
  $('segSize').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) newPractice(+b.dataset.n, G.diff);
  });
  $('segDiff').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) newPractice(G.n, b.dataset.d);
  });
  $('btnUndo').addEventListener('click', undo);
  $('btnHint').addEventListener('click', showHint);
  $('btnApply').addEventListener('click', applyHint);
  $('btnClear').addEventListener('click', function () {
    if (G.solved) return;
    var ch = [];
    G.cells.forEach(function (v, i) { if (v) ch.push({ i: i, from: v, to: 0 }); });
    setCells(ch);
  });
  $('btnNew').addEventListener('click', function () {
    var st = store.settings || {};
    if (G.mode === 'daily') newPractice(st.n || 8, st.diff || 'medium');
    else newPractice(G.n, G.diff);
  });
  $('optAuto').addEventListener('change', function () {
    store.settings = store.settings || {};
    store.settings.autoX = $('optAuto').checked;
    hideHint(); render(); save();
  });
  $('btnRules').addEventListener('click', function () { $('rulesModal').classList.remove('hidden'); });
  $('btnRulesOk').addEventListener('click', function () {
    $('rulesModal').classList.add('hidden');
    store.seenRules = true; save();
  });
  $('btnWinClose').addEventListener('click', function () { $('winModal').classList.add('hidden'); });
  $('btnWinNext').addEventListener('click', function () {
    $('winModal').classList.add('hidden');
    $('btnNew').click();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'z' || e.key === 'Z') undo();
    if (e.key === 'h' || e.key === 'H') showHint();
  });
  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (G) { buildBoard(); cellEls.forEach(function (el) { el.dataset.v = '-'; }); render(); } }, 150);
  });

  window.__arcadeApplyRemote = function (d) {
    if (!d || !d.best) return;
    store.best = store.best || {};
    Object.keys(d.best).forEach(function (k) {
      if (store.best[k] == null || d.best[k] < store.best[k]) store.best[k] = d.best[k];
    });
    store.wins = Math.max(store.wins || 0, d.wins || 0);
  };

  // ---- Khởi động ----
  if (store.settings && store.settings.autoX === false) $('optAuto').checked = false;
  resumeOrStart((store.current && store.current.lastMode) || 'practice');
  if (!store.seenRules) $('rulesModal').classList.remove('hidden');

  $('btnShare').addEventListener('click', function () {
    var text = (G && G.shareText) || '', btn = this;
    function done(ok) { btn.textContent = ok ? 'Đã chép ✓' : 'Chia sẻ'; setTimeout(function () { btn.textContent = 'Chia sẻ'; }, 1800); }
    if (window.ArcadeGame && ArcadeGame.track) ArcadeGame.track('share', { mode: G && G.mode });
    if (navigator.share) { navigator.share({ text: text }).then(function () { done(true); }, function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(true); } catch (e) { done(false); } ta.remove(); }
  });

  // Lộ ra cho playtest headless.
  window.__queens = {
    get state() { return G; },
    tap: function (i) { var v = G.cells[i]; setCells([{ i: i, from: v, to: (v + 1) % 3 }]); },
    hint: showHint, apply: applyHint, streakOf: streakOf
  };
})();
