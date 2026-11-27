const state = {
  items: [],
  category: "全部",
  source: "全部",
  dateRange: "all",
  sort: "latest",
  query: "",
  visible: 9,
  updatedAt: null,
};

const elements = {
  grid: document.querySelector("#news-grid"),
  featured: document.querySelector("#featured-card"),
  count: document.querySelector("#item-count"),
  sourceCount: document.querySelector("#source-count"),
  lastUpdated: document.querySelector("#last-updated"),
  updateStatus: document.querySelector("#update-status-text"),
  resultsCount: document.querySelector("#results-count"),
  empty: document.querySelector("#empty-state"),
  loadMore: document.querySelector("#load-more"),
  search: document.querySelector("#search-input"),
  sourceFilter: document.querySelector("#source-filter"),
  dateFilter: document.querySelector("#date-filter"),
  sortFilter: document.querySelector("#sort-filter"),
  chips: [...document.querySelectorAll(".topic-chip")],
  dialog: document.querySelector("#news-dialog"),
  dialogContent: document.querySelector("#dialog-content"),
  dialogClose: document.querySelector("#dialog-close"),
};

const beijingFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value, withYear = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期待核实";
  return (withYear ? dateFormatter : beijingFormatter).format(date);
}

function safeImageUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.href);
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

function sourceLabel(source) {
  if (source === "NASA") return "NASA";
  if (source === "ESA") return "ESA";
  return "国家航天局";
}

function fallbackImage() {
  return "textures-1k/2k_earth_daymap.jpg";
}

function makeImage(item, className, eager = false) {
  const image = createElement("img", className);
  image.src = safeImageUrl(item.image) || fallbackImage();
  image.alt = "";
  image.loading = eager ? "eager" : "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => {
    if (image.src !== new URL(fallbackImage(), window.location.href).href) {
      image.src = fallbackImage();
    }
  }, { once: true });
  return image;
}

function makeMeta(item) {
  const meta = createElement("div", "card-meta");
  meta.append(createElement("span", `source-badge ${sourceClass(item.source)}`, sourceLabel(item.source)));
  meta.append(createElement("span", "category-badge", item.category));
  meta.append(createElement("span", "", formatDate(item.publishedAt, true)));
  if (item.translationPending) meta.append(createElement("span", "pending-badge", "英文原文"));
  else if (item.contentTranslationPending) meta.append(createElement("span", "pending-badge", "英文全文"));
  return meta;
}

function renderFeatured() {
  const item = state.items[0];
  elements.featured.replaceChildren();

  if (!item) {
    const empty = createElement("div", "error-state");
    empty.append(createElement("h3", "", "暂无动态"));
    empty.append(createElement("p", "", "官方信息更新后将在这里显示。"));
    elements.featured.append(empty);
    return;
  }

  const inner = createElement("div", "featured-inner");
  const media = createElement("div", "featured-media");
  media.append(makeImage(item, "", true));

  const body = createElement("div", "featured-body");
  const meta = createElement("div", "card-meta");
  meta.append(createElement("span", `source-badge ${sourceClass(item.source)}`, sourceLabel(item.source)));
  meta.append(createElement("span", "category-badge", item.category));
  meta.append(createElement("span", "", formatDate(item.publishedAt, true)));

  const title = createElement("h3", "featured-title", item.title);
  const summary = createElement("p", "featured-summary", item.summary);
  const link = createElement("a", "read-link", "阅读这条动态");
  link.href = `news/${encodeURIComponent(item.id)}.html`;
  link.append(createElement("span", "", "→"));

  body.append(meta, title, summary, link);
  inner.append(media, body);
  elements.featured.append(inner);
}

function filteredItems() {
  const query = state.query.trim().toLocaleLowerCase("zh-CN");
  const referenceTime = new Date(state.updatedAt || Date.now()).getTime();
  const cutoff = state.dateRange === "all" ? 0 : referenceTime - Number(state.dateRange) * 24 * 60 * 60 * 1000;
  const items = state.items.filter((item) => {
    const categoryMatch = state.category === "全部" || item.category === state.category;
    const sourceMatch = state.source === "全部" || item.source === state.source;
    const dateMatch = !cutoff || new Date(item.publishedAt).getTime() >= cutoff;
    if (!categoryMatch || !sourceMatch || !dateMatch) return false;
    if (!query) return true;
    return [item.title, item.titleOriginal, item.summary, item.summaryOriginal, item.source]
      .filter(Boolean)
      .some((text) => text.toLocaleLowerCase("zh-CN").includes(query));
  });
  return items.sort((a, b) => {
    const difference = new Date(b.publishedAt) - new Date(a.publishedAt);
    return state.sort === "oldest" ? -difference : difference;
  });
}

