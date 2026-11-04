/* Test engine Queens: node test/engine.test.js */
'use strict';
var assert = require('assert');
var E = require('../engine.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}

function regionsConnected(P) {
  var n = P.n;
  for (var g = 0; g < n; g++) {
    var cells = [];
    for (var i = 0; i < n * n; i++) if (P.region[i] === g) cells.push(i);
    if (!cells.length) return false;
    var seen = {}, stack = [cells[0]], cnt = 0;
    seen[cells[0]] = true;
    while (stack.length) {
      var x = stack.pop(); cnt++;
      var r = (x / n) | 0, c = x % n;
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(function (p) {
        if (p[0] < 0 || p[1] < 0 || p[0] >= n || p[1] >= n) return;
        var y = p[0] * n + p[1];
        if (!seen[y] && P.region[y] === g) { seen[y] = true; stack.push(y); }
      });
    }
    if (cnt !== cells.length) return false;
  }
  return true;
}

function boardFrom(P, cellsList, val) {
  var b = new Array(P.n * P.n).fill(0);
  cellsList.forEach(function (c) { b[c] = val; });
  return b;
}

var SEEDS = 25;
console.log('Engine Queens');

[6, 7, 8, 9].forEach(function (n) {
  ['easy', 'medium', 'hard'].forEach(function (d) {
    test(n + '×' + n + ' ' + d + ': ' + SEEDS + ' seed đều có đúng 1 nghiệm, đủ N vùng liên thông, giải được bằng suy luận', function () {
      for (var s = 1; s <= SEEDS; s++) {
        var P = E.generate(n, s * 104729 + n, { difficulty: d });
        assert.strictEqual(E.countSolutions(n, P.region, 2), 1, 'seed ' + s + ' không duy nhất');
        assert.strictEqual(new Set(P.region).size, n, 'seed ' + s + ' số vùng ≠ N');
        assert.ok(regionsConnected(P), 'seed ' + s + ' có vùng không liên thông');
        var res = E.deduce(P);
        assert.ok(res.solved, 'seed ' + s + ' suy luận bị kẹt');
        assert.ok(E.isSolved(P, boardFrom(P, P.solution, 2)), 'seed ' + s + ' nghiệm sai luật');
        var sol = E.findSolutions(n, P.region, 1)[0];
        var solCells = sol.map(function (c, r) { return r * n + c; });
        assert.deepStrictEqual(solCells.slice().sort(), P.solution.slice().sort(), 'nghiệm suy luận ≠ nghiệm backtracking');
      }
    });
  });
});

test('cùng seed ⇒ cùng đề (câu đố ngày giống nhau trên mọi máy)', function () {
  var a = E.generate(8, 20261020), b = E.generate(8, 20261020);
  assert.deepStrictEqual(a.region, b.region);
});

test('sinh đề 9×9 khó dưới 300ms', function () {
  for (var s = 1; s <= 10; s++) {
    var t = Date.now();
    E.generate(9, 777 + s, { difficulty: 'hard' });
    assert.ok(Date.now() - t < 300, 'seed ' + s + ' mất ' + (Date.now() - t) + 'ms');
  }
});

test('conflicts: hai hậu chạm chéo bị đánh dấu', function () {
  var P = E.generate(6, 1);
  var b = new Array(36).fill(0);
  b[0] = 2; b[7] = 2;
  assert.deepStrictEqual(E.conflicts(P, b).sort(), [0, 7]);
});

test('hint trên bàn trống trả một bước suy luận có lời giải thích', function () {
  var P = E.generate(8, 42);
  var h = E.hint(P, new Array(64).fill(0), true);
  assert.ok(h && h.text && h.text.length > 10);
  assert.ok(h.place != null || (h.elim && h.elim.length));
});

test('hint chỉ ra hậu đặt sai', function () {
  var P = E.generate(7, 9);
  var wrong = -1;
  for (var i = 0; i < 49; i++) if (P.solution.indexOf(i) === -1) { wrong = i; break; }
  var h = E.hint(P, boardFrom(P, [wrong], 2), true);
  assert.strictEqual(h.rule, 'wrong-queen');
  assert.strictEqual(h.remove, wrong);
});

test('hint chỉ ra dấu × đặt nhầm lên ô nghiệm', function () {
  var P = E.generate(7, 10);
  var h = E.hint(P, boardFrom(P, [P.solution[0]], 1), true);
  assert.strictEqual(h.rule, 'wrong-mark');
});

test('làm theo gợi ý liên tục thì giải xong', function () {
  [6, 8, 9].forEach(function (n) {
    var P = E.generate(n, 31337 + n, { difficulty: 'hard' });
    var b = new Array(n * n).fill(0), guard = 0;
    while (!E.isSolved(P, b) && guard++ < 500) {
      var h = E.hint(P, b, true);
      assert.ok(h, 'không có gợi ý ở ' + n + '×' + n);
      if (h.place != null) b[h.place] = 2;
      if (h.elim) h.elim.forEach(function (c) { b[c] = 1; });
    }
    assert.ok(E.isSolved(P, b), n + '×' + n + ' không giải xong theo gợi ý');
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
