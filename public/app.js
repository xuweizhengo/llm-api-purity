const form = document.querySelector("#check-form");
const resultCard = document.querySelector("#result-card");
const resultHint = document.querySelector("#result-hint");
const startButton = document.querySelector("#start-button");
const sampleButton = document.querySelector("#sample-report");
const providerInputs = document.querySelectorAll("input[name='provider']");
const baseUrlInput = document.querySelector("#base-url");
const modelInput = document.querySelector("#model");

let currentReport = null;

const providerDefaults = {
  openai: {
    baseUrl: "https://api.openai.com",
    model: "gpt-4o"
  },
  claude: {
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5"
  }
};

initialize();

function initialize() {
  baseUrlInput.value = providerDefaults.openai.baseUrl;
  modelInput.value = providerDefaults.openai.model;

  form.addEventListener("submit", handleSubmit);
  sampleButton.addEventListener("click", loadSampleReport);

  providerInputs.forEach((input) => {
    input.addEventListener("change", () => {
      const defaults = providerDefaults[input.value];
      if (!defaults) return;
      baseUrlInput.placeholder = defaults.baseUrl;
      modelInput.placeholder = defaults.model;
      if (!baseUrlInput.value || Object.values(providerDefaults).some((item) => item.baseUrl === baseUrlInput.value)) {
        baseUrlInput.value = defaults.baseUrl;
      }
      if (!modelInput.value || Object.values(providerDefaults).some((item) => item.model === modelInput.value)) {
        modelInput.value = defaults.model;
      }
    });
  });

  document.querySelectorAll("[data-target]").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.target));
  });

  window.addEventListener("hashchange", () => {
    const target = window.location.hash.replace("#", "") || "purity";
    showPage(target, false);
  });

  showPage(window.location.hash.replace("#", "") || "purity", false);
}

async function handleSubmit(event) {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = {
    baseUrl: String(formData.get("baseUrl") || ""),
    apiKey: String(formData.get("apiKey") || ""),
    provider: String(formData.get("provider") || "openai"),
    model: String(formData.get("model") || ""),
    tokenAudit: formData.get("tokenAudit") === "on"
  };

  setLoading(true);
  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "检测失败");
    renderReport(data);
    toast("检测完成，报告已生成。");
  } catch (error) {
    toast(error.message || "检测失败，请检查接口地址和 Key。");
  } finally {
    setLoading(false);
  }
}

async function loadSampleReport() {
  setLoading(true, "生成示例");
  try {
    const response = await fetch("/api/sample");
    const report = await response.json();
    renderReport(report);
    toast("已加载示例报告。");
  } catch {
    toast("示例报告加载失败。");
  } finally {
    setLoading(false);
  }
}

function renderReport(report) {
  currentReport = report;
  resultHint.classList.add("hidden");
  resultCard.classList.remove("hidden");
  resultCard.innerHTML = reportTemplate(report);
  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });

  const download = resultCard.querySelector("#download-report");
  download?.addEventListener("click", () => downloadJson(report));
}

function reportTemplate(report) {
  const provider = report.provider === "claude" ? "Claude" : "OpenAI";
  const checks = report.checks.map(checkTemplate).join("");
  const audit = auditTemplate(report.audit);
  const probes = probeTemplate(report.probes);
  const metrics = report.metrics || {};

  return `
    <div class="report-head">
      <div>
        <h2>检测结果 <span class="provider-pill">@PureAPI Radar 检测平台</span></h2>
        <p>检测已完成 · ${escapeHtml(provider)} · 黑盒探针完成</p>
      </div>
      <div class="report-tools">
        <span>检测白皮书</span>
        <button class="ghost-button" id="download-report" type="button">下载报告</button>
        <span>${escapeHtml(report.id)}</span>
        <button class="ghost-button" type="button" onclick="location.reload()">重新检测</button>
      </div>
    </div>

    <section class="score-panel">
      <div class="score-side">
        <div class="donut" style="--score:${Number(report.score) || 0}">
          <strong>${Number(report.score) || 0}%</strong>
        </div>
        <div class="model-name">${escapeHtml(report.model)}</div>
        <span class="provider-pill">官方 ${escapeHtml(provider)}</span>
      </div>
      <div class="check-list">${checks}</div>
    </section>

    <section class="metrics-strip">
      <div class="metric"><span>延迟</span><strong>${formatMs(metrics.latencyMs)}</strong></div>
      <div class="metric"><span>Tokens/秒</span><strong>${formatNumber(metrics.tokensPerSecond)}</strong></div>
      <div class="metric"><span>输入 Tokens</span><strong>${formatNumber(metrics.inputTokens)}</strong></div>
      <div class="metric"><span>输出 Tokens</span><strong>${formatNumber(metrics.outputTokens)}</strong></div>
    </section>

    <section class="verdict-box">
      <p><strong>判定结论：</strong>${escapeHtml(report.verdict)}</p>
      <p>接口哈希 ${escapeHtml(report.baseUrlHash)} · Key 不入库 · ${escapeHtml(report.security?.requestLogging || "redacted")}</p>
    </section>

    ${audit}
    ${probes}
  `;
}

