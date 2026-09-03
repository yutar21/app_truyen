// 文风预设：每个含"怎么写"的具体规则，会被注入到该书的写作规范(AGENTS.md 等)，让 AI 照此腔调写。
export const STYLES = [
  {
    id: 'hardboiled', name: 'Lạnh lùng hiện thực (Hardboiled)',
    short: 'Tiết chế, câu ngắn, hành động & chi tiết thúc đẩy, không bi lụy sướt mướt',
    rules: '以短句和中句为主，克制不煽情；靠动作、物件、环境细节推进，少用形容词与抒情旁白；对白冷硬简短、留白多，潜台词靠停顿和动作传递；不解释情绪，让读者从细节里读出来。Câu văn cô đọng, hành động cụ thể, chi tiết chân thực.',
  },
  {
    id: 'classical', name: 'Cổ điển trang nhã (Classical)',
    short: 'Nửa văn nửa bạch, hình tượng tao nhã, chú trọng nhịp điệu biền ngẫu',
    rules: '半文半白、用词典雅；善用意象与白描，讲究句子的节奏与轻重缓急，偶有对仗但不堆砌；含蓄内敛，情感点到为止；用典适度且贴合人物身份，避免现代书面语与翻译腔。Văn phong trang trọng nhã nhặn, giàu hình tượng.',
  },
  {
    id: 'wuxia', name: 'Giang hồ khoái ý (Võ Hiệp)',
    short: 'Gọn gàng dứt khoát, hiệp khí hào sảng, chiêu thức sắc bén, đối thoại đã đời',
    rules: '行文干净利落、节奏明快；打斗有招式感与方位感、凌厉而清楚；对白爽利带侠气，重恩义与江湖规矩；叙述带一点说书人的劲道，但不滥用感叹，关键处一句顶十句。Tiết tấu nhanh, võ đấu rõ chiêu thức.',
  },
  {
    id: 'folk', name: 'Hài hước thị thành (Hài / Đời thường)',
    short: 'Đậm hơi thở đời thường, tiếng lóng châm biếm, nhịp điệu nhẹ nhàng hóm hỉnh',
    rules: '满是烟火气与生活细节；适度俚语、歇后语与调侃，节奏轻快；人物爱自嘲、互呛，机锋藏在家常话里；接地气不油滑，笑点从处境与性格里长出来，不硬挠。Hóm hỉnh, tự nhiên, gần gũi.',
  },
  {
    id: 'republican', name: 'Dân quốc cổ vận (Cận đại)',
    short: 'Phong vị hoài cổ, không khí thời đại bến Thượng Hải, xưng hô chuẩn xác',
    rules: '用旧派白话与合时代的称谓器物（先生、堂倌、大洋、号褂、洋行、巡捕房…）；温润考究、克制的怀旧气；洋场与旧城的声色气味要落到实处；忌现代词与翻译腔。Đúng ngữ cảnh thời đại.',
  },
  {
    id: 'epic', name: 'Chính kịch lịch sử mưu lược (Hùng tráng)',
    short: 'Thâm trầm sâu sắc, tự sự mượt mà, mưu lược đấu trí, thế cục thăng cấp theo quyển',
    rules: '写实厚重的底色，但叙事必须流畅好读、推进感强——靠人物、冲突、权谋博弈和抉择驱动情节，而不是靠账册、公文、流程、考据堆砌（器物与制度只作背景质感与筹码，不当主线）；句式有长有短、张弛有度，不要纯冷硬短句、也不要零抒情，关键处可放出气势与情绪；格局要层层推大，主角处境随卷可感升级，隔几章给读者一次可感的进展或胜利；用合时代的称谓器物，忌现代词与翻译腔。',
  },
  {
    id: 'noir', name: 'Huyền nghi sắc lạnh (Trinh thám / Ly kỳ)',
    short: 'Không khí ngột ngạt, nhử manh mối, đoạn văn dồn dập, cảm giác nguy cơ rình rập',
    rules: '营造阴冷压抑的氛围；严格控制信息释放，用悬念与"待查"逻辑牵着读者；段落短促、节奏收紧；细节即伏笔，叙述带不确定感与威胁感，不把话说满。Hồi hộp, thắt mở hợp lý.',
  },
  {
    id: 'hotblood', name: 'Nhiệt huyết sục sôi (Sảng văn / Huyền huyễn)',
    short: 'Cảm xúc bùng nổ, tiết tấu dồn dập, đập tan áp chế, sảng khoái',
    rules: '情绪与张力外放、节奏快；铺垫到位后在关键处集中爆发，给足爽感；动作与决断果断利落；但爆发前要压得住、有代价，不靠喊口号，靠处境把热血逼出来。Tiết tấu nhanh, giải phóng ức chế.',
  },
  {
    id: 'romance', name: 'Ngôn tình tinh tế (Tình cảm / Đô thị)',
    short: 'Miêu tả tâm lý tỉ mỉ, xúc cảm rung động, nhịp độ thư thả, nhiều ẩn ý',
    rules: '情绪与心理刻画细腻；感官描写（光、气味、触感、距离）服务于关系张力；节奏舒缓、留白与潜台词多；进展不抢，一个眼神一次迟疑都要有重量；忌直白说爱、忌甜到发腻。Tinh tế, rung động cảm xúc.',
  },
];

export function getStyle(id) { return STYLES.find(s => s.id === id) || null; }
export function styleVoice(style) {
  // style 可以是预设 id、预设对象、或自定义 {name, rules}
  if (!style) return null;
  if (typeof style === 'string') return getStyle(style);
  if (style.rules) return style;
  if (style.id) return getStyle(style.id);
  return null;
}
