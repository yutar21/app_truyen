// 大纲编辑审核（无头主编）：用【另一个模型】审作者写好的大纲，给出分档意见，回写成 reviews/大纲审稿-xxx.md。
// 触发点：立项规划完成、每卷开写前（作者在窗口输出哨兵「【大纲待审：xxx】」→ autopilot 调用本模块）。
// 设计：审稿者只出意见，不直接改大纲；由作者 agent 按意见修订 —— 保留作者一致性，且留痕。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getModel, detectAll } from './models.mjs';
import { proxyUrl } from './unterm.mjs';

function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function safeName(s) { return String(s).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 40); }

// 选“另一个模型”当主编：优先 cfg 指定 → 其次任一可用且与作者不同 → 实在没有就退回作者模型（仍是一次独立新上下文审稿）。
export function pickEditorModel(authorModel, cfg) {
  return reviewerCandidates(authorModel, cfg)[0];
}

// 审稿人候选（按优先级、去重、只取可用）：首选 cfg 指定；否则优先【与作者不同】的独立模型，快而稳的排前
// （gemini/qwen），claude 因偶发无头慢/超时排后，作者同模型兜底最后。reviewOutline 逐个尝试，超时/失败自动换下一个。
export function reviewerCandidates(authorModel, cfg) {
  const avail = detectAll().filter(m => m.available).map(m => m.id);
  const out = [];
  const push = (id) => { if (id && avail.includes(id) && !out.includes(id)) out.push(id); };
  const want = cfg?.editorReview?.model;
  if (want && want !== 'auto') push(want);
  push('agy');
  push('codex');
  for (const id of ['gemini', 'qwen', 'claude']) if (id !== authorModel) push(id);
  push(authorModel);   // 同模型独立审兜底
  return out.length ? out : [authorModel];
}

// 非交互跑一次模型（异步 spawn，不阻塞事件循环 —— 与 planner 的同步版区分）。
function runModelOnceAsync(model, prompt, cfg, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const m = getModel(model);
    if (!m) return reject(new Error('未知模型：' + model));
    const env = { ...process.env };
    if (cfg?.enableProxy) {
      const px = proxyUrl();
      if (px) { env.HTTP_PROXY = env.HTTPS_PROXY = env.ALL_PROXY = env.http_proxy = env.https_proxy = px; }
    }
    let args;
    if (model === 'codex') {
      args = ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox'];
    } else if (model === 'agy' || model === 'gemini') {
      args = ['--effort', cfg?.agyEffort || 'high'];
      if (cfg?.agyModel) args.push('--model', cfg.agyModel);
      args.push('--dangerously-skip-permissions', '--output-format', 'text');
    } else {
      args = ['-p'];
    }
    const isWinCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(m.bin);
    const cp = spawn(m.bin, args, { env, cwd: os.tmpdir(), shell: isWinCmd, windowsHide: true });
    let out = '', err = '';
    const to = setTimeout(() => { try { cp.kill(); } catch { } reject(new Error(m.name + ' 审稿超时')); }, timeoutMs);
    cp.stdout.on('data', d => (out += d));
    cp.stderr.on('data', d => (err += d));
    cp.on('error', e => { clearTimeout(to); reject(e); });
    cp.on('close', () => { clearTimeout(to); resolve(out + (err ? '\n' + err : '')); });
    try { cp.stdin.write(prompt); cp.stdin.end(); } catch (e) { clearTimeout(to); reject(e); }
  });
}

