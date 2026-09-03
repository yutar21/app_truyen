// 模型 CLI 支持：codex / claude / gemini / agy 的检测、启动命令、初始指令注入方式
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import path from 'node:path';

const AGY_BIN = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')
  : 'agy';

export const MODELS = {
  agy: {
    id: 'agy',
    name: 'Antigravity CLI (agy)',
    bin: AGY_BIN,
    untermAgentId: 'agy-cli',
    seedArgs: (instruction, cfg) => {
      const args = ['--effort', cfg?.agyEffort || 'high'];
      if (cfg?.agyModel) args.push('--model', cfg.agyModel);
      args.push('--print-timeout', '30m');
      args.push('-p', instruction, '--dangerously-skip-permissions', '--output-format', 'text');
      return args;
    },
    note: 'Google Antigravity CLI (agy). Dùng trực tiếp tài khoản Google AI Pro / Gemini (mặc định Gemini 3.8 Flash High).',
  },
  codex: {
    id: 'codex',
    name: 'Codex (OpenAI)',
    bin: 'codex',
    untermAgentId: 'codex-cli',
    // codex 接受首个位置参数作为初始指令。Windows 下其内置沙箱常 "spawn setup refresh" 失败，
    // 导致无法读写文件 → 默认加 --dangerously-bypass-approvals-and-sandbox（书目录是独立 git 仓库，
    // 由 autopilot 驱动，可接受）。可用 config.codexBypassSandbox=false 关闭。
    seedArgs: (instruction, cfg) => {
      const args = [];
      if (!cfg || cfg.codexBypassSandbox !== false) args.push('--dangerously-bypass-approvals-and-sandbox');
      args.push(instruction);
      return args;
    },
    note: '原生支持 ~/.codex/skills 的 longform-webnovel-writer；本书目录另有 AGENTS.md 双保险。',
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    untermAgentId: 'claude-code',
    seedArgs: (instruction, _cfg) => [instruction],
    note: '读取本书目录 CLAUDE.md 作为写作规范。',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI / Antigravity',
    bin: fs.existsSync(AGY_BIN) ? AGY_BIN : 'gemini',
    untermAgentId: 'gemini-cli',
    seedArgs: (instruction, cfg) => {
      const args = ['--effort', cfg?.agyEffort || 'high'];
      if (cfg?.agyModel) args.push('--model', cfg.agyModel);
      args.push('-p', instruction, '--dangerously-skip-permissions', '--output-format', 'text');
      return args;
    },
    note: '读取本书目录 GEMINI.md / AGENTS.md 作为写作规范。',
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba Qwen Code',
    bin: 'qwen',
    untermAgentId: 'qwen-code',
    seedArgs: (instruction, _cfg) => ['-i', instruction],
    note: 'Alibaba Qwen Code (nhánh gemini-cli). Đọc QWEN.md / GEMINI.md / AGENTS.md làm quy chuẩn sáng tác.',
  },
  trae: {
    id: 'trae',
    name: 'Trae (ByteDance)',
    bin: 'trae-cli',
    untermAgentId: 'trae-cli',
    seedArgs: (instruction, cfg) =>
      cfg && cfg.traeInteractive ? ['interactive'] : ['run', instruction],
    note: 'ByteDance Trae Agent CLI. Đọc AGENTS.md làm quy chuẩn sáng tác.',
  },
  'web-qwen': {
    id: 'web-qwen',
    name: 'Qwen Web (Miễn phí qua Unzoo)',
    kind: 'web',
    adapterId: 'qwen',
    note: 'Điều khiển trình duyệt qianwen.com viết truyện, dùng gói miễn phí.',
  },
  'web-doubao': {
    id: 'web-doubao',
    name: 'Doubao Web (Miễn phí qua Unzoo)',
    kind: 'web',
    adapterId: 'doubao',
    note: 'Điều khiển trình duyệt doubao.com viết truyện, tận dụng lượt miễn phí.',
  },
  'web-chatgpt': {
    id: 'web-chatgpt',
    name: 'ChatGPT Web',
    kind: 'web',
    adapterId: 'chatgpt',
    note: 'Điều khiển trình duyệt chatgpt.com viết truyện qua tài khoản đã đăng nhập trong Unzoo.',
  },
  'web-claude': {
    id: 'web-claude',
    name: 'Claude Web',
    kind: 'web',
    adapterId: 'claude',
    note: 'Điều khiển trình duyệt claude.ai viết truyện qua tài khoản Unzoo.',
  },
  'web-grok': {
    id: 'web-grok',
    name: 'Grok Web',
    kind: 'web',
    adapterId: 'grok',
    note: 'Điều khiển trình duyệt grok.com viết truyện qua Unzoo profile.',
  },
  'api-zhipu': {
    id: 'api-zhipu',
    name: 'Zhipu GLM (API · Miễn phí)',
    kind: 'api',
    provider: 'zhipu',
    note: 'Zhipu GLM API (open.bigmodel.cn). Khuyên dùng glm-4.5-flash. Điền API Key trong Cài Đặt để dùng.',
  },
  'api-deepseek': {
    id: 'api-deepseek',
    name: 'DeepSeek (API · Siêu rẻ / Văn hay)',
    kind: 'api',
    provider: 'deepseek',
    note: 'DeepSeek API (platform.deepseek.com). Văn phong xuất sắc, giá siêu rẻ. Điền API Key trong Cài Đặt để dùng.',
  },
  'api-dashscope': {
    id: 'api-dashscope',
    name: 'Thông Nghĩa Qwen (API DashScope)',
    kind: 'api',
    provider: 'dashscope',
    note: 'Alibaba DashScope API (qwen-plus/qwen-max). Điền API Key trong Cài Đặt để dùng.',
  },
  'api-bailian': {
    id: 'api-bailian',
    name: 'Bailian Flagship (Gói Đăng Ký Alibaba)',
    kind: 'api',
    provider: 'bailian',
    note: 'Alibaba Bailian Token Plan (qwen3.8-max / deepseek-v4-pro). Điền API Key trong Cài Đặt để dùng.',
  },
  'api-doubao': {
    id: 'api-doubao',
    name: 'Doubao (API ByteDance Volcengine)',
    kind: 'api',
    provider: 'doubao',
    note: 'ByteDance Volcengine API. Ngữ điệu mạng tự nhiên. Điền Endpoint ID và API Key trong Cài Đặt để dùng.',
  },
  'api-moonshot': {
    id: 'api-moonshot',
    name: 'Kimi / Moonshot (API · Văn bản dài)',
    kind: 'api',
    provider: 'moonshot',
    note: 'Moonshot API. Xử lý ngữ cảnh dài rất tốt, thích hợp làm bước rà soát / biên tập.',
  },
  'api-ernie': {
    id: 'api-ernie',
    name: 'ERNIE / Văn Tâm (API Baidu)',
    kind: 'api',
    provider: 'ernie',
    note: 'Baidu Qianfan API. Văn phong cổ trang, diễn đạt tự nhiên.',
  },
  'api-local': {
    id: 'api-local',
    name: '本地模型（Ollama·免费·离线）',
    kind: 'api',
    provider: 'local',
    note: '跑在本机，零成本零额度、断网可写、内容不出本机。中文网文选 Qwen 系（qwen3:14b 是 12G 显存的甜点档）；'
      + 'Gemma 中文有明显翻译腔、且不能出图，不建议用来写网文。先 `ollama pull qwen3:14b`，'
      + '再在「设置 · 本地模型」确认地址与模型名。跑 `novel local` 可按你的显卡出建议并体检。',
  },
};

