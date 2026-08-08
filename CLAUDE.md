# Claude Code 开发约束

## 开始工作前

1. 只在正式仓库 `/Users/bytedance/Documents/GitHub/refra` 工作。
2. 先阅读 `HANDOFF.md`、`README.md` 和 `SNAPSHOT.md`。
3. 执行 `git status --short --branch`、`git log -5 --oneline --decorate`。
4. 工作区可能包含用户尚未提交的修改。不得重置、覆盖或回滚不属于当前任务的改动。

## 当前技术原则

- 保持现有 Node.js 架构和前端交互，不主动引入新框架。
- 手动修改文件使用清晰、局部的补丁；不要顺手重写整个 `server.mjs`。
- API Key、访问令牌、`.env` 和用户上传内容不得提交到 Git。
- 新增运行时文件必须考虑 Vercel `/var/task` 只读、`/tmp` 临时的约束。
- 4 个策略文件必须继续由 Vercel Function 打包并可读取：`Brief理解.md`、`设计判断.md`、`检索匹配.md`、`prompt生成.md`。

## 不得破坏的生成约束

- 最终图必须同时使用 Prompt 和真实参考图。
- 用户通过 `@图N` 明确指定的主体优先级最高，不能被风格参考替换。
- 手动选择整合版式时优先使用该图；未选择时保留 AI 自动匹配。
- 第一阶段只生成文字视觉系统和整合版式，参考图原文字不能残留。
- 第二阶段把第一阶段图作为最高优先级固定画布；主体避开文字，背景和场景可以自然延伸到文字层下方。
- 禁止硬裁切、明显蒙版边界或上下割裂来制造文字安全区。
- 参考图有的装饰结构可以保留，没有的不得擅自新增。
- 兜兜开启后必须出现，并保持无手、无胳膊、无嘴巴。
- Logo 与搜索框默认关闭，开启后由程序叠加，不由图像模型绘制。

## 当前首要任务

优先修复 `HANDOFF.md` 中的 P0：服务端图片来源解析。必须建立统一解析器，正确处理：

- `http(s)` URL
- `data:` URL
- `/style/...` 等仓库静态资源
- `/uploads/...` 与 `/outputs/...` 运行时资源
- 中文、空格和 URL 编码路径

不要对服务端相对路径直接调用 `fetch('/style/...')`。实现时需要路径穿越防护、MIME 与大小校验，并为每种来源写最小测试。

## 每次修改后的最低验证

```bash
git diff --check
node --check server.mjs
```

启动本地服务进行冒烟测试：

```bash
PORT=5199 node server.mjs
curl --fail http://localhost:5199/api/health
```

涉及图片解析时，额外验证一个包含中文目录和空格的 `/style/...` 路径。涉及 Vercel 时，检查 `vercel.json` schema、策略 Markdown 打包，并在 Production Function 上完成 `/api/run` 或等价的最小冒烟测试。

## Git 规则

- 一个提交只解决一个明确问题。
- 提交前检查 `git diff --stat` 和完整 diff。
- 不提交 `outputs/`、临时上传、密钥、日志或无关素材。
- 只有用户明确要求时才 push；push 前再次确认分支和远端。
- 不使用 `git reset --hard`、`git checkout -- .` 等破坏性命令。

## 识图能力

需要识别、描述或分析图片内容时，使用 `vision.cjs` 调用 vision 模型，不要直接尝试读取图片文件：

```bash
node vision.cjs "<图片路径>" "用中文描述这张图片"
```

支持本地路径和网络 URL（后者加 `--url` 参数）。

### 触发场景

- 用户分享图片路径（本地或网络 URL）
- 消息中出现 "Saved attachments:" 并列出图片
- 用户要求分析、描述、识别图片内容

### 配置

配置在 `.env`（已 gitignore，不提交）：`DASHSCOPE_API_KEY`、`VISION_MODEL`（如 `qwen3.7-plus`）、`DASHSCOPE_BASE_URL`，说明见 `.env.example` 中的识图部分。
