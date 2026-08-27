# KV Reference Prompt Studio

营销 KV 生成与设计参考管理工具。当前包含自由生图、内置技能生图、项目化无限画布、资产管理、素材库管理，以及 Pinterest 与 Behance 设计灵感搜索。

- [完整交接文档](HANDOFF.md)
- [Claude Code 开发约束](CLAUDE.md)
- [版本快照](SNAPSHOT.md)

## 启动

需要 Node.js 24 或兼容版本。文本与生图链路需要 OpenAI API Key；素材管理和设计灵感搜索不依赖该 Key。

```bash
cd /Users/bytedance/Documents/GitHub/refra
OPENAI_API_KEY="你的 key" \
OPENAI_TEXT_MAX_OUTPUT_TOKENS=4096 \
PORT=5174 \
/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.mjs
```

启动完成后访问 `http://localhost:5174`。

## 当前生图模式

首页和画布默认进入**自由模式**，不会加载任何技能：

- 未上传图片：将用户原始 Prompt 直接传给 `gpt-image-2` 的图片生成接口。
- 上传一张或多张图片：按上传顺序将图片和用户原始 Prompt 直接传给 `gpt-image-2` 的图片编辑接口；用户可通过 `@图N` 指定用途。
- 自由模式是单阶段链路，不经过 Brief、创意方案、Skill、文本改写或两阶段版式生成。只有用户主动点击“扩写”时才调用文本模型，并把结果回填供用户确认。

用户选择四个内置技能之一后进入**技能模式**。技能模式按以下顺序执行，并通过 `/api/run-stream` 逐阶段返回：

1. **需求理解**：提取用户明确输入的主标题、副标题、活动时间、主体、场景、画幅和上传图语义，不补写不存在的业务事实。
2. **创意与设计判断**：结合预设原则、创意方法和案例，确定创意概念、主视觉、构图、色彩、材质、光影和镜头。
3. **参考选择**：AI 根据 `@图N` 附近的描述判断每张上传图是产品主体、人物主体、字体、构图、风格或补充参考；没有明确用途时不得默认主体。系统自动匹配技能的风格和整合版式参考，用户不再手动选择版式。
4. **第一阶段版式图**：只生成文字视觉系统与版式关系，替换或删除参考图原文字，保留已有装饰结构和主视觉生成空间。
5. **第二阶段完整 KV**：把第一阶段图片作为最高优先级固定画布，并把风格、主体、元素等真实参考图连同精简 Prompt 一起传给 `gpt-image-2`。主体避开文字区域，背景与场景可以自然延伸到文字层下方。
6. **程序叠加**：按用户开关叠加左上角 Logo 和右下角活动搜索框。
7. **资产归档**：保存输入、上传图、成图和中间结果，支持删除与后续 AI 拆分。

创意阶段允许推导与主题直接相关的角色、场景、道具和视觉隐喻，但必须写入 `approved_visual_inventions` 并说明用途。未经用户提供的品牌、价格、卖点、英文、日期和其他画面文字始终禁止补写。

## 内置技能与参考图库

当前不支持用户上传自定义风格。四个内置技能为 `3D KV 主视觉设计`、`扁平 KV 主视觉设计`、`实景商品` 和 `真实人物`；其中前两项已切换到新的 Skill 包与精简参考图库：

```text
style/3D风格/
  skill-3d-kv-main-visual/
    SKILL.md
    references/
  reference-library/
    3d-clay-character-001.png
    3d-clay-character-001.md
  layout-library/
    horizontal-layout-001.png
    horizontal-layout-001.md

style/极简扁平插画/
  skill-flat-kv-main-visual/
    SKILL.md
    references/
  reference-library/
  layout-library/
```

`SKILL.md` 与 `references/` 定义关系优先、构图、材质/风格路由和质量底线；图片旁的同名 `.md` 提供机器可读用途。3D 技能在黏土、软胶果冻、软胶植绒、毛绒和针织之间硬路由；扁平技能在几何颗粒版画、贴纸拼贴、胶版叠压、清爽矢量和马克笔涂鸦之间硬路由，避免多个视觉系统平均混合。

> 2026-08-04 已下线并删除 `y3k`、`手帐拼贴`、`毛毡风格`、`黏土萌趣`、`描边风格`、`手绘扁平涂鸦` 六个风格目录；服务端对这些已下线预设 id 返回 400。如需恢复，从 tag `v0.1.0-oss-stable` 取回。

> 上传限制：Vercel 平台对总请求体有约 850KB 的实测上限，超限会直接返回 503 `SERVICE_UNAVAILABLE`（不进入函数）。前端会把参考图自动压缩到 600KB 总预算内；直接调用 API 时请控制参考图总大小 ≤600KB，超限服务端返回 413。

案例与创意方法目录：

```text
case/case_001_主题名/
  brief.md
  review.md
  good.png
  bad.png
  references/          # 仅用于案例归档，不直接传给生图模型

creative_methods/
  01_方法名.md
  01_方法名.png         # 可选方法示例图，仅参与创意理解
```

