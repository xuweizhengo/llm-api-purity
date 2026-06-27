import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const DATA_DIR = join(__dirname, "data");
const RANKING_SITES_FILE = join(DATA_DIR, "sites.json");
const RANKING_RESULTS_FILE = join(DATA_DIR, "monitor-results.json");
const PORT = Number.parseInt(process.env.PORT || "3078", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || "45000", 10);
const MONITOR_INTERVAL_MS = Number.parseInt(process.env.MONITOR_INTERVAL_MS || "1800000", 10);
const MONITOR_ON_START = process.env.MONITOR_ON_START === "true";
const MONITOR_DEEP_CHECKS = process.env.MONITOR_DEEP_CHECKS === "true";
const MAX_BODY_BYTES = 32 * 1024;

let rankingCache = null;
let monitorTimer = null;
let monitorRunning = false;

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const AUDIT_PROMPTS = [
  "Reply with exactly: audit-one",
  "Return a JSON object with ok true and label audit-two.",
  "In one short sentence, say that cache accounting is visible.",
  "Name the protocol family you are compatible with.",
  "Reply with three comma-separated words: stream, tool, usage.",
  "Say done, and do not include extra commentary."
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/check") {
      const body = await readJsonBody(req);
      const report = await runPurityCheck(body);
      sendJson(res, 200, report);
      return;
    }

    if (req.method === "GET" && req.url === "/api/sample") {
      sendJson(res, 200, buildSampleReport());
      return;
    }

    if (req.method === "GET" && req.url === "/api/ranking") {
      const ranking = await loadRanking();
      sendJson(res, 200, ranking);
      return;
    }

    if (req.method === "POST" && req.url === "/api/ranking/refresh") {
      authorizeRankingRefresh(req);
      await runRankingMonitor({ force: true });
      const ranking = await loadRanking();
      sendJson(res, 200, ranking);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      error: status === 500 ? "Internal server error" : error.message,
      detail: sanitizeError(error)
    });
  }
});

server.listen(PORT, () => {
  console.log(`LLM API Purity is running at http://localhost:${PORT}`);
  startRankingMonitor();
});

async function runPurityCheck(input) {
  const startedAt = Date.now();
  const provider = normalizeProvider(input.provider);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = String(input.apiKey || "").trim();
  const model = String(input.model || "").trim();
  const tokenAudit = Boolean(input.tokenAudit);

  if (!apiKey) throw userError("API Key is required.");
  if (!model) throw userError("Target model is required.");

  const context = {
    provider,
    baseUrl,
    apiKey,
    model,
    tokenAudit,
    requestId: randomBytes(16).toString("hex")
  };

  const probes = [];
  const auditRounds = [];

  const modelProbe = await safeProbe("Model catalog", () => probeModels(context));
  probes.push(modelProbe);

  const structureProbe =
    provider === "openai"
      ? await safeProbe("OpenAI response structure", () => probeOpenAiStructure(context))
      : await safeProbe("Claude message structure", () => probeClaudeStructure(context));
  probes.push(structureProbe);

  const toolProbe =
    provider === "openai"
      ? await safeProbe("Tool call behavior", () => probeOpenAiToolUse(context))
      : await safeProbe("Tool use behavior", () => probeClaudeToolUse(context));
  probes.push(toolProbe);

  const streamProbe =
    provider === "openai"
      ? await safeProbe("Streaming events", () => probeOpenAiStream(context))
      : await safeProbe("Streaming events", () => probeClaudeStream(context));
  probes.push(streamProbe);

  const multimodalProbe =
    provider === "openai"
      ? await safeProbe("Multimodal input", () => probeOpenAiVision(context))
      : await safeProbe("Multimodal input", () => probeClaudeVision(context));
  probes.push(multimodalProbe);

  if (tokenAudit) {
    const rounds =
      provider === "openai"
        ? await runOpenAiTokenAudit(context)
        : await runClaudeTokenAudit(context);
    auditRounds.push(...rounds);
  }

  const checks = buildChecks({ provider, model, probes, auditRounds, tokenAudit });
  const score = Math.round(checks.reduce((sum, check) => sum + check.points, 0));
  const maxScore = checks.reduce((sum, check) => sum + check.max, 0);
  const normalizedScore = Math.round((score / maxScore) * 100);
  const usage = collectUsage({ probes, auditRounds });
  const latencyMs = Date.now() - startedAt;

  return {
    id: context.requestId,
    provider,
    baseUrlHash: createHash("sha256").update(baseUrl).digest("hex").slice(0, 16),
    model,
    score: normalizedScore,
    verdict: verdictForScore(normalizedScore, provider),
    generatedAt: new Date().toISOString(),
    metrics: {
      latencyMs,
      tokensPerSecond: usage.outputTokens > 0 ? round(usage.outputTokens / Math.max(latencyMs / 1000, 0.1), 1) : 0,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens
    },
    checks,
    probes: probes.map(formatProbe),
    audit: buildAuditReport({ provider, model, rounds: auditRounds, enabled: tokenAudit }),
    security: {
      apiKeyStored: false,
      requestLogging: "redacted",
      cacheControl: "no-store"
    }
  };
}

