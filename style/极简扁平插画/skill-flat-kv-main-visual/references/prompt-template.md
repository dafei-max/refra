# 扁平 KV 生图提示词组装模板

仅在需要生成、编辑图片或交付提示词时读取。按任务删减字段，不要机械填满。

## 新图生成

    Use case: stylized-concept 或 ads-marketing
    Asset type: 竖版/横版扁平 KV 与使用场景
    Input image: 参考图编号及角色；只迁移设计语法，不复制具体内容

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
    明确画幅、主体占比、焦点数、留白位置、前后遮挡和阅读路径。
    不使用写实镜头或摄影透视替代构图。

    Environment:
    只描述大色块、方向、密度、间隔、层级和运动关系。
    不逐项生成完整树木、建筑、栏杆、人群、水岸或光影。

    Color system:
    3–5 个主色 + 最多 1 个跳色；说明面积关系和背景纯净度。

    Surface system:
    outline_policy: none | colored-edge | rough-black-marker
    texture_policy: none | edge-grain | full-grain | line-jitter
    depth_policy: flat | overlap-only | shallow-layer
    从路由文件复制所选风格的几何、边缘、颗粒、深度与专属负向约束。
    主风格控制 80%–100% 的视觉语法；辅助风格最多一个且说明局部职责。

    Symbolic narrative:
    用 1–3 个大众符号传递主题，并说明每个符号承担主题、情绪、连接或平衡中的哪项职责。

    Design priority:
    先抽象，后造型；先关系，后符号；先色块，后局部。
    保留最低必要辨识度，不复刻物体。

    Avoid:
    写实五官、正常关节、完整场景、物件列队、窗户砖石雕刻、内部结构、
    真实材质与高光、摄影渐变、复杂阴影、无限色阶、无职责装饰、
    普通矢量图加统一噪点、互相冲突的描边/颗粒/深度系统、
    未经要求的文字、标志、水印；追加所选风格的专属负向词。

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
    Input image: Image 1 is the edit target.
    Primary request: 只修改或删除唯一目标。
    Strict invariants: 逐项列出主体、姿势、比例、构图、风格、颜色、线条和其他对象保持不变。
    Avoid: 目标残留、重画主体、新增装饰、文字、标志、水印。

一次只修一个最大问题。优先依次检查：

1. 主焦点与关系骨架
2. 身份预算是否过多或不足
3. 动作轴与比例跳跃
4. 环境是否仍在画完整物体
5. 风格边缘、颗粒和深度是否冲突
6. 色彩面积和装饰职责
