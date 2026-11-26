import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import RSSParser from "rss-parser";
import { renderNewsArtifacts } from "./render-news.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataPath = resolve(root, "data/news.json");
const maxItems = 48;
const maxSummaryCharacters = 420;
const translationChunkBytes = 420;

const nasaFeeds = [
  "https://science.nasa.gov/feed/",
  "https://science.nasa.gov/?s=astrobiology&feed=rss2",
  "https://science.nasa.gov/?s=exoplanet&feed=rss2",
  "https://science.nasa.gov/?s=space%20crops&feed=rss2",
];

const cnsaPages = [
  "https://www.cnsa.gov.cn/n6758823/n6758838/index.html",
  "https://www.cnsa.gov.cn/n6758824/n6759218/index.html",
];

const nasaExoplanetsPage = "https://exoplanets.nasa.gov/news/";

const categoryRules = [
  {
    category: "地外生命",
    pattern: /\b(astrobiology|biosignature|technosignature|exoplanet|habitable|extraterrestrial|alien life|life beyond earth|search for life|signs of life)\b|地外生命|天体生物学|生命迹象|系外行星|宜居|外星生命|寻找生命/i,
  },
  {
    category: "生命支持",
    pattern: /\b(space crops?|crop candidates?|life support|biomedical|astronaut health|space biology|biological and physical|plants? in space|radiation biology|microgravity)\b|空间作物|生命支持|空间生命|生物医学|航天员健康|空间站|辐射生物|微重力|植物种子/i,
  },
  {
    category: "深空探测",
    pattern: /\b(deep space|interstellar|voyager|new horizons|heliopause|kuiper belt|solar system boundary|outer planets?)\b|深空|星际|旅行者|新视野|日球层|太阳系边际|柯伊伯带|外行星/i,
  },
  {
    category: "行星科学",
    pattern: /\b(planet|planetary|mars|martian|moon|lunar|mercury|venus|jupiter|saturn|uranus|neptune|europa|enceladus|titan|ganymede|callisto|geology|ocean world|liquid water)\b|行星|火星|月球|月壤|水星|金星|木星|土星|天王星|海王星|欧罗巴|土卫二|泰坦|地质|液态水/i,
  },
];

const excludedPattern = /obituary|in memoriam|people of nasa|budget analyst|art challenge|photo of the day|image of the day|eye of the sahara|wind tunnel|earth observation/i;

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&hellip;/gi, "…");
}

function htmlToText(value = "") {
  return decodeEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|h[1-6]|li|figure|section)>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function truncate(value, limit) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("。"), slice.lastIndexOf("！"), slice.lastIndexOf("？"));
  if (sentenceEnd > limit * 0.55) return slice.slice(0, sentenceEnd + 1).trim();
  const wordEnd = slice.lastIndexOf(" ");
  return (wordEnd > limit * 0.7 ? slice.slice(0, wordEnd) : slice).trim();
}

function summarizeHtml(value) {
  const text = htmlToText(value)
    .replace(/The post .* appeared first on .*$/i, "")
    .replace(/\[…\]|\[\.\.\.\]/g, "")
    .trim();
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [text];
  let summary = "";
  for (const sentence of sentences) {
    if (summary && summary.length + sentence.length > maxSummaryCharacters) break;
    summary += `${summary ? " " : ""}${sentence.trim()}`;
    if (summary.length >= 220) break;
  }
  return truncate(summary || text, maxSummaryCharacters);
}

