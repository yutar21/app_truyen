// Novel Studio GUI Logic Tiếng Việt (Zero dependencies).


const IS_TAURI = location.hostname === 'tauri.localhost' || location.protocol === 'tauri:' || (typeof window !== 'undefined' && !!window.__TAURI__);
const API = (!IS_TAURI && (location.protocol === 'http:' || location.protocol === 'https:'))
  ? location.origin : 'http://127.0.0.1:8799';

// Gọi lệnh native Tauri (Desktop app)
const HAS_TAURI = typeof window !== 'undefined' && !!window.__TAURI__;
async function tauriInvoke(cmd, args) {
  const t = window.__TAURI__;
  if (!t) throw new Error('not-tauri');
  const inv = (t.core && t.core.invoke) || t.invoke;
  if (!inv) throw new Error('Tauri invoke không khả dụng');
  return inv(cmd, args);
}

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtTok = (n) => !n ? '0' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : '' + n;
const fmtCost = (n) => (!n || n <= 0) ? '¥0' : n < 0.01 ? '<¥0.01' : n < 1 ? '¥' + n.toFixed(3).replace(/0$/, '') : '¥' + n.toFixed(2);

async function api(p, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(API + p, opt);
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : {}; } catch { j = { error: t }; }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

let STATE = { models: [], books: [], sessions: [], config: {}, env: null };
let STOP_DRAINING = false;   // 优雅停止中（按钮已变"立即停止"）
let CUR = null;       // 当前打开的书
let STREAM = null;    // 当前 SSE
const PUBLISHING = new Set();   // 正在发布的书 slug（客户端状态；关弹窗后仍可从书卡回到进度）

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------- Điều hướng ----------
document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
function showView(name) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const map = { shelf: 'view-shelf', usage: 'view-usage', settings: 'view-settings', env: 'view-env' };
  $('#' + (map[name] || 'view-shelf')).classList.remove('hidden');
  if (name === 'usage') renderUsage();
  if (name === 'settings') renderSettings();
  if (name === 'env') renderEnv();
  if (name === 'shelf') closeStream();
}

// ---------- Khởi động ----------
async function boot() {
  try {
    const b = await api('/api/bootstrap');
    STATE = { ...STATE, ...b };
    try { STATE.styles = await api('/api/styles'); } catch { STATE.styles = []; }
    $('#engineDot').classList.add('ok'); $('#engineText').textContent = 'Engine AI Đã Kết Nối';
    renderShelf(); fillModels(); fillStyles();
  } catch (e) {
    $('#engineDot').classList.add('bad'); $('#engineText').textContent = 'Engine AI Chưa Kết Nối';
    setTimeout(boot, 1500);
  }
}
async function refresh() { try { const b = await api('/api/bootstrap'); STATE = { ...STATE, ...b }; renderShelf(); } catch { } }

function fillModels() {
  const opts = STATE.models.map(m => `<option value="${m.id}" ${m.available ? '' : 'disabled'}>${esc(m.name)}${m.available ? '' : ' (Chưa cài đặt)'}</option>`).join('');
  $('#nbModel').innerHTML = opts; $('#writeModel').innerHTML = opts;
  const imp = $('#nbImpModel'); if (imp) imp.innerHTML = opts;
}
function fillStyles() {
  const sel = $('#nbStyle'); if (!sel) return;
  const presets = (STATE.styles || []).map(s => `<option value="${s.id}">${esc(s.name)}（${esc(s.short)}）</option>`).join('');
  sel.innerHTML = `<option value="auto">🤖 AI tự động chọn theo thể loại (Khuyên dùng)</option>` + presets;
}

// ---------- Tủ sách ----------
function renderShelf() {
  const shelf = $('#shelf'); shelf.innerHTML = '';
  const running = new Set(STATE.sessions.filter(s => s.running !== false).map(s => s.slug));
  for (const b of STATE.books) {
    const card = el('div', 'book-card');
    const coverImg = b.stats?.cover
      ? `<img class="card-cover" src="${API}/api/book/cover?book=${encodeURIComponent(b.slug)}&t=${b.stats.coverMtime || 0}" alt="Ảnh bìa">`
      : `<div class="card-cover none">Chưa Có<br>Ảnh Bìa</div>`;
    card.innerHTML = `
      ${running.has(b.slug) ? '<div class="running-tag"><span class="dot live"></span>Đang Sáng Tác</div>' : ''}
      <button class="card-del" data-act="del" title="Xóa tác phẩm này">🗑</button>
      <div class="card-top">
        ${coverImg}
        <div class="card-info">
          <h3>《${esc(b.title)}》</h3>
          <div class="genre">${esc(b.genre || '—')}</div>
        </div>
      </div>
      <div class="meta">
        <span class="pill model">${esc(modelName(b.model))}</span>
        ${b.status === 'Đã Hoàn Thành' ? '<span class="pill done">✅ Đã Hoàn Thành</span>' : b.status === 'Đang Hồi Kết' ? '<span class="pill finale">🏁 Đang Hồi Kết</span>' : ''}
        ${b.fanqie?.status ? `<span class="pill ${b.fanqie.status === 'Đã Kết Thúc' ? 'done' : (b.status === 'Đã Hoàn Thành' && b.fanqie.status !== 'Đã Kết Thúc' ? 'warn' : '')}" title="Trạng thái nền tảng">Nền tảng · ${esc(b.fanqie.status)}</span>` : ''}
        <span class="pill">${b.stats?.chapters || 0} Chương</span>
        <span class="pill">${b.stats?.kb || 0} KB</span>
        <span class="pill">tokens ${fmtTok(b.tokens || 0)}</span>
        ${PUBLISHING.has(b.slug) ? '<span class="pill publishing" data-act="pubbadge" title="Đang đăng lên nền tảng, bấm để xem tiến độ">📤 Đang Đăng</span>' : ''}
      </div>
      <div class="card-actions">
        <button class="card-btn" data-act="write">✍️ Viết Tiếp</button>
        <button class="card-btn" data-act="read">📖 Đọc Truyện</button>
        <button class="card-btn" data-act="review">🔍 Rà Soát</button>
        <button class="card-btn" data-act="nameexp">🧪 Đổi Tên/Bìa</button>
      </div>`;
    card.querySelector('[data-act="write"]').addEventListener('click', (e) => { e.stopPropagation(); openWrite(b); });
    card.querySelector('[data-act="read"]').addEventListener('click', (e) => { e.stopPropagation(); openReader(b); });
    card.querySelector('[data-act="review"]').addEventListener('click', (e) => { e.stopPropagation(); CUR = b; openReview(); });
    card.querySelector('[data-act="nameexp"]').addEventListener('click', (e) => { e.stopPropagation(); openNameExp(b); });
    card.querySelector('[data-act="del"]').addEventListener('click', (e) => { e.stopPropagation(); openDelete(b); });
    const pubBadge = card.querySelector('[data-act="pubbadge"]');
    if (pubBadge) pubBadge.addEventListener('click', (e) => { e.stopPropagation(); CUR = b; openPublish(b); });
    card.addEventListener('click', () => openWrite(b));
    shelf.appendChild(card);
  }
  const add = el('div', 'book-card new', '＋ Tạo Sách Mới');
  add.addEventListener('click', openModal);
  shelf.appendChild(add);
}
function modelName(id) { return (STATE.models.find(m => m.id === id) || {}).name || id; }

// ---------- Bàn viết truyện ----------
function openWrite(book) {
  CUR = book; showWriteView();
  $('#writeTitle').textContent = '《' + book.title + '》';
  $('#writeModel').value = book.model || STATE.config.defaultModel;
  syncWebProfileUI();   // 若默认/上次是网页版模型 → 显示并填充网页账号选择器
  // 探索式(freehand)没有大纲：不能让 AI 自己"续写下一批"——没有作者的情节就该停下等
  $('#writeTask').value = book.planMode === 'freehand'
    ? `Hãy đọc kỹ AGENTS.md và novel_bible.md về [Kỹ thuật viết]. Tác phẩm này theo phong cách tự do, không có sẵn dàn ý: Hãy tự phân chia tình tiết tôi cung cấp thành 3-5 chương viết hoàn chỉnh rồi dừng lại; nếu tôi chưa đưa tình tiết mới hãy dừng lại chờ chỉ dẫn.`
    : `Hãy đọc AGENTS.md quy chuẩn sáng tác và novel_bible.md, viết tiếp đợt tiếp theo gồm ${book.standards?.batchSize || 3} chương, viết xong tự kiểm tra lại.`;
  $('#mirror').textContent = '（Khi bắt đầu viết, tiến trình AI sáng tác sẽ hiển thị trực tiếp tại đây）';
  $('#logFeed').innerHTML = '';
  $('#wbTarget').value = book.targetChapters || 0;
  $('#writeMode').value = book.participation || (book.writeMode === 'review' ? 'chapter' : 'volume');
  // 探索式(freehand)：全书不建任何大纲 → 藏掉「🧭 本卷大纲」，改用共创面板逐段给情节
  if ($('#btnVolPlan')) $('#btnVolPlan').classList.toggle('hidden', book.planMode === 'freehand');
  setSynopsisBox(book);
  const running = STATE.sessions.find(s => s.slug === book.slug && s.running !== false);
  setWriting(!!running);
  $('#writeTokens').textContent = 'tokens ' + fmtTok(book.tokens || 0);
  hideReviewBar(); showReviewBar();   // 若有待确认审稿，恢复动作条
  renderBoard(book.slug);   // 创作看板：我在哪 / 健康体检 / 下一步
  if (running) openStream(book.slug);
}
// 创作看板
async function renderBoard(slug) {
  const box = $('#wbBoard'); if (!box) return;
  box.innerHTML = '<div class="board-load">Đang tải bảng điều khiển…</div>';
  try {
    const d = await api('/api/book/dashboard?book=' + encodeURIComponent(slug));
    const wan = (d.words / 10000);
    const wanTxt = wan >= 1 ? wan.toFixed(1) + ' vạn' : Math.round(d.words) + ' chữ';
    const volTxt = d.curVol ? 'Quyển ' + d.curVol + (d.plannedVolumes ? '/' + d.plannedVolumes : '') : 'Đang chuẩn bị';
    const h = d.health || {};
    const healthRows = [];
    healthRows.push(`<div class="bd-h"><span class="dot ${h.ledger ? 'ok' : 'bad'}"></span>Hồ sơ tính nhất quán: ${h.ledger ? 'Hoạt động tốt ✅' : 'Chưa có ⚠️'}</div>`);
    if (h.lastReview) {
      const clean = (h.crit || 0) === 0 && (h.warn || 0) === 0;
      healthRows.push(`<div class="bd-h"><span class="dot ${clean ? 'ok' : (h.crit ? 'bad' : 'warn')}"></span>Tự kiểm gần nhất: ${h.crit ? 'Hạt sạn ' + h.crit + ' điểm' : ''}${h.warn ? (h.crit ? ' · ' : '') + 'Điểm lưu ý ' + h.warn : ''}${clean ? 'Không có hạt sạn, logic tốt ✅' : ''}</div>`);
    }
    const pct = d.plannedChapters ? d.progress : null;
    box.innerHTML =
      `<div class="bd-head"><span class="bd-status">${esc(d.status || 'Đang Ra')}</span>${d.participation ? '<span class="bd-part">' + ({ auto: '🤖 Tự Động Hoàn Toàn', volume: '🧭 Kiểm Soát Đầu Quyển', chapter: '✍️ Giám Sát Từng Đợt' }[d.participation] || '') + '</span>' : ''}</div>` +
      `<div class="bd-kpis">` +
      `<div class="bd-kpi"><b>${esc(volTxt)}</b><span>Tiến độ</span></div>` +
      `<div class="bd-kpi"><b>${d.chapters}</b><span>Số chương</span></div>` +
      `<div class="bd-kpi"><b>${esc(wanTxt)}</b><span>Số từ</span></div>` +
      `<div class="bd-kpi"><b>${fmtTok(d.tokens || 0)}</b><span>tokens</span></div>` +
      `</div>` +
      (pct != null ? `<div class="bd-bar"><i style="width:${pct}%"></i></div><div class="bd-pct">${pct}% · Mục tiêu ~${d.plannedChapters} chương</div>` : '') +
      `<div class="bd-health">${healthRows.join('')}</div>`;
  } catch (e) { box.innerHTML = '<div class="board-load">Bảng điều khiển tạm chưa khả dụng</div>'; }
}
function showWriteView() {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#view-write').classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
}
function setWriting(on) {
  if (on) { STOP_DRAINING = false; $('#btnStop').textContent = '■ Dừng Lại'; }
  $('#btnStart').disabled = on; $('#btnStop').disabled = !on;
  $('#writeStatus').textContent = on ? 'Đang Sáng Tác' : 'Chưa Bắt Đầu';
  $('#writeStatus').classList.toggle('on', on);
  $('#mirrorDot').style.display = on ? '' : 'none';
}

// —— 网页版写作：账号选择器（只在选中「网页版」模型时出现）——
// 网页版写作要驱动一个已登录该聊天站点（千问/豆包/ChatGPT/Claude）的 Unzoo 账号窗口。
let WEB_PROFILES = null;   // 缓存 /api/unzoo/profiles 账号列表
function isWebModel(id) { return (STATE.models || []).find(m => m.id === id)?.kind === 'web'; }
function webProfileKey(slug) { return 'novelstudio:webProfile:' + slug; }
async function syncWebProfileUI() {
  const wrap = $('#webProfileWrap'); if (!wrap) return;
  const web = isWebModel($('#writeModel').value);
  wrap.classList.toggle('hidden', !web);
  if (!web) return;
  const sel = $('#webProfile');
  if (!WEB_PROFILES) {
    try { const r = await api('/api/unzoo/profiles', 'POST', {}); WEB_PROFILES = r.profiles || []; }
    catch { WEB_PROFILES = []; }
  }
  const b = (STATE.books.find(x => x.slug === CUR?.slug)) || CUR || {};
  const remembered = (CUR && localStorage.getItem(webProfileKey(CUR.slug)))
    || b.webProfilePath || (b.publish || {}).profilePath || '';
  if (!WEB_PROFILES.length) {
    sel.innerHTML = '<option value="">(Chưa phát hiện tài khoản Unzoo, vui lòng đăng nhập trên Unzoo)</option>';
    return;
  }
  sel.innerHTML = WEB_PROFILES.map(p => {
    const label = p.dir && p.dir !== p.name ? `${p.name} · ${p.dir}` : p.name;
    const tag = p.running ? '○ Đang chạy' : '· Chưa mở';
    return `<option value="${esc(p.path)}" ${p.path === remembered ? 'selected' : ''}>${esc(label)}（${tag}）</option>`;
  }).join('');
}
$('#writeModel').addEventListener('change', syncWebProfileUI);
// 参与度实时切换（写作前/中均可，立即生效）
$('#writeMode') && $('#writeMode').addEventListener('change', async () => {
  if (!CUR) return;
  const level = $('#writeMode').value;   // auto | volume | chapter
  if (CUR) CUR.participation = level;
  try {
    await api('/api/book/participation', 'POST', { book: CUR.slug, level });
    toast(level === 'chapter' ? 'Mức độ tham gia → Giám sát từng đợt (Viết xong mỗi đợt dừng chờ duyệt)' : level === 'volume' ? 'Mức độ tham gia → Kiểm soát đầu quyển (Dừng duyệt khi sang quyển mới)' : 'Mức độ tham gia → Tự động hoàn toàn (AI viết liên tục)');
  } catch (e) { toast('Chuyển đổi thất bại: ' + e.message); }
});
$('#webProfile')?.addEventListener('change', () => {
  if (CUR && $('#webProfile').value) localStorage.setItem(webProfileKey(CUR.slug), $('#webProfile').value);
});

$('#btnBack').addEventListener('click', () => { closeStream(); showView('shelf'); refresh(); });

// Không có状态省钱模式：【默认开·已固化为标准写法】——每章全新进程+精准上下文包，成本恒定；
// 关掉才回长驻会话模式(越写越贵)。记住选择；想关必须过一次警告确认。
const NS_STATELESS_KEY = 'ns_stateless_default';
(function initStateless() {
  const saved = localStorage.getItem(NS_STATELESS_KEY);
  const on = saved === null ? true : saved === '1';   // 默认开
  $('#statelessMode').checked = on;
  $('#slBatchWrap').classList.toggle('hidden', !on);
})();
$('#statelessMode').addEventListener('change', () => {
  const on = $('#statelessMode').checked;
  if (!on && !confirm('Tắt「Chế độ tiết kiệm token」= Trở về phiên làm việc dài (chi phí token tăng cao và dễ trôi bối cảnh). Bạn có chắc chắn muốn tắt không?')) {
    $('#statelessMode').checked = true; return;   // 取消关闭，保持开
  }
  localStorage.setItem(NS_STATELESS_KEY, on ? '1' : '0');
  $('#slBatchWrap').classList.toggle('hidden', !on);
});
$('#btnStart').addEventListener('click', async () => {
  if (!CUR) return;
  $('#btnStart').disabled = true; $('#writeStatus').textContent = 'Đang khởi động…';
  const model = $('#writeModel').value;
  const isWeb = (STATE.models || []).find(m => m.id === model)?.kind === 'web';
  const isApi = (STATE.models || []).find(m => m.id === model)?.kind === 'api';
  const stateless = $('#statelessMode').checked;
  try {
    if (isApi) {
      // API 写作：直连智谱/DeepSeek/通义 API 写小说，模型直接返回整段→引擎解析落盘（批数复用Không có状态那个输入）。
      const batches = Math.max(1, parseInt($('#statelessBatches').value, 10) || 3);
      const nm = (STATE.models || []).find(m => m.id === model)?.name || model;
      const r = await api('/api/book/api-write', 'POST', { book: CUR.slug, provider: model.replace(/^api-/, ''), batches });
      $('#mirror').textContent = '🔌 Đang viết qua API (Kết nối trực tiếp mô hình lớn, lưu file tự động). Xem tiến độ ở nhật ký bên dưới.';
      setWriting(true); openStream(CUR.slug);
      toast(`Bắt đầu viết qua API: ${nm} (${batches} đợt)`);
    } else if (isWeb) {
      // 网页版写作：驱动 通义千问/豆包/ChatGPT/Claude 网页版，模型只吐文字→引擎抓正文自己落盘（批数复用Không có状态那个输入）。
      const batches = Math.max(1, parseInt($('#statelessBatches').value, 10) || 3);
      const nm = (STATE.models || []).find(m => m.id === model)?.name || model;
      const webProfile = $('#webProfile')?.value || '';
      if (!webProfile) { toast('Vui lòng chọn tài khoản Web (Unzoo) đã đăng nhập'); setWriting(false); $('#btnStart').disabled = false; $('#writeStatus').textContent = 'Chưa Bắt Đầu'; return; }
      localStorage.setItem(webProfileKey(CUR.slug), webProfile);
      await api('/api/book/web-write', 'POST', { book: CUR.slug, adapterId: model.replace(/^web-/, ''), batches, profilePath: webProfile });
      $('#mirror').textContent = '🌐 Đang viết qua Web (Điều khiển trình duyệt viết truyện và lưu file). Xem tiến độ ở nhật ký bên dưới.';
      setWriting(true); openStream(CUR.slug);
      toast(`Bắt đầu viết qua Web: ${nm} (${batches} đợt)`);
    } else if (stateless) {
      const batches = Math.max(1, parseInt($('#statelessBatches').value, 10) || 3);
      const r = await api('/api/book/stateless-start', 'POST', { book: CUR.slug, model: $('#writeModel').value, batches, participation: $('#writeMode').value });
      $('#mirror').textContent = '♻️ Chế độ tiết kiệm token đang chạy. Xem tiến độ ở nhật ký bên dưới: Mỗi đợt chạy tiến trình mới hoàn toàn.';
      setWriting(true); openStream(CUR.slug);
      toast(r.untilTarget ? 'Chế độ tiết kiệm: Viết đến số chương mục tiêu (Có thể dừng bất kỳ lúc nào)' : `Chế độ tiết kiệm: Viết ${batches} đợt`);
    } else {
      const participation = $('#writeMode').value;   // auto | volume | chapter
      await api('/api/write', 'POST', { book: CUR.slug, model: $('#writeModel').value, task: $('#writeTask').value, participation });
      if (CUR) CUR.participation = participation;
      setWriting(true); openStream(CUR.slug);
      toast(participation === 'chapter' ? 'Bắt đầu viết · Giám sát từng đợt (Viết xong mỗi đợt dừng chờ duyệt)' : participation === 'volume' ? 'Bắt đầu viết · Kiểm soát đầu quyển (Sang quyển mới dừng chờ duyệt dàn ý)' : 'Bắt đầu viết · Tự động hoàn toàn (AI viết liên tục)');
    }
  } catch (e) { toast('Khởi động thất bại: ' + e.message); setWriting(false); }
});
// 写作模式热切换（提前选或写作中随时切）：立即生效，Không có需重开窗口
$('#writeMode').addEventListener('change', async () => {
  if (!CUR) return;
  const mode = $('#writeMode').value === 'review' ? 'review' : 'auto';
  try {
    await api('/api/book/review-mode', 'POST', { book: CUR.slug, mode });
    CUR.writeMode = mode; const b = STATE.books.find(x => x.slug === CUR.slug); if (b) b.writeMode = mode;
    if (mode === 'auto') hideReviewBar();
    toast(mode === 'review' ? 'Đã chuyển sang duyệt từng đợt: Viết xong đợt này sẽ dừng chờ duyệt' : 'Đã chuyển sang tự động hoàn toàn: AI viết liên tục không dừng');
  } catch (e) { toast('Chuyển đổi thất bại: ' + e.message); }
});
$('#btnStop').addEventListener('click', async () => {
  if (!CUR) return;
  try {
    const r = await api('/api/stop', 'POST', { book: CUR.slug, force: STOP_DRAINING });
    if (r.mode === 'draining') {
      STOP_DRAINING = true; $('#btnStop').textContent = '■ Dừng Ngay Lập Tức';
      toast('Đã gửi yêu cầu dừng: Hoàn thành đợt này sẽ dừng (Bấm lần nữa để dừng ngay)');
    } else {
      STOP_DRAINING = false; $('#btnStop').textContent = '■ Dừng Lại';
      setWriting(false); closeStream(); toast('Đã dừng và đóng phiên làm việc');
    }
  } catch (e) { toast(e.message); }
});
// 切换模型即持久化到 book.model（卡片/下次默认值/续写都跟上）。运行中的旧窗口换不了模型，提示需重开。
$('#writeModel').addEventListener('change', async () => {
  if (!CUR) return;
  const model = $('#writeModel').value;
  try {
    const r = await api('/api/book/set-model', 'POST', { book: CUR.slug, model });
    CUR.model = model;
    const b = STATE.books.find(x => x.slug === CUR.slug); if (b) b.model = model;
    if (r.needReopen) toast(`Đã chuyển sang ${modelName(model)}: Phiên đang chạy ${modelName(r.liveModel)}, bấm Bắt Đầu Viết sẽ dùng mô hình mới`);
    else toast('Mô hình mặc định đã đổi thành: ' + modelName(model));
  } catch (e) { toast('Đổi mô hình thất bại: ' + e.message); }
});
// ---------- 复检 ----------
function openReview() {
  if (!CUR) return;
  $('#rvErr').textContent = '';
  // 取最新的书(含 stats: volumes / maxChapter / chapters)
  const b = STATE.books.find(x => x.slug === CUR.slug) || CUR;
  const st = b.stats || {};
  const vols = st.volumes || [];
  const maxCh = st.maxChapter || st.chapters || 0;
  $('#rvBookInfo').textContent = `(Tổng cộng ${st.chapters || 0} chương` + (vols.length ? ` · ${vols.length} quyển` : '') + ')';
  $('#rvVol').innerHTML = vols.length ? vols.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('') : '<option value="">(Chưa có danh mục phân quyển)</option>';
  $('#rvFrom').value = 1; $('#rvTo').value = maxCh || '';
  $('#rvRangeType').value = 'all'; rvSync();
  $('#reviewModal').classList.remove('hidden');
}
function rvSync() {
  const t = $('#rvRangeType').value;
  $('#rvVolWrap').classList.toggle('hidden', t !== 'vol');
  $('#rvChapWrap').classList.toggle('hidden', t !== 'chap');
  $('#rvRecentWrap').classList.toggle('hidden', t !== 'recent');
}
function rvRange() {
  const t = $('#rvRangeType').value;
  if (t === 'all') return 'Toàn bộ tác phẩm';
  if (t === 'vol') return $('#rvVol').value || 'Toàn bộ tác phẩm';
  if (t === 'recent') return 'Gần nhất ' + (Number($('#rvRecent').value) || 10) + ' chương';
  // chap：零填充三位
  const pad = n => String(Math.max(1, Number(n) || 1)).padStart(3, '0');
  return pad($('#rvFrom').value) + '-' + pad($('#rvTo').value);
}
$('#btnReview').addEventListener('click', openReview);

