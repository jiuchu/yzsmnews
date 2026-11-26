import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const newsDir = resolve(root, "news");
const rssPath = resolve(root, "rss.xml");
const siteUrl = (process.env.SITE_URL || "https://jiuchu.github.io/yzsmnews/").replace(/\/?$/, "/");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value = "") {
  return escapeHtml(value).replace(/&apos;/g, "'");
}

function safeImageUrl(value = "") {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function sourceClass(source) {
  if (source === "NASA") return "nasa";
  if (source === "ESA") return "esa";
  return "cnsa";
}

function sourceUrl(source) {
  if (source === "NASA") return "https://science.nasa.gov/";
  if (source === "ESA") return "https://www.esa.int/";
  return "https://www.cnsa.gov.cn/";
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日期待核实" : dateFormatter.format(date);
}

function articleUrl(item) {
  return new URL(`news/${encodeURIComponent(item.id)}.html`, siteUrl).href;
}

function absoluteImage(item) {
  return safeImageUrl(item.image) || new URL("textures-1k/2k_earth_daymap.jpg", siteUrl).href;
}

function relatedItems(item, items) {
  const sameCategory = items.filter((candidate) => candidate.id !== item.id && candidate.category === item.category);
  const others = items.filter((candidate) => candidate.id !== item.id && candidate.category !== item.category);
  return [...sameCategory, ...others].slice(0, 3);
}

function renderDetailPage(item, items) {
  const url = articleUrl(item);
  const image = safeImageUrl(item.image);
  const imageSrc = image || "../textures-1k/2k_earth_daymap.jpg";
  const related = relatedItems(item, items);
  const originalTitle = item.titleOriginal && item.titleOriginal !== item.title
    ? `<section class="article-original"><span>英文原标题</span><p>${escapeHtml(item.titleOriginal)}</p></section>`
    : "";
  const pending = item.translationPending ? '<span class="pending-badge">英文原文</span>' : "";
  const relatedHtml = related.length
    ? `<section class="related-section"><h2>相关阅读</h2><div class="related-grid">${related.map((candidate) => `
        <a class="related-card" href="${escapeHtml(candidate.id)}.html">
          <strong>${escapeHtml(candidate.title)}</strong>
          <span>${escapeHtml(candidate.source)} · ${escapeHtml(formatDate(candidate.publishedAt))}</span>
        </a>`).join("")}</div></section>`
    : "";
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: item.title,
    description: item.summary,
    datePublished: item.publishedAt,
    dateModified: item.publishedAt,
    image: [absoluteImage(item)],
    inLanguage: "zh-CN",
    mainEntityOfPage: url,
    url,
    author: { "@type": "Organization", name: item.source, url: sourceUrl(item.source) },
    publisher: { "@type": "Organization", name: "宇宙生命", url: siteUrl },
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(item.summary)}">
  <meta name="theme-color" content="#05070d">
  <title>${escapeHtml(item.title)} · 宇宙生命</title>
  <link rel="canonical" href="${escapeHtml(url)}">
  <link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="宇宙生命 · 官方动态" href="../rss.xml">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:site_name" content="宇宙生命">
  <meta property="og:title" content="${escapeHtml(item.title)}">
  <meta property="og:description" content="${escapeHtml(item.summary)}">
  <meta property="og:url" content="${escapeHtml(url)}">
  <meta property="og:image" content="${escapeHtml(absoluteImage(item))}">
  <meta property="article:published_time" content="${escapeHtml(item.publishedAt)}">
  <link rel="stylesheet" href="../styles.css">
  <script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <div class="space-background" aria-hidden="true"></div>
  <header class="site-header">
    <a class="brand" href="../index.html" aria-label="宇宙生命首页">
      <span class="brand-mark" aria-hidden="true"><span></span></span>
      <span class="brand-text">宇宙生命</span>
    </a>
    <nav class="main-nav" aria-label="主导航">
      <a href="../index.html#latest">最新动态</a>
      <a href="../index.html#topics">主题</a>
      <a href="../index.html#sources">信息来源</a>
    </nav>
    <a class="rss-link" href="../rss.xml">RSS 订阅 <span aria-hidden="true">↗</span></a>
  </header>
  <main class="article-main">
    <article>
      <p class="article-kicker">${escapeHtml(item.category)}</p>
      <h1 class="article-title">${escapeHtml(item.title)}</h1>
      <div class="article-meta">
        <span class="source-badge ${sourceClass(item.source)}">${escapeHtml(item.source)}</span>
        <span class="category-badge">${escapeHtml(item.category)}</span>
        <time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(formatDate(item.publishedAt))}</time>
        ${pending}
      </div>
      <img class="article-cover" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(item.title)}" referrerpolicy="no-referrer">
      <p class="article-summary">${escapeHtml(item.summary)}</p>
      ${originalTitle}
      <p class="article-notice">中文内容为机器翻译摘要，请以官方原文为准。规划、假设与已确认发现均按来源表述保留区别。</p>
      <div class="article-actions">
        <a class="primary-button" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">阅读官方原文 <span aria-hidden="true">↗</span></a>
        <a class="secondary-button" href="../index.html">返回首页</a>
      </div>
    </article>
    ${relatedHtml}
  </main>
  <footer class="site-footer">
    <a class="brand footer-brand" href="../index.html"><span class="brand-mark" aria-hidden="true"><span></span></span><span class="brand-text">宇宙生命</span></a>
    <p>关于生命、星球与远方。</p>
    <a href="../index.html#latest" class="back-to-top">查看更多动态 ↑</a>
  </footer>
</body>
</html>`;
}

function renderRss(items, updatedAt) {
  const entries = items.map((item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(articleUrl(item))}</link>
      <guid isPermaLink="true">${escapeXml(articleUrl(item))}</guid>
      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>
      <dc:creator>${escapeXml(item.source)}</dc:creator>
      <source url="${escapeXml(sourceUrl(item.source))}">${escapeXml(item.source)}</source>
      <category>${escapeXml(item.category)}</category>
      <description><![CDATA[${String(item.summary || "").replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></description>
      <content:encoded><![CDATA[<p>${String(item.summary || "").replace(/</g, "&lt;").replace(/]]>/g, "]]]]><![CDATA[>")}</p><p><a href="${escapeXml(item.url)}">阅读官方原文</a></p>]]></content:encoded>
    </item>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>宇宙生命 · 官方动态</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>汇集 NASA、ESA 与中国国家航天局公开发布的宇宙生命、系外行星、行星科学、生命支持和深空探测动态。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date(updatedAt).toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(new URL("rss.xml", siteUrl).href)}" rel="self" type="application/rss+xml" />
    <managingEditor>noreply@jiuchu.top (宇宙生命)</managingEditor>
${entries}
  </channel>
</rss>`;
}

export async function renderNewsArtifacts(items, updatedAt) {
  await mkdir(newsDir, { recursive: true });
  const keep = new Set(items.map((item) => `${item.id}.html`));
  for (const file of await readdir(newsDir)) {
    if (file.endsWith(".html") && !keep.has(file)) await unlink(resolve(newsDir, file));
  }
  await Promise.all(items.map((item) => writeFile(resolve(newsDir, `${item.id}.html`), renderDetailPage(item, items), "utf8")));
  await writeFile(rssPath, renderRss(items, updatedAt), "utf8");
}