function canonicalUrl(value, base) {
  if (!value || !String(value).trim()) return "";
  try {
    const url = new URL(value, base);
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["ref", "source"].includes(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function makeId(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 14);
}

function classify(title, summary) {
  if (excludedPattern.test(`${title} ${summary}`)) return "";
  const text = `${title} ${summary}`;
  return categoryRules.find((rule) => rule.pattern.test(text))?.category || "";
}

function classifyExoplanetStory(title, summary) {
  let category = classify(title, summary);
  if (category === "行星科学" && /\b(exoplanet|planet|worlds?|planetary system|star system)\b/i.test(`${title} ${summary}`)) {
    category = "地外生命";
  }
  return category;
}

function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function fetchText(url, timeout = 30000) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: { "User-Agent": "CosmosLifeAtlas/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (process.platform === "win32") {
      return execFileSync("curl.exe", ["-L", "--max-time", "30", "-A", "Mozilla/5.0", "-sS", url], {
        encoding: "utf8",
        maxBuffer: 12 * 1024 * 1024,
      });
    }
    throw error;
  }
}

function firstImageFromHtml(value, base) {
  const match = value.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  return match ? canonicalUrl(decodeEntities(match[1]), base) : "";
}

async function collectNasa() {
  const parser = new RSSParser();
  const results = await Promise.allSettled(nasaFeeds.map(async (feedUrl) => {
    const xml = await fetchText(feedUrl);
    const normalizedXml = xml.replace(/(["'])(?=[A-Za-z_:][\w:.-]*\s*=)/g, "$1 ");
    const feed = await parser.parseString(normalizedXml);
    return (feed.items || []).slice(0, 16).map((item) => {
      const url = canonicalUrl(item.link, feedUrl);
      const content = item.content || item["content:encoded"] || item.description || "";
      const imageContent = item["content:encoded"] || content;
      const title = htmlToText(item.title);
      const summary = summarizeHtml(content);
      return {
        id: makeId(url),
        source: "NASA",
        url,
        publishedAt: normalizeDate(item.isoDate || item.pubDate),
        title,
        titleOriginal: title,
        summary,
        summaryOriginal: summary,
        category: classify(title, summary),
        image: item.enclosure?.url || firstImageFromHtml(imageContent, url),
      };
    }).filter((item) => item.url && item.publishedAt);
  }));

  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!items.length) throw new Error("NASA 官方源未返回可用条目");
  return items;
}

async function collectNasaExoplanets() {
  const html = await fetchText(nasaExoplanetsPage);
  const $ = cheerio.load(html);
  const items = [];

  $(".hds-content-item.content-list-item-post").slice(0, 12).each((_, node) => {
    const card = $(node);
    const link = card.find("a.hds-content-item-heading").first();
    const url = canonicalUrl(link.attr("href"), nasaExoplanetsPage);
    const title = link.find(".hds-a11y-heading-22").first().text().replace(/\s+/g, " ").trim();
    const summary = card.find("p").first().text().replace(/\s+/g, " ").trim();
    const dateText = card.find(".label.margin-y-1").first().text().trim();
    const publishedAt = normalizeDate(dateText);
    const image = card.find("img").first().attr("src");
    let category = classifyExoplanetStory(title, summary);
    if (!url || !title || !summary || !publishedAt || !category) return;
    items.push({
      id: makeId(url),
      source: "NASA",
      url,
      publishedAt,
      title,
      titleOriginal: title,
      summary: truncate(summary, maxSummaryCharacters),
      summaryOriginal: truncate(summary, maxSummaryCharacters),
      category,
      image: canonicalUrl(image || "", nasaExoplanetsPage),
    });
  });

  return items;
}

function parseEsaDate(value) {
  const match = value.trim().match(/(\d{1,2})\s+([A-Z]{3})\.?\s+(\d{4})/i);
  if (!match) return "";
  const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const month = months[match[2].toUpperCase()];
  if (month === undefined) return "";
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]), 12)).toISOString();
}