// ---------- 🤝 共创模式（你出主意 · AI 逐章）----------
const CW_MODELS = ['claude', 'codex', 'gemini', 'qwen'];   // 能开【可见窗口】的强 CLI
// 共创里两类活对模型要求不同：出主意/写一章只要能出文本（API 与本地模型都行），
// 只有「连写 3–5 章」要开可见窗口、非 CLI 不可。所以下拉不能只列 CLI。
const cwIsWindowModel = (id) => CW_MODELS.includes(id);
const cwIsApiModel = (id) => (STATE.models || []).find(m => m.id === id)?.kind === 'api';
function cwNextNum() {
  const b = STATE.books.find(x => x.slug === CUR?.slug) || CUR || {};
  const st = b.stats || {};
  return (st.maxChapter || st.chapters || 0) + 1;
}
function openCowrite() {
  if (!CUR) return;
  // 模型下拉：能开窗口的 CLI + 能出文本的 API/本地模型（后者走Không có头模式，见下方按钮提示）
  const avail = (STATE.models || []).filter(m => (CW_MODELS.includes(m.id) || m.kind === 'api') && m.available);
  if (!avail.length) { toast('Chế độ đồng sáng tác cần mô hình CLI (như agy, gemini) hoặc các mô hình API/Local.'); return; }
  // 优先选 CLI（能看见窗口，体验更好）；没有 CLI 时退到 API/本地
  const prefer = CW_MODELS.find(id => avail.some(m => m.id === id)) || avail[0].id;
  $('#cwModel').innerHTML = avail.map(m => `<option value="${m.id}" ${m.id === prefer ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  $('#cwChapInfo').textContent = 'Chương tiếp theo: Chương ' + cwNextNum();
  // 探索式(freehand)：本书没有任何大纲，剧情由作者一段段给 → 主按钮换成「连写 3–5 章」，文案跟着换
  const free = CUR.planMode === 'freehand';
  $('#cwIntentLabel').textContent = free
    ? '✍️ Tình tiết cho đoạn này (AI sẽ tự phân chia viết chuỗi 3–5 chương; càng chi tiết càng bám sát ý tưởng)'
    : '✍️ Yêu cầu chi tiết cho chương này (Nhân vật, cốt truyện, diễn biến, kết chương - Càng chi tiết viết càng chuẩn)';
  $('#cwBatchBtn').classList.toggle('primary', free);
  cwSyncModelHint();
  $('#cwModel').onchange = cwSyncModelHint;
  $('#cwWriteBtn').classList.toggle('primary', !free);
  $('#cwAsk').value = ''; $('#cwIntent').value = '';
  $('#cwIdeaBox').classList.add('hidden'); $('#cwIdeaBox').textContent = '';
  $('#cwOut').classList.add('hidden'); $('#cwOut').textContent = '';
  $('#cwSaved').textContent = ''; $('#cwErr').textContent = ''; $('#cwIdeaHint').textContent = '';
  $('#cwRedoBtn').disabled = true; $('#cwReadBtn').disabled = true; CW_LAST_REL = '';
  $('#cowriteModal').classList.remove('hidden');
}
$('#btnCowrite').addEventListener('click', openCowrite);
$('#cwClose').addEventListener('click', () => $('#cowriteModal').classList.add('hidden'));
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#cowriteModal').addEventListener('click', (e) => { if (e.target === $('#cowriteModal')) $('#cowriteModal').classList.add('hidden'); });

// 按当前选的模型调整界面：API/本地模型开不了可见窗口 →「连写 3–5 章」Không khả dụng，
// 单章改走Không có头模式（照样落盘，只是看不见窗口）。把这件事在界面上说清楚，别让用户点了才知道。
function cwSyncModelHint() {
  const id = $('#cwModel').value;
  const api = cwIsApiModel(id);
  const bBtn = $('#cwBatchBtn');
  if (bBtn) {
    bBtn.disabled = api;
    bBtn.title = api ? '「Viết chuỗi 3–5 chương」cần mô hình CLI (agy / gemini / claude / codex)' : '';
    bBtn.style.opacity = api ? '.45' : '';
  }
  const tip = $('#cwModelTip');
  if (tip) {
    tip.textContent = api
      ? 'Mô hình Local/API chạy chế độ ngầm: Vẫn viết theo yêu cầu và lưu file, chỉ là không hiển thị cửa sổ terminal.'
      : '';
    tip.classList.toggle('hidden', !api);
  }
}

$('#cwIdeaBtn').addEventListener('click', async () => {
  if (!CUR) return;
  const ask = $('#cwAsk').value.trim();
  if (!ask) { $('#cwIdeaHint').textContent = 'Vui lòng nhập nội dung bạn muốn hỏi AI trước'; return; }
  const btn = $('#cwIdeaBtn'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang suy nghĩ… (~1 phút)';
  $('#cwIdeaHint').textContent = ''; $('#cwErr').textContent = '';
  try {
    const r = await api('/api/book/cowrite-idea', 'POST', { book: CUR.slug, model: $('#cwModel').value, ask });
    const ideas = (r.ideas || '').trim();
    // 直接把主意填进【本章我的要求】这个可编辑框——你在这里删改成本章要求，再点"写这一章"。
    const box = $('#cwIntent');
    const cur = box.value.trim();
    box.value = cur ? (cur + '\n\n—— Gợi ý của AI (Chọn ý bạn thích, xóa phần không cần) ——\n' + ideas) : ideas;
    box.focus();
    // 光标移到末尾，方便接着改
    try { box.selectionStart = box.selectionEnd = box.value.length; box.scrollTop = box.scrollHeight; } catch { }
    // 旧的只读建议框不再用（内容已进可编辑框，不再"藏"起来）
    $('#cwIdeaBox').classList.add('hidden'); $('#cwIdeaBox').textContent = '';
    $('#cwIdeaHint').textContent = '✅ Đã điền vào ô yêu cầu bên dưới — Bạn hãy chỉnh sửa theo ý mình rồi bấm "Yêu cầu AI viết chương này"';
  } catch (e) { $('#cwErr').textContent = 'Gợi ý ý tưởng thất bại: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
});

async function cwDoWrite(redoLast) {
  if (!CUR) return;
  const intent = $('#cwIntent').value.trim();
  if (!intent) { $('#cwErr').textContent = 'Vui lòng nhập yêu cầu cho chương này'; return; }
  const wBtn = $('#cwWriteBtn'), rBtn = $('#cwRedoBtn');
  const oldW = wBtn.textContent; wBtn.disabled = true; rBtn.disabled = true;
  wBtn.textContent = redoLast ? 'Đang viết lại…' : 'Đang sáng tác…';
  $('#cwErr').textContent = '';
  const mid = $('#cwModel').value;
  const isApi = cwIsApiModel(mid);
  const slowModel = /claude|gemini/i.test(mid);
  $('#cwSaved').textContent = (redoLast ? '🔄 Đang viết lại chương này' : '⏳ AI đang sáng tác chương này')
    + (isApi
      ? '—— Mô hình Local/API chạy ngầm, viết xong sẽ tự động lưu file.'
      + (/^api-local$/.test(mid) ? ' (Local 14B ~3–6 phút/chương)' : ' (~1–3 phút)')
      : '—— Cửa sổ terminal sẽ hiển thị trực tiếp tiến trình viết.'
      + (slowModel ? ' (Gemini High Effort cần thời gian suy nghĩ kỹ để văn phong hay hơn)' : ' (~1–5 phút)'))
    + ' Viết xong sẽ hiển thị toàn văn để bạn đọc duyệt.';
  try {
    const r = await api('/api/book/cowrite-chapter', 'POST', {
      book: CUR.slug, model: $('#cwModel').value, intent,
      useLastEnding: $('#cwUseLast').checked, redoLast: !!redoLast,
    });
    // 把写好的正文完整显示出来【供你先阅读】——不催你写下一章。
    $('#cwOut').textContent = r.body || '';
    $('#cwOut').classList.remove('hidden');
    $('#cwOut').scrollTop = 0;   // 从头开始读
    $('#cwSaved').innerHTML = `✅ Chương ${r.num}: 《${esc(r.title)}》 đã viết xong và lưu file (Khoảng ${r.words} chữ). <b>Mời bạn đọc duyệt ở trên↑</b>. Nếu hài lòng, hãy nhập yêu cầu chương tiếp theo bên dưới và bấm "Yêu cầu AI viết chương này"; nếu chưa ưng ý hãy bấm "🔄 Viết lại chương này".`;
    // 清空要求框：避免拿上一章的要求误写下一章（你读完再写新的要求）
    $('#cwIntent').value = '';
    // 记住这一章路径，允许"舒适阅读本章"
    CW_LAST_REL = r.rel || '';
    $('#cwReadBtn').disabled = !CW_LAST_REL;
    // 刷新书的 stats（章号推进），更新“下一章”
    await refresh();
    $('#cwChapInfo').textContent = 'Chương tiếp theo: Chương ' + (r.num + 1) + ' (Đọc duyệt xong mới viết tiếp)';
    rBtn.disabled = false;   // 可对刚写的这章重写
    toast(`Đồng sáng tác: Chương ${r.num} đã viết xong, mời bạn đọc duyệt`);
  } catch (e) { $('#cwErr').textContent = 'Sáng tác thất bại: ' + e.message; rBtn.disabled = false; }
  finally { wBtn.disabled = false; wBtn.textContent = oldW; }
}
// 一段情节 → AI 自拆 3–5 章连写（探索式主写法；粗罗盘书也能用）
async function cwDoBatch() {
  if (!CUR) return;
  const plot = $('#cwIntent').value.trim();
  if (!plot) { $('#cwErr').textContent = 'Vui lòng nhập tình tiết (AI sẽ chia thành 3–5 chương)'; return; }
  const bBtn = $('#cwBatchBtn'), wBtn = $('#cwWriteBtn'), rBtn = $('#cwRedoBtn');
  const oldB = bBtn.textContent;
  bBtn.disabled = true; wBtn.disabled = true; rBtn.disabled = true; bBtn.textContent = 'Đang viết chuỗi…';
  $('#cwErr').textContent = '';
  const slowModel = /claude|gemini/i.test($('#cwModel').value);
  $('#cwSaved').textContent = '⏳ AI đang viết chuỗi 3–5 chương theo tình tiết bạn cung cấp.'
    + (slowModel ? ' (Gemini High Effort suy luận sâu cho chất lượng tối ưu)' : ' (~5–25 phút)')
    + ' Viết xong sẽ hiển thị đầy đủ các chương.';
  try {
    const r = await api('/api/book/cowrite-batch', 'POST', {
      book: CUR.slug, model: $('#cwModel').value, plot, useLastEnding: $('#cwUseLast').checked,
    });
    const chs = r.chapters || [];
    $('#cwOut').textContent = chs.map(c => `——— Chương ${c.num}: 《${c.title}》（Khoảng ${c.words} chữ）———\n\n${c.body}`).join('\n\n\n');
    $('#cwOut').classList.remove('hidden'); $('#cwOut').scrollTop = 0;
    $('#cwSaved').innerHTML = `✅ Đã hoàn thành <b>${chs.length}</b> chương (Chương ${r.startNum}–${r.endNum}) và lưu file. <b>Mời bạn đọc duyệt ở trên↑</b>. Sau khi hài lòng, hãy nhập đoạn tiếp theo bên dưới và bấm "Viết chuỗi 3–5 chương".`;
    $('#cwIntent').value = '';
    CW_LAST_REL = chs.length ? chs[chs.length - 1].rel : '';
    $('#cwReadBtn').disabled = !CW_LAST_REL;
    await refresh();
    $('#cwChapInfo').textContent = 'Chương tiếp theo: Chương ' + ((r.endNum || 0) + 1) + ' (Đọc duyệt xong mới đưa tiếp đoạn sau)';
    toast(`Đã hoàn thành ${chs.length} chương theo tình tiết, mời bạn đọc duyệt`);
  } catch (e) { $('#cwErr').textContent = 'Viết chuỗi thất bại: ' + e.message; }
  finally { bBtn.disabled = false; wBtn.disabled = false; bBtn.textContent = oldB; }
}
$('#cwBatchBtn') && $('#cwBatchBtn').addEventListener('click', cwDoBatch);
$('#cwWriteBtn').addEventListener('click', () => cwDoWrite(false));
$('#cwRedoBtn').addEventListener('click', () => cwDoWrite(true));
let CW_LAST_REL = '';   // 刚写好的这一章路径，供"舒适阅读本章"跳转
$('#cwReadBtn').addEventListener('click', () => {
  if (!CUR || !CW_LAST_REL) return;
  $('#cowriteModal').classList.add('hidden');   // 关弹窗，进舒适阅读器并跳到这一章
  openReaderAt(CUR, CW_LAST_REL);
});

$('#rvRangeType').addEventListener('change', rvSync);
$('#rvClose').addEventListener('click', () => $('#reviewModal').classList.add('hidden'));
$('#rvCancel').addEventListener('click', () => $('#reviewModal').classList.add('hidden'));
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#reviewModal').addEventListener('click', (e) => { if (e.target === $('#reviewModal')) $('#reviewModal').classList.add('hidden'); });
$('#rvStart').addEventListener('click', async () => {
  if (!CUR) return;
  const dims = [];
  if ($('#rvLogic').checked) dims.push('logic');
  if ($('#rvStyle').checked) dims.push('style');
  if ($('#rvPlaus').checked) dims.push('plausibility');
  if ($('#rvPace')?.checked) dims.push('pace');
  if (!dims.length) { $('#rvErr').textContent = 'Vui lòng chọn ít nhất một tiêu chí rà soát'; return; }
  const range = rvRange();
  const model = (STATE.books.find(b => b.slug === CUR.slug) || CUR).model || STATE.config.defaultModel;
  $('#rvStart').disabled = true; $('#rvErr').textContent = 'Khởi động rà soát…';
  try {
    const r = await api('/api/book/review', 'POST', { book: CUR.slug, range, dims, model });
    $('#reviewModal').classList.add('hidden'); $('#rvStart').disabled = false;
    setWriting(true); openStream(CUR.slug);
    toast(r.mode === 'inserted' ? 'Đã gửi lệnh rà soát: ' + range : 'Bắt đầu rà soát: ' + range);
  } catch (e) { $('#rvErr').textContent = 'Thất bại: ' + e.message; $('#rvStart').disabled = false; }
});

// ---------- 简介 ----------
// 简介框长在【写作台】里，但番茄建书是在【发布弹窗】里读它 —— 只要 CUR 换了书而框没跟着换，
// 就会拿上一本的简介去建这一本的书（书名对、简介是别人的）。所以给框绑一个 slug：
// 填的时候记下这段简介属于谁，读/存的时候一律以它为准，不信任 CUR。
function setSynopsisBox(book) {
  const el = $('#synText'); if (!el) return;
  el.value = book?.synopsis || '';
  el.dataset.slug = book?.slug || '';
}
// 取"确实属于 slug 这本书"的简介：框里的 slug 对得上就用框里的（含用户刚手改的），否则用书自己的存档。
function synopsisFor(slug) {
  const el = $('#synText');
  if (el && el.dataset.slug === slug) return (el.value || '').trim();
  const b = STATE.books.find(x => x.slug === slug);
  return ((b && b.synopsis) || '').trim();
}
$('#btnGenSyn').addEventListener('click', async () => {
  if (!CUR) return;
  const btn = $('#btnGenSyn'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang tạo…';
  try {
    const slug = CUR.slug;
    const r = await api('/api/book/synopsis', 'POST', { book: slug });
    const b = STATE.books.find(x => x.slug === slug); if (b) b.synopsis = r.synopsis;
    if (CUR.slug === slug) { CUR.synopsis = r.synopsis; setSynopsisBox({ slug, synopsis: r.synopsis }); }   // 生成期间用户换了书就别覆盖框
    toast(`Giới thiệu truyện đã tạo xong (${r.synopsis.length} chữ · ${modelName(r.model)})`);
  } catch (e) { toast('Tạo thất bại: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = old; }
});
$('#btnCopySyn').addEventListener('click', async () => {
  const t = $('#synText').value.trim(); if (!t) { toast('Phần giới thiệu đang trống'); return; }
  try { await navigator.clipboard.writeText(t); toast('Đã sao chép phần giới thiệu'); }
  catch { $('#synText').select(); document.execCommand && document.execCommand('copy'); toast('Đã sao chép phần giới thiệu'); }
});
// 手改后失焦自动保存
$('#synText').addEventListener('blur', async () => {
  // 存回【框上记的那本书】，不是 CUR —— 否则 CUR 被发布弹窗切走后，一次失焦就把上一本的简介写进新书里。
  const slug = $('#synText').dataset.slug || '';
  if (!slug) return;
  const b = STATE.books.find(x => x.slug === slug);
  const t = $('#synText').value.trim();
  if (t === ((b && b.synopsis) || '')) return;
  try {
    await api('/api/book/synopsis', 'POST', { book: slug, text: t });
    if (b) b.synopsis = t;
    if (CUR && CUR.slug === slug) CUR.synopsis = t;
  } catch (e) { toast('Lưu giới thiệu truyện thất bại: ' + e.message); }
});

// ---------- 打开书目录 ----------
$('#btnOpenDir').addEventListener('click', async () => {
  if (!CUR) return;
  try { const r = await api('/api/book/open-dir', 'POST', { book: CUR.slug }); toast('Đã mở thư mục: ' + r.dir); }
  catch (e) { toast('Mở thư mục thất bại: ' + e.message); }
});

// ---------- 重写 ----------
$('#btnRewrite').addEventListener('click', () => {
  if (!CUR) return;
  $('#rwErr').textContent = ''; $('#rwMode').value = 'range'; $('#rwRange').value = ''; $('#rwNote').value = '';
  $('#rwRangeWrap').classList.remove('hidden');
  $('#rewriteModal').classList.remove('hidden');
});
$('#rwMode').addEventListener('change', () => { $('#rwRangeWrap').classList.toggle('hidden', $('#rwMode').value !== 'range'); });
$('#rwClose').addEventListener('click', () => $('#rewriteModal').classList.add('hidden'));
$('#rwCancel').addEventListener('click', () => $('#rewriteModal').classList.add('hidden'));
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#rewriteModal').addEventListener('click', (e) => { if (e.target === $('#rewriteModal')) $('#rewriteModal').classList.add('hidden'); });
$('#rwGo').addEventListener('click', async () => {
  if (!CUR) return;
  const mode = $('#rwMode').value;
  const range = $('#rwRange').value.trim();
  const note = $('#rwNote').value.trim();
  if (mode === 'range' && !range) { $('#rwErr').textContent = 'Vui lòng điền phạm vi viết lại (Ví dụ: 001-008 hoặc Quyển 1)'; return; }
  if (mode === 'reproject' && !confirm('Khởi tạo lại toàn bộ sẽ viết lại Story Bible + dàn ý + toàn bộ các chương (Nội dung cũ đã được sao lưu). Bạn có chắc chắn không?')) return;
  $('#rwGo').disabled = true; $('#rwErr').textContent = 'Đang chuẩn bị…';
  try {
    const url = mode === 'reproject' ? '/api/book/reproject' : '/api/book/rewrite';
    const r = await api(url, 'POST', { book: CUR.slug, range, note });
    $('#rewriteModal').classList.add('hidden');
    if (r.mode === 'started') { setWriting(true); openStream(CUR.slug); }
    toast((r.mode === 'inserted' ? 'Đã gửi lệnh viết lại' : 'Đã mở tiến trình viết lại') + (r.snapshot ? ' (Bản lưu ' + r.snapshot + ')' : ''));
  } catch (e) { $('#rwErr').textContent = e.message; }
  finally { $('#rwGo').disabled = false; }
});

// ---------- 改书名 ----------
$('#btnRename').addEventListener('click', () => {
  if (!CUR) return;
  $('#rnErr').textContent = ''; $('#rnInput').value = CUR.title || '';
  $('#renameModal').classList.remove('hidden'); $('#rnInput').focus();
});
$('#rnClose').addEventListener('click', () => $('#renameModal').classList.add('hidden'));
$('#rnCancel').addEventListener('click', () => $('#renameModal').classList.add('hidden'));
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#renameModal').addEventListener('click', (e) => { if (e.target === $('#renameModal')) $('#renameModal').classList.add('hidden'); });
$('#rnInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#rnSave').click(); });
$('#rnSave').addEventListener('click', async () => {
  if (!CUR) return;
  const t = $('#rnInput').value.trim();
  if (!t) { $('#rnErr').textContent = 'Vui lòng nhập tên truyện mới'; return; }
  if (t === CUR.title) { $('#renameModal').classList.add('hidden'); return; }
  $('#rnSave').disabled = true; $('#rnErr').textContent = 'Đang đổi tên…';
  try {
    const r = await api('/api/book/rename', 'POST', { book: CUR.slug, title: t });
    CUR.title = r.title; const b = STATE.books.find(x => x.slug === CUR.slug); if (b) b.title = r.title;
    $('#writeTitle').textContent = '《' + r.title + '》';
    $('#renameModal').classList.add('hidden');
    toast(`Đã đổi tên thành 《${r.title}》（Cập nhật ${r.touched} file, áp dụng toàn bộ tác phẩm)`);
    refresh();
  } catch (e) { $('#rnErr').textContent = e.message; }
  finally { $('#rnSave').disabled = false; }
});

// ---------- 发布番茄 ----------
let PB_PROFILES = [];   // 缓存 Unzoo 账号列表(含权威 profile_path)
// 时间下拉：每半小时一档（00:00…23:30），值即番茄需要的 HH:MM
(function buildTimeOptions() {
  const sel = $('#pbTime'); if (!sel) return;
  let html = '<option value="">(Mặc định nền tảng)</option>';
  for (let h = 0; h < 24; h++) for (const mm of ['00', '30']) {
    const v = String(h).padStart(2, '0') + ':' + mm;
    html += `<option value="${v}">${v}</option>`;
  }
  sel.innerHTML = html;
})();
function pbTodayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// 日期下拉：立即发 + 今天起未来 30 天（带 周X），值=YYYY-MM-DD。WebView2 原生 type=date 常不弹日历，用下拉最稳。
(function buildDateOptions() {
  const sel = $('#pbDate'); if (!sel) return;
  const wk = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  let html = '<option value="">Đăng ngay (Không hẹn giờ)</option>';
  const base = new Date();
  for (let i = 0; i < 31; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const v = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const rel = i === 0 ? 'Hôm nay ' : i === 1 ? 'Ngày mai ' : i === 2 ? 'Ngày kia ' : '';
    html += `<option value="${v}">${rel}Ngày ${d.getDate()}/${d.getMonth() + 1} (${wk[d.getDay()]})</option>`;
  }
  sel.innerHTML = html;
})();
function pbFill(book) {
  const pc = book.publish || {};
  $('#pbBookId').value = pc.bookId || '';
  $('#pbPerDay').value = pc.chaptersPerDay || 'max';
  $('#pbInterval').value = pc.intervalSeconds || 3;
  $('#pbDate').value = pc.scheduledStartDate || '';
  $('#pbTime').value = pc.scheduledTime || '';
  $('#pbMatchVol').checked = !!pc.matchVolumes;
  $('#pbSyncRw').checked = !!pc.syncRewrites;
  $('#pbRwLimit').value = Number.isFinite(Number(pc.rewriteSyncLimit)) ? Number(pc.rewriteSyncLimit) : 3;
  $('#pbAuto').checked = !!pc.autoPublish;
  $('#pbUseAI').checked = !!pc.useAI;
}
function pbRenderProfiles(saved) {
  const sel = $('#pbProfile');
  if (!PB_PROFILES.length) { sel.innerHTML = '<option value="">(Chưa phát hiện tài khoản Unzoo, vui lòng đăng nhập trên trình duyệt)</option>'; return; }
  sel.innerHTML = PB_PROFILES.map(p => {
    const tag = p.fanqie.length ? `✓ Đã kết nối nền tảng${p.fanqie[0].bookId ? ' #' + p.fanqie[0].bookId : ''}`
      : (p.running ? '○ Đang chạy · Chưa mở trang web' : '· Chưa mở');
    const selAttr = p.path === saved ? ' selected' : '';
    const label = p.dir && p.dir !== p.name ? `${p.name} · ${p.dir}` : p.name;
    return `<option value="${esc(p.path)}"${selAttr}>${esc(label)}（${tag}）</option>`;
  }).join('');
}
// 打开发布弹窗（btnPublish 和书卡「发布中」徽标共用）。传入的 book 会设为 CUR。
async function openPublish(book) {
  book = book || CUR; if (!book) return;
  CUR = book;
  $('#pbErr').textContent = ''; $('#pbPreviewOut').style.display = 'none';
  $('#pbGo').disabled = true; $('#pbGo').textContent = '🔍 Vui lòng bấm Xem trước';   // 发布前必须先预览
  const b = STATE.books.find(x => x.slug === book.slug) || book;
  pbFill(b);
  // 番茄建书要用的两处【每本书各不相同】的内容，必须跟着当前这本换掉，不能留上一本的：
  //   ①简介框在写作台里，从书架直接进发布时它还是上一本的 → 这里补刷；
  //   ②主角/配角框是"空框才填"，上一本的名字会粘着不换 → 先清空再按这本的圣经填。
  setSynopsisBox(b);
  if ($('#cbHero')) $('#cbHero').value = '';
  if ($('#cbHero2')) $('#cbHero2').value = '';
  pbSyncStopBtn();   // 若这本正在发布，展示「停止发布」并接回进度
  $('#publishModal').classList.remove('hidden');
  // 从设定圣经自动带入主角名/配角名到「创建新书」的主角框（空框才填，不覆盖手改）
  (async () => {
    try {
      const forSlug = book.slug;   // 读圣经期间用户可能又换了书 → 回来时对不上就丢弃，别把别人的名字填进来
      const bf = await api('/api/book/read?book=' + encodeURIComponent(book.slug) + '&rel=' + encodeURIComponent('novel_bible.md'));
      if (!CUR || CUR.slug !== forSlug) return;
      const bible = bf.content || '';
      const cn = s => ((String(s || '').match(/[一-鿿]{2,6}/) || [])[0] || '');
      const heroM = bible.match(/##\s*主角[\s\S]{0,60}?\*\*\s*([一-鿿]{2,6})/) || bible.match(/##\s*主角[\s\S]{0,140}?姓名[：:]\s*([^。\n；;（(·]+)/) || bible.match(/(?:^|\n)[-\s]*主角[：:]\s*([^。\n，,；;（(]+)/);
      const roleM = bible.match(/长线人物[\s\S]{0,300}?[-*•]\s*\*\*\s*([一-鿿]{2,6})/) || bible.match(/##\s*关键(?:人物|配角)[\s\S]{0,400}?[|\-*•]\s*\*\*\s*([一-鿿]{2,6})/);
      const hero = cn(heroM && heroM[1]); const hero2 = cn(roleM && roleM[1]);
      if (hero && $('#cbHero') && !$('#cbHero').value.trim()) $('#cbHero').value = hero.slice(0, 5);
      if (hero2 && $('#cbHero2') && !$('#cbHero2').value.trim()) $('#cbHero2').value = hero2.slice(0, 5);
    } catch { }
  })();
  $('#pbProfile').innerHTML = '<option value="">(Đang tải tài khoản...)</option>';
  $('#pbBook').innerHTML = '<option value="">(Chọn tài khoản để tải danh sách...)</option>';
  try {
    const r = await api('/api/unzoo/profiles', 'POST', {});
    PB_PROFILES = r.profiles || [];
    pbRenderProfiles((b.publish || {}).profilePath || '');
    // 选好账号后，自动读取该账号的番茄书籍并匹配当前书
    if ($('#pbProfile').value) pbLoadBooks($('#pbProfile').value);
  } catch (e) { $('#pbErr').textContent = 'Lấy danh sách tài khoản thất bại: ' + e.message; PB_PROFILES = []; pbRenderProfiles(''); }

  // 打开弹窗就自动预览一次：发布按钮默认是灰的、必须先预览才亮，这个前置步骤很反直觉——
  // 作者实测就卡在这儿（「点了发布没反应」其实是按钮 disabled）。账号与书籍都配好了才自动跑，
  // 没配好就维持原样等用户手动点，避免Không có谓地驱动浏览器。
  try {
    const pc = (getBookBySlug(book.slug) || book).publish || {};
    if (pc.profilePath && pc.bookId && $('#pbPreview') && !$('#pbPreview').disabled) {
      $('#pbPreview').click();
    }
  } catch { }
}

// 取书架里最新的那份 book 记录（publish 配置可能刚被保存过）
function getBookBySlug(slug) { return (STATE.books || []).find(b => b.slug === slug) || null; }
$('#btnPublish').addEventListener('click', () => openPublish(CUR));
$('#pbProfile').addEventListener('change', () => pbLoadBooks($('#pbProfile').value));
$('#pbBook').addEventListener('change', () => { $('#pbBookId').value = $('#pbBook').value; });
// 🔄 强制重读番茄书籍（读取失败时用户能自助重试）
$('#pbBookReload').addEventListener('click', () => pbLoadBooks($('#pbProfile').value, true));

// 从所选番茄账号读取其全部书籍，填充下拉，并按 当前书名/已存bookId 自动选中
let PB_BOOKS = [];
const PB_BOOKS_CACHE = {};   // profilePath -> books[]（避免重开弹窗/切下拉时反复读番茄）
async function pbLoadBooks(profilePath, force) {
  const sel = $('#pbBook');
  const reload = $('#pbBookReload');
  if (!profilePath) { sel.innerHTML = '<option value="">(Vui lòng chọn tài khoản trước)</option>'; $('#pbBookId').value = ''; if (reload) reload.disabled = false; return; }
  if (!force && PB_BOOKS_CACHE[profilePath]) { PB_BOOKS = PB_BOOKS_CACHE[profilePath]; pbRenderBooks(); return; }
  sel.innerHTML = '<option value="">(Đang đọc danh sách tác phẩm...)</option>';
  if (reload) { reload.disabled = true; reload.textContent = '⏳'; }
  try {
    // 客户端超时兜底：番茄读取偶尔卡住，60s 后主动失败，别让下拉停在"读取中…"
    const r = await pbRace(api('/api/fanqie/books', 'POST', { profilePath, book: CUR.slug }), 60000, 'Quá thời gian tải danh sách tác phẩm');
    PB_BOOKS = r.books || [];
    if (r.ok && PB_BOOKS.length) PB_BOOKS_CACHE[profilePath] = PB_BOOKS;
    if (!r.ok || !PB_BOOKS.length) {
      sel.innerHTML = `<option value="">(${r.error || 'Tài khoản này chưa có tác phẩm nào'}, bấm 🔄 bên phải để thử lại)</option>`;
      $('#pbBookId').value = '';
      if (r.error) $('#pbErr').textContent = 'Đọc tác phẩm: ' + r.error;
      return;
    }
    pbRenderBooks();
  } catch (e) {
    sel.innerHTML = '<option value="">(Đọc thất bại, bấm 🔄 bên phải để thử lại)</option>';
    $('#pbErr').textContent = 'Đọc danh sách tác phẩm thất bại: ' + e.message;
  } finally {
    // Không có论成败，重读按钮永远可点，让用户能自助重试
    if (reload) { reload.disabled = false; reload.textContent = '🔄'; }
  }
}
// 客户端超时兜底：给可能卡住的网络调用套 60s 上限，避免按钮/下拉永久停在"读取中…"
function pbRace(promise, ms, msg) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg || 'Yêu cầu quá thời gian chờ')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
// 渲染番茄书籍下拉并自动选中（优先已存 bookId，其次书名精确/包含匹配）
function pbRenderBooks() {
  const sel = $('#pbBook');
  const saved = (CUR.publish || {}).bookId || '';
  const norm = s => String(s || '').replace(/[\s：:，,。.、！!？?]/g, '');
  const myTitle = norm(CUR.title);
  // 只在【已存 bookId】或【书名完全一致】时自动关联；不再做"包含/沾边"松匹配（会张冠李戴关联错书）。
  const pick = PB_BOOKS.find(b => b.id === saved)
    || PB_BOOKS.find(b => norm(b.title) === myTitle);
  const opts = PB_BOOKS.map(b => `<option value="${esc(b.id)}"${pick && b.id === pick.id ? ' selected' : ''}>${esc(b.title || '(Chưa đặt tên)')} · #${esc(b.id)}</option>`).join('');
  // 没匹配到同名书 → 顶部放一个已选中的"未匹配"占位，谁都不自动关联，引导去下面「创建新书」
  sel.innerHTML = (pick ? '' : `<option value="" selected>— Chưa tìm thấy tác phẩm cùng tên 《${esc(CUR.title)}》, vui lòng chọn thủ công hoặc bấm Tạo mới —</option>`) + opts;
  $('#pbBookId').value = pick ? pick.id : '';
  if (pick) $('#pbErr').textContent = '';
  else $('#pbErr').textContent = '⚠️ Chưa tìm thấy tác phẩm cùng tên 《' + CUR.title + '》. Vui lòng chọn đúng tác phẩm tương ứng.';
}
function pbCfg() {
  return {
    profilePath: $('#pbProfile').value,
    bookId: $('#pbBookId').value.trim(),
    bookName: CUR.title,
    chaptersPerDay: $('#pbPerDay').value.trim() || 'max',
    intervalSeconds: Number($('#pbInterval').value) || 3,
    scheduledStartDate: $('#pbDate').value.trim(),
    scheduledTime: $('#pbTime').value.trim(),
    matchVolumes: $('#pbMatchVol').checked,
    syncRewrites: $('#pbSyncRw').checked,
    rewriteSyncLimit: Math.max(0, Number($('#pbRwLimit').value) || 3),
    autoPublish: $('#pbAuto').checked,
    useAI: $('#pbUseAI').checked,
  };
}
async function pbSave() {
  const cfg = pbCfg();
  if (!cfg.profilePath) { $('#pbErr').textContent = 'Vui lòng chọn tài khoản Unzoo'; return false; }
  if (!cfg.bookId) { $('#pbErr').textContent = 'Vui lòng chọn tác phẩm từ danh sách bên trên'; return false; }
  await api('/api/book/publish-config', 'POST', { book: CUR.slug, publish: cfg });
  const b = STATE.books.find(x => x.slug === CUR.slug); if (b) b.publish = { ...(b.publish || {}), ...cfg };
  CUR.publish = { ...(CUR.publish || {}), ...cfg };
  return true;
}
$('#pbSaveCfg').addEventListener('click', async () => {
  $('#pbErr').textContent = '';
  try { if (await pbSave()) toast('Cấu hình xuất bản đã được lưu'); } catch (e) { $('#pbErr').textContent = e.message; }
});
// —— 在番茄创建新作品（全自动：填表→立即创建→回填 bookId）——
let cbPoll = null;
$('#cbCreate')?.addEventListener('click', async () => {
  if (!CUR) return;
  const hint = $('#cbHint'); hint.style.color = '';
  const profilePath = $('#pbProfile').value;
  const synopsis = synopsisFor(CUR.slug);   // 只认属于这本书的简介，绝不拿框里可能残留的上一本
  const channel = $('#cbChannel').value;
  const mainCategory = $('#cbCategory').value;
  const hero = $('#cbHero').value.trim();
  const hero2 = $('#cbHero2').value.trim();
  if (!profilePath) { hint.textContent = '⚠️ Vui lòng chọn tài khoản Unzoo bên trên'; hint.style.color = '#e57'; return; }
  if (synopsis.length < 50) { hint.textContent = `⚠️ Giới thiệu truyện chỉ có ${synopsis.length} chữ. Yêu cầu 50–500 chữ. Vui lòng viết phần giới thiệu trước.`; hint.style.color = '#e57'; return; }
  if (!confirm(`Chuẩn bị khởi tạo tác phẩm mới trên nền tảng:\n《${CUR.title}》· ${channel} · ${mainCategory}\nGiới thiệu: ${synopsis.length} chữ${hero ? ' · Nhân vật chính: ' + hero : ''}\n\nThao tác này không thể hoàn tác, bạn có chắc chắn?`)) return;
  const btn = $('#cbCreate'); btn.disabled = true; const old = btn.textContent; btn.textContent = '📕 Đang tạo tác phẩm…';
  hint.style.color = ''; hint.textContent = '⏳ Đang tạo tác phẩm trên nền tảng… (~30 giây, vui lòng giữ nguyên trình duyệt)';
  try {
    await api('/api/fanqie/create-book', 'POST', { book: CUR.slug, profilePath, title: CUR.title, synopsis, channel, mainCategory, hero, hero2, autoSubmit: true });
    if (cbPoll) clearInterval(cbPoll);
    cbPoll = setInterval(async () => {
      try {
        const s = await api('/api/fanqie/create-book-status', 'POST', { book: CUR.slug });
        if (s.msg) hint.textContent = '⏳ ' + s.msg;
        if (s.status === 'done') {
          clearInterval(cbPoll); cbPoll = null; btn.disabled = false; btn.textContent = old;
          if (s.bookId) {
            $('#pbBookId').value = s.bookId;
            $('#pbProfile').value = profilePath;
            hint.style.color = '#3a7'; hint.innerHTML = `✅ Tạo thành công, ID=<b>${esc(s.bookId)}</b>, đã cập nhật cấu hình. Bạn có thể bấm Xem trước.`;
            toast('✅ Đã tạo tác phẩm 《' + CUR.title + '》#' + s.bookId);
            try { await pbLoadBooks(profilePath, true); $('#pbBook').value = s.bookId; $('#pbBookId').value = s.bookId; } catch { }
          } else if (s.semiManual) {
            hint.style.color = '#c90'; hint.innerHTML = '⚠️ ' + esc(s.msg || '').replace(/\n/g, '<br>');
            toast('Đã điền thông tin tác phẩm, vui lòng sang trình duyệt xác nhận tạo sách');
          }
        } else if (s.status === 'error') {
          clearInterval(cbPoll); cbPoll = null; btn.disabled = false; btn.textContent = old;
          hint.style.color = '#e57'; hint.textContent = '❌ Tạo tác phẩm thất bại: ' + (s.error || 'Không rõ');
        }
      } catch { }
    }, 3500);
  } catch (e) { hint.style.color = '#e57'; hint.textContent = '❌ ' + e.message; btn.disabled = false; btn.textContent = old; }
});
// —— 番茄卷管理：读取现有卷 + 逐卷改名（番茄序号"第N卷："自动加，只改副标题）——
function pbRenderVols(r) {
  const box = $('#pbVolList');
  if (!r || !r.ok) { box.innerHTML = `<div class="modal-err">Đọc danh sách quyển thất bại: ${esc((r && r.error) || 'Không rõ')}</div>`; return; }
  const vols = r.volumes || [];
  if (!vols.length) { box.innerHTML = '<p class="modal-hint">Tác phẩm này chưa phân quyển (hoặc là truyện đơn quyển).</p>'; return; }
  box.innerHTML = vols.map(name => {
    const sub = name.includes('：') ? name.split('：').slice(1).join('：') : '';
    const num = cnVolNum(name);
    return `<div class="pb-vol-row" data-old="${esc(name)}" data-num="${num || ''}">
      <span class="pb-vol-cur" title="${esc(name)}">${esc(name)}</span>
      <input class="pb-vol-input" maxlength="16" value="${esc(sub)}" placeholder="Tiêu đề phụ mới (≤16 từ)">
      <button class="btn pb-vol-gen" title="AI tự đặt tên quyển dựa theo nội dung${num ? '' : ' (Không đọc được số quyển)'}"${num ? '' : ' disabled'}>✨ Tạo tự động</button>
      <button class="btn pb-vol-rename">Đổi tên</button>
    </div>`;
  }).join('');
}
$('#pbVolLoad').addEventListener('click', async () => {
  const btn = $('#pbVolLoad'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang tải…';
  $('#pbErr').textContent = ''; $('#pbVolList').innerHTML = '';
  try {
    if (!await pbSave()) return;
    const r = await api('/api/fanqie/volumes', 'POST', { book: CUR.slug });
    pbRenderVols(r);
  } catch (e) { $('#pbErr').textContent = 'Đọc danh sách quyển thất bại: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
});
// 番茄卷名"第十三卷：xxx"/"第1卷" → 卷号（中文/阿拉伯）
function cnVolNum(name) {
  const m = String(name).match(/第\s*([0-9]+|[一二三四五六七八九十两]+)\s*卷/);
  if (!m) return 0;
  const s = m[1];
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  const d = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s.includes('十')) { const [a, b] = s.split('十'); return (a === '' ? 1 : d[a] || 0) * 10 + (b === '' ? 0 : d[b] || 0); }
  return d[s] || 0;
}
$('#pbVolList').addEventListener('click', async (ev) => {
  // ✨ Tạo tự động：AI 为该卷起卷名（写回 bible）并填进输入框，让用户核对后再点「改名」推番茄
  const genBtn = ev.target.closest('.pb-vol-gen');
  if (genBtn) {
    const row = genBtn.closest('.pb-vol-row'); const num = parseInt(row.getAttribute('data-num'), 10);
    if (!num) { $('#pbErr').textContent = 'Không xác định được số quyển, không thể tạo tên'; return; }
    genBtn.disabled = true; const og = genBtn.textContent; genBtn.textContent = 'Đang tạo…'; $('#pbErr').textContent = '';
    try {
      const r = await api('/api/book/gen-vol-name', 'POST', { book: CUR.slug, num, force: true });
      if (r.ok && r.name) { row.querySelector('.pb-vol-input').value = r.name; toast(`Quyển ${num}: ${r.name} (Đã ghi vào Story Bible, bấm Đổi tên để áp dụng)`); }
      else $('#pbErr').textContent = 'Tạo tên quyển thất bại: ' + (r.error || 'Không rõ');
    } catch (e) { $('#pbErr').textContent = 'Tạo tên quyển thất bại: ' + e.message; }
    finally { genBtn.disabled = false; genBtn.textContent = og; }
    return;
  }
  const btn = ev.target.closest('.pb-vol-rename'); if (!btn) return;
  const row = btn.closest('.pb-vol-row'); const oldName = row.getAttribute('data-old');
  const sub = row.querySelector('.pb-vol-input').value.trim();
  if (!sub) { $('#pbErr').textContent = 'Tiêu đề phụ mới không được để trống'; return; }
  const prefix = oldName.includes('：') ? oldName.split('：')[0] : oldName;
  if (!confirm(`Đổi tên 「${oldName}」 thành 「${prefix}: ${sub}」?\nThao tác trực tiếp trên nền tảng (Có thể đổi lại tên nhưng không xóa được quyển).`)) return;
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Đang đổi tên…'; $('#pbErr').textContent = '';
  try {
    const r = await api('/api/fanqie/rename-volume', 'POST', { book: CUR.slug, oldName, newName: sub });
    if (r.ok) {
      toast('Đã đổi tên quyển → ' + prefix + ': ' + sub);
      const nn = prefix + '：' + sub;
      row.querySelector('.pb-vol-cur').textContent = nn; row.querySelector('.pb-vol-cur').title = nn;
      row.setAttribute('data-old', nn);
    } else { $('#pbErr').textContent = 'Đổi tên thất bại: ' + (r.error || 'Không rõ'); }
  } catch (e) { $('#pbErr').textContent = 'Đổi tên thất bại: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
});
$('#pbPreview').addEventListener('click', async () => {
  $('#pbErr').textContent = ''; $('#pbGo').disabled = true; $('#pbGo').textContent = '🔍 Vui lòng bấm Xem trước';
  const btn = $('#pbPreview'); const old = btn.textContent; btn.disabled = true;
  // 读番茄要 30–60s（多卷书更久）。原来只显示一个静止的「读取番茄中…」，用户以为卡死了就去点别的。
  // 这里跑秒 + 提示预期耗时，让等待可见。
  let t0 = Date.now(), tick = null;
  const paint = () => { btn.textContent = `Đang đọc dữ liệu… ${Math.round((Date.now() - t0) / 1000)}s (~30–60 giây)`; };
  paint(); tick = setInterval(paint, 1000);
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } };
  try {
    if (!await pbSave()) return;
    // 预览要驱动浏览器读番茄（多卷书还要逐卷扫最大章号），常需 60s+；给足 150s，别让"读得慢"被当超时、
    // 导致预览其实成功了、发布按钮却没亮（用户看到"预览之后没有发布按钮"）。
    const r = await pbRace(api('/api/book/publish-preview', 'POST', { book: CUR.slug }), 150000, 'Quá thời gian tải dữ liệu, vui lòng kiểm tra kết nối mạng/proxy');
    PB_PREVIEW = { slug: CUR.slug, data: r };   // 供 pbPublish 判断是否要弹「覆盖已发布章」二次确认
    const out = $('#pbPreviewOut'); out.style.display = '';
    if (r.blocked) {
      out.textContent = `⛔ Không thể xác định chương hiện tại, đã dừng đăng:\n${r.reason}\n\nVui lòng kiểm tra lại trình duyệt và tài khoản nền tảng.`;
      $('#pbGo').disabled = true; $('#pbGo').textContent = '📤 Đăng Toàn Bộ Chương Mới ▶';
      return;
    }
    let rw = '';
    if (r.rewrittenCount > 0) {
      const rwNums = r.rewrittenNums || [];
      rw = `\n⟳ Phát hiện ${r.rewrittenCount} chương đã viết lại (Chương ${rwNums.slice(0, 8).join(', ')}${rwNums.length > 8 ? '…' : ''})` +
        (r.syncRewrites ? ', khi đăng sẽ cập nhật đè lên chương cũ.' : ', chưa bật đồng bộ chương viết lại, đợt này giữ nguyên.');
      if (r.syncRewrites && r.rewrittenCount > pbRwLimitOf(r)) {
        rw += `\n⚠️ Vượt quá ngưỡng xác nhận đè chương (${pbRwLimitOf(r)} chương): Khi đăng sẽ hiển thị xác nhận trước khi cập nhật.`;
      }
    }
    // 多卷映射预览
    let vol = '';
    if (r.matchVolumes && r.volumes) {
      const V = r.volumes;
      if (V.error) vol = `\n⚠️ Đăng theo quyển: Đọc danh sách quyển thất bại (${V.error})`;
      else if (V.single) vol = `\n📚 Đăng theo quyển: Truyện đơn quyển, sẽ đăng nối tiếp trực tiếp`;
      else {
        vol = `\n📚 Đăng theo quyển: ${Object.entries(V.map || {}).map(([k, v]) => `${k}→${v}`).join(', ') || '(Đợt này không có ánh xạ quyển)'}`;
        if (V.willCreate && V.willCreate.length) vol += `\n🆕 Sẽ tự động tạo thêm quyển: ${V.willCreate.join(', ')}`;
      }
    }
    // 排期起始日（自动接续番茄已排期）
    let sched = '';
    if (r.scheduled) sched = `\n📅 Bắt đầu hẹn giờ: ${r.scheduleStart} (${r.scheduleReason})`;
    else if (r.fanqieLatestDate) sched = `\n📅 Đăng ngay (Chương mới nhất trên nền tảng: ${r.fanqieLatestDate}, không hẹn giờ)`;
    // 按卷发布仅在【读取卷失败】时禁止发布；缺卷会自动新建，不再禁用
    const volBlocked = r.matchVolumes && r.volumes && r.volumes.error;
    if (r.newCount > 0) {
      out.textContent = `Nền tảng đã đăng đến chương ${r.fanqieMax}${r.approx ? '(xấp xỉ)' : ''}, trên máy đã viết đến chương ${r.localMax}.\nSẽ đăng ${r.newCount} chương mới: Chương ${r.from}–${r.to}\n` + (r.titles || []).map(t => '  · ' + t).join('\n') + (r.newCount > 5 ? '\n  …' : '') + rw + vol + sched;
      $('#pbGo').disabled = !!volBlocked; $('#pbGo').textContent = volBlocked ? '⛔ Đọc danh sách quyển thất bại, hãy xem trước lại' : `📤 Đăng Toàn Bộ ${r.newCount} Chương Mới ▶`;
    } else {
      out.textContent = `Nền tảng đã đăng đến chương ${r.fanqieMax}${r.approx ? '(xấp xỉ)' : ''}, trên máy đã có chương ${r.localMax} —— Không có chương mới nào cần đăng.` + rw + vol + sched;
      // 仅有重写章且已开同步：也允许发布
      const canEditOnly = r.rewrittenCount > 0 && r.syncRewrites;
      $('#pbGo').disabled = !canEditOnly;
      $('#pbGo').textContent = canEditOnly ? `📤 Đồng Bộ ${r.rewrittenCount} Chương Đã Viết Lại ▶` : '📤 Đăng Toàn Bộ Chương Mới ▶';
    }
  } catch (e) { $('#pbErr').textContent = 'Xem trước thất bại: ' + e.message; }
  finally { stopTick(); btn.disabled = false; btn.textContent = old; }
});
let PB_PREVIEW = null;     // 最近一次「预览将发」的结果 {slug,data}：发布时据此决定要不要覆盖确认
let PB_STREAM = null;      // 发布进度的 SSE（弹窗内实时滚日志）
let PB_STREAM_SLUG = null; // 当前 SSE 属于哪本书（用于弹窗重开时判断是否已挂着）
function pbCloseStream() { if (PB_STREAM) { try { PB_STREAM.close(); } catch { } PB_STREAM = null; PB_STREAM_SLUG = null; } }
// 发布进入/结束时切换「停止发布」「发布中」等按钮态；发布中禁用发布类按钮，露出停止按钮。
function pbSetPublishingUI(on) {
  const stop = $('#pbStop');
  if (stop) { stop.style.display = on ? '' : 'none'; stop.disabled = !on; stop.textContent = '⏹ Dừng Đăng'; }
  $('#pbTest').disabled = !!on; $('#pbPreview').disabled = !!on;
  // 发布中禁用发布并显示"发布中…"；结束后仍保持禁用（需重新预览确认最新章号，避免重发）。
  $('#pbGo').disabled = true;
  $('#pbGo').textContent = on ? '📤 Đang Đăng…' : '🔍 Vui lòng bấm Xem trước';
}
// 弹窗打开时按该书的发布状态同步 UI，并在正在发布时接回 SSE 进度。
function pbSyncStopBtn() {
  if (!CUR) return;
  if (PUBLISHING.has(CUR.slug)) {
    pbSetPublishingUI(true);
    // 若 SSE 没挂在这本书上（如关弹窗后重开），重新接回进度
    if (PB_STREAM_SLUG !== CUR.slug) pbAttachStream(CUR.slug, '⏳ Đang tiến hành đăng tải, kết nối lại tiến trình:\n');
  } else {
    pbSetPublishingUI(false);
  }
}
// 标记发布结束/停止：清客户端状态、复位 UI、刷新书架去掉徽标。
function pbMarkDone(slug) {
  PUBLISHING.delete(slug);
  pbCloseStream();
  if (CUR && CUR.slug === slug) pbSetPublishingUI(false);
  renderShelf();
}
// 挂 SSE：把番茄发布日志滚进 pbPreviewOut，命中结束词时收尾。
function pbAttachStream(slug, header) {
  const out = $('#pbPreviewOut'); out.style.display = '';
  if (header) out.textContent = header;
  pbCloseStream();
  PB_STREAM_SLUG = slug;
  PB_STREAM = new EventSource(`${API}/api/stream?book=${encodeURIComponent(slug)}`);
  PB_STREAM.addEventListener('log', ev => {
    let e; try { e = JSON.parse(ev.data); } catch { return; }
    if (e.source !== 'fanqie') return;
    const tag = e.level === 'error' ? '✖' : e.level === 'act' ? '▶' : '·';
    out.textContent += `${tag} ${e.msg}\n`;
    out.scrollTop = out.scrollHeight;
    // 发布收尾/停止/异常 → 清状态、复位按钮
    if (/发布结束|重发结束|全部完成|已暂停|已中止|已停止|Không có新章|发布异常/.test(e.msg)) {
      out.textContent += '\n—— (Đã hoàn tất, bạn có thể đóng cửa sổ. Nội dung sẽ hiển thị trên nền tảng) ——\n';
      out.scrollTop = out.scrollHeight;
      pbMarkDone(slug);
    }
  });
  PB_STREAM.onerror = () => { };
}
// 覆盖阈值以【预览回传的那个数】为准——服务端拿它拦，UI 就得拿同一个数判断要不要先问一句。
function pbRwLimitOf(pv) {
  const n = Number(pv && pv.rewriteSyncLimit);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}
