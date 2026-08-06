# Claude Code 交接文档

## 1. 当前版本节点

- 正式本地仓库：`/Users/bytedance/Documents/GitHub/refra`
- GitHub：`https://github.com/dafei-max/refra`
- 默认分支：`main`
- Vercel 项目：`https://vercel.com/liuyahuis-projects/refra`
- 线上地址：`https://refra-brown.vercel.app`
- 编写本文档前的基线提交：`76ed1ae`（`fix: use writable runtime storage on Vercel`）
- 可回滚标签：
  - `v1.1.0-current-20260803`：当前大改版前的稳定节点
  - `v1.0.0-pre-redesign-20260727`：UI 改版前节点

本交接提交只增加和更新文档，不应改变运行逻辑。后续修改前先执行 `git status`，确认工作区状态并建立自己的提交节点。

## 2. 产品目标

这是一个营销 KV 生成工具。用户只需要提供少量营销信息，系统负责把自然语言需求转成可执行的设计方案，并将真实参考图与 Prompt 一起传给图像模型生成 KV。

核心目标不是只生成一段 Prompt，而是完成以下闭环：

1. 理解用户明确输入和上传图片的用途。
2. 判断创意方向、视觉风格、主体、构图和信息层级。
3. 从风格预设、整合版式、元素和角色库中选择参考图。
4. 先生成准确的文字版式层，再在其基础上生成完整 KV。
5. 保存成图、输入信息和中间资产，支持删除与后续拆分。
6. 让素材库、设计灵感搜索结果和生成链路真正互通。

## 3. 已实现能力

### 3.1 生成页

- 主标题、副标题、活动时间均允许独立输入；主标题可以为空。
- 画面描述支持自然语言扩写。
- 支持 `3:4`、`4:3`、`1:1`、`16:9`、`9:16` 等比例。
- 支持多张图片上传，并通过 `@图1`、`@图2` 指定图片用途。
- 支持风格预设选择，以及风格内整合版式的手动选择。
- 未手动选择整合版式时，保留 AI 自动选择逻辑。
- 支持兜兜 IP、左上角 Logo、右下角活动搜索框三个独立开关。
- Brief、设计判断、最终 Prompt 和成图按阶段流式展示。

### 3.2 资产页

- 保存用户输入、上传图、最终成图及相关中间信息。
- 最新资产优先展示。
- 支持资产删除。
- 支持使用 AI 将成图拆分为标题文字图与背景图。

### 3.3 风格页

- 支持通过约定目录结构导入风格预设。
- 首页自动展示可用风格。
- 每个风格可包含风格图、元素图、角色图和整合版式图。
- 风格与整合版式均支持手动应用；整合版式一次只能选择一张。

### 3.4 素材库与设计灵感

- 素材库支持图片浏览、详情、上传、Excel 导入和删除。
- 素材可以“用作参考图”，直接带回当前生成表单。
- 素材可以“做同款”，将素材描述写入画面描述输入框。
- 支持 Pinterest 与 Behance 设计灵感搜索。
- 搜索结果可保存到素材库，继续参与生成链路。

## 4. 当前生成策略

### 4.1 用户输入优先级

所有生成约束按以下优先级执行：

1. 用户明确填写的文字、画幅、开关和自然语言要求。
2. 用户通过 `@图N` 明确指定的图片语义，例如“产品为 @图1”或“@图2 用作人物主体”。
3. 第一阶段生成的固定文字版式画布。
4. 手动选择或 AI 选择的整合版式参考。
5. 兜兜或其他用户指定主体的身份参考。
6. 风格参考。
7. 元素和角色参考。

低优先级参考不得覆盖用户主体，也不得改写固定文字版式。

### 4.2 前置文本与设计阶段