async function collectEsa() {
  const pageUrl = "https://www.esa.int/Science_Exploration/Space_Science";
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const items = [];

  $("article.box--clickable[data-card-link]").each((_, node) => {
    const card = $(node);
    const url = canonicalUrl(card.attr("data-card-link"), pageUrl);
    const title = card.find(".box__content--title").first().text().replace(/\s+/g, " ").trim();
    const summary = card.find(".box__content--text").first().text().replace(/\s+/g, " ").trim();
    const image = card.find(".box__content--image img").first().attr("src");
    const publishedAt = parseEsaDate(card.find(".box__content--date").first().text());
    if (!url || !title || !summary || !publishedAt) return;
    items.push({
      id: makeId(url),
      source: "ESA",
      url,
      publishedAt,
      title,
      titleOriginal: title,
      summary: truncate(summary, maxSummaryCharacters),
      summaryOriginal: truncate(summary, maxSummaryCharacters),
      category: classify(title, summary),
      image: canonicalUrl(image || "", pageUrl),
    });
  });

  if (!items.length) throw new Error("ESA 官方页未返回可用条目");
  return items;
}

async function collectCnsaPage(pageUrl) {
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const items = [];

  $("li.cont_list_li").each((_, node) => {
    const row = $(node);
    const link = row.find('a[href*="/content.html"]').first();
    const url = canonicalUrl(link.attr("href"), pageUrl);
    const title = (link.attr("title") || row.find(".ejlist_cont_tit.pc").first().text()).replace(/\s+/g, " ").trim();
    const dateText = row.find(".ejlist_cont_tit_rq").first().text().replace(/\s+/g, "").trim();
    const summary = row.find(".ejlist_cont_wz.pc").first().text().replace(/\s+/g, " ").trim();
    const image = row.find("img").first().attr("src");
    const dateMatch = dateText.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!url || !title || !summary || !dateMatch) return;
    const publishedAt = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), 0)).toISOString();
    items.push({
      id: makeId(url),
      source: "国家航天局",
      url,
      publishedAt,
      title,
      titleOriginal: title,
      summary: truncate(summary, 260),
      summaryOriginal: truncate(summary, 260),
      category: classify(title, summary),
      image: image && !image.includes("/template/") ? canonicalUrl(image, pageUrl) : "",
    });
  });

  return items;
}

async function collectCnsa() {
  const results = await Promise.allSettled(cnsaPages.map((pageUrl) => collectCnsaPage(pageUrl)));
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!items.length) throw new Error("国家航天局官方页未返回可用条目");
  return items;
}

