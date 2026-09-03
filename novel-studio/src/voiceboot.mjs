// 文风冷启动 —— 没有范本时怎么办。
//
// 【为什么不做"通用风格库"】
// 直觉的做法是内置几种风格（爽文快节奏 / 沉浸厚重 / 冷硬克制…），让作者选一个。
// 但那等于把开发者的审美换个包装塞回去：每条预设终究是我写的概括，
// 而抽象形容词一进提示词就退化成"多用短句、注重细节"这类放之四海皆准的废话——
// 正是之前那套规则失败的形态（实测：作者认可的样章，被我立的规则逐条判为毛病）。
//
// 这轮验证过的结论：【风格必须锚定在具体文本上，不能锚定在形容词上】。
// 手法卡之所以管用，是因为它每一条都带着范本里的原句。
//
// 所以冷启动不是"选一种风格"，而是【先造出范本】：
// 让模型按本书的题材写几个调性明显不同的开头，作者挑一个——挑中的那篇就是范本。
// 这同时解决了一个真问题：作者往往说不清自己要什么，但【看到了就知道要不要】。

import { runCowrite } from './cowrite.mjs';
import { getModel } from './models.mjs';
import { addRef, saveCard, readRefs, CARD_PROMPT } from './voiceprint.mjs';

// 候选调性。注意这里【只给"方向"不给"规则"】——
// 每一条都是一句话的取向，不是写作守则；真正的风格由模型写出来的样章本身承载。
// 作者看的是样章，不是这些标签。标签只是为了让几个候选拉开差距、别写成一个味道。
// 【为什么后来把"阅读节奏"也写进 hint】
// 头一版只按情绪腔调分（爽快/厚重/冷硬/带刺），实测四个候选出来是 31.9 / 45.8 / 20.9 / 45.5 字/段——
// 作者认可的网文范本是 16.2。也就是说【整份菜单都落在书面语区间，作者想挑网文腔都挑不到】。
// 换行密度是网文最显眼的一根轴，菜单不覆盖它，"让作者挑"就是假的选择。
// 注意这仍然不是"规则"：每条只是一句取向，作者看的是样章本身；
// 想要长段落厚文的人照样能挑「沉浸厚重」——菜单只负责把轴张开，不负责替他决定。
export const TONES = [
  { id: 'swipe', name: 'Lướt Nhanh Di Động', hint: 'Viết cho màn hình điện thoại: 1-2 câu ngắt dòng, khoảng trắng thoáng, mạch đọc cuốn hút lướt liên tục không dừng' },
  { id: 'fast',  name: 'Sảng Khoái Trực Diện', hint: 'Tiết tấu nhanh, tình tiết dồn dập, cảm xúc bùng nổ, hành động dứt khoát, giải quyết xung đột dứt điểm' },
  { id: 'thick', name: 'Trầm Luân Sâu Sắc', hint: 'Mô tả chi tiết, không khí huyền bí, bối cảnh hoành tráng, câu từ chau chuốt, kéo người đọc chìm đắm vào thế giới truyện' },
  { id: 'cold',  name: 'Lạnh Lùng Dứt Khoát', hint: 'Câu ngắn sắc bén, kìm nén cảm xúc, chú trọng động tác và tình huống thực chiến, phong thái sát thủ/cao thủ cô độc' },
  { id: 'wry',   name: 'Hài Hước Châm Biếm', hint: 'Văn phong hóm hỉnh, nhân vật thông minh, đối thoại dí dỏm tinh quái, tình huống khó khăn cũng biến thành thú vị' },
];

// 生成一个候选开头。
function draftPrompt({ seed, tone, words }) {
  const bits = [
    `Hãy viết một đoạn 【MỞ ĐẦU】 (khoảng ${words} từ) cho tiểu thuyết mạng sau đây:`,
    ``,
    `Tên tác phẩm: 《${seed.title}》`,
    seed.genre ? `Thể loại: ${seed.genre}` : '',
    seed.synopsis ? `Tóm tắt cốt truyện: ${seed.synopsis}` : '',
    ``,
    `【Tông giọng & Phong cách chủ đạo】: ${tone.name} — ${tone.hint}`,
    ``,
    `【YÊU CẦU NGÔN NGỮ QUAN TRỌNG NHẤT】:`,
    `1. 100% VIẾT BẰNG TIẾNG VIỆT CHUẨN MỰC, TUYỆT ĐỐI KHÔNG DÙNG TIẾNG TRUNG HOẶC CHỮ HÁN.`,
    `2. Văn phong tiểu thuyết mạng tiếng Việt hấp dẫn, mượt mà, dùng từ Hán-Việt huyền huyễn tự nhiên, chuẩn gu bạn đọc Việt Nam.`,
    `3. Tuyệt đối không xưng hô hiện đại kiểu "tôi, bạn, anh, chị, em". Xưng hô chuẩn phong cách tu chân/huyền huyễn: "ta, ngươi, hắn, nàng, công tử, thiếu gia...".`,
    `4. Mục tiêu duy nhất: Khiến người đọc vừa đọc xong đoạn mở đầu này là muốn đọc tiếp ngay.`,
    ``,
    `CHỈ XUẤT NỘI DUNG CHÍNH VĂN TIẾNG VIỆT, KHÔNG KÈM TIÊU ĐỀ, KHÔNG LỜI BÌNH HOẶC GIẢI THÍCH.`,
  ];
  return bits.filter(Boolean).join('\n');
}

