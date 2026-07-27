const DESIGN_TERMS = [
  "poster", "campaign", "key visual", "branding", "brand identity", "editorial", "graphic design",
  "art direction", "visual design", "typography", "layout", "packaging", "illustration", "social media",
  "海报", "活动", "主视觉", "视觉", "品牌", "创意", "平面设计", "排版", "字体", "包装", "插画",
];

const HARD_NEGATIVE_TERMS = [
  "tutorial", "how to", "step by step", "review", "unboxing", "selfie", "vlog", "video cover",
  "buy now", "shop now", "coupon", "discount code", "amazon finds", "temu",
  "教程", "步骤", "测评", "开箱", "自拍", "视频封面", "购买链接", "优惠券", "折扣码",
];

const SOFT_NEGATIVE_TERMS = [
  "price", "sale", "shop", "product link", "outfit", "routine", "价格", "促销", "商品", "同款", "种草",
];

function normalizedText(item) {
  return [item.title, item.description, item.query, ...(item.__annotations || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function contentText(item) {
  return [item.title, item.description, ...(item.__annotations || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function termHits(source, terms) {
  return terms.reduce((count, term) => count + (source.includes(term) ? 1 : 0), 0);
}

function normalizedImageKey(item) {
  if (item.__imageSignature) return item.__imageSignature;
  try {
    return new URL(item.imageUrl).pathname
      .replace(/\/(?:originals|\d+x)\//, "/")
      .replace(/\/projects\/(?:max_)?(?:115|202|230|404|808)(?:_webp)?\//, "/projects/");
  } catch {
    return item.imageUrl;
  }
}

function normalizedTitleKey(title) {
  const value = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "")
    .slice(0, 80);
  return value.length >= 10 ? value : "";
}

// Metadata classifier placeholder. It can later be replaced by a CV model without changing the API shape.
export function classifyDesignType(item) {
  const source = normalizedText(item);
  if (/(packag|包装)/.test(source)) return "包装设计";
  if (/(brand identity|branding|品牌视觉|品牌设计)/.test(source)) return "品牌视觉";
  if (/(editorial|magazine|layout|排版|杂志)/.test(source)) return "编辑排版";
  if (/(illustration|插画)/.test(source)) return "插画设计";
  if (/(social media|社交|小红书|instagram)/.test(source)) return "社交传播";
  if (/(campaign|key visual|\bkv\b|活动|主视觉)/.test(source)) return "活动 KV";
  if (/(poster|海报)/.test(source)) return "海报设计";
  return "视觉设计";
}

function scoreItem(item, keyword) {
  const source = normalizedText(item);
  const content = contentText(item);
  const designHits = termHits(source, DESIGN_TERMS);
  const softNegativeHits = termHits(content, SOFT_NEGATIVE_TERMS);
  const keywordHit = keyword && content.includes(String(keyword).toLowerCase()) ? 2 : 0;
  const titleBonus = item.title && !["Pinterest 设计案例", "Behance 设计项目"].includes(item.title) ? 1.5 : 0;
  const sizeBonus = item.width >= 900 && item.height >= 900 ? 1.5 : item.width >= 600 && item.height >= 600 ? 0.8 : 0;
  return designHits * 1.8 + keywordHit + titleBonus + sizeBonus - softNegativeHits * 1.4 - (item.__isPromoted ? 1 : 0);
}

function isUsable(item) {
  if (!item?.imageUrl || !item?.thumbnailUrl || !(item?.sourceUrl || item?.pinUrl)) return false;
  if (item.__isVideo || item.__isProduct) return false;
  if (item.width < 480 || item.height < 480 || item.width * item.height < 300000) return false;
  const content = contentText(item);
  if (termHits(content, HARD_NEGATIVE_TERMS)) return false;
  return true;
}

function publicItem(item) {
  const source = item.source || "pinterest";
  const sourceUrl = item.sourceUrl || item.pinUrl || "";
  return {
    id: item.id,
    sourceId: item.sourceId || item.id,
    title: item.title,
    description: item.description,
    author: item.author || "",
    imageUrl: item.imageUrl,
    thumbnailUrl: item.thumbnailUrl,
    sourceUrl,
    pinUrl: source === "pinterest" ? sourceUrl : "",
    source,
    width: item.width,
    height: item.height,
    query: item.query,
    designType: classifyDesignType(item),
  };
}

export function filterAndRankResults(items, { keyword = "", limit = 40 } = {}) {
  const imageKeys = new Set();
  const titleKeys = new Set();
  const unique = [];

  for (const item of items) {
    if (!isUsable(item)) continue;
    const imageKey = normalizedImageKey(item);
    const titleKey = normalizedTitleKey(item.title);
    if (imageKeys.has(imageKey) || (titleKey && titleKeys.has(titleKey))) continue;
    imageKeys.add(imageKey);
    if (titleKey) titleKeys.add(titleKey);
    unique.push({ ...item, __score: scoreItem(item, keyword) });
  }

  const buckets = new Map();
  for (const item of unique.sort((a, b) => b.__score - a.__score)) {
    const key = `${Number(item.__queryIndex) || 0}:${item.source || "pinterest"}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  const ordered = [];
  const groups = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([, group]) => group);
  while (ordered.length < limit && groups.some((group) => group.length)) {
    for (const group of groups) {
      if (group.length && ordered.length < limit) ordered.push(group.shift());
    }
  }
  return ordered.map(publicItem);
}