1. **Brief 理解**：提取用户明确提供的活动信息、主体、场景、情绪和硬约束，避免补写不存在的业务事实。
2. **创意与设计判断**：根据用户信息、预设原则、创意方法和案例，确定视觉概念、主体关系、构图、色彩、材质、光影和镜头。
3. **参考检索**：根据设计判断匹配整合版式、风格、元素与角色参考；手动选择的参考优先于自动匹配。

### 4.3 第一阶段：文字与整合版式图

第一阶段只负责生成文字视觉系统和版式关系：

- 使用一张整合版式参考图。
- 只保留用户明确提供的主标题、副标题和活动时间。
- 参考图原有文字必须被替换或删除，不能残留。
- 严格继承参考图中的字形气质、文字比例、位置、对齐、阅读顺序与已有视觉装饰。
- 参考图中已有的引号、框线、标签、角标和装饰符号可以保留；参考图没有的装饰不得擅自新增。
- 若参考图本身存在装饰文案槽位，可根据用户主题改写该槽位内容；不得照搬原文，也不得凭空新建装饰文案槽位。
- 字数变化时，应保持原版式思维，基于参考图判断左对齐、居中或其他对齐方式，不应机械地全部左对齐。
- 输出仍需保留足够的主视觉生成区域。

### 4.4 第二阶段：完整 KV

第二阶段将第一阶段成图作为最高优先级的固定画布和参考图：

- 完整保留第一阶段已有文字的样式、颜色、大小和位置。
- 主视觉主体应避开核心文字笔画和信息区域，保持清晰安全间距。
- 背景与场景可以延伸到固定文字层下方，不需要人为切成上下两块。
- 文字周围可以有连续场景，但局部复杂度和对比度应受控，保证文字可读。
- 禁止通过硬裁切、矩形蒙版、明显渐隐带或断层来制造“安全区”。
- 用户明确指定为主体的 `@图N` 必须作为主体身份参考，不能被误判成风格参考。
- 其他风格、元素、角色参考只控制各自指定维度，不得改写第一阶段版式。

### 4.5 兜兜 IP

- 开启后兜兜必须出现在最终画面中。
- 用户已指定其他主体时，兜兜作为辅助角色，并与场景在动作、神态或叙事上呼应。
- 用户未指定主体，或明确说明兜兜是主体时，兜兜作为主视觉。
- 生成时可使用多张兜兜三视图和姿态图。
- 固定造型限制：兜兜不允许出现手、胳膊和嘴巴。

### 4.6 可选系统叠加层

- 左上角 Logo：距左侧和顶部各 `40px`，宽 `200px`，等比缩放；浅色与深色背景使用不同版本。
- 右下角活动搜索框：宽 `295px`，距右侧 `44px`、底部 `22px`；搜索内容为活动名称，使用 `DouyinSansBold`，水平垂直居中。
- 两项默认关闭，只有用户主动点亮后才叠加。
- 这些元素应由程序后处理叠加，不要要求图像模型绘制占位框或安全区。

## 5. 风格预设目录

当前代码以 `style/` 为正式目录，历史上曾使用拼写错误的 `sytle/`，服务端仍保留兼容静态路由。新增内容应只写入 `style/`。

推荐结构：

```text
style/<风格名>/
  preset.md
  风格/
    style1.png
    style1.md
  元素/                 # 可选
    element1.png
    element1.md
  角色/                 # 可选
    role1.png
    role1.md
  整合版式/
    Product_Vertical1.png
    Product_Vertical1.md
    Product_Horizontal1.png
    Product_Horizontal1.md
```

图片与同名 `.md` 优先配对，同时兼容旧 `.txt` 描述。当前主要预设包括：

- `3D风格`
- `极简扁平插画`
- `实景商品`
- `真实人物`

运行时目录扫描结果是预设的事实来源，前端不应硬编码固定列表。

## 6. 代码与数据位置