// Trích xuất số thứ tự quyển từ chuỗi bất kỳ (ví dụ: Quyển 02, 卷02, Vol 2, Tap 2, Hoi 2, Arc 2, 02...)
export function extractVolumeNum(s) {
  if (s == null) return null;
  const str = String(s).trim();
  const m = str.match(/(?:卷|quyen|quyển|vol|volume|tap|tập|hoi|hồi|phan|phần|arc|book)?[_\s\-]*0*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Khớp tệp dàn ý theo số thứ tự quyển một cách thông minh và linh hoạt
export function matchVolumeFile(files, volNum) {
  if (volNum == null) return null;
  const n = String(volNum);
  // 1. Khớp từ khóa quyển + số: 卷01, Quyển 01, Vol 1, Tap 1, Hoi 1, Arc 1...
  const kwRegex = new RegExp('(?:^|[\\s_\\-])(?:卷|quyen|quyển|vol|volume|tap|tập|hoi|hồi|phan|phần|arc|book)[\\s_\\-]*0*' + n + '(?!\\d)', 'i');
  let hit = files.find(f => kwRegex.test(f));
  if (hit) return hit;

  // 2. Khớp theo số thứ tự độc lập hoặc ở đầu/cuối tên file (ví dụ 01.md, 01_Ten_Quyen.md, Q01.md)
  const numRegex = new RegExp('(?:^|[\\s_\\-])0*' + n + '(?!\\d)', 'i');
  hit = files.find(f => numRegex.test(f));
  if (hit) return hit;

  return null;
}

// 找出该 scope 要审的大纲文件：立项/全书=全部；卷NN/Quyển NN/Vol NN=该卷的分章大纲；或精确指定的文件。
export function outlineFilesFor(dir, scope) {
  const odir = path.join(dir, 'outlines');
  let files = [];
  try { files = fs.readdirSync(odir).filter(f => /\.md$/i.test(f)); } catch { }
  if (!files.length) return [];
  if (/立项|全书|all|toàn thư/i.test(scope)) return files.map(f => path.join(odir, f));
  
  // 1. Khớp chính xác tên file (ví dụ STORY_ARCS, 卷01_Gia_Ma_Phong_Van, Quyển 02)
  const exact = files.find(f => f.toLowerCase() === String(scope).toLowerCase() || f.replace(/\.md$/i, '').toLowerCase() === String(scope).toLowerCase());
  if (exact) return [path.join(odir, exact)];

  // 2. Khớp linh hoạt theo số thứ tự quyển
  const volNum = extractVolumeNum(scope);
  if (volNum != null) {
    const hit = matchVolumeFile(files, volNum);
    if (hit) return [path.join(odir, hit)];
  }

  return files.map(f => path.join(odir, f));  // 兜底：审全部
}

// 主编审稿 prompt：网文资深主编视角，重点盯节奏/格局/爽点/逻辑/规模/反流水账，不仅审稿还直接输出最佳大纲。
export function buildEditorPrompt(book, scope, bible, outline, priorCritique = '') {
  const isLatin = /[a-zA-Zà-ỹÀ-Ỹ]/.test(book.title || '');
  const genreInfo = [book.genre, book.theme].filter(Boolean).join(' · ');
  const styleInfo = book.style?.name ? `Phong cách: ${book.style.name}${book.style.tweak ? ' (' + book.style.tweak + ')' : ''}` : '';

  if (isLatin) {
    const hasPrior = Boolean(priorCritique && priorCritique.length > 50 && !priorCritique.includes('自动放行') && !priorCritique.includes('Bản thẩm định tự động'));
    const priorSection = hasPrior ? [
      `# BIÊN BẢN THẨM ĐỊNH LẦN TRƯỚC (ĐỂ ĐỐI CHIẾU TIẾN ĐỘ SỬA ĐỔI):`,
      priorCritique,
      ``,
      `# NGUYÊN TẮC TÁI THẨM ĐỊNH KHÁCH QUAN & CHÍNH XÁC:`,
      `1. Kiểm tra đối chiếu: Xem các [Lỗi nghiêm trọng] lần trước đã được giải quyết triệt để và tự nhiên chưa.`,
      `2. Đánh giá chất lượng thực tế: KHÔNG duyệt bừa, KHÔNG tự động bỏ qua nếu cốt truyện còn lỗ hổng, nhưng cũng KHÔNG bới lông tìm vết các chi tiết vụn vặt không đáng có.`,
      `3. Nếu dàn ý vẫn còn điểm yếu thực sự (như tụt áp sau cao trào, nhân vật hành xử gượng ép OOC, hoặc giải trình đối phó): Thẳng thắn chỉ rõ và tự mình khắc phục luôn trong Bản Dàn Ý Tối Ưu ở Phần 2.`,
      `4. Nếu các vấn đề cốt lõi đã được giải quyết thỏa đáng, mạch truyện hấp dẫn, kịch tính và sẵn sàng viết: Đánh giá 【Đánh giá tổng thể】 Có thể viết ngay / Đã được tối ưu hoàn thiện.`,
      ``,
    ] : [
      `# MỤC TIÊU CỐT LÕI: "THẨM ĐỊNH TOÀN DIỆN VÉT CẠN MỘT LẦN & XUẤT RA DÀN Ý HOÀN THIỆN NHẤT"`,
      `Không thẩm định hời hợt, không để sót lỗi lớn. Hãy rà soát kỹ lưỡng qua toàn bộ 5 trụ cột chất lượng bên dưới, chỉ rõ các lỗi nghiêm trọng và ĐÍCH THÂN MÀI GIŨA, TỐI ƯU HÓA RA MỘT BẢN DÀN Ý HAY NHẤT ở Phần 2.`,
      ``,
    ];

    const isOverall = /立项|全书|all|toàn thư|story/i.test(scope);

    return [
      `Bạn là một đại Tổng biên tập tiểu thuyết mạng kỳ cựu, sắc sảo và am hiểu sâu sắc tâm lý độc giả webnovel phương Đông (thuần thục mọi thể loại: Tiên hiệp, Huyền huyễn, Đô thị, Khoa huyễn, Trí tuệ - Hiện thực Hardboiled, Mạt thế, Lịch sử, v.v.).`,
      `Nhiệm vụ tối thượng của bạn trong đợt thẩm định này gồm 2 PHẦN BẮT BUỘC:`,
      `1. Rà soát, chỉ ra toàn bộ điểm nghẽn và lỗ hổng kịch bản theo 5 trụ cột chất lượng.`,
      `2. ĐÍCH THÂN MÀI GIŨA, TỐI ƯU HÓA VÀ XUẤT RA BẢN DÀN Ý TỐI ƯU & HAY NHẤT (PROPOSED OPTIMIZED OUTLINE) cho toàn bộ phạm vi ${scope}, để tác giả và người dùng có thể sử dụng làm kim chỉ nam xuất sắc nhất.`,
      ``,
      `Tác phẩm: 《${book.title}》${genreInfo ? ' ｜ Thể loại: ' + genreInfo : ''}${styleInfo ? ' ｜ ' + styleInfo : ''}; Phạm vi thẩm định: ${scope}.`,
      ``,
      ...priorSection,
      `# Bối cảnh thiết lập (novel_bible.md)`,
      bible || '(Chưa có thiết lập chi tiết)',
      ``,
      `# Dàn ý hiện tại cần thẩm định & tối ưu`,
      outline,
      ``,
      `# KHUNG TIÊU CHÍ THẨM ĐỊNH TOÀN DIỆN (RÀ SOÁT TẤT CẢ 5 TRỤ CỘT NÀY):`,
      `1. [Cấu trúc hồi & Nhịp điệu kịch tính]: Mở màn cuốn hút - Thắt nút dồn dập - Đại cao trào bùng nổ - Thu dọn tàn cuộc & Mở ra xung đột mới. CÓ BỊ TỤT ÁP SAU CAO TRÀO KHÔNG? (Ví dụ: Đã giải quyết xong đại biến cố/trùm lớn then chốt, nhưng hồi sau lại kéo dài lê thê giải quyết việc vặt làm nguội lạnh cảm xúc độc giả). Tiết tấu triển khai, giải trình bối cảnh có bị bôi dài dòng không?`,
      `2. [Tâm lý & Động cơ nhân vật]: Động cơ của nhân vật chính và các tuyến nhân vật then chốt (phản diện, đồng minh, người thân...) có nhất quán với thiết lập, thực tế và có chiều sâu nội tâm không? Có bị OOC (lạc tính cách) hoặc biến thành công cụ/bị hạ thấp IQ làm nền gượng ép không? Tuyến tình cảm / quan hệ xã hội có tự nhiên và giàu cảm xúc không?`,
      `3. [Logic thế giới quan & Quy tắc thiết lập (Hardboiled / Consistency)]: Có vi phạm quy tắc sức mạnh, công nghệ, cảnh giới hay thiết lập thế giới quan đã định trong novel_bible.md không? Mọi chiến thắng, đột phá hay thu hoạch có cái giá tương xứng và sự chuẩn bị kỹ lưỡng không? Có bị bàn tay vàng / buff bẩn phi lý làm mất đi tính chân thực không?`,
      `4. [Sảng điểm (Payoffs) & Móc câu cuối chương (Hooks)]: Cứ cách 2-3 chương có tiến triển/chiến thắng cụ thể giải tỏa cảm xúc độc giả không? Móc câu cuối mỗi chương có tạo được độ hồi hộp, nghẹt thở (cliffhanger) buộc độc giả phải đọc tiếp chương sau không?`,
      `5. [Độ thuần khiết của dàn ý]: Dàn ý có thuần khiết, giàu hình ảnh kịch bản không? Tuyệt đối không bị nhiễm văn phong "giải trình phòng thủ / cãi cọ với biên tập" (như chèn quá nhiều câu [Khắc phục triệt để lỗi...], [Vá kín logic...], [Ghi chú sửa đổi...]) làm loãng diễn biến truyện thực tế.`,
      ``,
      `# YÊU CẦU ĐẦU RA BẮT BUỘC (100% TIẾNG VIỆT, XUẤT ĐẦY ĐỦ 2 PHẦN THEO ĐÚNG TIÊU ĐỀ SAU):`,
      ``,
      `# PHẦN 1: BÁO CÁO THẨM ĐỊNH & ĐÁNH GIÁ CHẤT LƯỢNG`,
      `Nêu rõ các đánh giá thực chất. Nếu có lỗi cần sửa, mỗi ý PHẢI ĐẶT TRÊN MỘT DÒNG ĐỘC LẬP:`,
      `- [Lỗi nghiêm trọng] Chỉ rõ chương cụ thể: Vấn đề là gì → Cách khắc phục triệt để (Không nhận xét chung chung)`,
      `- [Nguy cơ tiềm ẩn] … (Tương tự, viết gọn trên 1 dòng)`,
      `- [Gợi ý] … (Tương tự, viết gọn trên 1 dòng)`,
      `Chỉ dùng 3 nhãn: [Lỗi nghiêm trọng] / [Nguy cơ tiềm ẩn] / [Gợi ý]. Nếu dàn ý đã tốt, chỉ ra điểm sáng và không bịa thêm lỗi.`,
      `Sau các điều trên, xuống dòng ghi câu kết luận bắt buộc:`,
      `【Đánh giá tổng thể】 Có thể viết ngay / Đã được tối ưu hoàn thiện / Cần sửa lại rồi mới viết —— Một câu nêu rõ lý do hoặc điểm mấu chốt.`,
      ``,
      `# PHẦN 2: BẢN DÀN Ý TỐI ƯU HOÀN THIỆN NHẤT`,
      `Dưới tư cách Đại Tổng Biên Tập, bạn hãy trực tiếp gọt giũa, tối ưu hóa và xuất ra BẢN DÀN Ý HOÀN CHỈNH & HAY NHẤT cho toàn bộ phạm vi ${scope}.`,
      isOverall
        ? `(Vì phạm vi là Toàn Thư / Đại Cương Tổng Thể: Hãy xuất ra Khung Trục Đại Cương Phân Quyển Toàn Thư [STORY ARCS], nêu rõ Chủ đề, Mục tiêu, Tuyến xung đột cốt lõi và các mốc biến cố then chốt của từng quyển từ đầu đến cuối tác phẩm).`
        : `(Vì phạm vi là Phân Quyển Cụ Thể: Hãy xuất ra Dàn ý chi tiết TỪNG CHƯƠNG từ chương đầu đến chương kết của quyển đó theo chuẩn mực cao nhất:)`,
      `Tiêu chuẩn vàng cho Bản dàn ý tối ưu:`,
      `1. Khắc phục triệt để 100% mọi điểm yếu, sạn logic, nguy cơ tụt áp đã chỉ ra ở Phần 1.`,
      `2. Giữ trọn vẹn số thứ tự chương chuẩn xác theo phạm vi thẩm định (tuyệt đối không nhảy số lung tung).`,
      `3. Định dạng chuẩn mực cho TỪNG CHƯƠNG:`,
      `* **Chương N: [Tên Chương Cuốn Hút, Giàu Hình Ảnh & Kịch Tính]**`,
      `  *Sự kiện cốt lõi:* Tóm tắt diễn biến trọng tâm súc tích trong 1-2 câu, tiết tấu dồn dập, gãy gọn.`,
      `  *Tiến triển cốt truyện & Sảng điểm:* Xung đột kịch tính, chuyển biến tâm lý đắt giá, thể hiện thực lực/trí tuệ đúng chất thế giới quan, tạo sảng điểm bùng nổ, không bàn tay vàng tùy tiện.`,
      `  *Móc câu cuối chương:* Câu thoại hoặc tình huống thắt nút nghẹt thở (Cliffhanger) kích thích trí tò mò tột độ buộc độc giả phải đọc tiếp.`,
      `4. Độ thuần khiết tuyệt đối: KHÔNG chèn văn phong cãi cọ giải trình đối phó (như [Khắc phục triệt để lỗi...], [Vá kín logic...], [Ghi chú sửa đổi...]). Dàn ý phải là một kịch bản truyện thuần khiết, hấp dẫn, điện ảnh, đọc là mê!`,
    ].join('\n');
  }

  const hasPrior = Boolean(priorCritique && priorCritique.length > 50 && !priorCritique.includes('自动放行') && !priorCritique.includes('Bản thẩm định tự động'));
  const priorSection = hasPrior ? [
    `# 上一轮审稿意见（对照核实作者是否已真正修订）`,
    priorCritique,
    ``,
    `# 复审原则（客观求实）：`,
    `- 对照核查上一轮【硬伤】是否真正解决，情节是否自然闭环。`,
    `- 实事求是：绝不盲目放行夸赞，但也绝不无事生非硬抠字眼。若有深层结构问题（如高潮后严重泄气、人物动机失真等），在第一部分指出并在第二部分直接优化重塑。`,
    `- 若确实质量过硬无结构硬伤，判定【总评】可直接开写 / 已优化为最佳大纲。`,
    ``,
  ] : [
    `# 目标：全面彻底排查全书五大核心维度并直接操刀优化出最佳大纲`,
    `按五大维度一次性扫清硬伤，不仅给出审稿意见，更直接在第二部分输出终极重塑的优质大纲。`,
    ``,
  ];

  return [
    `你是一名资深网文总编。你的职责是对长篇网文大纲进行全方位深度把关，并【亲自操刀输出一份终极优化最佳大纲】供作者和用户直接作为最高质量创作蓝图。`,
    `书名：《${book.title}》${genreInfo ? ' ｜ 题材：' + genreInfo : ''}；本次审核范围：${scope}。`,
    ``,
    ...priorSection,
    `# 设定圣经（novel_bible.md）`,
    bible || '（缺失）',
    ``,
    `# 当前待审大纲`,
    outline,
    ``,
    `# 审核五大核心维度（逐条核查，直击痛点）：`,
    `1. 节奏回目与高潮张力：开局入戏-层层施压-大高潮引爆-利落收束并抛出新悬念。严防大高潮后情绪断崖式泄气，严防赶路与行政交接注水。`,
    `2. 人物动机与心性逻辑：主角与核心配角（反派、盟友、羁绊角色）的行为动机是否符合其性格与切身利益？是否存在机械降智、工具人化？情感线与人际交锋是否自然深刻？`,
    `3. 世界观逻辑与硬派自洽（Hardboiled）：是否违背 novel_bible 设定的能力边界、科技/战力体系与规则？一切转折、突破与胜利是否有扎实代价与智勇博弈，拒绝无脑机械降神或突兀外挂。`,
    `4. 爽点节拍与章末钩子：每 2–3 章是否有明确胜利、推进或阶段成果？章末断点是否具备强悬念（Cliffhanger）死死锁住读者期待？`,
    `5. 大纲纯度与故事性：大纲内是否充斥着针对审稿的自辩词、解释词（如【已补齐逻辑X】、【已解决硬伤Y】），保持大纲为纯粹生动的高品质故事蓝图。`,
    ``,
    `# 输出格式要求（必须完整输出以下两个部分）：`,
    ``,
    `# 第一部分：主编深度审稿报告`,
    `若有问题，把每一条意见【单独成行】，行首用严重度标签，格式必须是：`,
    `- [硬伤] 指出具体卷/章：核心问题是什么 → 具体怎么改（不讲空话）`,
    `- [隐患] …（同上，一行写完）`,
    `- [建议] …（同上，一行写完）`,
    `严重度只用【硬伤】/【隐患】/【建议】三选一。实事求是给出判断。`,
    `全部条目之后，另起一行给：【总评】可直接开写 / 已优化为最佳大纲 / 需修订后开写 —— 一句话说明最核心判定理由。`,
    ``,
    `# 第二部分：终极优化最佳大纲`,
    `主编亲自操刀重塑，输出一份改掉所有硬伤、节奏紧凑、爽点拉满、章末钩子扣人心弦的【终极优化最佳分章大纲】（覆盖范围：${scope}）。`,
    `每章格式必须规范：`,
    `* **第N章：[极具悬念/爽感之章名]**`,
    `  *核心事件：* …`,
    `  *剧情推进与爽点：* …`,
    `  *章末钩子：* …`,
    `纯度要求：大纲内不得包含任何自辩词、解释词（如【已解决硬伤X】），保持大纲为纯粹的高品质故事蓝图。`,
  ].join('\n');
}

// Bóc tách kết quả thẩm định thành 2 phần: Báo cáo thẩm định (critique) và Bản dàn ý tối ưu (optimizedOutline)
export function splitReviewAndOptimizedOutline(fullText) {
  const text = String(fullText || '').trim();
  if (!text) return { critique: '', optimizedOutline: '', fullText: '' };

  // 1. Tìm theo tiêu đề phân đoạn chuẩn
  const splitRegex = /(?:^|\r?\n)(?:#+\s*(?:PHẦN\s*2|BẢN DÀN Ý TỐI ƯU|DÀN Ý TỐI ƯU|BẢN DÀN Ý HOÀN THIỆN|DÀN Ý NÂNG CẤP|第二部分|终极优化|最佳大纲)[^\r\n]*|==+\s*(?:PHẦN\s*2|BẢN DÀN Ý TỐI ƯU|第二部分)[^\r\n]*)/i;
  const match = text.match(splitRegex);
  if (match) {
    const idx = match.index;
    const critique = text.slice(0, idx).trim();
    const optimizedOutline = text.slice(idx).trim();
    return { critique, optimizedOutline, fullText: text };
  }

  // 2. Nếu không có tiêu đề chuẩn, tìm vị trí bắt đầu các chương beat
  const lines = text.split(/\r?\n/);
  let beatIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (/^(?:\*|\-|\#\#\#?|\d+\.)?\s*(?:\*\*)?(?:Chương|Hồi|Chapter|第)\s*0*\d+/i.test(ln)) {
      beatIndex = i;
      break;
    }
  }
  if (beatIndex > 0) {
    const critique = lines.slice(0, beatIndex).join('\n').trim();
    const optimizedOutline = lines.slice(beatIndex).join('\n').trim();
    return { critique, optimizedOutline, fullText: text };
  }

  return { critique: text, optimizedOutline: text, fullText: text };
}

// Xác định tệp dàn ý mục tiêu tương ứng với scope (tự động xử lý cho mọi quy ước đặt tên file và sách mới)
export function targetOutlineFileFor(dir, scope) {
  const odir = path.join(dir, 'outlines');
  let files = [];
  try { files = fs.readdirSync(odir).filter(f => /\.md$/i.test(f)); } catch { }

  const volNum = extractVolumeNum(scope);
  const isVn = /[a-zA-Zà-ỹÀ-Ỹ]/.test(String(scope || ''));

  // Nếu thư mục outlines/ rỗng (sách mới toanh chưa có file dàn ý nào)
  if (!files.length) {
    if (volNum != null) {
      const pad = String(volNum).padStart(2, '0');
      const fname = isVn ? `Quyen_${pad}.md` : `卷${pad}.md`;
      return path.join(odir, fname);
    }
    return path.join(odir, 'STORY_ARCS.md');
  }

  // 1. Khớp chính xác tên tệp (ví dụ STORY_ARCS, 卷01_Gia_Ma_Phong_Van...)
  const exact = files.find(f => f.toLowerCase() === String(scope).toLowerCase() || f.replace(/\.md$/i, '').toLowerCase() === String(scope).toLowerCase());
  if (exact) return path.join(odir, exact);

  // 2. Khớp theo số thứ tự quyển
  if (volNum != null) {
    const hit = matchVolumeFile(files, volNum);
    if (hit) return path.join(odir, hit);
    // Nếu chưa có file cho quyển này trong danh sách, tạo tên file chuẩn theo định dạng sẵn có trong thư mục
    const hasChinese = files.some(f => /卷\d+/i.test(f));
    const pad = String(volNum).padStart(2, '0');
    const newName = hasChinese ? `卷${pad}.md` : `Quyen_${pad}.md`;
    return path.join(odir, newName);
  }

  // 3. Nếu là 立项 hoặc toàn bộ, ưu tiên STORY_ARCS.md
  if (/立项|全书|all|toàn thư|story/i.test(scope)) {
    const sa = files.find(f => /story[_\s\-]?arcs/i.test(f));
    if (sa) return path.join(odir, sa);
  }

  return path.join(odir, files[0]);
}

// Áp dụng trực tiếp Dàn ý Tối ưu vào tệp dàn ý của tác phẩm (kèm sao lưu backup và cập nhật snapshot)
export function applyOptimizedOutlineToBook({ book, scope, outlineText }) {
  if (!book || !book.dir) throw new Error('Không tìm thấy thư mục sách');
  const dir = book.dir;
  const targetFile = targetOutlineFileFor(dir, scope);
  if (!targetFile) throw new Error('Không thể xác định tệp dàn ý mục tiêu trong outlines/');

  const cleanText = String(outlineText || '').trim();
  if (cleanText.length < 50) throw new Error('Nội dung dàn ý tối ưu quá ngắn, không thể ghi');

  // Đảm bảo thư mục outlines/ tồn tại
  const targetDir = path.dirname(targetFile);
  try { fs.mkdirSync(targetDir, { recursive: true }); } catch { }

  // 1. Tạo bản sao lưu an toàn trong .studio/backups/
  const backupDir = path.join(dir, '.studio', 'backups');
  try { fs.mkdirSync(backupDir, { recursive: true }); } catch { }
  const base = path.basename(targetFile, '.md');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `${base}-${ts}.md`);
  try {
    if (fs.existsSync(targetFile)) {
      fs.copyFileSync(targetFile, backupFile);
    }
  } catch (e) {
    // Không chặn nếu sao lưu gặp lỗi nhỏ
  }

  // 2. Ghi đè dàn ý tối ưu mới vào targetFile
  fs.writeFileSync(targetFile, cleanText + '\n', 'utf8');

  // 3. Cập nhật snapshot để hệ thống verifyRevision nhận biết thay đổi
  try { snapshotOutline(book, scope); } catch { }

  return {
    ok: true,
    targetFile,
    fileName: path.basename(targetFile),
    backupFile,
    bytesWritten: Buffer.byteLength(cleanText, 'utf8')
  };
}

// 主流程：审一个 scope 的大纲，写审稿文件，返回 { file, editorModel, critique, optimizedOutline, fullText }。
export async function reviewOutline({ book, scope = '立项', cfg, authorModel, onLog = () => { } }) {
  const dir = book.dir;
  const bible = readSafe(path.join(dir, 'novel_bible.md'));
  const ofiles = outlineFilesFor(dir, scope);
  let outline = ofiles.map(f => `### ${path.basename(f)}\n` + readSafe(f)).join('\n\n').trim();
  
  // Tự động thích ứng cho sách mới hoặc phạm vi chưa có file dàn ý
  if (!outline) {
    if (bible && bible.trim().length > 50) {
      outline = `(Tác phẩm chưa có tệp dàn ý chi tiết trong outlines/ cho phạm vi 【${scope}】. Đây là giai đoạn khởi tạo. Đại Tổng Biên Tập hãy căn cứ vào Bối cảnh thiết lập [novel_bible.md] bên trên để trực tiếp phác thảo và xuất ra BẢN DÀN Ý TỐI ƯU & HAY NHẤT ở Phần 2!)`;
    } else {
      throw new Error('Chưa tìm thấy tệp dàn ý trong outlines/ hoặc thiết lập trong novel_bible.md để thẩm định.');
    }
  }

  const reviewsDir = path.join(dir, 'reviews');
  try { fs.mkdirSync(reviewsDir, { recursive: true }); } catch { }
  const file = path.join(reviewsDir, `大纲审稿-${safeName(scope)}.md`);
  const priorCritique = readSafe(file);

  // 逐个审稿人尝试：超时/失败/空返回就自动换下一个（治"某个审稿模型无头卡死→审稿门永远过不去"）。
  const prompt = buildEditorPrompt(book, scope, bible, outline, priorCritique);
  const timeout = cfg?.editorReview?.timeoutMs || 240000;
  const candidates = reviewerCandidates(authorModel, cfg);
  let raw = '', editorModel = candidates[0], lastErr = null;
  // 清掉 node 噪音行（gemini/qwen headless 常在 stdout 前面吐 (node:...) 实验性警告）。
  const strip = (s) => String(s || '').split('\n').filter(l => !/^\(node:\d+\)/.test(l) && !/ExperimentalWarning|EnvHttpProxyAgent|--trace-warnings/i.test(l)).join('\n').trim();
  // 无效审稿识别：CLI 用法/报错、未登录/未配置（qwen 常吐 "No auth type is selected"）、过短——都不能当审稿收下。
  const looksBad = (s) => {
    const t = strip(s);
    if (t.length < 120) return true;   // 正常审稿都几百字以上
    const head = t.slice(0, 600);
    if (/^(usage:|error\b|错误[:：]|unknown (option|argument|command)|invalid (option|argument|value)|missing required|参数错误|command not found|not recognized)/im.test(head)) return true;
    if (/(no auth type|not authenticated|configure an auth|--auth-type|please (configure|log ?in|sign ?in)|未(登录|认证|配置)|请先(登录|配置|设置))/i.test(head)) return true;
    return false;
  };
  for (const cand of candidates) {
    editorModel = cand;
    onLog({ level: 'act', msg: `Tổng biên tập（${cand}${cand === authorModel ? '·đồng mô hình độc lập' : ''}）đang thẩm định và tối ưu hóa dàn ý 【${scope}】…` });
    try {
      const out = await runModelOnceAsync(cand, prompt, cfg, timeout);
      const cleaned = strip(out);
      if (cleaned && !looksBad(out)) { raw = cleaned; lastErr = null; break; }
      lastErr = new Error(looksBad(out) ? 'Dấu hiệu CLI lỗi/chưa xác thực/kết quả không hợp lệ' : 'Kết quả thẩm định rỗng');
      onLog({ level: 'warn', msg: `Mô hình ${cand} xuất kết quả không hợp lệ (${lastErr.message}) → chuyển người thẩm định tiếp theo` });
    } catch (e) { lastErr = e; onLog({ level: 'warn', msg: `Mô hình ${cand} thẩm định thất bại (${e.message}) → chuyển người thẩm định tiếp theo` }); }
  }
  if (!raw) {
    // 所有审稿人都失败/无效 → 【自动放行】：写一份占位审稿让"审稿门"文件存在，作者据已有本卷大纲继续，绝不无限期卡死。
    const note = `Bản thẩm định tự động: Tất cả các mô hình thẩm định độc lập đều bận hoặc không phản hồi (Lỗi cuối: ${lastErr?.message || 'Không rõ'}).\nHệ thống tạm thời cho qua để không gián đoạn tiến độ. Tác giả tiếp tục bám sát mạch truyện và tính nhất quán.`;
    editorModel = '(Tự động cho qua · Không có mô hình độc lập)';
    fs.writeFileSync(file, `# Đại cương thẩm định（${scope}）\n\n> Thẩm định viên: ${editorModel} ｜ ${new Date().toISOString()}\n\n${note}\n`, 'utf8');
    onLog({ level: 'warn', msg: `Tất cả mô hình thẩm định thất bại → Tự động cho qua, tiếp tục quá trình` });
    return { file, editorModel, critique: note, optimizedOutline: '', fullText: note, passthrough: true };
  }

  const { critique, optimizedOutline } = splitReviewAndOptimizedOutline(raw);
  const header = `# Đại Cương Thẩm Định & Tối Ưu（${scope}）\n\n> Thẩm định: Tổng biên tập mô hình ${editorModel}（Tác giả: ${authorModel}）\n> Thời gian: ${new Date().toISOString()}\n\n`;
  fs.writeFileSync(file, header + raw + '\n', 'utf8');
  onLog({ level: 'info', msg: `Thẩm định hoàn tất → ${path.relative(dir, file)}` });

  return { file, editorModel, critique: critique || raw, optimizedOutline, fullText: raw };
}

// 给作者 agent 的「按审稿修订」单行指令（autopilot 注入用）。改完要先输出哨兵停下待核，不直接写正文。
export function buildReviseInstruction(book, scope, file) {
  const rel = path.relative(book.dir, file).replace(/[\r\n]+/g, ' ');
  const targetPath = targetOutlineFileFor(book.dir, scope);
  const targetRel = targetPath ? path.relative(book.dir, targetPath).replace(/[\r\n]+/g, ' ') : `outlines/`;
  const isVn = /[a-zA-Zà-ỹÀ-Ỹ]/.test(book.title || '');
  if (isVn) {
    return (`Tổng biên tập đã thẩm định và xuất bản dàn ý tối ưu tại ${rel}. ` +
      `Hãy đọc kỹ toàn bộ góp ý và bản dàn ý tối ưu, cập nhật trực tiếp vào tệp ${targetRel} (khắc phục triệt để các mục [Lỗi nghiêm trọng] và đồng bộ dàn ý tối ưu). ` +
      `LƯU Ý QUAN TRỌNG: Chỉ sửa trực tiếp vào tệp ${targetRel}, tuyệt đối không tự ý tạo thêm file quyển mới. `).replace(/[\r\n]+/g, ' ');
  }
  return (`主编已对【${scope}】大纲完成审稿并输出优化大纲，意见写在 ${rel}。请通读这份审稿与优化大纲，按其中【硬伤】/ [Lỗi nghiêm trọng] 逐条修订对应的 ${targetRel}（重点：节奏/格局升级、压缩事务流水、补爽点、伏笔回收、规模匹配，剔除自辩词），【隐患/建议】酌情采纳。修订完成后【先不要写正文】，在窗口单独输出一行「【大纲已修订：${scope}】」然后停下——系统会核对你是否确实改了大纲文件，核对通过后再开始写正文。`).replace(/[\r\n]+/g, ' ');
}

// 把主编审稿正文拆成【可逐条勾选】的意见项：[{id, severity, text}]。
// 认 `- [硬伤] …` / `* 【隐患】…` / `1. [建议] …` 这类行；【总评】行不算意见项。
export function parseReviewItems(critique) {
  const out = [];
  const lines = String(critique || '').split(/\r?\n/);
  const re = /^\s*(?:[-*·•]|\d+[.)、])?\s*[\[【]\s*(硬伤|隐患|建议|Lỗi nghiêm trọng|Nguy cơ tiềm ẩn|Gợi ý|Lỗi|Nguy cơ)\s*[\]】]\s*(.+?)\s*$/i;
  for (const ln of lines) {
    if (/^\s*[\[【]?\s*(总评|Đánh giá tổng thể)/i.test(ln)) continue;
    const m = ln.match(re);
    if (m && m[2] && m[2].trim().length >= 4) out.push({ id: 'r' + out.length, severity: m[1], text: m[2].trim() });
  }
  return out;
}

// 用户【逐条挑】后：只按选中的意见项生成一条修订指令（内联意见，作者无需回读整份审稿）。
// items: [{severity?, text}]，text 可能被用户手改过。
export function buildReviseFromItems(book, scope, items) {
  const picked = (items || []).map(i => (i && (i.text || '')).trim()).filter(Boolean);
  if (!picked.length) return `本次不采纳任何审稿意见、不改大纲，请按既有大纲继续写【${scope}】范围的正文。`;
  const list = picked.map((t, i) => `${i + 1}) ${t}`).join('；');
  return (`用户已从主编审稿里【挑定】以下 ${picked.length} 条意见要你采纳（仅此几条，其余一律不用管）：${list}。` +
    `请逐条打开 outlines/ 下【${scope}】对应的分章大纲（必要时 novel_bible.md），只按这几条修改并保存；改动尽量小而准，不要顺手重写没被点到的部分。` +
    `改完【先不要写正文】，在窗口单独输出一行「【大纲已修订：${scope}】」然后停下——系统会核对你确实改了文件，通过后再开写。`).replace(/[\r\n]+/g, ' ');
}

// 放行指令：核对通过，可以开写正文。
export function buildProceedInstruction(book, scope) {
  return `已核对：你的大纲/设定文件确有修订。现在按 longform-webnovel-writer 规范开始写【${scope}】范围的正文，每章对齐 beat 与章末钩子，写完做批次自检。`.replace(/[\r\n]+/g, ' ');
}
// 重催指令：文件没动，要求真正改文件。
export function buildRenudgeInstruction(book, scope) {
  return `系统核对发现 outlines/ 与 novel_bible.md 并未实际改动——这是要你【真正打开并修改大纲文件】、不是口头确认。请打开 outlines/ 下【${scope}】对应的分章大纲（必要时 novel_bible.md），按 reviews/大纲审稿-${safeName(scope)}.md 里的【硬伤】逐条修改并保存，改完再输出一行「【大纲已修订：${scope}】」。`.replace(/[\r\n]+/g, ' ');
}

// 读最近 n 章正文（按全局章号排序取末尾，即最接近结局的部分；总量截到 cap 字符）。
function readLastChapters(dir, n, cap) {
  const cdir = path.join(dir, 'chapters');
  const files = [];
  (function walk(d) { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.txt$/i.test(e.name)) files.push(p); } } catch { } })(cdir);
  files.sort((a, b) => (parseInt(path.basename(a)) || 0) - (parseInt(path.basename(b)) || 0));
  let out = '';
  for (const f of files.slice(-n)) out += `\n### ${path.basename(f)}\n` + readSafe(f);
  out = out.trim();
  if (cap && out.length > cap) out = out.slice(-cap);
  return out;
}

