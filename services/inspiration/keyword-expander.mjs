const TERM_TRANSLATIONS = new Map([
  ["美妆", "beauty cosmetics"],
  ["彩妆", "makeup beauty"],
  ["护肤", "skincare beauty"],
  ["宠物", "pet"],
  ["猫", "cat pet"],
  ["狗", "dog pet"],
  ["夏日", "summer"],
  ["七夕", "qixi chinese valentine"],
  ["咖啡", "coffee"],
  ["家具", "furniture"],
  ["家居", "home living"],
  ["食品", "food"],
  ["饮品", "beverage"],
  ["茶", "tea"],
  ["服装", "fashion"],
  ["运动", "sports"],
  ["旅行", "travel"],
  ["春日", "spring"],
  ["秋日", "autumn"],
  ["冬日", "winter"],
  ["儿童", "kids"],
  ["科技", "technology"],
]);

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function englishTopic(keyword) {
  const translatedWords = [];
  for (const [term, translation] of TERM_TRANSLATIONS) {
    if (keyword.includes(term)) translatedWords.push(...translation.split(/\s+/));
  }
  return translatedWords.length ? [...new Set(translatedWords)].join(" ") : keyword;
}

export function expandDesignQueries(input) {
  const keyword = compact(input);
  if (!keyword) return [];
  const english = englishTopic(keyword);
  const candidates = [
    `${keyword} 海报 视觉设计`,
    `${keyword} 活动 KV 主视觉`,
    `${keyword} 品牌 campaign 设计`,
    `${keyword} 创意排版 平面设计`,
    `${english} campaign key visual design`,
    `${english} poster graphic design`,
    `${english} branding editorial art direction`,
    `${english} social media campaign visual`,
  ];

  return [...new Set(candidates.map(compact).filter(Boolean))].slice(0, 8);
}
