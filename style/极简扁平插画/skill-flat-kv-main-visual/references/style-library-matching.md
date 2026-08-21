# 扁平风格库命名与匹配

仅在平台提供可检索风格库、候选参考图、素材索引或参考图目录时读取。风格判断使用 [flat-style-routing.md](flat-style-routing.md)。

## 文件命名

统一使用：

    flat-{style_id}-{subject_type}-{nnn}.{ext}

- style_id：必须使用五风格路由表中的稳定英文 ID。
- subject_type：person、animal、landmark、scene、object、organic-group 或 mixed。
- nnn：同类别内三位递增编号，从 001 开始。
- 文件名只使用小写英文字母、数字和连字符，不写中文、空格、日期或来源平台。

当前五张基准参考图：

| style_id | 文件 | 主体类型 | 主要职责 |
| --- | --- | --- | --- |
| blocky-grain-geometric | assets/style-library/flat-blocky-grain-geometric-person-001.png | person | 人物比例、硬朗块面、动态轴、有限撞色、粗粝边缘 |
| sticker-collage-grain | assets/style-library/flat-sticker-collage-grain-organic-group-001.png | organic-group | 独立贴纸模块、自然符号并置、彩色毛边、柔和喷绘颗粒 |
| layered-print-relief | assets/style-library/flat-layered-print-relief-object-001.png | object | 桌面物件块面化、浅层厚度、胶印颗粒与色块错位 |
| clean-vector-whimsy | assets/style-library/flat-clean-vector-whimsy-mixed-001.png | mixed | 清爽几何、人物与拟人景物、幻想关系、干净留白 |
| marker-outline-doodle | assets/style-library/flat-marker-outline-doodle-mixed-001.png | mixed | 粗黑抖线、纯色平涂、拟人符号、中心涂鸦拼贴 |

若一张图包含多种对象，按承担最大视觉面积和主要叙事的主体命名，不按配件命名。

## 索引字段

不要只依赖文件名。平台风格库至少记录：

| 字段 | 内容 |
| --- | --- |
| reference_id | 稳定唯一 ID |
| file_name | 遵循统一命名的文件名 |
| style_id | 主风格 ID |
| subject_type | 主体类型 |
| secondary_style | 辅助风格或 none |
| abstraction_mode | relationship-first 或 identity-preserving |
| composition_tags | 如 dynamic-stride、sticker-grid、tabletop-cluster、large-negative-space |
| mood_tags | 如 energetic、spring、cozy、relaxed、humorous |
| palette_tags | 2–4 个颜色或色彩倾向标签 |
| suitable_for | 适合主题与对象 |
| avoid_for | 不适合主题与对象 |
| quality_score | 统一尺度的质量评分 |

## 检索顺序

1. 用 primary_style 做硬过滤，禁止跨风格平均混选。
2. 优先匹配相同 subject_type；没有时使用 mixed，再使用轮廓和信息组织相近的类型。
3. 按构图标签匹配主体占比、方向轴、留白和模块关系。
4. 按 abstraction_mode 判断需要关系优先还是身份保留。
5. 按情绪与配色标签做次级排序，不因颜色相似覆盖风格和构图判断。
6. quality_score 只用于同等匹配条件下排序。
7. 选择 1–3 张参考图：一张主设计语法参考；必要时再加一张表面风格参考或一张构图参考。

检索条件：

    reference_query: style_id + subject_type + composition + emotion + abstraction_mode

不要选择表面语法冲突的参考图来约束同一主体，例如同时使用 clean-vector-whimsy 和 marker-outline-doodle 决定全图边缘。

## 参考图角色标注

在生图提示词中逐张声明职责：

    Image 1: primary design-grammar reference; learn silhouette, scale jumps, occlusion and composition only.
    Image 2: surface-style reference; learn edge, outline, grain and depth behavior only.
    Image 3: composition reference; learn subject placement and negative space only.

继续声明：不得复制参考图中的人物身份、商品结构、文字、Logo、品牌和装饰。若同一张图同时承担设计语法与表面风格参考，只列一次并写明两个职责。

## 无法访问风格库时

- 仍完成风格路由并输出 reference_query，供平台上层检索。
- 已有用户上传参考图时直接分析并使用，不要求文件名已经符合规范。
- 没有任何参考图时，根据风格规则继续生成，但不要声称已匹配风格库。