// 完本审稿 prompt：对照完本检查清单逐条核对，首行严格给"判定：可完本/未完本"。
function buildEndingPrompt(book, bible, ledger, ending) {
  return [
    `你是资深网文主编，正在对《${book.title}》做【完本审稿】——判断它现在是否真能"完结"，还是结局仓促、还有没收的线。只看硬指标，别说客套。`,
    ``,
    `# 设定圣经（长线弧光 / 主题 / 卖点 / 结局设想）`, bible || '（缺失）', ``,
    `# 连贯性台账（未回收伏笔 / 未了欠债 / 人物现状）`, ledger || '（缺失）', ``,
    `# 结局部分正文（最近若干章）`, ending || '（空）', ``,
    `# 完本检查清单（逐条核对）`,
    `1. 主线核心冲突是否真正解决（不是搁置/含糊带过）？`,
    `2. 主角弧光是否闭合、有明确结局或归宿？`,
    `3. 关键配角是否都有交代（胜负/生死/聚散），有没有人物凭空消失？`,
    `4. 台账里的重要伏笔、欠债、承诺是否已回收（或明确弃坑并交代）？`,
    `5. 反派 / 对抗势力是否已处置？`,
    `6. 开篇给读者的核心卖点 / 承诺是否兑现？`,
    `7. 结局有没有"为完结而完结"的仓促 / 烂尾感？大高潮是否写足？`,
    ``,
    `# 输出格式（严格）`,
    `第一行【只能】是：判定：可完本   或   判定：未完本`,
    `若未完本：从第二行起逐条列出"还差什么 → 需要补写什么（给到具体伏笔/人物/事件）"。`,
    `若可完本：第二行起一句话说明主线与关键伏笔均已收束。`,
  ].join('\n');
}

