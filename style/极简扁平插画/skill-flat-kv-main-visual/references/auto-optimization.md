# 智能二次优化

## 1. 默认行为

只要本 skill 实际生成图片，默认执行：**首图立即保留 → 自动审核 → 按需精修一次 → 两版择优**。

```text
optimization_mode: auto
max_automatic_edits: 1
first_output_policy: keep-and-review
```

“自动二次优化”表示审核必做，不表示第二张图必做。首图通过时直接交付；用户明确要求“只生成一次、不要二次优化”时设为 `off`。

## 2. 首图审核优先级

1. **文案准确性**：主标题、副标题、日期、价格、地点、CTA 是否逐字正确、完整、可读；Logo 是否被伪造。
2. **版式与参考契约**：3:6:1 权重、阅读路径、主对齐轴、锚点、错位、穿插、裁切和连续留白是否成立。
3. **主体与关系骨架**：核心人物、商品、动作、陪体是否缺失、错误、畸变、误遮挡或危险裁切；是否退回多个完整物体并排。
4. **扁平风格系统**：`primary_style` 是否正确；描边、边缘、颗粒和深度是否统一；是否退回精致商业矢量、统一噪点或写实阴影。
5. **配色与装饰**：是否只使用一种主配色逻辑；色面比例是否清楚；装饰是否抢焦点或破坏行动区。

审核必须基于首图实际结果，不得因为提示词完整就默认通过。

## 3. 是否精修

- `pass`：不调用第二次生成，选择首图，记录 `optimization_status: pass_first`。
- `fail`：只选择一项最高优先级且可明确定位的问题，触发一次 `precise-object-edit`。
- 多个问题并存时仍只修第一优先级问题；不得借机重做版式、换主风格、增加创意或补充未要求的元素。

若精确文字必须逐字正确且当前为生成式文字，优先转为 `poster-composited` 的确定性文字层修正，不重画整张插画。

## 4. 精修调用契约

```text
Use case: precise-object-edit
Image 1: first output, edit target
Image 2...N: original references, repeated with their original roles
Primary request: only fix <one highest-priority issue>
Strict invariants:
- canvas and aspect ratio
- copy deck except the exact text target being corrected
- subject identity, pose, scale, silhouette, crop and relationship skeleton
- 3:6:1 topology, alignment axes, reading path and negative space
- palette, primary/secondary style, outline, texture and depth policies
- all other objects, typography relationships and decorations
Avoid: redesign, global regeneration, new objects, new copy, new decoration, style drift, layout drift
```

原始参考图存在时必须再次传入，并保留“版式参考、字体关系参考、配色参考、设计语法参考或表面风格参考”标签。首图只能标为编辑目标，不能替代原始参考图职责。

## 5. 两版择优

- 目标问题已修复，且没有新增同级或更高优先级问题：选择精修图，记录 `edited_selected`。
- 目标未修复、整体漂移、参考契约破坏，或产生同级/更严重的新问题：回退首图，记录 `edited_rejected`。

```text
optimization_status: pass_first | edited_selected | edited_rejected
selected_output: first | second
optimized_issue: <none 或唯一问题>
automatic_edit_count: 0 | 1
```

不得自动发起第三次生成。需要继续改时，等待用户明确反馈。
