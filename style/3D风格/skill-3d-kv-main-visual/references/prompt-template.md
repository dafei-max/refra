# 生图提示词组装模板

仅在需要生成、编辑图片或交付提示词时读取。按任务删减字段，不要机械填满。

## 目录

- 新图生成
- 参考图分析输出
- 局部编辑

## 新图生成

```text
Use case: stylized-concept 或 ads-marketing
Asset type: <竖版/横版完整 KV 海报，使用场景>
Delivery mode: <poster-integrated | poster-composited | visual-only>
Optimization mode: <auto | off；默认 auto>
Input image: <参考图编号及角色：版式/字体关系/配色/设计语法/材质参考，不复制具体内容>

Copy deck:
brand: <品牌或 none>
main_title: <逐字准确主标题>
subtitle: <逐字准确副标题或 none>
time_location: <逐字准确时间地点或 none>
auxiliary: <利益点/说明或 none>
cta: <搜索框/二维码/网址/行动指令或 none>

Reference contract:
locked: <空间拓扑、30:60:10 权重、对齐轴、阅读路径、锚点、穿插、留白、字体关系、配色关系>
replaceable: <人物/商品/具体文案/颜色值/背景内容/道具>
forbidden_to_copy: <参考图人物身份、品牌、原文案、Logo、商品和独特装饰>

Material routing（3D 任务必填）:
subject_type: <character | animal | product | object | abstract | mixed>
primary_material: <材质 ID>
secondary_material: <材质 ID 或 none>
material_reason: <为什么该材质适合主体与主题>
reference_match: <风格库参考图文件名及各自职责；无法访问时写 reference_query>

Primary request:
<用一两句说明人物/商品/动物、服装道具、核心动作和情绪>

Poster skeleton:
标题组锚定 <区域/对齐轴>，视觉权重约 30%；
主视觉占约 60%，通过 <方向/遮挡/共享边线> 与标题形成一个整体；
<日期/CTA/二维码/搜索框> 占约 10%，锚定 <底部/边角/侧边>。
reading_path: <标题 -> 主视觉 -> 行动信息>

Relationship skeleton:
<主体> 通过 <方向轴 1 / 方向轴 2 / 方向轴 3> 形成 <大轮廓>；
<陪体> 嵌入 <主体负空间>，通过 <接触/遮挡/穿插> 与主体合成一个视觉单元；
<环境色块> 仅承担 <承托/平衡/分层>；<位置> 保持连续留白。

Shape grammar:
禁止标准 Q 版和正常人体解剖。明确写出：
- 哪个部位缩小
- 哪个部位放大
- 哪个部位形成连续管状/块状体
- 哪些关节弱化
- 哪个近端体块最大
- 动物或物品如何被抽象

Action and silhouette:
<手脚远离身体的幅度、肩髋高低差、身体扭/压/撑/顶/倾、整体方向>

Composition and camera:
layout_mode: <reference-led | stacked-3-6-1 | landscape-3-6-1 | custom>
<画幅、十栏映射、标题/主体/行动区占比、焦点数、留白位置、镜头角度、近大远小强度>
镜头服务于姿态；无必要不使用鱼眼。

Typography:
primary_alignment: <left | center | right>
type_hierarchy: <L1 主标题 / L2 副标题或英文 / L3 时间地点 / L4 CTA 的尺度和字重关系>
glyph_style: <字形结构、笔画、字重、动势、表面>
type_relationship: <中英文穿插、错位、共享边线/基线、括号/标签附着关系>
把标题视为构图体块，不要生成画面后再把文字贴进空白。

Environment:
干净背景。环境只保留 <方向/密度/间隔/层级/色彩>；
最多 <0–2> 个装饰节点，并说明每个节点的构图职责。
不要自动加入环绕曲线、星星、花朵、粒子和漂浮小物。

Color and material:
palette_mode: <reference-led | monochromatic | analogous | complementary>
<背景/最大色面 55%–70%，辅助色 20%–35%，跳色 5%–10%；说明文字与主体如何共享色彩系统>
<从材质路由文件复制所选材质的几何、表面、光照和专属负向约束>
主材质控制约 70%–100% 的视觉面积；辅助材质最多一个且说明分配位置。

Design priority:
先信息骨架，后具体画面；先关系，后物体；先轮廓，后内部；先大小方向和遮挡，后五官服装。
主体复杂、环境简单；宁可有意失真，也不要安全普通。

Text accuracy:
所有已提供文案必须逐字保留，不翻译、不改写、不增删；确保文字清晰可读。
若 delivery_mode 为 poster-composited，画面模型只生成受控的文字安全区与必要装饰，精确文字由独立排版层合成。

Avoid:
普通大头 Q 版、标准人体、拘谨站姿、人物与陪体并排、道具列队、完整场景、
无职责装饰、平均配色、脏灰、互相冲突的材质、只贴表面纹理、过强鱼眼、
未提供的新文案、错误文字、改写标题、伪造 Logo、标志、水印；追加所选材质的专属负向词。
```

## 参考图分析输出

用户先要求分析时，按以下顺序回答：

1. 结论：失败是内容没执行，还是设计语法没迁移。
2. 关系对比：主体占比、动作轴、陪体嵌入、环境承托、留白。
3. 造型对比：头身、肢体、关节、局部尺度、体块连续性。
4. 普通感根因：指出模型回到了哪种安全先验。
5. 重做指令：给出 4–8 条可执行结构修改，不堆审美形容词。

## 局部编辑

```text
Use case: precise-object-edit
Input image: Image 1 is the edit target.
Original references: Image 2...N repeat the original layout/type/palette/material roles when available.
Primary request: 只修改/删除 <唯一目标>。
Strict invariants: <逐项列出画幅、文案、人物、姿势、比例、3:6:1 拓扑、对齐轴、留白、材质、颜色、光影和其他对象保持不变>。
Avoid: <目标残留、全图重绘、版式漂移、风格漂移、新增对象、装饰、文案、标志、水印>。
```

一次只修一个最大问题。若整体仍普通，优先依次检查：

1. 主体轮廓是否张开
2. 比例是否有显著跳跃
3. 陪体是否嵌入负空间
4. 环境是否仍在逐项描述物体
5. 装饰是否可以删除
6. 标题、主视觉、行动信息是否形成 30:60:10 层级
7. 文字是否有统一对齐轴和字形关系
8. 配色是否只使用一种主策略

精修完成后，按 [auto-optimization.md](auto-optimization.md) 比较首图与精修图；仅在问题已修复且无同级或更严重的新错误时选择精修图。