// 完本审稿：核对这本书是否真的可以完结。返回 { pass, body, file, editorModel }。
export async function reviewEnding({ book, cfg, authorModel, onLog = () => { } }) {
  const dir = book.dir;
  const bible = readSafe(path.join(dir, 'novel_bible.md'));
  const ledger = readSafe(path.join(dir, 'continuity_ledger.md'));
  const ending = readLastChapters(dir, cfg?.finale?.endingChapters || 10, 24000);
  const editorModel = pickEditorModel(authorModel, cfg);
  onLog({ level: 'act', msg: `主编（${editorModel}）完本审稿：核对主线/伏笔/人物是否真正收束…` });
  const raw = await runModelOnceAsync(editorModel, buildEndingPrompt(book, bible, ledger, ending), cfg, cfg?.editorReview?.timeoutMs || 180000);
  const out = (raw || '').trim();
  const pass = /判定[：:]\s*(可完本|通过)/.test(out) && !/判定[：:]\s*(未完本|不可完本|未通过)/.test(out);
  const file = path.join(dir, 'reviews', '完本审稿.md');
  try {
    fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
    fs.writeFileSync(file, `# 完本审稿\n\n> 审稿模型 ${editorModel}｜${new Date().toISOString()}｜判定：${pass ? '可完本' : '未完本'}\n\n` + out + '\n', 'utf8');
  } catch { }
  onLog({ level: pass ? 'info' : 'warn', msg: `完本审稿${pass ? '通过（可完本）' : '未通过（需补写结局）'} → ${path.relative(dir, file)}` });
  return { pass, body: out, file, editorModel };
}