案例评审建议明确列出 Brief、三个方向、最终分镜、Good/Bad 原因、必须保留、必须避免和修正方式。方法卡建议包含适用条件、输入要求、操作步骤、输出结构、优势、风险、禁用条件及正反案例。

`case/` 已于 2026-08-04 移出 Git，归档到 OSS（`oss://refra-assets/case/`，桶 `refra-assets`）；本地保留未跟踪副本，上传方式见交接文档中的清理记录。

## 设计灵感搜索

素材库管理页右上角提供 Pinterest 与 Behance 设计灵感搜索。用户输入主题词后，系统会：

1. 将主题扩展为 8 组中英文设计检索词。
2. 并发检索 Pinterest 公开搜索资源与 Behance 公开项目页；任一来源失败时，另一来源仍可返回结果。
3. 过滤视频、商品、教程、测评、低分辨率和重复结果。
4. 按查询来源做多样性排序，并补充设计类型标签。
5. 前端优先直连来源 CDN；加载失败时回退到受限图片代理。
6. 用户可显式选择参考用途，将指定结果保存到本地素材库；系统保留原 Pin / Behance 项目链接，并按来源与资源 ID 去重。

接口：

```http
POST /api/search
Content-Type: application/json

{"keyword":"美妆","limit":40}
```

响应：

```json
{
  "keyword": "美妆",
  "queries": ["美妆 海报 视觉设计"],
  "items": [
    {
      "id": "123",
      "title": "Design title",
      "description": "Design description",
      "imageUrl": "https://i.pinimg.com/...",
      "thumbnailUrl": "https://i.pinimg.com/...",
      "sourceUrl": "https://www.pinterest.com/pin/123/",
      "pinUrl": "https://www.pinterest.com/pin/123/",
      "source": "pinterest",
      "width": 1200,
      "height": 1600,
      "query": "beauty campaign key visual design",
      "designType": "活动 KV"
    }
  ],
  "total": 40,
  "sources": {"pinterest": 20, "behance": 20}
}
```

图片代理：

```http
GET /api/image-proxy?url=https%3A%2F%2Fi.pinimg.com%2F...
```

代理只允许 `http/https` 的 `i.pinimg.com`、`mir-s3-cdn-cf.behance.net` 和 `mir-s3-cdn.behance.net`，逐次校验重定向目标，限制 10 秒超时、8MB 响应体和图片 MIME 类型。普通预览使用最多 48 条、有效期 5 分钟的内存缓存，不会自动落盘。只有用户点击“保存到素材库”后，选中的图片才会写入本地素材目录。

保存灵感素材：

```http
POST /api/materials/save-inspiration
Content-Type: application/json

{
  "id": "123",
  "imageUrl": "https://i.pinimg.com/...",
  "pinUrl": "https://www.pinterest.com/pin/123/",
  "title": "Design title",
  "description": "Design description",
  "designType": "活动 KV",
  "reference_roles": ["完整案例", "构图版式"],
  "industry_tags": ["宠物"],
  "width": 1200,
  "height": 1600
}
```

素材库一级分类按参考用途组织：`完整案例`、`字体标题`、`构图版式`、`风格质感`、`元素主体`、`色彩氛围`、`场景空间`。一张素材可属于多个用途；设计类型、来源和画幅作为二级筛选条件。旧的 `字体`、`构图`、`色彩`、`质感` 数据会自动映射到新分类。

## 生图性能模式

默认使用 `fast` 模式，`performance.target_ms` 为 180000 毫秒。实际耗时仍取决于 OpenAI API 的响应速度、参考图数量和图片尺寸。

技能模式存在整合版式且用户提供了可见标题时，关键生图链路固定为两次图片模型调用：

1. 根据整合版式参考图生成仅含用户文字的固定文字版式画布。
2. 将第一阶段成图作为最高优先级参考，再结合风格、主体、角色和元素参考生成完整 KV。

技能模式未使用整合版式或没有可见标题时，系统退回单次 one-shot 生图。自由模式始终是独立的单阶段 `images.generate` / `images.edit` 路由，不进入上述技能性能策略。

快速模式默认使用 `low` 文本推理强度，并关闭 JSON 失败后的第二次网络重答；单个文本节点失败时直接使用本地可执行结果继续，不额外消耗一轮等待时间。

每次结果的 `performance` 字段会返回总耗时、各阶段毫秒数和实际启用的模型策略。`GET /api/health` 也会返回当前性能模式。

需要完整 LLM 重排、设计复核、成图复审和最多一次自动返修时，可显式启动质量模式：

```bash
PIPELINE_MODE=quality node server.mjs
```