function beijingDateKey() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function chunkByBytes(text, limit = translationChunkBytes) {
  const chunks = [];
  let current = "";
  for (const character of text) {
    if (current && Buffer.byteLength(current + character, "utf8") > limit) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateText(text, email) {
  if (!text || /[\u3400-\u9fff]/.test(text)) return text;
  const translated = [];
  for (const chunk of chunkByBytes(text)) {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", chunk);
    url.searchParams.set("langpair", "en|zh-CN");
    if (email) url.searchParams.set("de", email);

    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`翻译服务 HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.responseStatus !== 200 || !payload.responseData?.translatedText) {
      throw new Error(payload.responseDetails || "翻译服务未返回结果");
    }
    translated.push(decodeEntities(payload.responseData.translatedText));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 180));
  }
  return translated.join("");
}

async function readExistingData() {
  try {
    return JSON.parse(await readFile(dataPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { items: [], translationUsage: { date: beijingDateKey(), characters: 0 } };
    throw error;
  }
}

async function main() {
  const existing = await readExistingData();
  const existingById = new Map((existing.items || []).map((item) => [item.id, item]));
  const sourceResults = await Promise.allSettled([collectNasa(), collectNasaExoplanets(), collectEsa(), collectCnsa()]);

  const successfulSources = sourceResults.filter((result) => result.status === "fulfilled");
  if (!successfulSources.length) {
    console.error("所有官方源均读取失败，保留现有数据。");
    process.exitCode = 1;
    return;
  }

  sourceResults.forEach((result, index) => {
    const name = ["NASA 综合", "NASA 系外行星", "ESA", "国家航天局"][index];
    if (result.status === "fulfilled") console.log(`${name}：读取 ${result.value.length} 条`);
    else console.warn(`${name}：读取失败（${result.reason?.message || "未知错误"}）`);
  });

  const candidates = new Map();
  for (const result of successfulSources) {
    for (const item of result.value) {
      if (!item.category) continue;
      if (!candidates.has(item.id)) candidates.set(item.id, item);
    }
  }

  const usageDate = beijingDateKey();
  const usage = existing.translationUsage?.date === usageDate
    ? { date: usageDate, characters: Number(existing.translationUsage.characters) || 0 }
    : { date: usageDate, characters: 0 };
  const dailyLimit = process.env.MYMEMORY_EMAIL ? 45000 : 4800;
  const now = new Date().toISOString();
  const pendingExisting = (existing.items || [])
    .filter((item) => item.translationPending && item.source !== "国家航天局")
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const items = [...existingById.values()]
    .map((item) => {
      const title = item.titleOriginal || item.title;
      const summary = item.summaryOriginal || item.summary;
      return {
        ...item,
        category: item.category === "地外生命" ? classifyExoplanetStory(title, summary) : classify(title, summary),
        image: item.image?.includes("/template/") ? "" : item.image,
      };
    })
    .filter((item) => item.url && item.publishedAt && item.title && item.category)
    .filter((item) => item.source !== "ESA" || item.summaryOriginal)
    .filter((item) => item.source !== "国家航天局" || item.summaryOriginal);
  const byId = new Map(items.map((item) => [item.id, item]));
  let translatedCount = 0;

  async function translateItem(item) {
    if (item.source === "国家航天局") return item;
    const titleCost = item.titleOriginal.length;
    const summaryCost = item.summaryOriginal.length;
    if (usage.characters + titleCost + summaryCost > dailyLimit) return item;

    let title = item.title;
    let summary = item.summary;
    let pending = false;
    try {
      title = await translateText(item.titleOriginal, process.env.MYMEMORY_EMAIL);
      usage.characters += titleCost;
    } catch (error) {
      console.warn(`标题翻译失败：${item.url}（${error.message}）`);
      pending = true;
    }
    try {
      summary = await translateText(item.summaryOriginal, process.env.MYMEMORY_EMAIL);
      usage.characters += summaryCost;
    } catch (error) {
      console.warn(`摘要翻译失败：${item.url}（${error.message}）`);
      pending = true;
    }

    if (!pending) translatedCount += 1;
    return {
      ...item,
      title,
      summary,
      translationPending: pending,
      lastTranslationAttemptAt: now,
    };
  }

  for (const item of pendingExisting) {
    const lastAttempt = item.lastTranslationAttemptAt ? new Date(item.lastTranslationAttemptAt).getTime() : 0;
    if (Date.now() - lastAttempt < 6 * 60 * 60 * 1000) continue;
    if (usage.characters >= dailyLimit) break;
    byId.set(item.id, await translateItem(item));
  }

  const newCandidates = [...candidates.values()]
    .filter((item) => !byId.has(item.id))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  for (const candidate of newCandidates) {
    if (usage.characters >= dailyLimit && candidate.source !== "国家航天局") {
      byId.set(candidate.id, { ...candidate, translationPending: true });
      continue;
    }
    byId.set(candidate.id, await translateItem(candidate));
  }

  for (const candidate of candidates.values()) {
    const current = byId.get(candidate.id);
    if (!current) continue;
    if (!current.image && candidate.image) current.image = candidate.image;
    if (candidate.category) current.category = candidate.category;
  }

  const merged = [...byId.values()]
    .filter((item) => item.url && item.publishedAt && item.title)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, maxItems);

  const output = {
    updatedAt: now,
    items: merged,
    translationUsage: usage,
  };

  await writeFile(dataPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await renderNewsArtifacts(merged, now);
  console.log(`已写入 ${merged.length} 条动态，本次完成中文翻译 ${translatedCount} 条，今日翻译用量 ${usage.characters}/${dailyLimit} 字符。`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
