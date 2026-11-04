/* engine.js — luật Queens thuần, không chạm DOM (chạy được cả trong Node để test).
 *
 * Luật: lưới N×N chia N vùng màu; đặt N hậu sao cho mỗi hàng, mỗi cột, mỗi vùng
 * có đúng 1 hậu và không hai hậu nào chạm nhau (kể cả chéo).
 *
 * Bộ sinh đề chỉ nhận đề mà bộ suy luận logic (deduce) giải trọn vẹn không đoán.
 * Mọi bước suy luận đều đúng đắn, nên giải trọn được ⇒ nghiệm duy nhất.
 * countSolutions() kiểm độc lập điều đó trong test.
 */
(function (root) {
  'use strict';

  // ---- Tham số cân bằng -------------------------------------------------------
  var GRID_MIN = 5;              // N nhỏ hơn: N=2,3 vô nghiệm, N=4 quá dễ
  var GRID_MAX = 10;
  var GEN_MAX_ATTEMPTS = 4000;   // số lần thử bố cục vùng trước khi nới độ khó
  var MAX_SUBSET = 4;            // k lớn nhất cho suy luận "k vùng gói trong k hàng"

  // Mức suy luận (để chấm độ khó):
  // 1 = điền ô duy nhất / loại theo hậu, 2 = một vùng nằm gọn trong một hàng/cột,
  // 3 = thử đặt hậu thấy làm cạn một vùng, 4 = k=2 nhóm, 5 = k≥3 nhóm.
  var DIFFICULTY = {
    easy:   { min: 1, max: 2 },
    medium: { min: 3, max: 4 },
    hard:   { min: 4, max: 5 }
  };

  var REGION_NAMES = ['Tím', 'Cam', 'Xanh dương', 'Xanh lá', 'Xám', 'Đỏ', 'Vàng', 'Nâu', 'Hồng', 'Ngọc'];

  // ---- RNG có seed (mulberry32): cùng seed ⇒ cùng đề trên mọi máy -------------
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---- Hình học --------------------------------------------------------------
  function touching(n, a, b) {
    var ra = (a / n) | 0, ca = a % n, rb = (b / n) | 0, cb = b % n;
    return Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1;
  }

  // Hai ô a ≠ b có loại trừ nhau không (không thể cùng là hậu).
  function attacks(n, region, a, b) {
    if (a === b) return false;
    var ra = (a / n) | 0, ca = a % n, rb = (b / n) | 0, cb = b % n;
    return ra === rb || ca === cb || region[a] === region[b] ||
      (Math.abs(ra - rb) <= 1 && Math.abs(ca - cb) <= 1);
  }

  // ---- Bước 1: đặt N hậu không chạm nhau --------------------------------------
  function placeQueens(n, rand) {
    var cols = new Array(n), used = new Array(n).fill(false);
    function go(r) {
      if (r === n) return true;
      var order = shuffle(Array.from({ length: n }, function (_, i) { return i; }), rand);
      for (var k = 0; k < n; k++) {
        var c = order[k];
        if (used[c]) continue;
        if (r > 0 && Math.abs(cols[r - 1] - c) <= 1) continue;
        used[c] = true; cols[r] = c;
        if (go(r + 1)) return true;
        used[c] = false;
      }
      return false;
    }
    return go(0) ? cols : null;
  }

  // ---- Bước 2: cho N vùng mọc ra từ N hậu --------------------------------------
  // Mỗi vùng một trọng số ngẫu nhiên ⇒ có vùng to vùng nhỏ như đề thật.
  function growRegions(n, cols, rand) {
    var N = n * n, region = new Array(N).fill(-1), left = N - n;
    var weight = [];
    for (var r = 0; r < n; r++) {
      region[r * n + cols[r]] = r;
      weight.push(0.15 + rand() * rand() * 3);
    }
    var nb = [];
    while (left > 0) {
      // Chọn vùng theo trọng số trong số vùng còn ô kề trống.
      var total = 0, frontier = [];
      for (r = 0; r < n; r++) frontier.push([]);
      for (var i = 0; i < N; i++) {
        if (region[i] !== -1) continue;
        var ri = (i / n) | 0, ci = i % n;
        nb.length = 0;
        if (ri > 0) nb.push(i - n);
        if (ri < n - 1) nb.push(i + n);
        if (ci > 0) nb.push(i - 1);
        if (ci < n - 1) nb.push(i + 1);
        for (var k = 0; k < nb.length; k++) {
          var g = region[nb[k]];
          if (g !== -1 && frontier[g].indexOf(i) === -1) frontier[g].push(i);
        }
      }
      for (r = 0; r < n; r++) if (frontier[r].length) total += weight[r];
      var x = rand() * total, pick = -1;
      for (r = 0; r < n; r++) {
        if (!frontier[r].length) continue;
        pick = r;
        x -= weight[r];
        if (x <= 0) break;
      }
      var f = frontier[pick];
      region[f[Math.floor(rand() * f.length)]] = pick;
      left--;
    }
    return region;
  }

  // ---- Solver đếm nghiệm (độc lập với suy luận, dùng để kiểm chứng) ------------
  // Trả mảng nghiệm (mỗi nghiệm = mảng cột theo hàng), dừng khi đủ limit.
  function findSolutions(n, region, limit) {
    var colUsed = new Array(n).fill(false), regUsed = new Array(n).fill(false);
    var out = [], cols = new Array(n);
    function go(r, prevCol) {
      if (r === n) { out.push(cols.slice()); return; }
      for (var c = 0; c < n && out.length < limit; c++) {
        if (colUsed[c] || Math.abs(c - prevCol) <= 1) continue;
        var g = region[r * n + c];
        if (regUsed[g]) continue;
        colUsed[c] = regUsed[g] = true; cols[r] = c;
        go(r + 1, c);
        colUsed[c] = regUsed[g] = false;
      }
    }
    go(0, -9);
    return out;
  }
  function countSolutions(n, region, limit) { return findSolutions(n, region, limit || 2).length; }

  function neighbors4(n, i) {
    var r = (i / n) | 0, c = i % n, out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }

  // Vùng g còn liên thông nếu bỏ ô `without` ra không.
  function connectedWithout(n, region, g, without) {
    var start = -1, total = 0, i;
    for (i = 0; i < region.length; i++) {
      if (region[i] !== g || i === without) continue;
      total++;
      if (start === -1) start = i;
    }
    if (total === 0) return false;
    var seen = {}, stack = [start], cnt = 0;
    seen[start] = true;
    while (stack.length) {
      var x = stack.pop(); cnt++;
      var nb = neighbors4(n, x);
      for (var k = 0; k < nb.length; k++) {
        var y = nb[k];
        if (!seen[y] && y !== without && region[y] === g) { seen[y] = true; stack.push(y); }
      }
    }
    return cnt === total;
  }

  // Phá các nghiệm thừa: lấy ô hậu của nghiệm lạ (không phải ô hậu gốc), chuyển nó
  // sang vùng kề. Nghiệm gốc không đổi vì ô hậu gốc không bao giờ bị chuyển.
  var REPAIR_STEPS = 60;
  function repairUnique(n, region, cols, rand) {
    var isSeed = {};
    for (var r = 0; r < n; r++) isSeed[r * n + cols[r]] = true;
    for (var step = 0; step < REPAIR_STEPS; step++) {
      var sols = findSolutions(n, region, 2);
      if (sols.length === 1) return true;
      var alt = sols[0].join() === cols.join() ? sols[1] : sols[0];
      var cand = [];
      for (r = 0; r < n; r++) {
        var cell = r * n + alt[r];
        if (!isSeed[cell]) cand.push(cell);
      }
      shuffle(cand, rand);
      var moved = false;
      for (var k = 0; k < cand.length && !moved; k++) {
        var c0 = cand[k], from = region[c0];
        if (!connectedWithout(n, region, from, c0)) continue;
        var nb = shuffle(neighbors4(n, c0), rand);
        for (var t = 0; t < nb.length; t++) {
          if (region[nb[t]] !== from) { region[c0] = region[nb[t]]; moved = true; break; }
        }
      }
      if (!moved) return false;
    }
    return countSolutions(n, region, 2) === 1;
  }

  // ---- Bộ suy luận logic -------------------------------------------------------
  // state[i]: 0 = bị loại, 1 = còn khả năng, 2 = hậu.
  function buildUnits(n, region) {
    var rows = [], cols = [], regs = [];
    for (var i = 0; i < n; i++) { rows.push([]); cols.push([]); regs.push([]); }
    for (var cell = 0; cell < n * n; cell++) {
      rows[(cell / n) | 0].push(cell);
      cols[cell % n].push(cell);
      regs[region[cell]].push(cell);
    }
    return { row: rows, col: cols, region: regs };
  }

  var KIND_ORDER = ['row', 'col', 'region'];

  function unitLabel(kind, idx) {
    if (kind === 'row') return 'hàng ' + (idx + 1);
    if (kind === 'col') return 'cột ' + (idx + 1);
    return 'vùng ' + REGION_NAMES[idx % REGION_NAMES.length];
  }
  function unitsLabel(kind, list) {
    if (list.length === 1) return unitLabel(kind, list[0]);
    if (kind === 'region') {
      return 'các vùng ' + list.map(function (i) { return REGION_NAMES[i % REGION_NAMES.length]; }).join(', ');
    }
    return (kind === 'row' ? 'các hàng ' : 'các cột ') + list.map(function (i) { return i + 1; }).join(', ');
  }
  function cellLabel(n, cell) {
    return 'hàng ' + (((cell / n) | 0) + 1) + ', cột ' + ((cell % n) + 1);
  }

  function hasQueen(state, cells) {
    for (var i = 0; i < cells.length; i++) if (state[cells[i]] === 2) return true;
    return false;
  }
  function candidatesOf(state, cells) {
    var out = [];
    for (var i = 0; i < cells.length; i++) if (state[cells[i]] === 1) out.push(cells[i]);
    return out;
  }

  function combinations(arr, k, fn) {
    var pick = [];
    function go(start) {
      if (pick.length === k) return fn(pick.slice());
      for (var i = start; i < arr.length; i++) {
        pick.push(arr[i]);
        var r = go(i + 1);
        pick.pop();
        if (r) return r;
      }
      return null;
    }
    return go(0);
  }

  // Tìm MỘT bước suy luận đơn giản nhất từ state. Trả null nếu bế tắc.
  // Bước: { level, place?: cell, elim?: [cells], focus: [cells], text }
  function findStep(P, state, units) {
    var n = P.n, region = P.region, N = n * n, i, k, kind, u;

    // (1) Hậu loại mọi ô nó "nhìn" thấy.
    for (i = 0; i < N; i++) {
      if (state[i] !== 2) continue;
      var el = [];
      for (var j = 0; j < N; j++) if (state[j] === 1 && attacks(n, region, i, j)) el.push(j);
      if (el.length) {
        return { level: 1, rule: 'attack', elim: el, focus: [i],
          text: 'Hậu ở ' + cellLabel(n, i) + ' loại các ô cùng hàng, cùng cột, cùng vùng và 8 ô sát quanh nó.' };
      }
    }

    // (1) Một hàng/cột/vùng chỉ còn đúng một ô.
    for (k = 0; k < 3; k++) {
      kind = KIND_ORDER[k];
      for (u = 0; u < n; u++) {
        var cells = units[kind][u];
        if (hasQueen(state, cells)) continue;
        var cand = candidatesOf(state, cells);
        if (cand.length === 1) {
          return { level: 1, rule: 'single', place: cand[0], focus: cells.slice(),
            text: unitLabel(kind, u).replace(/^./, function (s) { return s.toUpperCase(); }) +
              ' chỉ còn đúng một ô đặt được hậu.' };
        }
      }
    }

    // (2) và (4,5): k đơn vị loại A gói gọn trong k đơn vị loại B.
    function subsetStep(kk) {
      for (var a = 0; a < 3; a++) {
        for (var b = 0; b < 3; b++) {
          if (a === b) continue;
          var A = KIND_ORDER[a], B = KIND_ORDER[b];
          var open = [];
          for (var x = 0; x < n; x++) if (!hasQueen(state, units[A][x])) open.push(x);
          if (open.length <= kk) continue;
          var found = combinations(open, kk, function (set) {
            var inA = {}, bSet = {}, bList = [], focus = [];
            for (var s = 0; s < set.length; s++) {
              var cs = candidatesOf(state, units[A][set[s]]);
              for (var t = 0; t < cs.length; t++) {
                inA[cs[t]] = true; focus.push(cs[t]);
                var bi = B === 'row' ? (cs[t] / n) | 0 : B === 'col' ? cs[t] % n : region[cs[t]];
                if (!bSet[bi]) { bSet[bi] = true; bList.push(bi); }
              }
            }
            if (bList.length !== kk) return null;
            var elim = [];
            for (s = 0; s < bList.length; s++) {
              var bc = candidatesOf(state, units[B][bList[s]]);
              for (t = 0; t < bc.length; t++) if (!inA[bc[t]]) elim.push(bc[t]);
            }
            if (!elim.length) return null;
            bList.sort(function (p, q) { return p - q; });
            var lead = unitsLabel(A, set);
            var tail = unitsLabel(B, bList);
            var text = kk === 1
              ? lead.replace(/^./, function (s2) { return s2.toUpperCase(); }) + ' nằm gọn trong ' + tail +
                ', nên hậu của ' + tail + ' phải thuộc ' + lead + ' — loại các ô khác của ' + tail + '.'
              : lead.replace(/^./, function (s2) { return s2.toUpperCase(); }) + ' (' + kk + ' đơn vị) chỉ còn ô trong ' +
                tail + ' (' + kk + ' đơn vị). ' + kk + ' hậu đó lấp kín ' + tail + ' — loại mọi ô khác ở đó.';
            return { level: kk === 1 ? 2 : kk === 2 ? 4 : 5, rule: 'subset', elim: elim, focus: focus, text: text };
          });
          if (found) return found;
        }
      }
      return null;
    }

    var st = subsetStep(1);
    if (st) return st;

    // (3) Thử đặt hậu ở một ô: nếu làm một đơn vị khác hết chỗ thì ô đó bị loại.
    for (i = 0; i < N; i++) {
      if (state[i] !== 1) continue;
      for (k = 0; k < 3; k++) {
        kind = KIND_ORDER[k];
        for (u = 0; u < n; u++) {
          var cs2 = units[kind][u];
          if (cs2.indexOf(i) !== -1 || hasQueen(state, cs2)) continue;
          var cand2 = candidatesOf(state, cs2), alive = false;
          for (var q = 0; q < cand2.length; q++) if (!attacks(n, region, i, cand2[q])) { alive = true; break; }
          if (!alive) {
            return { level: 3, rule: 'probe', elim: [i], focus: cand2.concat([i]),
              text: 'Nếu đặt hậu ở ' + cellLabel(n, i) + ', ' + unitLabel(kind, u) +
                ' sẽ không còn ô nào cho hậu — nên ô này bị loại.' };
          }
        }
      }
    }

    for (k = 2; k <= MAX_SUBSET; k++) {
      st = subsetStep(k);
      if (st) return st;
    }
    return null;
  }

  function applyStep(state, step) {
    if (step.place != null) state[step.place] = 2;
    if (step.elim) for (var i = 0; i < step.elim.length; i++) state[step.elim[i]] = 0;
  }

  // Giải bằng suy luận. Trả { solved, maxLevel, steps }.
  function deduce(P, startState) {
    var N = P.n * P.n, units = buildUnits(P.n, P.region);
    var state = startState ? startState.slice() : new Array(N).fill(1);
    var maxLevel = 0, steps = 0, queens;
    for (;;) {
      queens = 0;
      for (var i = 0; i < N; i++) if (state[i] === 2) queens++;
      if (queens === P.n) {
        // Dọn nốt các ô còn treo cho chắc chắn đã thoả luật.
        return { solved: true, maxLevel: maxLevel, steps: steps, state: state };
      }
      var step = findStep(P, state, units);
      if (!step) return { solved: false, maxLevel: maxLevel, steps: steps, state: state };
      applyStep(state, step);
      if (step.level > maxLevel) maxLevel = step.level;
      steps++;
    }
  }

  // ---- Sinh đề -----------------------------------------------------------------
  // opts: { difficulty: 'easy'|'medium'|'hard' }
  function generate(n, seed, opts) {
    if (n < GRID_MIN || n > GRID_MAX) throw new Error('N phải trong [' + GRID_MIN + ', ' + GRID_MAX + ']');
    opts = opts || {};
    var band = DIFFICULTY[opts.difficulty || 'medium'];
    var rand = rng(seed);
    var fallback = null;
    for (var attempt = 0; attempt < GEN_MAX_ATTEMPTS; attempt++) {
      var cols = placeQueens(n, rand);
      var region = growRegions(n, cols, rand);
      if (!repairUnique(n, region, cols, rand)) continue;
      // Xáo tên vùng: màu không được lộ hàng của hậu.
      var perm = shuffle(Array.from({ length: n }, function (_, i) { return i; }), rand);
      for (var i = 0; i < region.length; i++) region[i] = perm[region[i]];
      var P = { n: n, region: region, seed: seed };
      var res = deduce(P);
      if (!res.solved) continue;
      P.solution = [];
      for (i = 0; i < n * n; i++) if (res.state[i] === 2) P.solution.push(i);
      P.level = res.maxLevel;
      if (res.maxLevel >= band.min && res.maxLevel <= band.max) return P;
      // Giữ đề gần dải độ khó nhất để dùng khi hết lượt thử.
      if (!fallback || Math.abs(res.maxLevel - band.min) < Math.abs(fallback.level - band.min)) fallback = P;
    }
    if (fallback) return fallback;
    throw new Error('Không sinh được đề ' + n + '×' + n);
  }

  // ---- Kiểm tra bàn của người chơi ---------------------------------------------
  // cells[i]: 0 trống, 1 dấu ×, 2 hậu. Trả danh sách ô hậu đang vi phạm luật.
  function conflicts(P, cells) {
    var n = P.n, q = [], bad = {};
    for (var i = 0; i < cells.length; i++) if (cells[i] === 2) q.push(i);
    for (var a = 0; a < q.length; a++) {
      for (var b = a + 1; b < q.length; b++) {
        if (attacks(n, P.region, q[a], q[b])) { bad[q[a]] = true; bad[q[b]] = true; }
      }
    }
    return Object.keys(bad).map(Number);
  }

  function isSolved(P, cells) {
    var count = 0;
    for (var i = 0; i < cells.length; i++) if (cells[i] === 2) count++;
    return count === P.n && conflicts(P, cells).length === 0;
  }

  // Ô bị hậu hiện có chặn (cho chế độ tự đánh ×).
  function blockedCells(P, cells) {
    var n = P.n, out = new Array(cells.length).fill(false);
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] !== 2) continue;
      for (var j = 0; j < cells.length; j++) if (cells[j] !== 2 && attacks(n, P.region, i, j)) out[j] = true;
    }
    return out;
  }

  // Gợi ý một bước từ bàn hiện tại. autoX = người chơi bật tự đánh ×.
  function hint(P, cells, autoX) {
    var n = P.n, N = n * n, sol = {}, i;
    for (i = 0; i < P.solution.length; i++) sol[P.solution[i]] = true;

    for (i = 0; i < N; i++) {
      if (cells[i] === 2 && !sol[i]) {
        return { rule: 'wrong-queen', remove: i, focus: [i],
          text: 'Hậu ở ' + cellLabel(n, i) + ' không nằm trong lời giải — gỡ nó ra trước đã.' };
      }
    }
    for (i = 0; i < N; i++) {
      if (cells[i] === 1 && sol[i]) {
        return { rule: 'wrong-mark', remove: i, focus: [i],
          text: 'Dấu × ở ' + cellLabel(n, i) + ' đặt nhầm — ô này vẫn có thể là hậu.' };
      }
    }

    var state = new Array(N);
    for (i = 0; i < N; i++) state[i] = cells[i] === 2 ? 2 : cells[i] === 1 ? 0 : 1;
    if (autoX) {
      var blk = blockedCells(P, cells);
      for (i = 0; i < N; i++) if (blk[i] && state[i] === 1) state[i] = 0;
    }
    var step = findStep(P, state, buildUnits(n, P.region));
    if (!step) {
      // Không xảy ra với đề do generate() sinh; phòng hờ: chỉ thẳng một hậu.
      for (i = 0; i < P.solution.length; i++) {
        var c = P.solution[i];
        if (cells[c] !== 2) return { rule: 'reveal', place: c, focus: [c], text: 'Đặt hậu ở ' + cellLabel(n, c) + '.' };
      }
      return null;
    }
    return step;
  }

  function dailySeed(date) {
    var d = date || new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  var api = {
    GRID_MIN: GRID_MIN, GRID_MAX: GRID_MAX, DIFFICULTY: DIFFICULTY, REGION_NAMES: REGION_NAMES,
    rng: rng, generate: generate, countSolutions: countSolutions, findSolutions: findSolutions, deduce: deduce,
    conflicts: conflicts, isSolved: isSolved, blockedCells: blockedCells, hint: hint,
    attacks: attacks, touching: touching, dailySeed: dailySeed, cellLabel: cellLabel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QueensEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