// 完本审稿未过：退回作者继续补写结局。单行。
export function buildEndingRenudgeInstruction(book, file) {
  const rel = file ? path.relative(book.dir, file).replace(/[\r\n]+/g, ' ') : 'reviews/完本审稿.md';
  return `完本审稿认为结局尚未真正收束，仍有未了项写在 ${rel}。请按其中每一条继续【补写正文】：回收剩余伏笔、给未交代的人物结局、补全大高潮或结局；不要草草收尾，也不要只在台账里写"已解决"而正文没写。补完再输出一行「【完本待审】」等待复审。`.replace(/[\r\n]+/g, ' ');
}

// 复审重催指令：复审认定硬伤没改对，退回作者继续改。
export function buildRecheckRenudgeInstruction(book, scope, file) {
  const rel = file ? path.relative(book.dir, file).replace(/[\r\n]+/g, ' ') : ('reviews/大纲复审-' + safeName(scope) + '.md');
  return `主编复审了你改后的【${scope}】大纲，认定仍有【硬伤】没有真正解决，逐条写在 ${rel}。请按其中每一条继续修改 outlines/ 与 novel_bible.md（别只改字面、要真正解决问题），改完再输出一行「【大纲已修订：${scope}】」等待复审。`.replace(/[\r\n]+/g, ' ');
}

