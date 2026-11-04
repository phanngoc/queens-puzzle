/* playtest.js — cổng G2/G3 cho Queens bằng Chrome headless (DevTools Protocol).
   Bơm chạm/kéo thật vào bàn cờ. Chạy: node test/playtest.js [url]
   Ảnh chụp: /tmp/queens-*.png */
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
// ws: thử gói cài riêng trước, rồi tới node_modules của platform (khi game nằm
// trong repo games/). Clone lẻ mà thiếu cả hai thì nói rõ phải làm gì.
let WebSocket;
for (const p of ['ws', '../../node_modules/ws', require('node:path').join(require('node:os').homedir(), 'goterm-workspace/games/node_modules/ws')]) {
  try { WebSocket = require(p); break; } catch (e) { /* thử tiếp */ }
}
if (!WebSocket) {
  console.error('Thiếu gói "ws" (chỉ harness cần, game thì không).\n  npm i --no-save ws');
  process.exit(2);
}

const SRV_PORT = 8890 + Math.floor(Math.random() * 90);
const URL = process.argv[2] || `http://127.0.0.1:${SRV_PORT}/`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// CDP port chosen by Chrome (--remote-debugging-port=0, read from DevToolsActivePort):
// a fixed port lets a concurrent harness attach to this Chrome.
let PORT = 0;
const VW = 390, VH = 844, VDPR = 3;      // iPhone 14 Pro — viewport mục tiêu của skill

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function gate(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' — ' + detail : ''));
}

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.waits = new Map(); this.events = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws.on('open', res); this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.id && this.waits.has(m.id)) { this.waits.get(m.id)(m); this.waits.delete(m.id); }
        else if (m.method) this.events.push(m);
      });
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waits.set(id, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result)));
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async tap(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'touch' });
    }
    await sleep(60);
  }
  async drag(x0, y0, x1, y1, steps) {
    steps = steps || 8;
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1, pointerType: 'touch' });
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', button: 'left', buttons: 1, pointerType: 'touch',
        x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps
      });
      await sleep(20);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1, pointerType: 'touch' });
    await sleep(80);
  }
  async shot(path) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    return path;
  }
}