export function getModel(id) {
  return MODELS[id] || MODELS[String(id || '').toLowerCase()];
}

// 检测某个 CLI 是否可用（在 PATH 中能解析到）
export function detectModel(id) {
  const m = getModel(id);
  if (!m) return { id, available: false, reason: '未知模型' };
  // 网页版模型：不靠 PATH 里的 CLI，可用性取决于运行时的 Unzoo profile（写作端校验）。
  // 这里直接判为 available，避免 where/which 把它误判为不可用。
  if (m.kind === 'web') {
    return { id: m.id, name: m.name, kind: 'web', adapterId: m.adapterId, bin: null, available: true, path: '', note: m.note };
  }
  // API 模型：可用性取决于是否配了该家 API Key（真正校验在写作端/设置里）。这里直接判 available，避免误判不可用。
  if (m.kind === 'api') {
    return { id: m.id, name: m.name, kind: 'api', provider: m.provider, bin: null, available: true, path: '', note: m.note };
  }
  if (m.bin && fs.existsSync(m.bin)) {
    return { id: m.id, name: m.name, bin: m.bin, available: true, path: m.bin, note: m.note, untermAgentId: m.untermAgentId };
  }
  const isWin = process.platform === 'win32';
  const probe = isWin
    ? spawnSync('where', [m.bin], { encoding: 'utf8' })
    : spawnSync('which', [m.bin], { encoding: 'utf8' });
  const path = (probe.stdout || '').trim().split(/\r?\n/)[0] || '';
  const available = probe.status === 0 && !!path;
  return { id: m.id, name: m.name, bin: m.bin, available, path, note: m.note, untermAgentId: m.untermAgentId };
}

export function detectAll() {
  return Object.keys(MODELS).map(detectModel);
}