// 复审 prompt：对照上一轮【硬伤】，逐条核对改后大纲是否真解决。要求首行给严格判定。
function buildRecheckPrompt(book, scope, priorCritique, bible, outline) {
  return [
    `你是之前审过这本书大纲的资深网文主编。下面给你三样东西：①你上一轮的审稿意见（重点是其中的【硬伤】）②设定圣经 ③作者据你意见【改后】的大纲。`,
    `请只做一件事：逐条核对你上一轮指出的每一个【硬伤】，在改后的大纲里【是否已被真正解决】。不要夸奖、不要提新的小毛病，只盯硬伤改没改对。`,
    ``,
    `# 上一轮审稿意见`, priorCritique, ``,
    `# 设定圣经`, bible || '（缺失）', ``,
    `# 改后的大纲`, outline || '（空）', ``,
    `# 输出格式（严格遵守）`,
    `第一行【只能】是：判定：通过   或   判定：未通过`,
    `若未通过：从第二行起，逐条列出"仍未解决的硬伤 → 还需怎么改（给到卷/章号）"。`,
    `若通过：第二行起用一句话说明哪些硬伤已确认解决。`,
  ].join('\n');
}

// 主编二次复审改后大纲：对照原审稿的硬伤逐条核对。返回 { pass, body, file, editorModel }。
export async function recheckRevision({ book, scope = '立项', cfg, authorModel, onLog = () => { } }) {
  const dir = book.dir;
  const priorFile = path.join(dir, 'reviews', `大纲审稿-${safeName(scope)}.md`);
  const prior = readSafe(priorFile);
  if (!prior.trim()) return { pass: true, body: '（无原审稿意见，跳过复审）', file: null, editorModel: null };
  const bible = readSafe(path.join(dir, 'novel_bible.md'));
  const ofiles = outlineFilesFor(dir, scope);
  const outline = ofiles.map(f => `### ${path.basename(f)}\n` + readSafe(f)).join('\n\n').trim();

  const editorModel = pickEditorModel(authorModel, cfg);
  onLog({ level: 'act', msg: `主编（${editorModel}）复审【${scope}】改后大纲，核对硬伤是否真改对…` });
  const raw = await runModelOnceAsync(editorModel, buildRecheckPrompt(book, scope, prior, bible, outline), cfg, cfg?.editorReview?.timeoutMs || 180000);
  const out = (raw || '').trim();
  const pass = /判定[：:]\s*通过/.test(out) && !/判定[：:]\s*未通过/.test(out);

  const file = path.join(dir, 'reviews', `大纲复审-${safeName(scope)}.md`);
  try {
    fs.writeFileSync(file, `# 大纲复审（${scope}）\n\n> 复审模型 ${editorModel}｜${new Date().toISOString()}｜判定：${pass ? '通过' : '未通过'}\n\n` + out + '\n', 'utf8');
  } catch { }
  onLog({ level: pass ? 'info' : 'warn', msg: `复审${pass ? '通过' : '未通过'} → ${path.relative(dir, file)}` });
  return { pass, body: out, file, editorModel };
}

