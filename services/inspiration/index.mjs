import { expandDesignQueries } from "./keyword-expander.mjs";
import { searchPinterestQueries } from "./pinterest-search.mjs";
import { searchBehanceQueries } from "./behance-search.mjs";
import { filterAndRankResults } from "./result-processing.mjs";

export async function searchDesignInspiration(keyword, requestedLimit = 40) {
  const normalizedKeyword = String(keyword || "").replace(/\s+/g, " ").trim();
  if (!normalizedKeyword) {
    const error = new Error("请输入设计灵感主题");
    error.statusCode = 400;
    throw error;
  }
  if (normalizedKeyword.length > 80) {
    const error = new Error("主题词请控制在 80 个字符以内");
    error.statusCode = 400;
    throw error;
  }

  const limit = Math.min(60, Math.max(1, Number(requestedLimit) || 40));
  const queries = expandDesignQueries(normalizedKeyword);
  const behanceQueries = queries.filter((query) => /[a-z]/i.test(query)).slice(-4);
  const searches = await Promise.allSettled([
    searchPinterestQueries(queries, { concurrency: 3 }),
    searchBehanceQueries(behanceQueries.length ? behanceQueries : queries.slice(0, 4), { concurrency: 2 }),
  ]);
  const items = searches.flatMap((result) => result.status === "fulfilled" ? result.value.items : []);
  if (!items.length) {
    const firstError = searches.find((result) => result.status === "rejected")?.reason;
    const error = new Error(firstError?.message || "设计灵感搜索暂时不可用");
    error.statusCode = firstError?.statusCode || 502;
    throw error;
  }
  const ranked = filterAndRankResults(items, { keyword: normalizedKeyword, limit });
  const sources = ranked.reduce((counts, item) => {
    counts[item.source] = (counts[item.source] || 0) + 1;
    return counts;
  }, {});
  return {
    keyword: normalizedKeyword,
    queries,
    items: ranked,
    total: ranked.length,
    sources,
  };
}