// 一次生成 N 个候选（不同调性），供作者挑。
// 并发跑：候选之间互不依赖，串行只是白等。
// seed 只需要 { title, genre, synopsis } —— 【立项时书还没建】也能先把文风定下来。
export async function draftCandidates({ book, seed, model, tones = TONES, words = 700, cfg, onLog = () => {} }) {
  const s = seed || book || {};
  if (!s.title) throw new Error('先给个书名，AI 才知道要写什么的开头');
  const mName = getModel(model)?.name || model;
  onLog({ level: 'act', msg: `Dùng ${mName} tạo ${tones.length} mẫu văn phong mở đầu khác nhau (mỗi mẫu ~${words} từ tiếng Việt)…` });

  const jobs = tones.map(async (tone) => {
    try {
      const raw = await runCowrite(model, draftPrompt({ seed: s, tone, words }), cfg, 300000);
      const text = stripFence(raw);
      const wordCount = (text.trim().split(/\s+/).filter(Boolean).length);
      onLog({ level: 'info', msg: `  ✓ ${tone.name}（${wordCount} từ）` });
      return { ...tone, text, ok: !!text };
    } catch (e) {
      onLog({ level: 'warn', msg: `  ✗ ${tone.name}：${e.message || e}` });
      return { ...tone, text: '', ok: false, error: e.message || String(e) };
    }
  });
  const out = await Promise.all(jobs);
  return out.filter(x => x.ok);
}

// 作者选中某个候选 → 它就成为本书的第一份范本。
// 从此这本书的文风由它锚定，后续再有满意的章节可以继续加进去，书越写越像它自己。
export async function adoptCandidate(book, cand, { model, cfg, onLog = () => {} } = {}) {
  if (!cand || !cand.text) throw new Error('这个候选是空的');
  const file = addRef(book, `冷启动-${cand.name || '样章'}`, cand.text);
  // 顺手把手法卡也提出来。范本管"感觉"，手法卡管"能说清的那部分"——
  // 两个一起注入，比只有一段原文更稳。提炼失败不算错：范本本身已经够用了。
  if (model) {
    // 重试一次：Windows 上几个 CLI 并发跑完紧接着再起一个，npm 的 .cmd shim 偶发把自己的路径拼坏
    // （报成 'claude.exe' 不是内部或外部命令）。单纯的偶发，重来一次就好。
    for (let i = 0; i < 2; i++) {
      try {
        await deriveCard(book, { model, cfg });
        onLog({ level: 'info', msg: '  ✓ 已从这段样章提炼出手法卡' });
        break;
      } catch (e) {
        if (i === 0) continue;
        onLog({ level: 'warn', msg: '  手法卡提炼失败（不影响写作，范本已生效）：' + (e.message || e) });
      }
    }
  }
  return file;
}

// 让模型读本书现有范本、自己写一份手法卡。走 runCowrite，所以 CLI 模型一样能用。
export async function deriveCard(book, { model, cfg } = {}) {
  const refs = readRefs(book, { totalMax: 9000, preferLater: false });
  if (!refs.length) throw new Error('还没有范本，先挂几段文字或选一章设为范本');
  const body = refs.map(x => `—— 《${x.name}》 ——\n${x.text}`).join('\n\n');
  const out = stripFence(await runCowrite(model, CARD_PROMPT + '\n\n' + body, cfg, 300000));
  if (!out) throw new Error('模型没给出手法卡');
  saveCard(book, out);
  return out;
}

// CLI 模型偶尔会把正文裹进 ``` 里，或在前面客套一句。去壳，别把这些脏东西存成范本。
function stripFence(raw) {
  let t = String(raw || '').trim();
  const fence = t.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  return t;
}