// —— 修订验证：审稿时给相关文件拍快照，作者改完后比对是否真的变了 ——
function relevantFiles(dir, scope) {
  return [path.join(dir, 'novel_bible.md'), ...outlineFilesFor(dir, scope)];
}
function hashFile(p) { const c = readSafe(p); let h = 0; for (let i = 0; i < c.length; i++) { h = (h * 31 + c.charCodeAt(i)) | 0; } return c.length + ':' + h; }
function snapPath(dir, scope) { return path.join(dir, '.studio', 'ol-snap-' + safeName(scope) + '.json'); }
export function snapshotOutline(book, scope) {
  const dir = book.dir;
  const sig = {};
  for (const f of relevantFiles(dir, scope)) sig[path.basename(f)] = hashFile(f);
  try { fs.mkdirSync(path.join(dir, '.studio'), { recursive: true }); fs.writeFileSync(snapPath(dir, scope), JSON.stringify(sig), 'utf8'); } catch { }
  return sig;
}
export function verifyRevision(book, scope) {
  const dir = book.dir;
  let prev = null;
  try { prev = JSON.parse(readSafe(snapPath(dir, scope)) || 'null'); } catch { }
  if (!prev) return { hadSnapshot: false, changed: false, changedFiles: [] };
  const changedFiles = [];
  for (const f of relevantFiles(dir, scope)) { const name = path.basename(f); if (prev[name] !== hashFile(f)) changedFiles.push(name); }
  return { hadSnapshot: true, changed: changedFiles.length > 0, changedFiles };
}