- `server.mjs`：Node 服务、前端页面、API、生成链路和静态文件服务。目前文件较大，修改时先定位相关函数，避免无关重构。
- `Brief理解.md`：Brief 节点策略。
- `设计判断.md`：设计大纲与判断策略。
- `检索匹配.md`：参考检索策略。
- `prompt生成.md`：最终 Prompt 结构策略。
- `style/`：风格、整合版式、元素和角色参考。
- `creative_methods/`：创意方法卡。
- `case/`：Good Case、Bad Case 与评审材料；已移出 Git（2026-08-04），归档于 OSS `oss://refra-assets/case/`，本地保留未跟踪副本。
- `素材资产库图片素材/`、`素材资产库.xlsx`：历史素材库。
- `services/`：Vercel/服务入口相关代码。
- `outputs/`、`uploads/`、`data/`：本地运行时资产；线上写入规则见下文。

主要 API：

```text
GET    /api/health
GET    /api/style-presets
POST   /api/style-presets/add
DELETE /api/style-presets/:id
GET    /api/materials
POST   /api/materials/add
POST   /api/materials/import-xlsx
DELETE /api/materials/:number
POST   /api/search
POST   /api/materials/save-inspiration
GET    /api/assets
DELETE /api/assets/:name
POST   /api/assets/split
POST   /api/expand-description
POST   /api/run
POST   /api/run-stream
```

静态路由包括 `/assets/`、`/outputs/`、`/image/`、`/doudou/`、`/style/`、`/sytle/` 和 `/uploads/`。

## 7. 本地运行

```bash
cd /Users/bytedance/Documents/GitHub/refra
OPENAI_API_KEY="你的 key" \
OPENAI_TEXT_MAX_OUTPUT_TOKENS=4096 \
PORT=5174 \
/Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.mjs
```

看到以下输出后访问 `http://localhost:5174`：

```text
KV Reference Prompt Studio running at http://localhost:5174
```

不要把 API Key 写入仓库、文档、日志或提交历史。

## 8. Vercel 运行边界

`vercel.json` 当前使用 Vercel `services` schema，并通过 `includeFiles` 打包 4 个策略 Markdown：

- `Brief理解.md`
- `设计判断.md`
- `检索匹配.md`
- `prompt生成.md`

这些文件必须继续能在 Production Function 的 `/api/run` 和 `/api/run-stream` 中读取。

需要的生产环境变量：

```text
OPENAI_API_KEY
OPENAI_TEXT_MAX_OUTPUT_TOKENS=4096
```

可选变量：

```text
OPENAI_TEXT_MODEL
OPENAI_IMAGE_MODEL
PIPELINE_MODE
OPENAI_REASONING_EFFORT
AUTO_ART_DIRECTOR_RETRY
```

Vercel 的 `/var/task` 是只读目录。运行时生成内容只能写入 `/tmp/refra`，但 `/tmp` 是临时存储，函数实例销毁后可能丢失。生产环境若需要永久保存用户素材、成图和资产，应接入对象存储/CDN，而不是依赖仓库目录或 `/tmp`。

## 9. 当前最高优先级问题

### P0：服务端不能解析浏览器相对图片 URL

线上曾出现：

```text
Failed to parse URL from /style/%E7%9C%9F%E5%AE%9E%E4%BA%BA%E7%89%A9/%E6%95%B4%E5%90%88%E7%89%88%E5%BC%8F/Product_Vertical14.png
```

根因是服务端在组装发给 OpenAI 的参考图时，对 `/style/...` 这类浏览器相对路径直接调用了 Node `fetch()`。浏览器能解析相对 URL，Node 服务端的 `fetch()` 不能在没有 base URL 的情况下解析它。

需要建立统一的 `image source resolver`，不要在各调用点临时打补丁：

1. `http://`、`https://`：使用网络 `fetch`。
2. `data:`：直接解码。
3. `/style/...`、`/image/...`、`/doudou/...` 等仓库静态路径：安全映射到打包后的本地文件并读取字节。
4. `/uploads/...`、`/outputs/...`：映射到本地运行目录；Vercel 映射到 `/tmp/refra`。
5. 拒绝路径穿越，校验 MIME、文件大小和允许的目录前缀。
6. 错误信息必须包含来源类型和归一化后的安全路径，但不能泄露密钥。