function makeCard(item) {
  const card = createElement("article", "news-card");

  const media = createElement("div", "card-media");
  media.append(makeImage(item, ""));

  const body = createElement("div", "card-body");
  const heading = createElement("h3", "card-heading");
  const title = createElement("a", "card-title", item.title);
  title.href = `news/${encodeURIComponent(item.id)}.html`;
  title.addEventListener("click", (event) => event.stopPropagation());
  heading.append(title);
  const summary = createElement("p", "card-summary", item.summary);
  const footer = createElement("div", "card-footer");
  footer.append(createElement("span", "", formatDate(item.publishedAt, true)));
  footer.append(createElement("a", "card-open", "详情 ↗"));
  footer.lastElementChild.href = `news/${encodeURIComponent(item.id)}.html`;
  footer.lastElementChild.addEventListener("click", (event) => event.stopPropagation());

  body.append(makeMeta(item), heading, summary, footer);
  card.append(media, body);
  card.addEventListener("click", () => openDialog(item));
  return card;
}

function writeFiltersToUrl() {
  const url = new URL(window.location.href);
  const values = {
    category: state.category === "全部" ? "" : state.category,
    source: state.source === "全部" ? "" : state.source,
    days: state.dateRange === "all" ? "" : state.dateRange,
    sort: state.sort === "latest" ? "" : state.sort,
    q: state.query,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", url);
}

function renderGrid() {
  writeFiltersToUrl();
  const items = filteredItems();
  const visibleItems = items.slice(0, state.visible);
  elements.grid.replaceChildren(...visibleItems.map(makeCard));
  elements.resultsCount.textContent = `共 ${items.length} 条动态`;
  elements.empty.hidden = items.length !== 0;
  elements.grid.hidden = items.length === 0;
  elements.loadMore.hidden = items.length <= state.visible;
}

function renderStats() {
  elements.count.textContent = String(state.items.length);
  elements.sourceCount.textContent = String(new Set(state.items.map((item) => item.source)).size);
  if (state.updatedAt) {
    const formatted = formatDate(state.updatedAt);
    elements.lastUpdated.textContent = formatted;
    elements.updateStatus.textContent = `自动更新 · ${formatted}`;
  }
}

function hasChinese(value = "") {
  return /[\u3400-\u9fff]/.test(value);
}

function appendDialogFullText(body, item) {
  const original = String(item.contentOriginal || "").trim();
  const translated = hasChinese(item.content) ? String(item.content).trim() : "";
  const fullText = translated || original;
  const section = createElement("section", "article-content-section dialog-fulltext");
  section.append(createElement("h2", "", translated ? "全文" : "英文全文"));

  if (fullText) {
    const content = createElement("div", "article-content");
    fullText.split(/\n{2,}/).filter(Boolean).forEach((paragraph) => {
      content.append(createElement("p", "", paragraph.replace(/\n/g, " ")));
    });
    section.append(content);
  } else {
    section.append(createElement("p", "article-notice", "全文暂未采集成功，下次自动更新会重试。当前展示官方摘要。"));
  }

  body.append(section);
  if (translated) {
    body.append(createElement("p", "article-notice", "中文全文为机器翻译，请以官方原文为准。"));
  } else if (original) {
    body.append(createElement("p", "article-notice", "中文全文尚未完成翻译，以下先展示官方英文全文；下次自动更新会继续补译。"));
  }
}

function appendDialogRelatedSources(body, item) {
  const sources = (item.relatedSources || []).filter((source) => safeImageUrl(source.url) && (source.title || source.titleOriginal));
  if (!sources.length) return;

  const section = createElement("section", "dialog-related-sources");
  section.append(createElement("h2", "", "同事件官方报道"));
  sources.forEach((source) => {
    const link = createElement("a", "dialog-related-link", source.title || source.titleOriginal);
    link.href = safeImageUrl(source.url);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(createElement("span", "", "↗"));
    section.append(link);
  });
  body.append(section);
}

function openDialog(item) {
  const media = makeImage(item, "dialog-media", true);
  const body = createElement("div", "dialog-body");
  const title = createElement("h2", "dialog-title", item.title);
  title.id = "dialog-title";
  const summary = createElement("p", "dialog-summary", item.summary);

  body.append(makeMeta(item), title, summary);
  appendDialogFullText(body, item);

  if (item.titleOriginal && item.titleOriginal !== item.title) {
    const original = createElement("div", "dialog-original");
    original.append(createElement("div", "dialog-original-label", "英文原标题"));
    original.append(createElement("p", "dialog-original-title", item.titleOriginal));
    body.append(original);
  }

  appendDialogRelatedSources(body, item);

  const actions = createElement("div", "dialog-actions");
  const detailLink = createElement("a", "primary-button dialog-link", "打开独立页面");
  detailLink.href = `news/${encodeURIComponent(item.id)}.html`;

  const link = createElement("a", "secondary-button dialog-link", "核对官方原文");
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.append(createElement("span", "", "↗"));

  actions.append(detailLink, link);
  body.append(actions);

  elements.dialogContent.replaceChildren(media, body);
  document.body.style.overflow = "hidden";
  elements.dialog.showModal();
}

function closeDialog() {
  elements.dialog.close();
}

function syncFilterControls() {
  elements.chips.forEach((chip) => {
    const active = chip.dataset.category === state.category;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
  elements.sourceFilter.value = state.source;
  elements.dateFilter.value = state.dateRange;
  elements.sortFilter.value = state.sort;
  elements.search.value = state.query;
}

function readFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category");
  const source = params.get("source");
  const days = params.get("days");
  const sort = params.get("sort");
  if (["全部", "地外生命", "行星科学", "生命支持", "深空探测"].includes(category)) state.category = category;
  if (["全部", "NASA", "ESA", "国家航天局"].includes(source)) state.source = source;
  if (["all", "1", "7", "30", "90"].includes(days)) state.dateRange = days;
  if (["latest", "oldest"].includes(sort)) state.sort = sort;
  state.query = params.get("q") || "";
  syncFilterControls();
}

function resetFilters() {
  state.category = "全部";
  state.source = "全部";
  state.dateRange = "all";
  state.sort = "latest";
  state.query = "";
  state.visible = 9;
  syncFilterControls();
  renderGrid();
}

const NEWS_CACHE_KEY = "yzsmnews:news:v1";
const NEWS_FETCH_TIMEOUT = 15000;
const NEWS_FETCH_ATTEMPTS = 2;

function isValidNews(data) {
  return data && Array.isArray(data.items);
}

function readCachedNews() {
  try {
    const data = JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || "null");
    return isValidNews(data) ? data : null;
  } catch {
    return null;
  }
}

function cacheNews(data) {
  try {
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(data));
  } catch {}
}