async function probeModels(context) {
  const url = endpoint(context.baseUrl, "/v1/models");
  const response = await apiFetch(url, {
    method: "GET",
    headers: authHeaders(context)
  });
  const data = await parseJsonResponse(response);
  const models = Array.isArray(data.data) ? data.data : [];
  const ids = models.map((item) => item.id || item.name).filter(Boolean);
  const exact = ids.some((id) => id === context.model);
  const fuzzy = ids.some((id) => id && (id.includes(context.model) || context.model.includes(id)));

  return {
    ok: response.ok && (models.length > 0 || data.object === "list"),
    status: response.status,
    evidence: exact ? "Target model exists in /v1/models." : fuzzy ? "Similar model appears in /v1/models." : "Model catalog reachable.",
    details: { count: ids.length, exactModelMatch: exact, fuzzyModelMatch: fuzzy },
    usage: emptyUsage()
  };
}

async function probeOpenAiStructure(context) {
  const responsesResult = await tryOpenAiResponses(context);
  if (responsesResult.ok || responsesResult.status !== 404) return responsesResult;
  return probeOpenAiChat(context, "Reply with exactly: purity-ok", 24);
}

async function tryOpenAiResponses(context) {
  const started = Date.now();
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/responses"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      input: "Reply with exactly: purity-ok",
      max_output_tokens: 24,
      store: false
    })
  });
  const data = await parseJsonResponse(response);
  const text = extractOpenAiResponsesText(data);
  const structureOk = Boolean(data.id && data.object && (Array.isArray(data.output) || text));

  return {
    ok: response.ok && structureOk,
    status: response.status,
    evidence: structureOk ? "Responses API schema accepted." : "Responses API did not return the expected schema.",
    details: {
      endpoint: "/v1/responses",
      object: data.object,
      model: data.model,
      responsePreview: truncate(text || JSON.stringify(data), 160),
      latencyMs: Date.now() - started
    },
    usage: usageFromOpenAi(data.usage)
  };
}

async function probeOpenAiChat(context, prompt, maxTokens = 24) {
  const started = Date.now();
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0
    })
  });
  const data = await parseJsonResponse(response);
  const choice = data.choices?.[0];
  const structureOk = Boolean(data.id && Array.isArray(data.choices) && choice?.message);

  return {
    ok: response.ok && structureOk,
    status: response.status,
    evidence: structureOk ? "Chat Completions schema accepted." : "Chat Completions schema mismatch.",
    details: {
      endpoint: "/v1/chat/completions",
      object: data.object,
      model: data.model,
      finishReason: choice?.finish_reason,
      responsePreview: truncate(choice?.message?.content || JSON.stringify(data), 160),
      latencyMs: Date.now() - started
    },
    usage: usageFromOpenAi(data.usage)
  };
}

async function probeOpenAiToolUse(context) {
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      messages: [{ role: "user", content: "Call probe_ping with ok=true. Do not answer in text." }],
      tools: [
        {
          type: "function",
          function: {
            name: "probe_ping",
            description: "Return a tiny purity probe signal.",
            parameters: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false
            }
          }
        }
      ],
      tool_choice: { type: "function", function: { name: "probe_ping" } },
      max_tokens: 64,
      temperature: 0
    })
  });
  const data = await parseJsonResponse(response);
  const calls = data.choices?.[0]?.message?.tool_calls || [];
  const called = calls.some((call) => call.function?.name === "probe_ping");

  return {
    ok: response.ok && called,
    status: response.status,
    evidence: called ? "tool_calls returned probe_ping." : "No function tool call was returned.",
    details: {
      toolCallCount: calls.length,
      firstTool: calls[0]?.function?.name,
      finishReason: data.choices?.[0]?.finish_reason
    },
    usage: usageFromOpenAi(data.usage)
  };
}

async function probeOpenAiStream(context) {
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      messages: [{ role: "user", content: "Reply with exactly: stream-ok" }],
      max_tokens: 16,
      temperature: 0,
      stream: true
    })
  });
  const text = await readResponseText(response);
  const hasData = /data:\s*\{/.test(text);
  const hasDone = /data:\s*\[DONE\]/.test(text);
  const hasDelta = /"delta"\s*:/.test(text) || /"response\.output_text\.delta"/.test(text);

  return {
    ok: response.ok && hasData && (hasDone || hasDelta),
    status: response.status,
    evidence: hasData ? "SSE stream emitted provider-like chunks." : "Streaming response did not look like SSE.",
    details: {
      hasData,
      hasDone,
      hasDelta,
      sample: truncate(text.replace(/\s+/g, " "), 180)
    },
    usage: emptyUsage()
  };
}