function checkTemplate(check) {
  const statusText = {
    pass: "通过",
    warning: "警告",
    fail: "失败"
  }[check.status] || "未知";
  const icon = check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "×";
  return `
    <div class="check-row ${escapeHtml(check.status)}" title="${escapeHtml(check.note || "")}">
      <span class="check-dot">${icon}</span>
      <span class="check-title">${escapeHtml(check.label)}</span>
      <span class="check-status">${statusText}</span>
    </div>
  `;
}

function auditTemplate(audit) {
  if (!audit?.enabled) {
    return `
      <section class="audit-card">
        <h2>Token 用量审计报告</h2>
        <p>本次检测跳过 Token 审计。开启后会进行多组短请求，生成倍率、缓存命中和明细表。</p>
      </section>
    `;
  }

  const rounds = audit.rounds || [];
  const maxInput = Math.max(...rounds.map((round) => round.inputTokens || 0), 1);
  const maxOutput = Math.max(...rounds.map((round) => round.outputTokens || 0), 1);
  const bars = rounds
    .map((round) => {
      const inputHeight = Math.max(6, ((round.inputTokens || 0) / maxInput) * 120);
      const outputHeight = Math.max(6, ((round.outputTokens || 0) / maxOutput) * 120);
      return `
        <div>
          <div class="bar-group">
            <span class="bar input" style="height:${inputHeight}px"></span>
            <span class="bar output" style="height:${outputHeight}px"></span>
            <span class="bar-label">R${round.index}<br>${formatRatio(round.multiplier)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  const rows = rounds
    .map((round) => {
      const ratioClass = Number(round.multiplier) > 3 ? "ratio-warn" : "ratio-ok";
      return `
        <tr>
          <td>R${round.index}</td>
          <td>${formatNumber(round.inputTokens)}</td>
          <td>${formatNumber(round.outputTokens)}</td>
          <td>${formatNumber(round.cachedTokens)}</td>
          <td>$${formatUsd(round.costUsd)}</td>
          <td class="${ratioClass}">${formatRatio(round.multiplier)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="audit-card">
      <div class="audit-head">
        <div>
          <h2>Token 用量审计报告</h2>
          <p>${escapeHtml(audit.provider)} · ${escapeHtml(audit.model)} · ${escapeHtml(audit.summary)}</p>
        </div>
        <span class="status-pill">${audit.health === "normal" ? "用量正常" : "需要复核"}</span>
      </div>
      <div class="audit-stats">
        <div class="audit-stat"><span>官方基线</span><strong>$${formatUsd(audit.officialBaselineUsd)}</strong></div>
        <div class="audit-stat"><span>实际消耗</span><strong>$${formatUsd(audit.observedCostUsd)}</strong></div>
        <div class="audit-stat"><span>平均倍率</span><strong>${formatRatio(audit.averageMultiplier)}</strong></div>
        <div class="audit-stat"><span>样本数量</span><strong>${rounds.length}</strong></div>
      </div>
      <div class="bars">${bars}</div>
      <table class="audit-table">
        <thead>
          <tr>
            <th>#</th>
            <th>输入</th>
            <th>输出</th>
            <th>缓存</th>
            <th>估算成本</th>
            <th>倍率</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function probeTemplate(probes = []) {
  const items = probes
    .map((probe) => {
      return `
        <div class="probe-item">
          <strong>${probe.ok ? "✓" : "!"} ${escapeHtml(probe.name)} <span>${escapeHtml(String(probe.status || ""))}</span></strong>
          <span>${escapeHtml(probe.evidence || "No evidence returned.")}</span>
        </div>
      `;
    })
    .join("");

  return `
    <section class="probes-card">
      <h2>后端探针明细</h2>
      <p>每一项都由后端发起真实请求后推送结果。</p>
      <div class="probe-grid">${items}</div>
    </section>
  `;
}

function showPage(target, updateHash = true) {
  const page = document.getElementById(target);
  if (!page) return;
  document.querySelectorAll(".page-shell").forEach((item) => item.classList.remove("active"));
  page.classList.add("active");

  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.target === target);
  });

  if (updateHash) history.pushState(null, "", `#${target}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setLoading(loading, text = "检测中") {
  startButton.disabled = loading;
  sampleButton.disabled = loading;
  startButton.textContent = loading ? text : "开始检测";
}

function downloadJson(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `llm-api-purity-${report.id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toast(message) {
  const previous = document.querySelector(".toast");
  previous?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function formatMs(value) {
  const number = Number(value) || 0;
  return `${number.toLocaleString("en-US")}ms`;
}

function formatNumber(value) {
  const number = Number(value) || 0;
  return number.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatUsd(value) {
  const number = Number(value) || 0;
  return number.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".0");
}

function formatRatio(value) {
  const number = Number(value) || 0;
  return `${number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