验收时至少覆盖带中文和空格的编码路径，并确认 Vercel Production Function 能把预设参考图真实传给图像接口。

### P1：生产资产持久化

当前 Vercel 仅能把运行时文件写入 `/tmp/refra`，不能作为长期资产库。下一阶段建议抽象 `storage adapter`：

- 本地开发：文件系统。
- 生产：Vercel Blob、S3、R2 或其他对象存储。
- 数据记录只保存稳定 URL、对象 key 和元数据。

### P2：服务端拆分与测试

`server.mjs` 承担了较多职责。功能稳定后再逐步拆为图片来源解析、存储、OpenAI 调用、预设检索、资产 API 等模块。当前优先修复 P0，避免同时大规模重构生成策略。

## 10. 接手后的验收清单

- `node --check server.mjs` 通过。
- 本地 `/api/health` 返回正常。
- 手动选择整合版式时只使用所选版式；不选择时仍由 AI 匹配。
- 外部画幅与版式方向冲突时，以外部画幅为准，但保留所选版式的视觉关系。
- 第一阶段不残留参考图原文字，也不新增不存在的装饰结构。
- 第二阶段固定文字清晰，背景连续，不出现硬切割；主体不压住核心文字。
- `@图1` 被描述为产品或人物主体时，最终主体必须来自该图。
- 线上可读取 `/style/...` 中文路径参考图，不再出现 `Failed to parse URL`。
- Logo 和搜索框默认关闭，开启后由程序正确叠加。
- 4 个策略 Markdown 在 Vercel Production Function 中可读取。
- `git diff --check` 无格式错误，且未提交密钥、输出图片或无关大文件。

## 11. 给 Claude Code 的首个任务建议

先阅读本文件、`CLAUDE.md`、`README.md` 和 `SNAPSHOT.md`，然后只处理 P0：设计并实现统一图片来源解析器，补充本地测试和 Vercel 冒烟验证。不要在同一个提交里调整 Prompt、UI 或两阶段生成策略。

## 12. 资产清理记录（2026-08-04）

- 删除六个未使用的风格目录：`y3k`、`手帐拼贴`、`毛毡风格`、`黏土萌趣`、`描边风格`、`手绘扁平涂鸦`（commit `c9f4b0d`，可从 tag `v0.1.0-oss-stable` 恢复）。
- `汇报材料/` 已从 Git 与本地删除（可从同一 tag 恢复）。
- `case/` 移出 Git 跟踪（本地保留副本，已加入 `.gitignore`），归档目标：OSS `refra-assets` 桶，路径 `oss://refra-assets/case/`。上传：`ossutil cp -r ./case oss://refra-assets/case/`（使用 RAM 用户 `refra-oss` 的密钥）。
- 已下线预设 id（服务端返回 400）：`hand_drawn_flat_doodle_v1`、`outline_style_v1`、`clay_fun_activity_poster_v1`、`scrapbook_collage_poster_v1`、`y3k_cyber_fashion_poster_v1`；对应预设常量保留为休眠数据，未再从 `presetByStyleId` / `choosePresetVariant` 引用。
- 效果：Git 跟踪体积约 592M → 470M；Vercel 部署包同步变轻。历史体积（GitHub 克隆）未变，如需进一步瘦身需重写历史（暂缓）。
- 2026-08-06：Vercel 平台对总请求体有约 850KB 实测上限，上传参考图超限会返回 503（不进入函数）。前端已做客户端压缩（600KB 总预算，1280px/WebP→JPEG 递减）；服务端对参考图总大小 >600KB 返回 413。素材库/风格图上传同样受该平台限制，后续如需大图上传应改用 OSS 直传。