也可以逐项覆盖：`ENABLE_BRIEF_LLM`、`ENABLE_REFERENCE_LLM_RERANK`、`ENABLE_DESIGN_LLM`、`ENABLE_PREFLIGHT_LLM`、`ENABLE_POST_IMAGE_REVIEW`、`AUTO_ART_DIRECTOR_RETRY`。创意阶段在快速模式默认最多传 3 张低细节案例图，可通过 `CREATIVE_EVIDENCE_IMAGE_LIMIT` 和 `CREATIVE_EVIDENCE_IMAGE_DETAIL` 调整。

### Skill 初稿与自动优化

技能模式继续保留“标题版式图 → 完整 KV”的既有两阶段语义。完整 KV 初稿生成前，服务端读取所选 Skill 的完整 Markdown，并将 Skill、用户 Brief、最终选中的 `reference-library` 设计语法参考和现有约束合并为一次结构化规划。完整 KV 初稿保存后立即通过 SSE 返回；智能优化模式再由前端发起独立评审请求，避免单个 Vercel 请求同时承担规划、两次图片生成、评审和编辑。

- `快速生成`：完整 KV 使用 `gpt-image-2` 的 `low` quality，不评审、不自动编辑。
- `智能优化`：初稿先返回；GPT-5.5 以低细节图片和低推理强度只判断一个最大结构问题。严重度达到阈值时，最多调用一次 `images.edit`，第一张输入固定为初稿编辑目标，第二张固定为 `reference-library` 设计语法参考。
- 图片网关统一使用 `1024x1024`、`1536x1024`、`1024x1536` 三种标准尺寸；产品画幅会映射到最接近的横版、竖版或方图尺寸。
- Skill 版本与参考图内容哈希组成风格指纹缓存键，缓存写入 `data/skill-fingerprints.json`。
- 任务写入 `data/generation-jobs/<id>.json`，耗时样本和 P50/P95 写入 `data/generation-metrics.json`。OSS 后端只持久化 object key，对外读取时再生成签名 URL。
- `GET /api/generation-jobs/:id` 读取任务；`POST /api/generation-jobs/:id/optimize-stream` 启动或重试一次优化；`GET /api/generation-metrics` 读取阶段耗时统计。

可选环境变量：

```text
OPENAI_SKILL_MODEL=gpt-5.5
SKILL_REVISION_THRESHOLD=0.65
SKILL_PLANNING_REASONING_EFFORT=low
SKILL_REVIEW_REASONING_EFFORT=low
OPENAI_BASE_URL=https://api.openai.com/v1
# 可为图片模型单独配置 OpenAI-compatible 网关；文本模型仍使用上面的 OPENAI_API_KEY / OPENAI_BASE_URL。
OPENAI_IMAGE_API_KEY=your-image-gateway-ak
OPENAI_IMAGE_BASE_URL=https://aidp.bytedance.net/api/modelhub/online/v2/crawl/openai
OPENAI_IMAGE_EDIT_BASE_URL=https://aidp.bytedance.net/gpt/openapi/online/v2/crawl/openai
```

生成记录会同时保存初稿与最终图 object key、Skill ID/版本、生成 Prompt、评审结果、是否触发优化、优化状态、错误和阶段耗时。优化失败时任务以初稿作为可用最终结果，保留错误并允许用户点击“重新优化”；自动尝试本身不会超过一次。

## 模块边界

- `services/inspiration/keyword-expander.mjs`：主题词扩展。
- `services/inspiration/pinterest-search.mjs`：Pinterest 搜索适配器。
- `services/inspiration/behance-search.mjs`：Behance 公开项目搜索适配器。
- `services/inspiration/result-processing.mjs`：过滤、去重、排序和设计类型分类占位层。
- `services/inspiration/image-proxy.mjs`：受限图片代理与短期内存缓存。

这些模块不依赖页面代码，后续可以单独替换为正式数据服务、视觉分类模型或授权搜索供应商。

## Demo 边界与生产风险

当前 Pinterest 与 Behance 搜索均为内部 PoC，读取公开搜索资源或公开项目页面，不是稳定的生产协议。Pinterest 官方 API 需要应用审核和授权令牌；官方文档中的 Pin 接口以已授权账户内容为主，因此本 Demo 没有假设存在可直接使用的公开全站搜索 API：[API overview](https://developers.pinterest.com/docs/overview/welcome/)、[Authentication](https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/)、[Make an API call](https://developers.pinterest.com/docs/getting-started/make-an-api-call/)。

上线前需要处理：

- Pinterest / Behance 页面接口改版、登录墙、验证码、地域差异和频率限制。
- 正式授权、服务条款、图片版权、展示范围和来源归属。
- 服务端限流、请求队列、监控、失败降级与更严格的审计日志。
- 使用授权数据供应商或正式检索服务替换公开页面适配器。
- 用视觉模型补充真正的图片内容分类、近似图去重和设计质量评分。

当前保存能力仅用于内部、用户主动选择的设计参考管理，并始终保留原 Pin 或 Behance 项目链接。正式上线前仍需确认图片的授权范围、缓存期限、删除机制和二次使用边界。