function renderNews(data) {
  state.items = data.items;
  state.updatedAt = data.updatedAt;
  renderStats();
  renderFeatured();
  renderGrid();
  document.documentElement.dataset.newsReady = "true";
  document.documentElement.dataset.newsCount = String(data.items.length);
}

function showLoadError() {
  elements.featured.replaceChildren();
  elements.grid.replaceChildren();
  const message = createElement("div", "error-state");
  message.append(createElement("h3", "", "暂时无法读取动态"));
  message.append(createElement("p", "", "请检查网络后重试。"));
  const retry = createElement("button", "secondary-button", "重新读取");
  retry.type = "button";
  retry.addEventListener("click", loadNews);
  message.append(retry);
  elements.grid.append(message);
  elements.resultsCount.textContent = "读取失败";
  elements.loadMore.hidden = true;
  document.documentElement.dataset.newsReady = "error";
}

async function fetchNews() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_FETCH_TIMEOUT);
  try {
    const response = await fetch(`data/news.json?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!isValidNews(data)) throw new Error("动态数据格式不正确");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadNews() {
  const cached = readCachedNews();
  if (cached) renderNews(cached);
  elements.grid.setAttribute("aria-busy", "true");

  try {
    let data;
    for (let attempt = 1; attempt <= NEWS_FETCH_ATTEMPTS; attempt += 1) {
      try {
        data = await fetchNews();
        break;
      } catch (error) {
        if (attempt === NEWS_FETCH_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    renderNews(data);
    cacheNews(data);
  } catch (error) {
    console.error("读取动态失败", error);
    if (!state.items.length) showLoadError();
  } finally {
    elements.grid.removeAttribute("aria-busy");
  }
}

elements.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    state.category = chip.dataset.category;
    state.visible = 9;
    elements.chips.forEach((item) => {
      const active = item === chip;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    renderGrid();
  });
});

elements.search.addEventListener("input", () => {
  state.query = elements.search.value;
  state.visible = 9;
  renderGrid();
});

elements.sourceFilter.addEventListener("change", () => {
  state.source = elements.sourceFilter.value;
  state.visible = 9;
  renderGrid();
});

elements.dateFilter.addEventListener("change", () => {
  state.dateRange = elements.dateFilter.value;
  state.visible = 9;
  renderGrid();
});

elements.sortFilter.addEventListener("change", () => {
  state.sort = elements.sortFilter.value;
  state.visible = 9;
  renderGrid();
});

elements.loadMore.addEventListener("click", () => {
  state.visible += 9;
  renderGrid();
});

document.querySelector("#reset-filters").addEventListener("click", resetFilters);
elements.dialogClose.addEventListener("click", closeDialog);
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) closeDialog();
});
elements.dialog.addEventListener("close", () => {
  document.body.style.overflow = "";
});

readFiltersFromUrl();
loadNews();
