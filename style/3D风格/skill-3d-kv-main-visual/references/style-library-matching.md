# 3D 风格库命名与匹配

仅在平台提供可检索风格库、候选参考图、素材索引或参考图目录时读取。材质判断使用 [3d-material-routing.md](3d-material-routing.md)。

## 文件命名

统一使用：

```text
3d-{material_id}-{subject_type}-{nnn}.{ext}
```

- `material_id`：必须使用材质路由表中的稳定英文 ID。
- `subject_type`：`character`、`animal`、`product`、`object`、`abstract` 或 `mixed`。
- `nnn`：同类别内三位递增编号，从 `001` 开始。
- 文件名只用小写英文字母、数字和连字符，不写中文、空格、日期或来源平台。

当前参考图建议命名：

| 参考图内容 | 建议文件名 |
| --- | --- |
| 软陶人物、动物或商品参考 | `3d-clay-character-001.png`、`3d-clay-animal-001.png`、`3d-clay-product-001.png` |
| 绿色设备＋糖果软胶果冻元素 | `3d-soft-vinyl-jelly-object-001.png` |
| 玩具机器人＋局部植绒森林 | `3d-soft-vinyl-flocked-character-001.png` |
| 粉色长绒符号＋毛毡手提袋 | `3d-plush-fur-object-001.png` |
| 针织舞龙头套人物 | `3d-knit-textile-character-001.png` |

若一张图包含多种对象，按承担最大视觉面积和主要叙事的主体命名，不按配件命名。

## 索引字段

不要只依赖文件名。平台风格库至少记录：

| 字段 | 内容 |
| --- | --- |
| `reference_id` | 稳定唯一 ID |
| `file_name` | 遵循统一命名的文件名 |
| `material_id` | 主材质 ID |
| `subject_type` | 主体类型 |
| `secondary_material` | 辅助材质或 `none` |
| `composition_tags` | 如 `low-angle`、`close-up`、`centered-cluster`、`large-negative-space` |
| `mood_tags` | 如 `dopamine`、`cozy`、`futuristic`、`handmade` |
| `palette_tags` | 2–4 个颜色或色彩倾向标签 |
| `suitable_for` | 适合主题与对象 |
| `avoid_for` | 不适合主题与对象 |
| `quality_score` | 统一尺度的质量评分 |

## 检索顺序

1. 用 `primary_material` 做硬过滤。
2. 优先匹配相同 `subject_type`；没有时使用 `mixed`，再使用轮廓相近的类型。
3. 按构图标签匹配主体占比、镜头、留白和动作关系。
4. 按情绪与配色标签做次级排序，不因颜色相似覆盖材质和构图判断。
5. 质量分只用于同等匹配条件下的排序。
6. 选择 1–3 张参考图：一张作为主设计语法参考；必要时再加一张材质近景或一张构图参考。

不要同时选取材质语法冲突的参考图，例如用 `clay` 和 `soft-vinyl-jelly` 同时约束同一主体表面。

## 参考图角色标注

在生图提示词中逐张声明职责：

```text
Image 1: primary design-grammar reference; learn silhouette, scale jumps, occlusion and composition only.
Image 2: material reference; learn the selected material's surface, edge behavior and lighting only.
Image 3: composition reference; learn subject placement and negative space only.
```

继续声明：不得复制参考图中的人物身份、商品结构、服装、文字、Logo、品牌和装饰。若同一张图同时承担设计语法与材质参考，只列一次并写明两个职责。

## 无法访问风格库时

- 仍完成材质路由并输出 `reference_query`，供平台上层检索。
- 已有用户上传参考图时直接分析并使用，不要求文件名已经符合规范。
- 没有任何参考图时，根据材质规则继续生成，但不要声称已匹配风格库。
