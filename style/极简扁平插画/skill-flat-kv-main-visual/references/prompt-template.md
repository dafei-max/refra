# 完整扁平 KV 生图提示词组装模板

仅在需要生成、编辑图片或交付提示词时读取。按任务删减字段，不要机械填满。

## 新图生成

    Use case: stylized-concept 或 ads-marketing
    Asset type: <竖版/横版完整扁平 KV 海报，使用场景>
    Delivery mode: <poster-integrated | poster-composited | visual-only>
    Optimization mode: <auto | off；默认 auto>
    Input image: <参考图编号及版式/字体关系/配色/设计语法/表面风格职责；不复制具体内容>

    Copy deck:
    brand: <品牌或 none>
    main_title: <逐字准确主标题>
    subtitle: <逐字准确副标题或 none>
    time_location: <逐字准确时间地点或 none>
    price: <逐字准确价格或 none>
    auxiliary: <说明或 none>
    cta: <搜索框/二维码/网址/行动指令或 none>

    Reference contract:
    locked: <空间拓扑、30:60:10 权重、对齐轴、阅读路径、锚点、穿插、留白、字体关系、配色关系>
    replaceable: <人物/商品/具体文案/颜色值/背景内容/道具>
    forbidden_to_copy: <参考人物身份、品牌、原文案、Logo、商品和独特装饰>

    Style routing:
    subject_type: person | animal | landmark | scene | object | organic-group | mixed
    style_mode: explicit | reference-led | inferred
    primary_style: 五种 style_id 之一
    secondary_style: style_id 或 none
    style_reason: 为什么适合主体、叙事和信息组织
    reference_match: 风格库参考图文件名及各自职责；无法访问时写 reference_query

    Abstraction decision:
    abstraction_mode: relationship-first | identity-preserving
    identity_budget:
    - 对象 A: 保留 0–3 个身份特征
    - 对象 B: 保留 0–3 个身份特征
    Explicitly remove: 不需要的五官、纹理、窗户、内部结构或真实材质

    Primary request:
    用 1–2 句说明主体、陪体、动作、情绪和主题意象。

    Poster skeleton:
    标题组锚定 <区域/对齐轴>，视觉权重约 30%；
    主视觉占约 60%，通过 <方向/遮挡/共享边线> 与标题形成整体；
    <日期/价格/CTA/二维码/搜索框> 占约 10%，锚定 <底部/边角/侧边>。
    reading_path: <标题 -> 主视觉 -> 行动信息>

    Relationship skeleton:
    主焦点通过方向轴 1 / 方向轴 2 / 方向轴 3 形成整体轮廓；
    陪体嵌入主焦点负空间，通过接触、遮挡或穿插合成一个视觉单元；
    环境只保留承托色块、轴线或密度区；指定位置保持连续留白。

    Shape grammar:
    明确使用哪些几何块面，放大什么、缩小什么，哪些关节或轮廓舍弃；
    标志性主体保留哪些最低身份特征；普通环境如何压缩为关系。

    Action and silhouette:
    明确主体倾斜、伸展、步幅、重心、远端点和整体外轮廓。

    Composition:
    layout_mode: <reference-led | stacked-3-6-1 | landscape-3-6-1 | custom>
    明确画幅、十栏映射、标题/主体/行动区占比、焦点数、留白位置、前后遮挡和阅读路径。
    不使用写实镜头或摄影透视替代构图。

    Typography:
    primary_alignment: <left | center | right>
    type_hierarchy: <L1 主标题 / L2 副标题或英文 / L3 时间地点价格 / L4 CTA 的尺度和字重关系>
    glyph_style: <字形结构、笔画、字重、动势、边缘或表面>
    type_relationship: <中英文穿插、错位、共享边线/基线、括号/标签附着关系>
    把标题视为构图体块，不要在插画完成后贴进空白。

    Environment:
    只描述大色块、方向、密度、间隔、层级和运动关系。
    不逐项生成完整树木、建筑、栏杆、人群、水岸或光影。

    Color system:
    palette_mode: <reference-led | monochromatic | analogous | complementary>
    3–5 个主色 + 最多 1 个跳色；背景/最大色面 55%–70%，辅助色 20%–35%，跳色 5%–10%；说明标题、主体和 CTA 如何共享色彩系统。

    Surface system:
    outline_policy: none | colored-edge | rough-black-marker
    texture_policy: none | edge-grain | full-grain | line-jitter
    depth_policy: flat | overlap-only | shallow-layer
    从路由文件复制所选风格的几何、边缘、颗粒、深度与专属负向约束。
    主风格控制 80%–100% 的视觉语法；辅助风格最多一个且说明局部职责。

    Symbolic narrative:
    用 1–3 个大众符号传递主题，并说明每个符号承担主题、情绪、连接或平衡中的哪项职责。

    Design priority:
    先信息骨架，后具体画面；先抽象，后造型；先关系，后符号；先色块，后局部。
    保留最低必要辨识度，不复刻物体。

    Text accuracy:
    所有已提供文案必须逐字保留，不翻译、不改写、不增删；确保文字清晰可读。
    若 delivery_mode 为 poster-composited，画面模型只生成受控文字安全区与必要装饰，精确文字由独立排版层合成。

    Avoid:
    写实五官、正常关节、完整场景、物件列队、窗户砖石雕刻、内部结构、
    真实材质与高光、摄影渐变、复杂阴影、无限色阶、无职责装饰、
    普通矢量图加统一噪点、互相冲突的描边/颗粒/深度系统、
    未提供的新文案、错误文字、改写标题、标志、水印；追加所选风格的专属负向词。

## 参考图分析输出

用户先要求分析时，按以下顺序回答：

1. 结论：失败是内容没执行、关系没建立，还是表面语法没迁移。
2. 关系对比：主体占比、方向轴、陪体嵌入、环境承托和留白。
3. 抽象对比：哪些轮廓被舍弃，哪些身份特征被保留。
4. 风格路由：style_id、线条、颗粒、边缘、深度和有限色彩。
5. 普通感根因：指出模型回到了哪种安全先验。
6. 重做指令：给出 4–8 条可执行结构修改，不堆审美形容词。

## 局部编辑

    Use case: precise-object-edit
    Image 1: first output, edit target
    Image 2...N: repeat original references with their layout/type/palette/style roles when available
    Primary request: 只修改或删除一个最高优先级目标。
    Strict invariants: 逐项列出画幅、文案、主体、姿势、比例、3:6:1 拓扑、对齐轴、留白、主风格、颜色、线条和其他对象保持不变。
    Avoid: 目标残留、全图重绘、版式漂移、风格漂移、新增对象、装饰、文案、标志、水印。

一次只修一个最大问题。优先依次检查：

1. 文案是否逐字准确、完整、可读
2. 标题、主视觉、行动信息与参考契约是否保持 30:60:10 层级、阅读路径和对齐轴
3. 主焦点、关系骨架、缺失对象、误遮挡或危险裁切
4. 身份预算、动作轴与比例跳跃
5. 环境是否仍在画完整物体
6. 风格边缘、描边、颗粒和深度是否冲突
7. 色彩面积和装饰职责

精修完成后，按 [auto-optimization.md](auto-optimization.md) 比较首图与精修图；仅在问题已修复且无同级或更严重的新错误时选择精修图。