async function probeOpenAiVision(context) {
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "If image input is accepted, reply with exactly: vision-ok" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${ONE_PIXEL_PNG}` } }
          ]
        }
      ],
      max_tokens: 16,
      temperature: 0
    })
  });
  const data = await parseJsonResponse(response);
  const content = data.choices?.[0]?.message?.content || "";
  const supported = response.ok && Boolean(data.choices?.[0]?.message);

  return {
    ok: supported,
    status: response.status,
    evidence: supported ? "Image content block accepted." : "Image content block was rejected or transformed.",
    details: {
      responsePreview: truncate(content || JSON.stringify(data), 160)
    },
    usage: usageFromOpenAi(data.usage)
  };
}

async function probeClaudeStructure(context) {
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      max_tokens: 24,
      messages: [{ role: "user", content: "Reply with exactly: purity-ok" }]
    })
  });
  const data = await parseJsonResponse(response);
  const structureOk = Boolean(data.id && data.type === "message" && Array.isArray(data.content));

  return {
    ok: response.ok && structureOk,
    status: response.status,
    evidence: structureOk ? "Messages API schema accepted." : "Messages API schema mismatch.",
    details: {
      type: data.type,
      model: data.model,
      role: data.role,
      stopReason: data.stop_reason,
      responsePreview: truncate(extractClaudeText(data) || JSON.stringify(data), 160)
    },
    usage: usageFromClaude(data.usage)
  };
}

async function probeClaudeToolUse(context) {
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      max_tokens: 96,
      messages: [{ role: "user", content: "Use the probe_ping tool with ok=true." }],
      tools: [
        {
          name: "probe_ping",
          description: "Return a tiny purity probe signal.",
          input_schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"]
          }
        }
      ],
      tool_choice: { type: "tool", name: "probe_ping" }
    })
  });
  const data = await parseJsonResponse(response);
  const uses = Array.isArray(data.content) ? data.content.filter((item) => item.type === "tool_use") : [];
  const called = uses.some((item) => item.name === "probe_ping");

  return {
    ok: response.ok && called,
    status: response.status,
    evidence: called ? "tool_use returned probe_ping." : "No Claude tool_use block was returned.",
    details: {
      toolUseCount: uses.length,
      firstTool: uses[0]?.name,
      stopReason: data.stop_reason
    },
    usage: usageFromClaude(data.usage)
  };
}

async function probeClaudeStream(context) {
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      max_tokens: 16,
      stream: true,
      messages: [{ role: "user", content: "Reply with exactly: stream-ok" }]
    })
  });
  const text = await readResponseText(response);
  const hasStart = /event:\s*message_start/.test(text);
  const hasDelta = /event:\s*content_block_delta/.test(text) || /"type"\s*:\s*"content_block_delta"/.test(text);
  const hasStop = /event:\s*message_stop/.test(text);

  return {
    ok: response.ok && hasStart && hasDelta,
    status: response.status,
    evidence: hasStart ? "Claude SSE message events emitted." : "Streaming response did not look like Claude SSE.",
    details: {
      hasStart,
      hasDelta,
      hasStop,
      sample: truncate(text.replace(/\s+/g, " "), 180)
    },
    usage: emptyUsage()
  };
}

async function probeClaudeVision(context) {
  const response = await apiFetch(endpoint(context.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: authHeaders(context),
    body: JSON.stringify({
      model: context.model,
      max_tokens: 16,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: ONE_PIXEL_PNG
              }
            },
            { type: "text", text: "If image input is accepted, reply with exactly: vision-ok" }
          ]
        }
      ]
    })
  });
  const data = await parseJsonResponse(response);
  const supported = response.ok && Array.isArray(data.content);

  return {
    ok: supported,
    status: response.status,
    evidence: supported ? "Claude image content block accepted." : "Image content block was rejected or transformed.",
    details: {
      responsePreview: truncate(extractClaudeText(data) || JSON.stringify(data), 160)
    },
    usage: usageFromClaude(data.usage)
  };
}

async function runOpenAiTokenAudit(context) {
  const rounds = [];
  for (let index = 0; index < AUDIT_PROMPTS.length; index += 1) {
    const prompt = AUDIT_PROMPTS[index];
    const probe = await safeProbe(`Token audit R${index + 1}`, () => probeOpenAiChat(context, prompt, 18));
    rounds.push({
      index: index + 1,
      promptChars: prompt.length,
      ok: probe.ok,
      status: probe.status,
      inputTokens: probe.usage.inputTokens,
      outputTokens: probe.usage.outputTokens,
      cachedTokens: probe.usage.cachedTokens,
      costUsd: estimateCost("openai", context.model, probe.usage),
      multiplier: estimateMultiplier(prompt, probe.usage)
    });
  }
  return rounds;
}

async function runClaudeTokenAudit(context) {
  const rounds = [];
  for (let index = 0; index < AUDIT_PROMPTS.length; index += 1) {
    const response = await safeProbe(`Token audit R${index + 1}`, async () => {
      const apiResponse = await apiFetch(endpoint(context.baseUrl, "/v1/messages"), {
        method: "POST",
        headers: authHeaders(context),
        body: JSON.stringify({
          model: context.model,
          max_tokens: 18,
          messages: [{ role: "user", content: AUDIT_PROMPTS[index] }]
        })
      });
      const data = await parseJsonResponse(apiResponse);
      return {
        ok: apiResponse.ok && Array.isArray(data.content),
        status: apiResponse.status,
        evidence: "Token audit message completed.",
        details: { stopReason: data.stop_reason },
        usage: usageFromClaude(data.usage)
      };
    });
    rounds.push({
      index: index + 1,
      promptChars: AUDIT_PROMPTS[index].length,
      ok: response.ok,
      status: response.status,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cachedTokens: response.usage.cachedTokens,
      costUsd: estimateCost("claude", context.model, response.usage),
      multiplier: estimateMultiplier(AUDIT_PROMPTS[index], response.usage)
    });
  }
  return rounds;
}

function buildChecks({ provider, model, probes, auditRounds, tokenAudit }) {
  const byName = Object.fromEntries(probes.map((probe) => [probe.name, probe]));
  const structure = provider === "openai" ? byName["OpenAI response structure"] : byName["Claude message structure"];
  const tool = provider === "openai" ? byName["Tool call behavior"] : byName["Tool use behavior"];
  const stream = byName["Streaming events"];
  const modelCatalog = byName["Model catalog"];
  const vision = byName["Multimodal input"];
  const auditOk = tokenAudit && auditRounds.length > 0 && auditRounds.filter((round) => round.ok && round.inputTokens > 0).length >= 4;
  const auditWarning =
    tokenAudit &&
    auditRounds.length > 0 &&
    auditRounds.some((round) => round.multiplier > 3 || round.inputTokens === 0);

  return [
    {
      key: "fingerprint",
      label: "LLM 指纹验证",
      status: structure?.ok ? "pass" : "fail",
      points: structure?.ok ? 20 : 0,
      max: 20,
      note: structure?.evidence || "No structure probe result."
    },
    {
      key: "structure",
      label: "结构完整性",
      status: modelCatalog?.ok && structure?.ok ? "pass" : structure?.ok ? "warning" : "fail",
      points: modelCatalog?.ok && structure?.ok ? 18 : structure?.ok ? 12 : 0,
      max: 18,
      note: modelCatalog?.details?.exactModelMatch ? `${model} appears in model catalog.` : "Catalog or model match is partial."
    },
    {
      key: "behavior",
      label: "行为验证",
      status: tool?.ok ? "pass" : "fail",
      points: tool?.ok ? 20 : 0,
      max: 20,
      note: tool?.evidence || "Tool behavior was not verified."
    },
    {
      key: "signature",
      label: "签名校验",
      status: stream?.ok ? "pass" : "warning",
      points: stream?.ok ? 15 : 7,
      max: 15,
      note: stream?.evidence || "Streaming signature was not verified."
    },
    {
      key: "multimodal",
      label: "多模态能力",
      status: vision?.ok ? "pass" : "warning",
      points: vision?.ok ? 10 : 5,
      max: 10,
      note: vision?.evidence || "Vision probe was not verified."
    },
    {
      key: "tokenAudit",
      label: "Token 用量审计",
      status: !tokenAudit ? "warning" : auditOk && !auditWarning ? "pass" : auditOk ? "warning" : "fail",
      points: !tokenAudit ? 6 : auditOk && !auditWarning ? 17 : auditOk ? 11 : 0,
      max: 17,
      note: !tokenAudit ? "Skipped by user." : auditOk ? "Usage fields were present across audit rounds." : "Usage fields were missing or inconsistent."
    }
  ];
}

function buildAuditReport({ provider, model, rounds, enabled }) {
  if (!enabled) {
    return {
      enabled: false,
      summary: "Token audit skipped.",
      health: "skipped",
      rounds: []
    };
  }

  const successful = rounds.filter((round) => round.ok);
  const avgMultiplier = successful.length
    ? round(successful.reduce((sum, roundItem) => sum + roundItem.multiplier, 0) / successful.length, 2)
    : 0;
  const totalCost = successful.reduce((sum, roundItem) => sum + roundItem.costUsd, 0);
  const health = avgMultiplier > 3 || successful.length < 4 ? "warning" : "normal";

  return {
    enabled: true,
    provider,
    model,
    summary:
      health === "normal"
        ? "Usage fields are present and the heuristic multiplier is in a normal range."
        : "Usage fields need review; multiplier or missing data looks unusual.",
    health,
    officialBaselineUsd: round(totalCost, 6),
    observedCostUsd: round(totalCost * Math.max(avgMultiplier, 1), 6),
    averageMultiplier: avgMultiplier,
    rounds
  };
}

function collectUsage({ probes, auditRounds }) {
  const usage = emptyUsage();
  for (const probe of probes) addUsage(usage, probe.usage);
  for (const round of auditRounds) {
    usage.inputTokens += round.inputTokens || 0;
    usage.outputTokens += round.outputTokens || 0;
    usage.cachedTokens += round.cachedTokens || 0;
  }
  return usage;
}

function addUsage(target, source = emptyUsage()) {
  target.inputTokens += source.inputTokens || 0;
  target.outputTokens += source.outputTokens || 0;
  target.cachedTokens += source.cachedTokens || 0;
}

async function safeProbe(name, fn) {
  try {
    const result = await fn();
    return {
      name,
      ok: Boolean(result.ok),
      status: result.status || 0,
      evidence: result.evidence || "",
      details: result.details || {},
      usage: result.usage || emptyUsage()
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: error.statusCode || error.status || 0,
      evidence: sanitizeError(error),
      details: {},
      usage: emptyUsage()
    };
  }
}

async function apiFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonResponse(response) {
  const text = await readResponseText(response);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, parse_error: true };
  }
}

async function readResponseText(response) {
  const text = await response.text();
  return text.slice(0, 256 * 1024);
}

function authHeaders(context) {
  const headers = {
    "content-type": "application/json",
    "cache-control": "no-store",
    authorization: `Bearer ${context.apiKey}`
  };

  if (context.provider === "claude") {
    headers["x-api-key"] = context.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }

  return headers;
}

function usageFromOpenAi(usage = {}) {
  const cached =
    usage.prompt_tokens_details?.cached_tokens ||
    usage.input_tokens_details?.cached_tokens ||
    usage.cached_tokens ||
    0;
  return {
    inputTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
    outputTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
    cachedTokens: Number(cached)
  };
}

function usageFromClaude(usage = {}) {
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    cachedTokens: Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0)
  };
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
}

function extractOpenAiResponsesText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  if (!Array.isArray(data.output)) return "";
  return data.output
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("");
}

function extractClaudeText(data) {
  if (!Array.isArray(data.content)) return "";
  return data.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}

function estimateCost(provider, model, usage) {
  const lower = model.toLowerCase();
  let inputPerMillion = provider === "claude" ? 15 : 5;
  let outputPerMillion = provider === "claude" ? 75 : 15;

  if (lower.includes("haiku") || lower.includes("mini") || lower.includes("flash")) {
    inputPerMillion = provider === "claude" ? 0.8 : 0.6;
    outputPerMillion = provider === "claude" ? 4 : 2.4;
  } else if (lower.includes("sonnet") || lower.includes("4o")) {
    inputPerMillion = provider === "claude" ? 3 : 2.5;
    outputPerMillion = provider === "claude" ? 15 : 10;
  } else if (lower.includes("opus") || lower.includes("gpt-5")) {
    inputPerMillion = provider === "claude" ? 15 : 5;
    outputPerMillion = provider === "claude" ? 75 : 15;
  }

  return round((usage.inputTokens * inputPerMillion + usage.outputTokens * outputPerMillion) / 1_000_000, 6);
}

function estimateMultiplier(prompt, usage) {
  if (!usage.inputTokens) return 0;
  const roughPromptTokens = Math.max(1, Math.ceil(prompt.length / 4));
  return round(usage.inputTokens / roughPromptTokens, 2);
}

function endpoint(baseUrl, path) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  if (cleanBase.endsWith("/v1") && cleanPath.startsWith("v1/")) {
    return `${cleanBase}/${cleanPath.slice(3)}`;
  }
  return `${cleanBase}/${cleanPath}`;
}

function normalizeBaseUrl(value) {
  let url = String(value || "").trim();
  if (!url) throw userError("API base URL is required.");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw userError("Invalid API base URL.");
  }
}

function normalizeProvider(value) {
  const provider = String(value || "openai").toLowerCase();
  if (!["openai", "claude"].includes(provider)) throw userError("Provider must be openai or claude.");
  return provider;
}

function verdictForScore(score, provider) {
  const label = provider === "claude" ? "Claude" : "OpenAI";
  if (score >= 92) return `判定为官方 ${label} 高纯度接口`;
  if (score >= 78) return `判定为 ${label} 兼容接口，建议复核`;
  if (score >= 60) return "疑似多层转发或兼容层不完整";
  return "风险较高，协议或行为与官方接口差异明显";
}

function formatProbe(probe) {
  return {
    name: probe.name,
    ok: probe.ok,
    status: probe.status,
    evidence: probe.evidence,
    details: probe.details
  };
}

function buildSampleReport() {
  const rounds = AUDIT_PROMPTS.map((prompt, index) => ({
    index: index + 1,
    promptChars: prompt.length,
    ok: true,
    status: 200,
    inputTokens: [19, 23, 21, 18, 22, 20][index],
    outputTokens: [5, 9, 8, 7, 6, 4][index],
    cachedTokens: [0, 128, 256, 128, 512, 256][index],
    costUsd: [0.00017, 0.00025, 0.00022, 0.00019, 0.0002, 0.00016][index],
    multiplier: [1.08, 1.21, 0.94, 1.02, 0.89, 0.97][index]
  }));

  return {
    id: "demo-" + randomBytes(8).toString("hex"),
    provider: "claude",
    baseUrlHash: "demo",
    model: "claude-opus-4-8",
    score: 98,
    verdict: "判定为官方 Claude 高纯度接口",
    generatedAt: new Date().toISOString(),
    metrics: {
      latencyMs: 44593,
      tokensPerSecond: 27.9,
      inputTokens: 196,
      outputTokens: 39,
      cachedTokens: 1280
    },
    checks: [
      { key: "fingerprint", label: "LLM 指纹验证", status: "pass", points: 20, max: 20, note: "Messages API schema accepted." },
      { key: "structure", label: "结构完整性", status: "pass", points: 18, max: 18, note: "Catalog and message structure match." },
      { key: "behavior", label: "行为验证", status: "pass", points: 20, max: 20, note: "tool_use returned probe_ping." },
      { key: "signature", label: "签名校验", status: "pass", points: 15, max: 15, note: "Claude SSE message events emitted." },
      { key: "multimodal", label: "多模态能力", status: "pass", points: 10, max: 10, note: "Image content block accepted." },
      { key: "tokenAudit", label: "Token 用量审计", status: "pass", points: 17, max: 17, note: "Usage fields were present across audit rounds." }
    ],
    probes: [
      { name: "Model catalog", ok: true, status: 200, evidence: "Target model exists in /v1/models.", details: { count: 42 } },
      { name: "Claude message structure", ok: true, status: 200, evidence: "Messages API schema accepted.", details: { stopReason: "end_turn" } },
      { name: "Tool use behavior", ok: true, status: 200, evidence: "tool_use returned probe_ping.", details: { toolUseCount: 1 } },
      { name: "Streaming events", ok: true, status: 200, evidence: "Claude SSE message events emitted.", details: { hasStart: true, hasDelta: true, hasStop: true } },
      { name: "Multimodal input", ok: true, status: 200, evidence: "Claude image content block accepted.", details: {} }
    ],
    audit: {
      enabled: true,
      provider: "claude",
      model: "claude-opus-4-8",
      summary: "Usage fields are present and the heuristic multiplier is in a normal range.",
      health: "normal",
      officialBaselineUsd: 0.00119,
      observedCostUsd: 0.0012,
      averageMultiplier: 1.02,
      rounds
    },
    security: {
      apiKeyStored: false,
      requestLogging: "redacted",
      cacheControl: "no-store"
    }
  };
}

async function loadRanking() {
  if (rankingCache) return rankingCache;

  const sites = await readSites();
  const results = await readMonitorResults();
  const providers = sites.map((site) => buildRankingProvider(site, results.sites?.[site.slug]));

  providers.sort((a, b) => b.compositeScore - a.compositeScore);
  providers.forEach((provider, index) => {
    provider.rank = index + 1;
  });

  const stable = providers.filter((provider) => provider.available).length;
  const avgPurity = round(providers.reduce((sum, provider) => sum + Number(provider.purityScore || 0), 0) / providers.length, 1);
  const avgFirstToken = Math.round(providers.reduce((sum, provider) => sum + Number(provider.firstTokenMs || 0), 0) / providers.length);
  const updatedAt = providers
    .map((provider) => provider.checkedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  rankingCache = {
    updatedAt,
    source: results.updatedAt ? "backend-monitor" : "backend-config",
    monitor: {
      intervalMs: MONITOR_INTERVAL_MS,
      deepChecks: MONITOR_DEEP_CHECKS,
      running: monitorRunning,
      nextRunHint: MONITOR_INTERVAL_MS > 0 ? "scheduled" : "disabled"
    },
    stats: {
      total: providers.length,
      stable,
      avgPurity,
      avgFirstToken
    },
    providers
  };

  return rankingCache;
}

function scoreProvider(provider) {
  const purity = Number(provider.purityScore || 0);
  const uptime = Number(provider.uptime24h || provider.uptime || 0);
  const latency = Number(provider.firstTokenMs || 3000);
  const multiplier = Number(provider.lowestRate || provider.multiplier || 1);
  const latencyScore = Math.max(0, 100 - latency / 30);
  const multiplierScore = Math.max(0, 100 - Math.abs(multiplier - 1) * 55);
  return round(purity * 0.5 + uptime * 0.22 + latencyScore * 0.16 + multiplierScore * 0.12, 1);
}

async function startRankingMonitor() {
  if (MONITOR_INTERVAL_MS > 0 && !monitorTimer) {
    monitorTimer = setInterval(() => {
      runRankingMonitor().catch((error) => {
        console.warn("ranking monitor failed:", sanitizeError(error));
      });
    }, MONITOR_INTERVAL_MS);
    monitorTimer.unref?.();
  }

  if (MONITOR_ON_START) {
    setTimeout(() => {
      runRankingMonitor().catch((error) => {
        console.warn("initial ranking monitor failed:", sanitizeError(error));
      });
    }, 1500).unref?.();
  }
}

async function runRankingMonitor({ force = false } = {}) {
  if (monitorRunning && !force) return;
  monitorRunning = true;
  try {
    const sites = await readSites();
    const previous = await readMonitorResults();
    const next = {
      updatedAt: new Date().toISOString(),
      intervalMs: MONITOR_INTERVAL_MS,
      deepChecks: MONITOR_DEEP_CHECKS,
      sites: { ...(previous.sites || {}) }
    };

    for (const site of sites) {
      if (site.monitor?.enabled === false) {
        next.sites[site.slug] = buildSkippedMonitorResult(site, next.sites[site.slug]);
        continue;
      }
      next.sites[site.slug] = await monitorSite(site, next.sites[site.slug]);
    }

    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(RANKING_RESULTS_FILE, JSON.stringify(next, null, 2), "utf8");
    rankingCache = null;
  } finally {
    monitorRunning = false;
  }
}

async function monitorSite(site, previous = {}) {
  const checkedAt = new Date().toISOString();
  const light = await probePublicEndpoint(site.entryUrl || site.apiBaseUrl);
  const apiKeyEnv = site.monitor?.apiKeyEnv;
  const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : "";
  const canDeepCheck = MONITOR_DEEP_CHECKS && apiKey && site.monitor?.kind && site.monitor?.model;
  let deep = null;

  if (canDeepCheck) {
    deep = await safeProbe("scheduled purity check", async () => {
      const report = await runPurityCheck({
        provider: site.monitor.kind,
        baseUrl: site.apiBaseUrl,
        apiKey,
        model: site.monitor.model,
        tokenAudit: false
      });
      return {
        ok: report.score >= 60,
        status: 200,
        evidence: report.verdict,
        details: {
          score: report.score,
          latencyMs: report.metrics?.latencyMs || 0
        },
        usage: emptyUsage()
      };
    });
  }

  const deepOk = deep?.ok && deep?.details?.score >= 60;
  const available = Boolean(deep ? deepOk : light.available);
  const latestResponseMs = Number(deep?.details?.latencyMs || light.responseMs || site.baseline?.latestResponseMs || 0);
  const purityScore = Number(deep?.details?.score || previous.purityScore || site.baseline?.purityScore || 0);
  const firstTokenMs = Number(previous.firstTokenMs || site.baseline?.firstTokenMs || latestResponseMs || 0);
  const history = trimHistory([
    ...(previous.history || []),
    {
      at: checkedAt,
      available,
      responseMs: latestResponseMs,
      status: light.status || deep?.status || 0
    }
  ]);

  return {
    checkedAt,
    available,
    monitorMode: canDeepCheck ? "deep" : "public",
    status: light.status || deep?.status || 0,
    statusText: light.statusText || "",
    purityScore,
    uptime24h: calcUptime(history, site.baseline?.uptime24h),
    firstTokenMs,
    latestResponseMs,
    lastError: available ? "" : light.error || deep?.evidence || "Monitor probe failed",
    history
  };
}

async function probePublicEndpoint(url) {
  const started = Date.now();
  if (!url || url.includes("your-one-api.example.com")) {
    return { available: false, status: 0, responseMs: 0, error: "No public monitor URL configured" };
  }

  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await apiFetchWithTimeout(url, {
        method,
        headers: {
          "user-agent": "PureAPI-Radar/0.1 (+https://github.com/xuweizhengo/llm-api-purity)",
          "cache-control": "no-store"
        }
      }, 12000);
      return {
        available: response.status > 0 && response.status < 500,
        status: response.status,
        statusText: response.statusText,
        responseMs: Date.now() - started
      };
    } catch (error) {
      if (method === "GET") {
        return {
          available: false,
          status: 0,
          responseMs: Date.now() - started,
          error: sanitizeError(error)
        };
      }
    }
  }

  return { available: false, status: 0, responseMs: Date.now() - started, error: "Unknown monitor failure" };
}

async function apiFetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildRankingProvider(site, result = {}) {
  const baseline = site.baseline || {};
  const provider = {
    id: site.slug,
    slug: site.slug,
    name: site.name,
    subtitle: site.summary,
    summary: site.summary,
    canonicalHost: site.canonicalHost,
    siteKind: site.siteKind,
    recommendationLevel: site.recommendationLevel,
    riskLevel: site.riskLevel,
    entryUrl: site.entryUrl,
    apiBase: site.apiBaseUrl,
    apiBaseUrl: site.apiBaseUrl,
    provider: displayProvider(site),
    region: site.region,
    purityScore: Number(result.purityScore ?? baseline.purityScore ?? 0),
    uptime24h: Number(result.uptime24h ?? baseline.uptime24h ?? 0),
    uptime: Number(result.uptime24h ?? baseline.uptime24h ?? 0),
    firstTokenMs: Number(result.firstTokenMs ?? baseline.firstTokenMs ?? 0),
    latestResponseMs: Number(result.latestResponseMs ?? baseline.latestResponseMs ?? 0),
    lowestRate: Number(site.publicRate ?? 1),
    multiplier: Number(site.publicRate ?? 1),
    available: Boolean(result.checkedAt ? result.available : true),
    status: result.checkedAt ? (result.available ? "stable" : "watch") : statusFromRecommendation(site.recommendationLevel),
    supports: site.supports || [],
    tags: site.tags || [],
    checkedAt: result.checkedAt || null,
    updatedAt: result.checkedAt || null,
    source: result.checkedAt ? "monitor" : "baseline",
    monitorMode: result.monitorMode || "baseline",
    lastError: result.lastError || "",
    note: site.note || "",
    metrics: {
      lowest_rate: Number(site.publicRate ?? 1),
      uptime_24h: Number(result.uptime24h ?? baseline.uptime24h ?? 0),
      available: Boolean(result.checkedAt ? result.available : true),
      first_token_ms: Number(result.firstTokenMs ?? baseline.firstTokenMs ?? 0),
      latest_response_ms: Number(result.latestResponseMs ?? baseline.latestResponseMs ?? 0),
      checked_at: result.checkedAt || null,
      rate_updated_at: null
    }
  };

  provider.compositeScore = scoreProvider(provider);
  return provider;
}

function buildSkippedMonitorResult(site, previous = {}) {
  return {
    ...previous,
    monitorMode: "disabled",
    available: previous.available ?? false,
    purityScore: previous.purityScore ?? site.baseline?.purityScore ?? 0,
    uptime24h: previous.uptime24h ?? site.baseline?.uptime24h ?? 0,
    firstTokenMs: previous.firstTokenMs ?? site.baseline?.firstTokenMs ?? 0,
    latestResponseMs: previous.latestResponseMs ?? site.baseline?.latestResponseMs ?? 0,
    lastError: previous.lastError || "Monitor disabled for this site"
  };
}

async function readSites() {
  return JSON.parse(await readFile(RANKING_SITES_FILE, "utf8"));
}

async function readMonitorResults() {
  try {
    return JSON.parse(await readFile(RANKING_RESULTS_FILE, "utf8"));
  } catch {
    return { updatedAt: null, sites: {} };
  }
}

function trimHistory(history) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return history
    .filter((item) => new Date(item.at).getTime() >= cutoff)
    .slice(-288);
}

function calcUptime(history, fallback = 0) {
  if (!history.length) return Number(fallback || 0);
  const ok = history.filter((item) => item.available).length;
  return round((ok / history.length) * 100, 2);
}

function displayProvider(site) {
  if (site.siteKind === "official" && site.monitor?.kind === "openai") return "OpenAI";
  if (site.siteKind === "official" && site.monitor?.kind === "claude") return "Claude";
  if (site.monitor?.kind === "claude") return "Claude Compatible";
  if (site.siteKind === "api_relay") return "OpenAI / Claude Compatible";
  return "OpenAI Compatible";
}

function statusFromRecommendation(level) {
  if (level === "recommended" || level === "neutral") return "stable";
  return "watch";
}

function authorizeRankingRefresh(req) {
  const adminToken = process.env.RANKING_ADMIN_TOKEN;
  if (adminToken) {
    const header = req.headers.authorization || "";
    if (header === `Bearer ${adminToken}`) return;
    throw userError("Unauthorized ranking refresh.", 401);
  }

  const remote = req.socket.remoteAddress;
  const localAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  if (localAddresses.has(remote)) return;
  throw userError("Ranking refresh is local-only unless RANKING_ADMIN_TOKEN is set.", 403);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(content);
  } catch {
    const index = await readFile(join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(index);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw userError("Request body too large.", 413);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw userError("Invalid JSON body.");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function userError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeError(error) {
  const message = error?.message || String(error);
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 500);
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