async function pbPublish(limit) {
  $('#pbErr').textContent = '';
  const warn = limit ? `【Thử nghiệm】Chỉ đăng 1 chương mới đầu tiên của tác phẩm 《${CUR.title}》?` : `Đăng toàn bộ các chương mới của tác phẩm 《${CUR.title}》? Vui lòng xác nhận cấu hình đã chính xác.`;
  if (!confirm(warn)) return;
  // 覆盖线上已发布章不可逆（读者已经看过）。服务端超阈值会中止并要一个明确放行，这道确认就是那个放行：
  // 把要覆盖的章号摆出来，作者点头才带 confirmRewrites 发。
  // 【别删】没有它，「同步 N 个重写章」按钮点了必被服务端拦死，UI 再Không có别的路可走。
  let confirmRewrites = false;
  const pv = PB_PREVIEW && PB_PREVIEW.slug === CUR.slug ? PB_PREVIEW.data : null;
  if (!limit && pv && pv.syncRewrites && pv.rewrittenCount > pbRwLimitOf(pv)) {
    const nums = pv.rewrittenNums || [];
    const shown = nums.slice(0, 40).join(', ') + (nums.length > 40 ? ` …(Tổng cộng ${nums.length} chương)` : '');
    const okRw = confirm(`⚠️ Thao tác ghi đè: Đợt này sẽ dùng nội dung trên máy để ghi đè lên ${pv.rewrittenCount} chương đã đăng trên nền tảng.\n\nCác chương bị ảnh hưởng: Chương ${shown}\n\nXác nhận ghi đè? (Hủy = Giữ nguyên chương cũ, chỉ đăng chương mới)`);
    if (!okRw) return;
    confirmRewrites = true;
  }
  const slug = CUR.slug;
  try {
    if (!await pbSave()) return;
    await api('/api/book/publish', 'POST', { book: slug, limit: limit || 0, confirmRewrites });
    // 标记这本书正在发布（书卡徽标 + 停止按钮 + 关弹窗后可回来）
    PUBLISHING.add(slug); renderShelf();
    pbSetPublishingUI(true);
    // 不关弹窗——发布进度实时滚在弹窗里
    pbAttachStream(slug, '⏳ Bắt đầu đăng tải, tiến độ:\n');
    toast(limit ? 'Đã bắt đầu đăng thử 1 chương, xem tiến độ bên dưới' : 'Đã bắt đầu đăng tải, xem tiến độ bên dưới');
  } catch (e) {
    // 启动失败：清状态、恢复所有按钮，绝不卡死
    PUBLISHING.delete(slug); renderShelf();
    pbSetPublishingUI(false);
    $('#pbErr').textContent = 'Đăng tải thất bại: ' + e.message;
  }
}
// ⏹ 停止发布：请求后台停发（发完当前章即停），保留状态直到 SSE 报结束。
$('#pbStop').addEventListener('click', async () => {
  if (!CUR) return;
  const btn = $('#pbStop'); btn.disabled = true; const old = btn.textContent; btn.textContent = '⏹ Đang dừng…';
  try {
    await pbRace(api('/api/book/publish-stop', 'POST', { book: CUR.slug }), 60000, 'Quá thời gian yêu cầu dừng');
    toast('Đã gửi yêu cầu dừng (Hoàn thành chương này sẽ dừng)');
  } catch (e) {
    $('#pbErr').textContent = 'Dừng thất bại: ' + e.message;
    btn.disabled = false; btn.textContent = old;   // 停止请求本身失败时恢复按钮，让用户能重试
  }
});
$('#pbGo').addEventListener('click', () => pbPublish(0));
$('#pbTest').addEventListener('click', () => pbPublish(1));
// 关弹窗：若该书仍在发布，保留 SSE 让书卡徽标能在后台发布结束时自动消失；否则收流。
function pbCloseModal() {
  if (!(PB_STREAM_SLUG && PUBLISHING.has(PB_STREAM_SLUG))) pbCloseStream();
  $('#publishModal').classList.add('hidden');
}
$('#pbClose').addEventListener('click', pbCloseModal);
$('#pbCancel').addEventListener('click', pbCloseModal);
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#publishModal').addEventListener('click', (e) => { if (e.target === $('#publishModal')) pbCloseModal(); });