const cellCenter = (i) => `(() => { const r = document.querySelectorAll('#board .cell')[${i}].getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;
const btnCenter = (sel) => `(() => { const r = document.querySelector('${sel}').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;

(async function main() {
  const srv = process.argv[2] ? null : spawn(process.execPath, [require('node:path').join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(SRV_PORT) }, stdio: 'ignore' });
  await sleep(300);
  const profile = fs.mkdtempSync('/tmp/queens-chrome-');
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--mute-audio', `--window-size=${VW},${VH}`, 'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  const q = (expr) => cdp.evaluate(expr);
  const tapCell = async (i) => { const p = await q(cellCenter(i)); await cdp.tap(p.x, p.y); };
  const tapSel = async (sel) => { const p = await q(btnCenter(sel)); await cdp.tap(p.x, p.y); await sleep(120); };
  const S = () => q('(() => { const g = window.__queens.state; return { n: g.n, cells: g.cells.slice(), solved: g.solved, sol: g.P.solution, seed: g.seed, mode: g.mode, hints: g.hints, diff: g.diff }; })()');

  try {
    for (let i = 0; i < 60 && !PORT; i++) { try { PORT = +fs.readFileSync(require('node:path').join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) { await sleep(200); } }
    if (!PORT) throw new Error('Chrome did not write DevToolsActivePort');
    for (let i = 0; i < 60; i++) { try { await getJSON('/json/version'); break; } catch (e) { await sleep(200); } }
    const page = (await getJSON('/json/list')).find((t) => t.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable']) await cdp.send(m);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: VDPR, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Page.navigate', { url: URL });
    await sleep(1500);

    console.log('\n── G2: BOOT ' + '─'.repeat(40));
    const errs = cdp.events.filter((e) => (e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && e.params.entry.source !== 'network') || e.method === 'Runtime.exceptionThrown');
    gate('0 lỗi JS', errs.length === 0, errs.length ? JSON.stringify(errs.slice(0, 2)).slice(0, 400) : 'sạch');
    const rulesOpen = await q(`!document.getElementById('rulesModal').classList.contains('hidden')`);
    gate('lần đầu vào hiện luật chơi', rulesOpen);
    await cdp.shot('/tmp/queens-rules.png');
    await tapSel('#btnRulesOk');
    let s = await S();
    const cellsN = await q(`document.querySelectorAll('#board .cell').length`);
    gate('bàn cờ dựng đủ ô', cellsN === s.n * s.n, `${s.n}×${s.n} = ${cellsN} ô`);
    const colors = await q(`new Set([...document.querySelectorAll('#board .cell')].map(e => e.style.background)).size`);
    gate('đủ N màu vùng', colors === s.n, colors + ' màu');
    const fit = await q(`({ sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight })`);
    gate('không tràn ngang ở 390×844', fit.sw <= fit.iw + 1, `${fit.sw} ≤ ${fit.iw}`);
    gate('không tràn dọc (vừa 1 màn)', fit.sh <= fit.ih + 1, `${fit.sh} ≤ ${fit.ih}`);
    const small = await q(`[...document.querySelectorAll('.act, .icon-btn, #segSize button, #segMode button')].filter(e => { const r = e.getBoundingClientRect(); return r.height < 36 || r.width < 36; }).map(e => e.id || e.textContent).join(', ')`);
    gate('nút bấm đủ lớn để chạm', !small, small || 'ok');
    await cdp.shot('/tmp/queens-start.png');

    console.log('\n── G3: CHƠI ĐƯỢC ' + '─'.repeat(34));
    // Ô không thuộc nghiệm để thử vòng × → hậu → trống.
    const free = s.cells.findIndex((v, i) => !s.sol.includes(i));
    await tapCell(free); let c1 = (await S()).cells[free];
    await tapCell(free); let c2 = (await S()).cells[free];
    await tapCell(free); let c3 = (await S()).cells[free];
    gate('chạm xoay vòng × → hậu → trống', c1 === 1 && c2 === 2 && c3 === 0, `${c1} → ${c2} → ${c3}`);

    // Kéo ngang hàng cuối → đánh × hàng loạt.
    const n = s.n, a = await q(cellCenter(n * (n - 1))), b = await q(cellCenter(n * n - 1));
    await cdp.drag(a.x, a.y, b.x, b.y, 12);
    s = await S();
    const marked = s.cells.slice(n * (n - 1)).filter((v) => v === 1).length;
    gate('kéo qua một hàng đánh × cả hàng', marked === n, marked + '/' + n + ' ô');
    await tapSel('#btnUndo');
    s = await S();
    gate('hoàn tác gỡ cả nét kéo trong 1 bước', s.cells.every((v) => v === 0));

    // Hai hậu chạm chéo → viền đỏ.
    await tapCell(0); await tapCell(0); await tapCell(n + 1); await tapCell(n + 1);
    const errCount = await q(`document.querySelectorAll('#board .cell.err').length`);
    gate('hai hậu chạm chéo bị tô đỏ', errCount === 2, errCount + ' ô đỏ');
    await cdp.shot('/tmp/queens-conflict.png');
    await tapSel('#btnClear');

    // Gợi ý: hiện lời giải thích, "làm giúp" đổi bàn.
    await tapSel('#btnHint');
    const hintTxt = await q(`document.getElementById('hintBox').classList.contains('hidden') ? '' : document.getElementById('hintText').textContent`);
    gate('gợi ý hiện lời giải thích', hintTxt.length > 15, hintTxt.slice(0, 90));
    await cdp.shot('/tmp/queens-hint.png');
    const before = JSON.stringify((await S()).cells);
    await tapSel('#btnApply');
    gate('“làm giúp” áp dụng gợi ý lên bàn', JSON.stringify((await S()).cells) !== before);
    await tapSel('#btnClear');

    // Lưu ván dở: tải lại trang vẫn còn.
    await tapCell(s.sol[0]); await tapCell(s.sol[0]);
    const seedBefore = (await S()).seed;
    await cdp.send('Page.reload'); await sleep(1300);
    s = await S();
    gate('tải lại trang giữ nguyên ván dở', s.seed === seedBefore && s.cells[s.sol[0]] === 2);

    // Giải trọn bằng chạm thật → màn thắng.
    for (const c of s.sol) { if (s.cells[c] !== 2) { await tapCell(c); await tapCell(c); } }
    await sleep(1800);
    s = await S();
    const winShown = await q(`!document.getElementById('winModal').classList.contains('hidden')`);
    gate('đặt đủ hậu đúng → thắng + hiện màn chúc mừng', s.solved && winShown, 'thời gian ' + await q(`document.getElementById('wTime').textContent`));
    await cdp.shot('/tmp/queens-win.png');
    await tapSel('#btnWinNext');
    s = await S();
    gate('“Ván mới” sau khi thắng ra đề khác', !s.solved && s.cells.every((v) => v === 0) && s.seed !== seedBefore);

    // 9×9 Khó: chỉ bấm 💡 + "làm giúp" đến khi thắng — gợi ý phải luôn đủ để giải.
    await tapSel('#segSize button[data-n="9"]'); await tapSel('#segDiff button[data-d="hard"]');
    s = await S();
    let guard = 0;
    while (!s.solved && guard++ < 300) {
      await q(`(window.__queens.hint(), window.__queens.apply(), 0)`);
      s = await S();
    }
    gate('9×9 Khó giải được trọn bằng chuỗi gợi ý', s.n === 9 && s.diff === 'hard' && s.solved, guard + ' bước gợi ý');
    await sleep(1500);
    await tapSel('#btnWinClose');
    await cdp.shot('/tmp/queens-9x9.png');

    // Đề hôm nay: cố định theo ngày.
    await tapSel('#segMode button[data-mode="daily"]');
    s = await S();
    const d = new Date(), seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    gate('đề hôm nay = 8×8, seed theo ngày', s.mode === 'daily' && s.n === 8 && s.seed === seed, 'seed ' + s.seed);
    await cdp.shot('/tmp/queens-daily.png');

    // Giải đề hôm nay → màn thắng có 🔥 chuỗi ngày + nút Chia sẻ chép 1 dòng, không có bàn cờ.
    await q(`(navigator.share = undefined, window.__copied = '', navigator.clipboard && (navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }), 0)`);
    guard = 0;
    while (!s.solved && guard++ < 300) { await q(`(window.__queens.hint(), window.__queens.apply(), 0)`); s = await S(); }
    await sleep(8 * 90 + 700);
    const streakTxt = await q(`document.getElementById('wStreak').textContent`);
    gate('thắng đề hôm nay → màn thắng hiện 🔥1', s.solved && streakTxt === '🔥1', streakTxt);
    await cdp.shot('/tmp/queens-win-daily.png');
    await tapSel('#btnShare'); await sleep(200);
    const copied = await q('window.__copied');
    gate('nút Chia sẻ chép dòng kết quả', /^Queens \d\d\/\d\d · 8×8 · \d\d:\d\d · \d+ gợi ý 🔥1 https:\/\/queens\.bomclaw\.org$/.test(copied), copied);
    gate('dòng chia sẻ không chứa bàn cờ', !/[👑⬛⬜🟥🟦🟩🟨🟪🟧]|\n/u.test(copied));
    const streak3 = await q(`(() => { const d = new Date(), o = {}; for (let k = 0; k < 3; k++) { const x = new Date(d); x.setDate(d.getDate() - k); o[x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')] = 60; } return window.__queens.streakOf(o); })()`);
    gate('streak đếm ngày liên tiếp', streak3 === 3, String(streak3));

    const late = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
    gate('0 exception JS suốt phiên chơi', late.length === 0, late.length ? JSON.stringify(late[0]).slice(0, 300) : 'sạch');
  } catch (e) {
    gate('harness chạy hết', false, e.message);
    if (cdp) await cdp.shot('/tmp/queens-fail.png').catch(() => {});
  } finally {
    if (cdp) cdp.ws.close();
    chrome.kill('SIGKILL');
    if (srv) try { srv.kill(); } catch (e) {}
    fs.rmSync(profile, { recursive: true, force: true });
    const bad = results.filter((r) => !r.ok);
    console.log('\n' + (results.length - bad.length) + '/' + results.length + ' cổng pass');
    process.exit(bad.length ? 1 : 0);
  }
})();
