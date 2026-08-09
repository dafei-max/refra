import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { searchDesignInspiration } from "./services/inspiration/index.mjs";
import { getInspirationImage, ImageProxyError } from "./services/inspiration/image-proxy.mjs";
import {
  MAX_IMAGE_BYTES,
  detectImageType,
  ImageSourceError,
  extensionForType,
  resolveImageBytes,
  resolveLocalSource,
} from "./services/image-source-resolver.mjs";
import {
  StorageError,
  initStorage,
  storageBackend,
  storageDelete,
  storageExists,
  storageGet,
  storagePut,
  storageSignUrl,
} from "./services/storage-adapter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIEF_PROMPT_URL = new URL("./Brief理解.md", import.meta.url);
const DESIGN_PROMPT_URL = new URL("./设计判断.md", import.meta.url);

const PORT = Number(process.env.PORT || 5173);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const TEXT_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_TEXT_MAX_OUTPUT_TOKENS || 4096);
const PIPELINE_MODE = process.env.PIPELINE_MODE === "quality" ? "quality" : "fast";
const FAST_PIPELINE = PIPELINE_MODE === "fast";
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || (FAST_PIPELINE ? "low" : "");

function modeFlag(name, qualityDefault = true) {
  const value = textOf(process.env[name]).trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return qualityDefault ? !FAST_PIPELINE : false;
}

const ENABLE_BRIEF_LLM = modeFlag("ENABLE_BRIEF_LLM");
const ENABLE_CREATIVE_LLM = process.env.ENABLE_CREATIVE_LLM !== "false";
const ENABLE_REFERENCE_LLM_RERANK = modeFlag("ENABLE_REFERENCE_LLM_RERANK");
const ENABLE_DESIGN_LLM = modeFlag("ENABLE_DESIGN_LLM");
const ENABLE_PREFLIGHT_LLM = modeFlag("ENABLE_PREFLIGHT_LLM");
const ENABLE_POST_IMAGE_REVIEW = modeFlag("ENABLE_POST_IMAGE_REVIEW");
const CREATIVE_EVIDENCE_IMAGE_LIMIT = Math.max(0, Number(process.env.CREATIVE_EVIDENCE_IMAGE_LIMIT || (FAST_PIPELINE ? 3 : 6)));
const CREATIVE_EVIDENCE_IMAGE_DETAIL = process.env.CREATIVE_EVIDENCE_IMAGE_DETAIL || (FAST_PIPELINE ? "low" : "high");

const PUBLIC_DIR = path.join(__dirname, "public");
const ASSET_DIR = path.join(__dirname, "素材资产库图片素材");
const IMAGE_DIR = path.join(__dirname, "image");
const STYLE_DIR = path.join(__dirname, "style");
const DOUDOU_DIR = path.join(__dirname, "兜兜");
const CREATIVE_METHODS_DIR = path.join(__dirname, "creative_methods");
const DESIGN_CASES_DIR = path.join(__dirname, "case");
const IS_VERCEL =
  process.env.VERCEL === "1" ||
  Boolean(process.env.VERCEL_URL) ||
  __dirname === "/var/task" ||
  __dirname.startsWith("/var/task/");
const RUNTIME_ROOT = IS_VERCEL ? path.join(tmpdir(), "refra") : __dirname;
const PACKAGED_UPLOAD_ROOT = path.join(__dirname, "uploads");
const UPLOAD_ROOT = path.join(RUNTIME_ROOT, "uploads");
const OUTPUT_DIR = path.join(RUNTIME_ROOT, "outputs");
const STORAGE = initStorage({ isVercel: IS_VERCEL, runtimeRoot: RUNTIME_ROOT });
const IS_OSS = storageBackend() === "oss";
const ADMIN_TOKEN = textOf(process.env.ADMIN_TOKEN).trim();
const MAX_UPLOAD_BYTES = Math.max(1024 * 1024, Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024));
const MAX_JSON_BYTES = Math.max(64 * 1024, Number(process.env.MAX_JSON_BYTES || 2 * 1024 * 1024));
// Vercel 平台对总请求体有约 850KB 的实测上限，超限直接返回 503（不会进入函数）。
// 前端已把参考图压缩进该预算，这里做服务端兜底校验。
const MAX_REFERENCE_UPLOAD_BYTES = 600 * 1024;
const RATE_LIMIT_RUN_PER_MIN = Math.max(1, Number(process.env.RATE_LIMIT_RUN_PER_MIN || 3));
const RATE_LIMIT_EXPAND_PER_MIN = Math.max(1, Number(process.env.RATE_LIMIT_EXPAND_PER_MIN || 10));
const RATE_LIMIT_SEARCH_PER_MIN = Math.max(1, Number(process.env.RATE_LIMIT_SEARCH_PER_MIN || 10));
const RATE_LIMIT_WRITE_PER_MIN = Math.max(1, Number(process.env.RATE_LIMIT_WRITE_PER_MIN || 20));
if (IS_VERCEL && !ADMIN_TOKEN) {
  throw new Error(
    "ADMIN_TOKEN 未配置：请在 Vercel 环境变量中设置 ADMIN_TOKEN，用于保护生成与写接口；"
    + "本地开发未设置时跳过鉴权。",
  );
}
const UPLOAD_DIR = path.join(UPLOAD_ROOT, "materials");
const REFERENCE_UPLOAD_DIR = path.join(UPLOAD_ROOT, "references");
const STYLE_UPLOAD_DIR = path.join(UPLOAD_ROOT, "styles");
const LOGO_DARK_BG_PATH = path.join(IMAGE_DIR, "Group.png");
const LOGO_LIGHT_BG_PATH = path.join(IMAGE_DIR, "Group 2147242265.png");
const LOGO_WIDTH = 200;
const LOGO_LEFT = 40;
const LOGO_TOP = 40;
const SEARCH_LIGHT_BG_PATH = path.join(IMAGE_DIR, "search_light.png");
const SEARCH_DARK_BG_PATH = path.join(IMAGE_DIR, "search_dark.png");
const SEARCH_WIDTH = 295;
const SEARCH_RIGHT = 44;
const SEARCH_BOTTOM = 22;
const PACKAGED_MATERIALS_PATH = path.join(__dirname, "data", "materials.json");
const MATERIALS_PATH = IS_VERCEL
  ? path.join(RUNTIME_ROOT, "data", "materials.json")
  : PACKAGED_MATERIALS_PATH;
const PACKAGED_CUSTOM_STYLES_PATH = path.join(__dirname, "data", "style-presets.json");
const CUSTOM_STYLES_PATH = IS_VERCEL
  ? path.join(RUNTIME_ROOT, "data", "style-presets.json")
  : PACKAGED_CUSTOM_STYLES_PATH;
const PYTHON_BIN = process.env.PYTHON_BIN || "/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const AUTO_ART_DIRECTOR_RETRY = modeFlag("AUTO_ART_DIRECTOR_RETRY");
const ART_DIRECTOR_RETRY_LIMIT = 1;
const INTEGRATED_LAYOUT_DECORATION_STRUCTURE_RULE = "装饰结构采用闭集继承：先逐项观察参考图中真实存在的引号、括号、下划线、框线、标签底形、角标、色块、分隔线和装饰符号；只允许复现参考图实际存在的类型，并严格继承其数量、大小关系、相对位置和视觉样式。参考图中不存在的结构一律禁止新增，尤其不得为了强调文字自行添加下划线、引号、括号、边框、标签、角标、强调线或其他装饰笔画";
const INTEGRATED_LAYOUT_DECORATIVE_COPY_RULE = "文字内容采用用户输入白名单：画面中只能出现用户明确填写的主标题、副标题和活动时间，且必须逐字准确。参考图中的英文眉题、栏目短语、主题翻译、口号、说明、地点、品牌、版权、年份、日期、辅助信息及其他可读文字，只要没有对应的用户输入字段，就必须删除；禁止保留、照抄、改写、联想、补全或用近义文案占位。可以按参考图保留真实存在的非文字装饰结构，但被删除文字所在位置必须恢复为干净留白，不能出现任何字母、数字、汉字或乱码";
const INTEGRATED_LAYOUT_DECORATION_RULE = `${INTEGRATED_LAYOUT_DECORATION_STRUCTURE_RULE}；${INTEGRATED_LAYOUT_DECORATIVE_COPY_RULE}`;

const SIZE_MAP = {
  "16:9": "1536x864",
  "9:16": "864x1536",
  "3:4": "960x1280",
  "4:3": "1280x960",
  "1:1": "1024x1024",
};

const TYPE_STRATEGY = {
  "字体": ["information_hierarchy", "typography_strategy"],
  "构图": ["layout_outline", "subject_relationship", "main_visual_subject", "visual_keywords"],
};

const MATERIAL_TYPES = ["字体", "构图"];
const REFERENCE_ROLES = ["完整案例", "字体标题", "构图版式", "风格质感", "元素主体", "色彩氛围", "场景空间"];
const LEGACY_REFERENCE_ROLE_MAP = {
  "完整案例": "完整案例",
  "字体": "字体标题",
  "字体标题": "字体标题",
  "构图": "构图版式",
  "构图版式": "构图版式",
  "风格": "风格质感",
  "质感": "风格质感",
  "风格质感": "风格质感",
  "元素": "元素主体",
  "主体": "元素主体",
  "元素主体": "元素主体",
  "色彩": "色彩氛围",
  "氛围": "色彩氛围",
  "色彩氛围": "色彩氛围",
  "场景": "场景空间",
  "空间": "场景空间",
  "场景空间": "场景空间",
};
const NO_PRESET_ID = "none";
const HAND_DRAWN_PRESET_ID = "hand_drawn_flat_doodle_v1";
const THREE_D_PRESET_ID = "three_d_style_v1";
const OUTLINE_PRESET_ID = "outline_style_v1";
const MINIMAL_FLAT_PRESET_ID = "minimal_flat_illustration_v1";
const REAL_PRODUCT_PRESET_ID = "real_product_poster_v1";
const REAL_PERSON_PRESET_ID = "real_person_poster_v1";
const IMAGE_FILE_RE = /\.(png|jpe?g|webp)$/i;
const DOUDOU_THUMB_URL = "/doudou/6视图/22-1.png";

const CLAY_PRESET = {
  preset_id: "clay_fun_activity_poster_v1",
  preset_name: "黏土萌趣活动海报预设",
  style_group: "3D黏土/萌趣/活动海报",
  aspect_ratio_recommend: ["3:4", "4:5", "9:16"],
  applicable_categories: ["生活方式", "宠物", "食品饮品", "户外", "环保公益", "市集活动", "咖啡", "节气主题"],
  output_type: "活动海报 / 营销KV / 社交传播海报",
  shared_style: {
    visual_style: ["3D黏土质感", "萌趣可爱", "轻手工捏塑感", "哑光材质", "圆润造型", "活动海报化构图"],
    composition_rules: ["左上角固定品牌区", "顶部为大标题区，标题占画面较大比例", "中部或中下部为主视觉主体区", "底部/角落可放补充信息", "背景尽量纯净，避免复杂远景"],
    color_rules: ["使用单一高识别背景色", "主体颜色数量控制在2-4种", "画面要清爽、明亮、对比清晰"],
    object_rules: ["主视觉以1组核心角色/物件为主", "搭配2-5个辅助道具", "避免元素过多导致拥挤"],
    texture_rules: ["角色与道具具有统一黏土/软陶手作质感", "保留轻微手工纹理与圆润边缘", "不做写实金属或过强高光"],
  },
  pet_character_style_constraint: {
    enabled: true,
    description: "宠物角色必须采用抽象变形的设计化IP造型，而不是写实动物造型。",
    positive_prompt: [
      "抽象变形的宠物IP角色",
      "潮玩公仔风格",
      "软胶玩具质感",
      "designer toy",
      "vinyl toy",
      "stylized animal character",
      "character design",
      "大头小身",
      "短肢圆润",
      "几何化概括",
      "极简五官",
      "符号化表情",
      "身体由简单圆润团块组成",
      "纯净色块分区",
      "光滑或半哑光表面",
      "具有品牌吉祥物感",
      "像可收藏的设计师玩具摆件",
    ],
    negative_prompt: [
      "不要写实宠物",
      "不要真实猫狗比例",
      "不要真实毛发细节",
      "不要复杂毛流",
      "不要真实动物解剖结构",
      "不要宠物摄影感",
      "不要自然动物插画感",
      "不要过度拟真皮肤和毛发",
    ],
  },
  title_variants: [
    {
      variant_id: "title_a_black_clay",
      file: "Frame 2147238620.png",
      style_name: "黑色粗黏土字",
      features: ["黑色粗体", "厚重手写感", "有体积感", "活泼随性"],
      best_for: ["生活方式", "宠物", "轻社交"],
    },
    {
      variant_id: "title_b_brown_outline",
      file: "Frame 2147238621.png",
      style_name: "棕色大字白边贴纸风",
      features: ["棕色厚重字形", "外轮廓白边", "像裁切贴纸", "户外感强"],
      best_for: ["户外", "露营", "自然生活"],
    },
    {
      variant_id: "title_c_green_outline",
      file: "Frame 2147238622.png",
      style_name: "绿色环保大字",
      features: ["绿色主标题", "白边包裹", "积极、明快、公益感"],
      best_for: ["环保", "公益", "城市活动", "亲子"],
    },
    {
      variant_id: "title_d_black_mix_lang",
      file: "Frame 2147238623.png",
      style_name: "黑色随性手写大字",
      features: ["参考中文主标题的黑色粗手写笔画", "笔画圆润厚重但不规则", "顶部大标题自由排布", "标题节奏更松弛活泼", "不复制参考图英文 EAT"],
      prompt_note: "只参考参考图中「入夏仪式感」中文主标题的黑色随性手写笔画、粗细变化、自由排布和大标题识别度；不要复制或生成参考图里的 EAT 或其他英文，除非用户明确提供英文标题；不要变成常规黑体、宋体、细线手写体或硬朗科技字体。",
      best_for: ["食品", "节气", "夏日活动"],
    },
    {
      variant_id: "title_e_white_bubble",
      file: "Frame 2147238624.png",
      style_name: "圆润泡泡白字",
      features: ["白色泡泡大字", "轻颗粒喷点", "社交传播感强", "年轻化"],
      best_for: ["咖啡", "市集", "快闪", "联名活动"],
    },
  ],
};

const SCRAPBOOK_PRESET = {
  preset_id: "scrapbook_collage_poster_v1",
  preset_name: "手帐拼贴风格预设",
  style_group: "手帐拼贴/scrapbook/notebook/journal/paper collage",
  aspect_ratio_recommend: ["3:4", "4:5", "9:16"],
  applicable_categories: ["生活方式", "宠物", "咖啡", "日常主题", "校园活动", "人物内容", "纪念主题", "展览", "互联网主题", "创意活动"],
  output_type: "活动海报 / 营销KV / 社交传播海报 / 手帐记录页",
  reference_base: "style",
  reference_dir: "手帐拼贴",
  shared_style: {
    visual_style: ["手帐拼贴风", "纸质感", "笔记页布局", "图文混合排版", "生活记录感", "随手整理但有设计感", "notebook / scrapbook / collage"],
    texture_rules: [
      "保留纸张纹理、印刷感、轻微颗粒",
      "可出现活页孔、线圈、胶带、夹子、票据、贴纸、便签等真实文具物件",
      "允许照片、截图、插画、裁切图、票据、小物件混搭",
      "整体不能过于干净无痕，要有轻微手工整理痕迹",
    ],
    layout_rules: [
      "标题必须是第一视觉信息",
      "页面以一张主底纸或大背景纸为承载面",
      "中部需有一个主模块（主图/主物件/主照片/主信息板）",
      "周围分布若干辅助模块，用标签、便签、线条、票据、图钉等连接",
      "整体像被精心整理的一页手帐，而不是整齐的UI界面",
    ],
    content_rules: ["允许图文并置", "允许混合材质和信息层级", "允许一张主图 + 多个碎片信息", "信息之间要形成记录感和浏览路径"],
    mood: ["轻松", "生活感", "记录感", "有温度", "社交传播友好"],
  },
  scene_expansion_schema: {
    background_base: "底纸类型，例如网格纸、笔记本纸、纯色纸、档案纸",
    main_module: "主视觉核心，例如一张大照片、一页资料封面、一件核心物品、一位人物、一张主卡片",
    secondary_modules: "2-5个辅助模块，例如照片、小卡片、贴纸、小图标、小票据、小截图",
    decor_elements: "胶带、回形针、图钉、长尾夹、印章、划线、箭头、圈画、标签、贴纸",
    text_labels: "时间签、小标题、小注释、英文点缀、日期、地点、标签",
    layout_path: "用户浏览路径，标题->主模块->辅助模块->底部说明",
    material_mix: "纸张、照片、插画、截图、票据、物件混搭方式",
    color_strategy: "主色调、辅助色、强调色",
  },
  scene_expansion_rules: [
    "不要把所有内容都做成同一级元素，必须有主次",
    "先确定一张主底纸或主承载面",
    "必须有一个主模块作为视觉中心",
    "辅助模块控制在2-5个，大量零碎小元素控制在5-10个以内",
    "新增元素必须服务主题，不要无意义堆贴纸",
    "文字和物件要形成拼贴关系，而不是整齐的PPT排版",
    "允许元素轻微倾斜、错位、叠压，增强手工整理感",
    "可加入适量英文、时间签、标签增强生活记录感，但不能过度杂乱",
  ],
  title_variants: [
    {
      variant_id: "scrap_grid_daily_journal",
      file: "Frame 2147238625.png",
      style_name: "网格手帐日程页",
      features: ["网格纸底", "顶部或上方大标题", "多个时间点标签", "模块化信息卡", "票据、照片、贴纸、小图标混合", "像一天的手帐记录页"],
      best_for: ["生活方式", "宠物", "咖啡", "日常主题", "兴趣计划", "城市生活提案"],
    },
    {
      variant_id: "scrap_bright_campus_diary",
      file: "Frame 2147238638.png",
      style_name: "亮色校园日记",
      features: ["高饱和纯色底", "顶部大号手写英文或中文标题", "中间主主体非常突出", "辅以贴纸、3D小物件、图标", "青春、校园、栏目封面感强"],
      best_for: ["校园活动", "学生招募", "栏目封面", "青春主题", "人物内容", "社团活动"],
    },
    {
      variant_id: "scrap_archive_folder",
      file: "Frame 2147238639.png",
      style_name: "档案册资料夹拼贴",
      features: ["资料夹/封面本作为主模块", "配合照片、红线、夹子、纸条、标注", "纸感强、层次丰富", "像一个主题档案页或纪念册"],
      best_for: ["纪念主题", "展览", "青春主题", "历史/文化活动", "主题策展", "项目专题"],
    },
    {
      variant_id: "scrap_photo_diary_page",
      file: "Frame 2147238640.png",
      style_name: "照片日记页",
      features: ["人物或主照片为核心", "搭配便签、印章、线条、纸片", "标题像写在纸页上", "像一页个人日记或生活记录板"],
      best_for: ["人物主题", "分享类活动", "生活记录", "情绪类内容", "UGC征集", "内容专题"],
    },
    {
      variant_id: "scrap_lofi_digital_collage",
      file: "Frame 2147238654.png",
      style_name: "低保真数字拼贴页",
      features: ["纸面拼贴 + 数字界面元素混搭", "选择框、鼠标箭头、像素化图像、小窗口", "标题简洁但有实验感", "有轻微荒诞和幽默感"],
      best_for: ["互联网主题", "脑洞内容", "创意活动", "青年社群", "实验性栏目", "数字生活主题"],
    },
  ],
};

const Y3K_PRESET = {
  preset_id: "y3k_cyber_fashion_poster_v1",
  preset_name: "Y3K风格预设",
  style_group: "Y3K/未来时尚/黑银金属/数字编辑/赛博档案",
  aspect_ratio_recommend: ["3:4", "4:5", "9:16"],
  applicable_categories: ["穿搭指南", "潮流活动", "配饰种草", "时尚栏目", "人物专题", "未来科技", "虚拟偶像", "派对活动"],
  output_type: "人物穿搭指南 / 时尚编辑海报 / 营销KV / 数字档案卡",
  reference_base: "style",
  reference_dir: "y3k",
  visual_keywords: ["Y3K", "未来感", "黑银金属", "高光反射", "时尚编辑", "人物穿搭指南", "数字界面", "赛博档案", "超频派对", "Cyber Fashion", "Metallic Editorial", "Digital Lookbook"],
  shared_style: {
    visual_style: ["Y3K未来时尚", "黑银金属质感", "高反光材质", "数字编辑感", "人物穿搭指南", "时尚杂志封面", "赛博档案界面"],
    color_rules: [
      "主色以黑、银、灰、白为核心",
      "可加入少量高亮蓝、红、粉、荧光色作为点缀",
      "背景可使用黑色渐变、金属灰渐变、冷蓝科技底或白底数据界面",
      "整体色彩不要过于彩虹化，保持冷感和高级感",
    ],
    texture_rules: [
      "强调金属反光、银色高光、塑料透明材质、镜面材质、闪光颗粒",
      "可使用噪点、扫描纹、屏幕纹理、镜头闪光",
      "标题和装饰线需要有锋利、切割、反光感",
      "服装材质可强调皮革、银色亮面、尼龙、透明塑料、金属配件",
    ],
    composition_rules: [
      "人物是第一主体",
      "标题是第二视觉重点",
      "局部特写框用于展示穿搭细节",
      "标注线连接人物身上的关键单品",
      "画面允许斜切、叠压、错位、透视面板",
      "整体像一张时尚编辑指南，而不是普通人像海报",
    ],
    mood: ["酷", "锐利", "未来", "时髦", "高频", "银色科技感", "派对感", "杂志大片感"],
  },
  title_style: {
    style_name: "银色金属锐利标题",
    features: ["银白色金属质感", "斜体或拉伸字体", "尖角笔画", "高速运动感", "切割感", "高光反射", "类似未来时尚杂志标题", "可带轻微拖影、光泽、拉丝纹理"],
    layout: ["标题可位于顶部横向铺开", "也可位于底部作为大号视觉签名", "标题允许压在人像或照片框上", "字形要有强烈视觉冲击", "中文标题建议做成大面积主标题，不要变成普通说明文字"],
    avoid: ["不要普通宋体", "不要圆润可爱字体", "不要手帐风手写字", "不要厚重POP字", "不要传统电商大字报"],
  },
  fashion_character_constraint: {
    enabled: true,
    positive_prompt: ["fashion editorial model", "Y3K styling", "metallic outfit", "high-gloss accessories", "transparent sunglasses", "silver jewelry", "black leather", "glossy nylon", "cyber fashion", "sharp pose", "magazine cover attitude", "high-fashion styling"],
    negative_prompt: ["不要普通自拍感", "不要生活照随拍感", "不要过度甜美可爱", "不要传统韩系写真", "不要普通电商模特图", "不要朴素穿搭", "不要自然光生活照"],
  },
  annotation_templates: ["银色高亮点缀", "高光亮面阔腿裤", "多层次银光单品", "透明感护目镜", "金属链条配饰", "亮面未来感手袋", "黑色皮革背心", "赛博感运动鞋", "冷感银色妆容", "Y3K核心单品"],
  annotation_rules: ["每张图建议使用2-4条标注", "标注应该指向具体服装或配饰", "标注文字要短，不要长句", "标注线要细，避免抢主视觉", "文字可使用白色、银色或浅灰色", "不要生成大量不可读的小字"],
  scene_expansion_rules: [
    "人物必须是画面核心，不要被背景或文字抢掉",
    "至少突出2-3个穿搭亮点",
    "穿搭亮点需要用细线标注或局部特写框展示",
    "标题必须具备银色金属锐利感",
    "画面要像时尚编辑页，不要像普通证件照或人像写真",
    "可加入搜索框、品牌胶囊、数据框、编号、条形码等信息模块",
    "如果用户上传人物图，尽量保留人物姿态和主要造型，但重构海报版式",
    "如果用户未上传人物图，可以生成虚构时尚人物，但不要指向真实名人",
    "整体信息量可以较高，但必须保持高级感和清晰主次",
  ],
  title_variants: [
    {
      variant_id: "y3k_black_silver_fit_guide",
      file: "Frame 2147238641.png",
      style_name: "黑银主视觉穿搭指南",
      features: ["黑银渐变背景", "人物大图位于中心", "背后叠加矩形照片框", "左侧或局部出现穿搭细节特写", "顶部或中上方放银色大标题", "底部放搜索框/话题胶囊"],
      best_for: ["穿搭指南", "单人造型海报", "潮流活动封面", "配饰种草", "Y3K主题派对"],
    },
    {
      variant_id: "y3k_silver_lookbook_panel",
      file: "Frame 2147238642.png",
      style_name: "银色单品Lookbook面板",
      features: ["人物全身造型为主", "背后有大块蓝灰或银色矩形背景面板", "局部小照片框展示发型或单品", "细线标注穿搭亮点", "标题可放在底部或侧下方", "整体偏时尚杂志Lookbook"],
      best_for: ["单品搭配", "全身穿搭展示", "时尚栏目", "服装品牌活动", "人物穿搭拆解"],
    },
    {
      variant_id: "y3k_flash_portrait_cover",
      file: "Frame 2147238643.png",
      style_name: "闪光人像封面",
      features: ["大面积人物照片作为核心", "黑灰渐变背景", "人物服装有强烈银色反光", "少量标注线指出关键单品", "银色标题置于底部", "可加入闪光点、镜面高光"],
      best_for: ["人物封面", "时尚大片", "银色单品主题", "高光材质穿搭", "潮流人物专题"],
    },
    {
      variant_id: "y3k_cyber_archive_card",
      file: "Frame 2147238644.png",
      style_name: "赛博档案数据卡",
      features: ["白色或浅蓝数字界面背景", "大号黑色或蓝色未来字体", "人物位于中心", "周围有条形码、坐标、编号、数据框", "像未来档案卡或任务资料页", "更偏Cyber Editorial"],
      best_for: ["数字主题", "未来科技", "虚拟偶像", "赛博人物设定", "潮流栏目封面", "科技感活动"],
    },
  ],
};

const STYLE_PRESETS = [
  {
    id: NO_PRESET_ID,
    name: "默认",
    subtitle: "不套预设",
    preset_id: NO_PRESET_ID,
    thumbnail: "",
  },
  {
    id: THREE_D_PRESET_ID,
    name: "3D风格",
    subtitle: "立体潮流质感",
    preset_id: THREE_D_PRESET_ID,
    thumbnail: "/style/3D%E9%A3%8E%E6%A0%BC/%E9%A3%8E%E6%A0%BC/style1.png",
  },
  {
    id: MINIMAL_FLAT_PRESET_ID,
    name: "极简扁平插画",
    subtitle: "留白极简插画",
    preset_id: MINIMAL_FLAT_PRESET_ID,
    thumbnail: "/style/%E6%9E%81%E7%AE%80%E6%89%81%E5%B9%B3%E6%8F%92%E7%94%BB/%E9%A3%8E%E6%A0%BC/style1.jpg",
  },
  {
    id: REAL_PRODUCT_PRESET_ID,
    name: "实景商品",
    subtitle: "明快商品海报",
    preset_id: REAL_PRODUCT_PRESET_ID,
    thumbnail: "/style/%E5%AE%9E%E6%99%AF%E5%95%86%E5%93%81/%E9%A3%8E%E6%A0%BC/style1.png",
  },
  {
    id: REAL_PERSON_PRESET_ID,
    name: "真实人物",
    subtitle: "潮流人物海报",
    preset_id: REAL_PERSON_PRESET_ID,
    thumbnail: "/style/%E7%9C%9F%E5%AE%9E%E4%BA%BA%E7%89%A9/%E9%A3%8E%E6%A0%BC/sytle1.jpg",
  },
];

const HAND_DRAWN_PRESET = {
  preset_id: HAND_DRAWN_PRESET_ID,
  preset_name: "手绘扁平涂鸦风格预设",
  style_group: "手绘扁平涂鸦 / flat doodle / playful illustration / bold color poster",
  aspect_ratio_recommend: ["16:9", "3:4", "4:3", "1:1"],
  output_type: "活动海报 / 营销KV / 插画传播海报",
  reference_base: "style",
  reference_dir: "手绘扁平涂鸦",
  shared_style: {
    visual_style: ["手绘扁平插画", "涂鸦感", "卡通人物或物件", "粗线条", "鲜明色块", "轻松幽默", "社交传播海报"],
    composition_rules: ["画面必须有明显留白", "只保留一个核心主体或一组核心关系", "辅助元素少量点缀", "标题与主体分区清楚", "不做过多细碎内容"],
    color_rules: ["使用明快高识别色块", "背景可以是纯色或少量扁平形状", "主体色彩鲜明但不混乱", "整体保持干净通透"],
    texture_rules: ["扁平数字插画", "手绘线条", "轻微涂鸦笔触", "不要写实摄影", "不要复杂3D渲染", "不要厚重材质堆叠"],
  },
  title_style: {
    style_name: "手写涂鸦标题字",
    features: ["手写感", "粗笔画", "轻松随性", "字形有节奏变化", "可高对比", "标题必须清晰可读"],
    avoid: ["不要普通系统黑体", "不要复杂书法", "不要金属锐利字", "不要自动新增英文", "不要细碎小字堆叠"],
  },
  reference_groups: [
    { id: "font", role: "字体", label: "字体参考", dir: "字体" },
    { id: "style", role: "风格", label: "风格参考", dir: "风格" },
  ],
  scene_expansion_rules: [
    "画面要有留白，不做过多细碎的内容",
    "主视觉主体必须明确，辅助元素控制在2-5个以内",
    "严禁增加无关文字信息，不自动新增品牌、口号、英文、日期、价格或标签",
    "如果用户提到时间，时间必须和标题字体做在一块儿，作为标题组的一部分，不得散落在其他区域",
    "整体更像扁平手绘传播海报，不做写实摄影、复杂远景或过度装饰",
  ],
};

const THREE_D_PRESET = {
  preset_id: THREE_D_PRESET_ID,
  preset_name: "3D风格预设",
  style_group: "3D立体 / 潮流产品视觉 / 玩具化渲染 / 商业海报",
  aspect_ratio_recommend: ["3:4", "4:3", "16:9", "1:1"],
  output_type: "活动海报 / 营销KV / 3D视觉海报",
  reference_base: "style",
  reference_dir: "3D风格",
  shared_style: {
    visual_style: ["3D渲染", "立体潮流视觉", "玩具化产品表现", "商业海报构图", "高识别主体", "趣味场景化"],
    composition_rules: ["标题区、主体区和辅助信息区分区清楚", "主视觉主体突出", "根据排版参考保留留白", "元素数量克制，避免细碎堆叠"],
    color_rules: ["使用明快高识别主色", "辅助色控制在2-4种", "整体色彩统一干净", "避免高饱和混乱配色"],
    texture_rules: ["参考3D风格图的材质、体积、边缘和商业完成度", "允许软胶、塑料、金属、布纹、颗粒、透明材质等", "光影统一，主体清晰"],
  },
  title_style: {
    style_name: "潮流标题字",
    features: ["标题清晰可读", "参考文字图的字形、字重和排版节奏", "主标题为第一信息层级"],
    avoid: ["不要复制参考图具体文字", "不要新增英文", "不要生成无关日期、价格、口号"],
  },
  reference_groups: [
    { id: "integrated_layout", role: "整合版式", label: "整合版式参考", dir: "整合版式", count: 1 },
    { id: "style", role: "风格", label: "风格参考", dir: "风格", count: 1 },
    { id: "element", role: "元素", label: "元素参考", dir: "元素", count: 1 },
    { id: "character", role: "角色", label: "角色参考", dir: "角色", count: 1, when: "character" },
  ],
  scene_expansion_rules: [
    "画面要有留白，不做过多细碎的内容",
    "主视觉主体必须明确，辅助元素只服务主题",
    "严禁增加无关文字信息，不自动新增品牌、口号、英文、日期、价格或标签",
    "如果用户提到时间，时间必须和标题字体做在一块儿，作为标题组的一部分",
    "整体保持3D商业海报完成度，主体材质、光影和空间关系统一",
  ],
};

const REAL_PRODUCT_PRESET = {
  preset_id: REAL_PRODUCT_PRESET_ID,
  preset_name: "实景商品预设",
  style_group: "实景商品 / 商业摄影 / 写实CG / 明快冲击型商品海报",
  aspect_ratio_recommend: ["3:4", "4:3", "16:9", "1:1", "9:16"],
  output_type: "商品海报 / 营销KV / 品类促销图 / 产品发布图 / 社交媒体广告",
  reference_base: "style",
  reference_dir: "实景商品",
  shared_style: {
    visual_style: ["实体商品主视觉", "写实商业摄影", "写实3D或摄影CG合成", "明快商业色彩", "单一视觉焦点", "具有尺度、镜头或动势冲击"],
    composition_rules: ["商品是第一视觉焦点", "一个画面只设置一个主焦点", "多商品必须建立主商品、次商品、功能道具和氛围元素层级", "主商品轮廓完整清晰", "场景和道具只解释商品功能、使用环境、季节或情绪", "标题和商品关键结构互不遮挡"],
    color_rules: ["使用一组主色、一组辅助色和少量强调色", "商品与背景在明度或冷暖上清晰分离", "整体明快、干净、通透", "商品颜色丰富时简化背景", "保留中性色或低饱和色作为视觉缓冲"],
    texture_rules: ["商品结构、比例、接口、屏幕、镜头和包装可信", "商业摄影保留真实触感和自然景深", "写实3D保持材质、轮廓光和透视统一", "摄影与CG合成需统一光源、色温、阴影和景深", "通过硬软、粗糙光滑或透明不透明建立材质层级"],
    mood: ["明快", "可信", "精致", "有冲击力", "商业传播", "第一眼识别商品"],
  },
  title_style: {
    style_name: "商业商品海报标题",
    features: ["标题缩略图可读", "参考字体图的字形、笔画和排版节奏", "与商品共同构成一级信息但不争夺同一视觉中心", "副标题和日期保持清晰次级层级"],
    avoid: ["不要复制参考图具体文字或颜色", "不要遮挡商品品牌、屏幕、镜头、接口和包装关键结构", "不要自动新增英文、价格、卖点、口号或规则文字"],
  },
  reference_groups: [
    { id: "integrated_layout", role: "整合版式", label: "整合版式参考", dir: "整合版式", count: 1 },
    { id: "style", role: "风格", label: "风格参考", dir: "风格", count: 1 },
  ],
  scene_expansion_rules: [
    "商品必须是画面第一视觉焦点，一个画面只设置一个主焦点",
    "主商品建议占有效画面面积30%-65%，极端特写可提高到70%-85%",
    "多商品必须建立主商品、次商品、功能道具和氛围元素的明确层级",
    "场景必须解释商品功能、使用方式、季节或品牌气质，禁止无目的装饰",
    "每张图只选择1-2种冲击手段，例如尺度反差、镜头透视、悬浮动势、材质反差或冷暖对撞",
    "严禁增加用户未提供的品牌、英文、价格、促销卖点、口号、日期或规则文字",
    "商品结构、比例、接口、屏幕、镜头、包装和核心功能部位必须可信且不被遮挡",
  ],
};

const REAL_PERSON_PRESET = {
  preset_id: REAL_PERSON_PRESET_ID,
  preset_name: "真实人物预设",
  style_group: "真实人物 / 商业人像摄影 / 潮流人物海报 / 生活方式营销KV",
  aspect_ratio_recommend: ["3:4", "4:3", "16:9", "1:1", "9:16"],
  output_type: "人物海报 / 营销KV / 潮流活动视觉 / 生活方式传播海报",
  reference_base: "style",
  reference_dir: "真实人物",
  shared_style: {
    visual_style: ["真实人物商业摄影", "潮流杂志视觉", "生活方式叙事", "人物营销海报", "社交传播感", "高完成度人像KV"],
    composition_rules: ["人物是第一视觉中心", "人物面部、身体轮廓、服装层次和动作清晰可辨", "人物姿态、服装、道具与主题场景产生明确关联", "标题、人物与背景建立清晰层级", "标题不得遮挡人物面部和关键服装", "根据整合版式保留真实主视觉空白区域"],
    color_rules: ["建立主色、辅助色和少量点缀色", "文字、服装、道具与场景色彩形成呼应", "人物服装复杂时简化背景与文字", "保持人物肤色自然、场景色温统一并确保人物与背景分离"],
    texture_rules: ["保留真实摄影光影与服装材质", "避免过度磨皮、塑料皮肤和明显AI合成质感", "人物与背景光源、色温、阴影和景深统一", "允许真实摄影、写实CG或编辑式拼贴，但人物身份与五官结构必须稳定"],
    mood: ["真实", "潮流", "有态度", "有场景叙事", "商业可用", "社交传播"],
  },
  title_style: {
    style_name: "商业人物海报标题",
    features: ["标题清晰可读", "严格继承整合版式参考的字形、比例、位置、对齐和层级", "标题与人物形成稳定视觉关系"],
    avoid: ["不要遮挡人物面部或关键服装", "不要复制参考图原文字", "不要无依据新增英文、日期、价格、口号或品牌"],
  },
  reference_groups: [
    { id: "integrated_layout", role: "整合版式", label: "整合版式参考", dir: "整合版式", count: 1 },
    { id: "style", role: "风格", label: "风格参考", dir: "风格", count: 1 },
  ],
  scene_expansion_rules: [
    "人物必须是画面第一视觉中心，面部、身体轮廓、服装和动作清晰可辨",
    "优先使用自然且与主题存在叙事关系的动作，避免证件照式僵硬站姿",
    "保留人物真实比例、完整肢体和稳定五官结构；避免手部畸形、肢体重复、五官错位、过度磨皮和塑料皮肤",
    "如果用户上传人物主体图，必须以该图为身份与外观主参考，保留人物身份、脸部特征、发型和主要服装，不得替换成其他人物",
    "场景只服务人物、主题和营销信息，辅助元素数量克制，不遮挡人物面部、手部或服装关键部位",
    "只呈现用户明确提供的文字，不新增无来源品牌、英文、日期、价格、口号或说明文字",
  ],
};

const THREE_D_PERSON_PERSPECTIVE_CONSTRAINT = {
  // Perspective is selected from the brief and the chosen layout reference.
  // Do not globally force fisheye shots or oversized foreground anchors.
  enabled: false,
  trigger_keywords: ["人物", "真人", "模特", "女生", "女孩", "男生", "男孩", "小女孩", "小男孩", "人像", "穿搭", "手持", "手掌", "脚掌", "鞋底", "腿部", "身体", "滑板", "冲浪", "运动", "跳跃", "跑步", "角色"],
  camera_options: [
    "8mm 超广角低机位",
    "10mm 鱼眼仰拍",
    "贴地低角度仰拍",
    "脚底 POV 视角",
    "手掌前景 POV 视角",
    "滑板底部仰视视角",
    "身体从画面外冲入的动态视角",
    "近景肢体遮挡主体的压迫式构图",
  ],
  foreground_anchor_options: [
    "巨大的鞋底",
    "巨大的手掌",
    "巨大的脚掌",
    "巨大的滑板",
    "巨大的手机",
    "巨大的运动鞋鞋带",
    "巨大的冲浪板",
    "巨大的袖子",
    "巨大的腿部弧线",
  ],
  body_abstraction_rules: ["头部偏小", "脸部极简或无五官", "四肢被拉长", "手掌和鞋子巨大化", "躯干短小", "腿部像软管一样弯曲", "手臂像橡胶一样延展", "整体像软胶玩具或潮流雕塑"],
  motion_options: [
    "身体斜向穿过画面",
    "一条腿伸向镜头",
    "一只手伸出画面",
    "身体形成 S 型扭转",
    "人物从画面边缘冲入",
    "人物被镜头拉伸成近大远小",
    "多个肢体形成环绕动线",
    "道具形成白色线条或轨迹穿插画面",
  ],
  scene_rules: ["纯色背景 + 抽象曲线", "网格背景 + 立体人物", "海浪 / 山谷 / 滑板坡道制造纵深", "巨大白色线条穿插前后景", "少量漂浮道具强化速度感", "背景保持干净，不堆砌元素"],
};

const OUTLINE_PRESET = {
  preset_id: OUTLINE_PRESET_ID,
  preset_name: "描边风格预设",
  style_group: "粗描边插画 / Flat cartoon illustration / Playful poster",
  aspect_ratio_recommend: ["3:4", "4:3", "16:9", "1:1"],
  output_type: "活动海报 / 营销KV / 插画传播海报",
  reference_base: "style",
  reference_dir: "描边风格",
  shared_style: {
    visual_style: ["粗描边插画", "扁平卡通", "明快色块", "趣味涂鸦", "社交传播海报", "清晰主体"],
    composition_rules: ["标题区、主体区和留白区清楚", "主体居中或按排版参考摆放", "辅助元素数量克制", "避免复杂远景和细碎堆叠"],
    color_rules: ["使用明快背景色和高对比描边", "主体颜色鲜明但统一", "控制辅助色数量", "避免脏乱混色"],
    texture_rules: ["平面插画质感", "粗线条描边", "干净色块", "少量涂鸦装饰", "不要写实摄影和复杂3D材质"],
  },
  title_style: {
    style_name: "手绘粗描边标题字",
    features: ["标题粗壮醒目", "手写感或卡通感", "字形清晰可读", "层级明确"],
    avoid: ["不要细字体", "不要金属锐利字", "不要复制参考图具体文字", "不要新增英文"],
  },
  reference_groups: [
    { id: "font", role: "字体", label: "文字参考", dir: "文字" },
    { id: "style", role: "风格", label: "风格参考", dir: "风格" },
  ],
  scene_expansion_rules: [
    "画面要有留白，不做过多细碎的内容",
    "主视觉主体明确，辅助元素控制在2-5个以内",
    "严禁增加无关文字信息，不自动新增品牌、口号、英文、日期、价格或标签",
    "如果用户提到时间，时间必须和标题字体做在一块儿，作为标题组的一部分",
    "整体采用粗描边扁平插画，不做写实摄影、复杂3D或厚重材质",
  ],
};

const MINIMAL_FLAT_PRESET = {
  preset_id: MINIMAL_FLAT_PRESET_ID,
  preset_name: "极简扁平插画预设",
  style_group: "极简扁平插画 / Minimal flat illustration / Clean poster / Soft editorial illustration",
  aspect_ratio_recommend: ["3:4", "4:3", "16:9", "1:1", "9:16"],
  output_type: "活动海报 / 营销KV / 极简插画传播海报",
  reference_base: "style",
  reference_dir: "极简扁平插画",
  shared_style: {
    visual_style: ["极简扁平插画", "干净留白", "低复杂度构图", "清晰主体", "柔和色块", "轻量图形语言", "现代传播海报"],
    composition_rules: ["画面必须有大面积留白", "只保留一个核心主体或一组核心关系", "辅助元素数量克制", "标题区、主体区和留白区清楚", "避免复杂远景、拥挤场景和碎片化装饰"],
    color_rules: ["使用低复杂度配色", "主色控制在1-2个", "辅助色控制在2-3个", "色块干净、柔和、对比清晰", "避免脏色、渐变过多和高饱和混乱配色"],
    texture_rules: ["平面色块", "简洁轮廓", "少量柔和阴影或无阴影", "轻微纸感或数字插画感", "不要写实摄影", "不要复杂3D渲染", "不要厚重材质和高反射"],
  },
  pet_character_style_constraint: {
    enabled: true,
    description: "宠物角色必须采用极简扁平卡通IP造型，而不是写实宠物照片或自然动物比例。",
    positive_prompt: [
      "极简扁平宠物IP角色",
      "flat stylized animal character",
      "cartoon mascot",
      "abstract cute pet icon",
      "rounded simple silhouette",
      "大头圆身",
      "短肢圆润",
      "几何化身体",
      "极简五官",
      "符号化表情",
      "粗细稳定的干净轮廓线",
      "纯净色块填充",
      "低细节",
      "无真实毛发",
      "像品牌吉祥物或贴纸角色",
    ],
    negative_prompt: [
      "不要写实宠物",
      "不要宠物摄影",
      "不要真实猫狗比例",
      "不要真实毛发细节",
      "不要复杂毛流",
      "不要真实眼球高光",
      "不要真实鼻子皮肤纹理",
      "不要自然动物解剖结构",
      "不要照片级质感",
      "不要拟真皮毛",
    ],
  },
  title_style: {
    style_name: "极简插画标题字",
    features: ["标题清晰可读", "字形简洁", "字重稳定", "信息层级明确", "可结合少量手写感或现代无衬线气质"],
    avoid: ["不要复杂字体特效", "不要金属锐利字", "不要厚重POP字", "不要自动新增英文", "不要细碎小字堆叠"],
  },
  reference_groups: [
    { id: "integrated_layout", role: "整合版式", label: "整合版式参考", dir: "整合版式", count: 1 },
    { id: "style", role: "风格", label: "风格参考", dir: "风格", count: 1 },
    { id: "element", role: "元素", label: "元素参考", dir: "元素", count: 1 },
    { id: "character", role: "角色", label: "角色参考", dir: "角色", count: 1, when: "character" },
  ],
  scene_expansion_rules: [
    "画面必须有明显留白，不做过多细碎内容",
    "主视觉主体必须明确，辅助元素控制在1-4个以内",
    "严禁增加无关文字信息，不自动新增品牌、口号、英文、日期、价格或标签",
    "如果用户提到时间，时间必须和标题字体做在一块儿，作为标题组的一部分",
    "整体采用极简扁平插画，不做写实摄影、复杂3D、厚重材质或拥挤场景",
  ],
};

function safeSlug(value, fallback = "style") {
  const slug = textOf(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `${fallback}_${Date.now()}`;
}

function styleUrl(...parts) {
  return `/style/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

function linesOf(value) {
  return textOf(value)
    .split(/[\n,，、；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readSidecarDescription(filePath) {
  const stem = filePath.replace(/\.[^.]+$/, "");
  const descriptionPath = [".md", ".txt"]
    .map((extension) => `${stem}${extension}`)
    .find((candidate) => existsSync(candidate));
  if (!descriptionPath) return "";
  return readFileSync(descriptionPath, "utf-8").trim();
}

function parseYamlScalar(value = "") {
  const source = value.trim();
  if (!source) return "";
  if (source === "true") return true;
  if (source === "false") return false;
  if (source === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(source)) return Number(source);
  if ((source.startsWith('"') && source.endsWith('"')) || (source.startsWith("'") && source.endsWith("'"))) {
    return source.slice(1, -1);
  }
  if (source.startsWith("[") && source.endsWith("]")) {
    try { return JSON.parse(source.replace(/'/g, '"')); } catch { return source; }
  }
  return source;
}

function parseYamlBlock(lines, start = 0, indent = 0) {
  const first = lines[start]?.trim() || "";
  const container = first.startsWith("- ") ? [] : {};
  let index = start;
  while (index < lines.length) {
    const raw = lines[index];
    if (!raw.trim() || raw.trim().startsWith("#")) { index += 1; continue; }
    const currentIndent = raw.match(/^\s*/)?.[0].length || 0;
    if (currentIndent < indent) break;
    if (currentIndent > indent) { index += 1; continue; }
    const line = raw.trim();
    if (Array.isArray(container)) {
      if (!line.startsWith("- ")) break;
      const itemSource = line.slice(2).trim();
      // A list item is an object only when the colon is followed by whitespace
      // (or ends the line). This keeps quoted or bare ratios such as "3:4"
      // as scalar values instead of misreading them as YAML key/value pairs.
      const objectMatch = itemSource.match(/^([^:]+):(?:\s+(.*))?$/);
      if (!objectMatch) {
        container.push(parseYamlScalar(itemSource));
        index += 1;
        continue;
      }
      const item = {};
      item[objectMatch[1].trim()] = parseYamlScalar(objectMatch[2] || "");
      let next = index + 1;
      while (next < lines.length && !lines[next].trim()) next += 1;
      const nextIndent = lines[next]?.match(/^\s*/)?.[0].length || 0;
      if (next < lines.length && nextIndent > currentIndent) {
        const parsed = parseYamlBlock(lines, next, nextIndent);
        if (parsed.value && !Array.isArray(parsed.value)) Object.assign(item, parsed.value);
        index = parsed.index;
      } else {
        index += 1;
      }
      container.push(item);
      continue;
    }
    const match = line.match(/^([^:]+):(?:\s*(.*))?$/);
    if (!match) { index += 1; continue; }
    const key = match[1].trim();
    const rest = match[2] || "";
    if (rest.trim()) {
      container[key] = parseYamlScalar(rest);
      index += 1;
      continue;
    }
    let next = index + 1;
    while (next < lines.length && !lines[next].trim()) next += 1;
    const nextIndent = lines[next]?.match(/^\s*/)?.[0].length || 0;
    if (next < lines.length && nextIndent > currentIndent) {
      const parsed = parseYamlBlock(lines, next, nextIndent);
      container[key] = parsed.value;
      index = parsed.index;
    } else {
      container[key] = {};
      index += 1;
    }
  }
  return { value: container, index };
}

function parseFrontMatter(markdown = "") {
  const source = textOf(markdown).trim();
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return { metadata: {}, body: source };
  const lines = match[1].split(/\r?\n/);
  const parsed = parseYamlBlock(lines, 0, 0).value;
  return { metadata: parsed && !Array.isArray(parsed) ? parsed : {}, body: source.slice(match[0].length).trim() };
}

function readOptionalText(filePath) {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8").trim();
}

function findSiblingImage(filePath) {
  const stem = filePath.replace(/\.[^.]+$/, "");
  return [".png", ".jpg", ".jpeg", ".webp"]
    .map((extension) => `${stem}${extension}`)
    .find((candidate) => existsSync(candidate)) || "";
}

function knowledgeTitle(markdown = "", fallback = "") {
  return textOf(markdown).match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function compactKnowledge(markdown = "", maxLength = 2200) {
  const source = textOf(markdown)
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (source.length <= maxLength) return source;
  return `${source.slice(0, maxLength).replace(/[，。；、\s]+$/u, "")}…`;
}

function splitReferenceKnowledge(markdown = "") {
  const source = textOf(markdown).trim();
  if (!source) return { positive: "", negative: "", sections: [] };
  const headingKeywords = /(一句话总结|总结|定位|视觉|风格|造型|结构|字形|笔画|字重|标题长度|横版|竖版|适用|优势|镜头|机位|构图|动势|动作|情绪|色彩|配色|材质|光影|空间|层级|留白|主体|元素|比例|场景|风险|禁用|不适用|禁止|避免|负向|限制)/;
  const sections = [];
  let current = { heading: "概述", body: [] };
  const flush = () => {
    const body = current.body.join("\n").trim();
    if (body) sections.push({ heading: current.heading, body });
  };
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const isMarkdownHeading = /^#{1,6}\s+/.test(line);
    const isNumberedHeading = /^(?:\d+(?:\.\d+)*|[一二三四五六七八九十]+)[.、．)）]\s*\S+/.test(line);
    const cleanedHeading = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:\d+(?:\.\d+)*|[一二三四五六七八九十]+)[.、．)）]\s*/, "")
      .replace(/[：:]$/, "")
      .trim();
    const isNamedHeading = cleanedHeading.length <= 28 && headingKeywords.test(cleanedHeading);
    if (isMarkdownHeading || isNumberedHeading || isNamedHeading) {
      flush();
      current = { heading: cleanedHeading || "说明", body: [] };
      continue;
    }
    current.body.push(line.replace(/^[-*]\s+/, ""));
  }
  flush();
  if (!sections.length) sections.push({ heading: "概述", body: source });
  const isNegative = (heading) => /(风险|禁用|不适用|禁止|避免|负向|限制)/.test(heading);
  return {
    positive: sections.filter((section) => !isNegative(section.heading)).map((section) => `${section.heading}\n${section.body}`).join("\n\n"),
    negative: sections.filter((section) => isNegative(section.heading)).map((section) => `${section.heading}\n${section.body}`).join("\n\n"),
    sections,
  };
}

function summarizeReferenceDescription(markdown = "") {
  if (!markdown) return "";
  const { sections } = splitReferenceKnowledge(markdown);
  const priorities = [
    /一句话总结|总结|定位/,
    /适用/,
    /视觉|风格|造型|结构/,
    /镜头|机位|构图|空间|层级|留白/,
    /动势|动作|情绪/,
    /色彩|配色|材质|光影/,
    /字形|笔画|字重|标题长度|横版|竖版/,
    /主体|元素|比例|场景/,
    /优势/,
    /风险|禁用|不适用|禁止|避免|负向|限制/,
  ];
  const ranked = sections
    .map((section, index) => ({
      ...section,
      index,
      priority: priorities.findIndex((pattern) => pattern.test(section.heading)),
    }))
    .sort((a, b) => {
      const aPriority = a.priority < 0 ? priorities.length : a.priority;
      const bPriority = b.priority < 0 ? priorities.length : b.priority;
      return aPriority - bPriority || a.index - b.index;
    });
  return compactKnowledge(ranked.map((section) => `${section.heading}\n${section.body}`).join("\n\n"), 2200);
}

function referenceExecutionDescription(markdown = "", role = "") {
  if (!markdown) return "";
  const rolePatterns = {
    "字体": /(整体结构|字形结构|中文字形|英文字形|辅助文字结构|笔画形态|笔画节奏|当前字重|标题长度|竖版适配|横版适配|字面|端点|收笔|转折)/,
    "日期": /(字形结构|^\d*(?:\.\d+)*\s*笔画$|^\d*(?:\.\d+)*\s*字重$|排版结构|版式节奏|主标题的排版关系|字体搭配|信息层级)/,
  };
  const pattern = rolePatterns[role];
  if (!pattern) return "";
  const selected = splitReferenceKnowledge(markdown).sections
    .filter((section) => pattern.test(section.heading))
    .map((section) => `${section.heading}：${section.body}`)
    .join("\n");
  const source = selected || markdown;
  const excluded = /(背景色|背景颜色|色彩|配色|蓝色背景|白色背景|红色背景|高饱和蓝|荧光黄绿|品牌|logo|水印|原文案)/i;
  const signature = [];
  if (role === "字体") {
    if (/(方正.{0,8}宽扁|宽扁.{0,8}方正)/.test(markdown)) signature.push("中文字形整体方正宽扁、字面率大、结构饱满");
    if (/(字与字之间距离较紧|字距.{0,6}紧)/.test(markdown)) signature.push("字距紧密，标题形成连续块面");
    if (/(笔画粗壮|超粗字重|Heavy|Extra Bold)/i.test(markdown)) signature.push("超粗近等线笔画，横竖均厚重");
    if (/(粗细变化不大|笔画.{0,8}接近)/.test(markdown)) signature.push("笔画粗细变化很小");
    if (/(圆角或钝角|端点.{0,8}钝|转角.{0,8}圆)/.test(markdown)) signature.push("笔画主体保持平直厚实，收笔以截平或钝角为主，仅转角轻微圆化；不是全圆胶囊笔画，边缘保留轻微手绘抖动");
    if (/(内部结构.{0,12}简化|复杂结构.{0,12}压缩)/.test(markdown)) signature.push("复杂汉字内部结构压缩简化但保持可读");
    if (/(竖版.{0,80}拆为两行|竖版.{0,80}拆成两行)/s.test(markdown)) signature.push("竖版长标题拆成两行，保持大字冲击与呼吸感");
    if (/(辅助文字.{0,80}粗圆体|辅助文字.{0,80}粗黑体|英文\/辅助文字结构)/s.test(markdown)) signature.push("辅助文字使用更规整的粗圆或无衬线字，与主标题形成明显层级差");
  }
  if (role === "日期") {
    if (/(现代无衬线|几何感明显)/.test(markdown)) signature.push("现代几何无衬线数字，字腔开放");
    if (/(细体至常规体|依靠字号建立视觉重量)/.test(markdown)) signature.push("细至常规字重，依靠字号和位置建立层级");
    if (/(竖向短线连接|短竖线连接)/.test(markdown)) signature.push("可用短竖线表达日期跨度");
    if (/(水平线框定|水平线夹住)/.test(markdown)) signature.push("可用细水平分隔线收束时间信息");
    if (/(时间模块应保持次级属性|明显字号差)/.test(markdown)) signature.push("日期模块低于主标题，并与标题保持明确字号差");
  }
  const cleaned = source
    .split(/(?<=[。；])|\n+/)
    .map((line) => line.replace(/^[-*\d.、)）\s]+/, "").trim())
    .filter((line) => line && !excluded.test(line))
    .join(" ")
    .replace(/“[^”]{1,48}”/g, "")
    .replace(/(?:纯|高饱和|低饱和|荧光|深|浅|亮|暗|粗)?(?:红|橙|黄|绿|青|蓝|紫|粉|黑|白|灰|金|银)色/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const signatureText = signature.join("；");
  const signatureIsComplete = role === "字体" ? signature.length >= 4 : signature.length >= 3;
  return compactKnowledge(
    signatureIsComplete ? signatureText : [signatureText, cleaned].filter(Boolean).join("。"),
    role === "字体" ? 520 : 420,
  );
}

function inferTypographyRenderMode(markdown = "", role = "") {
  const source = textOf(markdown);
  if (role === "日期" && /(无衬线|几何|细线|线条|信息模块|信息条)/.test(source)) return "flat";
  const flatScore = [/(二维|2D|平面|扁平)/i, /(马克笔|刷笔|笔刷|手写)/, /(无阴影|无渐变|不做立体)/].filter((pattern) => pattern.test(source)).length;
  const dimensionalScore = [/(3D|三维|立体字|立体标题)/i, /(挤出|浮雕|厚度|体积字)/, /(金属字|发光字|软胶字|黏土字|亚克力字)/].filter((pattern) => pattern.test(source)).length;
  if (flatScore > dimensionalScore) return "flat";
  if (dimensionalScore > flatScore) return "dimensional";
  return "reference";
}

function compositionOrientation(imageSize = "") {
  const match = textOf(imageSize).match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) return "Any";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width > height) return "Horizontal";
  if (height > width) return "Vertical";
  return "Square";
}

function referenceCompositionOrientation(base = "", description = "", metadata = {}) {
  const declared = textOf(metadata.orientation).toLowerCase();
  if (declared === "vertical") return "Vertical";
  if (declared === "horizontal") return "Horizontal";
  if (declared === "square") return "Square";
  if (/^vertical/i.test(base)) return "Vertical";
  if (/^horizontal/i.test(base)) return "Horizontal";
  const source = textOf(description).slice(0, 520);
  if (/(画面(?:为|采用)竖版|竖版海报|竖版结构)/.test(source)) return "Vertical";
  if (/(画面(?:为|采用)横版|横版海报|横版结构)/.test(source)) return "Horizontal";
  return "";
}

function globalTypesettingExecutionDescription(markdown = "") {
  const structuralHeading = /(整体排版结构|主标题|副标题|补充信息|时间|信息之间的排版关系|比例对比关系|各自位置|画面部分|主视觉区域)/;
  const styleOnlyLine = /(字体材质|使用.{0,16}(?:字体|字形)|字形采用|字形大小|字形体量|字重|笔画|粗糙边缘|颗粒字体|软胶|充气|黏土|衬线|无衬线|文字颜色|颜色与|黑白主基调|强调色块|翻译、拼音|风格说明)/;
  const normalized = splitReferenceKnowledge(markdown).sections
    .filter((section) => structuralHeading.test(section.heading))
    .map((section) => {
      const body = section.body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !styleOnlyLine.test(line))
        .join("\n")
        .replace(/品牌与版权信息/g, "补充信息")
        .replace(/品牌信息/g, "补充信息")
        .replace(/品牌名称/g, "补充信息标题")
        .replace(/版权说明/g, "补充信息正文")
        .replace(/英文副标题/g, "副标题")
        .replace(/英文说明/g, "补充说明");
      return body ? `${section.heading}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return compactKnowledge(normalized || markdown, 1800);
}

function integratedLayoutExecutionDescription(markdown = "") {
  const relevantHeading = /(版式概述|文字视觉系统|主标题|副标题|活动时间|辅助信息|装饰信息|画面部分|主视觉区域|内容适配规则|主标题长度变化|信息缺失|执行指令)/;
  const sections = splitReferenceKnowledge(markdown).sections
    .filter((section) => relevantHeading.test(section.heading))
    .map((section) => {
      const body = section.body
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
      return body ? `${section.heading}\n${body}` : "";
    })
    .filter(Boolean);
  return compactKnowledge(sections.join("\n\n") || markdown, 4600);
}

function loadPresetReferenceGroup(preset, group) {
  const referenceDir = preset?.reference_dir || "";
  const groupDir = group?.dir || "";
  const dirPath = path.join(STYLE_DIR, referenceDir, groupDir);
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .filter((file) => IMAGE_FILE_RE.test(file))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }))
    .map((file) => {
      const base = file.replace(/\.[^.]+$/, "");
      const rawDescription = readSidecarDescription(path.join(dirPath, file));
      const { metadata, body: description } = parseFrontMatter(rawDescription);
      const knowledge = splitReferenceKnowledge(description);
      const descriptionSummary = group.id === "integrated_layout"
        ? integratedLayoutExecutionDescription(description)
        : summarizeReferenceDescription(description);
      const features = linesOf(descriptionSummary).slice(0, 16);
      return {
        variant_id: `${group.id}_${safeSlug(base, group.id)}`,
        file: `${group.dir}/${file}`,
        image: styleUrl(preset.reference_dir, group.dir, file),
        reference_role: group.role,
        reference_kind: group.id,
        global_reference: false,
        composition_orientation: referenceCompositionOrientation(base, description, metadata),
        layout_metadata: metadata,
        style_name: `${group.label} ${base.replace(/(\D)(\d+)$/, "$1 $2")}`,
        features,
        description: descriptionSummary,
        full_description: description,
        positive_description: knowledge.positive || description,
        negative_description: knowledge.negative,
        execution_description: group.id === "integrated_layout" ? descriptionSummary : referenceExecutionDescription(description, group.role),
        typography_render_mode: inferTypographyRenderMode(description, group.role),
        prompt_note: descriptionSummary,
        best_for: [],
      };
    });
}

function presetReferenceGroups(preset) {
  return Array.isArray(preset?.reference_groups) ? preset.reference_groups : [];
}

let customStylePresetsCache = null;

async function hydrateCustomStylePresets() {
  if (IS_OSS) {
    try {
      const payload = JSON.parse((await storageGet("data/style-presets.json")).toString("utf-8"));
      customStylePresetsCache = (payload.presets || []).map(normalizeCustomStylePreset).filter((item) => item.preset_id && item.preset_name);
      return;
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
    }
  }
  customStylePresetsCache = null;
}

function loadCustomStylePresets() {
  if (customStylePresetsCache) return customStylePresetsCache;
  const sourcePath = existsSync(CUSTOM_STYLES_PATH)
    ? CUSTOM_STYLES_PATH
    : PACKAGED_CUSTOM_STYLES_PATH;
  if (!existsSync(sourcePath)) return [];
  try {
    const payload = JSON.parse(readFileSync(sourcePath, "utf-8"));
    return (payload.presets || []).map(normalizeCustomStylePreset).filter((item) => item.preset_id && item.preset_name);
  } catch {
    return [];
  }
}

async function saveCustomStylePresets(presets) {
  const normalized = presets.map(normalizeCustomStylePreset).filter((item) => item.preset_id && item.preset_name);
  customStylePresetsCache = normalized;
  const payload = JSON.stringify({ source: "dynamic-style-presets", count: normalized.length, presets: normalized }, null, 2);
  if (IS_OSS) {
    await storagePut("data/style-presets.json", Buffer.from(payload, "utf-8"), { contentType: "application/json" });
    return normalized;
  }
  await mkdir(path.dirname(CUSTOM_STYLES_PATH), { recursive: true });
  await writeFile(CUSTOM_STYLES_PATH, payload, "utf-8");
  return normalized;
}

function normalizeCustomStylePreset(raw = {}) {
  const presetId = safeSlug(raw.preset_id || raw.id || raw.name || raw.preset_name, "style");
  const presetName = textOf(raw.preset_name || raw.name || presetId).trim();
  const styleGroup = textOf(raw.style_group || raw.subtitle || presetName).trim();
  const referenceDir = safeSlug(raw.reference_dir || presetId, "style");
  const variants = Array.isArray(raw.title_variants) ? raw.title_variants : [];
  return {
    ...raw,
    custom: true,
    id: presetId,
    preset_id: presetId,
    preset_name: presetName,
    name: textOf(raw.name || presetName).trim(),
    subtitle: textOf(raw.subtitle || styleGroup || "自定义风格").trim(),
    style_group: styleGroup,
    reference_base: "uploads",
    reference_dir: referenceDir,
    thumbnail: textOf(raw.thumbnail).trim(),
    visual_keywords: Array.isArray(raw.visual_keywords) ? raw.visual_keywords : linesOf(raw.visual_keywords || styleGroup),
    shared_style: raw.shared_style || {
      visual_style: linesOf(raw.visual_style || raw.visual_keywords || styleGroup),
      color_rules: linesOf(raw.color_rules),
      texture_rules: linesOf(raw.texture_rules),
      composition_rules: linesOf(raw.composition_rules),
      mood: linesOf(raw.mood),
    },
    title_style: raw.title_style || {
      style_name: textOf(raw.title_style_name || "参考图标题样式").trim(),
      features: linesOf(raw.title_style_features || raw.title_style),
      avoid: linesOf(raw.title_style_avoid),
    },
    scene_expansion_rules: Array.isArray(raw.scene_expansion_rules) ? raw.scene_expansion_rules : linesOf(raw.scene_expansion_rules),
    title_variants: variants.map((variant, index) => ({
      variant_id: safeSlug(variant.variant_id || `${presetId}_variant_${index + 1}`, "variant"),
      file: textOf(variant.file).trim(),
      image: textOf(variant.image).trim(),
      style_name: textOf(variant.style_name || `变体 ${index + 1}`).trim(),
      features: Array.isArray(variant.features) ? variant.features : linesOf(variant.features || variant.description),
      prompt_note: textOf(variant.prompt_note).trim(),
      best_for: Array.isArray(variant.best_for) ? variant.best_for : linesOf(variant.best_for),
    })).filter((variant) => variant.file || variant.image),
  };
}

function allStylePresetCards() {
  const builtInNames = new Set(STYLE_PRESETS.map((preset) => preset.name));
  return [
    ...STYLE_PRESETS,
    ...loadCustomStylePresets()
      .filter((preset) => !builtInNames.has(preset.name || preset.preset_name))
      .map((preset) => ({
        id: preset.preset_id,
        name: preset.name || preset.preset_name,
        subtitle: preset.subtitle || preset.style_group || "自定义风格",
        preset_id: preset.preset_id,
        thumbnail: preset.thumbnail,
        custom: true,
      })),
  ];
}

function integratedLayoutCardsForPreset(preset) {
  const group = presetReferenceGroups(preset).find((item) => item.id === "integrated_layout");
  if (!group) return [];
  return loadPresetReferenceGroup(preset, group).map((variant) => ({
    variant_id: variant.variant_id,
    style_name: variant.style_name,
    image: variant.image,
    orientation: variant.composition_orientation,
    layout_metadata: {
      orientation: variant.layout_metadata?.orientation || "",
      source_aspect_ratio: variant.layout_metadata?.source_aspect_ratio || "",
      supported_slots: variant.layout_metadata?.supported_slots || {},
      retrieval_tags: variant.layout_metadata?.retrieval_tags || [],
    },
  }));
}

function stylePresetCardsWithIntegratedLayouts() {
  return allStylePresetCards().map((card) => ({
    ...card,
    integrated_layouts: integratedLayoutCardsForPreset(presetByStyleId(card.id)),
  }));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function jsonResponse(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sseWrite(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function textOf(value) {
  return value == null ? "" : String(value);
}

function httpError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function validateImageFile(file) {
  const bytes = Buffer.from(file?.data || []);
  if (!bytes.length) throw httpError(400, "上传的图片内容为空");
  if (bytes.length > MAX_IMAGE_BYTES) throw httpError(400, `图片超过大小限制 ${MAX_IMAGE_BYTES} 字节`);
  if (!detectImageType(bytes)) throw httpError(400, "上传文件不是受支持的图片格式");
  const extension = path.extname(textOf(file?.filename || "")).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) throw httpError(400, `不支持的图片扩展名: ${extension || "(无)"}`);
  return true;
}

function validateXlsxFile(file) {
  const bytes = Buffer.from(file?.data || []);
  if (!bytes.length) throw httpError(400, "上传的 Excel 内容为空");
  if (bytes.length > MAX_UPLOAD_BYTES) throw httpError(400, `Excel 超过大小限制 ${MAX_UPLOAD_BYTES} 字节`);
  const ext = path.extname(textOf(file?.filename || "")).toLowerCase();
  if (ext !== ".xlsx" && ext !== ".xls") throw httpError(400, "仅支持 .xlsx / .xls 文件");
  if (bytes.subarray(0, 4).toString("hex") !== "504b0304" && bytes.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1") {
    throw httpError(400, "Excel 文件内容无效");
  }
  return true;
}

function isAuthorized(req) {
  if (!ADMIN_TOKEN) return true;
  const header = textOf(req.headers["authorization"] || req.headers["x-admin-token"]).trim();
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : header;
  if (!token || token.length !== ADMIN_TOKEN.length) return false;
  const left = Buffer.from(token);
  const right = Buffer.from(ADMIN_TOKEN);
  return crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, res) {
  if (isAuthorized(req)) return true;
  jsonResponse(res, 401, { error: "需要有效的管理令牌（Authorization: Bearer <ADMIN_TOKEN>）" });
  return false;
}

const rateBuckets = new Map();

function applyRateLimit(req, res, limit, windowMs = 60000) {
  if (!limit || limit <= 0) return true;
  const ip = textOf(req.headers["x-forwarded-for"]).split(",")[0].trim()
    || req.socket?.remoteAddress
    || "local";
  const now = Date.now();
  const bucketKey = `${ip}|${req.url?.split("?")[0] || ""}`;
  const bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.window < now - windowMs) {
    rateBuckets.set(bucketKey, { window: now, count: 1 });
  } else {
    bucket.count += 1;
    if (bucket.count > limit) {
      res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(Math.ceil((bucket.window + windowMs - now) / 1000)),
      });
      res.end(JSON.stringify({ error: "请求过于频繁，请稍后重试" }));
      return false;
    }
  }
  if (rateBuckets.size > 10000) {
    for (const [key, value] of rateBuckets) {
      if (value.window < now - 2 * windowMs) rateBuckets.delete(key);
    }
  }
  return true;
}

function objectKeyFromUrl(value) {
  const raw = textOf(value).trim();
  if (!raw) return "";
  return raw.startsWith("/") ? raw.slice(1) : raw;
}

function decorateUploadUrls(value) {
  if (typeof value === "string") {
    return value.startsWith("/uploads/") && IS_OSS ? storageSignUrl(value.slice(1)) : value;
  }
  if (Array.isArray(value)) return value.map(decorateUploadUrls);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = decorateUploadUrls(item);
    return result;
  }
  return value;
}

function outputKey(name) {
  return `outputs/${path.basename(String(name || ""))}`;
}

function presetByStyleId(styleId) {
  if (styleId === NO_PRESET_ID) return null;
  if (styleId === THREE_D_PRESET.preset_id) return THREE_D_PRESET;
  if (styleId === MINIMAL_FLAT_PRESET.preset_id) return MINIMAL_FLAT_PRESET;
  if (styleId === REAL_PRODUCT_PRESET.preset_id) return REAL_PRODUCT_PRESET;
  if (styleId === REAL_PERSON_PRESET.preset_id) return REAL_PERSON_PRESET;
  return loadCustomStylePresets().find((preset) => preset.preset_id === styleId) || null;
}

function presetForRequest(request) {
  return presetByStyleId(request?.style_preset || STYLE_PRESETS[0].id);
}

function resolveStylePresetId(value) {
  const raw = textOf(value).trim();
  if (!raw) return STYLE_PRESETS[0].id;
  const normalized = raw.toLowerCase();
  const cards = allStylePresetCards();
  const match = cards.find((item) => (
    item.id === raw ||
    item.preset_id === raw ||
    item.name === raw ||
    item.name?.toLowerCase() === normalized ||
    item.preset_id?.toLowerCase() === normalized ||
    item.id?.toLowerCase() === normalized
  ));
  if (!match) {
    const error = new Error(`未知或已下线的风格预设：${raw}。可用预设：${cards.map((item) => item.id).join("、")}`);
    error.statusCode = 400;
    throw error;
  }
  return match.id;
}

function hasPetIntent(input) {
  const source = typeof input === "string"
    ? input
    : `${input?.campaign_name || ""} ${input?.visual_description || ""}`;
  return /(宠物|狗|小狗|猫|小猫|毛孩子|猫狗|萌宠)/.test(source);
}

function hasPersonIntent(input) {
  const source = typeof input === "string"
    ? input
    : `${input?.campaign_name || ""} ${input?.visual_description || ""}`;
  return /(人物|真人|模特|女生|女孩|男生|男孩|小女孩|小男孩|人像|穿搭|手持|手掌|脚掌|鞋底|腿部|身体|滑板|冲浪|运动|跳跃|跑步|角色)/.test(source);
}

function petConstraint(preset = null) {
  return preset?.pet_character_style_constraint || {};
}

function petPositiveText(preset = null) {
  return (petConstraint(preset).positive_prompt || []).join("、");
}

function petNegativeText(preset = null) {
  return (petConstraint(preset).negative_prompt || []).join("，");
}

function petCharacterBlock(constraint = null) {
  const positive = (constraint?.positive_prompt || []).join("、");
  const negative = (constraint?.negative_prompt || []).join("，");
  return `【宠物角色造型约束】\n本次画面包含宠物角色。${constraint?.description || "宠物不要生成写实猫狗，而要做成设计化IP形象。"} 正向造型要求：${positive}。禁止项：${negative}。以上英文仅作为风格关键词，不得作为画面文字生成。`;
}

function tokenize(text) {
  const normalized = textOf(text).toLowerCase().replace(/[^\p{L}\p{N}#]+/gu, " ");
  const words = normalized.split(/\s+/).filter(Boolean);
  const chars = Array.from(normalized.replace(/\s+/g, ""));
  const grams = [];
  for (let i = 0; i < chars.length - 1; i += 1) grams.push(chars.slice(i, i + 2).join(""));
  for (let i = 0; i < chars.length - 2; i += 1) grams.push(chars.slice(i, i + 3).join(""));
  return new Set([...words, ...grams]);
}

function similarity(needle, haystack) {
  const a = tokenize(needle);
  const b = tokenize(haystack);
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const token of a) {
    if (b.has(token)) hit += 1;
  }
  const overlap = hit / Math.max(1, a.size);
  const exactBonus = textOf(haystack).includes(textOf(needle).slice(0, 6)) ? 0.12 : 0;
  return Math.min(1, overlap + exactBonus);
}

function hasCharacterReferenceIntent(input = {}) {
  const source = `${input.campaign_name || ""} ${input.campaign_subtitle || ""} ${input.visual_description || ""}`;
  return hasPersonIntent(input)
    || hasPetIntent(input)
    || isDoudouEnabled(input)
    || /(IP|角色|动物|小羊|兔|熊|鸟|怪兽|精灵|雪人|星星人|吉祥物)/i.test(source);
}

function activePresetReferenceGroups(preset, request = {}, creativePlan = {}) {
  const blueprint = creativePlan?.selected_blueprint || {};
  const creativeCharacterIntent = hasCharacterReferenceIntent({
    ...request,
    visual_description: [
      request.visual_description,
      blueprint.visual_carrier,
      blueprint.approved_visual_inventions,
      blueprint.middle_layer,
    ].filter(Boolean).join(" "),
  });
  return presetReferenceGroups(preset).filter((group) => {
    if (group.when === "title") return hasMainTitle(request);
    if (group.when === "time") return Boolean(campaignTimeText(request));
    if (group.when === "character") return creativeCharacterIntent;
    if (group.id === "font") return hasMainTitle(request);
    return true;
  });
}

function loadPresetPrinciples(preset) {
  if (!preset?.reference_dir) return { title: "", content: "", summary: "" };
  const filePath = path.join(STYLE_DIR, preset.reference_dir, "preset.md");
  const content = readOptionalText(filePath);
  return {
    title: knowledgeTitle(content, `${preset.preset_name || preset.reference_dir}共享原则`),
    content,
    summary: compactKnowledge(content, 5600),
  };
}

function loadCreativeMethodCards(query = "", limit = 5) {
  if (!existsSync(CREATIVE_METHODS_DIR)) return [];
  return readdirSync(CREATIVE_METHODS_DIR)
    .filter((file) => /\.md$/i.test(file))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }))
    .map((file) => {
      const filePath = path.join(CREATIVE_METHODS_DIR, file);
      const content = readFileSync(filePath, "utf-8");
      const id = file.replace(/\.md$/i, "");
      const name = knowledgeTitle(content, id.replace(/^\d+_/, ""));
      const imagePath = findSiblingImage(filePath);
      return {
        id,
        name,
        content,
        summary: compactKnowledge(content, 1800),
        images: imagePath ? [{ path: imagePath, label: `${name}创意方法示例` }] : [],
        score: similarity(query, `${name}\n${content}`),
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "zh-Hans-CN", { numeric: true }))
    .slice(0, Math.max(1, limit));
}

function loadDesignCaseCards(query = "", limit = 2) {
  if (!existsSync(DESIGN_CASES_DIR)) return [];
  return readdirSync(DESIGN_CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const dirPath = path.join(DESIGN_CASES_DIR, entry.name);
      const brief = readOptionalText(path.join(dirPath, "brief.md"));
      const review = readOptionalText(path.join(dirPath, "review.md"));
      const content = `${brief}\n\n${review}`.trim();
      const goodImage = ["good.png", "good.jpg", "good.jpeg", "good.webp"]
        .map((name) => path.join(dirPath, name))
        .find((candidate) => existsSync(candidate));
      const badImage = ["bad.png", "bad.jpg", "bad.jpeg", "bad.webp"]
        .map((name) => path.join(dirPath, name))
        .find((candidate) => existsSync(candidate));
      return {
        id: entry.name,
        name: entry.name.replace(/^case_\d+_/, ""),
        brief: compactKnowledge(brief, 2400),
        review: compactKnowledge(review, 2800),
        images: [
          goodImage ? { path: goodImage, label: `${entry.name} Good Case` } : null,
          badImage ? { path: badImage, label: `${entry.name} Bad Case` } : null,
        ].filter(Boolean),
        score: similarity(query, `${entry.name}\n${content}`),
      };
    })
    .filter((item) => item.brief || item.review)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "zh-Hans-CN", { numeric: true }))
    .slice(0, Math.max(1, limit));
}

function productionKnowledgeForRequest(request = {}, preset = null) {
  const query = [
    request.campaign_name,
    request.campaign_subtitle,
    request.campaign_time,
    request.visual_description,
    request.image_size,
    preset?.preset_name,
    preset?.style_group,
  ].filter(Boolean).join(" ");
  return {
    preset_principles: loadPresetPrinciples(preset),
    creative_methods: loadCreativeMethodCards(query, 12),
    cases: loadDesignCaseCards(query, 2),
  };
}

function hasMultipleCreativeThreads(description = "") {
  const source = textOf(description).trim();
  if (!source) return false;
  if (/[+＋、]|同时|既[^，。；]{0,24}又|一边[^，。；]{0,24}一边|分别|双(?:主题|场景|品类)|两个(?:主体|场景)|两种(?:体验|场景)|(?:与|及)\S{1,16}(?:共同|并存|结合|融合)/.test(source)) return true;
  const subjectPattern = /(IP|角色|人物|女孩|男孩|小羊|猫|狗|宠物|动物|产品|商品|杯|手机|汽车|星星|雪人|吉祥物|主体)/i;
  const actionPattern = /(滑雪|泡温泉|泡汤|冲浪|奔跑|跑步|跳跃|阅读|喝|吃|坐|躺|飞|驾驶|互动|拥抱|追逐|舞蹈|运动|工作|拍照)/;
  const narrativeClauses = source
    .split(/[，,；;。]+/)
    .map((clause) => clause.trim())
    .filter((clause) => subjectPattern.test(clause) && actionPattern.test(clause));
  return narrativeClauses.length >= 2;
}

function localCreativePlan(request = {}, brief = {}, knowledge = {}, preset = null) {
  const description = textOf(request.visual_description).trim();
  const title = textOf(request.campaign_name).trim();
  const subtitle = campaignSubtitleText(request);
  const time = campaignTimeText(request);
  const methodCards = knowledge.creative_methods || [];
  const methodNames = methodCards.slice(0, 2).map((item) => item.name);
  const methodA = methodNames[0] || "场景重构";
  const methodB = methodNames[1] || "形态碰瓷";
  const hasMultipleThemes = hasMultipleCreativeThreads(description);
  const selectedConceptId = hasMultipleThemes ? "concept_integrated_world" : "concept_dynamic_metaphor";
  const presetStyle = preset?.style_group || preset?.preset_name || "用户输入定义的视觉风格";
  const requiredContent = linesOf(description).slice(0, 12);
  const titleRule = title ? `主标题「${title}」是第一信息层级` : "用户未提供主标题，不设置标题视觉任务";
  const candidatePool = [
    {
      id: "concept_single_scene",
      name: "单一核心场景",
      marketing_strategy: "用一个最直接的场景快速传达主题",
      core_concept: `把「${description}」收束为单一核心场景与一个绝对主体`,
      visual_carrier: "用户描述中的核心主体或动作",
      conflict_or_interest: "主体尺度与留白形成对比",
      memory_symbol: "核心主体的强轮廓",
      score: hasMultipleThemes ? 68 : 82,
      decision: hasMultipleThemes ? "rejected" : "candidate",
      risk: hasMultipleThemes ? "可能遗漏复合主题中的次要硬性内容" : "创意反差可能不足",
    },
    {
      id: "concept_split_layout",
      name: "分区并置叙事",
      marketing_strategy: "用分区同时容纳多个信息点",
      core_concept: "将不同内容安排在独立区域并通过统一色彩连接",
      visual_carrier: "两个或多个并列画面模块",
      conflict_or_interest: "并列关系形成信息对照",
      memory_symbol: "明确的分区边界",
      score: 62,
      decision: "rejected",
      risk: "容易割裂，削弱单一主视觉和信息流阅读效率",
    },
    {
      id: "concept_integrated_world",
      name: "统一世界观纵深叙事",
      marketing_strategy: "把多项硬性内容组织到同一世界观和一条浏览动线中",
      core_concept: `以${methodA}为主，将用户描述中的主体、动作与场景整合为一个完整瞬间`,
      visual_carrier: `把用户明确描述的「${description}」组织为同一世界观中的核心互动主视觉`,
      conflict_or_interest: "尺度反差、动作方向或场景功能反差",
      memory_symbol: "由用户提供的核心主体和动作共同形成，不新增无关符号",
      score: hasMultipleThemes ? 90 : 86,
      decision: selectedConceptId === "concept_integrated_world" ? "selected" : "candidate",
      risk: "如果道具过多会损害留白和主体识别",
    },
    {
      id: "concept_dynamic_metaphor",
      name: "动态隐喻主视觉",
      marketing_strategy: "用动作节奏、主体关系和设计化场景把抽象主题变成可见记忆点",
      core_concept: `结合${methodA}${methodB ? `与${methodB}` : ""}，把「${description}」转译为一个具有清晰动作与情绪关系的主视觉`,
      visual_carrier: `将用户明确描述的「${description}」按「${presetStyle}」的造型语言和明确构图重构为单一动态主视觉`,
      conflict_or_interest: "熟悉内容与设计化动作、角色关系或场景规则发生碰撞",
      memory_symbol: "核心主体的动作轮廓、互动关系或主题道具",
      score: hasMultipleThemes ? 84 : 92,
      decision: selectedConceptId === "concept_dynamic_metaphor" ? "selected" : "candidate",
      risk: "动作和场景设计不能破坏主体识别和文字留白",
    },
  ];
  const candidates = hasMultipleThemes
    ? candidatePool.slice(0, 3)
    : [candidatePool[0], candidatePool[1], candidatePool[3]];
  const selected = candidates.find((item) => item.id === selectedConceptId) || candidates[2];
  return {
    source: "local-production-draft",
    brief_deconstruction: {
      explicit_constraints: [
        title ? `主标题：${title}` : "主标题未提供",
        subtitle ? `副标题：${subtitle}` : "副标题未提供",
        time ? `活动时间：${time}` : "活动时间未提供",
        `画幅：${request.image_size}`,
        `画面描述：${description}`,
      ],
      required_content: requiredContent,
      inferred_marketing_goal: {
        value: "在信息流中快速传达活动主题，并建立可复述的视觉记忆点",
        confidence: "medium",
        basis: "基于营销KV用途的策略假设，不作为用户明示事实写入画面",
      },
      inferred_audience: {
        value: "用户未提供，暂不把具体年龄、地域或职业写入设计",
        confidence: "low",
      },
      visual_requirement: "一眼识别主题、一个绝对主视觉、明确浏览动线、足够留白、可在缩略图中读懂",
    },
    creative_methods: methodCards.slice(0, 2).map((item) => ({
      id: item.id,
      name: item.name,
      reason: `该方法与「${description}」及当前「${presetStyle}」视觉任务的语义匹配度较高，用于建立创意转化而非直接复制案例。`,
    })),
    candidates,
    selected_concept_id: selected.id,
    selected_concept_name: selected.name,
    selection_reason: `选择「${selected.name}」：能在保证用户硬性内容的前提下形成更强的主体、镜头和视觉记忆点，同时规避分屏割裂与普通陈列。`,
    selected_blueprint: {
      core_concept: selected.core_concept,
      visual_carrier: selected.visual_carrier,
      approved_visual_inventions: [],
      conflict_or_interest: selected.conflict_or_interest,
      memory_symbol: selected.memory_symbol,
      composition: `${request.image_size}画幅；${titleRule}；主体与文字区提前分配，主体沿对角线、弧线或S形动线组织`,
      top_layer: title ? "标题与必要活动信息区，背景低复杂度并保持可读留白" : "低复杂度氛围与留白区",
      middle_layer: "承载唯一主视觉主体、关键动作和最重要的主题关系",
      bottom_layer: "用少量场景支点建立空间和落地关系，不堆叠装饰",
      camera: "根据用户描述、主体动作与排版参考选择平视、轻微俯拍或轻微仰拍，确保主体识别和标题留白",
      color: "从用户输入与所选风格中确定一个主色、一个辅助色和少量强调色，不擅自指定品牌色",
      material: `服从「${presetStyle}」共享原则，所有主体、道具与场景保持统一表现语言和完成度`,
      information_hierarchy: [
        titleRule,
        subtitle ? "副标题次于主标题" : "",
        time ? "活动时间属于标题组，层级低于主标题" : "",
        title && (subtitle || time) ? "副标题和活动时间的文字颜色与主标题完全一致" : "",
      ].filter(Boolean).join("；"),
    },
    reference_queries: {
      整合版式: `${request.image_size} ${title ? `主标题${Array.from(title).length}字` : "无主标题"} ${subtitle ? "有副标题" : "无副标题"} ${time ? "有时间" : "无时间"} ${selected.name} 文字区与主画面区比例 阅读顺序 留白`,
      风格: `${description} ${selected.core_concept} ${presetStyle} 强构图 留白 商业完成度`,
      元素: `${description} ${selected.visual_carrier} ${selected.memory_symbol} 主体造型 动作 道具`,
      角色: hasCharacterReferenceIntent({ ...request, visual_description: `${description} ${selected.visual_carrier}` }) ? `${description} ${selected.visual_carrier} ${presetStyle} 角色造型 轮廓比例 动作关系` : "",
    },
  };
}

function scoreToFive(score) {
  return Math.max(1, Math.min(5, 1 + score * 4));
}

function scoreMaterial(material, type, request, brief, design) {
  const strategyText = (TYPE_STRATEGY[type] || [])
    .map((key) => design[key])
    .concat([design.visual_direction])
    .filter(Boolean)
    .join(" ");

  const referenceText = material.reference_description || material.description || material.reference || "";
  const style = scoreToFive(similarity(strategyText, referenceText));
  const merit = scoreToFive(similarity(`${strategyText} ${request.visual_description}`, referenceText));
  const mood = scoreToFive(similarity(brief.emotion_keywords, referenceText));
  const node = scoreToFive(
    similarity(
      `${brief.activity_attributes} ${request.campaign_name} ${request.visual_description}`,
      referenceText,
    ),
  );

  const total = type === "字体"
    ? style * 0.45 + merit * 0.3 + mood * 0.15 + node * 0.1
    : style * 0.38 + merit * 0.3 + mood * 0.18 + node * 0.14;
  return { style, merit, mood, marketing_nodes: node, total };
}

function stableHash(text) {
  let hash = 0;
  for (const char of textOf(text)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function stableUnitHash(text) {
  let hash = 2166136261;
  for (const char of textOf(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
}

function pickBySeed(options = [], seed = "", offset = 0) {
  if (!options.length) return "";
  return options[(stableHash(`${seed}:${offset}`) + offset) % options.length];
}

function threeDPersonPerspectiveDecision(request = {}) {
  const seed = `${request.campaign_name || ""} ${request.visual_description || ""} ${request.image_size || ""}`;
  const constraint = THREE_D_PERSON_PERSPECTIVE_CONSTRAINT;
  const explicitChoice = (pairs, fallback) => pairs.find(([, pattern]) => pattern.test(seed))?.[0] || fallback;
  const camera = explicitChoice([
    ["脚底 POV 视角", /脚底|鞋底.*(?:镜头|前景|靠近)|从鞋底/],
    ["手掌前景 POV 视角", /手掌.*(?:POV|镜头|前景|靠近)|从手掌/],
    ["滑板底部仰视视角", /滑板.*(?:底部|仰视|镜头)/],
    ["10mm 鱼眼仰拍", /10mm|鱼眼/],
    ["8mm 超广角低机位", /8mm|超广角/],
    ["贴地低角度仰拍", /贴地|低角度仰拍|低机位仰拍/],
    ["身体从画面外冲入的动态视角", /画面外冲入|边缘冲入|冲入画面/],
    ["近景肢体遮挡主体的压迫式构图", /近景.*遮挡|压迫式|肢体遮挡/],
  ], pickBySeed(constraint.camera_options, seed, 1));
  const foregroundAnchor = explicitChoice([
    ["巨大的鞋底", /鞋底/],
    ["巨大的手掌", /手掌/],
    ["巨大的脚掌", /脚掌/],
    ["巨大的滑板", /滑板/],
    ["巨大的手机", /手机/],
    ["巨大的运动鞋鞋带", /鞋带/],
    ["巨大的冲浪板", /冲浪板/],
    ["巨大的袖子", /袖子/],
    ["巨大的腿部弧线", /腿部|长腿|腿.*弧线/],
  ], pickBySeed(constraint.foreground_anchor_options, seed, 2));
  const motionPath = explicitChoice([
    ["人物从画面边缘冲入", /画面边缘冲入|画面外冲入|冲入画面/],
    ["一条腿伸向镜头", /腿.*伸向镜头|脚.*伸向镜头|鞋底.*靠近镜头/],
    ["一只手伸出画面", /手.*伸出画面|手掌.*伸向镜头/],
    ["身体形成 S 型扭转", /S\s*型|扭转/],
    ["人物被镜头拉伸成近大远小", /近大远小|透视拉伸/],
    ["多个肢体形成环绕动线", /环绕动线|肢体环绕/],
    ["道具形成白色线条或轨迹穿插画面", /轨迹线|白色线条|轨迹穿插/],
    ["身体斜向穿过画面", /斜向|对角线/],
  ], pickBySeed(constraint.motion_options, seed, 3));
  return {
    camera,
    foreground_anchor: foregroundAnchor,
    body_abstraction: constraint.body_abstraction_rules.join("、"),
    motion_path: motionPath,
    scene_depth: pickBySeed(constraint.scene_rules, seed, 4),
  };
}

function threeDPersonPerspectiveBlock(decision = threeDPersonPerspectiveDecision({})) {
  return [
    "【3D人物大透视造型约束】",
    "本次 3D 风格画面的主视觉主体涉及人物，生成前必须先完成并严格执行以下判断：",
    `A. 镜头先行：优先使用强镜头，不使用普通正面视角。本次镜头选择：${decision.camera}。`,
    `B. 前景巨大锚点：画面必须有一个夸张放大的前景物体，占画面 30%-55%。本次前景锚点：${decision.foreground_anchor}。`,
    `C. 人体抽象变形：人物不能是真实比例，必须采用抽象比例：${decision.body_abstraction}。`,
    `D. 动作轨迹：避免站立、端坐、普通跑步，动作必须形成 S 型 / 对角线 / 环形轨迹。本次动作结构：${decision.motion_path}。`,
    `E. 场景只服务镜头：场景不能抢主体，必须强化空间纵深。本次场景处理：${decision.scene_depth}。`,
  ].join("\n");
}

function isDoudouEnabled(request = {}) {
  return request.doudou_ip === true || request.doudou_ip === "true" || request.doudou_ip === "on" || request.doudou_ip === "1";
}

function booleanPreference(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  return fallback;
}

function hasNonDoudouSubjectIntent(request = {}) {
  const source = `${request.campaign_name || ""} ${request.visual_description || ""}`.replace(/兜兜IP?|抖音商城IP/g, "");
  return /(人物|真人|模特|女生|女孩|男生|男孩|小女孩|小男孩|儿童|老人|用户|主播|达人|人像|角色|宠物|狗|小狗|猫|小猫|动物|产品|商品|手机|耳机|手表|鞋|衣服|包|杯|瓶|盒|茶|咖啡|饮品|书|报纸|车|滑板|冲浪板|主体|主视觉)/.test(source);
}

function doudouRole(request = {}) {
  if (!isDoudouEnabled(request)) return "";
  const source = `${request.campaign_name || ""} ${request.visual_description || ""}`;
  if (/(兜兜.*(主体|主角|主视觉)|以兜兜为主|兜兜是主体|兜兜作为主体|兜兜IP.*主体)/.test(source)) return "主体角色";
  if (!hasNonDoudouSubjectIntent(request)) return "主体角色";
  return "辅助角色";
}

function doudouRolePrompt(request = {}) {
  const role = doudouRole(request);
  if (!role) return "";
  if (role === "主体角色") {
    return "用户已选择添加「兜兜IP」。本次画面必须出现兜兜，且兜兜判断为主视觉主体角色：兜兜应占据清晰视觉中心，动作、神态、姿态和用户描述的主题场景直接相关。";
  }
  return "用户已选择添加「兜兜IP」。本次画面必须出现兜兜，且兜兜判断为辅助角色：若用户已描述其他主体，兜兜不能抢走主视觉，但必须以互动、陪伴、指引、递送、发现、惊喜或氛围强化的方式与主体、动作和场景呼应。";
}

function doudouAssetUrl(relativePath) {
  return `/doudou/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function listDoudouImageFiles() {
  if (!existsSync(DOUDOU_DIR)) return [];
  const results = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (IMAGE_FILE_RE.test(entry.name)) {
        results.push(path.relative(DOUDOU_DIR, full));
      }
    }
  };
  walk(DOUDOU_DIR);
  return results.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function doudouActionKeywords(text = "") {
  const pairs = [
    ["低价", /低价|降价|便宜|优惠|折扣|省钱|价格|捡漏/],
    ["发券", /券|优惠券|发券|领券|补贴|红包/],
    ["送货", /送货|快递|物流|配送|到家|包裹/],
    ["冲刺", /冲刺|奔跑|快速|速度|爆发|出发|运动|赶路/],
    ["发现惊喜", /惊喜|彩蛋|礼物|发现|探索|宝藏|新奇/],
    ["发现好东西", /好物|种草|推荐|逛|挑选|清单|精选/],
    ["好物收集", /收集|囤货|收藏|采购|购物车|买买买/],
    ["撑了", /吃|美食|餐|饱|撑|零食|饮品|茶|咖啡/],
    ["快乐", /快乐|开心|欢乐|庆祝|派对|玩|轻松|治愈/],
    ["耍酷", /酷|潮|时尚|穿搭|街头|个性/],
    ["累了", /累|休息|躺|下班|放松|疲惫/],
    ["崩溃大哭", /崩溃|哭|压力|难过|焦虑/],
    ["溜达", /溜达|散步|逛街|出游|户外|旅行/],
  ];
  return pairs.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function buildDoudouReference(relativePath, role, reason, kind = "动作姿态") {
  const filename = path.basename(relativePath, path.extname(relativePath));
  const url = doudouAssetUrl(relativePath);
  return {
    type: "兜兜IP",
    source: "兜兜IP",
    role: kind,
    number: `DOUDOU_${filename}`,
    label: `兜兜-${filename}`,
    Reference: `${doudouRolePrompt({ doudou_ip: true, visual_description: role === "主体角色" ? "兜兜是主体" : "存在其他主体" })} 参考该图中兜兜的角色造型、比例、颜色、表情气质、动作姿态和IP识别特征；兜兜是袋形IP角色，没有人类手、手掌、手臂、胳膊或嘴巴，只能通过袋身、眼睛、腿脚、提手、身体倾斜和道具关系表现动作与情绪；只复制兜兜IP本身的造型与姿态参考，不复制无关背景、水印或其他文字。`,
    reason,
    image: url,
    local_image: url,
    image_url: "",
    description: `兜兜IP${kind}参考：${filename}`,
  };
}

function selectDoudouReferences(request = {}, design = {}) {
  if (!isDoudouEnabled(request)) return [];
  const files = listDoudouImageFiles();
  if (!files.length) return [];
  const role = doudouRole(request);
  const sourceText = `${request.campaign_name || ""} ${request.visual_description || ""} ${design.visual_keywords || ""} ${design.creative_strategy || ""} ${design.subject_expansion?.emotion || ""}`;
  const isFlatPreset = [HAND_DRAWN_PRESET_ID, OUTLINE_PRESET_ID, MINIMAL_FLAT_PRESET_ID].includes(request.style_preset);
  const identity = files.find((file) => isFlatPreset && file.includes("扁平/"))
    || files.find((file) => file.includes("6视图/22-1"))
    || files.find((file) => file.includes("6视图/"))
    || files[0];
  const actionKeyword = doudouActionKeywords(sourceText);
  const actionCandidates = files.filter((file) => file.includes("3D动作素材/"));
  const action = (actionKeyword && actionCandidates.find((file) => path.basename(file).includes(actionKeyword)))
    || actionCandidates[(stableHash(sourceText) || 0) % Math.max(actionCandidates.length, 1)]
    || "";
  const refs = [];
  if (identity) {
    refs.push(buildDoudouReference(identity, role, `用户启用了兜兜IP；选择该图作为兜兜基础造型/三视图识别参考，保证角色外观一致。`, "基础造型"));
  }
  if (action && action !== identity) {
    refs.push(buildDoudouReference(action, role, `根据当前活动描述和设计判断匹配到「${path.basename(action, path.extname(action))}」动作图，用于约束兜兜与画面场景呼应的动作、神态和情绪。`, "动作姿态"));
  }
  return refs.slice(0, 3);
}

function imageUrl(file) {
  return `/image/${encodeURIComponent(file)}`;
}

function styleAssetUrl(preset, file) {
  return `/style/${encodeURIComponent(preset.reference_dir || "")}/${encodeURIComponent(file)}`;
}

function uploadStyleAssetUrl(preset, file) {
  return `/uploads/styles/${encodeURIComponent(preset.reference_dir || preset.preset_id)}/${encodeURIComponent(file)}`;
}

function presetReferenceUrl(preset, file, variant = {}) {
  if (variant.image) return variant.image;
  if (preset.reference_base === "uploads") return uploadStyleAssetUrl(preset, file);
  return ["style", "sytle"].includes(preset.reference_base) ? styleAssetUrl(preset, file) : imageUrl(file);
}

function samplePresetReferences(variants = [], count = 1) {
  const limit = Math.max(1, Math.min(Number(count) || 1, variants.length));
  return [...variants]
    .sort(() => Math.random() - 0.5)
    .slice(0, limit);
}

function choosePresetVariant(preset = null, request = {}) {
  if (!preset) return null;
  const referenceGroups = presetReferenceGroups(preset);
  if (referenceGroups.length) {
    const orientation = compositionOrientation(request.image_size);
    const references = referenceGroups
      .flatMap((group) => {
        let variants = loadPresetReferenceGroup(preset, group);
        if (["layout", "integrated_layout"].includes(group.id) && orientation !== "Any") {
          const matched = variants.filter((item) => item.composition_orientation === orientation);
          if (matched.length) variants = matched;
        }
        return samplePresetReferences(variants, group.count);
      })
      .filter(Boolean);
    return {
      variant_id: references.map((item) => item.variant_id).join("__") || `${preset.preset_id}_references`,
      style_name: references.map((item) => item.style_name).join(" + ") || preset.preset_name,
      features: references.flatMap((item) => item.features || []),
      references,
    };
  }
  const variants = preset.title_variants || [];
  return variants[Math.floor(Math.random() * variants.length)] || variants[0] || null;
}

function buildPresetReferences(variant, preset = null) {
  if (!variant) return [];
  if (Array.isArray(variant.references)) {
    return variant.references.map((item) => buildPresetReference(item, preset)).filter(Boolean);
  }
  return [buildPresetReference(variant, preset)].filter(Boolean);
}

function buildPresetReference(variant, preset = null) {
  if (!variant || !preset) return null;
  const url = presetReferenceUrl(preset, variant.file, variant);
  const referencePresetId = preset.preset_id;
  const referencePresetName = preset.preset_name;
  const referenceStyleGroup = preset.style_group;
  const referenceText = variant.reference_role === "整合版式"
    ? `整合版式参考图：同时参考「${variant.style_name}」的完整文字视觉系统与整张KV区域布局。主标题、副标题和活动时间替换为用户提供的对应内容；${INTEGRATED_LAYOUT_DECORATION_RULE}。参考图中的白色/空白区域代表主视觉生成区域，不代表最终背景必须为白色；不继承参考图文字颜色。`
    : preset.preset_id === SCRAPBOOK_PRESET.preset_id
    ? `统一视觉预设参考图：参考「${variant.style_name}」标题/版式变体，同时继承本组图共同的手帐拼贴、纸张层叠、图文混合、生活记录感和模块化拼贴页面逻辑。`
    : preset.preset_id === Y3K_PRESET.preset_id
      ? `统一视觉预设参考图：参考「${variant.style_name}」版式变体，同时继承本组图共同的Y3K未来时尚、黑银金属、高光反射、人物穿搭指南、局部特写框、细线标注和数字档案界面逻辑。`
      : preset.preset_id === HAND_DRAWN_PRESET.preset_id
        ? variant.reference_role === "字体"
          ? `统一视觉预设字体参考图：参考「${variant.style_name}」的手写涂鸦标题字形、笔画粗细、排版节奏和可读性。只参考字体气质，不复制其中具体文字。描述：${variant.description || variant.features.join("、")}`
          : variant.reference_role === "排版"
            ? `统一视觉预设排版参考图：参考「${variant.style_name}」的${variant.composition_orientation || ""} composition、主标题区域、时间模块、主图区域和留白比例。只参考版式区域关系，不复制辅助标记或具体文字。描述：${variant.description || variant.features.join("、")}`
            : `统一视觉预设风格参考图：参考「${variant.style_name}」的手绘扁平插画风格、明快色块、简洁构图、留白关系、少量辅助元素和轻松社交传播气质。描述：${variant.description || variant.features.join("、")}`
        : presetReferenceGroups(preset).length
        ? variant.reference_role === "字体"
          ? `统一视觉预设字体参考图：参考「${variant.style_name}」的标题字形、字重、笔画特征、排版节奏和可读性。只参考字体气质，不复制其中具体文字。描述：${variant.description || variant.features.join("、")}`
          : variant.reference_role === "排版"
            ? `统一视觉预设排版参考图：参考「${variant.style_name}」的${variant.composition_orientation || ""} composition、主标题区域、主图区域、信息模块和留白比例。只参考版式区域关系，不复制辅助标记或具体文字。描述：${variant.description || variant.features.join("、")}`
            : variant.reference_role === "元素"
              ? `统一视觉预设元素参考图：参考「${variant.style_name}」的主体元素造型、材质、边缘、体积感和道具表现方式。只参考元素视觉语言，不复制具体产品或无关文字。描述：${variant.description || variant.features.join("、")}`
              : variant.reference_role === "日期"
                ? `统一视觉预设日期参考图：参考「${variant.style_name}」中活动时间与标题组的字形系统、层级、相对位置和排版节奏。只参考时间信息的组织方式，不复制原日期、颜色、品牌或其他文字。`
                : variant.reference_role === "角色"
                  ? `统一视觉预设角色参考图：参考「${variant.style_name}」的角色比例、轮廓抽象、造型语言、动作重心和动势。只参考角色设计语言，不复制身份、服装文字、颜色、品牌或背景。`
              : `统一视觉预设风格参考图：参考「${variant.style_name}」的整体风格、色彩、质感、构图留白和商业海报完成度。描述：${variant.description || variant.features.join("、")}`
        : preset.custom
        ? `统一视觉预设参考图：参考「${variant.style_name}」版式/标题/质感变体，同时继承「${preset.preset_name}」的共享风格、画面组织和视觉规则。`
        : preset.preset_id === CLAY_PRESET.preset_id
          ? `统一视觉预设参考图：参考「${variant.style_name}」标题样式，同时继承本组图共同的3D黏土萌趣质感、上标题下主视觉、单主体舞台式海报构图和纯净背景逻辑。`
          : `统一视觉预设参考图：参考「${variant.style_name}」的标题样式、版式组织、整体风格、材质质感和商业海报完成度，同时继承「${preset.preset_name}」的共享视觉规则。`;
  return {
    type: "视觉预设",
    source: "视觉预设",
    role: variant.reference_role || "标题样式与共享视觉骨架",
    number: `PRESET_${variant.variant_id}`,
    label: variant.style_name,
    custom: Boolean(preset.custom),
    preset_id: referencePresetId,
    preset_name: referencePresetName,
    style_group: referenceStyleGroup,
    variant_id: variant.variant_id,
    variant_features: variant.features,
    variant_prompt_note: variant.prompt_note || "",
    Reference: referenceText,
    reason: variant.selection_reason || (variant.reference_role
      ? `选择${variant.reference_role}参考「${variant.style_name}」，用于执行当前设计大纲中的对应视觉任务。`
      : `选择标题/版式变体「${variant.style_name}」，用于约束标题样式、版式组织和「${preset.preset_name}」的共享视觉规则。`),
    selection_score: variant.selection_score || null,
    selection_query: variant.selection_query || "",
    selection_use_for: variant.selection_use_for || "",
    selection_do_not_copy: variant.selection_do_not_copy || "",
    image: url,
    local_image: url,
    image_url: "",
    description: variant.description || variant.features.join("、"),
    execution_description: variant.execution_description || "",
    layout_metadata: variant.layout_metadata || {},
    typography_render_mode: variant.typography_render_mode || "reference",
  };
}

function bestReference(material) {
  if (material.reference_description) return material.reference_description;
  const avoidMarkers = ["不适合", "不可", "破坏", "违和", "过于", "不建议", "避免", "弱化"];
  const looksNegative = (text) => avoidMarkers.filter((marker) => textOf(text).includes(marker)).length >= 2;
  const candidates = [
    material.reference,
    material.description,
    material.merit,
    material.style,
    material.avoid,
  ].filter((value) => textOf(value).trim());

  if (material.reference && looksNegative(material.reference) && material.avoid && !looksNegative(material.avoid)) {
    return material.avoid;
  }
  return candidates.find((value) => !looksNegative(value)) || candidates[0] || "参考该素材的画面语言、风格气质与视觉组织方式";
}

function selectionReason(type, material, scores) {
  const scoreText = scores?.total ? `综合匹配分 ${scores.total.toFixed(2)}` : "综合匹配度较高";
  if (type === "字体") {
    return `${scoreText}；该图的字体气质、字重和标题层级更贴近当前信息层级需求，可用于约束主标题识别度和排版节奏。`;
  }
  if (type === "构图") {
    return `${scoreText}；该图的主体位置、信息区分布和空间层次更贴近当前画面大纲，可用于约束主体与标题区的关系。`;
  }
  return `${scoreText}；参考描述与当前需求较匹配。`;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) throw httpError(413, `JSON 请求体超过大小限制 ${MAX_JSON_BYTES} 字节`);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeNumber(value) {
  return textOf(value).trim().replace(/-/g, "_");
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => textOf(item).trim()).filter(Boolean))];
  }
  const raw = textOf(value).trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      return normalizeStringList(JSON.parse(raw));
    } catch {
      // Fall through to delimiter parsing for manually entered values.
    }
  }
  return [...new Set(raw.split(/[,，、;；|\n]+/).map((item) => item.trim()).filter(Boolean))];
}

function normalizeReferenceRoles(value, legacyType = "") {
  const explicit = normalizeStringList(value)
    .map((role) => LEGACY_REFERENCE_ROLE_MAP[role] || role)
    .filter((role) => REFERENCE_ROLES.includes(role));
  const legacyRole = LEGACY_REFERENCE_ROLE_MAP[textOf(legacyType).trim()];
  return [...new Set([...explicit, ...(legacyRole ? [legacyRole] : [])])];
}

function normalizeMaterial(raw, index = 0) {
  const number = normalizeNumber(raw.number || raw["素材编号"] || raw.id || `MATERIAL_${Date.now()}_${index}`);
  const image = textOf(raw.image || raw.local_image || raw.image_url || raw["图片image"] || raw["图片"] || "").trim();
  const legacyType = textOf(raw.type || raw["类型"] || raw["素材类型"]).trim();
  const referenceRoles = normalizeReferenceRoles(raw.reference_roles || raw.referenceRoles, legacyType);
  return {
    number,
    title: textOf(raw.title || raw.name || raw["素材名称"] || "").trim(),
    type: legacyType || referenceRoles[0] || "完整案例",
    reference_roles: referenceRoles.length ? referenceRoles : ["完整案例"],
    image,
    category: textOf(raw.category || raw["适用品类"] || raw["品类"]).trim(),
    reference_description: textOf(
      raw.reference_description || raw["参考描述"] || raw.description || raw.reference || raw["可参考"] || raw.merit || raw.style,
    ).trim(),
    design_type: textOf(raw.design_type || raw.designType || raw["设计类型"] || "").trim(),
    industry_tags: normalizeStringList(raw.industry_tags || raw.industryTags || raw["行业标签"]),
    style_tags: normalizeStringList(raw.style_tags || raw.styleTags || raw["风格标签"]),
    layout_tags: normalizeStringList(raw.layout_tags || raw.layoutTags || raw["版式标签"]),
    source: textOf(raw.source || "local").trim() || "local",
    source_id: textOf(raw.source_id || raw.sourceId || "").trim(),
    source_url: textOf(raw.source_url || raw.sourceUrl || raw.pin_url || raw.pinUrl || "").trim(),
    source_author: textOf(raw.source_author || raw.sourceAuthor || raw.author || "").trim(),
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    created_at: textOf(raw.created_at || raw.createdAt || "").trim(),
  };
}

async function loadMaterials() {
  if (IS_OSS) {
    try {
      const payload = JSON.parse((await storageGet("data/materials.json")).toString("utf-8"));
      return (payload.materials || []).map(normalizeMaterial).filter((item) => item.number && item.type);
    } catch (error) {
      if (!(error instanceof StorageError)) throw error;
      if (!existsSync(PACKAGED_MATERIALS_PATH)) return [];
      const payload = JSON.parse(await readFile(PACKAGED_MATERIALS_PATH, "utf-8"));
      const materials = (payload.materials || []).map(normalizeMaterial).filter((item) => item.number && item.type);
      await saveMaterials(materials);
      return materials;
    }
  }
  const sourcePath = existsSync(MATERIALS_PATH) ? MATERIALS_PATH : PACKAGED_MATERIALS_PATH;
  const payload = JSON.parse(await readFile(sourcePath, "utf-8"));
  return (payload.materials || []).map(normalizeMaterial).filter((item) => item.number && item.type);
}

async function saveMaterials(materials) {
  const normalized = materials.map(normalizeMaterial).filter((item) => item.number && item.type);
  const payload = JSON.stringify({ source: "dynamic-material-library", count: normalized.length, materials: normalized }, null, 2);
  if (IS_OSS) {
    await storagePut("data/materials.json", Buffer.from(payload, "utf-8"), { contentType: "application/json" });
    return normalized;
  }
  await mkdir(path.dirname(MATERIALS_PATH), { recursive: true });
  await writeFile(MATERIALS_PATH, payload, "utf-8");
  return normalized;
}

const PACKAGED_ASSETS_PATH = path.join(__dirname, "data", "assets.json");

function normalizeAssetIndexRecord(raw) {
  const item = { ...(raw && typeof raw === "object" ? raw : {}) };
  const objKey = String(item.object_key || "").trim();
  const rawName = String(item.name || "").trim();
  const rawUrl = String(item.url || "").trim();
  if (!objKey && !rawName && !rawUrl) return null;
  const cleanName = (!rawName || rawName.includes("?") || /^https?:\/\//i.test(rawName))
    ? (objKey ? objKey.split("/").pop() : decodeURIComponent(rawUrl.split(/[?#]/)[0].split("/").pop() || "") || rawName)
    : rawName;
  item.name = cleanName;
  return item;
}

async function loadAssetsIndex() {
  try {
    const payload = JSON.parse((await storageGet("data/assets.json")).toString("utf-8"));
    const list = Array.isArray(payload?.assets) ? payload.assets : [];
    const seen = new Set();
    const result = [];
    for (const raw of list) {
      const item = normalizeAssetIndexRecord(raw);
      if (!item) continue;
      const key = item.object_key || `name:${item.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
    if (!IS_OSS && existsSync(PACKAGED_ASSETS_PATH)) {
      const payload = JSON.parse(await readFile(PACKAGED_ASSETS_PATH, "utf-8"));
      return Array.isArray(payload?.assets) ? payload.assets : [];
    }
    return [];
  }
}

async function saveAssetsIndex(assets) {
  const payload = JSON.stringify({ source: "asset-index", count: assets.length, assets }, null, 2);
  await storagePut("data/assets.json", Buffer.from(payload, "utf-8"), { contentType: "application/json" });
  return assets;
}

const PROJECTS_INDEX_KEY = "data/projects.json";

function newProjectId() {
  return `p_${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function newProjectElementId() {
  return `e_${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function newProjectMessageId() {
  return `m_${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

async function loadProjectsIndex() {
  try {
    const payload = JSON.parse((await storageGet(PROJECTS_INDEX_KEY)).toString("utf-8"));
    return Array.isArray(payload?.projects) ? payload.projects : [];
  } catch (error) {
    if (!(error instanceof StorageError)) throw error;
    return null;
  }
}

async function saveProjectsIndex(projects) {
  const payload = JSON.stringify({ source: "project-index", count: projects.length, projects }, null, 2);
  await storagePut(PROJECTS_INDEX_KEY, Buffer.from(payload, "utf-8"), { contentType: "application/json" });
  return projects;
}

async function getProjects() {
  const projects = await loadProjectsIndex();
  if (projects !== null) return projects;
  const assets = await loadAssetsIndex();
  const seeded = assets.map((asset) => ({
    id: `p_legacy_${String(asset.name || "asset").replace(/\.[^.]+$/, "").replace(/[^\w-]/g, "_")}`,
    title: "Untitled",
    prompt: textOf(asset.description).trim(),
    created_at: asset.created_at || new Date().toISOString(),
    updated_at: asset.modified_at || asset.created_at || new Date().toISOString(),
    thumbnail: asset.object_key || "",
    elements: asset.object_key
      ? [{ id: newProjectElementId(), kind: "kv", name: String(asset.name || ""), object_key: asset.object_key, x: 80, y: 110, created_at: asset.created_at }]
      : [],
    messages: [],
  }));
  await saveProjectsIndex(seeded);
  return seeded;
}

function decorateProject(project = {}) {
  return {
    ...project,
    thumbnail_url: project.thumbnail ? storageSignUrl(project.thumbnail) : "",
    elements: (project.elements || []).map((element) => ({
      ...element,
      url: element.object_key ? storageSignUrl(element.object_key) : "",
    })),
    messages: (project.messages || []).map((message) => ({
      ...message,
      image_url: message.image_object_key ? storageSignUrl(message.image_object_key) : "",
    })),
  };
}

function elementsFromImageResult(result) {
  const image = result?.image_result;
  if (!image || image.skipped) return [];
  const now = new Date().toISOString();
  const elements = [];
  const typoKey = image.layers?.typography?.object_key;
  const sceneKey = image.layers?.scene?.object_key;
  if (typoKey) {
    elements.push({ id: newProjectElementId(), kind: "typography", name: typoKey.split("/").pop(), object_key: typoKey, created_at: now });
  }
  if (sceneKey) {
    elements.push({ id: newProjectElementId(), kind: "kv", name: sceneKey.split("/").pop(), object_key: sceneKey, created_at: now });
  }
  if (!elements.length && image.object_key) {
    elements.push({ id: newProjectElementId(), kind: "kv", name: String(image.name || image.object_key.split("/").pop()), object_key: image.object_key, created_at: now });
  }
  return elements;
}

async function appendGenerationToProject(projectId, result) {
  const projects = await getProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) return null;
  const added = elementsFromImageResult(result);
  if (!added.length) return project;
  const existingKeys = new Set((project.elements || []).map((element) => element.object_key).filter(Boolean));
  const unique = added.filter((element) => !existingKeys.has(element.object_key));
  if (!unique.length) return project;
  project.elements = [...(project.elements || []), ...unique];
  const finalElement = unique.find((element) => element.kind === "kv");
  if (finalElement) project.thumbnail = finalElement.object_key;
  project.updated_at = new Date().toISOString();
  await saveProjectsIndex(projects);
  return project;
}

async function appendProjectMessage(projectId, role, content) {
  const projects = await getProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) return null;
  const message = {
    id: newProjectMessageId(),
    role: role === "assistant" ? "assistant" : "user",
    content: textOf(content).trim().slice(0, 4000),
    created_at: new Date().toISOString(),
  };
  project.messages = [...(project.messages || []), message];
  project.updated_at = message.created_at;
  await saveProjectsIndex(projects);
  return message;
}

async function saveProjectCanvas(projectId, { title, elements, edges, viewport, settings, messages }) {
  const projects = await getProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) return null;
  if (title && textOf(title).trim()) project.title = textOf(title).trim().slice(0, 60);
  if (Array.isArray(elements)) {
    const byKey = new Map((project.elements || []).map((element) => [element.object_key, element]));
    for (const element of elements) {
      if (!element || !element.object_key) continue;
      const key = textOf(element.object_key);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        if (textOf(element.id)) existing.id = textOf(element.id).slice(0, 160);
        if (["typography", "kv", "title", "background", "package"].includes(element.kind)) existing.kind = element.kind;
        if (Number.isFinite(Number(element.x))) existing.x = Number(element.x);
        if (Number.isFinite(Number(element.y))) existing.y = Number(element.y);
        if (textOf(element.name)) existing.name = textOf(element.name);
      } else {
        byKey.set(key, {
          id: textOf(element.id) || newProjectElementId(),
          kind: ["typography", "kv", "title", "background", "package"].includes(element.kind) ? element.kind : "kv",
          name: textOf(element.name) || key.split("/").pop(),
          object_key: key,
          x: Number.isFinite(Number(element.x)) ? Number(element.x) : 0,
          y: Number.isFinite(Number(element.y)) ? Number(element.y) : 0,
          created_at: new Date().toISOString(),
        });
      }
    }
    project.elements = [...byKey.values()];
    const lastKv = [...project.elements].reverse().find((element) => element.kind === "kv");
    if (lastKv) project.thumbnail = lastKv.object_key;
  }
  if (Array.isArray(edges)) {
    project.edges = edges.slice(0, 500).map((edge) => ({
      id: textOf(edge.id).slice(0, 160),
      source: textOf(edge.source).slice(0, 160),
      target: textOf(edge.target).slice(0, 160),
    })).filter((edge) => edge.id && edge.source && edge.target);
  }
  if (viewport && typeof viewport === "object") {
    project.viewport = {
      x: Number.isFinite(Number(viewport.x)) ? Number(viewport.x) : 0,
      y: Number.isFinite(Number(viewport.y)) ? Number(viewport.y) : 0,
      zoom: Number.isFinite(Number(viewport.zoom)) ? Math.min(3, Math.max(0.1, Number(viewport.zoom))) : 1,
    };
  }
  if (settings && typeof settings === "object") {
    project.settings = {
      image_size: textOf(settings.image_size).slice(0, 16),
      style_preset: textOf(settings.style_preset).slice(0, 120),
      style_name: textOf(settings.style_name).slice(0, 120),
      integrated_layout_variant: textOf(settings.integrated_layout_variant).slice(0, 160),
      doudou_ip: Boolean(settings.doudou_ip),
      include_logo: Boolean(settings.include_logo),
      include_search_overlay: Boolean(settings.include_search_overlay),
    };
  }
  if (Array.isArray(messages)) {
    project.messages = messages.slice(-100).map((message) => ({
      id: textOf(message.id).slice(0, 160) || newProjectMessageId(),
      role: message.role === "user" ? "user" : "assistant",
      kind: message.kind === "status" ? "status" : "message",
      content: textOf(message.content).slice(0, 4000),
      image_object_key: textOf(message.image_object_key).slice(0, 1000),
      imageName: textOf(message.imageName).slice(0, 240),
      created_at: message.created_at || new Date().toISOString(),
    })).filter((message) => message.content || message.image_object_key);
  }
  project.updated_at = new Date().toISOString();
  await saveProjectsIndex(projects);
  return project;
}

async function deleteProjectById(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return null;
  const projects = await getProjects();
  const project = projects.find((item) => item.id === id);
  if (!project) return null;
  const elementKeys = new Set((project.elements || []).map((element) => element.object_key).filter(Boolean));
  for (const key of elementKeys) await storageDelete(key);
  const assets = await loadAssetsIndex();
  const removedAssets = assets.filter((asset) => elementKeys.has(asset.object_key));
  if (removedAssets.length) {
    const removedKeys = new Set(removedAssets.flatMap((asset) => collectAssetKeys(asset)));
    for (const key of removedKeys) await storageDelete(key);
    await saveAssetsIndex(assets.filter((asset) => !removedKeys.has(asset.object_key)));
  }
  await saveProjectsIndex(projects.filter((item) => item.id !== id));
  return project;
}

async function deleteProjectElementById(projectId, elementId) {
  const projects = await getProjects();
  const project = projects.find((item) => item.id === projectId);
  if (!project) return null;
  const index = (project.elements || []).findIndex((element) => element.id === elementId);
  if (index < 0) return null;
  const [removed] = project.elements.splice(index, 1);
  const stillUsedByProject = (project.elements || []).some((element) => element.object_key === removed.object_key);
  if (!stillUsedByProject) {
    const assets = await loadAssetsIndex();
    const asset = assets.find((item) => item.object_key === removed.object_key);
    if (asset) {
      await deleteAssetByName(asset.name);
    } else {
      await storageDelete(removed.object_key);
    }
  }
  if (project.thumbnail === removed.object_key) {
    const lastKv = [...project.elements].reverse().find((element) => element.kind === "kv");
    project.thumbnail = lastKv?.object_key || "";
  }
  project.updated_at = new Date().toISOString();
  await saveProjectsIndex(projects);
  return removed;
}

async function listAssets() {
  const index = await loadAssetsIndex();
  const decorated = index.map(decorateAssetUrls);
  if (!IS_OSS && existsSync(OUTPUT_DIR)) {
    const names = (await readdir(OUTPUT_DIR)).filter((name) => /^kv-.*\.(png|jpe?g|webp)$/i.test(name));
    const known = new Set(decorated.map((item) => item.name));
    for (const name of names) {
      if (known.has(name)) continue;
      const file = path.join(OUTPUT_DIR, name);
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      decorated.push({
        name,
        object_key: outputKey(name),
        url: `/outputs/${name}`,
        size: info.size,
        created_at: info.birthtime.toISOString(),
        modified_at: info.mtime.toISOString(),
        generation_mode: "legacy",
      });
    }
  }
  return decorated.sort(
    (a, b) => new Date(b.modified_at || b.created_at || 0) - new Date(a.modified_at || a.created_at || 0),
  );
}

function decorateAssetUrls(asset = {}) {
  const url = asset.object_key ? storageSignUrl(asset.object_key) : textOf(asset.url || "");
  const layers = asset.layers
    ? {
        ...asset.layers,
        typography: asset.layers.typography?.object_key
          ? { ...asset.layers.typography, url: storageSignUrl(asset.layers.typography.object_key) }
          : (asset.layers.typography || null),
        scene: asset.layers.scene?.object_key
          ? { ...asset.layers.scene, url: storageSignUrl(asset.layers.scene.object_key) }
          : (asset.layers.scene || null),
      }
    : null;
  const split = asset.split
    ? {
        ...asset.split,
        title_layer: asset.split.title_layer?.object_key
          ? {
              ...asset.split.title_layer,
              url: storageSignUrl(asset.split.title_layer.object_key),
              transparent_url: asset.split.title_layer.transparent_object_key
                ? storageSignUrl(asset.split.title_layer.transparent_object_key)
                : "",
            }
          : (asset.split.title_layer || null),
        background_layer: asset.split.background_layer?.object_key
          ? { ...asset.split.background_layer, url: storageSignUrl(asset.split.background_layer.object_key) }
          : (asset.split.background_layer || null),
        split_package: asset.split.split_package?.object_key
          ? { ...asset.split.split_package, url: storageSignUrl(asset.split.split_package.object_key) }
          : (asset.split.split_package || null),
      }
    : null;
  const references = (asset.references || [])
    .map((ref) => {
      const raw = textOf(ref).trim();
      if (!raw) return "";
      if (/^(https?:|data:|blob:)/.test(raw)) return raw;
      if (raw.startsWith("/")) return IS_OSS ? "" : raw;
      return storageSignUrl(raw) || raw;
    })
    .filter(Boolean);
  return { ...asset, url, layers, split, references };
}

function collectAssetKeys(asset = {}) {
  const keys = [];
  if (asset.object_key) keys.push(asset.object_key);
  for (const layer of [asset.layers?.typography, asset.layers?.scene]) {
    if (layer?.object_key) keys.push(layer.object_key);
  }
  const split = asset.split || {};
  if (split.title_layer?.object_key) keys.push(split.title_layer.object_key);
  if (split.title_layer?.transparent_object_key) keys.push(split.title_layer.transparent_object_key);
  if (split.background_layer?.object_key) keys.push(split.background_layer.object_key);
  if (split.split_package?.object_key) keys.push(split.split_package.object_key);
  return [...new Set(keys.filter(Boolean))];
}

async function persistAssetRecord(result) {
  const image = result?.image_result;
  const name = textOf(image?.name).trim();
  if (!name || image?.skipped) return;
  const assets = await loadAssetsIndex();
  const existing = assets.find((item) => (
    (image.object_key && item.object_key === image.object_key) || item.name === name
  ));
  const record = {
    name,
    object_key: image.object_key || outputKey(name),
    title: textOf(result.request?.campaign_name).trim(),
    subtitle: textOf(result.request?.campaign_subtitle).trim(),
    time: textOf(result.request?.campaign_time).trim(),
    description: textOf(result.request?.visual_description).trim(),
    references: (result.request?.uploaded_references || []).map(objectKeyFromUrl).filter(Boolean),
    creative_plan: result.creative_plan || null,
    preflight_review: result.preflight_review || null,
    quality_review: result.quality_review || null,
    retrieval: result.retrieval || null,
    generation_mode: image.generation_mode || "one-shot",
    layers: image.layers?.typography?.object_key || image.layers?.scene?.object_key
      ? {
          typography: image.layers.typography?.object_key
            ? { object_key: image.layers.typography.object_key }
            : null,
          scene: image.layers.scene?.object_key
            ? { object_key: image.layers.scene.object_key }
            : null,
        }
      : null,
    split: existing?.split || null,
    created_at: existing?.created_at || new Date().toISOString(),
    modified_at: new Date().toISOString(),
  };
  const next = assets.filter((item) => !(
    (image.object_key && item.object_key === image.object_key) || item.name === name
  ));
  next.push(record);
  await saveAssetsIndex(next);
}

async function saveAssetSplitRecord(name, splitResult) {
  const assets = await loadAssetsIndex();
  const index = assets.findIndex((item) => item.name === name);
  if (index < 0) return;
  const split = {
    title_layer: splitResult.title_layer?.object_key
      ? { object_key: splitResult.title_layer.object_key, transparent_object_key: splitResult.title_layer.transparent_object_key || "" }
      : null,
    background_layer: splitResult.background_layer?.object_key
      ? { object_key: splitResult.background_layer.object_key }
      : null,
    split_package: splitResult.split_package?.object_key
      ? { object_key: splitResult.split_package.object_key }
      : null,
    created_at: new Date().toISOString(),
  };
  assets[index] = { ...assets[index], split, modified_at: new Date().toISOString() };
  await saveAssetsIndex(assets);
}

async function deleteAssetByName(rawName) {
  const raw = String(rawName || "").trim();
  if (!raw) return null;
  const name = decodeURIComponent(raw.split(/[?#]/)[0].split("/").pop() || raw);
  const assets = await loadAssetsIndex();
  const target = assets.find((item) => (
    item.name === raw ||
    item.name === name ||
    item.object_key === raw ||
    item.object_key === `outputs/${name}` ||
    (item.object_key && item.object_key.split("/").pop() === name)
  ));
  if (target) {
    for (const key of collectAssetKeys(target)) {
      await storageDelete(key);
    }
    const next = assets.filter((item) => item.name !== name);
    await saveAssetsIndex(next);
    return { ok: true, deleted: name, count: next.length, assets: await listAssets() };
  }
  if (!IS_OSS && name === path.basename(name) && existsSync(path.join(OUTPUT_DIR, name))) {
    await unlink(path.join(OUTPUT_DIR, name));
    return { ok: true, deleted: name, count: assets.length, assets: await listAssets() };
  }
  return null;
}

async function outputAssetPathByName(rawName) {
  const name = String(rawName || "").trim();
  if (!name || name !== path.basename(name)) return null;
  const assets = await loadAssetsIndex();
  const record = assets.find((item) => item.name === name);
  if (record?.object_key) {
    return {
      name,
      objectKey: record.object_key,
      url: storageSignUrl(record.object_key),
      filePath: IS_OSS ? "" : path.join(OUTPUT_DIR, name),
    };
  }
  if (!IS_OSS && existsSync(path.join(OUTPUT_DIR, name))) {
    return { name, objectKey: outputKey(name), url: `/outputs/${name}`, filePath: path.join(OUTPUT_DIR, name) };
  }
  return null;
}

function imageSourceRoots() {
  return {
    style: STYLE_DIR,
    image: IMAGE_DIR,
    doudou: DOUDOU_DIR,
    assets: ASSET_DIR,
    uploads: [UPLOAD_ROOT, PACKAGED_UPLOAD_ROOT],
    outputs: OUTPUT_DIR,
  };
}

function vercelDeploymentBaseUrl() {
  const raw = String(
    process.env.VERCEL_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_BRANCH_URL
    || process.env.REFRA_DEPLOYMENT_BASE_URL
    || "",
  ).trim();
  if (!raw) return "";
  const host = raw.replace(/^https?:\/\//i, "").split("/")[0].split("?")[0].split("#")[0];
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".")) return "";
  return `https://${host}`;
}

function materialImagePath(image) {
  const source = textOf(image).trim();
  if (!source) return null;
  const local = resolveLocalSource(source, imageSourceRoots());
  return local ? { file: local.file, base: local.base } : null;
}

async function deleteUploadedMaterialImage(material) {
  const image = textOf(material?.image).trim();
  if (!image.startsWith("/uploads/")) return false;
  if (IS_OSS) {
    await storageDelete(image.slice(1));
    const local = materialImagePath(image);
    if (local?.file && existsSync(local.file)) await unlink(local.file).catch(() => {});
    return true;
  }
  const local = materialImagePath(image);
  if (!local) return false;
  const file = path.resolve(local.file);
  const base = path.resolve(local.base);
  if (IS_VERCEL && base === path.resolve(PACKAGED_UPLOAD_ROOT)) return false;
  if (!file.startsWith(`${base}${path.sep}`) || !existsSync(file)) return false;
  await unlink(file);
  return true;
}

async function deleteMaterialByNumber(number) {
  const normalizedNumber = textOf(number).trim();
  if (!normalizedNumber) throw new Error("缺少素材编号");
  const existing = await loadMaterials();
  const target = existing.find((item) => item.number === normalizedNumber);
  if (!target) return null;
  const materials = await saveMaterials(existing.filter((item) => item.number !== normalizedNumber));
  let image_deleted = false;
  try {
    image_deleted = await deleteUploadedMaterialImage(target);
  } catch {
    image_deleted = false;
  }
  return { ok: true, deleted: normalizedNumber, image_deleted, count: materials.length, materials };
}

async function readMultipart(req) {
  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("缺少 multipart boundary");
  const boundary = `--${match[1] || match[2]}`;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw httpError(413, `上传内容超过大小限制 ${MAX_UPLOAD_BYTES} 字节`);
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const raw = buffer.toString("latin1");
  const parts = raw.split(boundary).slice(1, -1);
  const fields = {};
  const files = {};

  for (const part of parts) {
    const clean = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitAt = clean.indexOf("\r\n\r\n");
    if (splitAt < 0) continue;
    const headerText = clean.slice(0, splitAt);
    let bodyText = clean.slice(splitAt + 4);
    if (bodyText.endsWith("\r\n")) bodyText = bodyText.slice(0, -2);
    const name = headerText.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const filename = headerText.match(/filename="([^"]*)"/)?.[1];
    const type = headerText.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream";
    const data = Buffer.from(bodyText, "latin1");
    if (filename) {
      files[name] = { filename, type, data };
    } else {
      fields[name] = data.toString("utf-8");
    }
  }

  return { fields, files };
}

async function saveUploadedFile(file, preferredName) {
  validateImageFile(file);
  const ext = path.extname(file.filename || "") || ".png";
  const safeName = `${preferredName || "material"}-${Date.now()}${ext}`.replace(/[^\w.-]/g, "_");
  const key = `uploads/materials/${safeName}`;
  if (IS_OSS) {
    await storagePut(key, file.data, { contentType: file.type || "image/png" });
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, safeName), file.data);
    return `/uploads/materials/${safeName}`;
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const filePath = path.join(UPLOAD_DIR, safeName);
  await writeFile(filePath, file.data);
  return `/uploads/materials/${safeName}`;
}

function extensionForImageType(contentType) {
  return {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  }[textOf(contentType).split(";")[0].trim().toLowerCase()] || ".jpg";
}

function materialOrientation(width, height) {
  if (!width || !height) return "";
  if (width > height * 1.08) return "横版";
  if (height > width * 1.08) return "竖版";
  return "方形";
}

function safeInspirationSourceId(value) {
  return textOf(value).trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 96);
}

function isInspirationPageUrl(rawUrl, source) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (source === "pinterest") {
      return host === "pin.it" || host === "pinterest.com" || host.endsWith(".pinterest.com");
    }
    if (source === "behance") {
      return (host === "behance.net" || host === "www.behance.net") && /^\/gallery\/\d+\//.test(url.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

async function saveInspirationMaterial(body) {
  const source = textOf(body.source || "pinterest").trim().toLowerCase();
  const sourceConfig = {
    pinterest: { prefix: "PIN", label: "Pinterest", fallbackTitle: "Pinterest 设计案例" },
    behance: { prefix: "BEH", label: "Behance", fallbackTitle: "Behance 设计项目" },
  }[source];
  if (!sourceConfig) throw new Error("该设计灵感来源暂不支持保存");

  const sourceId = safeInspirationSourceId(body.sourceId || body.source_id || body.id);
  const imageUrl = textOf(body.imageUrl || body.image_url).trim();
  const sourceUrl = textOf(body.sourceUrl || body.source_url || body.pinUrl).trim();
  if (!sourceId || !imageUrl || !sourceUrl) throw new Error("搜索结果缺少可保存的图片或来源信息");
  if (!isInspirationPageUrl(sourceUrl, source)) throw new Error(`${sourceConfig.label} 来源链接无效`);

  const requestedRoles = normalizeReferenceRoles(body.reference_roles || body.referenceRoles);
  const referenceRoles = requestedRoles.length ? requestedRoles : ["完整案例"];
  const industryTags = normalizeStringList(body.industry_tags || body.industryTags || body.query);
  const styleTags = normalizeStringList(body.style_tags || body.styleTags);
  const width = Number(body.width) || 0;
  const height = Number(body.height) || 0;
  const orientation = materialOrientation(width, height);
  const layoutTags = [...new Set([
    ...normalizeStringList(body.layout_tags || body.layoutTags),
    ...(orientation ? [orientation] : []),
  ])];
  const existing = await loadMaterials();
  const duplicate = existing.find((item) => (
    item.source === source
    && (item.source_id === sourceId || (item.source_url && item.source_url === sourceUrl))
  ));

  if (duplicate) {
    const material = normalizeMaterial({
      ...duplicate,
      type: referenceRoles[0],
      reference_roles: referenceRoles,
      industry_tags: industryTags,
      style_tags: styleTags.length ? styleTags : duplicate.style_tags,
      layout_tags: layoutTags.length ? layoutTags : duplicate.layout_tags,
    });
    const materials = await saveMaterials(existing.map((item) => item.number === duplicate.number ? material : item));
    return { ok: true, duplicate: true, material, count: materials.length, materials };
  }

  const image = await getInspirationImage(imageUrl);
  const fileName = `${sourceConfig.prefix}_${sourceId}-${Date.now()}${extensionForImageType(image.contentType)}`;
  const safeName = fileName.replace(/[^\w.-]/g, "_");
  const key = `uploads/materials/${safeName}`;
  if (IS_OSS) {
    await storagePut(key, image.buffer, { contentType: image.contentType });
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, safeName), image.buffer);
  } else {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filePath = path.join(UPLOAD_DIR, safeName);
    await writeFile(filePath, image.buffer);
  }

  const title = textOf(body.title).trim() || sourceConfig.fallbackTitle;
  const query = textOf(body.query).trim();
  const description = textOf(body.description).trim();
  const sourceAuthor = textOf(body.author || body.source_author || body.sourceAuthor).trim();
  const material = normalizeMaterial({
    number: `${sourceConfig.prefix}_${sourceId}`,
    title,
    type: referenceRoles[0],
    reference_roles: referenceRoles,
    image: `/uploads/materials/${safeName}`,
    category: industryTags.join("、") || query,
    reference_description: description || [title, sourceAuthor ? `作者：${sourceAuthor}` : "", query ? `匹配主题：${query}` : ""].filter(Boolean).join("；"),
    design_type: textOf(body.designType || body.design_type).trim() || "视觉设计",
    industry_tags: industryTags,
    style_tags: styleTags,
    layout_tags: layoutTags,
    source,
    source_id: sourceId,
    source_url: sourceUrl,
    source_author: sourceAuthor,
    width,
    height,
    created_at: new Date().toISOString(),
  });

  try {
    const materials = await saveMaterials([...existing, material]);
    return { ok: true, duplicate: false, material, count: materials.length, materials };
  } catch (error) {
    await unlink(filePath).catch(() => {});
    throw error;
  }
}

async function saveUploadedReferenceFile(file, preferredName = "reference") {
  validateImageFile(file);
  const ext = path.extname(file.filename || "") || ".png";
  const safeName = `${preferredName}-${Date.now()}${ext}`.replace(/[^\w.-]/g, "_");
  const key = `uploads/references/${safeName}`;
  if (IS_OSS) {
    await storagePut(key, file.data, { contentType: file.type || "image/png" });
    await mkdir(REFERENCE_UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(REFERENCE_UPLOAD_DIR, safeName), file.data);
    return `/uploads/references/${safeName}`;
  }
  await mkdir(REFERENCE_UPLOAD_DIR, { recursive: true });
  const filePath = path.join(REFERENCE_UPLOAD_DIR, safeName);
  await writeFile(filePath, file.data);
  return `/uploads/references/${safeName}`;
}

async function saveStylePresetImage(file, presetId, preferredName = "style") {
  validateImageFile(file);
  const styleId = safeSlug(presetId, "style");
  const dir = path.join(STYLE_UPLOAD_DIR, styleId);
  const ext = path.extname(file.filename || "") || ".png";
  const safeName = `${preferredName}-${Date.now()}${ext}`.replace(/[^\w.-]/g, "_");
  const key = `uploads/styles/${styleId}/${safeName}`;
  if (IS_OSS) {
    await storagePut(key, file.data, { contentType: file.type || "image/png" });
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, safeName), file.data);
    return { file: safeName, url: `/uploads/styles/${styleId}/${safeName}` };
  }
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, safeName);
  await writeFile(filePath, file.data);
  return { file: safeName, url: `/uploads/styles/${styleId}/${safeName}` };
}

async function createCustomStylePreset(fields, files) {
  const name = textOf(fields.name).trim();
  if (!name) throw new Error("请填写风格名称");
  const id = safeSlug(fields.id || name, "style");
  const existing = loadCustomStylePresets();
  if (STYLE_PRESETS.some((item) => item.id === id) || existing.some((item) => item.preset_id === id)) {
    throw new Error(`风格 ID 已存在：${id}`);
  }

  const referenceFiles = Object.entries(files)
    .filter(([key, file]) => key.startsWith("reference_image_") && file?.data?.length)
    .sort(([a], [b]) => Number(a.match(/_(\d+)$/)?.[1] || 0) - Number(b.match(/_(\d+)$/)?.[1] || 0))
    .map(([, file]) => file);
  if (!referenceFiles.length) throw new Error("请至少上传 1 张风格参考图");

  const savedReferences = [];
  for (const [index, file] of referenceFiles.entries()) {
    savedReferences.push(await saveStylePresetImage(file, id, `reference-${index + 1}`));
  }
  const thumbnail = files.thumbnail?.data?.length
    ? (await saveStylePresetImage(files.thumbnail, id, "thumbnail")).url
    : savedReferences[0].url;

  let variantConfig = [];
  if (fields.variants_json) {
    try {
      const parsed = JSON.parse(fields.variants_json);
      variantConfig = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      throw new Error(`变体 JSON 解析失败：${error.message}`);
    }
  }

  const titleVariants = savedReferences.map((image, index) => {
    const config = variantConfig[index] || {};
    return {
      variant_id: safeSlug(config.variant_id || `${id}_variant_${index + 1}`, "variant"),
      file: image.file,
      image: image.url,
      style_name: textOf(config.style_name || `参考图 ${index + 1}`).trim(),
      features: Array.isArray(config.features)
        ? config.features
        : linesOf(config.features || fields.visual_keywords || fields.composition_rules || fields.color_rules || fields.texture_rules || fields.style_group || name),
      prompt_note: textOf(config.prompt_note || fields.prompt_note).trim(),
      best_for: Array.isArray(config.best_for) ? config.best_for : linesOf(config.best_for || fields.applicable_categories),
    };
  });

  const preset = normalizeCustomStylePreset({
    custom: true,
    preset_id: id,
    id,
    name,
    preset_name: `${name}风格预设`,
    subtitle: fields.subtitle || fields.style_group || "自定义风格",
    style_group: fields.style_group || name,
    output_type: fields.output_type || "营销KV / 风格化海报",
    applicable_categories: linesOf(fields.applicable_categories),
    visual_keywords: linesOf(fields.visual_keywords || fields.style_group || name),
    reference_base: "uploads",
    reference_dir: id,
    thumbnail,
    shared_style: {
      visual_style: linesOf(fields.visual_keywords || fields.style_group || name),
      composition_rules: linesOf(fields.composition_rules),
      color_rules: linesOf(fields.color_rules),
      texture_rules: linesOf(fields.texture_rules),
      mood: linesOf(fields.mood),
    },
    title_style: {
      style_name: textOf(fields.title_style_name || "参考图标题样式").trim(),
      features: linesOf(fields.title_style_features),
      avoid: linesOf(fields.title_style_avoid),
    },
    scene_expansion_rules: linesOf(fields.scene_expansion_rules),
    prompt_note: textOf(fields.prompt_note).trim(),
    title_variants: titleVariants,
  });

  const presets = await saveCustomStylePresets([...existing, preset]);
  return { ok: true, preset, presets, style_presets: allStylePresetCards(), count: presets.length };
}

async function deleteCustomStylePreset(id) {
  const styleId = safeSlug(id, "");
  const existing = loadCustomStylePresets();
  const target = existing.find((item) => item.preset_id === styleId);
  if (!target) return null;
  const presets = await saveCustomStylePresets(existing.filter((item) => item.preset_id !== styleId));
  return { ok: true, deleted: styleId, presets, style_presets: allStylePresetCards(), count: presets.length };
}

function runPythonImport(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [path.join(__dirname, "tools", "import_materials.py"), filePath], { cwd: __dirname });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `xlsx 导入失败：${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`xlsx 导入结果解析失败：${error.message}`));
      }
    });
  });
}

function applyLogoOverlay(filePath, request = {}) {
  const includeLogo = request.include_logo !== false;
  const includeSearch = request.include_search_overlay !== false;
  if (!includeLogo && !includeSearch) {
    return Promise.resolve({ logo_overlay: null, search_overlay: null });
  }
  if (includeLogo && !existsSync(LOGO_DARK_BG_PATH)) {
    return Promise.resolve({ logo_overlay: null, search_overlay: null });
  }
  return new Promise((resolve, reject) => {
    const lightLogoPath = existsSync(LOGO_LIGHT_BG_PATH) ? LOGO_LIGHT_BG_PATH : LOGO_DARK_BG_PATH;
    const hasSearchAssets = existsSync(SEARCH_LIGHT_BG_PATH) && existsSync(SEARCH_DARK_BG_PATH);
    const child = spawn(
      PYTHON_BIN,
      [
        path.join(__dirname, "tools", "apply_logo.py"),
        filePath,
        LOGO_DARK_BG_PATH,
        lightLogoPath,
        String(LOGO_LEFT),
        String(LOGO_TOP),
        String(LOGO_WIDTH),
        ...(hasSearchAssets
          ? [
              SEARCH_LIGHT_BG_PATH,
              SEARCH_DARK_BG_PATH,
              String(SEARCH_WIDTH),
              String(SEARCH_RIGHT),
              String(SEARCH_BOTTOM),
              textOf(request.campaign_name).trim(),
            ]
          : []),
        String(includeLogo),
        String(includeSearch && hasSearchAssets),
      ],
      { cwd: __dirname },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `logo 叠加失败：${code}`));
        return;
      }
      const [logoName, luminanceText, searchName, searchLuminanceText] = stdout.trim().split(/\t/);
      const isLightBg = logoName === path.basename(lightLogoPath) && lightLogoPath !== LOGO_DARK_BG_PATH;
      resolve({
        logo_overlay: logoName && logoName !== "-"
          ? {
              variant: isLightBg ? "light-bg" : "dark-bg",
              url: isLightBg ? "/image/Group%202147242265.png" : "/image/Group.png",
              luminance: Number(luminanceText) || null,
              left: LOGO_LEFT,
              top: LOGO_TOP,
              width: LOGO_WIDTH,
            }
          : null,
        search_overlay: searchName && searchName !== "-"
          ? {
              variant: searchName === path.basename(SEARCH_LIGHT_BG_PATH) ? "light-bg" : "dark-bg",
              url: searchName === path.basename(SEARCH_LIGHT_BG_PATH) ? "/image/search_light.png" : "/image/search_dark.png",
              luminance: Number(searchLuminanceText) || null,
              right: SEARCH_RIGHT,
              bottom: SEARCH_BOTTOM,
              width: SEARCH_WIDTH,
            }
          : null,
      });
    });
  });
}

function parseResponseText(payload) {
  if (payload.output_text) return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // Continue with balanced-object extraction below.
      }
    }

    const start = text.indexOf("{");
    if (start < 0) throw new Error("模型没有返回 JSON");

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(text.slice(start, index + 1));
        }
      }
    }

    throw new Error("模型返回的 JSON 不完整");
  }
}

function localImageInput(image = {}) {
  const imagePath = textOf(image.path).trim();
  if (!imagePath || !existsSync(imagePath)) return [];
  const extension = path.extname(imagePath).toLowerCase();
  const mime = MIME[extension] || "image/png";
  const dataUrl = `data:${mime};base64,${readFileSync(imagePath).toString("base64")}`;
  return [
    ...(image.label ? [{ type: "input_text", text: `【${image.label}】` }] : []),
    { type: "input_image", image_url: dataUrl, detail: image.detail || "high" },
  ];
}

async function callResponses({ system, user, expectJson, images = [], maxOutputTokens = TEXT_MAX_OUTPUT_TOKENS, allowJsonRetry = !FAST_PIPELINE }) {
  if (!OPENAI_API_KEY) {
    throw new Error("缺少 OPENAI_API_KEY，无法调用 OpenAI API");
  }

  const userText = expectJson ? `${user}\n\n请只返回合法 JSON object，首字符必须是 {，末字符必须是 }。` : user;
  const imageContent = images.slice(0, 6).flatMap(localImageInput);
  const body = {
    model: TEXT_MODEL,
    max_output_tokens: maxOutputTokens,
    input: [
      { role: "system", content: expectJson ? `${system}\n\n重要：你必须只返回一个合法 JSON object。不要输出 Markdown、代码块、解释、前后缀、自然语言说明或多个 JSON。` : system },
      {
        role: "user",
        content: imageContent.length
          ? [{ type: "input_text", text: userText }, ...imageContent]
          : userText,
      },
    ],
  };
  if (OPENAI_REASONING_EFFORT) body.reasoning = { effort: OPENAI_REASONING_EFFORT };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `OpenAI Responses API 请求失败：${response.status}`;
    throw new Error(message);
  }

  const text = parseResponseText(payload);
  if (!expectJson) return text.trim();
  try {
    return parseJsonLoose(text);
  } catch (firstError) {
    if (!allowJsonRetry) throw firstError;
    const retryText = [
      user,
      "上一次回答未形成完整JSON。请压缩所有长句，每个说明字段控制在80字以内，数组只保留要求的最少项目，仍须覆盖全部必填键。",
      "只返回一个完整合法JSON object，首字符必须是 {，末字符必须是 }。",
    ].join("\n\n");
    const retryBody = {
      ...body,
      max_output_tokens: Math.max(maxOutputTokens, 4096),
      input: [
        { role: "system", content: `${system}\n\n只返回紧凑、完整、合法的 JSON object，不要输出Markdown或解释。` },
        {
          role: "user",
          content: imageContent.length
            ? [{ type: "input_text", text: retryText }, ...imageContent]
            : retryText,
        },
      ],
    };
    const retryResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(retryBody),
    });
    const retryPayload = await retryResponse.json().catch(() => ({}));
    if (!retryResponse.ok) {
      throw new Error(retryPayload.error?.message || `${firstError.message}；JSON重试失败：${retryResponse.status}`);
    }
    try {
      return parseJsonLoose(parseResponseText(retryPayload));
    } catch (retryError) {
      throw new Error(`${firstError.message}；压缩重答后仍失败：${retryError.message}`);
    }
  }
}

async function callVisionResponses({ system, user, imagePath, expectJson = true }) {
  if (!OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY，无法调用 OpenAI API");
  if (!imagePath || !existsSync(imagePath)) throw new Error("缺少可评审的生成图片");
  const extension = path.extname(imagePath).toLowerCase();
  const mime = MIME[extension] || "image/png";
  const dataUrl = `data:${mime};base64,${readFileSync(imagePath).toString("base64")}`;
  const body = {
    model: TEXT_MODEL,
    max_output_tokens: Math.min(TEXT_MAX_OUTPUT_TOKENS, 3200),
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: expectJson ? `${system}\n只返回合法 JSON object。` : system }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: expectJson ? `${user}\n首字符必须是 {，末字符必须是 }。` : user },
          { type: "input_image", image_url: dataUrl, detail: "high" },
        ],
      },
    ],
  };
  if (OPENAI_REASONING_EFFORT) body.reasoning = { effort: OPENAI_REASONING_EFFORT };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI Responses API 请求失败：${response.status}`);
  const text = parseResponseText(payload);
  return expectJson ? parseJsonLoose(text) : text.trim();
}

function mergeCreativePlan(modelPlan = {}, fallbackPlan = {}) {
  const candidates = Array.isArray(modelPlan.candidates) && modelPlan.candidates.length >= 3
    ? modelPlan.candidates.slice(0, 4)
    : fallbackPlan.candidates;
  const candidateIds = new Set((candidates || []).map((item) => item.id));
  const selectedConceptId = candidateIds.has(modelPlan.selected_concept_id)
    ? modelPlan.selected_concept_id
    : fallbackPlan.selected_concept_id;
  const selectedCandidate = (candidates || []).find((item) => item.id === selectedConceptId);
  return {
    ...fallbackPlan,
    ...modelPlan,
    source: "llm-creative-director",
    brief_deconstruction: {
      ...fallbackPlan.brief_deconstruction,
      ...(modelPlan.brief_deconstruction || {}),
    },
    creative_methods: Array.isArray(modelPlan.creative_methods) && modelPlan.creative_methods.length
      ? modelPlan.creative_methods.slice(0, 3)
      : fallbackPlan.creative_methods,
    candidates,
    selected_concept_id: selectedConceptId,
    selected_concept_name: modelPlan.selected_concept_name || selectedCandidate?.name || fallbackPlan.selected_concept_name,
    selection_reason: modelPlan.selection_reason || fallbackPlan.selection_reason,
    selected_blueprint: {
      ...fallbackPlan.selected_blueprint,
      ...(modelPlan.selected_blueprint || {}),
    },
    reference_queries: {
      ...fallbackPlan.reference_queries,
      ...(modelPlan.reference_queries || {}),
    },
  };
}

async function generateCreativePlan(request, brief, preset, knowledge) {
  const fallbackPlan = localCreativePlan(request, brief, knowledge, preset);
  if (!ENABLE_CREATIVE_LLM) return { ...fallbackPlan, source: "local-creative-fast-path" };
  const methodContext = (knowledge.creative_methods || []).map((item) => ({ id: item.id, name: item.name, summary: item.summary, has_image_example: Boolean(item.images?.length) }));
  const caseContext = (knowledge.cases || []).map((item) => ({ id: item.id, brief: item.brief, review: item.review }));
  const methodImages = (knowledge.creative_methods || []).slice(0, 2).flatMap((item) => item.images || []);
  const caseImages = (knowledge.cases || []).flatMap((item) => item.images || []).slice(0, 4);
  const evidenceImages = [...methodImages, ...caseImages]
    .slice(0, CREATIVE_EVIDENCE_IMAGE_LIMIT)
    .map((image) => ({ ...image, detail: CREATIVE_EVIDENCE_IMAGE_DETAIL }));
  const uploadedImages = uploadedReferenceVisionInputs(request);
  const system = [
    "你是一位资深创意总监，负责在生成设计大纲前完成营销KV创意策略。",
    "你的任务不是润色用户原句，而是：先分离硬性事实和策略假设；再使用创意方法形成3个真正不同的方案；逐项比较后只选1个；最后输出可画成草图的分层蓝图和各参考维度检索意图。",
    "用户描述可能很短。你可以为了形成真正有设计感的方案，推导人物/IP、场景、道具、动作、视觉隐喻和记忆符号，但它们必须被明确列入选定方案的 approved_visual_inventions，并能解释其与主题和营销策略的关系；这些属于创意视觉载体，不是用户事实。",
    "不能把推断的人群、品牌、卖点、价格、英文、日期或任何营销文案当成用户事实。推断必须带 confidence 和 basis；未经用户提供的文字绝对不得写入画面。",
    "三个方案不能只是换颜色或换背景，必须在核心概念、视觉载体、冲突/趣味、记忆符号和构图叙事上有差异。",
    "案例文字和Good/Bad Case图片仅用于学习成功/失败判断、构图组织和评审标准，不得照搬案例主题、角色身份或具体元素。创意方法只用于转化思路，不得机械套公式。",
    "用户上传图片与案例图用途不同：当用户用@图片指定主体时，上传图是不可替换的对象身份来源。必须先识别该图中的真实对象类别和关键外观，不得把它推断、改写或替换成任何其他对象。创意只能改变场景、构图、氛围和辅助元素。",
    "输出需简洁，保证JSON完整。",
  ].join("\n");
  const user = [
    `用户输入：${JSON.stringify(request, null, 2)}`,
    `Brief理解：${JSON.stringify(brief, null, 2)}`,
    `风格预设：${JSON.stringify({ preset_id: preset?.preset_id || NO_PRESET_ID, preset_name: preset?.preset_name || "未使用", style_group: preset?.style_group || "" }, null, 2)}`,
    `预设共享视觉原则：${knowledge.preset_principles?.summary || "未提供"}`,
    `候选创意方法：${JSON.stringify(methodContext, null, 2)}`,
    `相关Good/Bad Case：${JSON.stringify(caseContext, null, 2)}`,
    "请返回：brief_deconstruction、creative_methods、candidates（恰好3个）、selected_concept_id、selected_concept_name、selection_reason、selected_blueprint、reference_queries。",
    "每个candidate包含id、name、marketing_strategy、core_concept、visual_carrier、conflict_or_interest、memory_symbol、storyboard、strengths、risk、score、decision。",
    "selected_blueprint包含core_concept、visual_carrier、approved_visual_inventions（数组，每项含element、purpose、source_logic）、conflict_or_interest、memory_symbol、composition、top_layer、middle_layer、bottom_layer、camera、color、material、information_hierarchy。",
    "reference_queries必须包含整合版式、风格、元素、角色。整合版式查询要描述画幅方向、标题字数与行数、是否有副标题/时间、文字区与主视觉区的比例和阅读顺序；当选定方案包含人物、动物、IP、拟人角色或吉祥物时，角色查询必须填写。查询应描述需要什么，不得直接指定编号。",
  ].join("\n\n");
  const modelPlan = await callResponses({ system, user, expectJson: true, images: [...uploadedImages, ...evidenceImages] });
  return mergeCreativePlan(modelPlan, fallbackPlan);
}

function referenceQueryForRole(creativePlan = {}, group = {}, request = {}) {
  const queries = creativePlan.reference_queries || {};
  const byRole = queries[group.role] || queries[group.id] || queries[{
    integrated_layout: "integrated_layout",
    font: "font",
    style: "style",
    element: "element",
    layout: "layout",
    date: "date",
    character: "character",
  }[group.id]];
  const blueprint = creativePlan.selected_blueprint || {};
  const orientation = compositionOrientation(request.image_size);
  const orientationQuery = orientation === "Vertical"
    ? "竖版画幅 Vertical composition"
    : orientation === "Horizontal"
      ? "横版画幅 Horizontal composition"
      : "方形画幅 Square composition";
  const titleLength = Array.from(textOf(request.campaign_name).trim()).length;
  const titleLengthQuery = titleLength
    ? titleLength <= 4
      ? `短标题 ${titleLength}字 强识别标题`
      : titleLength <= 8
        ? `中等长度标题 ${titleLength}字 清晰标题组`
        : `长标题 ${titleLength}字 多行排版`
    : "";
  const time = campaignTimeText(request);
  const timeShapeQuery = time
    ? /[-—~～至到]/.test(time)
      ? "日期区间 起止时间 双日期信息"
      : "单日日期 单日期信息"
    : "";
  const subtitleQuery = campaignSubtitleText(request) ? "包含副标题 主副标题层级" : "无副标题";
  const supplementalQuery = /(补充信息|补充文案|说明文字|地点|地址|会场|场次|权益|卖点|规则)/.test(textOf(request.visual_description))
    ? "包含补充信息 辅助信息模块"
    : "无额外补充信息";
  const roleContext = group.role === "整合版式"
    ? [titleLengthQuery, subtitleQuery, time ? timeShapeQuery : "无活动时间", supplementalQuery, "文字视觉系统 字体样式 字号比例 行数 对齐 阅读顺序 文字安全区 主视觉区域 留白避让"].filter(Boolean).join(" ")
    : group.role === "字体"
    ? [request.visual_description, creativePlan.selected_concept_name, blueprint.core_concept, titleLengthQuery, "字体情绪 字形气质 标题可读性"].filter(Boolean).join(" ")
    : group.role === "日期"
      ? [timeShapeQuery, titleLengthQuery, "日期数字结构 时间模块 与标题层级关系"].filter(Boolean).join(" ")
      : group.role === "排版"
        ? [titleLengthQuery, subtitleQuery, time ? timeShapeQuery : "无活动时间", supplementalQuery, "主标题 副标题 补充信息 时间 位置 比例 对齐 留白 主画面区"].filter(Boolean).join(" ")
        : [request.visual_description, creativePlan.selected_concept_name, blueprint.core_concept].filter(Boolean).join(" ");
  const fallbackQuery = [
    request.campaign_name,
    request.campaign_subtitle,
    request.campaign_time,
    request.visual_description,
    request.image_size,
    creativePlan.selected_concept_name,
    blueprint.core_concept,
    blueprint.visual_carrier,
    blueprint.composition,
    blueprint.camera,
    group.role,
  ].filter(Boolean).join(" ");
  return [textOf(byRole).trim() || fallbackQuery, roleContext, orientationQuery].filter(Boolean).join(" ");
}

function rankPresetReferenceCandidates(preset, group, request, creativePlan) {
  const query = referenceQueryForRole(creativePlan, group, request);
  const orientation = compositionOrientation(request.image_size);
  let variants = loadPresetReferenceGroup(preset, group);
  if (["layout", "integrated_layout"].includes(group.id)) {
    const matched = variants.filter((item) => item.composition_orientation === orientation);
    if (matched.length) variants = matched;
    if (group.id === "integrated_layout") {
      variants = variants.filter((item) => {
        const slots = item.layout_metadata?.supported_slots || {};
        if (campaignSubtitleText(request) && slots.subtitle === false) return false;
        if (campaignTimeText(request) && slots.time === false) return false;
        return true;
      });
    }
  }
  return variants
    .map((variant) => {
      const positiveScore = similarity(query, `${variant.style_name}\n${variant.positive_description || variant.full_description || variant.description}`);
      const negativeScore = variant.negative_description ? similarity(query, variant.negative_description) : 0;
      const semanticScore = Math.max(0, positiveScore - negativeScore * 0.45);
      const orientationBonus = ["layout", "integrated_layout"].includes(group.id) && variant.composition_orientation === orientation ? 0.22 : 0;
      const metadata = variant.layout_metadata || {};
      const slotBonus = group.id === "integrated_layout"
        ? (campaignSubtitleText(request) && metadata.supported_slots?.subtitle !== false ? 0.04 : 0)
          + (campaignTimeText(request) && metadata.supported_slots?.time !== false ? 0.04 : 0)
        : 0;
      const titleLength = Array.from(textOf(request.campaign_name).trim()).length;
      const maximumTitleLength = Number(textOf(metadata.main_title_length?.maximum).match(/\d+/)?.[0] || 0);
      const titleFit = group.id === "integrated_layout" && titleLength && maximumTitleLength
        ? titleLength <= maximumTitleLength ? 0.08 : -0.18
        : 0;
      const tagScore = group.id === "integrated_layout"
        ? similarity(query, [...(metadata.retrieval_tags || []), ...(metadata.layout_family || []), ...(metadata.visual_tone || [])].join(" ")) * 0.16
        : 0;
      return {
        ...variant,
        semantic_score: Math.max(0, Math.min(1, semanticScore + orientationBonus + slotBonus + titleFit + tagScore)),
        contextual_tiebreak: stableUnitHash(`${query}|${variant.variant_id}`),
        selection_query: query,
      };
    })
    .sort((a, b) => {
      const scoreDelta = b.semantic_score - a.semantic_score;
      // Sidecar descriptions often produce several near-equal candidates. Use
      // the current brief as a stable tie-break instead of always preferring
      // the first filename, while preserving clear semantic winners.
      if (Math.abs(scoreDelta) > 0.025) return scoreDelta;
      return b.contextual_tiebreak - a.contextual_tiebreak
        || a.variant_id.localeCompare(b.variant_id, "zh-Hans-CN", { numeric: true });
    });
}

function manuallySelectedIntegratedLayout(preset, request = {}) {
  const variantId = textOf(request.integrated_layout_variant).trim();
  if (!variantId) return null;
  const group = presetReferenceGroups(preset).find((item) => item.id === "integrated_layout");
  if (!group) return null;
  return loadPresetReferenceGroup(preset, group).find((variant) => variant.variant_id === variantId) || null;
}

function localReferenceSelections(candidateGroups = []) {
  return candidateGroups.flatMap(({ group, candidates }) => candidates.slice(0, Math.max(1, Number(group.count) || 1)).map((candidate) => ({
    role: group.role,
    variant_id: candidate.variant_id,
    score: Math.round(candidate.semantic_score * 100),
    reason: candidate.manually_selected
      ? "用户在风格弹窗中手动指定该整合版式；本次固定使用它控制文字视觉系统、信息比例、对齐与阅读顺序。"
      : `该参考的描述与当前创意蓝图中「${candidate.selection_query}」的语义匹配度最高，且满足当前画幅与${group.role}用途约束。`,
    use_for: group.role === "整合版式" ? "文字视觉系统、信息层级、文字安全区、主视觉区域和整张KV的留白避让" : group.role === "字体" ? "标题字形、笔画和层级" : group.role === "排版" ? "主标题、副标题、补充信息、时间和主画面区之间的位置、比例、对齐和留白" : group.role === "日期" ? "时间字形与日期信息样式" : group.role === "角色" ? "角色比例、轮廓和动作语言" : group.role === "元素" ? "主体/道具造型与形态关系" : "整体风格、色彩、材质和商业完成度",
    do_not_copy: group.role === "整合版式"
      ? "只保留用户明确填写的主标题、副标题和活动时间；删除参考图中没有对应用户字段的原业务文字、装饰文案、英文、日期、品牌、版权及其他可读文字，禁止改写或补写；装饰结构只复现参考图实际存在的非文字类型，禁止新增参考图没有的下划线、引号、框线、标签或符号；白色区域仅代表主视觉生成区域"
      : group.role === "排版"
        ? "不复制具体文字、字体字形、日期字形、文字颜色、品牌、logo、水印或无关画面内容"
      : "不复制具体文字、颜色、品牌、logo、水印或与本次主题无关的内容",
  })));
}

async function chooseProductionPresetVariant(preset, request, creativePlan) {
  const groups = activePresetReferenceGroups(preset, request, creativePlan);
  const requestedIntegratedLayout = manuallySelectedIntegratedLayout(preset, request);
  const candidateGroups = groups.map((group) => {
    if (group.id === "integrated_layout" && requestedIntegratedLayout) {
      return {
        group,
        candidates: [{
          ...requestedIntegratedLayout,
          semantic_score: 1,
          contextual_tiebreak: 1,
          selection_query: "用户手动指定的整合版式",
          manually_selected: true,
        }],
      };
    }
    return {
      group,
      candidates: rankPresetReferenceCandidates(preset, group, request, creativePlan).slice(0, 4),
    };
  }).filter((item) => item.candidates.length);
  const hasManualIntegratedLayout = candidateGroups.some(({ group, candidates }) => (
    group.id === "integrated_layout" && candidates.some((candidate) => candidate.manually_selected)
  ));
  const fallbackSelections = localReferenceSelections(candidateGroups);
  let selections = fallbackSelections;
  let selectionMethod = hasManualIntegratedLayout ? "manual-integrated-layout+semantic-contextual" : "semantic-contextual";
  if (OPENAI_API_KEY && ENABLE_REFERENCE_LLM_RERANK && candidateGroups.length) {
    try {
      const candidatePayload = candidateGroups.map(({ group, candidates }) => ({
        role: group.role,
        required_count: Math.max(1, Number(group.count) || 1),
        query: candidates[0]?.selection_query || "",
        candidates: candidates.map((item) => ({
          variant_id: item.variant_id,
          style_name: item.style_name,
          local_score: Math.round(item.semantic_score * 100),
          description: compactKnowledge(item.positive_description || item.description, 1100),
          layout_metadata: item.layout_metadata || {},
          avoid_when: compactKnowledge(item.negative_description, 360),
        })),
      }));
      const reranked = await callResponses({
        system: "你是美术参考图检索编辑。根据已选创意蓝图和候选描述选择最适合执行当前方案的参考图。整合版式必须先满足orientation、supported_slots、标题长度与行数等硬条件，再比较文字视觉系统、主视觉区域和留白关系；禁止随机，禁止仅按编号选择。每个选择必须说明它如何服务当前创意、为什么优于同组候选、只借鉴什么以及禁止复制什么。只返回紧凑JSON。",
        user: [
          `用户输入：${JSON.stringify(request, null, 2)}`,
          `已选创意蓝图：${JSON.stringify({ selected_concept_name: creativePlan.selected_concept_name, selected_blueprint: creativePlan.selected_blueprint }, null, 2)}`,
          `候选参考：${JSON.stringify(candidatePayload, null, 2)}`,
          "返回 {\"selections\":[{\"role\":\"\",\"variant_id\":\"\",\"score\":0,\"reason\":\"\",\"use_for\":\"\",\"do_not_copy\":\"\"}]}。必须覆盖每个候选组，并严格遵守 required_count。",
        ].join("\n\n"),
        expectJson: true,
      });
      if (Array.isArray(reranked.selections) && reranked.selections.length) {
        selections = reranked.selections;
        selectionMethod = hasManualIntegratedLayout ? "manual-integrated-layout+semantic-llm-rerank" : "semantic-llm-rerank";
      }
    } catch {
      selections = fallbackSelections;
    }
  }
  const selectionById = new Map(selections.map((item) => [item.variant_id, item]));
  const references = [];
  for (const { group, candidates } of candidateGroups) {
    const limit = Math.max(1, Number(group.count) || 1);
    const selectedForGroup = selections
      .filter((item) => item.role === group.role)
      .map((item) => candidates.find((candidate) => candidate.variant_id === item.variant_id))
      .filter(Boolean)
      .slice(0, limit);
    const finalCandidates = selectedForGroup.length ? selectedForGroup : candidates.slice(0, limit);
    for (const candidate of finalCandidates) {
      const selection = selectionById.get(candidate.variant_id) || fallbackSelections.find((item) => item.variant_id === candidate.variant_id) || {};
      const {
        full_description: _fullDescription,
        positive_description: _positiveDescription,
        negative_description: _negativeDescription,
        ...publicCandidate
      } = candidate;
      references.push({
        ...publicCandidate,
        selection_score: Number(selection.score) || Math.round(candidate.semantic_score * 100),
        selection_reason: selection.reason || `与当前${group.role}检索意图的语义匹配度最高。`,
        selection_use_for: selection.use_for || group.role,
        selection_do_not_copy: selection.do_not_copy || "不复制无关具体内容",
      });
    }
  }
  return {
    variant_id: references.map((item) => item.variant_id).join("__") || `${preset.preset_id}_references`,
    style_name: references.map((item) => item.style_name).join(" + ") || preset.preset_name,
    features: references.flatMap((item) => item.features || []).slice(0, 48),
    references,
    selection_method: selectionMethod,
    candidate_audit: candidateGroups.map(({ group, candidates }) => ({
      role: group.role,
      query: candidates[0]?.selection_query || "",
      candidates: candidates.map((item) => ({
        variant_id: item.variant_id,
        score: Math.round(item.semantic_score * 100),
        contextual_tiebreak: Number(item.contextual_tiebreak.toFixed(4)),
      })),
    })),
  };
}

function applyCreativePlanToDesign(design = {}, creativePlan = {}) {
  const blueprint = creativePlan.selected_blueprint || {};
  const combine = (primary, secondary) => {
    const first = textOf(primary).trim();
    const second = textOf(secondary).trim();
    if (!first) return second;
    if (!second || first.includes(second)) return first;
    if (second.includes(first)) return second;
    return `${first}；${second}`;
  };
  const layerOutline = [blueprint.top_layer, blueprint.middle_layer, blueprint.bottom_layer].filter(Boolean).join("；");
  const visualInventions = Array.isArray(blueprint.approved_visual_inventions)
    ? blueprint.approved_visual_inventions
      .map((item) => typeof item === "string" ? item : [item.element, item.purpose].filter(Boolean).join("："))
      .filter(Boolean)
    : linesOf(blueprint.approved_visual_inventions);
  const inventionText = visualInventions.join("；");
  const subjectExpansion = { ...(design.subject_expansion || {}) };
  if (blueprint.visual_carrier) subjectExpansion.subject = combine(subjectExpansion.subject, blueprint.visual_carrier);
  if (blueprint.middle_layer) subjectExpansion.midground = combine(subjectExpansion.midground, blueprint.middle_layer);
  if (blueprint.bottom_layer) subjectExpansion.foreground = combine(subjectExpansion.foreground, blueprint.bottom_layer);
  if (inventionText) subjectExpansion.props = combine(subjectExpansion.props, inventionText);
  return {
    ...design,
    creative_strategy: blueprint.core_concept || design.creative_strategy || "",
    creative_methods: creativePlan.creative_methods || [],
    creative_concept: {
      id: creativePlan.selected_concept_id,
      name: creativePlan.selected_concept_name,
      reason: creativePlan.selection_reason,
      visual_carrier: blueprint.visual_carrier || "",
      approved_visual_inventions: visualInventions,
      conflict_or_interest: blueprint.conflict_or_interest || "",
      memory_symbol: blueprint.memory_symbol || "",
    },
    main_visual_subject: combine(design.main_visual_subject, blueprint.visual_carrier),
    subject_relationship: combine(design.subject_relationship, blueprint.conflict_or_interest),
    layout_outline: combine(design.layout_outline, [blueprint.composition, layerOutline].filter(Boolean).join("；")),
    camera_strategy: combine(design.camera_strategy, blueprint.camera),
    color_direction: combine(design.color_direction, blueprint.color),
    material_keywords: combine(design.material_keywords, blueprint.material),
    information_hierarchy: combine(design.information_hierarchy, blueprint.information_hierarchy),
    subject_expansion: subjectExpansion,
  };
}

function applyIntegratedLayoutToDesign(design = {}, variant = null, request = {}) {
  const layoutReference = variant?.references?.find((item) => item.reference_role === "整合版式");
  if (!layoutReference) return design;
  if (design.integrated_layout_reference?.variant_id === layoutReference.variant_id) return design;
  const layoutKnowledge = compactKnowledge(
    layoutReference.execution_description || layoutReference.description || layoutReference.features?.join("、"),
    4600,
  );
  const explicitInformation = [
    hasMainTitle(request) ? `主标题「${textOf(request.campaign_name).trim()}」` : "",
    campaignSubtitleText(request) ? `副标题「${campaignSubtitleText(request)}」` : "",
    campaignTimeText(request) ? `活动时间「${campaignTimeText(request)}」` : "",
  ].filter(Boolean);
  const colorRule = hasMainTitle(request) && (campaignSubtitleText(request) || campaignTimeText(request))
    ? "副标题和活动时间的文字颜色必须与主标题完全一致"
    : "";
  const layoutDirective = [
    `整合版式参考「${layoutReference.style_name}」是文字视觉系统、信息层级和文字区/主画面区关系的最高优先级依据`,
    explicitInformation.length ? `本次业务信息替换为：${explicitInformation.join("、")}` : "本次没有显式主业务文字，不创建主标题槽位",
    "主标题、副标题、活动时间必须分别继承参考图对应信息角色的字形风格、笔画/材质、字号比例、行数、位置、对齐与组合关系，不能退化成通用黑体、通用圆体或默认左对齐",
    INTEGRATED_LAYOUT_DECORATION_RULE,
    integratedLayoutDecorativeCopyContext(request),
    "当本次标题字数与参考图不同，按参考图的内容适配规则重排；优先保持参考文字组的视觉重心、外轮廓和占区，不得因为字数减少就机械左对齐",
    "参考图里的白色或空白区域是主视觉生成区域，不是最终背景色要求；主体和场景在该区域内生成，并避开文字安全区",
    "文字颜色不继承参考图，由当前视觉方向和背景对比决定；副标题、活动时间与主标题保持同一颜色系统",
    colorRule,
    "辅助业务信息只有在用户明确提供时才可补写；不得为了填满版式而创作任何参考图中不存在的文字或装饰角色",
    layoutKnowledge,
  ].filter(Boolean).join("；");
  const existingLayout = textOf(design.layout_outline).trim();
  const existingHierarchy = textOf(design.information_hierarchy).trim();
  const existingInformationArea = textOf(design.subject_expansion?.information_area).trim();
  return {
    ...design,
    integrated_layout_reference: {
      variant_id: layoutReference.variant_id,
      style_name: layoutReference.style_name,
      orientation: layoutReference.composition_orientation,
      metadata: layoutReference.layout_metadata || {},
      rule: layoutKnowledge,
    },
    layout_outline: [layoutDirective, existingLayout].filter(Boolean).join("；"),
    information_hierarchy: [
      existingHierarchy,
      colorRule,
      "可读文字只采用用户输入白名单：主标题、副标题、活动时间仅在对应字段有值时出现；可读信息槽位数量必须与本次实际填写字段数量一致。参考图中没有对应用户字段的副标题、说明、口号、英文眉题、品牌、版权、年份、日期及其他装饰文字全部删除并恢复留白，不得照抄、改写、联想、补全或占位；非文字装饰结构只闭集继承参考图已有类型",
    ].filter(Boolean).join("；"),
    subject_expansion: {
      ...(design.subject_expansion || {}),
      information_area: [layoutDirective, existingInformationArea].filter(Boolean).join("；"),
    },
  };
}

function localPreflightReview(request, creativePlan, design, references) {
  const required = creativePlan.brief_deconstruction?.required_content || [];
  const referenceRoles = [...new Set(references.map((item) => item.role).filter(Boolean))];
  return {
    source: "local-preflight",
    decision: "pass_with_checks",
    hard_constraint_pass: true,
    score: 78,
    dimension_scores: {
      brief_coverage: required.length ? 80 : 72,
      creative_strength: creativePlan.selected_concept_id ? 82 : 65,
      hierarchy_and_whitespace: 78,
      reference_evidence: referenceRoles.length ? 82 : 60,
      production_feasibility: 80,
    },
    strengths: ["已形成选定创意概念与分层蓝图", `已按用途选择${referenceRoles.join("、") || "可用"}参考`],
    blocking_issues: [],
    corrections: [],
    design_patch: {},
    checklist: {
      title_source_valid: hasMainTitle(request) || !/主标题/.test(design.information_hierarchy || ""),
      time_source_valid: Boolean(campaignTimeText(request)) || !/活动时间/.test(design.information_hierarchy || ""),
      one_dominant_subject: Boolean(design.main_visual_subject),
      reference_roles: referenceRoles,
    },
  };
}

async function reviewDesignPreflight(request, brief, creativePlan, design, references, knowledge) {
  const fallback = localPreflightReview(request, creativePlan, design, references);
  if (!OPENAI_API_KEY || !ENABLE_PREFLIGHT_LLM) {
    return {
      ...fallback,
      source: ENABLE_PREFLIGHT_LLM ? fallback.source : "local-art-director-fast-path",
    };
  }
  try {
    const review = await callResponses({
      system: [
        "你是商业KV美术总监，负责生图前评审。",
        "先检查用户硬性信息是否完整覆盖，再评估创意强度、主视觉唯一性、信息层级、留白、画幅适配、参考图选择证据和生图可执行性。",
        "选定创意蓝图中的 visual_carrier、memory_symbol 和 approved_visual_inventions 是已批准的视觉推导，可以进入画面；不得因为追求丰富而建议添加用户未提供的文字、品牌、价格或蓝图之外的无关元素。",
        "如果问题可通过结构字段修正，请在design_patch中给出最小修改；不要重写全部设计。",
        "只返回紧凑JSON。",
      ].join("\n"),
      user: [
        `用户输入：${JSON.stringify(request, null, 2)}`,
        `Brief：${JSON.stringify(brief, null, 2)}`,
        `创意方案：${JSON.stringify(creativePlan, null, 2)}`,
        `设计大纲：${JSON.stringify(design, null, 2)}`,
        `参考选择证据：${JSON.stringify(references.map((item) => ({ number: item.number, role: item.role, reason: item.reason })), null, 2)}`,
        `相关案例评审：${JSON.stringify((knowledge.cases || []).map((item) => ({ id: item.id, review: item.review })), null, 2)}`,
        "返回 decision(pass/revise)、hard_constraint_pass、score(0-100)、dimension_scores、strengths、blocking_issues、corrections、design_patch、checklist。design_patch只可包含visual_keywords、color_direction、main_visual_subject、subject_size_ratio、subject_relationship、information_hierarchy、layout_outline、background_atmosphere、material_keywords、lighting_keywords、typography_strategy、spatial_strategy、camera_strategy、color_strategy、subject_expansion。",
      ].join("\n\n"),
      expectJson: true,
    });
    return { ...fallback, ...review, source: "llm-art-director-preflight" };
  } catch (error) {
    return { ...fallback, warning: error.message };
  }
}

function applyPreflightDesignPatch(design = {}, review = {}) {
  const allowed = new Set([
    "visual_keywords", "color_direction", "main_visual_subject", "subject_size_ratio", "subject_relationship",
    "information_hierarchy", "layout_outline", "background_atmosphere", "material_keywords", "lighting_keywords",
    "typography_strategy", "spatial_strategy", "camera_strategy", "color_strategy", "subject_expansion",
  ]);
  const patch = review.design_patch && typeof review.design_patch === "object" ? review.design_patch : {};
  const safePatch = Object.fromEntries(Object.entries(patch).filter(([key, value]) => allowed.has(key) && value != null));
  return {
    ...design,
    ...safePatch,
    subject_expansion: {
      ...(design.subject_expansion || {}),
      ...(safePatch.subject_expansion || {}),
    },
  };
}

function localImageQualityReview(reason = "") {
  return {
    source: "local-unreviewed",
    decision: "unreviewed",
    hard_constraint_pass: null,
    score: null,
    dimension_scores: {},
    strengths: [],
    blocking_issues: [],
    corrections: [],
    correction_prompt: "",
    warning: reason,
  };
}

async function reviewGeneratedImage(imageResult, request, creativePlan, design, references, knowledge) {
  if (!imageResult || imageResult.skipped || !imageResult.name) return localImageQualityReview(imageResult?.reason || "未生成图片");
  const asset = outputAssetPathByName(imageResult.name);
  if (!asset) return localImageQualityReview("无法定位生成图片");
  try {
    const review = await callVisionResponses({
      system: [
        "你是商业KV美术总监，负责检查刚生成的成图，而不是重新构思。",
        "重点核对：用户硬性内容、已选创意概念、主视觉唯一性、构图与留白、标题准确性、参考图用途是否正确、3D预设共享原则、商业完成度。",
        "只有硬性内容缺失、主题错位、标题错误、主体不清、风格严重不符、参考图明显误用等生产阻断问题，才判定hard_constraint_pass=false。",
        "不要因个人偏好要求增加用户未提供的文字、品牌、价格或道具。只返回紧凑JSON。",
      ].join("\n"),
      user: [
        `用户输入：${JSON.stringify(request, null, 2)}`,
        `选定创意：${JSON.stringify({ name: creativePlan.selected_concept_name, blueprint: creativePlan.selected_blueprint }, null, 2)}`,
        `设计大纲：${JSON.stringify(design, null, 2)}`,
        `参考用途：${JSON.stringify(references.map((item) => ({ number: item.number, role: item.role, reason: item.reason })), null, 2)}`,
        `案例失败经验：${JSON.stringify((knowledge.cases || []).map((item) => ({ id: item.id, review: item.review })), null, 2)}`,
        "返回 decision(pass/revise)、hard_constraint_pass、score(0-100)、dimension_scores(brief_coverage,creative_strength,subject_focus,composition_whitespace,style_reference_fidelity,typography_accuracy,commercial_finish)、strengths、blocking_issues、corrections、correction_prompt。correction_prompt只写针对当前成图的最小返修指令。",
      ].join("\n\n"),
      imagePath: asset.filePath,
      expectJson: true,
    });
    return { ...localImageQualityReview(), ...review, source: "vision-art-director" };
  } catch (error) {
    return localImageQualityReview(error.message);
  }
}

function localBrief(request) {
  const explicitPoints = [
    textOf(request.campaign_name).trim(),
    campaignSubtitleText(request),
    campaignTimeText(request),
    textOf(request.visual_description).trim(),
  ].filter(Boolean);
  return {
    activity_attributes: textOf(request.campaign_name).trim(),
    brand_keywords: "",
    user_profile: "",
    emotion_keywords: "",
    core_selling_points: explicitPoints.join("，"),
  };
}

function localDesign(request, brief) {
  const source = `${request.campaign_name} ${campaignSubtitleText(request)} ${campaignTimeText(request)} ${request.visual_description}`;
  const uploadedRoles = (request.uploaded_references || []).map((_, index) => ({ role: uploadedReferenceRole(request, index), scope: uploadedReferenceScopeText(request, index) }));
  const uploadedPersonSubject = uploadedRoles.some((item) => item.role === "主体" && /(人物|人像|女生|男生|模特|主视觉人物|主体人物)/.test(item.scope));
  const uploadedProductSubject = uploadedRoles.some((item) => item.role === "主体" && /(产品|商品|包装|瓶|盒|杯|主视觉产品|主体产品)/.test(item.scope));
  const subject = uploadedPersonSubject
    ? "用户上传参考图中的人物作为主视觉主体"
    : uploadedProductSubject
      ? "用户上传参考图中的产品作为主视觉主体"
      : "";
  const explicitText = [
    textOf(request.campaign_name).trim() ? `主标题「${textOf(request.campaign_name).trim()}」` : "",
    campaignSubtitleText(request) ? `副标题「${campaignSubtitleText(request)}」` : "",
    campaignTimeText(request) ? `活动时间「${campaignTimeText(request)}」` : "",
  ].filter(Boolean).join("；");
  return {
    visual_keywords: "",
    color_direction: "",
    main_visual_subject: subject,
    subject_size_ratio: "",
    subject_relationship: uploadedPersonSubject
      ? "用户上传图人物为第一视觉中心，其他场景、道具和装饰只作为辅助，不抢人物主体"
      : "",
    information_hierarchy: explicitText,
    layout_outline: "",
    background_atmosphere: "",
    material_keywords: "",
    lighting_keywords: "",
    typography_strategy: textOf(request.campaign_name).trim() ? explicitText : "",
    visual_direction: "",
    spatial_strategy: "",
    camera_strategy: "",
    color_strategy: "",
    subject_expansion: {
      subject: textOf(request.visual_description).trim(),
      foreground: "",
      midground: "",
      background: "",
      props: "",
      emotion: "",
      information_area: "",
    },
  };
}

function buildPresetDesign(request, brief, variant, preset = null) {
  const base = localDesign(request, brief);
  if (!preset) {
    return {
      ...base,
      preset_id: NO_PRESET_ID,
      preset_name: "默认不使用预设",
      pet_character_style_constraint: { enabled: false },
      selected_title_variant: null,
    };
  }
  const explicitSubject = request.visual_description || request.campaign_name;
  const petEnabled = petConstraint(preset).enabled && hasPetIntent(request);
  const petSubject = "宠物角色必须设计为抽象变形的宠物IP角色，不做写实猫狗比例和真实毛发细节";
  if (preset.preset_id === Y3K_PRESET.preset_id) {
    return {
      ...base,
      preset_id: preset.preset_id,
      preset_name: preset.preset_name,
      pet_character_style_constraint: { enabled: false },
      fashion_character_constraint: preset.fashion_character_constraint,
      selected_title_variant: {
        variant_id: variant.variant_id,
        style_name: variant.style_name,
        features: variant.features,
        best_for: variant.best_for,
      },
      visual_keywords: "Y3K、未来感、黑银金属、高光反射、时尚编辑、人物穿搭指南、数字界面、赛博档案、超频派对、Cyber Fashion、Metallic Editorial、Digital Lookbook",
      color_direction: "黑、银、灰、白为核心，可加入少量高亮蓝、红、粉或荧光色点缀；背景可为黑色渐变、金属灰渐变、冷蓝科技底或白底数据界面，整体冷感高级，不彩虹化",
      main_visual_subject: `围绕用户描述「${explicitSubject}」生成Y3K时尚人物主体；人物为第一主体，服装、配饰、姿态和穿搭亮点是视觉重点；如用户@上传人物图，则保留上传人物的姿态和主要造型并重构为Y3K时尚编辑海报`,
      subject_size_ratio: "人物主体占画面约45%-65%，局部特写框占约15%-25%，标题为第二视觉重点",
      subject_relationship: "人物是画面核心，标题为第二视觉重点；2-4个局部特写框或浮动面板展示手表、鞋、发色、包、墨镜、银色单品等穿搭亮点；细线标注连接人物身上的关键单品",
      information_hierarchy: `主标题「${request.campaign_name}」最大或第二大，必须具备银色金属锐利标题感；不生成活动时间；标注文案短小，仅围绕穿搭亮点`,
      layout_outline: `${variant.style_name}：${variant.features.join("、")}；整体像未来时尚杂志封面 + 穿搭拆解图 + 数字档案界面，不是普通人像海报`,
      background_atmosphere: "黑银金属渐变、冷蓝科技底、金属灰面板或白蓝数字档案界面；可使用条形码、坐标、编号、模块框、扫描线、数据卡、搜索框或话题条作为弱化信息模块",
      material_keywords: "金属反光、银色高光、镜面材质、透明塑料、屏幕纹理、扫描纹、噪点、闪光颗粒、皮革、银色亮面、尼龙、透明墨镜、金属链条配饰",
      lighting_keywords: "时尚大片闪光灯、高光反射、镜头闪光、冷感金属光、边缘高光、局部强反射、杂志封面级光影",
      typography_strategy: `${preset.title_style.style_name}：${preset.title_style.features.join("、")}；标题可顶部横向铺开或底部作为大号视觉签名；中文标题做成大面积主标题，不要普通宋体、圆润可爱字体、手帐字、厚重POP字或传统电商大字报`,
      visual_direction: preset.style_group,
      spatial_strategy: "人物大图、矩形照片框/浮动面板、局部特写框、细线标注、数字界面信息模块叠压组织；允许斜切、错位、透视面板，但主次必须清楚",
      camera_strategy: "时尚编辑镜头，可半身、全身、自拍视角、斜切角度或封面式正面；人物姿态锐利，具有magazine cover attitude，不像普通自拍或证件照",
      color_strategy: "黑银灰白为主，少量高亮蓝/红/粉/荧光色作为数据标签或强调色；保持冷感、高级、锐利和金属感",
      annotation_templates: preset.annotation_templates,
      annotation_rules: preset.annotation_rules,
      scene_expansion_rules: preset.scene_expansion_rules,
      subject_expansion: {
        subject: "人物为第一主体；如用户上传人物图，保留人物姿态、主要造型和穿搭识别点；未上传时生成虚构时尚人物，不指向真实名人",
        foreground: "可加入透明墨镜、银色首饰、金属手袋、赛博运动鞋、镜面配饰、搜索框/话题胶囊等与Y3K穿搭直接相关的元素",
        midground: "人物主体与1-3个矩形照片框/局部特写框叠压，展示2-3个穿搭亮点",
        background: "黑银渐变、金属灰、冷蓝科技底或白蓝数字档案界面，带少量扫描线、条形码、坐标、编号、模块框",
        props: "2-4条短标注，指向具体服装或配饰；文字使用白色、银色或浅灰色，细线连接，不可堆满小字",
        emotion: "酷、锐利、未来、时髦、高频、银色科技感、派对感、杂志大片感",
        information_area: "左上角保持自然干净留白；标题和信息模块不得覆盖人物面部与核心穿搭亮点；画面像时尚编辑指南而非普通人像写真",
      },
    };
  }
  if (preset.preset_id === SCRAPBOOK_PRESET.preset_id) {
    return {
      ...base,
      preset_id: preset.preset_id,
      preset_name: preset.preset_name,
      pet_character_style_constraint: { enabled: false },
      selected_title_variant: {
        variant_id: variant.variant_id,
        style_name: variant.style_name,
        features: variant.features,
        best_for: variant.best_for,
      },
      visual_keywords: "手帐拼贴、scrapbook、notebook、journal、paper collage、生活记录感、碎片采样、图文拼接、纸张层叠、随手整理、社交传播海报化",
      color_direction: "根据主题选择一个主底纸色或纯色纸背景，搭配2-4个纸张/贴纸/标签辅助色和1个强调色；整体有生活感、记录感和轻微手工整理痕迹",
      main_visual_subject: `围绕用户描述「${explicitSubject}」拆解为一页手帐拼贴：一个主模块承载核心主体/主照片/主物件，周围分布2-5个辅助模块和少量贴纸标签`,
      subject_size_ratio: "主模块占画面约35%-50%，辅助模块共占约25%-35%，标题为第一视觉信息",
      subject_relationship: "标题最大且位于上方或上半区；主模块作为视觉中心；辅助模块通过胶带、线条、票据、标签、图钉、回形针等形成浏览路径",
      information_hierarchy: `主标题「${request.campaign_name}」最大；不生成活动时间；仅允许用户明确给出的短标签、小注释或信息点`,
      layout_outline: "以一张主底纸/笔记本页/网格纸/档案纸为承载面；上方为标题区，中部为主模块，周围错位叠压2-5个辅助模块，整体像被精心整理的一页手帐而不是整齐UI界面",
      background_atmosphere: "纸质底板、网格纸、便签纸、活页纸、档案纸或纯色纸；保留纸张纹理、印刷感、轻微颗粒，不做完整写实场景",
      material_keywords: "纸张纹理、纸边、圆角纸页、胶带、回形针、长尾夹、订书针、图钉、贴纸、标签、票据、小票、印章、章戳、手写字、涂鸦线、箭头、圈画",
      lighting_keywords: "轻柔平面海报光、纸张层次清晰、轻微阴影、印刷质感、拼贴物边缘清楚",
      typography_strategy: `${variant.style_name}：${variant.features.join("、")}；标题必须是第一视觉信息，可呈现印刷感、手写感、剪贴感或实验感；不要复制参考图具体文字和品牌`,
      visual_direction: preset.style_group,
      spatial_strategy: "不是完整场景，而是一页被组织好的拼贴页面；主底纸承载信息，主模块与辅助模块轻微倾斜、错位、叠压，形成手工整理感",
      camera_strategy: "正视俯拍式平面拼贴视角，保持纸张和模块关系清楚，允许轻微透视和叠压阴影",
      color_strategy: "主色来自底纸/背景纸，辅助色来自贴纸、标签、照片和小物件，强调色用于标题或关键标签；避免过度杂乱",
      scene_expansion_schema: preset.scene_expansion_schema,
      scene_expansion_rules: preset.scene_expansion_rules,
      subject_expansion: {
        subject: "将用户描述拆成一个主模块：主照片、主物件、主信息板或主卡片；主模块必须是视觉中心",
        foreground: "可出现胶带、回形针、图钉、标签、贴纸、票据、小票、印章、箭头、圈画等装饰连接元素，数量克制",
        midground: "中部为主模块，周围2-5个辅助模块承载照片、小卡片、小图标、小截图或信息碎片",
        background: "底层是一张网格纸、笔记本纸、档案纸、纯色纸或大背景纸，不做完整场景背景",
        props: "辅助模块和零碎装饰必须服务主题；辅助模块2-5个，小元素5-10个以内",
        emotion: "轻松、生活感、记录感、有温度、像一页被精心编排过的手帐/笔记页/灵感页",
        information_area: "标题->主模块->辅助模块->底部说明形成浏览路径；标题区独立清晰，左上角保持自然干净留白",
      },
    };
  }
  if (preset.preset_id === HAND_DRAWN_PRESET.preset_id) {
    const references = variant?.references || [];
    const fontReference = references.find((item) => item.reference_role === "字体");
    const styleReference = references.find((item) => item.reference_role === "风格");
    const layoutReference = references.find((item) => item.reference_role === "排版");
    const fontText = fontReference?.description || fontReference?.features?.join("、") || "手写涂鸦标题字、粗笔画、轻松随性、标题清晰可读";
    const styleText = styleReference?.description || styleReference?.features?.join("、") || "手绘扁平插画、明快色块、少量元素、留白构图、轻松社交传播气质";
    const layoutText = layoutReference?.description || layoutReference?.features?.join("、") || "根据当前画幅选择横版或竖版排版，标题区、时间模块和主图区域关系清楚";
    return {
      ...base,
      preset_id: preset.preset_id,
      preset_name: preset.preset_name,
      pet_character_style_constraint: { enabled: false },
      selected_title_variant: {
        variant_id: variant.variant_id,
        style_name: variant.style_name,
        references: references.map((item) => ({
          role: item.reference_role,
          variant_id: item.variant_id,
          style_name: item.style_name,
          composition_orientation: item.composition_orientation,
          selection_reason: item.selection_reason || "",
          description_summary: compactKnowledge(item.description, 240),
        })),
      },
      visual_keywords: "手绘扁平涂鸦、flat doodle、cartoon illustration、粗线条、明快色块、轻松幽默、社交传播海报、留白感",
      color_direction: "使用明快高识别色块，背景保持纯色或少量扁平形状，主体色彩鲜明但不混乱，避免脏色和高饱和堆叠",
      main_visual_subject: `围绕用户描述「${explicitSubject}」提取一个核心主体或一组核心互动关系，用手绘扁平涂鸦插画方式呈现`,
      subject_size_ratio: "主体占画面约35%-50%，周围保留明显留白，辅助元素只做少量点缀",
      subject_relationship: "主标题与主体分区清楚；主体是唯一核心画面焦点，辅助元素只围绕主体表达主题，不做过多细碎内容",
      information_hierarchy: `主标题「${request.campaign_name}」最大；严禁新增无关文字；如果用户提到时间，时间必须和标题字体做在一块儿，作为标题组的一部分`,
      layout_outline: `参考排版图：${layoutText}。参考风格图：${styleText}。整体采用简洁传播海报构图，标题区、主体区和留白区清楚，不铺满画面，不堆叠细碎装饰`,
      background_atmosphere: "纯色或低复杂度扁平背景，少量抽象线条、箭头、符号、色块或简单场景元素，避免复杂远景",
      material_keywords: "扁平数字插画、手绘线条、涂鸦笔触、粗轮廓、明快色块、轻微纸面/屏幕插画感；不要写实摄影、复杂3D、厚重材质和高反射",
      lighting_keywords: "扁平插画光影，少量简单阴影或无阴影，整体干净清楚",
      typography_strategy: `参考字体图：${fontText}。标题必须使用手写涂鸦感字体，粗笔画、节奏自然、清晰可读；只生成用户明确给出的标题文字，不自动新增英文、口号、日期、标签或说明文字`,
      visual_direction: preset.style_group,
      spatial_strategy: `按当前画幅使用${compositionOrientation(request.image_size) === "Vertical" ? "Vertical" : compositionOrientation(request.image_size) === "Horizontal" ? "Horizontal" : "Square/通用"} composition；${layoutText}；标题区与主体区分区明确，画面有呼吸感和留白；只保留一个主视觉主体或核心互动，辅助元素2-5个以内`,
      camera_strategy: "平面化正视插画构图，轻微透视可以出现但不要复杂空间和多消失点",
      color_strategy: "从用户描述选择1个主背景色，搭配2-4个主体/辅助色和1个强调色；颜色明快、干净、对比清晰",
      scene_expansion_rules: preset.scene_expansion_rules,
      subject_expansion: {
        subject: "提取用户描述中的核心主体或核心互动关系，用手绘扁平涂鸦方式概括，不新增无关人物、产品或品牌",
        foreground: "只放少量与主题直接相关的小道具或涂鸦符号，数量克制",
        midground: "主体保持清晰，占据主要视觉区域，与标题形成稳定关系",
        background: "大面积纯色或低复杂度扁平背景，保留明显留白",
        props: "辅助元素控制在2-5个以内，不做过多细碎内容",
        emotion: "轻松、有趣、年轻、明快、友好、社交传播感",
        information_area: `标题区独立清晰；参考排版图安排主标题、时间模块和主图区域：${layoutText}；如果文本中有时间，时间必须贴近主标题并采用同一标题字体系统；严禁增加无关文字信息`,
      },
    };
  }
  if (presetReferenceGroups(preset).length) {
    const references = variant?.references || [];
    const integratedLayoutReference = references.find((item) => item.reference_role === "整合版式");
    const styleReference = references.find((item) => item.reference_role === "风格");
    const elementReference = references.find((item) => item.reference_role === "元素");
    const characterReference = references.find((item) => item.reference_role === "角色");
    const shared = preset.shared_style || {};
    const integratedLayoutText = integratedLayoutReference
      ? `直接参考图片「${integratedLayoutReference.style_name}」的文字视觉系统、信息层级、文字区与主画面区的位置、比例、对齐、阅读顺序和留白关系`
      : "根据当前画幅安排用户已提供的信息与主画面区域";
    const integratedLayoutMetadata = integratedLayoutReference?.layout_metadata || {};
    const styleText = styleReference
      ? `直接观察并参考图片「${styleReference.style_name}」的整体美术语言、完成度和质感`
      : shared.visual_style?.join("、") || preset.style_group;
    const elementText = elementReference
      ? `直接观察并参考图片「${elementReference.style_name}」的造型概括、比例和材质语言`
      : "元素造型、材质和辅助道具表现服从整体风格";
    const characterText = characterReference
      ? `角色参考图片「${characterReference.style_name}」的抽象比例、轮廓、动作语言和完成度，不复制其身份、服装或具体动作`
      : "角色造型服从当前风格和用户描述";
    const visualStyle = [...(shared.visual_style || []), ...(preset.visual_keywords || [])].filter(Boolean).join("、") || preset.style_group;
    const colorRules = (shared.color_rules || []).join("；") || "从用户描述与参考图提取主色，保持统一干净";
    const textureRules = (shared.texture_rules || []).join("；") || styleText;
    const compositionRules = (shared.composition_rules || []).join("；") || integratedLayoutText;
    const threeDPersonEnabled = THREE_D_PERSON_PERSPECTIVE_CONSTRAINT.enabled
      && preset.preset_id === THREE_D_PRESET_ID
      && hasPersonIntent(request);
    const realProductEnabled = preset.preset_id === REAL_PRODUCT_PRESET_ID;
    const realPersonEnabled = preset.preset_id === REAL_PERSON_PRESET_ID;
    const perspectiveDecision = threeDPersonEnabled ? threeDPersonPerspectiveDecision(request) : null;
    const perspectiveText = perspectiveDecision
      ? `人物大透视判断：镜头=${perspectiveDecision.camera}；前景锚点=${perspectiveDecision.foreground_anchor}，占画面30%-55%；人体=${perspectiveDecision.body_abstraction}；动作=${perspectiveDecision.motion_path}；场景=${perspectiveDecision.scene_depth}。`
      : "";
    return {
      ...base,
      preset_id: preset.preset_id,
      preset_name: preset.preset_name,
      pet_character_style_constraint: petEnabled ? petConstraint(preset) : { enabled: false },
      three_d_person_perspective_constraint: threeDPersonEnabled ? {
        enabled: true,
        ...perspectiveDecision,
      } : { enabled: false },
      selected_title_variant: {
        variant_id: variant.variant_id,
        style_name: variant.style_name,
        references: references.map((item) => ({
          role: item.reference_role,
          variant_id: item.variant_id,
          style_name: item.style_name,
          composition_orientation: item.composition_orientation,
          selection_reason: item.selection_reason || "",
          description_summary: compactKnowledge(item.description, 240),
        })),
      },
      visual_keywords: threeDPersonEnabled ? `${visualStyle}、强镜头、大透视、夸张前景锚点、抽象变形人物、S型/对角线/环形动势、软胶玩具或潮流雕塑人物` : visualStyle,
      color_direction: colorRules,
      main_visual_subject: threeDPersonEnabled
        ? `围绕用户描述「${explicitSubject}」提取人物主视觉主体，但必须做成抽象变形的3D人物/软胶玩具/潮流雕塑造型；${characterText}；${perspectiveText}`
        : petEnabled
          ? `围绕用户描述「${explicitSubject}」提取宠物主视觉主体，但必须做成极简扁平卡通宠物IP/品牌吉祥物/贴纸角色，不得生成写实猫狗、真实毛发或宠物摄影`
          : realPersonEnabled
            ? `围绕用户描述「${explicitSubject}」识别真实人物主体；人物必须保持真实人体比例、身份与五官结构稳定，面部、身体轮廓、发型、主要服装和动作清晰。如果用户通过@上传人物主体图，上传图是人物身份与外观的最高优先级事实来源，不得替换成其他人物`
          : realProductEnabled
            ? `围绕用户描述「${explicitSubject}」识别并塑造实体主商品；商品必须保持真实可信的结构、比例、包装、接口、屏幕、镜头或核心功能部位，并按所选实景商品参考建立商业摄影或写实CG主视觉`
            : `围绕用户描述「${explicitSubject}」提取一个明确主视觉主体，并按「${preset.preset_name}」的风格规则呈现${characterReference ? `；${characterText}` : ""}`,
      subject_size_ratio: threeDPersonEnabled ? `前景锚点「${perspectiveDecision.foreground_anchor}」占画面30%-55%；人物主体被近大远小透视拉伸，占画面约45%-70%，标题区保留清晰留白` : realPersonEnabled ? "人物占有效画面面积35%-70%；根据全身、半身或近景构图与整合版式决定具体比例，必须成为第一视觉中心并避让固定文字层" : realProductEnabled ? "主商品占有效画面面积30%-65%；极端特写时可提高到70%-85%，但必须保留关键结构与识别特征" : "主体占画面约35%-55%，根据排版参考和用户描述决定具体比例，必须成为第一视觉中心",
      subject_relationship: threeDPersonEnabled ? `前景巨大锚点是第一空间压迫点，抽象变形人物沿${perspectiveDecision.motion_path}穿过画面，标题与主体分区清楚；辅助元素只用于强化速度感和纵深` : petEnabled ? "宠物IP角色是画面核心或核心互动主体，必须是扁平卡通造型；标题、宠物主体和少量辅助元素分区清楚，不生成真实宠物合影或摄影背景" : realPersonEnabled ? "真实人物是第一视觉中心；场景、道具、背景和文字只服务人物与主题，不得遮挡人物面部、手部、身体轮廓和服装关键部位；上传人物图存在时，其他参考图不得改变人物身份或外观" : realProductEnabled ? "商品是唯一第一视觉焦点；多商品按主商品、次商品、功能道具、氛围元素建立层级；场景、人物局部和道具只解释商品，不与商品争夺注意力" : "主标题、主体和辅助元素分区清楚；辅助元素只服务主题和主体，不抢主视觉，不新增无关道具或信息",
      information_hierarchy: `${request.campaign_name ? `主标题「${request.campaign_name}」替换整合版式参考的主标题内容，并严格继承其视觉样式、面积比例、行数、位置、装饰和对齐逻辑；` : "用户未填写主标题，不编造业务主标题；"}${request.campaign_subtitle ? `副标题「${request.campaign_subtitle}」替换对应副标题内容并严格继承其相对比例和位置；` : ""}${request.campaign_time ? `活动时间「${request.campaign_time}」替换对应时间内容并严格继承其模块样式和对齐关系；` : ""}${INTEGRATED_LAYOUT_DECORATION_RULE}；文字颜色根据本次画面重定，副标题和活动时间与主标题使用统一颜色系统`,
      layout_outline: threeDPersonEnabled
        ? `参考排版图：${layoutText}。${perspectiveText} 构图必须以强镜头和巨大前景锚点为核心，形成S型/对角线/环形动势；标题区、主体区、辅助元素区和留白区清楚，不做过多细碎内容`
        : `参考整合版式图：${integratedLayoutText}。参考图中的白色/空白区域是主画面生成区域，不表示最终背景必须为白色。参考风格图：${styleText}。${elementReference ? `参考元素图：${elementText}。` : ""}文字区、主体区、辅助元素区和留白区清楚，不做过多细碎内容`,
      background_atmosphere: threeDPersonEnabled ? `场景只服务镜头纵深：${perspectiveDecision.scene_depth}；背景保持干净，不堆砌元素` : realPersonEnabled ? "建立与主题相关的真实生活方式、商业人像或编辑式摄影场景；背景保持克制并与人物在明度、冷暖或景深上清晰分离，不抢人物主体" : realProductEnabled ? "背景和场景必须直接解释商品的功能、使用环境、季节或品牌气质；商品颜色丰富时简化背景，确保商品与背景在明度、冷暖或清晰度上分离" : "背景根据用户描述与风格参考建立，保持干净统一，避免复杂无关远景和杂乱元素",
      material_keywords: textureRules,
      lighting_keywords: realPersonEnabled ? "真实商业摄影光影；人物与背景使用统一光源方向、色温、阴影和景深；面部与服装层次清楚，避免过度磨皮、塑料皮肤和明显AI合成感" : "参考风格图的光影方向、材质完成度和商业海报清晰度；主体清楚、边缘稳定、画面统一",
      typography_strategy: request.campaign_name
        ? `${integratedLayoutText}。整合版式参考是全部文字视觉样式的最高优先级模板：将主标题、副标题和活动时间替换为用户提供内容，同时严格保留参考图中各信息角色的字形气质、字号比例、位置、对齐、行数、间距、装饰与组合轮廓。${INTEGRATED_LAYOUT_DECORATION_RULE}。根据标题长度与参考图内容适配规则选择左对齐、居中、右对齐或自由组合，不得默认左对齐。不继承参考图文字颜色；主标题颜色依据本次画面重新确定，副标题、活动时间和同组文字保持统一颜色系统`
        : `用户未填写主标题；${request.campaign_subtitle || request.campaign_time ? "仅保留用户明确填写的副标题或活动时间，并按整合版式参考的次级信息样式排布" : "不生成标题、副标题、英文、日期或任何自动补充文字"}`,
      visual_direction: preset.style_group,
      spatial_strategy: threeDPersonEnabled ? `按当前画幅使用${compositionOrientation(request.image_size) === "Vertical" ? "Vertical" : compositionOrientation(request.image_size) === "Horizontal" ? "Horizontal" : "Square/通用"} composition；采用${perspectiveDecision.camera}，前景${perspectiveDecision.foreground_anchor}巨大化，人物和道具沿${perspectiveDecision.motion_path}组织空间纵深` : `按当前画幅使用${compositionOrientation(request.image_size) === "Vertical" ? "Vertical" : compositionOrientation(request.image_size) === "Horizontal" ? "Horizontal" : "Square/通用"} composition；${compositionRules}`,
      camera_strategy: threeDPersonEnabled ? `镜头先行：${perspectiveDecision.camera}；禁止普通正面视角、普通站立、端坐或常规跑步视角` : realPersonEnabled ? "根据用户描述与整合版式，在全身、半身、近景、低机位、轻广角或编辑式抓拍中选择合适镜头；动作自然且与主题场景有叙事关系，人物面部和身体结构稳定" : realProductEnabled ? "从低机位英雄构图、对角线近景、中央产品家族、极近景尺度反差或放射式动态生态中选择最适合商品卖点的一种；只使用1-2种核心冲击手段，保持商品结构准确" : "镜头与主体摆放服从用户描述和主画面生成区域；保持主体稳定、信息清晰、画面有商业海报感",
      color_strategy: colorRules,
      scene_expansion_rules: preset.scene_expansion_rules || [],
      subject_expansion: {
        subject: threeDPersonEnabled ? `人物主体必须抽象变形：${perspectiveDecision.body_abstraction}；${characterText}；整体像软胶玩具或潮流雕塑，不能是真实人体比例` : petEnabled ? `${petSubject}；如果用户描述中有猫、狗、小猫、小狗等，统一转译为极简扁平卡通宠物IP角色，使用圆润简化身体、纯净色块、极简五官和符号化表情` : realPersonEnabled ? "从用户描述或上传图中确定真实人物主体；上传人物图存在时，严格保留人物身份、脸部特征、发型、主要服装和可见识别特征，人物不得被风格参考图中的人物替换" : realProductEnabled ? "从用户描述或上传图中确定主商品；保持商品外观、包装、比例、材质和核心卖点部位准确，建立可一眼识别的商业主视觉" : `提取用户描述中的核心主体；如果用户@上传图指定主体，则以上传图主体为准${characterReference ? `；${characterText}` : ""}`,
        foreground: threeDPersonEnabled ? `必须出现巨大前景锚点「${perspectiveDecision.foreground_anchor}」，占画面30%-55%，形成压迫式近大远小关系` : "只加入与主题直接相关的前景元素，数量克制",
        midground: threeDPersonEnabled ? `人物身体沿${perspectiveDecision.motion_path}穿过画面，形成S型/对角线/环形轨迹，像定格动画里的极限瞬间` : "主视觉主体稳定清晰，与标题形成明确层级",
        background: threeDPersonEnabled ? `${perspectiveDecision.scene_depth}；背景保持干净，不堆砌元素，只强化空间纵深` : petEnabled ? "背景服从极简扁平插画风格，使用纯色或低复杂度色块，不生成真实室内摄影棚、真实镜头景深或真实光斑" : realPersonEnabled ? "背景服从真实商业人像与生活方式摄影语言，保持光源、色温、阴影和景深统一，人物与背景清晰分离" : "背景服从当前风格预设和用户描述，保持干净统一",
        props: threeDPersonEnabled ? `可用少量漂浮道具、巨大白色线条或轨迹穿插前后景强化速度感；辅助元素必须克制` : realPersonEnabled ? "只使用能够支持人物动作、主题和场景叙事的少量道具；不得遮挡面部、手部、身体轮廓和服装关键部位" : realProductEnabled ? "只使用能够说明商品功能、使用环境、季节或尺度的功能道具；所有道具清晰度、体积和对比均低于主商品" : `辅助元素参考当前风格的视觉语言${elementReference ? `：${elementText}` : ""}；控制数量，不做细碎堆叠`,
        emotion: threeDPersonEnabled ? "强动势、潮流、夸张、玩具雕塑感、视觉冲击、极限瞬间" : realPersonEnabled ? "真实、自然、有态度、有场景关系、商业人物海报完成度" : (shared.mood || []).join("、") || "贴合用户描述和当前预设的视觉气质",
        information_area: `整合版式参考控制全部文字角色与主画面区域的关系；白色/空白区域用于生成主视觉，不是固定白底；${JSON.stringify(integratedLayoutMetadata.visual_area_bbox || {}) !== "{}" ? `主画面区域元数据：${JSON.stringify(integratedLayoutMetadata.visual_area_bbox)}` : ""}；用户填写的主标题、副标题和活动时间替换对应事实槽位；${INTEGRATED_LAYOUT_DECORATION_RULE}`,
      },
    };
  }
  if (preset.custom) {
    const shared = preset.shared_style || {};
    const visualStyle = [
      ...(Array.isArray(preset.visual_keywords) ? preset.visual_keywords : []),
      ...(Array.isArray(shared.visual_style) ? shared.visual_style : []),
    ].filter(Boolean).join("、") || preset.style_group;
    const compositionRules = (shared.composition_rules || []).join("；") || "根据参考图建立画面版式、主体区域、标题区域和信息层级";
    const colorRules = (shared.color_rules || []).join("；") || "从用户描述与参考图提取主色，保持统一干净";
    const textureRules = (shared.texture_rules || []).join("；") || "参考图中的材质、光影和完成度";
    const titleFeatures = [
      preset.title_style?.style_name,
      ...(preset.title_style?.features || []),
      ...(variant?.features || []),
    ].filter(Boolean).join("、");
    return {
      ...base,
      preset_id: preset.preset_id,
      preset_name: preset.preset_name,
      pet_character_style_constraint: { enabled: false },
      selected_title_variant: variant ? {
        variant_id: variant.variant_id,
        style_name: variant.style_name,
        features: variant.features,
        best_for: variant.best_for,
      } : null,
      visual_keywords: visualStyle,
      color_direction: colorRules,
      main_visual_subject: `围绕用户描述「${explicitSubject}」提取主视觉主体，并按「${preset.preset_name}」的风格规则和参考图变体「${variant?.style_name || "参考图"}」进行商业KV化呈现`,
      subject_size_ratio: "主体占画面约35%-55%，根据参考图构图和用户描述决定具体比例",
      subject_relationship: "主视觉主体、标题信息区和辅助元素按照参考图的版式关系组织；辅助元素只服务主题和主体，不抢主视觉",
      information_hierarchy: `主标题「${request.campaign_name}」最大；不生成活动时间；只使用用户明确提供的信息`,
      layout_outline: `${variant?.style_name || preset.preset_name}：${compositionRules}`,
      background_atmosphere: (shared.mood || []).join("、") || "按照用户描述和参考图建立统一背景氛围",
      material_keywords: textureRules,
      lighting_keywords: "参考图中的光影方向、质感完成度和商业海报清晰度；保持主体清楚、画面统一",
      typography_strategy: `${titleFeatures || "标题参考所选变体的字形、字重、层级和排版节奏"}；不要复制参考图具体文字、品牌、水印或无关英文`,
      visual_direction: preset.style_group,
      spatial_strategy: compositionRules,
      camera_strategy: "镜头和透视参考用户描述与所选参考图变体，保持主体稳定、标题清晰、信息层级明确",
      color_strategy: colorRules,
      scene_expansion_rules: preset.scene_expansion_rules || [],
      subject_expansion: {
        subject: "根据用户画面描述提取核心主体；如果用户@上传图指定主体，则以上传图主体为准",
        foreground: "只加入与主题直接相关的前景元素，并参考当前风格的材质与视觉气质",
        midground: "主视觉主体和主要信息区按照参考图构图组织，保持商业海报聚焦",
        background: "背景根据用户描述与风格预设生成，避免无关场景和杂乱元素",
        props: "辅助道具、标签、装饰元素必须服务主题，不新增无来源品牌、价格或活动时间",
        emotion: (shared.mood || []).join("、") || "贴合用户描述的情绪关键词",
        information_area: "标题区独立清晰，左上角保持自然干净留白",
      },
    };
  }
  if (preset.preset_id !== CLAY_PRESET.preset_id) {
    return {
      ...base,
      preset_id: preset.preset_id,
      preset_name: preset.preset_name,
      pet_character_style_constraint: { enabled: false },
      selected_title_variant: variant ? {
        variant_id: variant.variant_id,
        style_name: variant.style_name,
        features: variant.features,
        best_for: variant.best_for,
      } : null,
      visual_keywords: preset.style_group || base.visual_keywords,
      visual_direction: preset.style_group || "当前风格预设",
      main_visual_subject: `围绕用户描述「${explicitSubject}」提取主视觉主体，并按「${preset.preset_name}」的风格规则呈现`,
      information_hierarchy: `主标题「${request.campaign_name}」最大；不生成活动时间；只使用用户明确提供的信息`,
      layout_outline: "根据当前风格预设和用户描述建立标题区、主体区、辅助元素区和留白关系，不套用黏土或其他固定风格",
      typography_strategy: "标题参考当前风格预设的字体与层级规则；不要复制参考图具体文字、品牌、水印或无关英文",
      subject_expansion: {
        subject: "根据用户画面描述提取核心主体；如果用户@上传图指定主体，则以上传图主体为准",
        foreground: "只加入与主题直接相关的前景元素，数量克制",
        midground: "主视觉主体稳定清晰，与标题形成明确层级",
        background: "背景服从当前风格预设和用户描述，保持干净统一",
        props: "辅助元素必须服务主题，不新增无来源品牌、价格或活动时间",
        emotion: "贴合用户描述和当前预设的视觉气质",
        information_area: "标题区独立清晰，左上角保持自然干净留白",
      },
    };
  }
  return {
    ...base,
    preset_id: preset.preset_id,
    preset_name: preset.preset_name,
    pet_character_style_constraint: petEnabled ? petConstraint(preset) : { enabled: false },
    selected_title_variant: {
      variant_id: variant.variant_id,
      style_name: variant.style_name,
      features: variant.features,
      best_for: variant.best_for,
    },
    visual_keywords: `3D黏土质感、萌趣可爱、轻手工捏塑感、哑光软陶材质、圆润低攻击性、活动海报感、高识别社交传播主视觉${petEnabled ? "、抽象变形宠物IP、潮玩公仔、软胶玩具、品牌吉祥物感" : ""}`,
    color_direction: "单一高识别背景色为主，主体控制在2-4种明亮辅助色，保留1个强调色；整体清爽、年轻、明亮、对比清晰",
    main_visual_subject: petEnabled
      ? `围绕用户描述「${explicitSubject}」扩写为1组黏土/软陶质感核心宠物IP角色；${petSubject}`
      : `围绕用户描述「${explicitSubject}」扩写为1组黏土/软陶质感核心角色、物件或场景主体`,
    subject_size_ratio: "主视觉主体占画面约35%-50%，中部或中下部集中呈现，成为标题之外的第一图像焦点",
    subject_relationship: "顶部大标题为第一信息识别点，中部/中下部主视觉主体为第一画面焦点；2-5个辅助道具围绕主体服务主题，不抢标题与主体",
    information_hierarchy: `主标题「${request.campaign_name}」最大；不生成活动时间；少量补充信息仅在用户明确提供时出现`,
    layout_outline: "左上角保持自然干净留白；顶部为大标题区且占比较大；中部或中下部为单主体舞台式主视觉；底部或角落仅放用户明确给出的补充信息；背景纯净，避免复杂远景",
    background_atmosphere: "纯色或近似纯色大底，少量抽象云朵、太阳、植物、地面小舞台或主题符号点缀；不做复杂真实远景",
    material_keywords: petEnabled
      ? "统一3D黏土/软陶手作质感、软胶玩具/vinyl toy质感、光滑或半哑光表面、纯净色块分区、圆润边缘、玩具化体积；宠物只允许轻微装饰化毛绒感，不表现真实毛发层次"
      : "统一3D黏土/软陶手作质感、哑光材质、轻微颗粒、圆润边缘、轻手工痕迹、玩具化体积",
    lighting_keywords: "柔和棚拍光、均匀干净、高亮但不过曝、轻柔立体阴影、商业海报质感",
    typography_strategy: `${variant.style_name}：${variant.features.join("、")}；标题大、醒目、位于顶部，不复制参考图中的具体文字、品牌、水印或日期`,
    visual_direction: CLAY_PRESET.style_group,
    spatial_strategy: "上标题、下主视觉、单主体舞台式海报；主体集中，辅助道具2-5个，背景低复杂度",
    camera_strategy: "正视角或轻微低机位/轻微俯视均可，主体稳定、圆润、近景体积感清晰",
    color_strategy: "从用户描述选择一个明亮主背景色，搭配2-4个主体/道具色和1个强调色，避免脏色与过度饱和混乱",
    subject_expansion: {
      subject: petEnabled
        ? "根据用户画面描述提取1组核心宠物角色，并将其设计为抽象变形的宠物IP角色：大头小身、短肢圆润、几何化概括、极简五官、符号化表情、身体由简单圆润团块组成；如果用户@上传图指定主体，则保留主体识别点但仍需IP化，不做写实动物"
        : "根据用户画面描述提取1组核心角色/物件/场景主体；如果用户@上传图指定主体，则以上传图主体为准",
      foreground: "可放1-3个与主题直接相关的小道具、标牌、杯子、植物、食物、动作符号或平台符号，保持弱化",
      midground: "主体位于中部或中下部小舞台区域，表情/动作轻松友好，有社交传播感",
      background: "纯色或近似纯色背景，少量抽象形状点缀，不做复杂空间叙事",
      props: "2-5个辅助道具，必须来自用户描述或与主题直接相关",
      emotion: "轻松、可爱、活泼、亲和、活动海报感",
      information_area: "顶部标题区独立清晰，左上角保持自然干净留白，主体不得遮挡标题",
    },
  };
}

function hasMainTitle(request = {}) {
  return Boolean(textOf(request.campaign_name).trim());
}

function isFontReference(item = {}) {
  return (item.role || item.type) === "字体";
}

function referencesForRequest(request, references = []) {
  return hasMainTitle(request) ? references : references.filter((item) => !isFontReference(item));
}

function generationReferencePriority(item = {}) {
  const role = item.role || item.type || "";
  // Put an explicitly uploaded subject first in the Images Edit request. Its
  // object identity is a harder constraint than layout or style references.
  if (item.source === "用户上传" && role === "主体") return 0;
  if (role === "整合版式") return 1;
  if (role === "字体") return 2;
  if (role === "日期") return 3;
  if (item.source === "兜兜IP") return 4;
  if (role === "排版" || role === "构图") return 5;
  if (role === "风格") return 6;
  if (role === "元素") return 7;
  if (role === "角色") return 8;
  return 9;
}

function prioritizeGenerationReferences(references = []) {
  return references
    .map((item, index) => ({ item, index }))
    .sort((a, b) => generationReferencePriority(a.item) - generationReferencePriority(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

function stripTypographyClauses(value) {
  if (!value) return "";
  return textOf(value)
    .split(/[；。\n]+/)
    .map((part) => part.trim())
    .filter((part) => part && !/(标题|字体|main\s*title|sub\s*title|title\s*(?:block|area|region|type|font)|subtext\s*time|decorative\s*english)/i.test(part))
    .join("；");
}

function uploadedSubjectSpecs(request = {}) {
  return (request.uploaded_references || []).map((image, index) => ({
    image,
    index,
    label: request.reference_labels?.[index] || `图${index + 1}`,
    role: uploadedReferenceRole(request, index),
    kind: uploadedReferenceSubjectKind(request, index),
  })).filter((item) => item.role === "主体");
}

function applyUploadedSubjectToDesign(request, design = {}) {
  const subjects = uploadedSubjectSpecs(request);
  if (!subjects.length) return design;
  const labels = subjects.map((item) => `@${item.label}`).join("、");
  const kinds = [...new Set(subjects.map((item) => item.kind))].join("/") || "对象";
  const identityRule = `以用户上传${labels}中可见的原始${kinds}作为不可替换的主视觉主体；直接识别并保留其真实类别、轮廓、结构部件、包装比例、材质和可见识别特征；不得根据主题猜测或替换成另一种对象`;
  return {
    ...design,
    uploaded_subject_constraint: {
      enabled: true,
      labels: subjects.map((item) => item.label),
      kind: kinds,
      rule: identityRule,
    },
    main_visual_subject: identityRule,
    subject_relationship: `用户上传${labels}中的原始${kinds}是唯一第一视觉主体；场景、承载台、背景与辅助道具只负责衬托它，不得出现另一件产品取代或竞争主体`,
    subject_expansion: {
      ...(design.subject_expansion || {}),
      subject: identityRule,
      midground: `中景必须清晰呈现用户上传${labels}中的同一原始${kinds}，不得改换品类或重设计为其他产品`,
    },
  };
}

function sanitizeDesignForRequest(request, design = {}) {
  const hasPreset = Boolean(presetForRequest(request));
  const source = [
    request.campaign_name,
    request.campaign_subtitle,
    request.campaign_time,
    request.visual_description,
    request.user_reference_usage,
  ].map(textOf).join(" ");
  const uploadedRoles = (request.uploaded_references || []).map((_, index) => uploadedReferenceRole(request, index));
  const hasRole = (...roles) => uploadedRoles.some((role) => roles.includes(role));
  const styleGrounded = hasPreset || hasRole("风格") || /(风格|视觉|插画|摄影|写实|扁平|手绘|涂鸦|极简|复古|未来|科技|赛博|黏土|3D|三维|卡通|潮玩|拼贴|高级|清新|可爱|萌趣)/i.test(source);
  const colorGrounded = hasPreset || hasRole("风格") || /(#(?:[0-9a-f]{3}|[0-9a-f]{6})\b|颜色|色彩|色调|配色|红色|橙色|黄色|绿色|青色|蓝色|紫色|粉色|黑色|白色|灰色|金色|银色|渐变|高饱和|低饱和)/i.test(source);
  const backgroundGrounded = hasPreset || hasRole("风格", "构图") || /(背景|场景|室内|户外|天空|地面|草地|海边|城市|森林|山|房间|舞台|空间|远景)/i.test(source);
  const materialGrounded = hasPreset || hasRole("风格", "元素") || /(材质|质感|金属|玻璃|亚克力|塑料|纸张|木材|布料|毛绒|软胶|黏土|陶瓷|水花|冰块|颗粒|磨砂|哑光|高光)/i.test(source);
  const lightingGrounded = hasPreset || hasRole("风格") || /(光影|光线|光照|灯光|逆光|侧光|柔光|硬光|自然光|棚拍|电影光|高亮|阴影)/i.test(source);
  const compositionGrounded = hasPreset || hasRole("构图") || /(构图|版式|排版|镜头|机位|视角|透视|前景|中景|远景|居中|左侧|右侧|顶部|底部|俯视|仰视|特写|广角|留白)/i.test(source);

  let sanitized = {
    ...design,
    visual_keywords: styleGrounded ? design.visual_keywords : "",
    visual_direction: styleGrounded ? design.visual_direction : "",
    color_direction: colorGrounded ? design.color_direction : "",
    color_strategy: colorGrounded ? design.color_strategy : "",
    background_atmosphere: backgroundGrounded ? design.background_atmosphere : "",
    material_keywords: materialGrounded ? design.material_keywords : "",
    lighting_keywords: lightingGrounded ? design.lighting_keywords : "",
    layout_outline: compositionGrounded ? design.layout_outline : "",
    spatial_strategy: compositionGrounded ? design.spatial_strategy : "",
    camera_strategy: compositionGrounded ? design.camera_strategy : "",
    subject_expansion: {
      ...(design.subject_expansion || {}),
      foreground: compositionGrounded ? design.subject_expansion?.foreground : "",
      midground: compositionGrounded ? design.subject_expansion?.midground : "",
      background: backgroundGrounded ? design.subject_expansion?.background : "",
    },
  };

  if (hasMainTitle(request)) return applyUploadedSubjectToDesign(request, sanitized);
  const explicitText = [
    campaignSubtitleText(request) ? `副标题「${campaignSubtitleText(request)}」` : "",
    campaignTimeText(request) ? `活动时间「${campaignTimeText(request)}」` : "",
  ].filter(Boolean).join("；");
  sanitized = {
    ...sanitized,
    selected_title_variant: null,
    typography_strategy: "",
    information_hierarchy: explicitText,
    subject_size_ratio: stripTypographyClauses(sanitized.subject_size_ratio),
    subject_relationship: stripTypographyClauses(sanitized.subject_relationship),
    layout_outline: stripTypographyClauses(sanitized.layout_outline),
    spatial_strategy: stripTypographyClauses(sanitized.spatial_strategy),
    scene_expansion_rules: Array.isArray(sanitized.scene_expansion_rules)
      ? sanitized.scene_expansion_rules.map(stripTypographyClauses).filter(Boolean)
      : sanitized.scene_expansion_rules,
    subject_expansion: {
      ...(sanitized.subject_expansion || {}),
      subject: stripTypographyClauses(sanitized.subject_expansion?.subject),
      foreground: stripTypographyClauses(sanitized.subject_expansion?.foreground),
      midground: stripTypographyClauses(sanitized.subject_expansion?.midground),
      background: stripTypographyClauses(sanitized.subject_expansion?.background),
      props: stripTypographyClauses(sanitized.subject_expansion?.props),
      emotion: stripTypographyClauses(sanitized.subject_expansion?.emotion),
      information_area: stripTypographyClauses(sanitized.subject_expansion?.information_area),
    },
  };
  return applyUploadedSubjectToDesign(request, sanitized);
}

function applyDoudouToDesign(request, design = {}) {
  if (!isDoudouEnabled(request)) return design;
  const combine = (base, clause) => {
    const first = textOf(base).trim();
    const second = textOf(clause).trim();
    if (!first) return second;
    if (!second || first.includes(second)) return first;
    if (second.includes(first)) return second;
    return `${first}；${second}`;
  };
  const role = doudouRole(request);
  const isSubject = role === "主体角色";
  const roleLine = isSubject
    ? "兜兜IP为主视觉主体，需要成为画面核心焦点，动作、神态与活动主题直接相关"
    : "兜兜IP为辅助角色，需要与用户描述中的主体、动作和场景自然呼应，不抢走第一视觉";
  return {
    ...design,
    doudou_ip_constraint: {
      enabled: true,
      role,
      description: roleLine,
    },
    visual_keywords: combine(design.visual_keywords || design.visual_direction, "兜兜IP、抖音商城角色、亲和互动、IP角色识别"),
    main_visual_subject: isSubject
      ? combine("兜兜IP作为主视觉主体", design.main_visual_subject || "围绕用户输入主题建立动作和场景")
      : design.main_visual_subject || "以用户画面描述中的核心主体为主视觉主体",
    subject_relationship: isSubject
      ? combine("兜兜是第一视觉中心；其他主体、道具和场景元素围绕兜兜服务主题", design.subject_relationship)
      : combine(design.subject_relationship || "主视觉主体为第一视觉中心，辅助元素服务主题", "兜兜作为辅助角色必须出现，并通过动作、神态和位置与主体/场景呼应，不喧宾夺主"),
    subject_expansion: {
      ...(design.subject_expansion || {}),
      subject: isSubject
        ? combine("兜兜IP为核心主体，严格参考兜兜参考图的红色袋形角色、圆润比例、短腿、彩色提手/装饰和亲和表情；兜兜没有手、手掌、手臂、胳膊或嘴巴", design.subject_expansion?.subject)
        : design.subject_expansion?.subject || "以用户画面描述中的核心主体为准",
      props: combine(design.subject_expansion?.props || "只出现与用户描述直接相关的道具", `兜兜IP必须作为${isSubject ? "主体角色" : "辅助互动角色"}出现`),
      emotion: combine(design.subject_expansion?.emotion || "贴合用户描述的活动情绪", "兜兜的神态需与主题情绪呼应"),
      information_area: design.subject_expansion?.information_area || "标题区独立清晰，左上角保持自然干净留白",
    },
  };
}

function validateExpandRequest(body) {
  const visualDescription = textOf(body.visual_description).trim();
  if (!visualDescription) throw new Error("请先输入画面描述");
  const stylePreset = resolveStylePresetId(body.style_preset);
  return {
    campaign_name: textOf(body.campaign_name).trim(),
    campaign_subtitle: textOf(body.campaign_subtitle).trim(),
    campaign_time: textOf(body.campaign_time).trim(),
    visual_description: visualDescription,
    image_size: SIZE_MAP[body.image_size] ? body.image_size : "3:4",
    style_preset: stylePreset,
    integrated_layout_variant: textOf(body.integrated_layout_variant).trim(),
    reference_labels: Array.isArray(body.reference_labels) ? body.reference_labels : [],
    doudou_ip: isDoudouEnabled(body),
    include_logo: booleanPreference(body.include_logo, true),
    include_search_overlay: booleanPreference(body.include_search_overlay, true),
  };
}

function sanitizeExpandedDescription(text) {
  return dedupeExpandedDescription(textOf(text)
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^扩写结果[：:]\s*/i, "")
    .trim());
}

function normalizedDuplicateKey(text) {
  return textOf(text).replace(/\s+/g, "").replace(/[，,。；;：:、.!！?？"'“”‘’()[\]{}<>《》]/g, "");
}

function dedupeExpandedDescription(text) {
  const source = textOf(text).trim();
  if (!source) return "";

  for (let split = Math.floor(source.length * 0.45); split <= Math.ceil(source.length * 0.55); split += 1) {
    const left = source.slice(0, split).trim();
    const right = source.slice(split).trim();
    if (left.length < 30 || right.length < 30) continue;
    if (normalizedDuplicateKey(left) === normalizedDuplicateKey(right)) return left;
  }

  const parts = source.match(/[^。！？!?；;\n]+[。！？!?；;]?|\n+/g) || [source];
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    if (/^\n+$/.test(part)) {
      if (result.length && result[result.length - 1] !== "\n") result.push("\n");
      continue;
    }
    const key = normalizedDuplicateKey(part);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(part.trim());
  }
  return result.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function localExpandDescription(request) {
  const preset = presetForRequest(request);
  const subtitle = campaignSubtitleText(request);
  const title = request.campaign_name
    ? `主标题为「${request.campaign_name}」${subtitle ? `，副标题为「${subtitle}」；副标题必须与主标题使用同一套字形、笔画、材质和视觉逻辑，但字号与强调度低于主标题` : "；用户未提供副标题，不得新增副标题"}`
    : "";
  const titleClause = title ? `，${title}` : "";
  const timeNote = campaignTimeText(request)
    ? hasMainTitle(request)
      ? `活动时间为「${campaignTimeText(request)}」，必须贴近主标题并作为同一标题组的一部分。`
      : `活动时间为「${campaignTimeText(request)}」，只按用户输入准确呈现。`
    : "";
  const refNote = request.reference_labels.length
    ? `如描述中提到 ${request.reference_labels.map((label) => `@${label}`).join("、")}，对应上传图必须只按用户指定用途参与画面，不复制无关背景、文字、logo 或水印。`
    : "";
  const doudouNote = isDoudouEnabled(request) ? doudouRolePrompt(request) : "";
  if (!preset) {
    return [
      `生成一张${request.image_size}营销 KV${titleClause}，不套用固定风格预设。`,
      timeNote,
      `画面只围绕用户原始描述「${request.visual_description}」展开，提取其中明确出现的主体、场景、动作、情绪、色彩和构图关系，不额外发散品牌、活动时间、价格、英文或无来源文案。`,
      "主视觉主体只根据用户原始描述确定，不预设额外角色、比例或信息区。",
      "前景、中景、背景和辅助元素都必须服务用户描述，不新增无关人物、产品、道具或品牌。",
      title ? "用户已填写标题，标题需清晰可读。" : "",
      doudouNote,
      refNote,
    ].filter(Boolean).join(" ");
  }
  if (preset.preset_id === SCRAPBOOK_PRESET.preset_id) {
    return [
      `生成一张${request.image_size}营销 KV，风格为手帐拼贴 / scrapbook / notebook / paper collage${titleClause}。`,
      timeNote,
      `将用户原始描述「${request.visual_description}」拆解成一页被精心整理过的手帐/笔记页/灵感页，而不是完整写实场景。`,
      "背景基础：使用一张主底纸作为承载面，例如网格纸、笔记本纸、活页纸、档案纸或纯色纸，保留纸张纹理、纸边、轻微颗粒和印刷感。",
      "主模块：中部设置一个主视觉核心，可是一张大照片、一件核心物品、一张主信息板或一个主卡片，占画面约35%-50%。",
      "辅助模块：周围分布2-5个辅助模块，例如照片、小卡片、贴纸、小图标、小票据、小截图或插画片段，模块之间轻微倾斜、错位、叠压。",
      "装饰元素：可使用胶带、回形针、图钉、长尾夹、订书针、印章、票据、标签、箭头、圈画、涂鸦线等连接模块，零碎小元素控制在5-10个以内。",
      title ? "信息路径：标题是第一视觉信息，浏览路径为标题->主模块->辅助模块；文字和物件要形成拼贴关系，不要变成整齐PPT排版。" : "浏览路径从主模块进入辅助模块；文字和物件要形成拼贴关系，不要变成整齐PPT排版。",
      "色彩策略：选择一个主底纸色，搭配2-4个纸张/贴纸/标签辅助色和1个强调色，整体轻松、有生活感、有记录感、社交传播友好。",
      "不要新增无来源品牌、logo、价格、活动时间或大段可读文案；如需短标签和小注释，只能围绕用户已输入的信息做弱化表达。",
      doudouNote,
      refNote,
    ].filter(Boolean).join(" ");
  }
  if (preset.preset_id === Y3K_PRESET.preset_id) {
    return [
      `生成一张${request.image_size}营销 KV，风格为 Y3K 未来时尚 / 黑银金属 / 数字编辑 / 赛博档案${titleClause}。`,
      timeNote,
      `围绕用户原始描述「${request.visual_description}」扩写为未来时尚杂志封面 + 人物穿搭拆解图 + 数字档案界面。`,
      "人物主体：人物必须是第一视觉核心，可为半身、全身、自拍视角或斜切角度；如果用户@上传人物图，尽量保留人物姿态、主要造型和穿搭识别点，并重构为Y3K时尚编辑海报。",
      "穿搭亮点：至少突出2-3个服装或配饰亮点，例如银色高光单品、透明墨镜、金属链条、黑色皮革、亮面尼龙、赛博运动鞋、未来感手袋。",
      "局部模块：加入1-3个矩形照片框或浮动面板展示发色、手表、鞋、包、墨镜、银色单品等局部特写，并用细线标注连接到人物身上的关键单品。",
      title ? "标题：中文主标题使用银色金属锐利标题，具备斜体/拉伸/尖角/切割/高光反射/速度感，可位于顶部横向铺开或底部作为大号视觉签名。" : "",
      "背景与界面：使用黑色渐变、金属灰渐变、冷蓝科技底或白蓝数字档案界面；可加入条形码、坐标、编号、模块框、扫描线、数据卡、搜索框或话题条，信息量较高但主次清晰。",
      "色彩材质：主色为黑、银、灰、白，少量高亮蓝、红、粉或荧光色点缀；强调金属反光、银色高光、镜面材质、透明塑料、屏幕纹理和闪光颗粒。",
      "不要生成普通自拍感、生活照随拍感、传统韩系写真、普通电商模特图、朴素穿搭或自然光生活照；不要新增无来源品牌、logo、活动时间、价格或大段可读文案。",
      doudouNote,
      refNote,
    ].filter(Boolean).join(" ");
  }
  if (preset.preset_id === HAND_DRAWN_PRESET.preset_id) {
    return [
      `生成一张${request.image_size}营销 KV，风格为手绘扁平涂鸦 / flat doodle / playful illustration${titleClause}。`,
      timeNote,
      `围绕用户原始描述「${request.visual_description}」展开，提取一个核心主体或一组核心互动关系，用粗线条、手绘感、明快色块和轻松幽默的扁平插画方式呈现。`,
      title ? "构图必须有明显留白，标题区、主体区和背景区分区清楚；不要铺满画面，不要做过多细碎内容。" : "构图必须有明显留白，主体区和背景区分区清楚；不要铺满画面，不要做过多细碎内容。",
      "主视觉主体占画面约35%-50%，辅助元素控制在2-5个以内，只能服务主题，例如少量箭头、抽象符号、道具、场景提示或涂鸦形状。",
      "背景使用纯色或低复杂度扁平色块，允许少量简单线条、图形、方向标识或场景轮廓，但不得做复杂真实远景。",
      title ? "标题使用手写涂鸦感字体，粗笔画、节奏自然、清晰可读；严禁增加无关文字信息，不自动新增英文、口号、日期、价格、品牌或标签。" : "严禁增加无关文字信息。",
      campaignTimeText(request) && title ? "活动时间必须和标题字体做在一块儿，作为标题组的一部分，不得散落在角落或其他信息区。" : "",
      doudouNote,
      refNote,
    ].filter(Boolean).join(" ");
  }
  if (presetReferenceGroups(preset).length) {
    const shared = preset.shared_style || {};
    const styleText = [
      preset.style_group,
      ...(shared.visual_style || []),
    ].filter(Boolean).join("、");
    const threeDPersonEnabled = THREE_D_PERSON_PERSPECTIVE_CONSTRAINT.enabled
      && preset.preset_id === THREE_D_PRESET_ID
      && hasPersonIntent(request);
    const threeDPersonDecision = threeDPersonEnabled ? threeDPersonPerspectiveDecision(request) : null;
    return [
      `生成一张${request.image_size}营销 KV，风格为「${preset.preset_name}」${titleClause}。`,
      timeNote,
      `围绕用户原始描述「${request.visual_description}」展开，提取一个明确核心主体或一组核心互动关系，严格继承当前预设的共享视觉：${styleText || "参考图风格"}。`,
      threeDPersonEnabled
        ? `${threeDPersonPerspectiveBlock(threeDPersonDecision)} 扩写必须直接写出强镜头、前景锚点、抽象变形人体、动作轨迹和纵深场景：使用${threeDPersonDecision.camera}，${threeDPersonDecision.foreground_anchor}占画面30%-55%，人物${threeDPersonDecision.body_abstraction}，动作${threeDPersonDecision.motion_path}，场景${threeDPersonDecision.scene_depth}。`
        : "",
      shared.composition_rules?.length ? `构图规则：${shared.composition_rules.join("；")}。` : title ? "构图需要根据排版参考建立标题区域、主视觉主体、辅助元素和留白关系。" : "构图需要根据排版参考建立主视觉主体、辅助元素和留白关系。",
      shared.color_rules?.length ? `色彩规则：${shared.color_rules.join("；")}。` : "色彩从用户描述和风格参考图提取，保持统一干净。",
      shared.texture_rules?.length ? `材质规则：${shared.texture_rules.join("；")}。` : "材质与光影参考风格图的质感和商业完成度。",
      "画面要有留白，不做过多细碎内容；主视觉主体占画面约35%-55%，辅助元素只服务主题。",
      `严禁增加无关文字信息，不自动新增英文、口号、日期、价格、品牌、logo或标签${campaignTimeText(request) && title ? "；活动时间必须和标题字体做在一块儿，作为标题组的一部分" : ""}。`,
      preset.scene_expansion_rules?.length ? `扩写规则：${preset.scene_expansion_rules.join("；")}。` : "",
      doudouNote,
      refNote,
    ].filter(Boolean).join(" ");
  }
  if (preset.custom) {
    const shared = preset.shared_style || {};
    const styleText = [
      preset.style_group,
      ...(preset.visual_keywords || []),
      ...(shared.visual_style || []),
    ].filter(Boolean).join("、");
    return [
      `生成一张${request.image_size}营销 KV，风格为「${preset.preset_name}」${titleClause}。`,
      timeNote,
      `围绕用户原始描述「${request.visual_description}」展开，严格继承该自定义风格的共享视觉：${styleText || "参考图风格"}。`,
      shared.composition_rules?.length ? `构图规则：${shared.composition_rules.join("；")}。` : title ? "构图需要根据参考图建立主视觉主体、标题区域、辅助元素和背景层次。" : "构图需要根据参考图建立主视觉主体、辅助元素和背景层次。",
      shared.color_rules?.length ? `色彩规则：${shared.color_rules.join("；")}。` : "色彩从用户描述和参考图提取，保持统一干净。",
      shared.texture_rules?.length ? `材质规则：${shared.texture_rules.join("；")}。` : "材质与光影参考风格图的质感和商业完成度。",
      preset.scene_expansion_rules?.length ? `扩写规则：${preset.scene_expansion_rules.join("；")}。` : "主体、前景、中景、背景、道具、情绪和信息区关系都要服务用户主题。",
      "不要新增无来源品牌、logo、价格、活动时间、英文、大段可读文案或无关道具。",
      doudouNote,
      refNote,
    ].filter(Boolean).join(" ");
  }
  const petNote = petConstraint(preset).enabled && hasPetIntent(request)
    ? "宠物角色必须扩写为抽象变形的宠物IP角色，采用潮玩公仔 / 软胶玩具风格。它不是写实宠物，而是大头小身、短肢圆润、身体由柔软圆润团块组成，五官极简，用小圆眼、点状鼻子和简化嘴巴表现开心表情。表面为光滑或半哑光软胶质感，少量装饰化毛绒感即可，不表现真实毛发、复杂毛流、真实猫狗比例和复杂解剖结构，整体像品牌吉祥物或可收藏的设计师玩具摆件。"
    : "";
  return [
    `生成一张${request.image_size}营销 KV${titleClause}。`,
    timeNote,
    `画面围绕用户原始描述「${request.visual_description}」展开，整体采用3D黏土/软陶质感、萌趣可爱、哑光材质、轻手工捏塑痕迹、圆润低攻击性的活动海报风格。`,
    title ? "构图为左上角保持自然干净留白，顶部大标题区清晰独立，中部或中下部放置1组核心主视觉主体。" : "主视觉主体和构图只按用户描述与所选预设展开。",
    "主体需要从原始描述中提取，不新增无关人物、产品、品牌或道具；主体占画面约35%-50%，动作自然，情绪轻松友好，有社交传播感。",
    petNote,
    "前景可出现1-3个与主题直接相关的小道具，中景为核心主体和小舞台，远景使用纯色或近似纯色背景，少量抽象云朵、太阳、植物、符号或主题元素弱化点缀。",
    "色彩使用一个明亮高识别背景色，搭配2-4个主体/道具辅助色和1个强调色，画面干净、明亮、对比清晰。",
    "不要新增活动时间、价格、英文、品牌、logo、无来源文案或可读小字。",
    doudouNote,
    refNote,
  ].filter(Boolean).join(" ");
}

async function expandVisualDescription(request) {
  const preset = presetForRequest(request);
  const petEnabled = petConstraint(preset).enabled && hasPetIntent(request);
  const scrapbookEnabled = preset?.preset_id === SCRAPBOOK_PRESET.preset_id;
  const y3kEnabled = preset?.preset_id === Y3K_PRESET.preset_id;
  const handDrawnEnabled = preset?.preset_id === HAND_DRAWN_PRESET.preset_id;
  const clayEnabled = preset?.preset_id === CLAY_PRESET.preset_id;
  const referenceGroupEnabled = Boolean(presetReferenceGroups(preset).length) && !handDrawnEnabled && !clayEnabled;
  const threeDPersonEnabled = THREE_D_PERSON_PERSPECTIVE_CONSTRAINT.enabled
    && preset?.preset_id === THREE_D_PRESET_ID
    && hasPersonIntent(request);
  const threeDPersonDecision = threeDPersonEnabled ? threeDPersonPerspectiveDecision(request) : null;
  const doudouEnabled = isDoudouEnabled(request);
  const customEnabled = Boolean(preset?.custom);
  const shared = preset?.shared_style || {};
  const referenceGroupVisualText = [
    preset?.style_group,
    ...(shared.visual_style || []),
  ].filter(Boolean).join("、");
  const titleExpansionRule = hasMainTitle(request)
    ? `用户已提供主标题「${request.campaign_name}」，可以扩写标题区关系，但不得改写标题文字。`
    : "主标题为空：不得补写主标题，不得扩写标题字形、字体参考或标题区域；如用户填写了副标题或活动时间，只能按原文保留。";
  const system = [
    "你是营销 KV 生图描述扩写助手。",
    "任务：把用户的自然语言画面描述扩写成更适合图像生成的中文画面描述词，直接返回一段可放回输入框的描述，不要输出 JSON、Markdown、解释或标题。",
    scrapbookEnabled
      ? "当前视觉系统为：手帐拼贴、scrapbook、notebook、journal、paper collage。扩写不是画一个完整场景，而是把用户内容拆成一个被组织好的拼贴页面。"
      : y3kEnabled
        ? "当前视觉系统为：Y3K未来时尚、黑银金属、高光反射、数字编辑、人物穿搭指南、赛博档案界面。扩写要像未来时尚杂志封面 + 穿搭拆解图 + 数字档案界面。"
        : handDrawnEnabled
          ? "当前视觉系统为：手绘扁平涂鸦、flat doodle、playful illustration、粗线条、明快色块、留白构图。扩写必须简洁、有留白，不做过多细碎内容。"
        : referenceGroupEnabled
          ? `当前视觉系统为「${preset.preset_name}」：${referenceGroupVisualText || preset.style_group}。扩写必须遵循该风格的共享视觉、构图、色彩、材质和参考图维度，不要套用黏土、手帐、Y3K或其他风格。${threeDPersonEnabled ? `本次3D人物必须启用大透视约束：镜头=${threeDPersonDecision.camera}；前景锚点=${threeDPersonDecision.foreground_anchor}；动作=${threeDPersonDecision.motion_path}；场景=${threeDPersonDecision.scene_depth}。` : ""}`
        : customEnabled
          ? `当前视觉系统为用户自定义风格「${preset.preset_name}」：${preset.style_group}。扩写必须遵循该风格的共享视觉、构图、色彩、材质和参考图变体，不要套用其他内置风格。`
        : clayEnabled
          ? "当前视觉系统为：3D黏土/软陶质感、萌趣可爱、哑光手作、圆润造型、活动海报感、上标题下主视觉、单主体舞台式构图、纯净背景。"
        : preset
          ? "只扩写用户描述与当前预设明确支持的主体、场景、道具、动作、情绪、色彩和构图信息；缺少依据的维度可以不写。"
          : "当前不使用风格预设。扩写只基于用户原始描述；缺少依据的主体细节、色彩、材质、镜头、背景或信息区可以不写，不要套用固定风格。",
    scrapbookEnabled
      ? `手帐拼贴扩写必须包含：${Object.keys(SCRAPBOOK_PRESET.scene_expansion_schema).join("、")}。规则：${SCRAPBOOK_PRESET.scene_expansion_rules.join("；")}。`
      : y3kEnabled
        ? `Y3K扩写必须包含：人物主体、2-3个穿搭亮点、1-3个局部特写框、细线标注、黑银灰白主色、少量高亮点缀、数字界面模块${hasMainTitle(request) ? "、银色金属锐利标题" : ""}。规则：${Y3K_PRESET.scene_expansion_rules.join("；")}。`
        : handDrawnEnabled
          ? `手绘扁平涂鸦扩写规则：${HAND_DRAWN_PRESET.scene_expansion_rules.join("；")}。明确用户已提及的主体、少量辅助元素、留白和简洁背景；标题区仅在主标题存在时扩写。`
        : referenceGroupEnabled
          ? `当前风格扩写规则：视觉关键词：${referenceGroupVisualText}；构图：${(shared.composition_rules || []).join("；")}；色彩：${(shared.color_rules || []).join("；")}；材质：${(shared.texture_rules || []).join("；")}；其他规则：${(preset.scene_expansion_rules || []).join("；")}。只写用户描述与预设明确支持的维度；标题区仅在主标题存在时扩写；禁止出现“黏土、软陶、粘土、小舞台式黏土”等不属于当前风格的描述。${threeDPersonEnabled ? `${threeDPersonPerspectiveBlock(threeDPersonDecision)} 扩写中必须写出：强镜头、30%-55%巨大前景锚点、抽象变形人体、S型/对角线/环形动势、干净纵深场景。` : ""}`
        : customEnabled
          ? `自定义风格扩写规则：视觉关键词：${[...(preset.visual_keywords || []), ...(preset.shared_style?.visual_style || [])].join("、")}；构图：${(preset.shared_style?.composition_rules || []).join("；")}；色彩：${(preset.shared_style?.color_rules || []).join("；")}；材质：${(preset.shared_style?.texture_rules || []).join("；")}；其他规则：${(preset.scene_expansion_rules || []).join("；")}。`
        : clayEnabled
          ? "当前视觉系统为：3D黏土/软陶质感、萌趣可爱、哑光手作、圆润造型、活动海报感、上标题下主视觉、单主体舞台式构图、纯净背景。"
        : preset
          ? "默认预设扩写规则：忠实用户输入，画面商业化、信息清晰、主体明确、构图稳定；不得新增品牌、活动时间、价格、英文、口号、人物身份、产品型号或无关道具。"
          : "默认扩写规则：忠实用户输入，画面商业化、信息清晰、主体明确、构图稳定；不得新增品牌、活动时间、价格、英文、口号、人物身份、产品型号或无关道具。",
    petEnabled ? `检测到宠物主题，必须启用当前预设的宠物角色造型约束：${petConstraint(preset).description} 正向造型词：${petPositiveText(preset)}。负向约束：${petNegativeText(preset)}。英文词只作为风格关键词，不得成为画面文字。`
      : "",
    doudouEnabled ? `${doudouRolePrompt(request)} 扩写时必须明确兜兜在画面中的位置、动作、神态以及与主体/场景的呼应关系。兜兜是红色购物袋/袋形抖音商城IP角色，没有手、手臂和嘴巴，不得写成普通人物、动物、普通购物袋或无关玩偶。` : "",
    titleExpansionRule,
    "严格限制：只扩写用户已给出的视觉意图，不新增品牌、logo、活动时间、价格、英文、口号、人物身份、产品型号或无关道具。",
    "如果用户文本中包含 @图1、@图2 等引用，必须原样保留这些 @ 引用和对应用途。",
  ].filter(Boolean).join("\n");
  const user = [
    `活动名称：${request.campaign_name || "未填写"}`,
    `活动时间：${campaignTimeText(request) || "未填写"}`,
    `输出比例：${request.image_size}`,
    `已上传图片标签：${request.reference_labels.length ? request.reference_labels.map((label) => `@${label}`).join("、") : "无"}`,
    `用户原始画面描述：${request.visual_description}`,
  ].join("\n");

  try {
    const expanded = await callResponses({ system, user, expectJson: false });
    const cleaned = sanitizeExpandedDescription(expanded);
    if (!cleaned) throw new Error("模型未返回扩写内容");
    return { expanded_description: cleaned, fallback: false };
  } catch (error) {
    return {
      expanded_description: localExpandDescription(request),
      fallback: true,
      warning: `扩写已使用本地结构化草稿；真实错误：${error.message}`,
    };
  }
}

function selectMaterials(materials, request, brief, design, options = {}) {
  const skipTypes = new Set(options.skipTypes || []);
  return MATERIAL_TYPES.filter((type) => !skipTypes.has(type)).map((type) => {
    const ranked = materials
      .filter((material) => material.type === type)
      .map((material) => ({ material, scores: scoreMaterial(material, type, request, brief, design) }))
      .sort((a, b) => b.scores.total - a.scores.total);

    const topScore = ranked[0]?.scores.total || 0;
    const close = ranked.filter((item) => item.scores.total >= topScore - (type === "字体" ? 0.18 : 0.08)).slice(0, type === "字体" ? 4 : 2);
    const top = close.length ? close[stableHash(`${request.campaign_name}|${request.visual_description}|${type}`) % close.length] : ranked[0];
    if (!top) {
      return { type, number: "", Reference: "该类型暂无可用素材", image: "", image_url: "", scores: null };
    }

    return {
      type,
      number: top.material.number,
      Reference: bestReference(top.material),
      reason: selectionReason(type, top.material, top.scores),
      image: top.material.image,
      image_url: top.material.image?.startsWith("http") ? top.material.image : "",
      local_image: top.material.image?.startsWith("/") ? top.material.image : "",
      description: top.material.reference_description,
      scores: top.scores,
    };
  });
}

function buildPromptInput(request, design, selected) {
  const references = selected
    .map(
      (item) =>
        `${item.type}参考图 ${item.number}：${item.Reference}。只参考指定维度，不复制其中的具体品牌、文字、人物或产品。`,
    )
    .join("\n");

  return [
    `用户输入：${JSON.stringify(request, null, 2)}`,
    `设计判断：${JSON.stringify(design, null, 2)}`,
    `参考素材：\n${references}`,
    `输出尺寸：${request.image_size}`,
  ].join("\n\n");
}

const PROMPT_SECTIONS = ["一、参考图说明", "二、整体视觉方向", "三、空间、透视与构图规则", "四、主视觉主体设定", "五、辅助元素与画面内容", "六、标题文字与信息层级", "九、禁止项"];

function normalizePromptHeading(line) {
  const clean = line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, "");
  return PROMPT_SECTIONS.find((section) => clean === section.replace(/\s+/g, "")) || line;
}

function normalizePromptSections(prompt) {
  const fenced = textOf(prompt).trim().match(/^```(?:text|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  const source = (fenced ? fenced[1] : textOf(prompt)).replace(/\r\n/g, "\n").trim();
  const lines = source.split("\n").map((line) => normalizePromptHeading(line));
  const chunks = [];
  let current = null;
  for (const line of lines) {
    const heading = line.trim();
    if (PROMPT_SECTIONS.includes(heading)) {
      if (current) chunks.push(current);
      current = { heading, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) chunks.push(current);
  if (!chunks.length) return source;
  return chunks
    .map(({ heading, body }) => `${heading}${body.join("\n").trim() ? `\n${body.join("\n").trim()}` : ""}`)
    .join("\n\n")
    .trim();
}

function promptSectionsAreValid(prompt) {
  const headings = normalizePromptSections(prompt)
    .split(/\r?\n/)
    .map((line) => normalizePromptHeading(line).trim())
    .filter((line) => PROMPT_SECTIONS.includes(line));
  if (!headings.length || new Set(headings).size !== headings.length) return false;
  return headings.every((heading, index) => index === 0 || PROMPT_SECTIONS.indexOf(heading) > PROMPT_SECTIONS.indexOf(headings[index - 1]));
}

function promptSectionMap(prompt) {
  const normalized = normalizePromptSections(prompt);
  const lines = normalized.split(/\r?\n/);
  const map = new Map();
  let current = null;
  for (const line of lines) {
    const heading = normalizePromptHeading(line).trim();
    if (PROMPT_SECTIONS.includes(heading)) {
      current = { heading, body: [] };
      if (!map.has(heading)) map.set(heading, current);
    } else if (current && map.get(current.heading) === current) {
      current.body.push(line);
    }
  }
  return map;
}

function restrictPromptToDraftSections(prompt, draft) {
  const candidateMap = promptSectionMap(prompt);
  const draftMap = promptSectionMap(draft);
  return PROMPT_SECTIONS
    .filter((heading) => draftMap.has(heading))
    .map((heading) => {
      const candidate = candidateMap.get(heading);
      const fallback = draftMap.get(heading);
      const body = (candidate?.body.join("\n").trim() || fallback.body.join("\n").trim());
      return `${heading}${body ? `\n${body}` : ""}`;
    })
    .join("\n\n")
    .trim();
}

function preserveDraftSection(prompt, draft, heading) {
  const promptMap = promptSectionMap(prompt);
  const draftMap = promptSectionMap(draft);
  if (!draftMap.has(heading)) return restrictPromptToDraftSections(prompt, draft);
  promptMap.set(heading, draftMap.get(heading));
  return PROMPT_SECTIONS
    .filter((section) => draftMap.has(section))
    .map((section) => {
      const block = promptMap.get(section) || draftMap.get(section);
      const body = block.body.join("\n").trim();
      return `${section}${body ? `\n${body}` : ""}`;
    })
    .join("\n\n")
    .trim();
}

function enforceReferenceSection(prompt, request, selected = []) {
  const source = textOf(prompt).trim();
  if (!source || !selected.length) return source;
  const referenceBody = selected.map((item, index) => referenceInstruction(item, index, request)).join("\n");
  const referenceSection = `${referenceBody}\n注意：图的命名和顺序要和传入大模型的参考图对应。`;
  const sections = promptSectionMap(source);
  sections.set("一、参考图说明", { heading: "一、参考图说明", body: referenceSection.split("\n") });
  return PROMPT_SECTIONS
    .filter((heading) => sections.has(heading))
    .map((heading) => {
      const body = sections.get(heading).body.join("\n").trim();
      return `${heading}${body ? `\n${body}` : ""}`;
    })
    .join("\n\n")
    .trim();
}

function replaceReferenceSampleTitle(text, request = {}) {
  const title = textOf(request.campaign_name).trim();
  if (!title) return textOf(text);
  return textOf(text).replace(/\b(text\s*(?:content)?\s*[:：]\s*)([^,\n，。;；]+)/gi, `$1${title}`);
}

function campaignTimeText(request = {}) {
  return textOf(request.campaign_time).trim();
}

function campaignSubtitleText(request = {}) {
  return textOf(request.campaign_subtitle).trim();
}

function integratedLayoutDecorativeCopyContext(request = {}) {
  const title = textOf(request.campaign_name).trim();
  const subtitle = campaignSubtitleText(request);
  const time = campaignTimeText(request);
  const allowed = [
    title ? `主标题「${title}」` : "",
    subtitle ? `副标题「${subtitle}」` : "",
    time ? `活动时间「${time}」` : "",
  ].filter(Boolean);
  return allowed.length
    ? `本次可读文字白名单仅包含：${allowed.join("；")}。白名单之外的参考图原文和模型联想文字全部删除，不得改写或补写`
    : "本次可读文字白名单为空：删除参考图中的全部可读文字，只保留非文字装饰结构与空白版式";
}

function titleTimeText(request = {}) {
  const title = textOf(request.campaign_name).trim();
  const subtitle = campaignSubtitleText(request);
  const time = campaignTimeText(request);
  return [
    title ? `主标题「${title}」` : "",
    subtitle ? `副标题「${subtitle}」` : "",
    time ? `活动时间「${time}」` : "",
  ].filter(Boolean).join("；");
}

function subtitlePromptRule(request = {}) {
  const subtitle = campaignSubtitleText(request);
  if (!subtitle) return "";
  return hasMainTitle(request)
    ? `副标题：用户已提供副标题「${subtitle}」，必须准确出现。副标题按整合版式参考中的次级信息样式、字号比例、位置和对齐关系呈现，层级低于主标题；副标题文字颜色与主标题保持同一颜色系统。`
    : `副标题：用户已提供副标题「${subtitle}」，必须按原文准确出现，并按整合版式参考中的次级信息槽位呈现。`;
}

function enforceCampaignSubtitleInPrompt(prompt, request = {}) {
  const subtitle = campaignSubtitleText(request);
  let source = textOf(prompt);
  source = source.replace(
    /(主\/副标题文字：)([^\n]*)/,
    (_, prefix, value) => {
      if (subtitle) {
        return `${prefix}${value.includes(subtitle) ? value : `${value}；副标题「${subtitle}」`}`;
      }
      const cleaned = value
        .split(/[；;]/)
        .filter((part) => !/^\s*副标题/.test(part))
        .join("；");
      return `${prefix}${cleaned}`;
    },
  );

  const rule = subtitlePromptRule(request);
  if (/(^|\n)副标题：[^\n]*/.test(source)) {
    source = source.replace(/(^|\n)副标题：[^\n]*/, (_, prefix) => `${prefix}${rule}`);
  } else if (source.includes("\n活动时间：")) {
    source = source.replace("\n活动时间：", `\n${rule}\n活动时间：`);
  }

  if (subtitle) {
    source = source.replace(
      /(信息层级要求：)([^\n]*)/,
      (_, prefix, value) => {
        if (value.includes("副标题次于主标题")) return `${prefix}${value}`;
        const cleaned = value.replace(/^主标题最大；?/, "");
        return `${prefix}主标题最大；副标题次于主标题，并与主标题使用同一字体视觉系统；${cleaned}`;
      },
    );
  }
  return source;
}

function enforceCampaignTimeInPrompt(prompt, request = {}) {
  const time = campaignTimeText(request);
  if (!time) return textOf(prompt);
  let source = textOf(prompt);
  if (source.includes(time)) return source;
  source = source.replace(
    /(主\/副标题文字：)([^\n]*)/,
    (_, prefix, value) => `${prefix}${value.includes("活动时间") ? value : `${value}；活动时间「${time}」`}`,
  );
  source = source.replace(
    /活动时间：[^\n]*/,
    `活动时间：用户已提供活动时间「${time}」，必须出现；时间必须和主标题字体做在一块儿，作为同一标题组的一部分，层级低于主标题，不得散落在角落或独立信息区。`,
  );
  source = source.replace(
    /(信息层级要求：)([^\n]*)/,
    (_, prefix, value) => `${prefix}${value.includes("活动时间") ? value : `主标题最大；活动时间次于主标题，并贴近主标题形成标题组；${value}`}`,
  );
  return source;
}

function cleanPromptForVisibleInputs(prompt) {
  return prompt;
}

function explicitEnglishTitle(request) {
  const source = `${request.campaign_name}\n${campaignSubtitleText(request)}\n${request.visual_description}`;
  const match = source.match(/(?:英文|English|EN)\s*[：:]\s*([A-Za-z][A-Za-z0-9 ,.'’&+-]{1,60})/i);
  return match ? match[1].trim() : "";
}

function uploadedReferenceScopeText(request, index = 0) {
  const text = `${request.visual_description} ${request.user_reference_usage || ""}`;
  const label = request.reference_labels?.[index] || `图${index + 1}`;
  const mentions = [...new Set([`@${label}`, `@图${index + 1}`])];
  const contexts = [];
  for (const mention of mentions) {
    let cursor = 0;
    while (cursor < text.length) {
      const mentionIndex = text.indexOf(mention, cursor);
      if (mentionIndex < 0) break;
      // Keep the words before the mention. Phrases such as "产品为@图1"
      // carry the reference role on the left side of the token.
      contexts.push(text.slice(Math.max(0, mentionIndex - 48), Math.min(text.length, mentionIndex + mention.length + 96)));
      cursor = mentionIndex + mention.length;
    }
  }
  return contexts.length ? contexts.join(" ") : text;
}

function uploadedReferenceMentionInfo(request, index = 0) {
  const text = `${request.visual_description} ${request.user_reference_usage || ""}`;
  const label = request.reference_labels?.[index] || `图${index + 1}`;
  const mentions = [...new Set([`@${label}`, `@图${index + 1}`])];
  const occurrences = [];
  for (const mention of mentions) {
    let cursor = 0;
    while (cursor < text.length) {
      const mentionIndex = text.indexOf(mention, cursor);
      if (mentionIndex < 0) break;
      occurrences.push({
        mention,
        before: text.slice(Math.max(0, mentionIndex - 36), mentionIndex).replace(/\s+/g, ""),
        after: text.slice(mentionIndex + mention.length, Math.min(text.length, mentionIndex + mention.length + 48)).replace(/\s+/g, ""),
      });
      cursor = mentionIndex + mention.length;
    }
  }
  return occurrences;
}

function hasExplicitUploadedSubjectBinding(request, index = 0) {
  return uploadedReferenceMentionInfo(request, index).some(({ before, after }) => {
    const subjectTerms = "(?:主体|主视觉主体|主视觉|主角|产品|商品|人物|人像|对象)";
    const beforePattern = new RegExp(`${subjectTerms}(?:为|是|采用|使用|选用|指定为)?$`);
    const afterPattern = new RegExp(
      `^(?:[（(]?USER_\\d+[）)]?)?(?:作为|用作|就是|为|是|设为|指定为)?${subjectTerms}`,
    );
    return beforePattern.test(before) || afterPattern.test(after);
  });
}

function uploadedReferenceRole(request, index = 0) {
  const scopedText = uploadedReferenceScopeText(request, index);
  const hasMention = uploadedReferenceMentionInfo(request, index).length > 0;
  // Explicit identity binding always wins. Nearby words such as "主体位置",
  // "构图", "自然光" or "氛围" describe how that subject should be staged;
  // they must not turn the uploaded object into a layout or style reference.
  if (hasExplicitUploadedSubjectBinding(request, index)) return "主体";
  if (/(字体|字形|字重|标题字|文字层级|字体参考|参考字体|字效|排版节奏)/.test(scopedText)) return "字体";
  if (/(构图|版式|布局|画面结构|空间关系|透视|主体位置|信息区|画面层级|参考构图|参考版式)/.test(scopedText)) return "构图";
  if (/(?:作为|用作|仅作|只作|参考|用于).{0,24}(?:风格|氛围|色彩|调性|质感|光影)|(?:风格|氛围|色彩|调性|质感|光影).{0,16}(?:参考|用途|使用)/.test(scopedText)) return "风格";
  if (/(人物|人像|女生|男生|模特|主视觉人物|主体人物|作为主体|作为主视觉|主体\s*(?:为|是)|主视觉\s*(?:为|是)|主角\s*(?:为|是)|产品|商品|包装|瓶|盒|杯|罐|设备|物品|对象|主视觉产品|主体产品)/.test(scopedText)) return "主体";
  // A direct @ mention defaults to subject usage unless the user explicitly
  // labels it as font, composition, or style above. Ambient words such as
  // "光影" and "氛围" must not silently downgrade the uploaded object to style.
  if (hasMention) return "主体";
  if (/(风格|氛围|色彩|调性|质感|光影|参考整体)/.test(scopedText)) return "风格";
  return "补充参考";
}

function uploadedReferenceSubjectKind(request, index = 0) {
  const scopedText = uploadedReferenceScopeText(request, index);
  if (/(人物|人像|女生|男生|模特|主视觉人物|主体人物|这个人|角色)/.test(scopedText)) return "人物";
  if (/(产品|商品|包装|瓶|盒|杯|罐|设备|物品|对象|主视觉产品|主体产品)/.test(scopedText)) return "产品";
  return "对象";
}

function uploadedReferenceVisionInputs(request = {}) {
  return (request.uploaded_references || []).flatMap((image, index) => {
    const local = materialImagePath(textOf(image).trim());
    if (!local?.file || !existsSync(local.file)) return [];
    const label = request.reference_labels?.[index] || `图${index + 1}`;
    const role = uploadedReferenceRole(request, index);
    const kind = role === "主体" ? uploadedReferenceSubjectKind(request, index) : "参考";
    return [{
      path: local.file,
      label: `用户上传 @${label}；用途：${role}${role === "主体" ? `；这是不可替换的${kind}身份来源` : ""}`,
      detail: "high",
    }];
  });
}

function uploadedReferenceUsage(request, index = 0) {
  const scopedText = uploadedReferenceScopeText(request, index);
  const role = uploadedReferenceRole(request, index);
  if (role === "字体") {
    return "参考标题字形、字重、文字层级和信息区排版节奏；只参考字体气质，不复制图中文字内容、品牌、背景或产品。";
  }
  if (role === "构图") {
    return hasMainTitle(request)
      ? "参考整体版式结构、画面层级、主体区域、标题区域、信息区位置和空间透视关系；不复制具体物体、品牌、人物或文字。"
      : "参考整体版式结构、画面层级、主体区域、信息区位置和空间透视关系；不复制具体物体、品牌、人物或文字。";
  }
  if (role === "主体" && uploadedReferenceSubjectKind(request, index) === "人物") {
    return "参考主视觉主体人物的身份外观、姿态气质、服装轮廓和人物占位关系；主体以这张用户上传图中的人物为核心，不复制无关背景。";
  }
  if (role === "主体" && uploadedReferenceSubjectKind(request, index) === "产品") {
    return "参考主视觉主体产品的外观结构、比例、材质和识别特征；主体以这张用户上传图中的产品为核心，不复制无关背景。";
  }
  if (role === "主体") {
    return "参考用户上传图中的主视觉主体身份、外观轮廓、结构部件、比例、材质和识别特征；主体必须是图中同一对象，只允许调整摆放、动作、场景、构图与光影，不得替换成其他对象。";
  }
  if (role === "风格") {
    return "参考用户上传图的整体视觉风格、色彩调性和氛围，不复制其中的具体文字、品牌或无关元素。";
  }
  return "参考用户上传图中被用户提及的主体或视觉要点；仅作为当次生成的补充参考，不复制无关文字、品牌或背景。";
}

function buildUploadedReference(fileUrl, request, index = 0) {
  const reference = uploadedReferenceUsage(request, index);
  const role = uploadedReferenceRole(request, index);
  const subjectKind = role === "主体" ? uploadedReferenceSubjectKind(request, index) : "";
  return {
    type: role === "字体" || role === "构图" ? role : "用户上传",
    source: "用户上传",
    role,
    number: `USER_${index + 1}`,
    label: request.reference_labels?.[index] || `图${index + 1}`,
    Reference: reference,
    reason: "用户主动上传并在描述中提及，用于约束最终画面的主体或视觉要点。",
    image: fileUrl,
    local_image: fileUrl,
    image_url: "",
    description: reference,
    subject_kind: subjectKind,
    immutable_subject: role === "主体",
  };
}

function integratedLayoutTypographyDirective(request, selected = []) {
  const referenceIndex = selected.findIndex((item) => (item.role || item.type) === "整合版式");
  if (referenceIndex < 0) return "";
  const reference = selected[referenceIndex];
  const title = textOf(request.campaign_name).trim();
  const subtitle = campaignSubtitleText(request);
  const time = campaignTimeText(request);
  const titleLength = Array.from(title).length;
  const execution = compactKnowledge(
    reference.execution_description || reference.description || "",
    3800,
  );
  return [
    "【整合版式文字视觉系统（最高优先级）】",
    `图 ${referenceIndex + 1}（${reference.number}）不是普通构图参考，而是本次全部文字信息的样式模板。文字视觉系统的优先级高于文字内容本身，也高于风格、元素、角色和场景参考。`,
    title
      ? `把参考图的主标题内容替换为「${title}」（${titleLength}个字符），但必须保留参考图主标题的字形气质、笔画语言、字重、字宽、行数逻辑、字距、行距、面积占比、位置、对齐方式、组合轮廓、装饰笔画和与其他信息的关系。`
      : "用户未提供主标题，删除主标题正文；不得自行编造业务主标题。",
    subtitle
      ? `把参考图的副标题内容替换为「${subtitle}」，严格继承参考图副标题相对主标题的字号比例、字重、位置、对齐轴、行数和间距。`
      : "用户未提供副标题；删除参考图中的副标题、说明、口号、英文眉题及其他装饰文案槽位，不得自行编造或改写。",
    time
      ? `把参考图的时间内容替换为「${time}」，严格继承参考图时间模块的数字样式、字号比例、位置、对齐轴、组合方式和与主标题的距离。`
      : "用户未提供活动时间，删除事实性日期/时间内容，不得编造日期。",
    INTEGRATED_LAYOUT_DECORATION_RULE,
    integratedLayoutDecorativeCopyContext(request),
    "不要机械套用左对齐。先观察参考图的真实视觉中心、文字组外轮廓和阅读动线，再结合本次主标题长度执行参考描述中的“主标题长度变化/内容适配规则”：短标题可放大、居中或保持参考图视觉中心；长标题可分行或压缩，但不得擅自统一为左对齐。",
    "文字颜色不继承参考图；根据本次画面背景重新确定。用户实际提供的副标题和活动时间与主标题保持统一颜色系统，除非参考图本身通过局部强调色建立明确层级。",
    execution ? `参考图可执行标注：\n${execution}` : "",
  ].filter(Boolean).join("\n");
}

function referenceInstruction(item, index, request) {
  const label = `图 ${index + 1}（${item.number}）`;
  const role = item.role || item.type || "参考";
  const activePreset = presetForRequest(request);
  const usesIntegratedLayout = Boolean(activePreset
    && presetReferenceGroups(activePreset).some((group) => group.id === "integrated_layout"));
  const title = textOf(request.campaign_name).trim();
  const subtitle = campaignSubtitleText(request);
  const time = campaignTimeText(request);
  const content = textOf(request.visual_description).trim();
  if (item.source === "兜兜IP") {
    const doudouRoleValue = doudouRole(request) || "辅助角色";
    return `${label} 是兜兜IP参考：参考兜兜的袋形轮廓、比例、眼睛、腿脚、提手和动作，把兜兜改为当前画面风格并放入本次场景；兜兜作为${doudouRoleValue}，没有手臂、手或嘴巴。`;
  }
  if (item.source === "视觉预设") {
    if (role === "整合版式") {
      const providedText = [
        title ? `主标题改为「${title}」` : "删除主标题槽位",
        subtitle ? `副标题改为「${subtitle}」` : "删除副标题槽位",
        time ? `活动时间改为「${time}」` : "删除活动时间槽位",
      ].join("；");
      return `${label} 是整合版式与文字视觉系统参考，优先级高于其他参考图：${providedText}。必须参考图 ${index + 1} 中所有可见信息角色的字形气质、笔画语言、字重、字号比例、行数、字距、行距、位置、对齐轴、组合轮廓、阅读顺序与装饰关系。${INTEGRATED_LAYOUT_DECORATION_RULE}。${integratedLayoutDecorativeCopyContext(request)}。根据本次标题长度和参考图的内容适配规则决定左对齐、居中、右对齐或自由组合，不得默认左对齐。参考图中的白色或空白区域是主视觉画面的生成区域，不代表最终背景必须为白色。文字颜色根据本次画面重新确定。`;
    }
    if (role === "字体") {
      const replacement = [title ? `主标题「${title}」` : "", subtitle ? `副标题「${subtitle}」` : ""].filter(Boolean).join("、");
      return `${label} 是字体参考：只参考图 ${index + 1} 的标题字形骨架、笔画、端点、字距和排版样式，将文字改为${replacement || "用户提供的标题"}；禁止继承字体参考图的文字颜色、背景颜色、渐变或配色。主标题颜色必须根据本次整体视觉方向、背景对比和可读性重新确定。`;
    }
    if (role === "排版") {
      return `${label} 是全局排版参考：仅参考主标题、副标题、补充信息、活动时间和主画面区之间的位置、对齐、字号比例、面积占比、阅读顺序与留白关系。主标题字形仍遵循字体参考图，活动时间字形仍遵循日期参考图；不参考本图的字体字形、日期字形、文字颜色、具体文字、品牌、装饰、人物或产品。用户未提供的信息不得因参考图而新增。`;
    }
    if (role === "元素") {
      return `${label} 为「${item.preset_name || "当前风格预设"}」元素参考图。仅参考主体/道具的造型语言、边缘处理、体积关系和完成度；色彩以本次设计判断和用户输入为准，不继承参考图颜色，不复制具体产品、品牌、文字、logo或水印。${usesIntegratedLayout ? "元素参考不得改变整合版式的文字位置、对齐轴、主画面区和留白比例。" : ""}`;
    }
    if (role === "日期") {
      return `${label} 是日期参考：参考图 ${index + 1} 的日期样式，将日期改为「${time}」；日期文字颜色必须与主标题完全一致。`;
    }
    if (role === "角色") {
      return `${label} 为「${item.preset_name || "当前风格预设"}」角色参考图。仅参考角色的比例抽象、轮廓结构、造型语言、动作重心和运动方向；不复制角色身份、服装文字、颜色、品牌、logo或背景。${usesIntegratedLayout ? "角色参考不得改变整合版式的文字位置、对齐轴、主画面区和留白比例。" : ""}`;
    }
    return `${label} 为「${item.preset_name || "当前风格预设"}」风格参考图。仅参考渲染风格、色块/材质语言、光影气质和商业完成度；色彩以本次设计判断和用户输入为准，不继承参考图颜色，不复制具体文字、日期、品牌、logo、水印、人物身份、产品或无关道具。${usesIntegratedLayout ? "风格参考不控制构图和信息排布，不得改变整合版式的文字位置、对齐轴、主画面区和留白比例。" : ""}`;
  }
  if (item.source === "用户上传") {
    if (item.role === "字体") {
      return `${label} 是用户上传的字体参考：只参考标题字形与排版样式，将文字替换为「${title}」；禁止继承参考图的文字颜色、背景颜色、渐变或配色。`;
    }
    if (item.role === "构图") {
      return `${label} 是用户上传的构图参考：参考版式结构与主体位置，将内容替换为本次标题和画面主体。`;
    }
    if (item.role === "主体") {
      const kind = item.subject_kind || "对象";
      return `${label} 是用户上传的${kind}主体原图，不是普通风格参考。最终画面必须直接使用图 ${index + 1} 中的同一${kind}，保持其真实品类、整体轮廓、结构部件、包装比例、材质和可见识别特征；只可改变背景、承载台、构图、光影和与场景适配的摆放角度。严禁替换为任何其他对象，严禁另造一件产品充当主体。`;
    }
    return `${label} 是用户上传参考：按用户对「@${item.label || `图${index + 1}`}」的说明参考主体或视觉样式，并改为本次画面内容。`;
  }
  if (item.type === "字体") {
    return `${label} 是字体参考：只参考标题字形和排版样式，将文字替换为「${title}」；禁止继承参考图的文字颜色、背景颜色、渐变或配色。`;
  }
  return `${label} 是构图参考：参考整体版式与主体位置，将内容替换为本次标题和画面主体。`;
}

function fontReferenceConstraint(selected = []) {
  const fontRefs = selected
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.role || item.type) === "字体");
  if (!fontRefs.length) return "";
  return fontRefs.map(({ item, index }) => {
    const mode = item.typography_render_mode === "flat"
      ? "保持二维平面，不增加立体厚度或场景材质。"
      : item.typography_render_mode === "dimensional"
        ? "保留参考图中已有的立体表现。"
        : "不添加参考图中没有的材质或特效。";
    return `标题严格参考图 ${index + 1}（${item.number}）的字形骨架、笔画、端点、字距和排版样式，只替换文字内容；禁止继承该字体参考图的文字颜色、背景颜色、渐变和配色，主标题颜色由本次整体视觉方向、背景对比和可读性决定；${mode}`;
  }).join("\n");
}

function dateReferenceConstraint(selected = [], request = {}) {
  const time = campaignTimeText(request);
  if (!time) return "";
  const dateRefs = selected
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.role || item.type) === "日期");
  if (!dateRefs.length) return `活动时间使用简洁清晰的二维次级排版，内容为「${time}」，靠近标题但不套用主标题的夸张字形；活动时间文字颜色与主标题完全一致。`;
  return dateRefs.map(({ item, index }) =>
    `日期严格参考图 ${index + 1}（${item.number}）的数字字形、层级和排版样式，将原日期替换为「${time}」；活动时间文字颜色与主标题完全一致。`,
  ).join("\n");
}

function enforceFontReferenceConstraint(prompt, selected = []) {
  const constraint = fontReferenceConstraint(selected);
  const source = textOf(prompt).trim();
  if (!constraint || source.includes(constraint) || source.includes("标题严格参考图") || source.includes("是字体参考")) return source;
  if (/主\/副标题文字：.*\n/.test(source)) {
    return source.replace(/(主\/副标题文字：.*\n)/, `$1${constraint}\n`);
  }
  if (source.includes("六、标题文字与信息层级")) {
    return source.replace("六、标题文字与信息层级", `六、标题文字与信息层级\n${constraint}`);
  }
  return `${source}\n\n${constraint}`.trim();
}

function normalizedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${Math.round(number * 1000) / 10}%`;
}

function normalizedBboxText(bbox = []) {
  if (!Array.isArray(bbox) || bbox.length < 4) return "";
  const [x, y, width, height] = bbox.map(Number);
  if (![x, y, width, height].every(Number.isFinite)) return "";
  return `x=${normalizedPercent(x)}，y=${normalizedPercent(y)}，宽=${normalizedPercent(width)}，高=${normalizedPercent(height)}，右边界=${normalizedPercent(x + width)}`;
}

function integratedLayoutConstraint(request, selected = []) {
  const referenceIndex = selected.findIndex((item) => (item.role || item.type) === "整合版式");
  if (referenceIndex < 0) return "";
  const reference = selected[referenceIndex];
  const metadata = reference.layout_metadata || {};
  const safeZones = Array.isArray(metadata.text_safe_zones) ? metadata.text_safe_zones : [];
  const targetOrientation = compositionOrientation(request.image_size);
  const sourceOrientation = reference.composition_orientation || referenceCompositionOrientation("", "", metadata);
  const manuallySelected = textOf(request.integrated_layout_variant).trim() === reference.variant_id;
  const manualOrientationMismatch = manuallySelected
    && sourceOrientation
    && sourceOrientation !== "Any"
    && sourceOrientation !== targetOrientation;
  const enabledRoles = new Set([
    hasMainTitle(request) ? "main_title" : "",
    campaignSubtitleText(request) ? "subtitle" : "",
    campaignTimeText(request) ? "time" : "",
  ].filter(Boolean));
  const roleNames = { main_title: "主标题", subtitle: "副标题", time: "活动时间", auxiliary_info: "辅助信息" };
  const zoneLines = (manualOrientationMismatch ? [] : safeZones)
    .filter((zone) => enabledRoles.has(zone.role))
    .map((zone) => `${roleNames[zone.role] || zone.role}区域：${normalizedBboxText(zone.bbox)}`)
    .filter(Boolean);
  const activeTextGroup = manualOrientationMismatch ? "" : normalizedBboxText(metadata.active_text_group_bbox);
  const visualArea = manualOrientationMismatch ? "" : normalizedBboxText(metadata.visual_area_bbox);
  const sharedRightEdge = Number(metadata.shared_right_edge);
  const tolerance = Number(metadata.alignment_tolerance);
  const alignmentLines = [];
  if (metadata.text_group_horizontal_alignment === "center") {
    if (activeTextGroup) {
      const bbox = metadata.active_text_group_bbox.map(Number);
      alignmentLines.push(`活跃文字组整体区域：${activeTextGroup}；其水平中心固定在画布 ${normalizedPercent(bbox[0] + bbox[2] / 2)} 附近，不得整组向左或向右漂移。`);
    } else if (manualOrientationMismatch) {
      alignmentLines.push("活跃文字组在目标画幅中保持整体水平居中，迁移时不得退化成默认左对齐。");
    }
  }
  if (metadata.main_title_alignment && hasMainTitle(request)) {
    const alignmentLabel = {
      left: "左对齐",
      center: "居中对齐",
      right: "右对齐",
      free: "自由组合",
    }[metadata.main_title_alignment] || metadata.main_title_alignment;
    alignmentLines.push(`参考图主标题的基础对齐为${alignmentLabel}。结合本次标题长度与参考描述中的“主标题长度变化/内容适配规则”调整行数和字面宽度，保持参考图的视觉中心与文字组外轮廓；不得机械地把所有标题改成左对齐。`);
  }
  if (metadata.main_title_time_alignment === "right_edge"
      && hasMainTitle(request)
      && campaignTimeText(request)) {
    if (manualOrientationMismatch) {
      alignmentLines.push("主标题与活动时间在目标画幅中继续共用同一条右边界对齐轴；只允许整体缩放和位移，不得拆散该关系。");
    } else if (Number.isFinite(sharedRightEdge)) {
      alignmentLines.push(`主标题与活动时间必须共用 x=${normalizedPercent(sharedRightEdge)} 的右边界垂直对齐轴，两者右边界必须对齐，允许偏差不超过画布宽度的 ${normalizedPercent(Number.isFinite(tolerance) ? tolerance : 0.02)}。`);
    }
  }
  if (campaignSubtitleText(request) && metadata.subtitle_alignment) {
    const subtitleAlignment = {
      left: "左对齐",
      center: "居中对齐",
      right: "右对齐",
      follow_title: "跟随主标题对齐轴",
    }[metadata.subtitle_alignment] || metadata.subtitle_alignment;
    alignmentLines.push(`副标题保持参考图的${subtitleAlignment}及其相对主标题的字号、间距和位置比例，不得按通用模板重新排版。`);
  }
  if (metadata.time_alignment && campaignTimeText(request)) {
    const timeAlignment = {
      left: "左对齐",
      center: "居中对齐",
      right: "右对齐",
      follow_title: "跟随主标题对齐轴",
    }[metadata.time_alignment] || metadata.time_alignment;
    alignmentLines.push(`活动时间保持参考图的${timeAlignment}、字号比例、组合方式和信息槽位；辅助信息缺失时按参考描述中的缺失规则处理。`);
  }
  const title = textOf(request.campaign_name).trim();
  const subtitle = campaignSubtitleText(request);
  const time = campaignTimeText(request);
  const textReplacementLock = [
    title ? `主标题替换为「${title}」` : "删除事实性主标题",
    subtitle ? `副标题替换为「${subtitle}」` : "不编造事实性副标题",
    time ? `活动时间替换为「${time}」` : "不编造日期或时间",
  ].join("；");
  const orientationMigrationRule = manualOrientationMismatch
    ? `用户手动选择的是${sourceOrientation === "Horizontal" ? "横版" : sourceOrientation === "Vertical" ? "竖版" : "其他方向"}参考，但最终画幅严格为 ${request.image_size}（${targetOrientation}）。只迁移参考图的文字视觉系统、信息比例、相互位置、对齐轴、组合轮廓和阅读顺序，并在目标画幅中等比例自适应重排；不得改变输出尺寸，也不得机械复制源画幅坐标。`
    : "";
  return [
    "【整合版式最终执行锁（优先级高于风格、元素、角色与前文概括）】",
    `图 ${referenceIndex + 1}（${reference.number}）是文字视觉系统和整张KV区域布局的唯一依据。样式优先级高于文字内容；不得因为主体、风格或其他参考图改变文字组整体中心、信息比例、装饰关系、时间位置或对齐轴。`,
    `${textReplacementLock}。严格继承参考图各信息角色的字形气质、字号比例、位置、行数、间距、对齐轴和组合轮廓。${INTEGRATED_LAYOUT_DECORATION_RULE}。`,
    integratedLayoutDecorativeCopyContext(request),
    orientationMigrationRule,
    "根据本次主标题长度和参考图的内容适配规则决定左对齐、居中、右对齐或自由组合；保持参考图的视觉中心和文字组外轮廓，禁止默认套用左对齐。",
    ...zoneLines,
    ...alignmentLines,
    visualArea ? `主视觉生成区：${visualArea}。主体和高密度场景必须位于此区域，不得侵入上方文字安全区。` : "",
    manualOrientationMismatch
      ? "上述相对比例、对齐关系和阅读顺序是硬约束。风格参考只控制渲染、材质、光影和完成度；元素和角色参考只控制造型，都不得改写本版式锁。"
      : "上述坐标是归一化画布坐标，是硬约束而非可选建议。风格参考只控制渲染、材质、光影和完成度；元素和角色参考只控制造型，都不得改写本版式锁。",
  ].filter(Boolean).join("\n");
}

function enforceIntegratedLayoutConstraint(prompt, request, selected = []) {
  const constraint = integratedLayoutConstraint(request, selected);
  const source = textOf(prompt).trim();
  if (!constraint || source.includes("【整合版式最终执行锁")) return source;
  if (source.includes("九、禁止项")) {
    return source.replace("九、禁止项", `${constraint}\n\n九、禁止项`);
  }
  return `${source}\n\n${constraint}`.trim();
}

function uploadedSubjectConstraint(request, selected = []) {
  const subjects = selected
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.source === "用户上传" && item.role === "主体");
  if (!subjects.length) return "";
  const lines = subjects.map(({ item, index }) => {
    const kind = item.subject_kind || "对象";
    const uploadLabel = item.label ? `@${item.label}` : `@图${index + 1}`;
    return `图 ${index + 1}（${item.number}，${uploadLabel}）是不可替换的${kind}身份来源：最终画面必须出现图中同一${kind}，保持真实品类、轮廓、结构部件、整体比例、材质和可见识别特征。只允许改变摆放角度、背景、承载台、光影与构图，不得把它改成或替换为另一种对象。`;
  });
  return [
    "【用户上传主体最终执行锁（最高优先级）】",
    ...lines,
    "不得根据营销主题、创意方案、风格参考、元素参考或语言模型推断另一种主体；禁止用任何同类或异类对象替换上传对象，禁止另造产品抢占主体。",
    "用户描述中的色彩、背景、毛毡/布艺造型、承载台和摄影风格只用于搭建上传主体周围的场景，不得改变主体身份。若前文任何一句与本锁冲突，以本锁为准并忽略冲突内容。",
  ].join("\n");
}

function enforceUploadedSubjectConstraint(prompt, request, selected = []) {
  const constraint = uploadedSubjectConstraint(request, selected);
  const source = textOf(prompt).trim();
  if (!constraint || source.includes("【用户上传主体最终执行锁")) return source;
  if (source.includes("九、禁止项")) {
    return source.replace("九、禁止项", `${constraint}\n\n九、禁止项`);
  }
  return `${source}\n\n${constraint}`.trim();
}

function buildFinalPrompt(request, design, selected) {
  const refs = selected.length
    ? selected.map((item, index) => referenceInstruction(item, index, request)).join("\n")
    : "本次未使用预设参考图，也未传入用户上传参考图；仅根据用户输入、Brief理解和设计判断生成结构化 Prompt。";
  const campaignTime = campaignTimeText(request);
  const campaignSubtitle = campaignSubtitleText(request);
  const titleText = titleTimeText(request);
  const titleColorRule = hasMainTitle(request)
    ? "主标题颜色规则：整合版式参考控制文字视觉系统与版式关系，但不控制本次文字颜色；主标题颜色根据本次整体视觉方向、画面背景对比和可读性重新确定。"
    : "";
  const titleGroupColorRule = hasMainTitle(request) && (campaignSubtitle || campaignTime)
    ? "标题组颜色规则：副标题和活动时间与主标题使用同一颜色系统；整合版式参考不得覆盖这条规则。"
    : "";
  const integratedTypography = integratedLayoutTypographyDirective(request, selected);
  const hasIntegratedLayout = selected.some((item) => (item.role || item.type) === "整合版式");
  const decorativeTextPolicy = hasIntegratedLayout
    ? `${INTEGRATED_LAYOUT_DECORATION_RULE}。${integratedLayoutDecorativeCopyContext(request)}`
    : "不要自动新增未提及的标题、副标题、辅助文案、品牌信息、英文、日期、价格、标签、版权信息或说明文字。";
  const uploadedRefs = selected.filter((item) => item.source === "用户上传");
  const uploadedSubjectNote = uploadedRefs.length
    ? `用户上传参考图约束：${uploadedRefs.map((item) => `${item.number} ${item.Reference}`).join("；")}`
    : "";
  const uploadedPersonSubject = /主体人物|人物为核心|这个人物|用户上传图中的人物/.test(uploadedSubjectNote);
  const petEnabled = Boolean(design.pet_character_style_constraint?.enabled);
  const petBlock = petEnabled ? `\n\n${petCharacterBlock(design.pet_character_style_constraint)}` : "";
  const petNegative = petEnabled ? `\n${petNegativeText(design.pet_character_style_constraint)}，不要过度拟真。` : "";
  const scrapbookEnabled = design.preset_id === SCRAPBOOK_PRESET.preset_id;
  const scrapbookBlock = scrapbookEnabled
    ? "\n\n【手帐拼贴页面约束】\n本次画面不是一个完整写实场景，而是一页被精心编排过的手帐 / 笔记页 / 灵感页。画面必须以一张主底纸或大背景纸为承载面，标题是第一视觉信息，中部设置一个主模块，周围分布2-5个辅助模块。模块之间通过胶带、线条、图钉、标签、票据、便签、贴纸、回形针、印章、箭头或圈画产生连接。允许照片、截图、插画、裁切图、票据、小物件混搭，但必须有主次和浏览路径，不能变成整齐PPT排版或普通UI界面。"
    : "";
  const scrapbookNegative = scrapbookEnabled
    ? "\n不要生成完整写实场景，不要做成纯排版海报，不要做成纯插画海报，不要做成整齐PPT或UI界面，不要无意义堆满贴纸，不要让所有模块同级。"
    : "";
  const y3kEnabled = design.preset_id === Y3K_PRESET.preset_id;
  const y3kBlock = y3kEnabled
    ? "\n\n【Y3K人物穿搭与数字编辑约束】\n本次画面必须像未来时尚杂志封面 + 穿搭拆解图 + 数字档案界面。人物必须是第一主体，服装、配饰、姿态和穿搭亮点是视觉重点。至少突出2-3个穿搭亮点，并用细线标注或局部特写框展示。标题必须具备银色金属锐利、切割、高光反射和未来时尚杂志气质。可使用搜索框、品牌胶囊、数据框、编号、条形码、坐标、扫描线等信息模块，但不得生成真实平台logo、真实品牌logo或无来源账号。"
    : "";
  const y3kNegative = y3kEnabled
    ? "\n不要普通自拍感，不要生活照随拍感，不要过度甜美可爱，不要传统韩系写真，不要普通电商模特图，不要朴素穿搭，不要自然光生活照，不要普通证件照。"
    : "";
  const handDrawnEnabled = design.preset_id === HAND_DRAWN_PRESET.preset_id;
  const handDrawnBlock = handDrawnEnabled
    ? "\n\n【手绘扁平涂鸦风格约束】\n本次画面必须是手绘扁平涂鸦 / flat doodle / playful illustration 风格。画面要有明显留白，不做过多细碎内容；只保留一个核心主体或一组核心互动关系，辅助元素控制在2-5个以内。使用粗线条、手写涂鸦感、明快色块、低复杂度背景和轻松幽默的社交传播海报气质。严禁增加无关文字信息；如果用户提到时间，时间必须和标题字体做在一块儿，作为标题组的一部分。"
    : "";
  const handDrawnNegative = handDrawnEnabled
    ? "\n不要写实摄影，不要复杂3D渲染，不要厚重材质，不要复杂远景，不要铺满细碎装饰，不要自动新增英文、口号、日期、价格、标签或说明文字。"
    : "";
  const minimalFlatEnabled = design.preset_id === MINIMAL_FLAT_PRESET.preset_id;
  const minimalFlatBlock = minimalFlatEnabled
    ? "\n\n【极简扁平插画风格约束】\n使用平面色块、简洁轮廓、低复杂度构图与大面积留白；如包含猫狗等宠物，统一表现为扁平卡通宠物IP/品牌吉祥物/贴纸角色：圆润简化、几何化造型、极简五官、符号化表情、干净轮廓与纯净色块。"
    : "";
  const minimalFlatNegative = minimalFlatEnabled
    ? "\n极简扁平插画禁止项：禁止写实摄影、宠物摄影、真实猫狗比例、真实毛发细节、复杂毛流、真实眼球高光、真实鼻子皮肤纹理、真实动物解剖结构、照片级质感、复杂3D渲染、厚重材质、拥挤场景和细碎装饰。"
    : "";
  const realProductEnabled = design.preset_id === REAL_PRODUCT_PRESET.preset_id;
  const realProductBlock = realProductEnabled
    ? "\n\n【实景商品主视觉约束】\n商品是画面的第一视觉焦点，一个画面只设置一个主焦点。主商品保持完整、清晰、结构可信，建议占有效画面面积30%-65%；多商品时按主商品、次商品、功能道具、氛围元素建立明确层级。场景、人物局部和道具只能解释商品的功能、使用方式、季节或情绪，不得与商品争夺注意力。采用写实商业摄影、写实3D或摄影CG合成质感，统一光源方向、色温、阴影软硬和景深。使用一组主色、一组辅助色和少量强调色，使商品与背景清晰分离；每张图只使用1-2种尺度、镜头、动势、材质或冷暖冲击手段。"
    : "";
  const realProductNegative = realProductEnabled
    ? "\n实景商品禁止项：禁止商品缩小为普通道具，禁止多个同权重视觉中心，禁止无目的堆叠装饰，禁止商品与背景粘连，禁止破坏商品真实结构、比例、接口、屏幕、镜头、包装、品牌识别和核心功能部位，禁止人物、手部、文字或道具遮挡商品卖点。"
    : "";
  const realPersonEnabled = design.preset_id === REAL_PERSON_PRESET.preset_id;
  const realPersonBlock = realPersonEnabled
    ? "\n\n【真实人物主视觉约束】\n人物是第一视觉中心，保持真实人体比例、完整肢体、稳定身份、五官结构、发型和主要服装。如用户上传人物主体图，该图是人物身份与外观的最高优先级事实来源；风格参考图只控制摄影方式、光影、色彩、材质与商业完成度，不得替换人物。人物动作需与主题场景形成明确关系，人物与背景使用统一光源、色温、阴影和景深；不得遮挡人物面部、手部、身体轮廓和服装关键部位。"
    : "";
  const realPersonNegative = realPersonEnabled
    ? "\n真实人物禁止项：禁止替换用户上传人物，禁止人物身份漂移，禁止擅改脸型、五官、发型或主要服装，禁止肢体缺失、重复、错位和手部错误，禁止过度磨皮、塑料皮肤以及人物与背景光影不一致。"
    : "";
  const threeDPersonEnabled = Boolean(design.three_d_person_perspective_constraint?.enabled);
  const threeDPersonDecision = threeDPersonEnabled ? design.three_d_person_perspective_constraint : null;
  const threeDPersonBlock = threeDPersonEnabled ? `\n\n${threeDPersonPerspectiveBlock(threeDPersonDecision)}` : "";
  const threeDPersonNegative = threeDPersonEnabled
    ? "\n3D人物大透视禁止项：禁止普通正面视角，禁止普通站立、端坐、普通跑步，禁止真实人体比例，禁止前景缺少巨大锚点，禁止人物五官复杂写实，禁止背景堆砌抢主体。"
    : "";
  const doudouEnabled = isDoudouEnabled(request);
  const doudouRoleValue = doudouRole(request);
  const doudouBlock = doudouEnabled
    ? `\n\n【兜兜IP角色约束】\n本次用户已选择「兜兜IP」，最终画面中必须出现兜兜。兜兜需要严格参考传入的兜兜IP参考图，保持红色购物袋/袋形IP主体、圆润可爱比例、短腿站姿、彩色提手或装饰等核心识别；兜兜没有人类手、手掌、手臂、胳膊或嘴巴，只能通过袋身、眼睛、腿脚、提手、身体倾斜、道具关系和位置关系表现动作与情绪。角色定位：${doudouRoleValue === "主体角色" ? "兜兜是主视觉主体，占据明确视觉中心。" : "兜兜是辅助角色，不抢走用户描述中的主视觉主体，并与主体和场景自然呼应。"}`
    : "";
  const doudouNegative = doudouEnabled
    ? "\n兜兜IP禁止项：禁止遗漏兜兜；禁止给兜兜生成手、手掌、手臂、胳膊、手指、嘴、嘴唇、牙齿、舌头或任何口部结构；禁止替换为其他角色。"
    : "";
  const subjectIsPerson = realPersonEnabled || threeDPersonEnabled || y3kEnabled || /人物|真人|模特|女生|女孩|男生|男孩|小女孩|小男孩|人像|手持|这个人物/.test(`${design.main_visual_subject} ${request.visual_description} ${uploadedSubjectNote}`);
  const subjectIsProduct = !uploadedPersonSubject && /产品|商品|包装|杯|瓶|罐|盒|设备|手机|耳机|手表|相机|家电|器具/.test(`${design.main_visual_subject} ${request.visual_description}`);
  const overlayInformation = [
    request.include_logo ? "左上角真实Logo由系统后处理叠加；模型只需保持自然、干净、低复杂度背景，不绘制任何安全区、占位或提示。" : "",
    request.include_search_overlay ? "右下角真实搜索框由系统后处理叠加；模型只需保持自然、干净、低复杂度背景，不绘制任何占位或提示。" : "",
  ].filter(Boolean).join("\n");

  return `一、参考图说明：
${refs}
注意：图的命名和顺序要和传入大模型的参考图对应。

二、整体视觉方向
整体风格关键词：${design.visual_keywords || design.visual_direction || "商业海报、电商活动、信息清晰、主体明确"}
整体色彩方向：${design.color_direction || design.color_strategy || "从用户画面描述中提取主色，保持统一干净"}
背景氛围：${design.background_atmosphere || "与活动主题相关的统一商业场景"}
材质关键词：${design.material_keywords || "真实材质、商业摄影质感、清晰体积"}
光影关键词：${design.lighting_keywords || "商业棚拍柔光、主体清晰、统一光源"}
整体视觉需要统一、干净、具有商业海报感。画面要有留白，不做过多细碎内容。避免背景杂乱、色彩脏乱或混浊、风格不统一、廉价拼贴感、低清晰度、低质感、草图感、随意拼图感和高饱和混乱配色。
${petBlock}${scrapbookBlock}${y3kBlock}${handDrawnBlock}${minimalFlatBlock}${realProductBlock}${realPersonBlock}${threeDPersonBlock}${doudouBlock}

三、空间、透视与构图规则
标题区域位置：${design.integrated_layout_reference ? "严格参考已选整合版式图中的文字区域、对齐方式和安全区" : "与主视觉主体分区明确，优先放在主体另一侧的信息区"}。
整体构图方式：${design.layout_outline || design.spatial_strategy || "左文右图或右侧主体左侧标题，保持清晰分区"}
透视方式：${design.camera_strategy || "商业摄影平视到轻微俯视，近大远小关系稳定"}
主体区域位置：${design.main_visual_subject || "主视觉主体"}放在画面一侧或中央偏一侧，避开标题信息区。
前中后景层次要求：有前景主体，中景标题信息区，远景背景氛围；层次清楚，不拥堵。
标题文字与信息区属于独立二维信息层，不要求处于画面场景空间中，不受画面透视、地面关系和环境光源影响；文字视觉系统与信息关系遵循整合版式参考。参考图中的白色或空白区域是主视觉生成区域，不是固定白底，也不限制本次画面的背景颜色、材质和场景。
主体、产品、道具、装饰元素需保持画面关系自然，透视、投影、光源方向和遮挡关系一致；近景、中景、远景层次清楚；不要出现贴图拼贴感或多个消失点导致的混乱透视。
${overlayInformation}

四、主视觉主体设定
主视觉主体：${design.main_visual_subject || "与活动主题直接相关的核心主体"}
${uploadedSubjectNote ? `${uploadedSubjectNote}\n` : ""}主体来源要求：如果用户在描述中用「@这张图」指定主体，则主视觉主体必须以用户上传参考图为依据，不得擅自替换。
${doudouEnabled ? `兜兜角色要求：${doudouRoleValue === "主体角色" ? "兜兜是本次主视觉主体，必须成为核心视觉焦点。" : "兜兜是本次辅助角色，必须出现并与主视觉主体/场景动作呼应，但不得抢占第一视觉。"}\n` : ""}主体外观要求：${petEnabled ? minimalFlatEnabled ? "宠物主体必须为极简扁平卡通宠物IP/品牌吉祥物/贴纸角色；圆润简化、几何化造型、极简五官、符号化表情、干净轮廓与纯净色块，不使用写实动物比例、真实毛发和宠物摄影感。" : "宠物主体必须为抽象变形的设计化IP造型、潮玩公仔/软胶玩具质感、品牌吉祥物感；不使用写实动物比例、真实毛发和宠物摄影感。" : y3kEnabled ? "人物主体必须具备Y3K未来时尚、高级时尚大片、金属服饰与锐利姿态；如果用户未上传人物图，可生成虚构时尚人物，但不要指向真实名人。" : "真实材质、商业级完成度、立体感强、体积感清晰、边缘清楚。"}
主体大小占比：${design.subject_size_ratio || "占画面35%-50%的视觉面积"}
主体与其他元素关系：${design.subject_relationship || "主体为第一视觉中心，其他元素围绕主体和主题服务"}
${subjectIsPerson ? "如果主体是人物，需要增加的人物要求：动作姿态符合当前风格设定，人物结构稳定，禁止畸形、肢体错位、手部错误和面部崩坏。" : doudouEnabled ? "如本项目不涉及人物，除兜兜IP外，禁止自动生成真人、人物、手部、面部或其他无关角色。" : "如本项目不涉及人物，禁止自动生成真人、人物、手部、面部或无关角色。"}
${subjectIsProduct ? "如果主体是产品，需要增加的产品要求：产品结构准确、比例合理、材质清晰、不得生成错误品牌或错误logo。" : "如本项目不涉及产品，禁止自动新增无关产品或品牌元素。"}
主体必须清晰、稳定、有视觉聚焦能力，不能淹没在背景里，也不能被装饰元素抢走视觉中心。

五、辅助元素与画面内容
允许出现的辅助元素：仅允许与「${request.visual_description}」直接相关的场景、道具、装饰元素。
辅助元素的作用：强化活动氛围、补充空间层次、引导视线到主体和标题。
辅助元素排列方式：沿画面透视关系或主体周围自然排布，密度克制，不抢主体。
允许适当变化的部分：背景层次、辅助元素密度、光影强弱、主体前后关系可以适当变化，但不得改变活动名称。
画面扩写要求：主体：${design.subject_expansion?.subject || "以用户画面描述中的核心对象为准"}；前景：${design.subject_expansion?.foreground || "少量主题相关辅助道具"}；中景：${design.subject_expansion?.midground || "主视觉主体稳定清晰"}；远景：${design.subject_expansion?.background || "背景简洁弱化"}；道具：${design.subject_expansion?.props || "只出现与主题直接相关的道具"}；情绪：${design.subject_expansion?.emotion || "贴合用户描述的活动情绪"}；信息区关系：${design.subject_expansion?.information_area || "标题区独立清晰，不被主体遮挡"}。
辅助元素只能服务于主体和主题，不得喧宾夺主。避免画面拥堵、比例混乱、元素漂浮、风格不统一以及无关道具、人物或品牌。

六、标题文字与信息层级
${integratedTypography}
主/副标题文字：${titleText || "用户未提供主标题，不生成标题文字"}
${campaignSubtitle ? subtitlePromptRule(request) : ""}
活动时间：${campaignTime ? `用户已提供活动时间「${campaignTime}」，必须准确出现；按整合版式参考中的时间信息槽位、比例、位置和对齐关系呈现，层级低于主标题；活动时间与主标题使用同一颜色系统。` : "用户未提供活动时间，删除参考图中的日期槽位，禁止自动新增日期、时间、周期或倒计时信息。"}
${titleColorRule}
${titleGroupColorRule}
信息层级要求：${titleText ? `主标题最大；${campaignSubtitle ? "副标题次于主标题；" : ""}${campaignTime ? "活动时间次于主标题；" : ""}标题区域独立清晰。` : "不创建标题信息层。"}
${decorativeTextPolicy}
标题区域必须清晰、独立、可读，不被主体和装饰元素遮挡。禁止错字、漏字、乱码和无关英文。

九、禁止项
禁止自动新增清单外道具、景物、品牌、人物或无关元素。
${request.include_logo ? "禁止在左上角生成辅助标记、蒙版、提示文字、说明文字或模型自造logo；左上角只保持自然干净背景。" : ""}
${request.include_search_overlay ? "禁止在右下角绘制占位框、提示文字或模型自造搜索框；右下角只保持自然干净背景。" : ""}
${doudouEnabled ? "除兜兜IP外，如本项目不涉及人物，禁止自动生成真人、人物、手部、面部或其他无关角色。" : "如本项目不涉及人物，禁止自动生成真人、人物、手部、面部或无关角色。"}
如本项目主体为人物，则禁止人物动作变形、手部畸形和五官崩坏。
禁止多透视拼贴、素材贴图感、元素漂浮、地面关系错误。
禁止背景杂乱、高饱和混乱配色和低完成度质感。
${petNegative}${scrapbookNegative}${y3kNegative}${handDrawnNegative}${minimalFlatNegative}${realProductNegative}${realPersonNegative}${threeDPersonNegative}${doudouNegative}
如本项目涉及产品，禁止产品结构错误、产品样式跑偏和产品logo错误。如本项目不涉及产品，则禁止自动新增无关产品或品牌元素。
禁止标题乱码、错字、错误替换和无关文字。
禁止非本项目指定的辅助元素喧宾夺主。
${hasIntegratedLayout ? "禁止添加整合版式参考中不存在的额外文字槽位或装饰结构；除用户明确填写的主标题、副标题和活动时间外，删除参考图中的全部可读文字，禁止保留、改写或补写；禁止自行增加参考图中不存在的下划线、引号、括号、框线、标签、角标、强调线或其他装饰笔画。" : "禁止自动添加任何没有提及的其他文字。"}
禁止固定图层错误、文字错误、风格跑偏、主体识别度弱、空间透视错误、杂乱拼贴感、背景脏乱、材质粗糙、清晰度不足，以及与参考图用途不符的误参考。

最终画幅：${request.image_size}。`;
}

async function fetchImageBytes(selected) {
  return Promise.all(
    selected.map(async (item, index) => {
      const role = item.role || item.type || "参考";
      const roleSlug = {
        "整合版式": "integrated-layout",
        "字体": "font",
        "日期": "date",
        "排版": "layout",
        "构图": "layout",
        "风格": "style",
        "元素": "element",
        "角色": "character",
        "主体": "subject",
      }[role] || (item.source === "兜兜IP" ? "doudou" : "reference");
      const sequence = String(index + 1).padStart(2, "0");
      const objectKey = textOf(item.object_key || "").trim();
      if (objectKey) {
        try {
          const bytes = await storageGet(objectKey);
          const extension = path.extname(objectKey).toLowerCase();
          return {
            item,
            bytes,
            filename: `${sequence}-${roleSlug}-${safeSlug(item.number, "reference")}${extension || ".png"}`,
            type: MIME[extension] || "image/png",
          };
        } catch (error) {
          throw new Error(`素材 ${item.number} 图片读取失败（${objectKey}）：${error.message}`);
        }
      }
      const source = textOf(item.local_image || item.image_url || item.image || "").trim();
      try {
        const resolved = await resolveImageBytes(source, {
          roots: imageSourceRoots(),
          deploymentBaseUrl: vercelDeploymentBaseUrl(),
        });
        return {
          item,
          bytes: resolved.bytes,
          filename: `${sequence}-${roleSlug}-${safeSlug(item.number, "reference")}${extensionForType(resolved.type)}`,
          type: resolved.type,
        };
      } catch (error) {
        if (IS_OSS && source.startsWith("/uploads/") && error instanceof ImageSourceError) {
          try {
            const bytes = await storageGet(source.slice(1));
            const extension = path.extname(source).toLowerCase();
            return {
              item,
              bytes,
              filename: `${sequence}-${roleSlug}-${safeSlug(item.number, "reference")}${extension || ".png"}`,
              type: MIME[extension] || "image/png",
            };
          } catch (storageError) {
            throw new Error(`素材 ${item.number} 图片读取失败：${storageError.message}`);
          }
        }
        if (error instanceof ImageSourceError) {
          throw new Error(`素材 ${item.number} 图片解析失败：${error.message}`);
        }
        throw error;
      }
    }),
  );
}

function pngSize(filePath) {
  try {
    const buffer = readFileSync(filePath);
    if (buffer.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function imageEditSizeForFile(filePath, fallback = "1024x1024") {
  const size = pngSize(filePath);
  return size?.width && size?.height ? `${size.width}x${size.height}` : fallback;
}

function outputReference(url, number, description, localImage = url, objectKey = "") {
  return {
    type: "生成资产",
    source: "生成资产",
    role: "生成资产",
    number,
    label: number,
    Reference: description,
    reason: description,
    image: url,
    local_image: localImage,
    image_url: "",
    object_key: objectKey,
    description,
  };
}

async function generateImageEditFile({
  prompt,
  selected,
  size,
  prefix,
  applyOverlay = false,
  overlayRequest = {},
  keepTemp = false,
}) {
  if (!OPENAI_API_KEY) {
    return { skipped: true, reason: "缺少 OPENAI_API_KEY，无法调用 OpenAI API。" };
  }
  if (!selected.length) {
    return { skipped: true, reason: "缺少参考图，无法进行图生图。" };
  }

  const images = await fetchImageBytes(selected);
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", size || "1024x1024");
  form.append("quality", "medium");
  form.append("output_format", "png");

  for (const image of images) {
    form.append("image[]", new Blob([image.bytes], { type: image.type }), image.filename);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `OpenAI Images API 请求失败：${response.status}`;
    throw new Error(message);
  }

  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw new Error("Images API 没有返回 b64_json");
  const filename = `${prefix || "asset"}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`;
  const key = outputKey(filename);
  if (IS_OSS) {
    const tempPath = path.join(RUNTIME_ROOT, "tmp", filename);
    await mkdir(path.dirname(tempPath), { recursive: true });
    await writeFile(tempPath, Buffer.from(b64, "base64"));
    const brandOverlay = applyOverlay ? await applyLogoOverlay(tempPath, overlayRequest) : null;
    const finalBytes = await readFile(tempPath);
    await storagePut(key, finalBytes, { contentType: "image/png" });
    if (!keepTemp) await unlink(tempPath).catch(() => {});
    return {
      skipped: false,
      name: filename,
      url: storageSignUrl(key),
      object_key: key,
      output_path: "",
      temp_path: keepTemp ? tempPath : "",
      size: size || "1024x1024",
      prompt,
      reference_images: selected.map((item) => item.number),
      logo_overlay: brandOverlay?.logo_overlay || null,
      search_overlay: brandOverlay?.search_overlay || null,
    };
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, filename);
  await writeFile(outputPath, Buffer.from(b64, "base64"));
  const brandOverlay = applyOverlay ? await applyLogoOverlay(outputPath, overlayRequest) : null;
  const searchOverlay = brandOverlay?.search_overlay || null;
  const logoOverlay = brandOverlay?.logo_overlay || null;
  return {
    skipped: false,
    name: filename,
    url: `/outputs/${filename}`,
    object_key: key,
    output_path: outputPath,
    temp_path: "",
    size: size || "1024x1024",
    prompt,
    reference_images: selected.map((item) => item.number),
    logo_overlay: logoOverlay,
    search_overlay: searchOverlay,
  };
}

async function makeTitleTransparent(sourcePath) {
  const ext = path.extname(sourcePath) || ".png";
  const targetPath = sourcePath.replace(new RegExp(`${ext.replace(".", "\\.")}$`), `-transparent${ext}`);
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [path.join(__dirname, "tools", "make_title_transparent.py"), sourcePath, targetPath], { cwd: __dirname });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `标题图透明化失败：${code}`));
        return;
      }
      resolve(targetPath);
    });
  });
}

function integratedLayoutReference(selected = []) {
  return selected.find((item) => (item.role || item.type) === "整合版式") || null;
}

function hasVisibleTypography(request = {}) {
  return Boolean(
    textOf(request.campaign_name).trim()
    || campaignSubtitleText(request)
    || campaignTimeText(request),
  );
}

function publicImageLayer(result = {}) {
  if (!result || result.skipped) return result;
  const {
    output_path,
    transparent_path,
    raw_output_path,
    prompt,
    temp_path,
    ...publicResult
  } = result;
  return publicResult;
}

function compactValue(value, limit = 220) {
  const normalized = textOf(value).replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function compactDesignLines(design = {}) {
  return [
    ["主体", design.main_visual_subject],
    ["主体关系", design.subject_relationship],
    ["视觉", design.visual_keywords || design.visual_direction],
    ["色彩", design.color_direction || design.color_strategy],
    ["背景", design.background_atmosphere],
    ["材质", design.material_keywords],
    ["光影", design.lighting_keywords],
    ["镜头", design.camera_strategy],
  ]
    .filter(([, value]) => compactValue(value))
    .map(([label, value]) => `${label}：${compactValue(value)}`);
}

function compactReferenceLines(selected = [], startIndex = 1) {
  return selected.map((item, index) => {
    const role = textOf(item.role || item.type || "参考图").trim();
    const useFor = compactValue(item.selection_use_for || item.reason || item.Reference || item.description, 120);
    return `图 ${startIndex + index}（${item.number}）：仅参考${role}${useFor ? `，用于${useFor}` : ""}。`;
  });
}

function buildTypographyLayerPrompt(request, integratedReference, correction = "") {
  const title = textOf(request.campaign_name).trim();
  const subtitle = campaignSubtitleText(request);
  const time = campaignTimeText(request);
  const allowedText = [
    title ? `主标题「${title}」` : "",
    subtitle ? `副标题「${subtitle}」` : "",
    time ? `活动时间「${time}」` : "",
  ].filter(Boolean);
  const replacements = [
    title ? `主标题改为「${title}」` : "删除主标题槽位",
    subtitle ? `副标题改为「${subtitle}」` : "删除全部副标题、说明、口号、英文眉题和装饰文案槽位",
    time ? `活动时间改为「${time}」` : "删除全部日期、时间、年份、周期和数字信息槽位",
  ];
  return [
    "任务：生成第一步整合版式图，只参考图 1。",
    `文字替换：${replacements.join("；")}。`,
    allowedText.length
      ? `【可读文字白名单】画面中唯一允许出现的文字是：${allowedText.join("；")}。必须逐字准确；除此之外不得出现任何汉字、字母、数字、符号组合或可读文案。`
      : "【可读文字白名单】为空。删除图 1 中全部可读文字，不得生成任何汉字、字母、数字、符号组合或文案。",
    `【信息槽位数量】本次允许的可读文字信息槽位总数为 ${allowedText.length}。白名单中的每个字段只能出现一次；白名单既约束文字内容，也约束可读信息槽位数量。${allowedText.length === 1 ? "本次最终只能保留一个可读文字信息组，不得保留参考图中的任何其他文字组。" : ""}`,
    "严格继承图 1 中对应信息的字形风格、字号比例、行数、字距、位置、对齐轴、组合轮廓与阅读顺序。",
    "图 1 已有的引号、括号、框线、标签底形、角标底形、分隔线和装饰符号等非文字结构可按原数量与位置保留；其中原有文字必须清空。图 1 没有的结构禁止新增。",
    "白名单之外的参考图原文、装饰文字、英文、品牌、版权、年份、地点、说明和口号必须删除，不能保留、照抄、改写、联想、补全或用近义文案占位；删除后恢复为干净留白。",
    "不要生成场景、人物、产品、道具、Logo、水印或白名单之外的任何参考图文字。",
    "完整保留参考版式中的主画面空白区；该区域只使用干净、低复杂度、无纹理的平整背景，不放置任何主体或场景，供第二步生成主画面。",
    "文字颜色与背景颜色可以根据本次主题建立清晰对比，但不得改变参考图的信息布局、文字视觉系统或装饰结构。",
    correction ? `返修：${compactValue(correction, 320)}` : "",
    integratedReference?.layout_metadata?.adaptation_rules
      ? `长度适配：${compactValue(integratedReference.layout_metadata.adaptation_rules, 240)}；只适用于白名单中的文字，绝不能恢复或生成其他文字槽位。`
      : "",
  ].filter(Boolean).join("\n");
}

function sceneReferences(selected = []) {
  const excludedRoles = new Set(["整合版式", "字体", "日期", "排版", "构图"]);
  return selected.filter((item) => !excludedRoles.has(item.role || item.type));
}

function finalKvReferenceLines(selected = [], startIndex = 2) {
  return selected.map((item, index) => {
    const figure = `图 ${startIndex + index}（${item.number}）`;
    const role = textOf(item.role || item.type || "参考图").trim();
    if (item.source === "用户上传" && role === "主体") {
      return `${figure}为用户主体参考：它是主体身份、外观、结构、比例、材质和识别特征的唯一依据，只允许调整动作、场景、构图与光影，禁止替换成其他对象。`;
    }
    if (item.source === "兜兜IP") {
      return `${figure}为兜兜IP参考：用于保持兜兜的身份、袋身结构、眼睛、提手与腿脚特征，并参考符合场景的动作状态。`;
    }
    if (role === "风格") {
      return `${figure}为风格参考：用于参考主体与场景的视觉风格、色彩调性、材质质感和商业完成度。`;
    }
    if (role === "角色") {
      return `${figure}为角色参考：用于参考主体角色的动作体态、形体比例、造型语言和五官表情。`;
    }
    if (role === "元素") {
      return `${figure}为元素参考：用于参考相关道具与辅助元素的造型、比例、材质和细节处理。`;
    }
    return `${figure}为${role || "画面"}参考：只影响其指定内容，不得改写图 1 的固定版式与文字。`;
  });
}

function buildFinalKvFromTypographyPrompt(request, design, selected = [], correction = "") {
  const referenceLines = finalKvReferenceLines(selected, 2);
  const uploadedSubject = selected.some((item) => item.source === "用户上传" && (item.role || item.type) === "主体");
  const expansion = design.subject_expansion || {};
  const perspective = compactValue(design.camera_strategy || design.spatial_strategy, 180);
  const subjectPosition = compactValue(design.subject_position || design.layout_outline || expansion.midground, 180);
  const layers = compactValue(
    [expansion.foreground, expansion.midground, expansion.background].filter(Boolean).join("；"),
    240,
  );
  const lighting = compactValue(design.lighting_keywords, 160);
  const subject = compactValue(design.main_visual_subject || expansion.subject || request.visual_description, 240);
  const appearance = compactValue(
    [expansion.subject, design.material_keywords, design.visual_keywords || design.visual_direction].filter(Boolean).join("；"),
    260,
  );
  const ratio = compactValue(design.subject_size_ratio, 80);
  const relationship = compactValue(design.subject_relationship, 220);
  const props = compactValue(expansion.props, 200);
  return [
    "一、参考图说明",
    "1. 图 1 是第一步生成的固定信息层参考。只把其中已有的文字、标签、框线、角标、分隔线和装饰符号视为不可变内容，完整复制它们的样式、颜色、大小与位置。图 1 中的白色、纯色或空白背景不属于固定内容，可以重绘为连续的主体、背景与场景。",
    ...referenceLines,
    "二、固定图层与不可变内容",
    "图 1 的信息内容是最高优先级固定前景层：文字、字形、颜色、字号、行数、间距、对齐、位置、标签、框线、角标、分隔线与装饰符号必须原样保留，不得重绘、改写、移动、缩放、遮挡或替换。",
    "【固定说明】完全复制第一步图片中的信息层，禁止改变其颜色、位置和大小，禁止调整成相似元素；不要锁定、复制或保留图 1 的空白底色。主体、背景和场景可以在信息层下方连续铺展。",
    "三、空间、透视与构图规则",
    `最终画幅：${request.image_size || "按用户选择"}。`,
    perspective ? `透视与镜头：${perspective}` : "",
    subjectPosition
      ? `主体区域位置：${subjectPosition}；可进入文字所在的大区域，但必须避开实际字形和固定装饰轮廓。`
      : "主体位置根据全画面视觉重心和实际字形轮廓确定；文字所在的整块矩形区域不是禁区。",
    layers ? `画面层次：${layers}` : "",
    lighting ? `光影：${lighting}` : "",
    "主体、背景与场景应形成一张连续画面，可以延伸到固定文字层下方并与信息区域自然叠合。主体轮廓不得压住实际字形、标签、框线和装饰符号；如发生冲突，应微调主体位置、姿态或比例，而不是把画面切成独立区域。",
    "文字周围使用简洁、低细节、低纹理频率且对比稳定的背景，通过自然光影、景深或色彩渐变柔和过渡，保证文字清晰。除非图 1 本身明确存在实体色块或分隔结构，否则禁止新增白色顶栏、纯色信息板、水平硬边界、矩形蒙版或上下分屏；禁止在文字区边缘截断主体或场景。",
    "四、主体设定",
    `主视觉主体：${subject || "严格依据用户画面描述确定"}。`,
    appearance ? `主体外观与动作：${appearance}` : "",
    ratio ? `主体占比：${ratio}` : "",
    relationship ? `主体与其他元素关系：${relationship}` : "",
    "主体必须清晰、稳定并形成视觉焦点，不能淹没在背景中，也不能被装饰元素抢走视觉中心；主体可以与信息区域空间叠合，但不得遮挡实际文字和固定装饰。",
    uploadedSubject
      ? "用户上传的主体参考是对象身份唯一依据：保留其类别、轮廓、结构、包装比例、材质和可见识别特征，只改变场景、构图与光影，禁止替换成其他对象。"
      : "",
    isDoudouEnabled(request)
      ? "必须出现兜兜IP；兜兜没有手、手掌、手臂、胳膊和嘴巴，只通过眼睛、袋身、提手、腿脚与身体倾斜表达动作。"
      : "",
    "五、辅助元素",
    props ? `允许的辅助元素：${props}` : "只允许加入与主题和主体直接相关的少量辅助元素。",
    "辅助元素只能服务主体与主题，不得喧宾夺主；避免数量过多、比例混乱、漂浮无依附、风格不统一或误加无关道具、人物与品牌。背景、场景道具、图标和小装饰只能弱化呈现。",
    `用户画面描述：${compactValue(request.visual_description, 420)}`,
    "图 2 及后续参考图只控制各自指定的风格、主体、元素或材质，不得改写图 1。禁止新增标题、副标题、日期、英文、数字、标签、价格、Logo、水印、招牌文字、包装新增文字或任何可读字符。",
    correction ? `返修：${compactValue(correction, 320)}` : "",
  ].filter(Boolean).join("\n");
}

function buildCompactOneShotPrompt(request, design, selected = [], correction = "") {
  const title = textOf(request.campaign_name).trim();
  const subtitle = campaignSubtitleText(request);
  const time = campaignTimeText(request);
  const textLine = [
    title ? `主标题「${title}」` : "",
    subtitle ? `副标题「${subtitle}」` : "",
    time ? `时间「${time}」` : "",
  ].filter(Boolean).join("；");
  return [
    "生成一张高完成度商业 KV。",
    ...compactReferenceLines(selected, 1),
    `用户画面描述：${compactValue(request.visual_description, 520)}`,
    ...compactDesignLines(design),
    textLine
      ? `只呈现以下文字：${textLine}；主标题层级最高，副标题和时间次之，禁止新增其他文字。`
      : "画面不包含任何标题、日期或其他文字。",
    selected.some((item) => item.source === "用户上传" && (item.role || item.type) === "主体")
      ? "用户上传主体是对象身份唯一依据，必须保留原对象类别、结构、比例、材质和识别特征，禁止替换。"
      : "",
    correction ? `返修：${compactValue(correction, 320)}` : "",
  ].filter(Boolean).join("\n");
}

function buildCompactExecutionPrompt(request, design, selected = [], correction = "") {
  const integrated = integratedLayoutReference(selected);
  if (!integrated || !hasVisibleTypography(request)) {
    return buildCompactOneShotPrompt(request, design, selected, correction);
  }
  return buildFinalKvFromTypographyPrompt(request, design, sceneReferences(selected), correction);
}

async function generateLayeredImage(request, design, selected, onStage = () => {}, correction = "") {
  const integrated = integratedLayoutReference(selected);
  if (!integrated || !hasVisibleTypography(request)) {
    const prompt = buildCompactOneShotPrompt(request, design, selected, correction);
    const image = await generateImage(request, prompt, selected);
    return { image, prompt, mode: "one-shot" };
  }

  const size = SIZE_MAP[request.image_size] || "1024x1024";
  const typographyPrompt = buildTypographyLayerPrompt(request, integrated, correction);
  onStage("status", { message: "正在生成第一步文字版式图..." });
  const typography = await generateImageEditFile({
    prompt: typographyPrompt,
    selected: [integrated],
    size,
    prefix: "kv-typography",
  });
  if (typography.skipped) {
    return {
      image: typography,
      prompt: buildFinalKvFromTypographyPrompt(request, design, sceneReferences(selected), correction),
      mode: "two-stage-reference",
    };
  }
  onStage("typography", { typography_layer: publicImageLayer(typography) });

  const stageOneReference = outputReference(
    typography.url,
    "STAGE1_FIXED_LAYOUT",
    "第一步生成的固定信息层参考；文字与已有装饰必须原样保留，空白底色不固定，主体与场景可以在信息层下方连续铺展。",
    IS_OSS ? "" : typography.output_path,
    typography.object_key || "",
  );
  const sceneSelected = sceneReferences(selected).slice(0, 9);
  const finalSelected = [stageOneReference, ...sceneSelected];
  const finalPrompt = buildFinalKvFromTypographyPrompt(request, design, sceneSelected, correction);

  onStage("status", { message: "正在以第一步版式图为固定参考生成完整 KV..." });
  const finalImage = await generateImageEditFile({
    prompt: finalPrompt,
    selected: finalSelected,
    size,
    prefix: "kv-two-stage",
    applyOverlay: true,
    overlayRequest: request,
  });
  if (finalImage.skipped) {
    return {
      image: finalImage,
      prompt: finalPrompt,
      mode: "two-stage-reference",
    };
  }
  onStage("scene", { scene_layer: publicImageLayer(finalImage) });

  onStage("compose", { status: "running", message: "正在处理已勾选的品牌固定图层..." });
  const image = {
    skipped: false,
    name: finalImage.name,
    url: finalImage.url,
    object_key: finalImage.object_key || "",
    size,
    reference_images: selected.map((item) => item.number),
    logo_overlay: finalImage.logo_overlay || null,
    search_overlay: finalImage.search_overlay || null,
    generation_mode: "two-stage-reference",
    layers: {
      typography: publicImageLayer(typography),
      scene: publicImageLayer(finalImage),
    },
  };
  onStage("compose", { status: "done", image_result: image });
  return {
    image,
    prompt: finalPrompt,
    mode: "two-stage-reference",
  };
}

async function generateImage(request, prompt, selected) {
  if (!OPENAI_API_KEY) {
    return { skipped: true, reason: "缺少 OPENAI_API_KEY，已跳过最终生图。" };
  }
  if (!selected.length) {
    return { skipped: true, reason: "当前未使用预设且未上传参考图，已跳过图生图；请选择一个风格预设或上传参考图后再生成 KV 图。" };
  }

  const result = await generateImageEditFile({
    prompt,
    selected,
    size: SIZE_MAP[request.image_size] || "1024x1024",
    prefix: "kv",
    applyOverlay: true,
    overlayRequest: request,
  });
  delete result.output_path;
  delete result.prompt;
  return result;
}

function buildTitleExtractionPrompt({ title, subtitle, time }) {
  const textItems = [
    title ? `主标题「${title}」` : "",
    subtitle ? `副标题「${subtitle}」` : "",
    time ? `活动时间「${time}」` : "",
  ].filter(Boolean);
  return [
    "从参考图中提取标题文字层，生成一张可用于设计叠加的标题资产图。",
    textItems.length
      ? `必须只保留${textItems.join("、")}；只在主标题存在时沿用其字体视觉系统和层级关系。尽量保持参考图中这些文字的字形、颜色、笔画纹理、装饰、排版层级和相对位置关系。`
      : "用户未提供主标题、副标题或活动时间；输出不包含任何文字的纯色空白层，不得生成占位标题。",
    "移除所有背景画面、人物、产品、场景、道具、平台 logo、左上角 logo、右下角搜索框和无关文字。",
    "标题必须清晰、完整、无错字、无乱码、无遮挡。",
    "输出为纯白或纯黑背景上的标题图，背景要干净单一，方便后续自动抠成透明 PNG。",
    "不要新增任何参考图里没有的文字，不要改写标题内容。",
  ].join("\n");
}

function buildBackgroundExtractionPrompt({ title, subtitle, time }) {
  const textItems = [
    title ? `主标题「${title}」` : "",
    subtitle ? `副标题「${subtitle}」` : "",
    time ? `活动时间「${time}」` : "",
  ].filter(Boolean);
  return [
    "从参考图中生成一张干净的主画面背景层，用于后续重新叠加标题。",
    `请移除${textItems.length ? `${textItems.join("、")}以及` : ""}所有文字、左上角 logo、右下角搜索框、平台标识、水印和说明文案。`,
    "保留并自然修复原图中的主体、场景、构图、风格、色彩、光影、材质、空间关系和商业海报质感。",
    "被文字遮挡过的区域需要合理补全背景或场景，不要留下涂抹痕迹、空洞、明显修补边界或半透明残影。",
    "不要新增无关人物、产品、品牌、价格、英文、标签或文案。",
    "输出一张没有标题文字的干净背景画面。",
  ].join("\n");
}

async function writeSplitPackage({ source, title, subtitle, time, titleLayer, backgroundLayer }) {
  const filename = `split-package-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.json`;
  const key = outputKey(filename);
  const payload = {
    type: "kv-ai-split-package",
    created_at: new Date().toISOString(),
    source,
    title,
    subtitle,
    time,
    layers: [
      { name: "原始KV", role: "source", url: source.url },
      { name: "标题透明PNG", role: "title-transparent", url: titleLayer.transparent_url || titleLayer.url },
      { name: "标题原图", role: "title-source", url: titleLayer.url },
      { name: "背景画面", role: "background", url: backgroundLayer.url },
    ],
    prompts: {
      title_layer: titleLayer.prompt,
      background_layer: backgroundLayer.prompt,
    },
  };
  const bytes = Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
  if (IS_OSS) {
    await storagePut(key, bytes, { contentType: "application/json" });
    return { name: filename, url: storageSignUrl(key), object_key: key };
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, filename), bytes);
  return { name: filename, url: `/outputs/${filename}`, object_key: key };
}

async function splitAssetLayers({ name, title, subtitle, time }) {
  const source = await outputAssetPathByName(name);
  if (!source) throw new Error("未找到该生成资产");
  const indexedAsset = (await loadAssetsIndex()).find((asset) => asset.name === name);
  const savedSplit = indexedAsset?.split;
  if (savedSplit?.title_layer?.object_key && savedSplit?.background_layer?.object_key) {
    return {
      ok: true,
      reused: true,
      source,
      title_layer: {
        ...savedSplit.title_layer,
        name: savedSplit.title_layer.object_key.split("/").pop(),
        url: storageSignUrl(savedSplit.title_layer.object_key),
        transparent_url: savedSplit.title_layer.transparent_object_key
          ? storageSignUrl(savedSplit.title_layer.transparent_object_key)
          : "",
      },
      background_layer: {
        ...savedSplit.background_layer,
        name: savedSplit.background_layer.object_key.split("/").pop(),
        url: storageSignUrl(savedSplit.background_layer.object_key),
      },
      split_package: savedSplit.split_package?.object_key
        ? {
            ...savedSplit.split_package,
            name: savedSplit.split_package.object_key.split("/").pop(),
            url: storageSignUrl(savedSplit.split_package.object_key),
          }
        : null,
    };
  }
  if (!OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY，无法调用 OpenAI API");

  let sourcePath = source.filePath || "";
  const tempFiles = [];
  if (!sourcePath && source.objectKey) {
    sourcePath = path.join(RUNTIME_ROOT, "tmp", `split-source-${source.name}`);
    tempFiles.push(sourcePath);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, await storageGet(source.objectKey));
  }
  const sourceRef = outputReference(
    source.url,
    "SOURCE_KV",
    "待拆分的完整 KV 图，用于提取标题文字层和干净背景层。",
    sourcePath,
    source.objectKey || "",
  );
  const size = imageEditSizeForFile(sourcePath, "1024x1024");
  const titlePrompt = buildTitleExtractionPrompt({ title, subtitle, time });
  const backgroundPrompt = buildBackgroundExtractionPrompt({ title, subtitle, time });

  const [titleLayer, backgroundLayer] = await Promise.all([
    generateImageEditFile({ prompt: titlePrompt, selected: [sourceRef], size, prefix: "title-extract", applyOverlay: false, keepTemp: IS_OSS }),
    generateImageEditFile({ prompt: backgroundPrompt, selected: [sourceRef], size, prefix: "background-clean", applyOverlay: false, keepTemp: IS_OSS }),
  ]);

  const titleSourcePath = IS_OSS ? titleLayer.temp_path : titleLayer.output_path;
  if (!titleLayer.skipped && titleSourcePath) {
    try {
      const transparentPath = await makeTitleTransparent(titleSourcePath);
      const transparentName = path.basename(transparentPath);
      tempFiles.push(transparentPath);
      titleLayer.transparent_object_key = outputKey(transparentName);
      if (IS_OSS) {
        await storagePut(outputKey(transparentName), await readFile(transparentPath), { contentType: "image/png" });
      }
      titleLayer.transparent_url = storageSignUrl(outputKey(transparentName));
    } catch (error) {
      titleLayer.transparent_warning = error.message;
    }
  }

  const splitPackage = await writeSplitPackage({ source, title, subtitle, time, titleLayer, backgroundLayer });
  await saveAssetSplitRecord(name, { title_layer: titleLayer, background_layer: backgroundLayer, split_package: splitPackage });
  for (const file of tempFiles) await unlink(file).catch(() => {});
  if (IS_OSS) {
    if (titleLayer.temp_path) await unlink(titleLayer.temp_path).catch(() => {});
    if (backgroundLayer.temp_path) await unlink(backgroundLayer.temp_path).catch(() => {});
  }
  const publicTitleLayer = { ...titleLayer };
  const publicBackgroundLayer = { ...backgroundLayer };
  delete publicTitleLayer.output_path;
  delete publicTitleLayer.temp_path;
  delete publicBackgroundLayer.output_path;
  delete publicBackgroundLayer.temp_path;
  return {
    ok: true,
    source,
    title_layer: publicTitleLayer,
    background_layer: publicBackgroundLayer,
    split_package: splitPackage,
  };
}

async function runPipeline(request, onStage = () => {}) {
  const pipelineStartedAt = Date.now();
  const stageTimings = {};
  const measure = async (stage, task) => {
    const startedAt = Date.now();
    try {
      return await task();
    } finally {
      const durationMs = Date.now() - startedAt;
      stageTimings[stage] = (stageTimings[stage] || 0) + durationMs;
      onStage("timing", { stage, duration_ms: durationMs, total_stage_ms: stageTimings[stage] });
    }
  };
  const [briefSystem, designSystem] = await measure("bootstrap", () => Promise.all([
    readFile(BRIEF_PROMPT_URL, "utf-8"),
    readFile(DESIGN_PROMPT_URL, "utf-8"),
  ]));
  const activePreset = presetForRequest(request);
  const knowledge = productionKnowledgeForRequest(request, activePreset);
  const warnings = [];
  let fallback = false;

  onStage("status", { message: ENABLE_BRIEF_LLM ? "正在理解 Brief..." : "正在快速整理 Brief..." });
  let brief = localBrief(request);
  if (ENABLE_BRIEF_LLM) {
    try {
      brief = await measure("brief_llm", () => callResponses({
        system: briefSystem,
        user: `请根据以下营销活动字段输出 JSON。campaign_subtitle 是用户显式填写的副标题，campaign_time 是用户显式填写的活动时间，允许使用；不要推断不存在的副标题、品牌、价格、人群、未提供的活动时间或额外营销目标：\n${JSON.stringify(request, null, 2)}`,
        expectJson: true,
      }));
    } catch (error) {
      fallback = true;
      warnings.push({ stage: "brief", message: error.message });
      brief = localBrief(request);
    }
  } else {
    stageTimings.brief_local = 0;
  }
  onStage("brief", { brief });

  onStage("status", { message: "正在拆解约束并生成 3 个创意方向..." });
  let creativePlan;
  try {
    creativePlan = await measure("creative_direction", () => generateCreativePlan(request, brief, activePreset, knowledge));
  } catch (error) {
    fallback = true;
    warnings.push({ stage: "creative", message: error.message });
    creativePlan = localCreativePlan(request, brief, knowledge, activePreset);
  }
  onStage("creative", { creative_plan: creativePlan });

  const referencePreset = activePreset;
  onStage("status", { message: activePreset ? "正在依据选定创意语义匹配整合版式、风格、元素与角色参考..." : "当前未使用风格预设，不匹配预设参考图。" });
  const selectedPresetVariant = referencePreset
    ? await measure("reference_matching", async () => {
      if (presetReferenceGroups(referencePreset).length) {
        return chooseProductionPresetVariant(referencePreset, request, creativePlan);
      }
      return choosePresetVariant(referencePreset, request);
    })
    : null;
  const presetReferences = referencePreset
    ? referencesForRequest(request, buildPresetReferences(selectedPresetVariant, referencePreset))
    : [];
  onStage("references", {
    selected_references: presetReferences,
    selection_method: selectedPresetVariant?.selection_method || (activePreset ? "preset-variant" : "none"),
    candidate_audit: selectedPresetVariant?.candidate_audit || [],
  });

  const petEnabled = Boolean(petConstraint(activePreset).enabled && hasPetIntent(request));
  const y3kEnabled = activePreset?.preset_id === Y3K_PRESET.preset_id;
  const threeDPersonEnabled = THREE_D_PERSON_PERSPECTIVE_CONSTRAINT.enabled
    && activePreset?.preset_id === THREE_D_PRESET_ID
    && hasPersonIntent(request);
  const realPersonEnabled = activePreset?.preset_id === REAL_PERSON_PRESET.preset_id;
  const doudouEnabled = isDoudouEnabled(request);
  const threeDPersonDesignInstruction = threeDPersonEnabled
    ? `本次为3D风格且主视觉主体涉及人物，设计判断必须执行：${threeDPersonPerspectiveBlock(threeDPersonPerspectiveDecision(request))}`
    : "";
  const realPersonDesignInstruction = realPersonEnabled
    ? "本次为真实人物预设：人物必须是第一视觉中心，保持真实人体比例、完整肢体、稳定身份、五官结构、发型和主要服装；如存在用户上传主体图，该上传图是人物身份和外观的最高优先级事实来源。风格参考只用于摄影方式、光影、色彩、材质与商业完成度，不得把风格图中的人物身份、脸部、发型或服装带入结果。"
    : "";
  const doudouDesignInstruction = doudouEnabled
    ? `${doudouRolePrompt(request)} 兜兜没有手、手掌、手臂、胳膊或嘴巴，只能通过袋身、眼睛、腿脚、提手、身体倾斜和道具关系表现动作与情绪。`
    : "";
  const uploadedReferences = referencesForRequest(request, (request.uploaded_references || []).map((url, index) => buildUploadedReference(url, request, index)));
  let initialDesign = buildPresetDesign(request, brief, selectedPresetVariant, activePreset);
  initialDesign = applyCreativePlanToDesign(initialDesign, creativePlan);
  initialDesign = applyIntegratedLayoutToDesign(initialDesign, selectedPresetVariant, request);
  initialDesign = sanitizeDesignForRequest(request, applyDoudouToDesign(request, initialDesign));
  const initialDoudouReferences = selectDoudouReferences(request, initialDesign);

  onStage("status", { message: "正在把选定创意与参考图转成可执行设计大纲..." });
  let design = initialDesign;
  if (ENABLE_DESIGN_LLM) {
    try {
      const modelDesign = await measure("design_llm", () => callResponses({
      system: designSystem,
      user: [
        "请把已选创意方案转成可直接用于生图的设计大纲JSON。创意方案已经完成三案筛选，不得重新换方案，不得退回普通正面陈列。",
        "所有设计判断必须有来源：用户输入、选定创意蓝图、预设共享原则、已选参考图或上传图。选定创意蓝图中的视觉载体、记忆符号和 approved_visual_inventions 是可执行的创意来源；没有来源的文字、品牌、价格、人群、英文、日期、道具和卖点不得补写。",
        hasMainTitle(request) ? "用户提供了主标题，必须原样保留。整合版式参考同时控制文字视觉系统、信息比例、对齐关系和主画面区域；不得继承参考图文字颜色，主标题颜色根据本次整体视觉方向、背景对比和可读性重新确定。" : "主标题为空，必须删除整合版式参考中的主标题槽位，不得补写主标题。",
        campaignSubtitleText(request) ? `副标题「${campaignSubtitleText(request)}」必须准确保留，层级低于主标题。` : "不得补写副标题。",
        campaignTimeText(request) ? `活动时间「${campaignTimeText(request)}」必须准确保留，并属于标题组。` : "不得补写活动时间。",
        `整合版式参考是文字视觉系统与KV区域布局的最高优先级共同依据：主标题、副标题和活动时间只替换为用户明确提供的内容，字形气质、字号比例、位置、对齐轴、行数、间距、组合轮廓和非文字装饰关系严格继承参考图。${INTEGRATED_LAYOUT_DECORATION_RULE}。${integratedLayoutDecorativeCopyContext(request)}。设计大纲不得根据主题创作任何额外文案。标题长度变化时按参考描述的适配规则保持视觉中心，不得默认左对齐。参考图白色/空白区域是主视觉生成区域，不是最终白色背景。`,
        uploadedReferences.some((item) => item.role === "主体")
          ? "用户上传主体图已随本请求提供给你直接观察。它是对象身份的唯一事实来源：必须识别并保留图中的真实对象类别、轮廓结构、部件、包装比例、材质和可见识别特征；不得根据活动主题猜测或替换成任何其他对象。场景与风格只能包围和衬托该原始对象。"
          : "",
        hasMainTitle(request) && (campaignSubtitleText(request) || campaignTimeText(request)) ? "副标题和活动时间的文字颜色必须与主标题完全一致。" : "",
        threeDPersonDesignInstruction,
        realPersonDesignInstruction,
        doudouDesignInstruction,
        petEnabled ? "本次包含宠物，必须遵守当前预设中的宠物角色约束。" : "",
        y3kEnabled ? "本次为Y3K预设，人物与穿搭编辑逻辑按预设执行。" : "",
        `活动输入：${JSON.stringify(request, null, 2)}`,
        `Brief：${JSON.stringify(brief, null, 2)}`,
        `已选创意方案：${JSON.stringify(creativePlan, null, 2)}`,
        `预设共享原则：${knowledge.preset_principles?.summary || "未提供"}`,
        `已选参考图及选择理由：${JSON.stringify([...presetReferences, ...initialDoudouReferences, ...uploadedReferences].map((item) => ({
          number: item.number,
          role: item.role,
          reason: item.reason,
          use_for: item.selection_use_for || item.role,
          do_not_copy: item.selection_do_not_copy || "不复制参考图的具体文字、品牌、颜色或无关内容",
        })), null, 2)}`,
        `本地可执行大纲：${JSON.stringify(initialDesign, null, 2)}`,
      ].filter(Boolean).join("\n\n"),
      expectJson: true,
      images: uploadedReferenceVisionInputs(request),
      }));
      design = {
        ...initialDesign,
        ...modelDesign,
        creative_strategy: initialDesign.creative_strategy,
        creative_methods: initialDesign.creative_methods,
        creative_concept: initialDesign.creative_concept,
        subject_expansion: { ...initialDesign.subject_expansion, ...(modelDesign.subject_expansion || {}) },
      };
    } catch (error) {
      fallback = true;
      warnings.push({ stage: "design", message: error.message });
    }
  } else {
    stageTimings.design_local = 0;
  }
  design = applyCreativePlanToDesign(design, creativePlan);
  design = applyIntegratedLayoutToDesign(design, selectedPresetVariant, request);
  design = sanitizeDesignForRequest(request, applyDoudouToDesign(request, design));
  const doudouReferences = selectDoudouReferences(request, design);
  const promptReferences = prioritizeGenerationReferences([...presetReferences, ...doudouReferences, ...uploadedReferences]);

  onStage("status", { message: "正在进行美术总监生成前评审..." });
  const preflightReview = await measure("preflight_review", () => reviewDesignPreflight(request, brief, creativePlan, design, promptReferences, knowledge));
  design = applyCreativePlanToDesign(applyPreflightDesignPatch(design, preflightReview), creativePlan);
  design = applyIntegratedLayoutToDesign(design, selectedPresetVariant, request);
  design = sanitizeDesignForRequest(request, applyDoudouToDesign(request, design));
  onStage("design", { design });
  onStage("preflight", { preflight_review: preflightReview });
  onStage("materials", { selected_materials: promptReferences });

  onStage("status", { message: "正在生成精简的分层执行 Prompt..." });
  let finalPrompt = buildCompactExecutionPrompt(request, design, promptReferences);
  stageTimings.prompt_local = 0;
  onStage("prompt", { final_prompt: finalPrompt });

  const imageIterations = [];
  onStage("status", { message: request.generate_image ? "正在启动分层生图..." : "未勾选生成最终 KV 图。" });
  let generationResult = request.generate_image
    ? await measure("image_generation", () => generateLayeredImage(request, design, promptReferences, onStage))
    : {
        image: { skipped: true, reason: "未勾选生成最终 KV 图。" },
        prompt: finalPrompt,
        mode: "skipped",
      };
  let imageResult = generationResult.image;
  finalPrompt = generationResult.prompt || finalPrompt;
  onStage("image", { image_result: imageResult });

  let qualityReview = localImageQualityReview(imageResult?.reason || "");
  if (!imageResult.skipped) {
    if (ENABLE_POST_IMAGE_REVIEW) {
      onStage("status", { message: "正在进行美术总监成图评审..." });
      qualityReview = await measure("post_image_review", () => reviewGeneratedImage(imageResult, request, creativePlan, design, promptReferences, knowledge));
    } else {
      qualityReview = {
        ...localImageQualityReview(),
        source: "fast-path-not-blocking",
        decision: "deferred",
        warning: "",
      };
    }
    imageIterations.push({ iteration: 1, image_result: imageResult, quality_review: qualityReview });
    onStage("quality", { quality_review: qualityReview, iteration: 1 });

    let retryCount = 0;
    while (
      AUTO_ART_DIRECTOR_RETRY
      && retryCount < ART_DIRECTOR_RETRY_LIMIT
      && qualityReview.hard_constraint_pass === false
      && Array.isArray(qualityReview.blocking_issues)
      && qualityReview.blocking_issues.length
    ) {
      retryCount += 1;
      const correction = textOf(qualityReview.correction_prompt).trim()
        || qualityReview.corrections?.join("；")
        || qualityReview.blocking_issues.join("；");
      finalPrompt = buildCompactExecutionPrompt(request, design, promptReferences, correction);
      onStage("prompt", { final_prompt: finalPrompt, revision: retryCount });
      onStage("status", { message: `检测到硬性问题，正在进行第 ${retryCount} 次定向返修...` });
      generationResult = await measure(
        "image_retry",
        () => generateLayeredImage(request, design, promptReferences, onStage, correction),
      );
      imageResult = generationResult.image;
      finalPrompt = generationResult.prompt || finalPrompt;
      onStage("image", { image_result: imageResult, revision: retryCount });
      qualityReview = await measure("post_image_review", () => reviewGeneratedImage(imageResult, request, creativePlan, design, promptReferences, knowledge));
      imageIterations.push({ iteration: retryCount + 1, image_result: imageResult, quality_review: qualityReview });
      onStage("quality", { quality_review: qualityReview, iteration: retryCount + 1 });
    }
  }

  const result = {
    request,
    brief,
    creative_plan: creativePlan,
    design,
    preflight_review: preflightReview,
    retrieval: {
      mode: activePreset ? "semantic-preset" : "none",
      selected_preset: {
        preset_id: activePreset?.preset_id || NO_PRESET_ID,
        preset_name: activePreset?.preset_name || "默认不使用预设",
        selection_method: selectedPresetVariant?.selection_method || "none",
        selected_reference_variant: selectedPresetVariant,
      },
      selected_materials: [],
      preset_references: presetReferences,
      doudou_references: doudouReferences,
      uploaded_references: uploadedReferences,
    },
    knowledge: {
      preset_principles: knowledge.preset_principles?.title || "",
      creative_methods: (knowledge.creative_methods || []).map((item) => ({ id: item.id, name: item.name, score: item.score })),
      cases: (knowledge.cases || []).map((item) => ({ id: item.id, name: item.name, score: item.score })),
    },
    final_prompt: finalPrompt,
    image_result: imageResult,
    quality_review: qualityReview,
    image_iterations: imageIterations,
    fallback,
    warnings,
    models: { text: TEXT_MODEL, image: IMAGE_MODEL },
    performance: {
      mode: PIPELINE_MODE,
      target_ms: 180000,
      total_ms: Date.now() - pipelineStartedAt,
      stages: stageTimings,
      llm_policy: {
        brief: ENABLE_BRIEF_LLM ? "llm" : "local",
        creative: ENABLE_CREATIVE_LLM ? "llm" : "local",
        reference_rerank: ENABLE_REFERENCE_LLM_RERANK ? "llm" : "semantic-contextual",
        design: ENABLE_DESIGN_LLM ? "llm" : "local",
        preflight: ENABLE_PREFLIGHT_LLM ? "llm" : "local",
        prompt: "compact-layered-local",
        post_image_review: ENABLE_POST_IMAGE_REVIEW ? "llm" : "deferred",
        auto_image_retry: AUTO_ART_DIRECTOR_RETRY,
      },
    },
  };
  if (imageResult && !imageResult.skipped) {
    try {
      await persistAssetRecord(result);
    } catch (error) {
      warnings.push({ stage: "asset-persist", message: error.message });
    }
    if (result.request?.project_id) {
      try {
        await appendGenerationToProject(result.request.project_id, result);
      } catch (error) {
        warnings.push({ stage: "project-append", message: error.message });
      }
    }
  }
  onStage("complete", result);
  return result;
}

function validateRequest(body) {
  const required = ["visual_description", "image_size"];
  const missing = required.filter((key) => !textOf(body[key]).trim());
  if (missing.length) throw new Error(`缺少必填字段：${missing.join(", ")}`);
  if (!SIZE_MAP[body.image_size]) throw new Error("输出尺寸必须是 16:9、9:16、3:4、4:3、1:1 之一");
  const stylePreset = resolveStylePresetId(body.style_preset);
  return {
    campaign_name: textOf(body.campaign_name).trim(),
    campaign_subtitle: textOf(body.campaign_subtitle).trim(),
    campaign_time: textOf(body.campaign_time).trim(),
    visual_description: textOf(body.visual_description).trim(),
    image_size: body.image_size,
    style_preset: stylePreset,
    integrated_layout_variant: textOf(body.integrated_layout_variant).trim(),
    project_id: textOf(body.project_id).trim(),
    generate_image: body.generate_image === true || body.generate_image === "true" || body.generate_image === "on" || body.generate_image === "1",
    uploaded_references: Array.isArray(body.uploaded_references) ? body.uploaded_references.filter(Boolean) : [],
    reference_labels: Array.isArray(body.reference_labels) ? body.reference_labels : [],
    user_reference_usage: textOf(body.user_reference_usage).trim(),
    doudou_ip: isDoudouEnabled(body),
    include_logo: booleanPreference(body.include_logo, true),
    include_search_overlay: booleanPreference(body.include_search_overlay, true),
  };
}

async function readRunRequest(req) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return validateRequest(await readJsonBody(req));
  }

  const { fields, files } = await readMultipart(req);
  const uploaded = [];
  const referenceFiles = Object.entries(files)
    .filter(([name]) => name === "reference_image" || name.startsWith("reference_image_"))
    .sort(([a], [b]) => {
      const left = Number(a.match(/_(\d+)$/)?.[1] || 0);
      const right = Number(b.match(/_(\d+)$/)?.[1] || 0);
      return left - right;
    })
    .map(([, file]) => file);
  const referenceTotal = referenceFiles.reduce((sum, file) => sum + file.data.length, 0);
  if (referenceTotal > MAX_REFERENCE_UPLOAD_BYTES) {
    throw httpError(413, `参考图总大小不能超过 ${Math.round(MAX_REFERENCE_UPLOAD_BYTES / 1024)}KB，请减少或压缩参考图后重试`);
  }
  for (const [index, file] of referenceFiles.entries()) {
    uploaded.push(await saveUploadedReferenceFile(file, `user-reference-${index + 1}`));
  }
  let referenceLabels = [];
  try {
    referenceLabels = JSON.parse(fields.reference_labels || "[]");
  } catch {
    referenceLabels = [];
  }
  return validateRequest({
    ...fields,
    uploaded_references: uploaded,
    reference_labels: referenceLabels,
    user_reference_usage: fields.visual_description || "",
  });
}

async function serveStatic(res, filePath, baseDir) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    jsonResponse(res, 403, { error: "Forbidden" });
    return;
  }
  if (!existsSync(resolved)) {
    jsonResponse(res, 404, { error: "Not found" });
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  res.end(await readFile(resolved));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      const materials = await loadMaterials();
      jsonResponse(res, 200, {
        ok: true,
        has_api_key: Boolean(OPENAI_API_KEY),
        models: { text: TEXT_MODEL, image: IMAGE_MODEL },
        pipeline: {
          mode: PIPELINE_MODE,
          target_ms: 180000,
          reference_llm_rerank: ENABLE_REFERENCE_LLM_RERANK,
          design_llm: ENABLE_DESIGN_LLM,
          preflight_llm: ENABLE_PREFLIGHT_LLM,
          post_image_review: ENABLE_POST_IMAGE_REVIEW,
          auto_image_retry: AUTO_ART_DIRECTOR_RETRY,
          reasoning_effort: OPENAI_REASONING_EFFORT || "model-default",
          json_network_retry: !FAST_PIPELINE,
        },
        preset: { id: STYLE_PRESETS[0].id, name: STYLE_PRESETS[0].name },
        style_presets: allStylePresetCards(),
        material_count: materials.length,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/style-presets") {
      jsonResponse(res, 200, decorateUploadUrls({
        presets: stylePresetCardsWithIntegratedLayouts(),
        custom_presets: loadCustomStylePresets(),
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/style-presets/add") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const { fields, files } = await readMultipart(req);
      jsonResponse(res, 200, decorateUploadUrls(await createCustomStylePreset(fields, files)));
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/style-presets/")) {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const id = decodeURIComponent(url.pathname.replace("/api/style-presets/", "")).trim();
      const result = await deleteCustomStylePreset(id);
      if (!result) {
        jsonResponse(res, 404, { error: "未找到可删除的自定义风格" });
        return;
      }
      jsonResponse(res, 200, decorateUploadUrls(result));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/materials") {
      jsonResponse(res, 200, { materials: decorateUploadUrls(await loadMaterials()) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_SEARCH_PER_MIN)) return;
      const body = await readJsonBody(req);
      try {
        jsonResponse(res, 200, await searchDesignInspiration(body.keyword, body.limit));
      } catch (error) {
        jsonResponse(res, error.statusCode || 502, { error: error.message || "设计灵感搜索失败" });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/image-proxy") {
      try {
        const image = await getInspirationImage(url.searchParams.get("url"));
        res.writeHead(200, {
          "Content-Type": image.contentType,
          "Content-Length": image.buffer.length,
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
        });
        res.end(image.buffer);
      } catch (error) {
        const status = error instanceof ImageProxyError ? error.statusCode : 502;
        jsonResponse(res, status, { error: error.message || "灵感图片代理失败" });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/materials/save-inspiration") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const body = await readJsonBody(req);
      jsonResponse(res, 200, decorateUploadUrls(await saveInspirationMaterial(body)));
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/materials/")) {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const number = decodeURIComponent(url.pathname.replace("/api/materials/", "")).trim();
      const result = await deleteMaterialByNumber(number);
      if (!result) {
        jsonResponse(res, 404, { error: "未找到该素材" });
        return;
      }
      jsonResponse(res, 200, decorateUploadUrls(result));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/materials/delete") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const body = await readJsonBody(req);
      const result = await deleteMaterialByNumber(body.number);
      if (!result) {
        jsonResponse(res, 404, { error: "未找到该素材" });
        return;
      }
      jsonResponse(res, 200, decorateUploadUrls(result));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/assets") {
      jsonResponse(res, 200, { assets: await listAssets() });
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/assets/")) {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const name = decodeURIComponent(url.pathname.replace("/api/assets/", "")).trim();
      const result = await deleteAssetByName(name);
      if (!result) {
        jsonResponse(res, 404, { error: "未找到该资产" });
        return;
      }
      jsonResponse(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/assets/delete") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const body = await readJsonBody(req);
      const result = await deleteAssetByName(body.name);
      if (!result) {
        jsonResponse(res, 404, { error: "未找到该资产" });
        return;
      }
      jsonResponse(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/projects") {
      const projects = [...(await getProjects())].sort((left, right) => (
        new Date(right.updated_at || right.created_at || 0).getTime()
        - new Date(left.updated_at || left.created_at || 0).getTime()
      ));
      jsonResponse(res, 200, { projects: projects.map(decorateProject) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/verify") {
      const header = textOf(req.headers.authorization).trim();
      if (!header.startsWith("Bearer ") || !isAuthorized(req)) {
        jsonResponse(res, 401, { ok: false });
        return;
      }
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const body = await readJsonBody(req);
      const now = new Date().toISOString();
      const project = {
        id: newProjectId(),
        title: textOf(body.title || body.prompt).trim().slice(0, 60) || "Untitled",
        prompt: textOf(body.prompt).trim().slice(0, 2000),
        created_at: now,
        updated_at: now,
        thumbnail: "",
        elements: [],
        messages: [],
      };
      const projects = await getProjects();
      projects.unshift(project);
      await saveProjectsIndex(projects);
      jsonResponse(res, 200, decorateProject(project));
      return;
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      if (req.method === "GET") {
        const project = (await getProjects()).find((item) => item.id === projectId);
        if (!project) {
          jsonResponse(res, 404, { error: "未找到该项目" });
          return;
        }
        jsonResponse(res, 200, decorateProject(project));
        return;
      }
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      if (req.method === "PATCH") {
        const body = await readJsonBody(req);
        const projects = await getProjects();
        const project = projects.find((item) => item.id === projectId);
        if (!project) {
          jsonResponse(res, 404, { error: "未找到该项目" });
          return;
        }
        const title = textOf(body.title).trim().slice(0, 60);
        if (title) project.title = title;
        project.updated_at = new Date().toISOString();
        await saveProjectsIndex(projects);
        jsonResponse(res, 200, decorateProject(project));
        return;
      }
      if (req.method === "DELETE") {
        const result = await deleteProjectById(projectId);
        if (!result) {
          jsonResponse(res, 404, { error: "未找到该项目" });
          return;
        }
        jsonResponse(res, 200, { ok: true, deleted: projectId, projects: (await getProjects()).map(decorateProject) });
        return;
      }
    }

    const projectMessagesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/messages$/);
    if (projectMessagesMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const body = await readJsonBody(req);
      const message = await appendProjectMessage(decodeURIComponent(projectMessagesMatch[1]), body.role, body.content);
      if (!message) {
        jsonResponse(res, 404, { error: "未找到该项目" });
        return;
      }
      jsonResponse(res, 200, { message });
      return;
    }

    const projectCanvasMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/canvas$/);
    if (projectCanvasMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const body = await readJsonBody(req);
      const project = await saveProjectCanvas(decodeURIComponent(projectCanvasMatch[1]), {
        title: body.title,
        elements: body.elements,
        edges: body.edges,
        viewport: body.viewport,
        settings: body.settings,
        messages: body.messages,
      });
      if (!project) {
        jsonResponse(res, 404, { error: "未找到该项目" });
        return;
      }
      jsonResponse(res, 200, decorateProject(project));
      return;
    }

    const projectElementMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/elements\/([^/]+)$/);
    if (projectElementMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const removed = await deleteProjectElementById(
        decodeURIComponent(projectElementMatch[1]),
        decodeURIComponent(projectElementMatch[2]),
      );
      if (!removed) {
        jsonResponse(res, 404, { error: "未找到该画布元素" });
        return;
      }
      const project = (await getProjects()).find((item) => item.id === projectElementMatch[1]);
      jsonResponse(res, 200, decorateProject(project || { elements: [] }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/assets/split") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const body = await readJsonBody(req);
      const result = await splitAssetLayers({
        name: body.name,
        title: textOf(body.title).trim(),
        subtitle: textOf(body.subtitle).trim(),
        time: textOf(body.time).trim(),
      });
      jsonResponse(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/materials/add") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const { fields, files } = await readMultipart(req);
      const existing = await loadMaterials();
      const image = files.image ? await saveUploadedFile(files.image, fields.number || "material") : textOf(fields.image).trim();
      const material = normalizeMaterial({
        number: fields.number || `CUSTOM_${existing.length + 1}`,
        type: fields.type,
        title: fields.title,
        reference_roles: fields.reference_roles,
        image,
        category: fields.category,
        reference_description: fields.reference_description,
        design_type: fields.design_type,
        industry_tags: fields.industry_tags,
        style_tags: fields.style_tags,
        layout_tags: fields.layout_tags,
        source: fields.source || "upload",
        source_url: fields.source_url,
        created_at: new Date().toISOString(),
      });
      if (!material.reference_roles.length || !material.reference_description) throw new Error("参考用途和参考描述不能为空");
      const withoutSame = existing.filter((item) => item.number !== material.number);
      const materials = await saveMaterials([...withoutSame, material]);
      jsonResponse(res, 200, decorateUploadUrls({ ok: true, material, count: materials.length, materials }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/materials/import-xlsx") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_WRITE_PER_MIN)) return;
      const { files } = await readMultipart(req);
      if (!files.xlsx) throw new Error("请上传 xlsx 文件");
      validateXlsxFile(files.xlsx);
      await mkdir(UPLOAD_DIR, { recursive: true });
      const importName = `import-${Date.now()}${path.extname(files.xlsx.filename) || ".xlsx"}`.replace(/[^\w.-]/g, "_");
      const importPath = path.join(UPLOAD_DIR, importName);
      await writeFile(importPath, files.xlsx.data);
      const imported = (await runPythonImport(importPath)).map(normalizeMaterial).filter((item) => item.number && item.type);
      const existing = await loadMaterials();
      const incomingNumbers = new Set(imported.map((item) => item.number));
      const materials = await saveMaterials([...existing.filter((item) => !incomingNumbers.has(item.number)), ...imported]);
      jsonResponse(res, 200, decorateUploadUrls({ ok: true, imported: imported.length, count: materials.length, materials }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/expand-description") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_EXPAND_PER_MIN)) return;
      const body = validateExpandRequest(await readJsonBody(req));
      jsonResponse(res, 200, await expandVisualDescription(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_RUN_PER_MIN)) return;
      const body = await readRunRequest(req);
      jsonResponse(res, 200, await runPipeline(body));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run-stream") {
      if (!requireAdmin(req, res)) return;
      if (!applyRateLimit(req, res, RATE_LIMIT_RUN_PER_MIN)) return;
      const body = await readRunRequest(req);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      });
      try {
        await runPipeline(body, (event, payload) => sseWrite(res, event, payload));
      } catch (error) {
        sseWrite(res, "error", { error: error.message || "链路运行失败" });
      } finally {
        res.end();
      }
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      await serveStatic(res, path.join(ASSET_DIR, decodeURIComponent(url.pathname.replace("/assets/", ""))), ASSET_DIR);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/outputs/")) {
      if (IS_OSS) {
        const name = decodeURIComponent(url.pathname.replace("/outputs/", "")).trim();
        if (name && name === path.basename(name) && await storageExists(outputKey(name))) {
          res.writeHead(302, { Location: storageSignUrl(outputKey(name)) });
          res.end();
          return;
        }
      }
      await serveStatic(res, path.join(OUTPUT_DIR, decodeURIComponent(url.pathname.replace("/outputs/", ""))), OUTPUT_DIR);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/image/")) {
      await serveStatic(res, path.join(IMAGE_DIR, decodeURIComponent(url.pathname.replace("/image/", ""))), IMAGE_DIR);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/doudou/")) {
      await serveStatic(res, path.join(DOUDOU_DIR, decodeURIComponent(url.pathname.replace("/doudou/", ""))), DOUDOU_DIR);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/sytle/")) {
      await serveStatic(res, path.join(STYLE_DIR, decodeURIComponent(url.pathname.replace("/sytle/", ""))), STYLE_DIR);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/style/")) {
      await serveStatic(res, path.join(STYLE_DIR, decodeURIComponent(url.pathname.replace("/style/", ""))), STYLE_DIR);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
      const relative = decodeURIComponent(url.pathname.replace("/uploads/", ""));
      const runtimeFile = path.join(UPLOAD_ROOT, relative);
      if (existsSync(runtimeFile)) {
        await serveStatic(res, runtimeFile, UPLOAD_ROOT);
      } else {
        await serveStatic(res, path.join(PACKAGED_UPLOAD_ROOT, relative), PACKAGED_UPLOAD_ROOT);
      }
      return;
    }

    const publicPath = url.pathname === "/" ? "/index.html" : url.pathname;
    await serveStatic(res, path.join(PUBLIC_DIR, decodeURIComponent(publicPath)), PUBLIC_DIR);
  } catch (error) {
    jsonResponse(res, error.statusCode || 500, { error: error.message || "Server error" });
  }
});

try {
  await hydrateCustomStylePresets();
} catch (error) {
  console.warn(`自定义风格预设读取失败：${error.message}`);
}
server.listen(PORT, () => {
  console.log(`KV Reference Prompt Studio running at http://localhost:${PORT}`);
});