// ---------- 从番茄导入图书到本地 ----------
let IF_PROFILES = [], IF_BOOKS = [], IF_STREAM = null;
const IF_BOOKS_CACHE = {};
function ifCloseStream() { if (IF_STREAM) { try { IF_STREAM.close(); } catch { } IF_STREAM = null; } }
function ifRenderProfiles() {
  const sel = $('#ifProfile');
  if (!IF_PROFILES.length) { sel.innerHTML = '<option value="">(Chưa phát hiện tài khoản Unzoo, vui lòng đăng nhập trên trình duyệt)</option>'; return; }
  sel.innerHTML = IF_PROFILES.map(p => {
    const tag = p.fanqie && p.fanqie.length ? '✓ Đã kết nối nền tảng' : (p.running ? '○ Đang chạy' : '· Chưa mở');
    const label = p.dir && p.dir !== p.name ? `${p.name} · ${p.dir}` : p.name;
    return `<option value="${esc(p.path)}">${esc(label)}（${tag}）</option>`;
  }).join('');
}
async function ifLoadBooks(profilePath, force) {
  const sel = $('#ifBook');
  if (!profilePath) { sel.innerHTML = '<option value="">(Vui lòng chọn tài khoản trước)</option>'; $('#ifBookId').value = ''; return; }
  if (!force && IF_BOOKS_CACHE[profilePath]) { IF_BOOKS = IF_BOOKS_CACHE[profilePath]; ifRenderBooks(); return; }
  sel.innerHTML = '<option value="">(Đang đọc danh sách tác phẩm...)</option>';
  try {
    const r = await api('/api/fanqie/books', 'POST', { profilePath });
    IF_BOOKS = r.books || [];
    if (r.ok && IF_BOOKS.length) IF_BOOKS_CACHE[profilePath] = IF_BOOKS;
    if (!r.ok || !IF_BOOKS.length) { sel.innerHTML = `<option value="">(${r.error || 'Chưa có tác phẩm'})</option>`; $('#ifBookId').value = ''; if (r.error) $('#ifErr').textContent = 'Đọc tác phẩm: ' + r.error; return; }
    ifRenderBooks();
  } catch (e) { sel.innerHTML = '<option value="">(Đọc dữ liệu thất bại)</option>'; $('#ifErr').textContent = 'Đọc danh sách tác phẩm thất bại: ' + e.message; }
}
function ifRenderBooks() {
  const sel = $('#ifBook');
  sel.innerHTML = IF_BOOKS.map(b => `<option value="${esc(b.id)}">${esc(b.title || '(Chưa đặt tên)')} · #${esc(b.id)}</option>`).join('');
  $('#ifBookId').value = IF_BOOKS[0] ? IF_BOOKS[0].id : '';
}
$('#btnImportFanqie').addEventListener('click', async () => {
  $('#ifErr').textContent = ''; $('#ifOut').style.display = 'none'; $('#ifOut').textContent = '';
  $('#ifGo').disabled = true; $('#ifTitle').value = '';
  $('#importFanqieModal').classList.remove('hidden');
  $('#ifProfile').innerHTML = '<option value="">(Đang tải tài khoản...)</option>';
  $('#ifBook').innerHTML = '<option value="">(Chọn tài khoản để tải danh sách...)</option>';
  try {
    const r = await api('/api/unzoo/profiles', 'POST', {});
    IF_PROFILES = r.profiles || []; ifRenderProfiles();
    if ($('#ifProfile').value) ifLoadBooks($('#ifProfile').value);
  } catch (e) { $('#ifErr').textContent = 'Lấy danh sách tài khoản thất bại: ' + e.message; IF_PROFILES = []; ifRenderProfiles(); }
});
$('#ifProfile').addEventListener('change', () => ifLoadBooks($('#ifProfile').value));
$('#ifBook').addEventListener('change', () => { $('#ifBookId').value = $('#ifBook').value; $('#ifGo').disabled = true; });
$('#ifPreview').addEventListener('click', async () => {
  const profilePath = $('#ifProfile').value, bookId = $('#ifBookId').value;
  if (!profilePath || !bookId) { $('#ifErr').textContent = 'Vui lòng chọn tài khoản và tác phẩm'; return; }
  $('#ifErr').textContent = ''; const btn = $('#ifPreview'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang đọc dữ liệu…';
  const out = $('#ifOut'); out.style.display = ''; out.textContent = '⏳ Đang đọc danh mục quyển và chương truyện…';
  try {
    const r = await api('/api/fanqie/import-preview', 'POST', { profilePath, bookId });
    if (!r.ok) { out.textContent = '⛔ ' + (r.error || 'Xem trước thất bại'); $('#ifGo').disabled = true; return; }
    out.textContent = `Sẽ nhập ${r.volumes} quyển / ${r.chapters} chương:\n` + (r.volNames || []).map(n => '  · ' + n).join('\n');
    $('#ifGo').disabled = false;
  } catch (e) { out.textContent = 'Xem trước thất bại: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
});
async function ifImport(limit) {
  const profilePath = $('#ifProfile').value, bookId = $('#ifBookId').value, title = $('#ifTitle').value.trim();
  if (!profilePath || !bookId) { $('#ifErr').textContent = 'Vui lòng chọn tài khoản và tác phẩm'; return; }
  if (!limit && !confirm('Tải toàn bộ tác phẩm này về máy (gồm toàn bộ nội dung các chương)? Quá trình có thể mất vài phút.')) return;
  $('#ifErr').textContent = '';
  const out = $('#ifOut'); out.style.display = ''; out.textContent = '⏳ Bắt đầu tải về máy, tiến độ:\n';
  $('#ifGo').disabled = true; $('#ifTest').disabled = true; $('#ifPreview').disabled = true;
  try {
    await api('/api/fanqie/import', 'POST', { profilePath, bookId, title, limit: limit || 0 });
    ifCloseStream();
    IF_STREAM = new EventSource(`${API}/api/stream?book=${encodeURIComponent('__import_' + bookId)}`);
    IF_STREAM.addEventListener('log', ev => {
      let e; try { e = JSON.parse(ev.data); } catch { return; }
      if (e.source !== 'import') return;
      const tag = e.level === 'error' ? '✖' : e.level === 'warn' ? '⚠' : e.level === 'act' ? '▶' : '·';
      out.textContent += `${tag} ${e.msg}\n`; out.scrollTop = out.scrollHeight;
      if (/从番茄导入结束|从番茄导入异常/.test(e.msg)) {
        ifCloseStream(); $('#ifTest').disabled = false; $('#ifPreview').disabled = false; $('#ifGo').disabled = false;
        out.textContent += '\n—— (Hoàn thành) ——\n'; out.scrollTop = out.scrollHeight;
        refresh();
        if (/导入结束/.test(e.msg)) toast('Nhập tác phẩm hoàn tất, đã thêm vào tủ sách');
      }
    });
    IF_STREAM.onerror = () => { };
    toast(limit ? 'Bắt đầu nhập thử 3 chương' : 'Bắt đầu nhập, xem tiến độ ở nhật ký bên dưới');
  } catch (e) { $('#ifErr').textContent = 'Nhập tác phẩm thất bại: ' + e.message; $('#ifGo').disabled = false; $('#ifTest').disabled = false; $('#ifPreview').disabled = false; }
}
$('#ifGo').addEventListener('click', () => ifImport(0));
$('#ifTest').addEventListener('click', () => ifImport(3));
function ifCloseModal() { ifCloseStream(); $('#importFanqieModal').classList.add('hidden'); }
$('#ifClose').addEventListener('click', ifCloseModal);
$('#ifCancel').addEventListener('click', ifCloseModal);
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#importFanqieModal').addEventListener('click', (e) => { if (e.target === $('#importFanqieModal')) ifCloseModal(); });

// ---------- 完本 ----------
function flSync() {
  const b = (STATE.books.find(x => x.slug === CUR?.slug) || CUR || {});
  const st = b.status || 'Đang Ra';
  const fq = b.fanqie?.status ? `　|　Nền tảng: ${b.fanqie.status}${(st === 'Đã Hoàn Thành' && b.fanqie.status !== 'Đã Kết Thúc') ? ' ⚠ Tác phẩm đã xong nhưng nền tảng chưa đóng' : ''}` : '';
  $('#flStatus').textContent = 'Trạng thái tác phẩm: ' + st + fq;
  $('#flEnter').disabled = (st === 'Đang Hồi Kết' || st === 'Đã Hoàn Thành');
}
function openFinale() {
  if (!CUR) return;
  $('#flErr').textContent = ''; $('#flResult').classList.add('hidden'); $('#flCritique').textContent = '';
  const co = $('#flClosureOut'); if (co) { co.style.display = 'none'; co.textContent = ''; }
  flSync();
  $('#finaleModal').classList.remove('hidden');
}
function setStatusLocal(s) { if (CUR) CUR.status = s; const b = STATE.books.find(x => x.slug === CUR?.slug); if (b) b.status = s; flSync(); }
$('#btnFinale').addEventListener('click', openFinale);
function flCloseModal() { flCloseStream && flCloseStream(); $('#finaleModal').classList.add('hidden'); }
$('#flClose').addEventListener('click', flCloseModal);
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#finaleModal').addEventListener('click', (e) => { if (e.target === $('#finaleModal')) flCloseModal(); });
$('#flEnter').addEventListener('click', async () => {
  if (!CUR) return;
  $('#flErr').textContent = ''; $('#flEnter').disabled = true;
  try {
    const r = await api('/api/book/finale', 'POST', { book: CUR.slug, on: true });
    setStatusLocal(r.status);
    toast(r.live ? 'Đã vào giai đoạn thu về hồi kết → Đã gửi chỉ lệnh kết thúc' : 'Đã vào giai đoạn thu về hồi kết, đợt viết tiếp theo sẽ tiến hành kết thúc');
  } catch (e) { $('#flErr').textContent = e.message; $('#flEnter').disabled = false; }
});
$('#flApply').addEventListener('click', async () => {
  if (!CUR) return;
  const btn = $('#flApply'); btn.disabled = true;
  try {
    const r = await api('/api/book/apply-review', 'POST', { book: CUR.slug, kind: 'ending' });
    $('#finaleModal').classList.add('hidden');
    if (r.mode === 'started') { setWriting(true); openStream(CUR.slug); }
    toast(r.mode === 'inserted' ? 'Đã yêu cầu hoàn thiện kết thúc theo góp ý' : 'Đã mở tiến trình hoàn thiện kết cục');
  } catch (e) { $('#flErr').textContent = e.message; }
  finally { btn.disabled = false; }
});
$('#flAfterword').addEventListener('click', async () => {
  if (!CUR) return;
  const btn = $('#flAfterword'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang gửi chỉ lệnh…';
  $('#flErr').textContent = '';
  try {
    const r = await api('/api/book/afterword', 'POST', { book: CUR.slug });
    if (r.mode === 'opened') { setWriting(true); openStream(CUR.slug); }
    toast(r.mode === 'inserted' ? 'Đã gửi lệnh: Bổ sung Lời Bạt / Cảm Nghĩ Hoàn Truyện' : 'Đã mở tiến trình: Viết Lời Bạt / Cảm Nghĩ Hoàn Truyện');
  } catch (e) { $('#flErr').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
});
$('#flReview').addEventListener('click', async () => {
  if (!CUR) return;
  const btn = $('#flReview'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang thẩm định kết truyện… (~1-2 phút)';
  $('#flErr').textContent = ''; $('#flResult').classList.add('hidden');
  try {
    const r = await api('/api/book/review-ending', 'POST', { book: CUR.slug });
    $('#flMeta').textContent = `${r.pass ? '✅ Đánh giá: Đủ điều kiện kết thúc tác phẩm' : '⚠️ Đánh giá: Chưa thể kết thúc (Còn tình tiết chưa thu hồi)'} ｜ Biên tập: ${modelName(r.editorModel)} ｜ reviews/${r.file}`;
    $('#flCritique').textContent = r.critique || '(Chưa có nội dung)';
    $('#flResult').classList.remove('hidden');
  } catch (e) { $('#flErr').textContent = 'Thất bại: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = old; }
});
$('#flUndo').addEventListener('click', async () => {
  if (!CUR) return;
  try { const r = await api('/api/book/status', 'POST', { book: CUR.slug, status: 'Đang Ra' }); setStatusLocal(r.status); toast('Đã hủy kết truyện, trở lại trạng thái Đang Ra'); }
  catch (e) { $('#flErr').textContent = e.message; }
});
$('#flMark').addEventListener('click', async () => {
  if (!CUR) return;
  try { const r = await api('/api/book/status', 'POST', { book: CUR.slug, status: 'Đã Hoàn Thành' }); setStatusLocal(r.status); toast('Đã đánh dấu là Đã Hoàn Thành'); }
  catch (e) { $('#flErr').textContent = e.message; }
});

// ---------- 完结收口（内部完本 → 番茄Hệ Điều Hành完结）----------
let FL_STREAM = null;
function flCloseStream() { if (FL_STREAM) { try { FL_STREAM.close(); } catch { } FL_STREAM = null; } }
// 把番茄 SSE 日志滚进 flClosureOut，命中 endRe 时复位按钮。
function flStreamFanqie(endRe, onEnd) {
  const out = $('#flClosureOut'); out.style.display = ''; out.scrollTop = out.scrollHeight;
  flCloseStream();
  FL_STREAM = new EventSource(`${API}/api/stream?book=${encodeURIComponent(CUR.slug)}`);
  FL_STREAM.addEventListener('log', ev => {
    let e; try { e = JSON.parse(ev.data); } catch { return; }
    if (e.source !== 'fanqie') return;
    const tag = e.level === 'error' ? '✖' : e.level === 'warn' ? '⚠' : e.level === 'act' ? '▶' : '·';
    out.textContent += `${tag} ${e.msg}\n`; out.scrollTop = out.scrollHeight;
    if (endRe.test(e.msg)) { flCloseStream(); out.textContent += '\n—— (Hoàn thành) ——\n'; out.scrollTop = out.scrollHeight; if (onEnd) onEnd(); }
  });
  FL_STREAM.onerror = () => { };
}
function flRenderReport(r) {
  const out = $('#flClosureOut'); out.style.display = '';
  const sym = c => c.level === 'info' ? (c.ok ? '✅' : 'ℹ️') : c.level === 'hard' ? (c.ok ? '✅' : '❌') : (c.ok ? '✅' : '⚠️');
  const lines = [];
  lines.push(r.ready ? '【Sẵn sàng kết truyện】Nội dung đã hoàn chỉnh, có thể làm thủ tục hoàn thành tác phẩm.' : '【Chưa sẵn sàng】Xem các tiêu chí chưa đạt bên dưới (❌ là bắt buộc).');
  lines.push('');
  for (const c of (r.checks || [])) lines.push(`${sym(c)} ${c.label} — ${c.detail}`);
  if (r.fanqie && r.fanqie.ok) lines.push('', `Nền tảng: ${r.fanqie.status}${r.fanqie.signed ? ' · Đã ký hợp đồng' : ''} ｜ ${r.fanqie.totalWordsText || '?'} ｜ Mới nhất: Chương ${r.fanqie.lastChapterNum} ${r.fanqie.lastChapterTitle || ''}`);
  else if (r.fanqie && r.fanqie.error) lines.push('', `⚠ Đọc trạng thái nền tảng thất bại: ${r.fanqie.error}`);
  if (r.mismatch && r.mismatch.length) lines.push('', '⚠ Lưu ý đối soát: ' + r.mismatch.join('; '));
  if (r.note) lines.push('', '— Thông tin gửi biên tập viên khi hoàn truyện —', r.note);
  out.textContent = lines.join('\n'); out.scrollTop = 0;
}
$('#flReport').addEventListener('click', async () => {
  if (!CUR) return;
  const btn = $('#flReport'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang đối soát… (~10 giây)';
  $('#flErr').textContent = ''; $('#flClosureOut').style.display = ''; $('#flClosureOut').textContent = '⏳ Đang đọc dữ liệu để lập báo cáo sẵn sàng kết truyện…\n';
  try {
    const r = await api('/api/book/completion-report', 'POST', { book: CUR.slug });
    flRenderReport(r);
    // 番茄状态回写到卡片（双状态可视化）
    if (r.fanqie?.ok) { const b = STATE.books.find(x => x.slug === CUR.slug); if (b) b.fanqie = { status: r.fanqie.status }; if (CUR) CUR.fanqie = { status: r.fanqie.status }; }
  } catch (e) { $('#flErr').textContent = 'Tạo báo cáo thất bại: ' + e.message; $('#flClosureOut').textContent = ''; }
  finally { btn.disabled = false; btn.textContent = old; }
});
$('#flClosure').addEventListener('click', async () => {
  if (!CUR) return;
  if (!confirm(`Hoàn tất kết truyện: Đăng đầy đủ các chương kết và lời bạt của tác phẩm 《${CUR.title}》 lên nền tảng?\n(Chỉ đăng chương mới, không tự động nộp đơn xin kết thúc). Xác nhận?`)) return;
  $('#flErr').textContent = '';
  const out = $('#flClosureOut'); out.style.display = ''; out.textContent = '⏳ Bắt đầu tiến trình hoàn tất kết truyện, tiến độ:\n';
  const btn = $('#flClosure'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Đang hoàn tất…';
  try {
    await api('/api/book/finale-closure', 'POST', { book: CUR.slug });
    flStreamFanqie(/完结收口结束|完结收口异常|完结收口：/, () => { btn.disabled = false; btn.textContent = old; });
  } catch (e) { $('#flErr').textContent = 'Hoàn tất thất bại: ' + e.message; btn.disabled = false; btn.textContent = old; }
});
$('#flLocate').addEventListener('click', async () => {
  if (!CUR) return;
  $('#flErr').textContent = '';
  const out = $('#flClosureOut'); out.style.display = ''; out.textContent = '⏳ Đang kiểm tra cổng đăng ký kết truyện trên nền tảng…\n';
  const btn = $('#flLocate'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Đang kiểm tra…';
  try {
    await api('/api/book/locate-completion', 'POST', { book: CUR.slug });
    flStreamFanqie(/完结入口探测结束|探测完结入口异常/, () => { btn.disabled = false; btn.textContent = old; });
  } catch (e) { $('#flErr').textContent = 'Kiểm tra thất bại: ' + e.message; btn.disabled = false; btn.textContent = old; }
});

// ---------- 大纲审稿 ----------
async function openOutline() {
  if (!CUR) return;
  $('#olErr').textContent = ''; $('#olResult').classList.add('hidden');
  $('#olCritique').textContent = ''; $('#olMeta').textContent = '';
  const b = STATE.books.find(x => x.slug === CUR.slug) || CUR;
  const st = b.stats || {};
  let vols = [...(st.volumes || [])];
  try {
    const t = await api('/api/book/files?book=' + encodeURIComponent(CUR.slug));
    if (t && t.outlines && t.outlines.length) {
      for (const o of t.outlines) {
        const m = (o.name || o.rel || '').match(/^(?:卷|Quyen_|Quyển_)?\s*0*(\d+)/i);
        if (m) {
          const vTag = '卷' + m[1].padStart(2, '0');
          if (!vols.includes(vTag)) vols.push(vTag);
        }
      }
      vols.sort();
    }
  } catch { }
  $('#olBookInfo').textContent = `(Tổng cộng ${st.chapters || 0} chương` + (vols.length ? ` · ${vols.length} quyển` : '') + ')';
  $('#olScope').innerHTML = ['<option value="立项">Khởi tạo / Dàn ý toàn thư</option>']
    .concat(vols.map(v => `<option value="${esc(v)}">Dàn ý ${esc(v)}</option>`)).join('');
  $('#olStart').disabled = false; $('#olStart').textContent = 'Bắt Đầu Thẩm Định ▶';
  $('#outlineModal').classList.remove('hidden');
}
$('#btnOutline').addEventListener('click', openOutline);
$('#btnRebuildOutline').addEventListener('click', async () => {
  if (!CUR) return;
  if (!confirm('Tái lập Story Bible & Dàn ý phân quyển từ các chương đã viết (Không sửa các chương cũ)? Khuyên dùng cho tác phẩm nhập về. Xác nhận?')) return;
  const btn = $('#btnRebuildOutline'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'Đang gửi chỉ lệnh…';
  try {
    const r = await api('/api/book/rebuild-outline', 'POST', { book: CUR.slug });
    if (r.mode === 'opened' || r.mode === 'headless') { setWriting(true); openStream(CUR.slug); }
    toast(r.mode === 'inserted' ? 'Đã gửi lệnh: Tái lập Story Bible & Dàn ý (Không viết chương mới)' : 'Đã bắt đầu tiến trình: Tái lập Story Bible & Dàn ý (Chạy ngầm)');
  } catch (e) { toast('Tái lập thất bại: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = old; }
});
$('#olApply').addEventListener('click', async () => {
  if (!CUR) return;
  const scope = $('#olScope').value;
  const btn = $('#olApply'); btn.disabled = true;
  try {
    const r = await api('/api/book/apply-review', 'POST', { book: CUR.slug, scope, kind: 'outline' });
    $('#outlineModal').classList.add('hidden');
    if (r.mode === 'started' || r.mode === 'headless') { setWriting(true); openStream(CUR.slug); }
    toast(r.mode === 'inserted' ? `Đã yêu cầu AI sửa lại dàn ý 【${scope}】` : `Đã mở tiến trình: AI sửa dàn ý 【${scope}】`);
  } catch (e) { $('#olErr').textContent = e.message; }
  finally { btn.disabled = false; }
});
$('#olClose').addEventListener('click', () => $('#outlineModal').classList.add('hidden'));
$('#olCancel').addEventListener('click', () => $('#outlineModal').classList.add('hidden'));
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#outlineModal').addEventListener('click', (e) => { if (e.target === $('#outlineModal')) $('#outlineModal').classList.add('hidden'); });
$('#olStart').addEventListener('click', async () => {
  if (!CUR) return;
  const scope = $('#olScope').value;
  const inject = $('#olInject').checked;
  $('#olStart').disabled = true; $('#olStart').textContent = 'Tổng Biên Tập đang thẩm định… (~1–2 phút)';
  $('#olErr').textContent = ''; $('#olResult').classList.add('hidden');
  try {
    const r = await api('/api/book/review-outline', 'POST', { book: CUR.slug, scope, inject });
    $('#olMeta').textContent = `Mô hình Biên tập: ${r.editorModel} ｜ Đã lưu vào reviews/${r.file}` + (inject ? ' ｜ Đã gửi cho AI sửa đổi' : '');
    $('#olCritique').textContent = r.critique || '(Chưa có nội dung)';
    $('#olResult').classList.remove('hidden');
    $('#olStart').textContent = 'Thẩm Định Lại ▶';
    toast('Thẩm định hoàn tất: ' + scope);
  } catch (e) { $('#olErr').textContent = 'Thất bại: ' + e.message; $('#olStart').textContent = 'Bắt Đầu Thẩm Định ▶'; }
  finally { $('#olStart').disabled = false; }
});

// ---------- 文风 ----------
let ST_REC = null; // AI 推荐结果(带 tweak)
function openStyle() {
  if (!CUR) return;
  ST_REC = null;
  const b = STATE.books.find(x => x.slug === CUR.slug) || CUR;
  const presets = (STATE.styles || []).map(s => `<option value="${s.id}">${esc(s.name)}（${esc(s.short)}）</option>`).join('');
  $('#stSelect').innerHTML = presets;
  if (b.style && b.style.id) $('#stSelect').value = b.style.id;
  $('#stRec').textContent = b.style ? ('Văn phong hiện tại: ' + b.style.name + (b.style.tweak ? ' · ' + b.style.tweak : '')) : 'Chưa thiết lập văn phong riêng';
  $('#stErr').textContent = '';
  $('#styleModal').classList.remove('hidden');
}
$('#btnStyle').addEventListener('click', openStyle);
$('#stClose').addEventListener('click', () => $('#styleModal').classList.add('hidden'));
$('#stCancel').addEventListener('click', () => $('#styleModal').classList.add('hidden'));
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#styleModal').addEventListener('click', (e) => { if (e.target === $('#styleModal')) $('#styleModal').classList.add('hidden'); });
$('#stAiRec').addEventListener('click', async () => {
  if (!CUR) return;
  const b = STATE.books.find(x => x.slug === CUR.slug) || CUR;
  $('#stAiRec').disabled = true; $('#stRec').textContent = 'AI đang phân tích theo đề tài…'; $('#stErr').textContent = '';
  try {
    const r = await api('/api/book/recommend-style', 'POST', { theme: b.genre || b.title, model: b.model || STATE.config.defaultModel });
    ST_REC = r.style;
    $('#stSelect').value = r.style.id;
    $('#stRec').textContent = '🤖 Gợi ý: ' + r.style.name + ' —— ' + (r.style.reason || '') + (r.style.tweak ? ' ｜ Tinh chỉnh: ' + r.style.tweak : '');
  } catch (e) { $('#stRec').textContent = ''; $('#stErr').textContent = 'Gợi ý thất bại: ' + e.message; }
  finally { $('#stAiRec').disabled = false; }
});
$('#stApply').addEventListener('click', async () => {
  if (!CUR) return;
  const id = $('#stSelect').value;
  // 若 AI 推荐的就是当前选中的，连带 tweak 一起存
  const style = (ST_REC && ST_REC.id === id) ? { id, tweak: ST_REC.tweak } : id;
  $('#stApply').disabled = true; $('#stErr').textContent = 'Đang áp dụng…';
  try {
    await api('/api/book/set-style', 'POST', { book: CUR.slug, style });
    await refresh();
    const nb = STATE.books.find(x => x.slug === CUR.slug); if (nb) CUR = nb;
    $('#styleModal').classList.add('hidden'); toast('Văn phong đã đặt thành: ' + (nb?.style?.name || id));
  } catch (e) { $('#stErr').textContent = 'Thất bại: ' + e.message; }
  finally { $('#stApply').disabled = false; }
});

// ---------- 📚 对标风格学习 ----------
function openRefStyle() {
  if (!CUR) return;
  $('#rsModel').innerHTML = STATE.models.map(m => `<option value="${m.id}" ${m.available ? '' : 'disabled'}>${esc(m.name)}${m.available ? '' : ' (Chưa cài đặt)'}</option>`).join('');
  $('#rsModel').value = CUR.model || STATE.config.defaultModel;
  $('#rsSample').value = ''; $('#rsUrl').value = ''; $('#rsName').value = ''; $('#rsRules').value = '';
  if ($('#rsMulti')) $('#rsMulti').checked = false;
  if ($('#rsFile')) $('#rsFile').value = '';
  $('#rsResultWrap').classList.add('hidden'); $('#rsSave').classList.add('hidden');
  $('#rsErr').textContent = '';
  $('#refStyleModal').classList.remove('hidden');
  // 异步加载 Unzoo 账号(供番茄链接选 profile)
  api('/api/unzoo/profiles', 'POST', {}).then(r => {
    const ps = (r.profiles || r.data?.profiles || (Array.isArray(r) ? r : [])) || [];
    $('#rsProfile').innerHTML = '<option value="">(Chọn tài khoản Unzoo)</option>' +
      ps.map(p => `<option value="${esc(p.path || p.profile_path || '')}">${esc(p.name || p.label || p.path)}</option>`).join('');
  }).catch(() => { $('#rsProfile').innerHTML = '<option value="">(Chưa kết nối Unzoo)</option>'; });
}
$('#btnRefStyle').addEventListener('click', openRefStyle);

// ---------- 创作台：大白话改设定 / 大纲 ----------
let ST_TARGET = 'bible';
async function openStudio() {
  if (!CUR) return;
  ST_TARGET = 'bible';
  $('#stAsk').value = ''; $('#sdErr').textContent = '';
  $('#stTarget').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.t === 'bible'));
  $('#stVolWrap').classList.add('hidden');
  $('#studioModal').classList.remove('hidden');
  try {
    const t = await api('/api/book/files?book=' + encodeURIComponent(CUR.slug));
    const outs = (t.outlines || []).filter(o => /卷\s*\d+/.test(o.name || o.rel || ''));
    $('#stVol').innerHTML = outs.map(o => {
      const nm = o.name || o.rel || '';
      const m = nm.match(/卷\s*0*\d+[^./\\]*/);
      const scope = (m ? m[0] : nm).replace(/分章大纲.*$/, '').trim();
      return `<option value="${esc(scope)}">${esc(nm)}</option>`;
    }).join('') || '<option value="">(Chưa có dàn ý phân quyển)</option>';
  } catch { $('#stVol').innerHTML = '<option value="">(Đọc danh sách quyển thất bại)</option>'; }
}
$('#btnStudio') && $('#btnStudio').addEventListener('click', openStudio);
// 改名·全书替换（先预览命中数，确认再改，git 可回退）
$('#stRenameGo') && $('#stRenameGo').addEventListener('click', async () => {
  if (!CUR) return;
  const from = $('#stFrom').value.trim(), to = $('#stTo').value.trim();
  if (!from || !to) { $('#stRenameHint').textContent = 'Vui lòng điền cả tên cũ và tên mới'; return; }
  $('#stRenameGo').disabled = true;
  try {
    const pv = await api('/api/book/rename-entity', 'POST', { book: CUR.slug, from, to, preview: true });
    if (!pv.count) { $('#stRenameHint').textContent = `Toàn bộ truyện không tìm thấy 「${from}」, vui lòng kiểm tra lại chính tả`; return; }
    if (!confirm(`Thay thế 「${from}」 thành 「${to}」 trên toàn bộ tác phẩm — Tổng cộng ${pv.count} vị trí trong ${pv.files} file?\nHệ thống đã tự động sao lưu dự phòng. Bạn có chắc chắn?`)) return;
    $('#stRenameHint').textContent = 'Đang thay thế…';
    const r = await api('/api/book/rename-entity', 'POST', { book: CUR.slug, from, to });
    $('#stRenameHint').innerHTML = `✅ Đã thay thế 「${from}」→「${to}」 tại ${r.count} vị trí (${r.files} file). Toàn bộ chương truyện, dàn ý và Story Bible đã được cập nhật.`;
    $('#stFrom').value = ''; $('#stTo').value = '';
    toast(`Đổi tên hoàn tất: ${from} → ${to} (${r.count} vị trí)`);
  } catch (e) { $('#stRenameHint').textContent = 'Thất bại: ' + e.message; }
  finally { $('#stRenameGo').disabled = false; }
});
// AI 智能改名（人名：AI 通读全书辨认所有叫法后一致改，不误伤，不写正文）
$('#stAiRename') && $('#stAiRename').addEventListener('click', async () => {
  if (!CUR) return;
  const from = $('#stFrom').value.trim(), to = $('#stTo').value.trim();
  if (!from || !to) { $('#stRenameHint').textContent = 'Vui lòng điền cả tên cũ và tên mới'; return; }
  if (!confirm(`Để AI rà soát toàn bộ tác phẩm và thay thế nhất quán mọi danh xưng của nhân vật 「${from}」 thành 「${to}」?\nHệ thống đã tự động sao lưu. Bạn có chắc chắn?`)) return;
  $('#stAiRename').disabled = true; $('#stRenameHint').textContent = 'AI đang rà soát toàn bộ tác phẩm để thay thế nhất quán… (Xem nhật ký bên dưới)';
  try {
    const r = await api('/api/book/ai-rename', 'POST', { book: CUR.slug, from, to, model: $('#writeModel') ? $('#writeModel').value : undefined });
    $('#studioModal').classList.add('hidden');
    if (r.mode === 'opened') { setWriting(true); openStream(CUR.slug); }
    toast(`AI đang thay thế 「${from}」→「${to}」 trên toàn bộ tác phẩm (Xem nhật ký)`);
  } catch (e) { $('#stRenameHint').textContent = 'Thất bại: ' + e.message; }
  finally { $('#stAiRename').disabled = false; }
});
// 阅读页：目录收起/展开
$('#rdNavToggle') && $('#rdNavToggle').addEventListener('click', () => {
  const r = $('#reader'); if (r) r.classList.toggle('nav-collapsed');
});
$('#sdClose') && $('#sdClose').addEventListener('click', () => $('#studioModal').classList.add('hidden'));
$('#sdCancel') && $('#sdCancel').addEventListener('click', () => $('#studioModal').classList.add('hidden'));
$('#stTarget') && $('#stTarget').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  ST_TARGET = b.dataset.t;
  $('#stTarget').querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b));
  $('#stVolWrap').classList.toggle('hidden', ST_TARGET !== 'outline');
});
$('#stGo') && $('#stGo').addEventListener('click', async () => {
  if (!CUR) return;
  const ask = $('#stAsk').value.trim();
  if (ask.length < 2) { $('#sdErr').textContent = 'Vui lòng tóm tắt 1 câu yêu cầu bạn muốn sửa'; return; }
  const scope = ST_TARGET === 'outline' ? $('#stVol').value : '';
  if (ST_TARGET === 'outline' && !scope) { $('#sdErr').textContent = 'Vui lòng chọn quyển cần sửa'; return; }
  $('#stGo').disabled = true; $('#sdErr').textContent = 'AI đang chỉnh sửa… (~1–2 phút, vui lòng đợi)';
  try {
    const r = await api('/api/book/revise-setting', 'POST', { book: CUR.slug, target: ST_TARGET, scope, instruction: ask, model: $('#writeModel').value });
    $('#studioModal').classList.add('hidden');
    if (r.mode === 'opened' || r.mode === 'headless') { setWriting(true); openStream(CUR.slug); }
    toast(ST_TARGET === 'outline' ? `AI đang sửa dàn ý 【${scope}】 theo yêu cầu (Xem nhật ký)` : 'AI đang sửa thiết lập/nhân vật theo yêu cầu của bạn (Xem nhật ký)');
  } catch (e) { $('#sdErr').textContent = 'Thất bại: ' + e.message; }
  finally { $('#stGo').disabled = false; }
});

// ---------- 🧭 本卷共创大纲（全书只有粗罗盘，逐卷共创） ----------
async function openVolPlan() {
  if (!CUR) return;
  $('#vpText').value = ''; $('#vpErr').textContent = ''; $('#vpHint').textContent = '';
  if ($('#vpDir')) $('#vpDir').value = '';
  // 探索式书：没有罗盘，本卷走向必须作者给 → 文案强调、按钮改名
  const disc = CUR.planMode === 'discovery';
  if ($('#vpDraft')) $('#vpDraft').textContent = disc ? '🤖 Lập bản thảo theo hướng đi của tôi' : '🤖 Để AI lập dàn ý thảo';
  if ($('#vpDirLabel')) $('#vpDirLabel').textContent = disc
    ? 'Hướng đi của quyển (Bắt buộc: Bạn muốn câu chuyện diễn biến ra sao)'
    : 'Hướng đi của quyển (Bạn quyết định; để trống để AI lập theo la bàn)';
  $('#vpModel').innerHTML = STATE.models.map(m => `<option value="${m.id}" ${m.available ? '' : 'disabled'}>${esc(m.name)}${m.available ? '' : ' (Chưa cài đặt)'}</option>`).join('');
  $('#vpModel').value = CUR.model || STATE.config.defaultModel;
  // 卷号：1..规划卷数；默认下一卷（当前卷+1，没写过则第1卷）
  let planned = 30, cur = 0;
  try { const d = await api('/api/book/dashboard?book=' + encodeURIComponent(CUR.slug)); planned = d.plannedVolumes || 30; cur = d.curVol || 0; } catch { }
  const n = Math.max(planned, cur + 3, 8);
  const nextVol = Math.min(cur + 1, n) || 1;
  $('#vpVol').innerHTML = Array.from({ length: n }, (_, i) => i + 1).map(v => `<option value="${v}" ${v === nextVol ? 'selected' : ''}>Quyển ${v}${v === cur + 1 ? ' (Quyển tiếp theo)' : v <= cur ? ' (Đã bắt đầu viết)' : ''}</option>`).join('');
  $('#volPlanModal').classList.remove('hidden');
}
$('#btnVolPlan') && $('#btnVolPlan').addEventListener('click', openVolPlan);
$('#vpClose') && $('#vpClose').addEventListener('click', () => $('#volPlanModal').classList.add('hidden'));
$('#vpCancel') && $('#vpCancel').addEventListener('click', () => $('#volPlanModal').classList.add('hidden'));
$('#vpDraft') && $('#vpDraft').addEventListener('click', async () => {
  if (!CUR) return;
  const vol = parseInt($('#vpVol').value, 10) || 1;
  const direction = $('#vpDir') ? $('#vpDir').value.trim() : '';
  if (CUR.planMode === 'discovery' && !direction) { $('#vpErr').textContent = 'Vui lòng nhập tóm tắt hướng đi của quyển vào ô định hướng'; return; }
  $('#vpDraft').disabled = true; $('#vpHint').textContent = 'AI đang lập dàn ý thảo… (~1–2 phút)';
  try {
    const r = await api('/api/book/plan-volume', 'POST', { book: CUR.slug, volume: vol, model: $('#vpModel').value, direction });
    $('#vpText').value = r.draft || '';
    $('#vpHint').textContent = '✅ Dàn ý thảo đã tạo — Bạn có thể tùy ý sửa đổi, ưng ý thì bấm Lưu';
  } catch (e) { $('#vpErr').textContent = 'Lập dàn ý thảo thất bại: ' + e.message; $('#vpHint').textContent = ''; }
  finally { $('#vpDraft').disabled = false; }
});
$('#vpSave') && $('#vpSave').addEventListener('click', async () => {
  if (!CUR) return;
  const vol = parseInt($('#vpVol').value, 10) || 1;
  const content = $('#vpText').value.trim();
  if (content.length < 20) { $('#vpErr').textContent = 'Dàn ý quyển quá ngắn, hãy để AI tạo thảo hoặc tự nhập thêm'; return; }
  const rel = 'outlines/Quyen_' + String(vol).padStart(2, '0') + '_Dan_Y.md';
  $('#vpSave').disabled = true; $('#vpErr').textContent = '';
  try {
    await api('/api/book/save-file', 'POST', { book: CUR.slug, rel, content });
    $('#volPlanModal').classList.add('hidden');
    toast(`Dàn ý quyển ${vol} đã được lưu thành công! (${rel})`);
  } catch (e) { $('#vpErr').textContent = 'Lưu thất bại: ' + e.message; }
  finally { $('#vpSave').disabled = false; }
});

// 上传 txt → 读进样本框
$('#rsFile') && $('#rsFile').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { $('#rsSample').value = String(rd.result || '').slice(0, 20000); $('#rsErr').textContent = 'Đã tải file vào, có thể bấm phân tích'; };
  rd.readAsText(f, 'utf-8');
});
$('#rsClose').addEventListener('click', () => $('#refStyleModal').classList.add('hidden'));
$('#rsCancel').addEventListener('click', () => $('#refStyleModal').classList.add('hidden'));
$('#rsAnalyze').addEventListener('click', async () => {
  const urls = $('#rsUrl').value.split('\n').map(s => s.trim()).filter(Boolean);
  const multi = $('#rsMulti') && $('#rsMulti').checked;
  const sample = $('#rsSample').value.trim();
  const fanqie = multi || urls.length > 0;
  let body;
  if (fanqie) { body = { book: CUR.slug, bookUrls: urls, multi: !!multi, profilePath: $('#rsProfile').value, model: $('#rsModel').value }; }
  else if (sample.length >= 40) { body = { sample, model: $('#rsModel').value }; }
  else { $('#rsErr').textContent = 'Vui lòng nhập link tác phẩm mẫu hoặc dán một đoạn văn mẫu'; return; }
  $('#rsAnalyze').disabled = true;
  $('#rsErr').textContent = 'AI đang phân tích văn phong… (~1–3 phút)';
  try {
    const r = await api('/api/book/analyze-style', 'POST', body);
    $('#rsName').value = r.name || 'Văn phong học hỏi';
    $('#rsRules').value = r.rules || '';
    $('#rsResultWrap').classList.remove('hidden');
    $('#rsSave').classList.remove('hidden');
    $('#rsErr').textContent = '✅ Phân tích xong, bạn có thể chỉnh sửa rồi bấm Lưu';
  } catch (e) { $('#rsErr').textContent = 'Phân tích thất bại: ' + e.message; }
  finally { $('#rsAnalyze').disabled = false; }
});
$('#rsSave').addEventListener('click', async () => {
  if (!CUR) return;
  const name = $('#rsName').value.trim() || 'Văn phong học hỏi';
  const rules = $('#rsRules').value.trim();
  if (!rules) { $('#rsErr').textContent = 'Cẩm nang văn phong không được để trống'; return; }
  $('#rsSave').disabled = true; $('#rsErr').textContent = 'Đang lưu…';
  try {
    await api('/api/book/set-style', 'POST', { book: CUR.slug, style: { name, rules } });
    await refresh();
    const nb = STATE.books.find(x => x.slug === CUR.slug); if (nb) CUR = nb;
    $('#refStyleModal').classList.add('hidden'); toast('Đã đặt làm văn phong của truyện: ' + name + ' (Các chương tiếp theo sẽ viết theo văn phong này)');
  } catch (e) { $('#rsErr').textContent = 'Lưu thất bại: ' + e.message; }
  finally { $('#rsSave').disabled = false; }
});

// ---------- 目标章节数上限 ----------
$('#wbTarget').addEventListener('change', async () => {
  if (!CUR) return;
  const n = Math.max(0, Number($('#wbTarget').value) || 0);
  try {
    await api('/api/book/set-target', 'POST', { book: CUR.slug, targetChapters: n });
    const nb = STATE.books.find(b => b.slug === CUR.slug); if (nb) nb.targetChapters = n; CUR.targetChapters = n;
    toast(n ? ('Viết đến chương ' + n + ' sẽ tự động dừng') : 'Đã hủy giới hạn (Không hạn chế số chương)');
  } catch (e) { toast(e.message); }
});

// ---------- 封面生成 ----------
const COVER_THEMES = [
  { id: 'ink', name: 'Thủy Mặc', tColor: '#1a1a1a', aColor: '#555', bg(c, W, H) { c.fillStyle = '#efe9dd'; c.fillRect(0, 0, W, H); const g = c.createRadialGradient(W * .5, H * .3, 20, W * .5, H * .3, W * .65); g.addColorStop(0, 'rgba(20,20,20,.12)'); g.addColorStop(1, 'rgba(20,20,20,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.fillStyle = '#9e2b25'; c.fillRect(W - 118, H - 118, 64, 64); c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 2; c.strokeRect(24, 24, W - 48, H - 48); } },
  { id: 'republic', name: 'Dân Quốc Cổ Điển', tColor: '#e8d6a8', aColor: '#b09a6a', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a2018'); g.addColorStop(1, '#15100a'); c.fillStyle = g; c.fillRect(0, 0, W, H); const r = c.createRadialGradient(W * .5, H * .28, 10, W * .5, H * .28, W * .6); r.addColorStop(0, 'rgba(224,189,134,.2)'); r.addColorStop(1, 'rgba(224,189,134,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(224,189,134,.55)'; c.lineWidth = 2; c.strokeRect(28, 28, W - 56, H - 56); } },
  { id: 'night', name: 'Đêm Tối', tColor: '#eaf0ff', aColor: '#8fa6c8', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b1020'); g.addColorStop(1, '#1a2740'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 50; i++) { c.fillRect(Math.random() * W, Math.random() * H * .6, 1.6, 1.6); } } },
  { id: 'gold', name: 'Mạ Vàng', tColor: '#e8c97a', aColor: '#b8995a', bg(c, W, H) { c.fillStyle = '#0c0c0c'; c.fillRect(0, 0, W, H); c.strokeStyle = '#b8995a'; c.lineWidth = 3; c.strokeRect(26, 26, W - 52, H - 52); } },
  { id: 'vermilion', name: 'Chu Sa', tColor: '#f2e6c8', aColor: '#e7d2a4', bg(c, W, H) { c.fillStyle = '#6e1f17'; c.fillRect(0, 0, W, H); c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, H * .56, W, H * .44); c.strokeStyle = 'rgba(242,230,200,.4)'; c.lineWidth = 2; c.strokeRect(26, 26, W - 52, H - 52); } },
  { id: 'bamboo', name: 'Thanh Trúc', tColor: '#e6f0e2', aColor: '#9fc0a8', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#14241c'); g.addColorStop(1, '#0c1812'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(159,192,168,.4)'; c.lineWidth = 2; c.strokeRect(26, 26, W - 52, H - 52); } },
  { id: 'minimal', name: 'Tối Giản', tColor: '#222', aColor: '#666', bg(c, W, H) { c.fillStyle = '#f5f3ee'; c.fillRect(0, 0, W, H); c.fillStyle = '#c9a26a'; c.fillRect(0, 0, W, 150); } },
  { id: 'warfire', name: 'Khói Lửa', tColor: '#ffe6c0', aColor: '#e0a060', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a0c06'); g.addColorStop(.5, '#5a1a0a'); g.addColorStop(1, '#0e0603'); c.fillStyle = g; c.fillRect(0, 0, W, H); const r = c.createRadialGradient(W * .5, H * .72, 10, W * .5, H * .72, W * .7); r.addColorStop(0, 'rgba(255,120,40,.35)'); r.addColorStop(1, 'rgba(255,120,40,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(255,200,140,.4)'; c.lineWidth = 2; c.strokeRect(24, 24, W - 48, H - 48); } },
  { id: 'imperial', name: 'Cung Điện', tColor: '#f5e2a8', aColor: '#c9a24a', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3a0e0e'); g.addColorStop(1, '#160505'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.fillStyle = 'rgba(201,162,74,.10)'; for (let i = 1; i < 7; i++) c.fillRect(0, i * H / 7, W, 2); c.strokeStyle = '#c9a24a'; c.lineWidth = 3; c.strokeRect(24, 24, W - 48, H - 48); c.lineWidth = 1; c.strokeRect(34, 34, W - 68, H - 68); } },
  { id: 'bloodmoon', name: 'Huyết Nguyệt', tColor: '#f0e0d0', aColor: '#cc8888', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a0810'); g.addColorStop(1, '#1a0a12'); c.fillStyle = g; c.fillRect(0, 0, W, H); const m = c.createRadialGradient(W * .5, H * .3, 30, W * .5, H * .3, 130); m.addColorStop(0, '#a83030'); m.addColorStop(1, 'rgba(168,48,48,0)'); c.fillStyle = m; c.beginPath(); c.arc(W * .5, H * .3, 95, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.4)'; for (let i = 0; i < 40; i++) c.fillRect(Math.random() * W, Math.random() * H * .55, 1.4, 1.4); } },
  { id: 'rivers', name: 'Sơn Hà', tColor: '#eef2f0', aColor: '#a8c0b0', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#8fb0c8'); g.addColorStop(.5, '#5a7d92'); g.addColorStop(1, '#2a3d48'); c.fillStyle = g; c.fillRect(0, 0, W, H); for (let k = 0; k < 3; k++) { c.fillStyle = `rgba(20,40,50,${.35 + k * .18})`; c.beginPath(); const y = H * (.55 + k * .13); c.moveTo(0, y); for (let x = 0; x <= W; x += 40) c.lineTo(x, y - Math.sin(x / 60 + k) * 24 - k * 8); c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fill(); } } },
  { id: 'jianghu', name: 'Giang Hồ', tColor: '#eae4d8', aColor: '#b0a890', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#20242a'); g.addColorStop(1, '#0e1013'); c.fillStyle = g; c.fillRect(0, 0, W, H); const r = c.createRadialGradient(W * .5, H * .4, 20, W * .5, H * .4, W * .6); r.addColorStop(0, 'rgba(200,200,190,.14)'); r.addColorStop(1, 'rgba(200,200,190,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(230,225,215,.35)'; c.lineWidth = 2; c.strokeRect(26, 26, W - 52, H - 52); } },
  { id: 'starry', name: 'Tinh Không', tColor: '#eae6ff', aColor: '#b0a8e0', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#160a2e'); g.addColorStop(.5, '#2a1650'); g.addColorStop(1, '#0a0618'); c.fillStyle = g; c.fillRect(0, 0, W, H); const r = c.createRadialGradient(W * .5, H * .35, 10, W * .5, H * .35, W * .7); r.addColorStop(0, 'rgba(150,110,255,.3)'); r.addColorStop(1, 'rgba(150,110,255,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H); for (let i = 0; i < 70; i++) { c.globalAlpha = Math.random() * .8 + .2; c.fillStyle = '#fff'; c.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6); } c.globalAlpha = 1; } },
  { id: 'urban', name: 'Đô Thị', tColor: '#eafcff', aColor: '#7fd0e0', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a1826'); g.addColorStop(1, '#06304a'); c.fillStyle = g; c.fillRect(0, 0, W, H); for (let i = 0; i < 18; i++) { const bx = i * W / 18, bh = 40 + Math.random() * 220; c.fillStyle = 'rgba(20,60,80,.7)'; c.fillRect(bx, H - bh, W / 18 - 4, bh); } const r = c.createLinearGradient(0, H * .4, 0, H); r.addColorStop(0, 'rgba(0,200,255,0)'); r.addColorStop(1, 'rgba(0,200,255,.18)'); c.fillStyle = r; c.fillRect(0, 0, W, H); } },
  { id: 'capital', name: 'Kinh Doanh', tColor: '#eef4e6', aColor: '#c8b060', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0f2a1a'); g.addColorStop(1, '#05130d'); c.fillStyle = g; c.fillRect(0, 0, W, H); const r = c.createRadialGradient(W * .5, H * .3, 20, W * .5, H * .3, W * .6); r.addColorStop(0, 'rgba(90,200,130,.16)'); r.addColorStop(1, 'rgba(90,200,130,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H); c.globalAlpha = .06; c.fillStyle = '#c8e0b0'; c.font = 'bold 120px serif'; c.fillText('$', W * .5 - 40, H * .62); c.globalAlpha = 1; c.strokeStyle = 'rgba(200,176,96,.55)'; c.lineWidth = 2.5; c.strokeRect(26, 26, W - 52, H - 52); } },
  { id: 'cyber', name: 'Cyberpunk', tColor: '#eaf8ff', aColor: '#ff5bb0', bg(c, W, H) { c.fillStyle = '#070912'; c.fillRect(0, 0, W, H); c.lineWidth = 2; for (let i = -2; i < 9; i++) { c.strokeStyle = i % 2 ? 'rgba(255,60,160,.5)' : 'rgba(60,200,255,.5)'; c.beginPath(); c.moveTo(0, i * 110); c.lineTo(W, i * 110 - 150); c.stroke(); } const v = c.createRadialGradient(W * .5, H * .5, 40, W * .5, H * .5, W * .85); v.addColorStop(0, 'rgba(7,9,18,0)'); v.addColorStop(1, 'rgba(7,9,18,.88)'); c.fillStyle = v; c.fillRect(0, 0, W, H); } },
  { id: 'hotgold', name: 'Liệt Nhật', tColor: '#3a1500', aColor: '#7a3000', bg(c, W, H) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ffcf3a'); g.addColorStop(.5, '#ff8a1e'); g.addColorStop(1, '#e5401e'); c.fillStyle = g; c.fillRect(0, 0, W, H); const r = c.createRadialGradient(W * .5, H * .26, 10, W * .5, H * .26, W * .55); r.addColorStop(0, 'rgba(255,255,220,.55)'); r.addColorStop(1, 'rgba(255,255,220,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(120,48,0,.4)'; c.lineWidth = 2.5; c.strokeRect(26, 26, W - 52, H - 52); } },
  { id: 'steel', name: 'Thép Lạnh', tColor: '#eef2f6', aColor: '#9fb4c4', bg(c, W, H) { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2a3742'); g.addColorStop(1, '#0d151c'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(150,180,200,.12)'; c.lineWidth = 1; for (let i = 1; i < 9; i++) { c.beginPath(); c.moveTo(0, i * H / 9); c.lineTo(W, i * H / 9); c.stroke(); } c.strokeStyle = 'rgba(180,205,225,.5)'; c.lineWidth = 2; c.strokeRect(26, 26, W - 52, H - 52); } },
  { id: 'mobgold', name: 'Bố Già', tColor: '#f2d98a', aColor: '#bd9a44', bg(c, W, H) { c.fillStyle = '#080705'; c.fillRect(0, 0, W, H); const r = c.createRadialGradient(W * .5, H * .24, 8, W * .5, H * .24, W * .72); r.addColorStop(0, 'rgba(200,160,70,.26)'); r.addColorStop(1, 'rgba(200,160,70,0)'); c.fillStyle = r; c.fillRect(0, 0, W, H); c.strokeStyle = '#bd9a44'; c.lineWidth = 3; c.strokeRect(22, 22, W - 44, H - 44); c.strokeStyle = 'rgba(189,154,68,.5)'; c.lineWidth = 1; c.strokeRect(32, 32, W - 64, H - 64); } },
  { id: 'noir', name: 'Bóng Đêm', tColor: '#f0f0f0', aColor: '#999999', bg(c, W, H) { c.fillStyle = '#0a0a0c'; c.fillRect(0, 0, W, H); const g = c.createLinearGradient(W * .2, 0, W * .8, H); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2; c.strokeRect(26, 26, W - 52, H - 52); } },
];
function wrapCN(c, text, maxW) { const lines = []; let cur = ''; for (const ch of text) { if (c.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch; } if (cur) lines.push(cur); return lines; }
let coverBgImg = null;   // 已加载的 AI 底图（HTMLImageElement）
// 把图片按 cover 方式填满 600×800（裁掉溢出），再压一层上深下浅渐变保证书名清晰
function drawAiBg(c, W, H) {
  const iw = coverBgImg.naturalWidth, ih = coverBgImg.naturalHeight;
  const s = Math.max(W / iw, H / ih), dw = iw * s, dh = ih * s;
  c.drawImage(coverBgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(.32, 'rgba(0,0,0,.15)');
  g.addColorStop(.7, 'rgba(0,0,0,.15)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 2; c.strokeRect(20, 20, W - 40, H - 40);
}
function drawCover() {
  const cv = $('#cvCanvas'); if (!cv) return; const c = cv.getContext('2d'); const W = 600, H = 800;
  const themeId = $('#cvTheme').value;
  c.clearRect(0, 0, W, H);
  if (themeId === 'ai' && coverBgImg) { drawAiBg(c, W, H); return drawCoverText(c, W, H, { tColor: '#fff', aColor: '#f0e6c8' }, true); }
  const theme = COVER_THEMES.find(t => t.id === themeId) || COVER_THEMES[0];
  theme.bg(c, W, H);
  drawCoverText(c, W, H, theme);
}
function drawCoverText(c, W, H, theme, shadow) {
  const title = ($('#cvTitle').value || 'Chưa Đặt Tên').trim();
  const author = ($('#cvAuthor').value || '').trim();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  if (shadow || theme === undefined) { c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = 14; c.shadowOffsetY = 3; }
  c.fillStyle = theme.tColor;
  let size = title.length <= 4 ? 100 : title.length <= 6 ? 80 : title.length <= 9 ? 62 : 50;
  c.font = `700 ${size}px "Noto Serif SC","Songti SC","SimSun",serif`;
  const lines = wrapCN(c, title, W - 120);
  let y = H * 0.30 - (lines.length - 1) * size * 0.6;
  for (const ln of lines) { c.fillText(ln, W / 2, y); y += size * 1.2; }
  if (author) { c.fillStyle = theme.aColor; c.font = `400 34px "Noto Serif SC","Songti SC",serif`; c.fillText(author, W / 2, H - 96); }
  c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
}
function loadCoverBg(url) {   // 加载 AI 底图，成功后切到 AI 主题并重绘
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => { coverBgImg = img; resolve(img); };
    img.onerror = () => reject(new Error('Tải ảnh nền thất bại')); img.src = url;
  });
}
async function openCover() {
  if (!CUR) return;
  coverBgImg = null;
  $('#cvTitle').value = CUR.title; $('#cvAuthor').value = CUR.author || '';
  $('#cvPrompt').value = '';
  const opts = COVER_THEMES.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  $('#cvTheme').innerHTML = `<option value="ai">🎨 Tranh vẽ AI</option>` + opts;
  $('#cvTheme').value = 'ink';
  $('#cvErr').textContent = ''; $('#coverModal').classList.remove('hidden');
  cvLoadChatProfiles();   // 填充 ChatGPT 账号下拉
  // 若书里已有 AI 底图，预加载并默认用它
  if (CUR.stats?.coverBg) {
    try { await loadCoverBg(`${API}/api/book/cover-bg?book=${encodeURIComponent(CUR.slug)}&t=${CUR.stats.coverBgMtime || 0}`); $('#cvTheme').value = 'ai'; } catch { }
  }
  drawCover();
}
$('#btnCover').addEventListener('click', openCover);
['cvTitle', 'cvAuthor'].forEach(id => $('#' + id).addEventListener('input', drawCover));
$('#cvTheme').addEventListener('change', drawCover);
$('#cvGenAI').addEventListener('click', async () => {
  if (!CUR) return;
  const btn = $('#cvGenAI'); btn.disabled = true; const old = btn.textContent; btn.textContent = '🎨 Đang tạo ảnh… (~10-20 giây)'; $('#cvErr').textContent = '';
  try {
    const r = await api('/api/book/gen-cover-bg', 'POST', { book: CUR.slug, prompt: $('#cvPrompt').value.trim() || undefined });
    await loadCoverBg(API + r.url);
    $('#cvTheme').value = 'ai'; drawCover();
    if (r.prompt && !$('#cvPrompt').value.trim()) $('#cvPrompt').value = r.prompt;
    toast('Ảnh bìa AI đã tạo thành công!');
  } catch (e) {
    const local = STATE.config?.image?.backend === 'local';
    $('#cvErr').textContent = 'Tạo thất bại: ' + e.message
      + (local ? '(Tạo ảnh cục bộ: Hãy đảm bảo ComfyUI hoặc SD WebUI đang chạy)'
        : '(Imagen: Cần điền Gemini Key trong Cài đặt và bật proxy)');
  }
  finally { btn.disabled = false; btn.textContent = old; }
});
// ===== ChatGPT 网页版生成封面（免费·慢：后台跑 + 轮询状态）=====
async function cvLoadChatProfiles() {
  const sel = $('#cvChatProfile'); if (!sel) return;
  try {
    if (!WEB_PROFILES) { const r = await api('/api/unzoo/profiles', 'POST', {}); WEB_PROFILES = r.profiles || []; }
    const remembered = (CUR && localStorage.getItem(webProfileKey(CUR.slug))) || (CUR?.publish || {}).profilePath || '';
    if (!WEB_PROFILES.length) { sel.innerHTML = '<option value="">(Chưa phát hiện tài khoản Unzoo, vui lòng đăng nhập ChatGPT)</option>'; return; }
    sel.innerHTML = WEB_PROFILES.map(p => {
      const tag = p.running ? '○ Đang chạy' : '· Chưa mở';
      const label = p.dir && p.dir !== p.name ? `${p.name} · ${p.dir}` : p.name;
      return `<option value="${esc(p.path)}"${p.path === remembered ? ' selected' : ''}>${esc(label)}（${tag}）</option>`;
    }).join('');
  } catch (e) { sel.innerHTML = '<option value="">(Lấy danh sách tài khoản thất bại: ' + esc(e.message) + ')</option>'; }
}
let cvChatPoll = null;
$('#cvGenChatGPT').addEventListener('click', async () => {
  if (!CUR) return;
  const profilePath = $('#cvChatProfile').value;
  if (!profilePath) { $('#cvErr').textContent = 'Vui lòng chọn tài khoản ChatGPT đã đăng nhập'; return; }
  localStorage.setItem(webProfileKey(CUR.slug), profilePath);
  const btn = $('#cvGenChatGPT'); btn.disabled = true; const old = btn.textContent;
  $('#cvErr').textContent = '';
  const hint = $('#cvChatHint'); const hintOld = hint.textContent;
  try {
    await api('/api/book/gen-cover-chatgpt', 'POST', { book: CUR.slug, profilePath, prompt: $('#cvPrompt').value.trim() || undefined });
    btn.textContent = '🖼️ ChatGPT đang vẽ tranh bìa… (~2-4 phút)';
    if (cvChatPoll) clearInterval(cvChatPoll);
    cvChatPoll = setInterval(async () => {
      try {
        const s = await api('/api/book/gen-cover-status', 'POST', { book: CUR.slug });
        if (s.msg) hint.textContent = '⏳ ' + s.msg;
        if (s.status === 'done') {
          clearInterval(cvChatPoll); cvChatPoll = null;
          await loadCoverBg(API + s.url + '&r=' + Date.now());
          $('#cvTheme').value = 'ai'; drawCover();
          if (s.prompt && !$('#cvPrompt').value.trim()) $('#cvPrompt').value = s.prompt;
          hint.textContent = hintOld; btn.disabled = false; btn.textContent = old;
          toast('Ảnh bìa ChatGPT đã tạo thành công');
        } else if (s.status === 'error') {
          clearInterval(cvChatPoll); cvChatPoll = null;
          $('#cvErr').textContent = 'Tạo ảnh bìa qua ChatGPT thất bại: ' + (s.error || 'Không rõ');
          hint.textContent = hintOld; btn.disabled = false; btn.textContent = old;
        }
      } catch { }
    }, 6000);
  } catch (e) {
    $('#cvErr').textContent = 'Khởi động thất bại: ' + e.message;
    hint.textContent = hintOld; btn.disabled = false; btn.textContent = old;
  }
});
// 📥 抓取封面：图已在 ChatGPT 页生成好、但自动流程超时/没拿到时，手动从当前页把图抓下来（快）。
$('#cvGrabChatGPT')?.addEventListener('click', async () => {
  if (!CUR) return;
  const profilePath = $('#cvChatProfile').value;
  if (!profilePath) { $('#cvErr').textContent = 'Vui lòng chọn tài khoản ChatGPT đã đăng nhập'; return; }
  localStorage.setItem(webProfileKey(CUR.slug), profilePath);
  const btn = $('#cvGrabChatGPT'); btn.disabled = true; const old = btn.textContent;
  $('#cvErr').textContent = '';
  const hint = $('#cvChatHint'); const hintOld = hint.textContent;
  try {
    await api('/api/book/grab-cover-chatgpt', 'POST', { book: CUR.slug, profilePath });
    btn.textContent = '📥 Đang lấy ảnh…';
    if (cvChatPoll) clearInterval(cvChatPoll);
    cvChatPoll = setInterval(async () => {
      try {
        const s = await api('/api/book/gen-cover-status', 'POST', { book: CUR.slug });
        if (s.msg) hint.textContent = '⏳ ' + s.msg;
        if (s.status === 'done') {
          clearInterval(cvChatPoll); cvChatPoll = null;
          await loadCoverBg(API + s.url + '&r=' + Date.now());
          $('#cvTheme').value = 'ai'; drawCover();
          hint.textContent = hintOld; btn.disabled = false; btn.textContent = old;
          toast('Đã lấy ảnh bìa ChatGPT thành công');
        } else if (s.status === 'error') {
          clearInterval(cvChatPoll); cvChatPoll = null;
          $('#cvErr').textContent = 'Lấy ảnh thất bại: ' + (s.error || 'Không rõ');
          hint.textContent = hintOld; btn.disabled = false; btn.textContent = old;
        }
      } catch { }
    }, 2500);
  } catch (e) {
    $('#cvErr').textContent = 'Khởi động thất bại: ' + e.message;
    hint.textContent = hintOld; btn.disabled = false; btn.textContent = old;
  }
});
// ===== 更换番茄封面（把 cover.png 推到番茄；开关：全自动提交 / 停在待提交）=====
let cvFqPoll = null;
$('#cvPushFanqie')?.addEventListener('click', async () => {
  if (!CUR) return;
  const auto = $('#cvFqAuto').checked;
  if (auto && !confirm('Cập nhật tự động sẽ đổi ảnh bìa trên nền tảng. Bạn có chắc chắn không?')) return;
  const btn = $('#cvPushFanqie'); btn.disabled = true; const old = btn.textContent;
  $('#cvErr').textContent = ''; const hint = $('#cvFqHint'); const hintOld = hint.innerHTML;
  try {
    await api('/api/book/push-fanqie-cover', 'POST', { book: CUR.slug, autoSubmit: auto });
    btn.textContent = '⬆️ Đang tải lên…';
    if (cvFqPoll) clearInterval(cvFqPoll);
    cvFqPoll = setInterval(async () => {
      try {
        const s = await api('/api/book/push-fanqie-cover-status', 'POST', { book: CUR.slug });
        if (s.msg) hint.textContent = '⏳ ' + s.msg;
        if (s.status === 'done') {
          clearInterval(cvFqPoll); cvFqPoll = null; btn.disabled = false; btn.textContent = old;
          if (s.semiManual) {
            $('#cvErr').textContent = '';
            hint.innerHTML = '⚠️ ' + esc(s.msg || '').replace(/\n/g, '<br>');
            toast('Đã mở trang tải ảnh, vui lòng chọn file trên trình duyệt');
          } else {
            hint.innerHTML = hintOld;
            toast(s.submitted ? '✅ Ảnh bìa nền tảng đã cập nhật' : 'Ảnh bìa đã tải lên, vui lòng xác nhận trên trình duyệt');
          }
        } else if (s.status === 'error') {
          clearInterval(cvFqPoll); cvFqPoll = null; btn.disabled = false; btn.textContent = old; hint.innerHTML = hintOld;
          $('#cvErr').textContent = 'Đổi ảnh bìa thất bại: ' + (s.error || 'Không rõ');
        }
      } catch { }
    }, 4000);
  } catch (e) { $('#cvErr').textContent = e.message; toast('Đổi ảnh bìa: ' + e.message); btn.disabled = false; btn.textContent = old; }
});
$('#cvClose').addEventListener('click', () => { if (cvChatPoll) { clearInterval(cvChatPoll); cvChatPoll = null; } if (cvFqPoll) { clearInterval(cvFqPoll); cvFqPoll = null; } $('#coverModal').classList.add('hidden'); });
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#coverModal').addEventListener('click', (e) => { if (e.target === $('#coverModal')) $('#coverModal').classList.add('hidden'); });
$('#cvDownload').addEventListener('click', async () => {
  try {
    const dataUrl = $('#cvCanvas').toDataURL('image/png');
    if (IS_TAURI && CUR) {
      const r = await api('/api/book/export-cover', 'POST', { book: CUR.slug, dataUrl });
      toast('Đã xuất vào thư mục Downloads: ' + r.path);
    } else {
      const a = document.createElement('a'); a.download = ($('#cvTitle').value || 'cover') + '_bia.png'; a.href = dataUrl; a.click();
    }
  } catch (e) { $('#cvErr').textContent = e.message; }
});
// ===== 书名实验生成器：批量出候选书名 + 每个一张不同画面封面 =====
let neCurBook = null, nePoll = null, neManifest = null;
function openNameExp(book) {
  neCurBook = book;
  $('#neBookTitle').textContent = book.title;
  $('#neErr').textContent = ''; $('#neHint').textContent = ''; $('#neGrid').innerHTML = ''; $('#neGen').disabled = false;
  $('#nameExpModal').classList.remove('hidden');
  api('/api/book/name-experiment-status', 'POST', { book: book.slug }).then(s => {
    if (s.manifest && s.manifest.items) neRender(s.manifest);
    if (s.status === 'running') { $('#neHint').textContent = '⏳ Đang tạo…'; $('#neGen').disabled = true; neStartPoll(); }
  }).catch(() => { });
}
function neRender(manifest) {
  neManifest = manifest;
  const items = (manifest && manifest.items) || [];
  if (!items.length) { $('#neGrid').innerHTML = ''; return; }
  // 底图是【Không có字画面】(Imagen 被要求 no text，AI 出的字会糊)，所以每张封面的书名跟主封面一样【客户端 canvas 叠上去】
  $('#neGrid').innerHTML = items.map((it, i) => `
    <div class="ne-card">
      ${it.bg ? `<canvas class="ne-cover" width="600" height="800" data-i="${i}"></canvas>` : '<div class="ne-noimg">Tạo bìa thất bại</div>'}
      <div class="ne-title" title="Bấm để sao chép">${esc(it.title)}</div>
      <div class="ne-hook">${esc(it.hook || '')}</div>
    </div>`).join('');
  $('#neGrid').querySelectorAll('canvas.ne-cover').forEach(cv => {
    const it = items[+cv.getAttribute('data-i')];
    const url = `${API}/api/book/exp-image?book=${encodeURIComponent(neCurBook.slug)}&file=${encodeURIComponent(it.bg)}&t=${manifest.generatedAt || ''}`;
    neDrawCover(cv, url, it.title).catch(() => { });
  });
  $('#neGrid').querySelectorAll('.ne-title').forEach((el, i) => el.addEventListener('click', () => { try { navigator.clipboard.writeText(items[i].title); toast('Đã sao chép tên truyện: ' + items[i].title); } catch { } }));
}
// Không có字底图 + 书名 → 画布（同主封面 drawAiBg+drawCoverText：cover 填满 600×800 + 上下压暗 + 描边 + 居中标题）
function neDrawCover(canvas, bgUrl, title) {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = 600, H = 800, c = canvas.getContext('2d');
      const iw = img.naturalWidth, ih = img.naturalHeight, s = Math.max(W / iw, H / ih), dw = iw * s, dh = ih * s;
      c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(.32, 'rgba(0,0,0,.15)'); g.addColorStop(.7, 'rgba(0,0,0,.15)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 2; c.strokeRect(20, 20, W - 40, H - 40);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = 14; c.shadowOffsetY = 3;
      c.fillStyle = '#fff';
      const t = (title || 'Chưa Đặt Tên').trim();
      const size = t.length <= 4 ? 100 : t.length <= 6 ? 80 : t.length <= 9 ? 62 : 50;
      c.font = `700 ${size}px "Noto Serif SC","Songti SC","SimSun",serif`;
      const lines = wrapCN(c, t, W - 120);
      let y = H * 0.30 - (lines.length - 1) * size * 0.6;
      for (const ln of lines) { c.fillText(ln, W / 2, y); y += size * 1.2; }
      c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Tải ảnh nền thất bại'));
    img.src = bgUrl;
  });
}
function neStartPoll() {
  if (nePoll) clearInterval(nePoll);
  nePoll = setInterval(async () => {
    try {
      const s = await api('/api/book/name-experiment-status', 'POST', { book: neCurBook.slug });
      if (s.msg && s.status === 'running') $('#neHint').textContent = '⏳ ' + s.msg;
      if (s.status === 'done') { clearInterval(nePoll); nePoll = null; $('#neHint').textContent = '✅ Đã tạo xong, bấm vào tên truyện để sao chép'; $('#neGen').disabled = false; if (s.manifest) neRender(s.manifest); }
      else if (s.status === 'error') { clearInterval(nePoll); nePoll = null; $('#neHint').textContent = ''; $('#neErr').textContent = 'Tạo thất bại: ' + (s.error || ''); $('#neGen').disabled = false; }
    } catch { }
  }, 3000);
}
$('#neGen')?.addEventListener('click', async () => {
  if (!neCurBook) return;
  const count = Math.max(2, Math.min(10, Number($('#neCount').value) || 6));
  $('#neErr').textContent = ''; $('#neGen').disabled = true;
  $('#neHint').textContent = `⏳ Đang tạo ${count} tên truyện & ảnh bìa (~${count * 15} giây, vui lòng không đóng popup)…`;
  try { await api('/api/book/name-experiment', 'POST', { book: neCurBook.slug, count }); neStartPoll(); }
  catch (e) { $('#neErr').textContent = e.message; $('#neGen').disabled = false; }
});
$('#neClose')?.addEventListener('click', () => { if (nePoll) { clearInterval(nePoll); nePoll = null; } if (nePushPoll) { clearInterval(nePushPoll); nePushPoll = null; } $('#nameExpModal').classList.add('hidden'); });
// 🚀 推到番茄：把候选书名+封面推到番茄「多书名实验·实验配置」（设置别名）
let nePushPoll = null;
$('#nePush')?.addEventListener('click', async () => {
  if (!neCurBook) return;
  const autoSubmit = !!$('#nePushAuto')?.checked;
  if (autoSubmit && !confirm('Bật thử nghiệm tiêu đề trên nền tảng? Thao tác này không thể hoàn tác. Bạn có chắc chắn không?')) return;
  $('#neErr').textContent = ''; $('#nePush').disabled = true;
  try {
    // 先把【叠好书名】的封面(画布)存成 titled 图，让推到番茄的封面带书名(不是Không có字底图)
    $('#neHint').textContent = '⏳ Đang ghép tên sách vào ảnh bìa…';
    await neBakeTitledCovers();
    $('#neHint').textContent = '⏳ Đang đồng bộ ảnh bìa và tiêu đề lên nền tảng…';
    const r = await api('/api/book/push-name-experiment', 'POST', { book: neCurBook.slug, autoSubmit });
    if (r.already) { $('#neHint').textContent = '⏳ Đang trong quá trình đẩy lên…'; }
    nePushStartPoll();
  } catch (e) { $('#neErr').textContent = e.message; $('#nePush').disabled = false; $('#neHint').textContent = ''; }
});
// 把网格里每张【已叠书名】的画布存回 experiment/NN.titled.png（推番茄时优先用它，封面才带书名）
async function neBakeTitledCovers() {
  const canvases = [...($('#neGrid').querySelectorAll('canvas.ne-cover') || [])];
  const items = (neManifest && neManifest.items) || [];
  for (const cv of canvases) {
    const it = items[+cv.getAttribute('data-i')]; if (!it || !it.bg) continue;
    let dataUrl; try { dataUrl = cv.toDataURL('image/png'); } catch { continue; }   // 画布被污染就跳过(退回Không có字底图)
    const file = it.bg.replace(/\.png$/i, '') + '.titled.png';
    try { await api('/api/book/exp-cover-save', 'POST', { book: neCurBook.slug, file, dataUrl }); } catch { }
  }
}
function nePushStartPoll() {
  if (nePushPoll) clearInterval(nePushPoll);
  nePushPoll = setInterval(async () => {
    try {
      const s = await api('/api/book/push-name-experiment-status', 'POST', { book: neCurBook.slug });
      if (s.msg && s.status === 'running') $('#neHint').textContent = '⏳ ' + s.msg;
      if (s.status === 'done') { clearInterval(nePushPoll); nePushPoll = null; $('#nePush').disabled = false; $('#neHint').textContent = (s.submitted ? '✅ ' : '📝 ') + (s.msg || 'Hoàn thành'); if (s.msg) toast(s.msg.split('\n')[0]); }
      else if (s.status === 'error') { clearInterval(nePushPoll); nePushPoll = null; $('#nePush').disabled = false; $('#neHint').textContent = ''; $('#neErr').textContent = 'Đẩy lên nền tảng thất bại: ' + (s.error || ''); }
    } catch { }
  }, 2500);
}
$('#cvSave').addEventListener('click', async () => {
  if (!CUR) return; $('#cvSave').disabled = true; $('#cvErr').textContent = 'Đang lưu…';
  try { await api('/api/book/save-cover', 'POST', { book: CUR.slug, dataUrl: $('#cvCanvas').toDataURL('image/png') }); $('#coverModal').classList.add('hidden'); toast('Ảnh bìa đã lưu vào thư mục truyện (cover.png)'); }
  catch (e) { $('#cvErr').textContent = 'Thất bại: ' + e.message; } finally { $('#cvSave').disabled = false; }
});

$('#btnSend').addEventListener('click', sendInstr);
$('#sendInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendInstr(); });
async function sendInstr() {
  const v = $('#sendInput').value.trim(); if (!v || !CUR) return;
  const btn = $('#btnSend'); btn.disabled = true;
  try {
    const r = await api('/api/send', 'POST', { book: CUR.slug, task: v, model: $('#writeModel').value });
    $('#sendInput').value = '';
    if (r.mode === 'switched') { setWriting(true); openStream(CUR.slug); toast(`Đã chuyển sang ${modelName(r.model)} → Đóng phiên cũ và mở phiên mới để viết tiếp`); }
    else if (r.mode === 'resumed') { setWriting(true); openStream(CUR.slug); toast('Phiên làm việc đã khởi động lại để tiếp tục viết theo chỉ lệnh này'); }
    else toast('Đã gửi chỉ lệnh vào phiên làm việc');
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
}

// ---------- SSE Màn hình tương tác & Nhật ký ----------
function openStream(slug) {
  closeStream();
  STREAM = new EventSource(`${API}/api/stream?book=${encodeURIComponent(slug)}`);
  STREAM.addEventListener('screen', e => {
    const m = $('#mirror'); const atBottom = m.scrollTop + m.clientHeight >= m.scrollHeight - 30;
    m.textContent = JSON.parse(e.data).text || '';
    if (atBottom) m.scrollTop = m.scrollHeight;
  });
  STREAM.addEventListener('log', e => appendLog(JSON.parse(e.data)));
  STREAM.addEventListener('stopped', () => { STOP_DRAINING = false; $('#btnStop').textContent = '■ Dừng Lại'; setWriting(false); closeStream(); toast('Đợt hiện tại đã hoàn thành → Đã đóng phiên làm việc'); });
  STREAM.onerror = () => { };
}
function closeStream() { if (STREAM) { STREAM.close(); STREAM = null; } }
// ---------- Thanh tác vụ duyệt dàn ý / biên tập ----------
function hideReviewBar() { $('#reviewBar').classList.add('hidden'); }
async function showReviewBar() {
  if (!CUR) return;
  try {
    const p = await api('/api/book/pending?book=' + encodeURIComponent(CUR.slug));
    if (!p.pending) { hideReviewBar(); return; }
    const batch = p.kind === 'batch-review';
    if (batch) {
      // 逐批审核：本批写完，等用户批准/给要求/停止
      $('#rbTitle').textContent = `Đợt này đã viết xong, chờ bạn duyệt (${p.scope || ''})`;
      $('#rbFile').textContent = '';
      $('#rbCritique').textContent = 'Bạn có thể đọc nội dung đợt vừa viết ở màn hình bên phải hoặc trình đọc truyện. Nếu hài lòng hãy chọn "Duyệt & Tiếp tục", hoặc nhập định hướng để viết tiếp.';
      $('#rbReq').classList.remove('hidden');
      $('#rbActionsOutline').classList.add('hidden');
      $('#rbActionsBatch').classList.remove('hidden');
    } else {
      // 大纲审稿确认门 —— 逐条勾选
      const items = Array.isArray(p.items) ? p.items : [];
      $('#rbTitle').textContent = items.length ? `Tổng Biên Tập: ${items.length} ý kiến góp ý, bạn hãy lựa chọn (${p.scope || ''})` : `Ý kiến biên tập chờ xác nhận (${p.scope || ''})`;
      $('#rbFile').textContent = p.file ? ' · reviews/' + p.file : '';
      renderReviewItems(items);
      // 有分条 → 显示勾选列表、隐藏整段原文；没有分条 → 退回显示整段
      if (items.length) { $('#rbItems').classList.remove('hidden'); $('#rbCritique').classList.add('hidden'); }
      else { $('#rbItems').classList.add('hidden'); $('#rbCritique').classList.remove('hidden'); $('#rbCritique').textContent = p.critique || '(Chi tiết xem file trong mục reviews)'; }
      $('#rbReq').classList.add('hidden');
      $('#rbActionsBatch').classList.add('hidden');
      $('#rbActionsOutline').classList.remove('hidden');
    }
    $('#reviewBar').classList.remove('hidden');
  } catch { }
}
// 渲染可勾选的审稿意见（硬伤/隐患默认勾、建议默认不勾；文本可手改）
function renderReviewItems(items) {
  const box = $('#rbItems'); box.innerHTML = '';
  const badge = { 'Hạt sạn': 'crit', 'Điểm lưu ý': 'warn', 'Gợi ý': 'tip', 硬伤: 'crit', 隐患: 'warn', 建议: 'tip' };
  items.forEach((it, i) => {
    const on = it.severity !== '建议' && it.severity !== 'Gợi ý';   // 硬伤/隐患默认采纳
    const row = el('div', 'rb-item');
    row.innerHTML =
      `<label class="rb-chk"><input type="checkbox" ${on ? 'checked' : ''} data-i="${i}"/>` +
      `<span class="rb-sev ${badge[it.severity] || 'tip'}">${esc(it.severity === "硬伤" ? "Hạt sạn" : it.severity === "隐患" ? "Điểm lưu ý" : "Gợi ý")}</span></label>` +
      `<textarea class="rb-item-text" rows="2" data-i="${i}">${esc(it.text || '')}</textarea>`;
    box.appendChild(row);
  });
}
function collectSelectedItems() {
  const picked = [];
  $('#rbItems').querySelectorAll('.rb-item').forEach(row => {
    const cb = row.querySelector('input[type=checkbox]');
    const ta = row.querySelector('.rb-item-text');
    if (cb && cb.checked && ta && ta.value.trim()) picked.push({ text: ta.value.trim() });
  });
  return picked;
}
async function reviewDecision(apply) {
  if (!CUR) return;
  $('#rbApply').disabled = $('#rbSkip').disabled = true;
  try {
    const hasItems = !$('#rbItems').classList.contains('hidden');
    if (apply && hasItems) {
      const items = collectSelectedItems();
      if (!items.length) { toast('Vui lòng tích chọn ít nhất 1 ý kiến, hoặc bấm "Bỏ qua tất cả"'); return; }
      await api('/api/book/review-decision', 'POST', { book: CUR.slug, items });
      hideReviewBar(); toast(`Đã chọn ${items.length} góp ý → AI sẽ sửa theo các mục này`);
    } else if (apply) {
      await api('/api/book/review-decision', 'POST', { book: CUR.slug, apply: true });
      hideReviewBar(); toast('Đã tiếp thu toàn bộ → AI đang sửa đổi dàn ý');
    } else {
      // 跳过：有分条时明确传空 items，避免Bộ sinh ảnh误判
      await api('/api/book/review-decision', 'POST', hasItems ? { book: CUR.slug, items: [] } : { book: CUR.slug, apply: false });
      hideReviewBar(); toast('Đã bỏ qua → Giữ nguyên dàn ý và tiếp tục');
    }
  } catch (e) { toast(e.message); }
  finally { $('#rbApply').disabled = $('#rbSkip').disabled = false; }
}
$('#rbApply').addEventListener('click', () => reviewDecision(true));
$('#rbSkip').addEventListener('click', () => reviewDecision(false));
// 逐批审核裁决：批准继续 / 按要求继续 / 停止
async function batchContinue(withReq) {
  if (!CUR) return;
  const requirements = withReq ? $('#rbReq').value.trim() : '';
  if (withReq && !requirements) { toast('Vui lòng nhập yêu cầu của bạn cho đợt viết tiếp theo'); $('#rbReq').focus(); return; }
  const btns = ['#rbContinue', '#rbContinueReq', '#rbStop'].map(s => $(s));
  btns.forEach(b => b.disabled = true);
  try {
    await api('/api/book/review-continue', 'POST', { book: CUR.slug, requirements });
    $('#rbReq').value = ''; hideReviewBar();
    toast(requirements ? 'Đã gửi yêu cầu đợt này → Tiếp tục viết' : 'Đã duyệt → Tiếp tục viết đợt tiếp theo');
  } catch (e) { toast(e.message); }
  finally { btns.forEach(b => b.disabled = false); }
}
async function batchStop() {
  if (!CUR) return;
  const btns = ['#rbContinue', '#rbContinueReq', '#rbStop'].map(s => $(s));
  btns.forEach(b => b.disabled = true);
  try {
    await api('/api/book/review-continue', 'POST', { book: CUR.slug, stop: true });
    hideReviewBar(); setWriting(false); closeStream();
    toast('Đã dừng → Kết thúc phiên làm việc');
  } catch (e) { toast(e.message); }
  finally { btns.forEach(b => b.disabled = false); }
}
$('#rbContinue').addEventListener('click', () => batchContinue(false));
$('#rbContinueReq').addEventListener('click', () => batchContinue(true));
$('#rbStop').addEventListener('click', batchStop);
function appendLog(e) {
  if (e.kind === 'pending-review' || e.kind === 'pending-batch') showReviewBar();   // 待确认/待审核 → 弹动作条
  const feed = $('#logFeed');
  const cls = 'log-line ' + (e.source === 'autopilot' ? 'autopilot ' : '') + (e.level || 'info');
  const tag = e.level === 'act' ? '●' : e.level === 'warn' ? '▲' : e.level === 'error' ? '✖' : '○';
  const line = el('div', cls, `<span class="tag">${tag}</span><span class="msg">${esc(e.msg)}</span>`);
  feed.appendChild(line);
  if (e.msg && /token/i.test(e.msg)) { }
  feed.scrollTop = feed.scrollHeight;
  while (feed.childNodes.length > 400) feed.removeChild(feed.firstChild);
  // 顺带刷新 token 徽章
  if (CUR) api('/api/usage').then(u => { const t = u.books?.[CUR.slug]?.total; if (t) $('#writeTokens').textContent = 'tokens ' + fmtTok(t); }).catch(() => { });
}

// ---------- 阅读 / 工作台 ----------
let RD_BOOK = null, RD_REL = null, RD_RAW = '';
function mdInline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>'); }
function mdToHtml(md) {
  const lines = String(md || '').split(/\r?\n/); let html = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = l.split('|').slice(1, -1).map(c => c.trim()); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i].split('|').slice(1, -1).map(c => c.trim())); i++; }
      html += '<table><thead><tr>' + head.map(c => '<th>' + mdInline(c) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + mdInline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'; continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { html += '<h' + h[1].length + '>' + mdInline(h[2]) + '</h' + h[1].length + '>'; i++; continue; }
    if (/^\s*>\s?/.test(l)) { html += '<blockquote>' + mdInline(l.replace(/^\s*>\s?/, '')) + '</blockquote>'; i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push('<li>' + mdInline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>'); i++; } html += '<ul>' + items.join('') + '</ul>'; continue; }
    if (/^\s*---+\s*$/.test(l)) { html += '<hr>'; i++; continue; }
    if (l.trim() === '') { i++; continue; }
    html += '<p>' + mdInline(l) + '</p>'; i++;
  }
  return html;
}
function chapterToHtml(txt) { return String(txt || '').split(/\n\s*\n|\n/).filter(p => p.trim()).map(p => '<p>' + esc(p) + '</p>').join('') || '<div class="rd-empty">(Trống)</div>'; }

async function openReader(book) {
  RD_BOOK = book; RD_REL = null; RD_RAW = '';
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('#view-read').classList.remove('hidden');
  $('#rdTitle').textContent = '《' + book.title + '》';
  $('#rdFileName').textContent = 'Đang tải…'; $('#rdContent').innerHTML = '<div class="rd-empty">Đang tải…</div>'; $('#rdNav').innerHTML = '';
  exitEdit(); $('#rdEdit').classList.add('hidden');
  $('#rdRewrite') && $('#rdRewrite').classList.add('hidden');
  $('#rdAdopt') && $('#rdAdopt').classList.add('hidden');
  $('#rdDelete') && $('#rdDelete').classList.add('hidden');
  $('#rdDelReview') && $('#rdDelReview').classList.add('hidden');
  $('#rdDelReviewAll') && $('#rdDelReviewAll').classList.add('hidden');
  try {
    const t = await api('/api/book/files?book=' + encodeURIComponent(book.slug));
    renderReaderNav(t);
    const pg = t.progress || {};
    $('#rdProgress').textContent = `${pg.status || 'Đang Ra'} · Quyển ${pg.vol || '?'}${pg.totalVol ? '/' + pg.totalVol : ''} · ${pg.chapters || 0}${pg.target ? '/' + pg.target : ''} chương${pg.pct ? ' · ' + pg.pct + '%' : ''} · ${pg.kb || 0}KB${pg.dupCount ? ' · ⚠️ ' + pg.dupCount + ' chương trùng tên' : ''}`;
    $('#rdFileName').textContent = 'Chọn một file bên trái để đọc';
    $('#rdContent').innerHTML = '<div class="rd-empty">📖 Chọn Story Bible / Dàn Ý / Chương Truyện / Báo Cáo để xem</div>';
  } catch (e) { $('#rdContent').innerHTML = '<div class="rd-empty">Đọc dữ liệu thất bại: ' + esc(e.message) + '</div>'; }
}
function rdNavItem(rel, label, kb) { return `<a class="rd-item" data-rel="${esc(rel)}" title="${esc(label)}"><span class="rd-lbl">${esc(label)}</span><span class="rd-kb">${kb || 0}K</span></a>`; }
function renderReaderNav(t) {
  let h = '';
  if (t.dups?.length) {
    h += `<div class="rd-dup"><div class="rd-dup-t">⚠️ ${t.dups.length}  tên chương bị trùng lặp (Cần sửa thành duy nhất)</div>` +
      t.dups.map(d => `<div class="rd-dup-row"><b>${esc(d.name)}</b>${d.files.map(f => `<a class="rd-item dup" data-rel="${esc('chapters/' + f)}">${esc(f)}</a>`).join('')}</div>`).join('') +
      '</div>';
  }
  if (t.meta?.length) h += '<div class="rd-gtitle">Story Bible (Thiết Lập)</div>' + t.meta.map(m => rdNavItem(m.rel, m.label, m.kb)).join('');
  if (t.outlines?.length) h += '<div class="rd-gtitle">Dàn Ý Phân Quyển</div>' + t.outlines.map(o => rdNavItem(o.rel, o.name, o.kb)).join('');
  if (t.volumes?.length) {
    h += '<div class="rd-gtitle">Các Chương Truyện</div>';
    for (const v of t.volumes) h += `<details class="rd-vol"${t.volumes.length <= 2 ? ' open' : ''}><summary>${esc(v.vol)} (${v.chapters.length})</summary>${v.chapters.map(c => rdNavItem(c.rel, (c.num ? 'Chương ' + c.num + ': ' : '') + c.name, c.kb)).join('')}</details>`;
  }
  if (t.reviews?.length) h += '<div class="rd-gtitle">Báo Cáo Rà Soát & Thẩm Định</div>' + t.reviews.map(r => rdNavItem(r.rel, r.name, r.kb)).join('');
  $('#rdNav').innerHTML = h || '<div class="rd-empty">(Chưa có nội dung)</div>';
  $('#rdNav').querySelectorAll('[data-rel]').forEach(el => el.addEventListener('click', () => loadReaderFile(el.dataset.rel)));
}
async function loadReaderFile(rel) {
  RD_REL = rel; exitEdit();
  $('#rdNav').querySelectorAll('.rd-item').forEach(el => el.classList.toggle('active', el.dataset.rel === rel));
  $('#rdFileName').textContent = rel; $('#rdContent').innerHTML = '<div class="rd-empty">Đang tải…</div>';
  $('#rdEdit').classList.remove('hidden');
  // 只有【章节正文】能重写；设定圣经/大纲/审稿报告走「编辑」就行
  $('#rdRewrite') && $('#rdRewrite').classList.toggle('hidden', !rdIsChapter(rel));
  $('#rdAdopt') && $('#rdAdopt').classList.toggle('hidden', !rdIsChapter(rel));
  $('#rdDelete') && $('#rdDelete').classList.toggle('hidden', !rdIsChapter(rel));
  $('#rdDelReview') && $('#rdDelReview').classList.toggle('hidden', !rdIsReview(rel));
  $('#rdDelReviewAll') && $('#rdDelReviewAll').classList.toggle('hidden', !rdIsReview(rel));
  try {
    const r = await api('/api/book/read?book=' + encodeURIComponent(RD_BOOK.slug) + '&rel=' + encodeURIComponent(rel));
    RD_RAW = r.content || '';
    $('#rdContent').innerHTML = /\.md$/i.test(rel) ? mdToHtml(RD_RAW) : chapterToHtml(RD_RAW);
    $('#rdContent').scrollTop = 0;
  } catch (e) { $('#rdContent').innerHTML = '<div class="rd-empty">Đọc file thất bại: ' + esc(e.message) + '</div>'; }
}
function enterEdit() {
  if (!RD_REL) return;
  $('#rdEditor').value = RD_RAW;
  $('#rdEditor').classList.remove('hidden'); $('#rdContent').classList.add('hidden');
  $('#rdEdit').classList.add('hidden'); $('#rdSave').classList.remove('hidden'); $('#rdCancel').classList.remove('hidden');
  $('#rdRewrite') && $('#rdRewrite').classList.add('hidden');
}
function exitEdit() {
  $('#rdEditor').classList.add('hidden'); $('#rdContent').classList.remove('hidden');
  $('#rdEdit').classList.toggle('hidden', !RD_REL); $('#rdSave').classList.add('hidden'); $('#rdCancel').classList.add('hidden');
  $('#rdRewrite') && $('#rdRewrite').classList.toggle('hidden', !rdIsChapter(RD_REL));
  $('#rdAdopt') && $('#rdAdopt').classList.toggle('hidden', !rdIsChapter(RD_REL));
  $('#rdDelete') && $('#rdDelete').classList.toggle('hidden', !rdIsChapter(RD_REL));
  $('#rdDelReview') && $('#rdDelReview').classList.toggle('hidden', !rdIsReview(RD_REL));
  $('#rdDelReviewAll') && $('#rdDelReviewAll').classList.toggle('hidden', !rdIsReview(RD_REL));
}
$('#rdEdit').addEventListener('click', enterEdit);
$('#rdCancel').addEventListener('click', exitEdit);
$('#rdSave').addEventListener('click', async () => {
  if (!RD_BOOK || !RD_REL) return;
  const content = $('#rdEditor').value; $('#rdSave').disabled = true;
  try {
    await api('/api/book/save-file', 'POST', { book: RD_BOOK.slug, rel: RD_REL, content });
    RD_RAW = content;
    $('#rdContent').innerHTML = /\.md$/i.test(RD_REL) ? mdToHtml(content) : chapterToHtml(content);
    exitEdit(); toast('Đã lưu: ' + RD_REL);
  } catch (e) { toast('Lưu thất bại: ' + e.message); }
  finally { $('#rdSave').disabled = false; }
});
$('#rdBack').addEventListener('click', () => { showView('shelf'); refresh(); });
$('#rdToWrite').addEventListener('click', () => { if (RD_BOOK) openWrite(RD_BOOK); });
$('#rdRenumber').addEventListener('click', async () => {
  if (!RD_BOOK) return;
  if (!confirm('Đánh lại số thứ tự chương liên tục 001...N cho toàn bộ tác phẩm? Hệ thống sẽ tự động sao lưu trước khi thực hiện.')) return;
  $('#rdRenumber').disabled = true;
  try {
    const r = await api('/api/book/renumber', 'POST', { book: RD_BOOK.slug });
    toast(`Đã đánh lại số chương: ${r.chapters} chương liên tục (Bản lưu ${r.snapshot || '-'})`);
    openReader(RD_BOOK);   // 刷新
  } catch (e) { toast('Đánh lại số chương thất bại: ' + e.message); }
  finally { $('#rdRenumber').disabled = false; }
});
$('#btnReadFromWrite').addEventListener('click', () => { if (CUR) openReader(CUR); });
$('#btnRead').addEventListener('click', () => { if (CUR) openReader(CUR); });
// 打开阅读器并直接跳到某一章（rel）——共创/写作后"直接读刚写的这一章"用。
// ---------- Bước 2: Chọn mẫu văn phong ----------
// 【为什么放在建书里】没有范本时模型默认往书面语走（实测Không có范本 36.1 字/段、还整章半角逗号；
// 网文范本是 16.2）。等作者写完几章再回头挂范本就晚了——前面几章已经定了调，后面还得向它们看齐。
// 挑的是【一段真文字】而不是一个形容词标签：形容词进提示词就退化成"多用短句"这类废话，压不住任何东西。
let NB_VOICE = null;
let NB_VOICE_CANDS = [];
function nbVoiceReset() {
  NB_VOICE = null; NB_VOICE_CANDS = [];
  const box = $('#nbVoiceCands'); if (box) box.innerHTML = '';
  const tip = $('#nbVoicePick'); if (tip) tip.textContent = '';
}
function nbVoiceRender() {
  $('#nbVoiceCands').innerHTML = NB_VOICE_CANDS.map((c, i) => `
    <div class="nb-cand${NB_VOICE && NB_VOICE.name === c.name ? ' on' : ''}" data-pick="${i}">
      <div class="nb-cand-head"><b>${esc(c.name)}</b><span class="chip-tip">${esc(c.hint)}</span>
        <div class="grow"></div><span class="nb-cand-mark">${NB_VOICE && NB_VOICE.name === c.name ? '✓ Đã chọn' : 'Bấm để chọn'}</span></div>
      <div class="nb-cand-body">${esc(c.text)}</div>
    </div>`).join('');
  $('#nbVoiceCands').querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => {
    const c = NB_VOICE_CANDS[+el.dataset.pick];
    NB_VOICE = (NB_VOICE && NB_VOICE.name === c.name) ? null : { name: c.name, text: c.text };
    $('#nbVoicePick').textContent = NB_VOICE ? `Đã chọn 「${NB_VOICE.name}」 làm văn phong mẫu` : 'Chưa chọn mẫu (Có thể bắt đầu viết luôn)';
    nbVoiceRender();
  }));
}
$('#nbVoiceGen') && $('#nbVoiceGen').addEventListener('click', async () => {
  // 书名在第二步的 #nbFinalTitle（点候选或自己写都会填到它），不是第一步的 #nbTheme 输入框
  const title = $('#nbFinalTitle').value.trim();
  if (!title) { $('#nbErr2').textContent = 'Vui lòng đặt tên truyện trước để AI sáng tác đoạn mở đầu phù hợp'; return; }
  const b = $('#nbVoiceGen'); const old = b.textContent;
  b.disabled = true; b.textContent = 'Đang tạo 4 đoạn văn mẫu… (~1 phút)'; $('#nbErr2').textContent = '';
  try {
    const r = await api('/api/book/voice-boot', 'POST', {
      title, genre: $('#nbTheme') ? $('#nbTheme').value.trim() : '',
      synopsis: $('#nbSynopsis') ? $('#nbSynopsis').value.trim() : '',
      model: $('#nbModel').value, words: 700,
    });
    NB_VOICE_CANDS = r.candidates || [];
    nbVoiceRender();
    $('#nbVoicePick').textContent = 'Bấm vào đoạn bạn ưng ý, hoặc tạo lượt mới nếu muốn';
    b.textContent = 'Đổi 4 đoạn mẫu khác';
  } catch (e) { $('#nbErr2').textContent = 'Tạo thất bại: ' + e.message; b.textContent = old; }
  finally { b.disabled = false; }
});

// ---------- 文风范本：本书文风的唯一来源 ----------
// 程序不再内置任何"该怎么写"的规则（那等于把开发者的审美强加给每本书）。
// 风格锚定在具体文本上：范本原文 + 从范本提炼的手法卡。
let VC_CANDS = [];
async function vcRefresh() {
  const r = await api('/api/book/voice', 'POST', { book: CUR.slug });
  const refs = r.refs || [];
  $('#vcList').innerHTML = refs.length
    ? refs.map(x => `<div class="rd-dup-row" style="display:flex;align-items:center;gap:8px">
        <b style="flex:1">${esc(x.name)}</b><span class="rd-kb">${x.chars} chữ</span>
        <button class="btn ghost tiny" data-del="${esc(x.file)}">Xóa</button></div>`).join('')
    : '<div class="rd-empty">Chưa có văn mẫu —— AI sẽ tự do sáng tác theo phong cách mặc định.</div>';
  $('#vcList').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    await api('/api/book/voice-remove', 'POST', { book: CUR.slug, file: b.dataset.del });
    vcRefresh();
  }));
  $('#vcCardText').textContent = r.card || '(Chưa trích xuất thẻ kỹ thuật)';
}
function openVoice() {
  if (!CUR) return;
  $('#vcErr').textContent = ''; $('#vcName').value = ''; $('#vcText').value = '';
  $('#vcCands').innerHTML = ''; VC_CANDS = [];
  $('#voiceModal').classList.remove('hidden');
  vcRefresh().catch(e => { $('#vcErr').textContent = e.message; });
}
$('#btnVoice') && $('#btnVoice').addEventListener('click', openVoice);
$('#vcClose') && $('#vcClose').addEventListener('click', () => $('#voiceModal').classList.add('hidden'));

$('#vcAdd') && $('#vcAdd').addEventListener('click', async () => {
  const text = $('#vcText').value.trim();
  if (!text) { $('#vcErr').textContent = 'Nội dung đang trống'; return; }
  $('#vcErr').textContent = '';
  try {
    await api('/api/book/voice-add', 'POST', { book: CUR.slug, name: $('#vcName').value.trim() || 'Văn mẫu', text });
    $('#vcName').value = ''; $('#vcText').value = '';
    await vcRefresh(); toast('Đã lưu văn phong mẫu thành công');
  } catch (e) { $('#vcErr').textContent = e.message; }
});

$('#vcBoot') && $('#vcBoot').addEventListener('click', async () => {
  const b = $('#vcBoot'); const old = b.textContent;
  b.disabled = true; b.textContent = 'Đang tạo… (~1 phút)'; $('#vcErr').textContent = '';
  try {
    const r = await api('/api/book/voice-boot', 'POST', { book: CUR.slug, words: 600 });
    VC_CANDS = r.candidates || [];
    $('#vcCands').innerHTML = VC_CANDS.map((c, i) => `
      <div style="border:1px solid var(--border,#333);border-radius:8px;padding:8px 10px;margin:8px 0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <b>${esc(c.name)}</b><span class="chip-tip">${esc(c.hint)}</span>
          <div class="grow"></div>
          <button class="btn primary tiny" data-adopt="${i}">Chọn mẫu này</button>
        </div>
        <div style="white-space:pre-wrap;font-size:13px;max-height:200px;overflow:auto;opacity:.9">${esc(c.text)}</div>
      </div>`).join('');
    $('#vcCands').querySelectorAll('[data-adopt]').forEach(btn => btn.addEventListener('click', async () => {
      await api('/api/book/voice-boot-adopt', 'POST', { book: CUR.slug, candidate: VC_CANDS[+btn.dataset.adopt] });
      await vcRefresh(); toast('Đã đặt làm văn phong mẫu cho tác phẩm');
    }));
  } catch (e) { $('#vcErr').textContent = e.message; }
  finally { b.disabled = false; b.textContent = old; }
});

$('#vcCard') && $('#vcCard').addEventListener('click', async () => {
  const b = $('#vcCard'); const old = b.textContent;
  b.disabled = true; b.textContent = 'Đang đúc kết…'; $('#vcErr').textContent = '';
  try {
    const r = await api('/api/book/voice-card', 'POST', { book: CUR.slug });
    $('#vcCardText').textContent = r.card || '';
    toast('Đã cập nhật thẻ kỹ thuật viết');
  } catch (e) { $('#vcErr').textContent = e.message; }
  finally { b.disabled = false; b.textContent = old; }
});

// ---------- 单章重写：换模型 / 改章名 / 重新给情节 ----------
// 放在阅读页：作者读到哪一章不满意，当场就能重写那一章，不用回写作台绕一圈。
const rdIsChapter = (rel) => /^chapters\//.test(rel || '') && /\.txt$/i.test(rel || '');
// 自检/审稿：reviews/ 下的 .md/.txt。它们不只是产物——contextpack 会把【最近一份】
// 里的未决项回喂进写作提示词，所以跑偏的那份必须能删掉，否则会一直影响后面每一批。
const rdIsReview = (rel) => /^reviews\/[^/]+\.(md|txt)$/i.test(rel || '');

let CRAFT_OPTS = null;
async function loadCraftOpts() {
  if (CRAFT_OPTS) return CRAFT_OPTS;
  try { CRAFT_OPTS = await api('/api/craft-options', 'POST', {}); } catch { CRAFT_OPTS = { slants: [], romance: [] }; }
  return CRAFT_OPTS;
}
function crRenderOptions(o) {
  $('#crSlants').innerHTML = (o.slants || []).map(sl =>
    `<label class="chip" title="${esc(sl.tip || '')}"><input type="checkbox" value="${esc(sl.id)}">`
    + `<span>${esc(sl.name)}</span><span class="chip-tip">${esc(sl.tip || '')}</span></label>`).join('');
  // 点了就高亮，一眼看得出选了几项
  $('#crSlants').querySelectorAll('.chip input').forEach(cb => {
    cb.addEventListener('change', () => cb.closest('.chip').classList.toggle('on', cb.checked));
  });
  $('#crRomance').innerHTML = '<option value="">(Dùng mức mặc định của truyện)</option>'
    + (o.romance || []).map(r => `<option value="${esc(r.id)}">${esc(r.name)} — ${esc(r.short)}</option>`).join('');
}
const crPickedSlants = () =>
  [...$('#crSlants').querySelectorAll('.chip input:checked')].map(cb => cb.value).join(',');

function crSyncTip() {
  const id = $('#crModel').value;
  const m = (STATE.models || []).find(x => x.id === id);
  const tip = $('#crModelTip');
  if (!tip) return;
  tip.textContent = id === 'api-local'
    ? 'Mô hình Local miễn phí (~3–6 phút/chương). Nếu muốn chất lượng cao nhất hãy chọn Gemini High / Claude.'
    : (m && m.kind === 'api') ? 'Kết nối API trực tiếp, chạy ngầm ~1–3 phút.'
      : 'Chạy qua CLI ngầm, ~1–8 phút.';
}

function openChapterRewrite() {
  if (!RD_BOOK || !rdIsChapter(RD_REL)) return;
  const base = RD_REL.split('/').pop().replace(/\.txt$/i, '');
  const num = (base.match(/^(\d{1,4})/) || [])[1] || '?';
  const title = base.replace(/^\d{1,4}/, '');
  $('#crWhich').innerHTML = `Đang viết lại: <b>Chương ${num}: 《${esc(title)}》</b>`;
  // 模型下拉：CLI + API（含本地）都能重写——重写本质就是"喂 prompt 拿正文"
  const avail = (STATE.models || []).filter(m => (CW_MODELS.includes(m.id) || m.kind === 'api') && m.available);
  const prefer = CW_MODELS.find(id => avail.some(m => m.id === id)) || (avail[0] || {}).id;
  $('#crModel').innerHTML = avail.map(m => `<option value="${m.id}" ${m.id === prefer ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  $('#crModel').onchange = crSyncTip; crSyncTip();
  $('#crTitle').value = ''; $('#crPlot').value = ''; $('#crNote').value = '';
  $('#crTitleMode').value = 'keep'; $('#crTitleWrap').classList.add('hidden');
  $('#crPolish').checked = false; $('#crPolish').closest('.chip').classList.remove('on');
  $('#crCriticWrap').classList.add('hidden');
  // 挑刺模型下拉：跟主模型同一批候选，默认留空=用同一个模型（但会提示换一个更好）
  const cav = (STATE.models || []).filter(m => (CW_MODELS.includes(m.id) || m.kind === 'api') && m.available);
  $('#crCritic').innerHTML = '<option value="">(Dùng cùng một mô hình AI)</option>'
    + cav.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  loadCraftOpts().then(crRenderOptions);
  $('#crErr').textContent = ''; $('#crStatus').textContent = '';
  $('#crGo').disabled = false;
  $('#chRewriteModal').classList.remove('hidden');
  // 已有重写在后台跑 → 直接进等待态并接上轮询，别让用户重复提交
  api('/api/book/rewrite-chapter-status', 'POST', { book: RD_BOOK.slug }).then((s) => {
    if (s && s.status === 'running') {
      $('#crGo').disabled = true;
      $('#crStatus').textContent = '⏳ ' + (s.msg || 'Lượt viết lại trước vẫn đang chạy…');
      crStartPoll(RD_BOOK);
    }
  }).catch(() => { });
}
// 删除本章。逐章把关的工作流里，不满意就删掉重来比在旧文上重写干净——
// 重写会被原文的结构锚住，删掉重生成才是真的从头再来。
$('#rdDelete') && $('#rdDelete').addEventListener('click', async () => {
  if (!RD_BOOK || !rdIsChapter(RD_REL)) return;
  const base = RD_REL.split('/').pop().replace(/\.txt$/i, '');
  if (!confirm(`Xóa 《${base}》?\nTác phẩm sẽ được sao lưu dự phòng vào .deleted/ trước khi xóa.`)) return;
  try {
    const r = await api('/api/book/delete-chapters', 'POST', { book: RD_BOOK.slug, rels: [RD_REL] });
    toast(`Đã xóa ${r.count} chương` + (r.snapshot ? ` (Bản lưu ${r.snapshot})` : ''));
    await openReader(RD_BOOK);          // 目录要刷新，被删的那章不该还在左侧列着
  } catch (e) { toast(e.message); }
});
// 删这一份自检 / 清空全部自检
async function rdDeleteReviews(all) {
  if (!RD_BOOK) return;
  if (!all && !rdIsReview(RD_REL)) return;
  const tip = all
    ? 'Xóa toàn bộ các báo cáo tự kiểm và thẩm định trong thư mục reviews/?' : `Xóa 《${(RD_REL || '').split('/').pop()}》?`;
  if (!confirm(tip + '\n\nFile sẽ được sao lưu vào .deleted/.')) return;
  try {
    const r = await api('/api/book/delete-reviews', 'POST',
      all ? { book: RD_BOOK.slug, all: true } : { book: RD_BOOK.slug, rels: [RD_REL] });
    toast(`Đã xóa ${r.count} báo cáo tự kiểm`);
    await openReader(RD_BOOK);        // 左侧目录要刷新
  } catch (e) { toast(e.message); }
}
$('#rdDelReview') && $('#rdDelReview').addEventListener('click', () => rdDeleteReviews(false));
$('#rdDelReviewAll') && $('#rdDelReviewAll').addEventListener('click', () => rdDeleteReviews(true));
$('#rdRewrite') && $('#rdRewrite').addEventListener('click', openChapterRewrite);
// 这一章写得对味 → 设为范本。长期看这是最有价值的一条路：书越写越像它自己。
$('#rdAdopt') && $('#rdAdopt').addEventListener('click', async () => {
  if (!RD_BOOK || !rdIsChapter(RD_REL)) return;
  try {
    await api('/api/book/voice-adopt-chapter', 'POST', { book: RD_BOOK.slug, rel: RD_REL });
    toast('Đã đặt làm văn phong mẫu cho tác phẩm!');
  } catch (e) { toast(e.message); }
});
// 只有「我自己指定」才需要输入框，其余两种模式藏起来，别让人以为必须填
$('#crTitleMode') && $('#crTitleMode').addEventListener('change', () => {
  $('#crTitleWrap').classList.toggle('hidden', $('#crTitleMode').value !== 'manual');
});
$('#crPolish') && $('#crPolish').addEventListener('change', () => {
  const on = $('#crPolish').checked;
  $('#crPolish').closest('.chip').classList.toggle('on', on);
  $('#crCriticWrap').classList.toggle('hidden', !on);
});
// 关弹窗【只关界面，不停任务】——后台照写。轮询留着，写完照样 toast 并刷新目录。
$('#crClose') && $('#crClose').addEventListener('click', () => $('#chRewriteModal').classList.add('hidden'));
$('#crCancel') && $('#crCancel').addEventListener('click', () => $('#chRewriteModal').classList.add('hidden'));
// 重写在【后台】跑：起任务后立刻返回，前端轮询。关掉弹窗、切去别的页面都不会打断它——
// 之前做成同步请求，中途任何一环断掉（webview 超时/关弹窗/应用重启）整个活就白干且不留痕迹。
let crPoll = null;
function crStopPoll() { if (crPoll) { clearInterval(crPoll); crPoll = null; } }
function crStartPoll(book) {
  crStopPoll();
  crPoll = setInterval(async () => {
    let s;
    try { s = await api('/api/book/rewrite-chapter-status', 'POST', { book: book.slug }); }
    catch { return; }                       // 网络抖一下不算失败，下一拍再看
    if (s.status === 'running') { $('#crStatus').textContent = '⏳ ' + (s.msg || 'Đang viết lại…'); return; }
    crStopPoll();
    $('#crGo').disabled = false;
    if (s.status === 'done') {
      $('#chRewriteModal').classList.add('hidden');
      $('#crStatus').textContent = '';
      toast(`Chương ${s.num} đã viết lại (${s.before} → ${s.words} chữ)`); //

      try { await openReaderAt(book, s.rel); } catch { }   // 章名可能变了→刷新目录并停在新文件上
    } else if (s.status === 'error') {
      $('#crStatus').textContent = '';
      $('#crErr').textContent = s.error || 'Viết lại thất bại';
    }
  }, 3000);
}

$('#crGo') && $('#crGo').addEventListener('click', async () => {
  if (!RD_BOOK || !RD_REL) return;
  const book = RD_BOOK, model = $('#crModel').value;
  $('#crGo').disabled = true; $('#crErr').textContent = '';
  const pol = $('#crPolish').checked;
  $('#crStatus').textContent = '⏳ Đang viết lại…'
    + (model === 'api-local' ? ' (Local ~3–6 phút)' : ' (~1–8 phút)')
    + (pol ? ' + Trau chuốt 2 lượt.' : '')
    + ' Chạy ngầm trong hệ thống, đóng cửa sổ này không làm gián đoạn.';
  try {
    await api('/api/book/rewrite-chapter', 'POST', {
      book: book.slug, rel: RD_REL, model,
      titleMode: $('#crTitleMode').value, newTitle: $('#crTitle').value.trim(),
      plot: $('#crPlot').value.trim(), note: $('#crNote').value.trim(),
      slant: crPickedSlants(), romance: $('#crRomance').value || null,
      polish: $('#crPolish').checked, critic: $('#crCritic').value || '',
    });
    crStartPoll(book);                       // 起好了就开始轮询，不再占着这个请求
  } catch (e) {
    $('#crStatus').textContent = '';
    $('#crErr').textContent = e.message;
    $('#crGo').disabled = false;
  }
});

async function openReaderAt(book, rel) {
  await openReader(book);
  if (rel) { try { await loadReaderFile(rel); } catch { } }
}

// ---------- 删除书 ----------
let DEL_BOOK = null;
function openDelete(b) {
  DEL_BOOK = b;
  $('#dlName').textContent = '《' + b.title + '》　' + (b.stats?.chapters || 0) + ' Chương · ' + (b.stats?.kb || 0) + 'KB';
  $('#dlFiles').checked = false; $('#dlErr').textContent = '';
  $('#delModal').classList.remove('hidden');
}
$('#dlClose').addEventListener('click', () => $('#delModal').classList.add('hidden'));
$('#dlCancel').addEventListener('click', () => $('#delModal').classList.add('hidden'));
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] $('#delModal').addEventListener('click', (e) => { if (e.target === $('#delModal')) $('#delModal').classList.add('hidden'); });
$('#dlConfirm').addEventListener('click', async () => {
  if (!DEL_BOOK) return;
  $('#dlConfirm').disabled = true; $('#dlErr').textContent = 'Đang xóa…';
  try {
    const r = await api('/api/book/delete', 'POST', { book: DEL_BOOK.slug, deleteFiles: $('#dlFiles').checked });
    $('#delModal').classList.add('hidden');
    if (CUR && CUR.slug === DEL_BOOK.slug) showView('shelf');
    await refresh();
    toast('Đã xóa 《' + r.title + '》' + (r.filesDeleted ? ' (Xóa cả file trên đĩa)' : ' (Giữ lại file trên đĩa)'));
  } catch (e) { $('#dlErr').textContent = 'Thất bại: ' + e.message; }
  finally { $('#dlConfirm').disabled = false; }
});

// ---------- 新建书 · AI 立项 ----------
let NB_TITLES = [], NB_SEL = -1;
let NB_REF_STYLE = null;   // 对标分析出的 {name,rules}；有则立项前设为本书文风
let NB_PLAN_MODE = 'compass';
let NB_ROMANCE = 'warm';   // 感情线档位：none|light|warm|bold（建书表单，默认推荐档）   // compass=全书粗罗盘(默认) | freehand=探索式·只给手法(全书Không có大纲，情节作者逐段给)
// 开局架构切换：探索式时罗盘卷数Không có意义 → 置灰
(function initNbPlanSeg() {
  const rseg0 = document.getElementById('nbRomance');
  if (rseg0) rseg0.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    NB_ROMANCE = btn.dataset.rom || 'warm';
    rseg0.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b === btn));
    const h = document.getElementById('nbRomanceHint');
    const TXT = {
      none: '🚫 Không tuyến tình cảm: Thuần tu luyện, mưu lược hoặc hành động.',
      light: '🌤 Nhạt: Điểm xuyết nhẹ qua một vài chi tiết tinh tế.',
      warm: '💗 Mập mờ lôi cuốn (Khuyên dùng): Gợi cảm xúc tinh tế qua ánh mắt, cử chỉ và tình tiết ngập ngừng.',
      bold: '🔥 Nồng thắm: Tuyến tình cảm sâu đậm giữa các nhân vật trưởng thành.',
    };
    const RED = ' Nguyên tắc: Giữ văn phong tao nhã, lịch thiệp, không miêu tả dung tục.';
    if (h) h.innerHTML = (TXT[NB_ROMANCE] || '') + '<b>' + RED + '</b>';
  });
  const seg = document.getElementById('nbPlanMode'); if (!seg) return;
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    NB_PLAN_MODE = btn.dataset.plan === 'freehand' ? 'freehand' : 'compass';
    seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b === btn));
    const vc = document.getElementById('nbVolCount');
    if (vc) { vc.disabled = NB_PLAN_MODE === 'freehand'; vc.style.opacity = NB_PLAN_MODE === 'freehand' ? '.4' : ''; }
    const hint = document.getElementById('nbPlanHint');
    if (hint) hint.textContent = NB_PLAN_MODE === 'freehand'
      ? '🌱 Tự do khám phá: Story Bible chỉ lưu phương pháp viết + tên nhân vật chính + tóm tắt cốt truyện. Bạn đưa tình tiết từng đoạn, AI tự chia thành 3-5 chương để viết tiếp.' : 'Khuyên dùng La bàn định hướng: AI vạch chủ đề 1 câu cho mỗi quyển làm kim chỉ nam, sau đó cùng bạn lập dàn ý chi tiết từng quyển.';
  });
})();
// 目标字数：框里只填数字，单位固定"万字" → 拼成 "200万字"
function getWords() {
  const v = ($('#nbWords').value || '').replace(/[^0-9.]/g, '');
  return v ? v + ' vạn chữ' : '';
}
function openModal() {
  $('#modal').classList.remove('hidden');
  $('#nbStep1').classList.remove('hidden'); $('#nbStep2').classList.add('hidden');
  $('#nbAdv').classList.add('hidden'); if ($('#nbImport')) $('#nbImport').classList.add('hidden');
  $('#nbErr').textContent = ''; $('#nbFinalTitle').value = ''; $('#nbLaunch').disabled = true;
  // 重置对标状态
  NB_REF_STYLE = null;
  nbVoiceReset();   // 换一本书就换一套文风候选，别把上一本挑的带过来
  // 重置开局架构为默认「粗罗盘」
  NB_PLAN_MODE = 'compass';
  const pseg = document.getElementById('nbPlanMode');
  if (pseg) pseg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.plan === 'compass'));
  const rseg = $('#nbRomance');
  if (rseg) rseg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.rom === 'warm'));
  NB_ROMANCE = 'warm';
  const pvc = document.getElementById('nbVolCount'); if (pvc) { pvc.disabled = false; pvc.style.opacity = ''; }
  if ($('#nbRefPanel')) $('#nbRefPanel').classList.add('hidden');
  if ($('#nbrsUrl')) $('#nbrsUrl').value = '';
  if ($('#nbrsSample')) $('#nbrsSample').value = '';
  if ($('#nbrsMulti')) $('#nbrsMulti').checked = false;
  if ($('#nbrsStatus')) $('#nbrsStatus').textContent = '';
  $('#nbTheme').focus();
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#btnNewBook').addEventListener('click', openModal);
$('#btnImport').addEventListener('click', () => { openModal(); $('#nbImport').classList.remove('hidden'); $('#nbImport').scrollIntoView({ block: 'nearest' }); setTimeout(() => $('#nbImpDir').focus(), 50); });
$('#nbCancel').addEventListener('click', closeModal);
$('#modalClose').addEventListener('click', closeModal);
// 点遮罩空白处关闭（点卡片内部不关）
// [已禁用点背景关闭：功能弹窗只能点关闭/取消按钮结束，避免误触丢失操作] 新建书弹窗同理，不再点背景关闭。
// Esc 关闭
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal').classList.contains('hidden')) closeModal();
  if (!$('#reviewModal').classList.contains('hidden')) $('#reviewModal').classList.add('hidden');
  if (!$('#styleModal').classList.contains('hidden')) $('#styleModal').classList.add('hidden');
  if (!$('#refStyleModal').classList.contains('hidden')) $('#refStyleModal').classList.add('hidden');
  if ($('#studioModal') && !$('#studioModal').classList.contains('hidden')) $('#studioModal').classList.add('hidden');
  if ($('#volPlanModal') && !$('#volPlanModal').classList.contains('hidden')) $('#volPlanModal').classList.add('hidden');
  if (!$('#delModal').classList.contains('hidden')) $('#delModal').classList.add('hidden');
  if (!$('#coverModal').classList.contains('hidden')) $('#coverModal').classList.add('hidden');
});
$('#nbAdvToggle').addEventListener('click', () => $('#nbAdv').classList.toggle('hidden'));
$('#nbImportToggle').addEventListener('click', () => $('#nbImport').classList.toggle('hidden'));
// 对标别人的书（立项前定文风，可多本）
$('#nbRefToggle') && $('#nbRefToggle').addEventListener('click', () => {
  const panel = $('#nbRefPanel'); panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden') && $('#nbrsProfile') && $('#nbrsProfile').options.length <= 1) {
    api('/api/unzoo/profiles', 'POST', {}).then(r => {
      $('#nbrsProfile').innerHTML = '<option value="">(Chọn tài khoản Unzoo)</option>' +
        (r.profiles || []).map(p => `<option value="${p.path}">${p.name}</option>`).join('');
    }).catch(() => { $('#nbrsProfile').innerHTML = '<option value="">(Chưa kết nối Unzoo)</option>'; });
  }
});
$('#nbrsAnalyze') && $('#nbrsAnalyze').addEventListener('click', async () => {
  const urls = $('#nbrsUrl').value.split('\n').map(s => s.trim()).filter(Boolean);
  const multi = $('#nbrsMulti').checked;
  const sample = $('#nbrsSample').value.trim();
  const fanqie = multi || urls.length > 0;
  let body;
  if (fanqie) { body = { bookUrls: urls, multi: !!multi, profilePath: $('#nbrsProfile').value, model: $('#nbModel').value }; }
  else if (sample.length >= 40) { body = { sample, model: $('#nbModel').value }; }
  else { $('#nbrsStatus').textContent = 'Vui lòng nhập link tác phẩm mẫu hoặc dán một đoạn văn mẫu'; return; }
  $('#nbrsAnalyze').disabled = true;
  $('#nbrsStatus').textContent = 'AI đang phân tích văn phong… (~1–3 phút)';
  try {
    const r = await api('/api/book/analyze-style', 'POST', body);
    NB_REF_STYLE = { name: r.name || 'Văn phong học hỏi', rules: r.rules || '' };
    $('#nbrsStatus').innerHTML = '✅ Đã áp dụng văn phong mẫu: <b>' + NB_REF_STYLE.name + '</b> (Toàn bộ tác phẩm sẽ theo văn phong này)';
  } catch (e) { NB_REF_STYLE = null; $('#nbrsStatus').textContent = 'Phân tích thất bại: ' + e.message; }
  finally { $('#nbrsAnalyze').disabled = false; }
});
// 原生选择文件夹（仅 Tauri 桌面端有；浏览器里提示手动粘贴）
$('#nbImpBrowse').addEventListener('click', async () => {
  const inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (!inv) { toast('Vui lòng nhập hoặc dán đường dẫn đầy đủ'); $('#nbImpDir').focus(); return; }
  try {
    const dir = await inv('pick_folder');
    if (dir) {
      $('#nbImpDir').value = dir;
      try { const r = await api('/api/detect-title', 'POST', { dir }); if (r.title && !$('#nbImpTitle').value.trim()) $('#nbImpTitle').value = r.title; } catch { }
    }
  }
  catch (e) { toast('Mở bảng chọn thư mục thất bại: ' + e.message); }
});
$('#nbSelfNameLink').addEventListener('click', nbSelfName);

// 导入已有文件夹 → 继续写
$('#nbImpBtn').addEventListener('click', async () => {
  const dir = $('#nbImpDir').value.trim();
  if (!dir) { $('#nbImpErr').textContent = 'Vui lòng nhập đường dẫn thư mục'; return; }
  $('#nbImpBtn').disabled = true; $('#nbImpErr').textContent = 'Đang nhập tác phẩm…';
  try {
    const r = await api('/api/book/import', 'POST', { dir, title: $('#nbImpTitle').value.trim(), model: $('#nbImpModel').value });
    // 确认门：导入只注册 + 代码归档文件，【不自动开写】。打开写作台让你检查后再点"开始写作"。
    $('#modal').classList.add('hidden');
    await refresh();
    const book = STATE.books.find(b => b.slug === r.book.slug) || r.book;
    openWrite(book);
    toast('Đã nhập 《' + book.title + '》(' + (r.book.stats?.chapters || 0) + ' chương), bạn có thể bấm Bắt Đầu Viết để tiếp tục');
  } catch (e) { $('#nbImpErr').textContent = 'Thất bại: ' + e.message; $('#nbImpBtn').disabled = false; }
});

// 步骤1 → 生成候选书名 → 步骤2
$('#nbPropose').addEventListener('click', proposeTitles);
$('#nbRegen').addEventListener('click', proposeTitles);
$('#nbBack2').addEventListener('click', () => { $('#nbStep2').classList.add('hidden'); $('#nbStep1').classList.remove('hidden'); });
async function proposeTitles() {
  const theme = $('#nbTheme').value.trim();
  if (!theme) { $('#nbErr').textContent = 'Vui lòng nhập thể loại / ý tưởng trước'; return; }
  $('#nbStep1').classList.add('hidden'); $('#nbStep2').classList.remove('hidden');
  $('#nbErr2').textContent = ''; $('#nbTitles').innerHTML = ''; $('#nbLoading').classList.remove('hidden');
  NB_SEL = -1;
  try {
    const r = await api('/api/book/propose-titles', 'POST', { theme, words: getWords(), model: $('#nbModel').value });
    NB_TITLES = r.titles || [];
    $('#nbLoading').classList.add('hidden');
    renderTitleCards();
  } catch (e) {
    $('#nbLoading').classList.add('hidden');
    $('#nbErr2').textContent = 'Tạo thất bại: ' + e.message + '\n(Có thể đổi mô hình hoặc tự nhập tên truyện ở trên)';
  }
}
function renderTitleCards() {
  const box = $('#nbTitles'); box.innerHTML = '';
  NB_TITLES.forEach((t, i) => {
    const c = el('div', 'nb-title-card', `<div class="t">《${esc(t.title)}》</div><div class="p">${esc(t.premise || '')}</div>`);
    c.addEventListener('click', () => { NB_SEL = i; renderTitleCards(); $('#nbFinalTitle').value = t.title; nbTitleSync(); });
    if (i === NB_SEL) c.classList.add('sel');
    box.appendChild(c);
  });
}
function nbTitleSync() { $('#nbLaunch').disabled = !$('#nbFinalTitle').value.trim(); }
// 自己起名直接立项（跳过 AI 建议）
function nbSelfName() {
  const theme = $('#nbTheme').value.trim();
  if (!theme) { $('#nbErr').textContent = 'Vui lòng nhập thể loại / ý tưởng trước'; return; }
  $('#nbStep1').classList.add('hidden'); $('#nbStep2').classList.remove('hidden');
  $('#nbErr2').textContent = ''; $('#nbTitles').innerHTML = ''; $('#nbLoading').classList.add('hidden');
  NB_TITLES = []; NB_SEL = -1; nbTitleSync(); $('#nbFinalTitle').focus();
}

// 步骤2 → 确认并开写（建书 + 全卷立项 + 开写）
$('#nbFinalTitle').addEventListener('input', nbTitleSync);
$('#nbLaunch').addEventListener('click', async () => {
  const title = $('#nbFinalTitle').value.trim();
  if (!title) { $('#nbErr2').textContent = 'Vui lòng nhập tên truyện'; return; }
  $('#nbLaunch').disabled = true; $('#nbErr2').textContent = 'Đang tạo tác phẩm và khởi động AI lên khung…';
  try {
    const r = await api('/api/book/launch', 'POST', {
      title, theme: $('#nbTheme').value.trim(),
      words: getWords(), model: $('#nbModel').value,
      style: NB_REF_STYLE || $('#nbStyle').value,   // 对标分析过 → 用对标文风；否则用下拉预设
      participation: $('#nbWriteMode').value,   // auto | volume | chapter
      volumes: $('#nbVolCount') ? $('#nbVolCount').value : '',   // 罗盘卷数（只出粗走向）
      characters: $('#nbChars') ? $('#nbChars').value.trim() : '',   // 作者指定的角色（AI 原样采用）
      planMode: NB_PLAN_MODE,   // freehand=探索式：只给写作手法，全书不出任何大纲，情节作者逐段给
      romance: NB_ROMANCE,      // 感情线档位：写进该书写作规范，全程约束分寸（含未成年红线）
      voiceRef: NB_VOICE,       // 挑中的那段开头 → 本书第一份范本 + 手法卡（没挑就是 null）
    });
    $('#modal').classList.add('hidden');
    await refresh();
    const book = STATE.books.find(b => b.slug === r.book.slug) || r.book;
    openWrite(book); setWriting(true); openStream(book.slug);
    const st = r.book && r.book.style;
    const free = NB_PLAN_MODE === 'freehand';
    toast('Đã khởi tạo tác phẩm 《' + title + '》' + (NB_VOICE ? ' · Mẫu: ' + NB_VOICE.name : '') + ', AI đang chuẩn bị...'); //
    ''
    ''
  } catch (e) { $('#nbErr2').textContent = 'Thất bại: ' + e.message; $('#nbLaunch').disabled = false; }
});

// 高级：仅手动创建
$('#nbManualCreate').addEventListener('click', async () => {
  const title = $('#nbTitle').value.trim();
  if (!title) { $('#nbErr').textContent = 'Tên tác phẩm không được để trống'; return; }
  try {
    await api('/api/book/create', 'POST', {
      title, genre: $('#nbGenre').value.trim(), model: $('#nbModel').value,
      totalWords: getWords(), volumes: $('#nbVolumes').value.trim(),
      chaptersPerVolume: $('#nbCpv').value.trim(), batchSize: Number($('#nbBatch').value) || 3,
    });
    $('#modal').classList.add('hidden');
    ['nbTitle', 'nbGenre', 'nbWords', 'nbVolumes', 'nbCpv', 'nbBatch', 'nbTheme'].forEach(id => { const e = $('#' + id); if (e) e.value = ''; });
    await refresh(); toast('Đã tạo 《' + title + '》 thành công!');
  } catch (e) { $('#nbErr').textContent = e.message; }
});

// ---------- 用量 ----------
async function renderUsage() {
  const u = await api('/api/usage').catch(() => ({ books: {} }));
  const list = $('#usageList'); list.innerHTML = '';
  const entries = Object.entries(u.books || {});
  if (!entries.length) { list.innerHTML = '<div class="env-row"><span class="v">Chưa có bản ghi thống kê nào. Bắt đầu sáng tác sẽ tự động ghi nhận.</span></div>'; return; }
  const apiTok = (b) => b.api ? (b.api.promptTokens || 0) + (b.api.completionTokens || 0) : 0;
  const score = (b) => (b.total || 0) + apiTok(b);
  const max = Math.max(...entries.map(([, b]) => score(b)), 1);
  // 顶部汇总：API 写作总成本（Ước tính）—— 只要有任何一本用过 API 就显示
  const totalCost = entries.reduce((s, [, b]) => s + (b.api?.cost || 0), 0);
  const totalApiTok = entries.reduce((s, [, b]) => s + apiTok(b), 0);
  if (entries.some(([, b]) => b.api)) {
    const head = el('div', 'usage-row');
    head.innerHTML = `<div class="top"><span class="title">💰 Ước tính chi phí API</span><span class="num">${fmtCost(totalCost)}</span></div>
      <div style="margin-top:5px;color:var(--muted);font-size:11.5px">Tổng cộng ${fmtTok(totalApiTok)} tokens. Thống kê dựa trên số token thực tế đã sử dụng.</div>`;
    list.appendChild(head);
  }
  for (const [slug, b] of entries.sort((a, c) => score(c[1]) - score(a[1]))) {
    const title = (STATE.books.find(x => x.slug === slug) || {}).title || slug;
    const row = el('div', 'usage-row');
    const apiLine = b.api
      ? `<div style="margin-top:4px;color:var(--muted);font-size:11.5px">🔌 API：${fmtTok(apiTok(b))} tokens · ${b.api.calls || 0}  lượt gọi · Ước tính <b>${fmtCost(b.api.cost || 0)}</b></div>`
      : '';
    row.innerHTML = `<div class="top"><span class="title">《${esc(title)}》</span><span class="num">${fmtTok(b.total)} tokens</span></div>
      <div class="bar"><i style="width:${(score(b) / max * 100).toFixed(1)}%"></i></div>
      <div style="margin-top:7px;color:var(--muted);font-size:11.5px">${(b.total || 0).toLocaleString()} tokens (CLI subscription)· phiên làm việc ${Object.keys(b.sessions || {}).length}</div>${apiLine}`;
    list.appendChild(row);
  }
}

// ---------- Cài đặt ----------
async function renderSettings() {
  const c = STATE.config;
  const box = $('#settings');
  box.innerHTML = `
    <label class="field"><span>Thư mục tác phẩm(Thư mục lưu trữ tác phẩm)</span>
      <div class="ws-row">
        <input id="setWs" value="${esc(c.workspace || '')}" placeholder="Bấm "Chọn thư mục" bên phải để chỉ định đường dẫn">
        <button class="btn" id="setWsPick" type="button">📁 Chọn thư mục</button>
        <button class="btn ghost" id="setWsOpen" type="button">📂 Mở</button>
      </div>
    </label>
    <label class="field"><span>Mô hình mặc định</span><select id="setModel">${STATE.models.map(m => `<option value="${m.id}" ${m.id === c.defaultModel ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
    <fieldset class="field" style="border:1px solid var(--border,#333);border-radius:8px;padding:10px 12px">
      <legend style="padding:0 6px;font-size:13px;opacity:.8">🔌 Cấu hình API mô hình AI (Kết nối trực tiếp · Ổn định)</legend>
      <div class="modal-hint" style="margin:0 0 8px">Điền API Key để sử dụng mô hình tương ứng trong bàn viết. Để trống nếu không dùng.</div>
      <label class="field"><span>Zhipu GLM API Key (open.bigmodel.cn)</span>
        <input id="setZhipuKey" type="password" autocomplete="off" placeholder="${c.api?.zhipu?.hasKey ? '*** Đã cấu hình (Để trống nếu không đổi) ***' : 'Chưa cấu hình'}"></label>
      <label class="field"><span>Mô hình Zhipu GLM</span>
        <input id="setZhipuModel" value="${esc(c.api?.zhipu?.model || 'glm-4-flash')}" placeholder="glm-4.5-flash (Khuyên dùng)"></label>
      <label class="field"><span>DeepSeek API Key (platform.deepseek.com)</span>
        <input id="setDsKey" type="password" autocomplete="off" placeholder="${c.api?.deepseek?.hasKey ? '*** Đã cấu hình (Để trống nếu không đổi) ***' : 'Chưa cấu hình'}"></label>
      <label class="field"><span>Alibaba DashScope Key (dashscope.console.aliyun.com)</span>
        <input id="setDashKey" type="password" autocomplete="off" placeholder="${c.api?.dashscope?.hasKey ? '*** Đã cấu hình (Để trống nếu không đổi) ***' : 'Chưa cấu hình'}"></label>
      <label class="field"><span>Alibaba Bailian Key (Bắt đầu bằng sk-sp-)</span>
        <input id="setBlKey" type="password" autocomplete="off" placeholder="${c.api?.bailian?.hasKey ? '*** Đã cấu hình (Để trống nếu không đổi) ***' : 'Chưa cấu hình'}"></label>
      <label class="field"><span>Mô hình Alibaba Bailian</span>
        <input id="setBlModel" value="${esc(c.api?.bailian?.model || 'deepseek-v4-pro')}" placeholder="deepseek-v4-pro / qwen3.8-max / glm-5.2"></label>
      <div class="modal-hint" style="margin:-4px 0 8px">⚠️ Cấu hình này tách biệt với API DashScope thông thường. Khuyên dùng deepseek-v4-pro.</div>
      <label class="field"><span>ByteDance Doubao / Volcengine Key</span>
        <input id="setArkKey" type="password" autocomplete="off" placeholder="${c.api?.doubao?.hasKey ? '*** Đã cấu hình (Để trống nếu không đổi) ***' : 'Chưa cấu hình'}"></label>
      <label class="field"><span>Doubao Endpoint ID (Điền ep-xxxx)</span>
        <input id="setArkEp" value="${esc(c.api?.doubao?.model || '')}" placeholder="ep-20260101xxxxxx"></label>
      <label class="field"><span>Kimi / Moonshot API Key</span>
        <input id="setKimiKey" type="password" autocomplete="off" placeholder="${c.api?.moonshot?.hasKey ? '*** Đã cấu hình (Để trống nếu không đổi) ***' : 'Chưa cấu hình'}"></label>
      <label class="field"><span>Baidu ERNIE / Qianfan Key</span>
        <input id="setErnieKey" type="password" autocomplete="off" placeholder="${c.api?.ernie?.hasKey ? '*** Đã cấu hình (Để trống nếu không đổi) ***' : 'Chưa cấu hình'}"></label>
    </fieldset>
    <fieldset class="field" style="border:1px solid var(--border,#333);border-radius:8px;padding:10px 12px">
      <legend style="padding:0 6px;font-size:13px;opacity:.8">🖥️ Mô hình chạy cục bộ (Ollama / LM Studio · Miễn phí · Offline)</legend>
      <div class="modal-hint" style="margin:0 0 8px">
        Cài đặt Ollama và tải mô hình (ví dụ: ollama pull qwen3:14b), sau đó chọn trong danh sách mô hình.
      </div>
      <label class="field"><span>Địa chỉ dịch vụ (Ollama mặc định :11434; LM Studio :1234/v1)</span>
        <input id="setLocalUrl" value="${esc(c.api?.local?.baseUrl || 'http://127.0.0.1:11434/v1')}" placeholder="http://127.0.0.1:11434/v1"></label>
      <label class="field"><span>Tên mô hình</span>
        <input id="setLocalModel" value="${esc(c.api?.local?.model || 'qwen3:14b')}" placeholder="qwen3:14b"></label>
      <label class="field"><span>Độ dài ngữ cảnh num_ctx (Khuyên dùng 16384)</span>
        <input id="setLocalCtx" type="number" value="${c.api?.local?.numCtx ?? 16384}"></label>
      <div class="btn-row" style="margin-top:6px"><button class="btn ghost" id="setLocalTest" type="button" style="flex:0;padding:8px 16px">🩺 Kiểm tra dịch vụ & Tư vấn cấu hình GPU</button></div>
      <div id="setLocalOut" class="modal-hint" style="margin:8px 0 0;white-space:pre-wrap"></div>
    </fieldset>
    <fieldset class="field" style="border:1px solid var(--border,#333);border-radius:8px;padding:10px 12px">
      <legend style="padding:0 6px;font-size:13px;opacity:.8">🎨 Công cụ tạo ảnh bìa (Ảnh nền / Thử nghiệm bìa)</legend>
      <div class="modal-hint" style="margin:0 0 8px">
        Tiêu đề bìa được vẽ đè lên sau, ảnh nền yêu cầu không chữ. SDXL chạy cục bộ là tối ưu.
      </div>
      <label class="field"><span>Bộ sinh ảnh</span><select id="setImgBackend">
        <option value="gemini" ${(c.image?.backend || 'gemini') === 'gemini' ? 'selected' : ''}>Google Imagen (Cần Gemini Key & Proxy)</option>
        <option value="local" ${c.image?.backend === 'local' ? 'selected' : ''}>Tạo ảnh trên máy cục bộ (Miễn phí · Không giới hạn)</option>
      </select></label>
      <label class="field"><span>Dịch vụ tạo ảnh cục bộ</span><select id="setImgLocal">
        <option value="comfy" ${(c.image?.localBackend || 'comfy') === 'comfy' ? 'selected' : ''}>ComfyUI (Khuyên dùng)</option>
        <option value="a1111" ${c.image?.localBackend === 'a1111' ? 'selected' : ''}>SD WebUI / Forge (Khởi động kèm cờ --api)</option>
      </select></label>
      <label class="field"><span>Địa chỉ ComfyUI</span>
        <input id="setComfyUrl" value="${esc(c.image?.comfy?.baseUrl || 'http://127.0.0.1:8188')}" placeholder="http://127.0.0.1:8188"></label>
      <label class="field"><span>Preset mô hình ảnh</span><select id="setComfyPreset">
        <option value="sdxl" ${(c.image?.comfy?.preset || 'sdxl') === 'sdxl' ? 'selected' : ''}>Dòng SDXL (~6.5GB · Tối ưu dung lượng · Đẹp)</option>
        <option value="qwen-image" ${c.image?.comfy?.preset === 'qwen-image' ? 'selected' : ''}>Qwen-Image (~20GB · Chất lượng cao)</option>
      </select></label>
      <label class="field"><span>Tên file checkpoint SDXL (Trong thư mục ComfyUI/models/checkpoints)</span>
        <input id="setComfyCkpt" value="${esc(c.image?.comfy?.ckpt || 'sd_xl_base_1.0.safetensors')}"></label>
      <label class="field"><span>File Workflow JSON tùy chỉnh (Tùy chọn)</span>
        <input id="setComfyWf" value="${esc(c.image?.comfy?.workflowFile || '')}" placeholder="Để trống = Dùng preset ở trên"></label>
      <div class="btn-row" style="margin-top:6px"><button class="btn ghost" id="setImgTest" type="button" style="flex:0;padding:8px 16px">🔌 Kiểm tra kết nối dịch vụ tạo ảnh</button></div>
      <div id="setImgOut" class="modal-hint" style="margin:8px 0 0;white-space:pre-wrap"></div>
    </fieldset>
    <label class="field"><span>Proxy mạng</span><select id="setProxy">
      <option value="on" ${c.enableProxy ? 'selected' : ''}>Bật (Dùng proxy hiện tại)</option>
      <option value="off" ${!c.enableProxy ? 'selected' : ''}>Tắt</option></select></label>
    <label class="field"><span>Autopilot Tự Động Giám Sát</span><select id="setAuto">
      <option value="on" ${c.autopilot?.enabled ? 'selected' : ''}>Bật</option>
      <option value="off" ${!c.autopilot?.enabled ? 'selected' : ''}>Tắt</option></select></label>
    <label class="field"><span>Giới hạn tự động viết tiếp</span><input id="setMax" type="number" value="${c.autopilot?.maxAutoContinue ?? 40}"></label>
    <label class="field"><span>Tần suất tự kiểm tra logic (0=Tắt)</span><input id="setFullCheck" type="number" value="${c.autopilot?.fullCheckEvery ?? 5}"></label>
    <label class="field"><span>Ngưỡng làm mới phiên ngữ cảnh để tiết kiệm token (0=Tắt, khuyên dùng 180,000)</span><input id="setFreshCtx" type="number" value="${c.autopilot?.freshContextLimit ?? 180000}"></label>
    <div class="modal-hint" style="margin:-2px 0 4px">Tự động ngắt phiên khi ngữ cảnh đạt ngưỡng để tiết kiệm token tối đa. Hệ thống sẽ tự động chuyển tiếp bối cảnh qua hồ sơ tính nhất quán.</div>
    <div class="btn-row"><button class="btn primary" id="setSave" style="flex:0;padding:10px 22px">Lưu Cài Đặt</button></div>`;
  $('#setSave').addEventListener('click', async () => {
    const patch = {
      workspace: $('#setWs').value.trim(), defaultModel: $('#setModel').value,
      enableProxy: $('#setProxy').value === 'on',
      autopilot: {
        enabled: $('#setAuto').value === 'on',
        maxAutoContinue: Number($('#setMax').value) || 40,
        fullCheckEvery: Math.max(0, Number($('#setFullCheck').value) || 0),
        freshContextLimit: Math.max(0, Number($('#setFreshCtx').value) || 0),
      },
    };
    // API 模型 key/model：只把【填了的】发上去（空 key 不覆盖已存的）
    const apiPatch = {};
    const zk = $('#setZhipuKey').value.trim(); const zm = $('#setZhipuModel').value.trim();
    if (zk || zm) { apiPatch.zhipu = {}; if (zk) apiPatch.zhipu.apiKey = zk; if (zm) apiPatch.zhipu.model = zm; }
    const dk = $('#setDsKey').value.trim(); if (dk) apiPatch.deepseek = { apiKey: dk };
    const ak = $('#setDashKey').value.trim(); if (ak) apiPatch.dashscope = { apiKey: ak };
    // 豆包：key 和接入点 ID 分开填（接入点是明文，可以直接看见和改）
    const blK = $('#setBlKey').value.trim(); const blM = $('#setBlModel').value.trim();
    if (blK || blM) { apiPatch.bailian = {}; if (blK) apiPatch.bailian.apiKey = blK; if (blM) apiPatch.bailian.model = blM; }
    const arkK = $('#setArkKey').value.trim(); const arkE = $('#setArkEp').value.trim();
    if (arkK || arkE) { apiPatch.doubao = {}; if (arkK) apiPatch.doubao.apiKey = arkK; apiPatch.doubao.model = arkE; }
    const kk = $('#setKimiKey').value.trim(); if (kk) apiPatch.moonshot = { apiKey: kk };
    const ek = $('#setErnieKey').value.trim(); if (ek) apiPatch.ernie = { apiKey: ek };
    // 本地模型：没有 key 的概念，地址/模型/上下文都是明文，直接整块提交
    apiPatch.local = {
      baseUrl: $('#setLocalUrl').value.trim() || 'http://127.0.0.1:11434/v1',
      model: $('#setLocalModel').value.trim() || 'qwen3:14b',
      numCtx: Math.max(2048, Number($('#setLocalCtx').value) || 16384),
    };
    if (Object.keys(apiPatch).length) patch.api = apiPatch;
    patch.image = {
      backend: $('#setImgBackend').value,
      localBackend: $('#setImgLocal').value,
      comfy: {
        baseUrl: $('#setComfyUrl').value.trim() || 'http://127.0.0.1:8188',
        preset: $('#setComfyPreset').value,
        ckpt: $('#setComfyCkpt').value.trim(),
        workflowFile: $('#setComfyWf').value.trim(),
      },
    };
    try { STATE.config = await api('/api/config', 'POST', { patch }); fillModels(); toast('Cài đặt đã được lưu thành công!'); }
    catch (e) { toast(e.message); }
  });
  // 🩺 本地模型体检：探服务在不在、装了哪些模型，并按这块卡给出选型建议+安装命令。
  // 本地部署最劝退的不是装，是「装哪个/装多大/为什么这么慢」——这个按钮把它一次答完。
  $('#setLocalTest')?.addEventListener('click', async () => {
    const out = $('#setLocalOut'); out.textContent = '⏳ Đang kiểm tra…';
    try {
      const h = await api('/api/local/health', 'POST', {});
      const L = [];
      L.push(h.gpu?.ok ? `✅ GPU: ${h.gpu.name} ${(h.gpu.totalMb / 1024).toFixed(0)}G VRAM (Trống:  ${(h.gpu.freeMb / 1024).toFixed(1)}G）`
        : `❌ GPU: ${h.gpu?.reason || 'Không tìm thấy'}`);
      if (h.text?.ok) {
        L.push(`✅ Dịch vụ văn bản: ${h.text.kind === 'ollama' ? 'Ollama' : 'Tương thích OpenAI'} @ ${h.text.baseUrl}`);
        L.push(h.text.models?.length ? `   Đã cài: ${h.text.models.map(m => m.name + (m.sizeText ? '(' + m.sizeText + ')' : '')).slice(0, 8).join('、')}`
          : '   (Chưa cài đặt mô hình nào)');
      } else L.push(`❌ Dịch vụ văn bản: ${h.text?.error || 'Không khả dụng'}`);
      L.push(h.image?.ok ? `✅ Dịch vụ tạo ảnh: ${h.image.info}` : `❌ Dịch vụ tạo ảnh: ${h.image?.error || 'Không khả dụng'}`);
      const rt = h.recommend?.text?.pick, ri = h.recommend?.image;
      if (rt) L.push(`\n📝 Gợi ý sáng tác: ${rt.model}（${rt.size}）— ${rt.note}\n   Lệnh cài đặt: ollama pull ${rt.model}`);
      if (ri) L.push(`🎨 Gợi ý tạo ảnh: ${ri.pick} — ${ri.note}`);
      out.textContent = L.join('\n');
    } catch (e) { out.textContent = '❌ ' + e.message; }
  });
  $('#setImgTest')?.addEventListener('click', async () => {
    const out = $('#setImgOut'); out.textContent = '⏳ Đang kết nối…';
    const backend = $('#setImgLocal').value;
    try {
      const r = await api('/api/local/probe-image', 'POST', { backend, baseUrl: backend === 'comfy' ? $('#setComfyUrl').value.trim() : undefined });
      out.textContent = r.ok ? `✅ Đã kết nối ${backend === 'a1111' ? 'SD WebUI' : 'ComfyUI'} @ ${r.baseUrl}｜${r.info}${r.models?.length ? '｜ Mô hình: ' + r.models.slice(0, 5).join('、') : ''}`
        : `❌ ${r.error}`;
    } catch (e) { out.textContent = '❌ ' + e.message; }
  });
  // Thư mục tác phẩm：原生文件夹选择器（桌面应用用 Tauri 对话框；浏览器回退到手填路径）
  $('#setWsPick').addEventListener('click', async () => {
    let dir = null;
    if (HAS_TAURI) {
      try { dir = await tauriInvoke('pick_folder'); }
      catch (e) { toast('Mở bảng chọn thư mục thất bại: ' + e.message); return; }
      if (!dir) return;   // 用户取消
    } else {
      dir = window.prompt('Nhập đường dẫn đầy đủ của thư mục chứa truyện:', $('#setWs').value || '');
      if (dir == null) return;
      dir = dir.trim(); if (!dir) return;
    }
    $('#setWs').value = dir;
    try { STATE.config = await api('/api/config', 'POST', { patch: { workspace: dir } }); toast('Thư mục tác phẩm đã đặt thành: ' + dir); }
    catch (e) { toast('Lưu thất bại: ' + e.message); }
  });
  $('#setWsOpen').addEventListener('click', async () => {
    try { const r = await api('/api/open-path', 'POST', { path: $('#setWs').value.trim() }); toast('Đã mở trong trình quản lý file: ' + r.dir); }
    catch (e) { toast(e.message); }
  });
}

// ---------- Môi trường ----------
async function renderEnv() {
  const box = $('#env'); box.innerHTML = '<div class="env-row"><span class="k">Đang kiểm tra hệ thống…</span></div>';
  let e;
  try { e = await api('/api/env'); }
  catch (err) { box.innerHTML = `<div class="env-row"><span class="k">Engine AI Chưa Kết Nối</span><span class="v">${esc(err.message)}</span></div>`; return; }
  box.innerHTML = '';
  // 操作条（可执行的操作）
  const bar = el('div', 'btn-row'); bar.style.marginBottom = '12px';
  bar.innerHTML = `<button class="btn" id="envReload">🔄 Kiểm Tra Lại</button>
    <button class="btn" id="envOpenWs">📂 MởThư mục tác phẩm</button>
    <button class="btn ghost" id="envToSettings">⚙️ Đến Trang Cài Đặt</button>`;
  box.appendChild(bar);
  const ok = (b) => b ? '✔ ' : '✖ ';
  const rows = [
    ['Hệ Điều Hành', e.platform],
    ['Trình điều khiển Terminal (Unterm)', e.untermExe ? (e.untermExe + (e.untermVersion ? '  [' + e.untermVersion + ']' : '')) : '✖ Không tìm thấy (Tính năng sáng tác terminal cần Unterm)'],
    ['Đường dẫn Unterm CLI', e.untermCli || '✖ Không tìm thấy'],
  ];
  for (const m of e.models) rows.push([m.name, ok(m.available) + (m.path || 'Chưa cài đặt')]);
  rows.push(['Tiến trình đang chạy', e.instances.map(i => `${i.id}(v${i.version})`).join('、') || 'Không có']);
  rows.push(['Proxy mạng', e.proxy.enabled ? ('Bật · ' + (e.proxy.url || '(Chưa cấu hình)')) : 'Tắt']);
  rows.push(['Thư mục tác phẩm', ok(e.workspaceExists) + (e.workspace || '—')]);
  for (const [k, v] of rows) {
    const r = el('div', 'env-row'); r.innerHTML = `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`; box.appendChild(r);
  }
  $('#envReload').addEventListener('click', async () => {
    try { const b = await api('/api/bootstrap'); STATE = { ...STATE, ...b }; } catch { }
    renderEnv(); toast('Đã kiểm tra lại hệ thống!');
  });
  $('#envOpenWs').addEventListener('click', async () => {
    try { const r = await api('/api/open-path', 'POST', { path: e.workspace }); toast('Đã mở: ' + r.dir); }
    catch (err) { toast(err.message); }
  });
  $('#envToSettings').addEventListener('click', () => showView('settings'));
}

boot();
setInterval(() => { if (!$('#view-shelf').classList.contains('hidden')) refresh(); }, 5000);
