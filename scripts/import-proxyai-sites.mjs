import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const API_BASE = process.env.PROXYAI_PUBLIC_API || "https://api.proxyai.best/api/v1/public/proxyai";
const PAGE_SIZE = Number.parseInt(process.env.PROXYAI_PAGE_SIZE || "100", 10);
const OUTPUT_FILE = process.env.PROXYAI_OUTPUT || "data/sites.json";
const USE_CURL =
  process.env.PROXYAI_USE_CURL === "true" ||
  Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy);

const existingSites = await readExistingSites(OUTPUT_FILE);
const imported = await importProxyAiSites();
const merged = mergeSites(existingSites, imported);

await writeFile(OUTPUT_FILE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(`Imported ${imported.length} proxyai.best sites, wrote ${merged.length} total sites to ${OUTPUT_FILE}`);

async function importProxyAiSites() {
  const first = await getJson(buildUrl(1));
  if (first.code !== 0) throw new Error(first.message || "Failed to load proxyai site list.");

  const items = [...(first.data?.items || [])];
  const pages = Number(first.data?.pages || 1);

  for (let page = 2; page <= pages; page += 1) {
    const data = await getJson(buildUrl(page));
    if (data.code !== 0) throw new Error(data.message || `Failed to load proxyai page ${page}.`);
    items.push(...(data.data?.items || []));
  }

  return items.map(convertSite).filter(Boolean);
}

function buildUrl(page) {
  const url = new URL(`${API_BASE.replace(/\/+$/, "")}/sites`);
  url.searchParams.set("sort", "updated_desc");
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(PAGE_SIZE));
  return url.toString();
}

async function getJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await getJsonOnce(url);
    } catch (error) {
      lastError = error;
      await sleep(700 * attempt);
    }
  }
  throw lastError;
}

async function getJsonOnce(url) {
  if (USE_CURL) {
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
    const args = ["-sL", "--max-time", "45"];
    if (proxy) args.push("--proxy", proxy);
    args.push(url);
    const { stdout } = await execFileAsync("curl.exe", args, { maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout);
  }

  const response = await fetch(url, {
    headers: { "user-agent": "PureAPI-Radar-Importer/0.1" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function convertSite(site) {
  if (!site?.slug || !site?.canonical_host || !site?.name) return null;

  const primary = findPrimaryLink(site.links);
  const metrics = site.metrics || {};
  const publicRate = numberOr(metrics.lowest_rate, 1);
  const firstTokenMs = numberOr(metrics.first_token_ms, 0);
  const latestResponseMs = numberOr(metrics.latest_response_ms, firstTokenMs);
  const uptime24h = numberOr(metrics.uptime_24h, metrics.available ? 100 : 0);
  const purityScore = estimateSeedPurity(site, metrics);

  return {
    slug: site.slug,
    name: site.name,
    summary: site.summary || "",
    canonicalHost: site.canonical_host,
    siteKind: site.site_kind || "api_relay",
    recommendationLevel: site.recommendation_level || "none",
    riskLevel: site.risk_level || "unknown",
    publicRate,
    entryUrl: primary?.url || `https://${site.canonical_host}`,
    apiBaseUrl: site.api_base_url || `https://${site.canonical_host}`,
    region: site.region || "Unknown",
    supports: inferSupports(site),
    tags: normalizeTags(site.tags),
    source: {
      name: "proxyai.best public API",
      url: API_BASE,
      importedAt: new Date().toISOString()
    },
    baseline: {
      purityScore,
      uptime24h,
      firstTokenMs,
      latestResponseMs
    },
    monitor: {
      enabled: false,
      kind: inferMonitorKind(site),
      apiKeyEnv: envNameForSite(site),
      model: ""
    },
    note: site.summary || "Imported from proxyai.best public directory."
  };
}

function mergeSites(existing, imported) {
  const official = existing.filter((site) => site.siteKind === "official");
  const bySlug = new Map();

  for (const site of imported) bySlug.set(site.slug, site);
  for (const site of official) bySlug.set(site.slug, site);

  return [...bySlug.values()].sort((a, b) => {
    if (a.siteKind === "official" && b.siteKind !== "official") return -1;
    if (b.siteKind === "official" && a.siteKind !== "official") return 1;
    return String(a.name).localeCompare(String(b.name), "zh-CN");
  });
}

async function readExistingSites(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
}

function findPrimaryLink(links = []) {
  return links.find((link) => link.is_primary) || links.find((link) => link.url) || null;
}

function inferSupports(site) {
  const text = `${site.name} ${site.summary || ""} ${(site.tags || []).map((tag) => tag.name || tag).join(" ")}`.toLowerCase();
  const supports = new Set(["Chat", "Streaming"]);
  if (text.includes("claude")) supports.add("Claude");
  if (text.includes("openai") || text.includes("gpt")) supports.add("OpenAI");
  if (text.includes("midjourney") || text.includes("mj")) supports.add("Image");
  if (text.includes("gemini")) supports.add("Gemini");
  if (text.includes("tool")) supports.add("Tool Call");
  return [...supports];
}

function normalizeTags(tags = []) {
  const normalized = tags
    .map((tag) => (typeof tag === "string" ? tag : tag.name || tag.slug))
    .filter(Boolean)
    .slice(0, 8);
  return normalized.length ? normalized : ["imported", "api-relay"];
}

function inferMonitorKind(site) {
  const text = `${site.name} ${site.summary || ""}`.toLowerCase();
  return text.includes("claude") && !text.includes("openai") && !text.includes("gpt") ? "claude" : "openai";
}

function envNameForSite(site) {
  const slug = site.slug.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase();
  return `${slug}_API_KEY`;
}

function estimateSeedPurity(site, metrics) {
  if (Number.isFinite(metrics.purity_score)) return Number(metrics.purity_score);
  if (site.site_kind === "official") return 99;
  if (site.recommendation_level === "recommended") return 88;
  if (site.risk_level === "high") return 65;
  if (metrics.available === false) return 60;
  return 78;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
