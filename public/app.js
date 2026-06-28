const roots = {
  home: document.querySelector("#home-root"),
  people: document.querySelector("#people-root"),
  sites: document.querySelector("#sites-root"),
  detail: document.querySelector("#detail-root"),
  submit: document.querySelector("#submit-root")
};

const pages = {
  home: document.querySelector("#page-home"),
  people: document.querySelector("#page-people"),
  sites: document.querySelector("#page-sites"),
  detail: document.querySelector("#page-detail"),
  submit: document.querySelector("#page-submit")
};

const state = {
  ecosystem: { people: [], sites: [], featured: [] },
  ranking: null,
  route: "home",
  query: ""
};

const submitTabs = {
  person: "人物信息",
  site: "站点信息",
  claim: "纠错 / 认领",
  business: "商务合作"
};

initialize();

async function initialize() {
  bindGlobalEvents();
  await loadData();
  navigate(currentHash(), false);
}

function bindGlobalEvents() {
  document.addEventListener("click", (event) => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) {
      event.preventDefault();
      navigate(routeButton.dataset.route);
      return;
    }

    const detailButton = event.target.closest("[data-detail]");
    if (detailButton) {
      const interactive = event.target.closest("a, button, input, select, textarea, .featured-wechat");
      if (interactive && interactive !== detailButton) return;
      event.preventDefault();
      navigate(`detail/${detailButton.dataset.detail}`);
    }
  });

  document.querySelector("#global-search")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.query = event.currentTarget.value.trim();
    navigate("sites");
  });

  window.addEventListener("hashchange", () => navigate(currentHash(), false));
}

async function loadData() {
  try {
    const [ecosystemResponse, rankingResponse] = await Promise.all([
      fetch("/api/ecosystem"),
      fetch("/api/ranking")
    ]);

    state.ecosystem = ecosystemResponse.ok ? await ecosystemResponse.json() : state.ecosystem;
    state.ranking = rankingResponse.ok ? await rankingResponse.json() : null;
  } catch (error) {
    toast(error.message || "数据加载失败");
  }
}

function currentHash() {
  return window.location.hash.replace(/^#/, "") || "home";
}

function navigate(route, updateHash = true) {
  state.route = route || "home";
  const [section] = state.route.split("/");
  const pageName = pages[section] ? section : "home";

  Object.entries(pages).forEach(([name, page]) => {
    page.classList.toggle("active", name === pageName);
  });

  document.querySelectorAll(".nav-link").forEach((button) => {
    const [buttonSection] = button.dataset.route.split("/");
    button.classList.toggle("active", buttonSection === pageName || (pageName === "detail" && buttonSection === "people"));
  });

  if (updateHash) {
    history.pushState(null, "", `#${state.route}`);
  }

  renderPage(pageName, state.route.split("/").slice(1));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderPage(pageName, params = []) {
  if (pageName === "home") renderHome();
  if (pageName === "people") renderPeople();
  if (pageName === "sites") renderSites();
  if (pageName === "detail") renderDetail(params[0]);
  if (pageName === "submit") renderSubmit(params[0] || "person");
}

function renderHome() {
  const people = state.ecosystem.people || [];
  const sites = state.ecosystem.sites || [];
  const featuredPeople = (state.ecosystem.featured || [])
    .map((id) => findPerson(id))
    .filter(Boolean)
    .slice(0, 3);

  roots.home.innerHTML = `
    <section class="hero-shell">
      <div class="hero-copy">
        <h1 id="home-title">先看人，再选中转站</h1>
        <p>不追求收录最多，只记录中转站背后的公开身份、联系方式与当前状态。</p>
        <div class="hero-actions">
          <button class="primary-button" data-route="people" type="button">查看人物图鉴</button>
          <button class="secondary-button" data-route="sites" type="button">查看站点目录</button>
        </div>
        <p class="trust-note"><span class="trust-icon" aria-hidden="true">◇</span>仅收录公开信息与站点自愿提交信息，支持本人认领、纠错与下架申请。</p>
      </div>
    </section>

    <section class="value-grid">
      ${valueCard("背后是谁", "公开昵称、身份标签与可验证联系方式。", "person")}
      ${valueCard("关联什么站", "站点域名、API Base、注册入口与负责人。", "star")}
      ${valueCard("现在稳不稳", "网络可达、模型在线、首帧速度与 24h 稳定性。", "shield")}
    </section>

    <section class="section-head home-section-head">
      <div>
        <h2>精选人物与站点</h2>
      </div>
      <button class="text-button arrow-link" data-route="people" type="button">查看全部精选</button>
    </section>
    <div class="featured-grid">
      ${featuredPeople.map(featuredCard).join("")}
    </div>

    <section class="section-head home-section-head">
      <div>
        <h2>精选站点目录</h2>
      </div>
    </section>
    ${siteTable(sites.slice(0, 10), { compact: true, numbered: true })}

    <section class="submit-band">
      <div class="submit-band-icon" aria-hidden="true">人</div>
      <div>
        <h2>知道某个站背后的人？</h2>
        <p>提交公开线索，帮助补全中转生态人物图鉴。</p>
      </div>
      <button class="primary-button compact" data-route="submit/person" type="button">提交线索</button>
    </section>
  `;
}

function renderPeople() {
  const people = filterPeople(state.ecosystem.people || []);
  roots.people.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">People</p>
        <h1 id="people-title">人物图鉴</h1>
        <p>先记录公开身份、联系方式和关联站点。资料少也没关系，关键是可认领、可纠错、可持续补充。</p>
      </div>
      ${localSearch("搜索人物、微信、GitHub、站点名")}
    </section>
    <div class="person-grid">
      ${people.map(personCard).join("") || emptyState("没有匹配的人物。")}
    </div>
  `;
  bindLocalSearch();
}

function renderSites() {
  const sites = filterSites(state.ecosystem.sites || []);
  roots.sites.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">Sites</p>
        <h1 id="sites-title">站点目录</h1>
        <p>第一版只做精选站点，不追求大而全。每个站点都尽量绑定负责人、公开联系方式和状态指标。</p>
      </div>
      ${localSearch("搜索站点、域名、负责人、模型")}
    </section>
    <div class="directory-stats">
      <div><span>精选站点</span><strong>${(state.ecosystem.sites || []).length}</strong></div>
      <div><span>公开大目录</span><strong>${state.ranking?.stats?.total || "--"}</strong></div>
      <div><span>平均首帧</span><strong>${averageFirstToken(state.ecosystem.sites)}ms</strong></div>
      <div><span>平均稳定性</span><strong>${averageUptime(state.ecosystem.sites)}%</strong></div>
    </div>
    ${siteTable(sites, { compact: false })}
  `;
  bindLocalSearch();
}

function renderDetail(id) {
  const people = state.ecosystem.people || [];
  const person = findPerson(id) || people[0];
  if (!person) {
    roots.detail.innerHTML = emptyState("还没有人物资料。");
    return;
  }

  const site = findSite(person.siteId);
  roots.detail.innerHTML = `
    <section class="detail-hero">
      <div class="avatar large">${escapeHtml(person.avatarText || person.name.slice(0, 1))}</div>
      <div>
        <p class="eyebrow">Combined Profile</p>
        <h1 id="detail-title">${escapeHtml(person.name)}${site ? ` / ${escapeHtml(site.name)}` : ""}</h1>
        <p>${escapeHtml(person.title)}${site ? ` · ${escapeHtml(site.type)}` : ""}</p>
        <div class="tag-row">
          ${pill(`公开联系方式 ${person.contacts?.length || 0} 个`, "neutral")}
          ${pill(site ? "关联站点 1 个" : "暂无关联站点", "neutral")}
          ${pill(site?.modelStatus === "在线" ? "站点状态正常" : "站点待观察", site?.modelStatus === "在线" ? "good" : "warn")}
        </div>
        <p class="trust-note inline">仅展示公开信息与站点自愿提交信息。</p>
      </div>
      <div class="detail-actions">
        <button class="primary-button compact" data-route="submit/person" type="button">提交补充信息</button>
        <button class="secondary-button compact" data-route="submit/claim" type="button">申请认领</button>
      </div>
    </section>

    <section class="detail-grid">
      <article class="panel">
        <h2>人物信息</h2>
        ${infoRow("公开身份", tags(person.identities || []))}
        ${infoRow("公开联系方式", contactList(person.contacts || []))}
        ${infoRow("外部链接", linkList(person.links || []))}
        <div class="description">${escapeHtml(person.bio || "公开资料待补充。")}</div>
      </article>
      <article class="panel">
        <h2>关联站点</h2>
        ${site ? siteInfo(site, person) : emptyState("暂无关联站点。")}
      </article>
    </section>

    ${site ? statusSection(site) : ""}

    <section class="detail-grid lower">
      <article class="panel">
        <h2>特点备注</h2>
        <div class="note-list">
          ${(site?.characteristics || [person.highlight, "公开资料待补充"]).filter(Boolean).map((item) => `<div>${escapeHtml(item)}</div>`).join("")}
        </div>
      </article>
      <article class="panel">
        <h2>补充与纠错</h2>
        <p class="muted">如果你是本人或站点维护者，可以提交补充信息、更新联系方式或申请下架。</p>
        <div class="split-actions">
          <button class="primary-button compact" data-route="submit/person" type="button">提交线索</button>
          <button class="secondary-button compact" data-route="submit/claim" type="button">申请下架</button>
        </div>
      </article>
    </section>
  `;
}

function renderSubmit(tab) {
  const activeTab = submitTabs[tab] ? tab : "person";
  roots.submit.innerHTML = `
    <section class="page-head submit-head">
      <div>
        <p class="eyebrow">Submit</p>
        <h1 id="submit-title">提交线索</h1>
        <p>补充公开人物、关联站点、联系方式与站点状态信息。</p>
      </div>
      <div class="rule-box">仅接受公开信息、本人提交信息或站点自愿提交信息。涉及隐私、攻击、造谣、无法验证的内容不会展示。</div>
    </section>

    <section class="submit-layout">
      <article class="panel form-panel">
        <h2>你想提交什么？</h2>
        <div class="tabs">
          ${Object.entries(submitTabs)
            .map(([key, label]) => `<button class="${key === activeTab ? "active" : ""}" data-route="submit/${key}" type="button">${label}</button>`)
            .join("")}
        </div>
        <form id="lead-form" data-type="${escapeAttribute(activeTab)}">
          ${submitFields(activeTab)}
          <label class="checkline">
            <input name="confirmed" required type="checkbox" />
            <span>我确认提交内容来自公开信息、本人信息或站点自愿提交信息</span>
          </label>
          <div class="form-actions">
            <button class="primary-button" type="submit">${submitButtonText(activeTab)}</button>
            <button class="text-button" data-route="submit/claim" type="button">查看处理规则</button>
          </div>
        </form>
      </article>
      <aside class="submit-side">
        ${submitSidebar(activeTab)}
      </aside>
    </section>

    <section class="process">
      ${processSteps(activeTab).map((step, index) => `
        <div>
          <span>0${index + 1}</span>
          <strong>${escapeHtml(step.title)}</strong>
          <p>${escapeHtml(step.text)}</p>
        </div>
      `).join("")}
    </section>
  `;

  document.querySelector("#lead-form")?.addEventListener("submit", handleLeadSubmit);
}

async function handleLeadSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const type = form.dataset.type;
  const payload = collectFormPayload(form);

  try {
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, payload })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "提交失败");
    form.reset();
    toast(`提交成功，编号 ${data.id}`);
  } catch (error) {
    toast(error.message || "提交失败，请稍后重试");
  }
}

function submitFields(tab) {
  const commonContact = `
    <label>
      <span>你的联系方式</span>
      <input name="contact" placeholder="便于核实，不公开展示" />
    </label>
  `;

  if (tab === "site") {
    return `
      ${field("站点名称", "siteName", "例如：AI Route / Koir API")}
      ${field("站点域名", "domain", "例如：ai-route.example")}
      ${field("API Base", "apiBase", "例如：https://api.ai-route.example/v1")}
      ${field("注册入口", "entryUrl", "官网或注册链接")}
      ${chipField("支持模型", "models", ["Claude", "OpenAI", "Gemini", "Grok", "Midjourney", "其他"])}
      ${field("负责人 / 联系人", "owner", "公开昵称、微信或 GitHub")}
      ${field("公开联系方式", "publicContact", "微信 / GitHub / X / Telegram，至少一个公开来源")}
      ${radioField("是否接受状态监控", "monitor", ["接受监控", "暂不监控"])}
      ${textarea("站点说明", "description", "一句话说明站点特点、价格、适合场景等")}
      ${commonContact}
    `;
  }

  if (tab === "claim") {
    return `
      ${radioField("处理类型", "claimType", ["申请认领", "信息纠错", "更新联系方式", "请求下架"])}
      ${field("相关页面", "target", "人物页链接、站点页链接、微信号或域名")}
      ${field("你的身份", "identity", "本人 / 站点维护者 / 相关团队成员 / 其他")}
      ${field("可验证联系方式", "verifiedContact", "微信 / GitHub / X / Telegram / 邮箱，用于核实")}
      ${textarea("需要修改的内容", "changes", "请说明哪些信息需要补充、修正或移除")}
      ${field("公开证明链接", "proofUrl", "官网公告、GitHub、X 主页、站点后台说明链接等")}
      ${selectField("下架原因", "removalReason", ["仅请求下架时填写", "本人要求", "信息错误", "已停止运营", "其他"])}
      ${commonContact}
    `;
  }

  if (tab === "business") {
    return `
      ${radioField("合作类型", "cooperationType", ["站点展示", "赞助位", "监控展示", "品牌合作"])}
      ${field("站点 / 品牌名称", "brand", "例如：AI Route")}
      ${field("官网或注册入口", "entryUrl", "https://...")}
      ${field("联系人", "owner", "公开昵称或负责人")}
      ${field("联系方式", "contactMethod", "微信 / Telegram / 邮箱，用于沟通")}
      ${selectField("希望展示的位置", "placement", ["首页精选", "站点目录", "人物详情页", "其他"])}
      ${chipField("可提供信息", "materials", ["负责人公开信息", "API Base", "支持模型", "价格说明", "公告链接", "客服方式"])}
      ${textarea("合作说明", "cooperationNote", "简单说明你的站点特点、希望展示的内容或预算范围")}
      ${commonContact}
    `;
  }

  return `
    ${field("相关人物或昵称", "personName", "例如：林远舟 / KoirLab")}
    ${chipField("公开身份", "identities", ["中转站运营者", "开源作者", "检测站维护者", "API 代理服务维护者"])}
    ${field("关联站点", "site", "站点名称或域名")}
    ${field("公开联系方式", "publicContact", "微信 / GitHub / X / Telegram，至少一个公开来源")}
    ${field("公开链接", "publicUrl", "官网、GitHub、X 主页、公告链接等")}
    ${textarea("线索说明", "description", "简单说明这条信息为什么值得收录")}
    ${commonContact}
  `;
}

function submitSidebar(tab) {
  if (tab === "site") {
    return sideCards([
      ["建议填写", ["站点名称", "域名", "API Base", "注册入口", "支持模型", "负责人"]],
      ["监控会展示", ["网络可达", "模型在线", "首帧速度", "24h 稳定性"]],
      ["站点方权益", ["认领资料", "更新联系方式", "修正 API Base", "申请下架"]]
    ]);
  }
  if (tab === "claim") {
    return sideCards([
      ["适用场景", ["认领人物页", "更新联系方式", "修正关联站点", "请求隐藏或下架"]],
      ["需要核实", ["申请人身份", "页面归属关系", "公开证明链接", "联系方式有效性"]],
      ["处理原则", ["优先保护本人权益", "不展示私人信息", "不展示无法验证内容", "支持补充说明"]]
    ]);
  }
  if (tab === "business") {
    return sideCards([
      ["可合作位置", ["首页精选人物与站点", "站点目录优先展示", "详情页品牌露出", "状态监控展示"]],
      ["展示前会核对", ["域名可访问", "API Base 可用性", "联系方式有效", "是否涉及高风险内容"]],
      ["不接受", ["虚假宣传", "无法联系的站点", "恶意竞争内容", "无授权冒名提交"]]
    ]);
  }
  return sideCards([
    ["可以提交", ["公开昵称", "微信头像", "GitHub / X / TG", "关联站点", "API Base", "注册入口"]],
    ["不会展示", ["私人手机号", "未公开住址", "攻击性内容", "无法验证的爆料"]],
    ["站点方入口", ["申请认领", "更新联系方式", "请求下架", "赞助展示"]]
  ]);
}

function processSteps(tab) {
  if (tab === "site") {
    return [
      { title: "初步核对", text: "确认站点和公开信息是否可访问。" },
      { title: "连通性检查", text: "检查域名、API Base 和基础状态。" },
      { title: "上线展示", text: "通过后进入站点目录或关联人物页。" }
    ];
  }
  if (tab === "claim") {
    return [
      { title: "提交申请", text: "说明要认领、纠错或下架的页面。" },
      { title: "身份核实", text: "核对公开证明和可验证联系方式。" },
      { title: "人工处理", text: "更新展示内容并保留必要说明。" },
      { title: "结果通知", text: "通常 1-3 个工作日内处理。" }
    ];
  }
  if (tab === "business") {
    return [
      { title: "提交意向", text: "说明站点特点和希望展示的位置。" },
      { title: "信息核实", text: "检查域名、API Base 与联系方式。" },
      { title: "确认方案", text: "确认展示内容和更新方式。" },
      { title: "上线更新", text: "合作展示仍保留状态与风险提示。" }
    ];
  }
  return [
    { title: "初步核对", text: "检查是否为公开信息或本人提交。" },
    { title: "人工整理", text: "合并人物、站点与联系方式。" },
    { title: "上线展示", text: "通过后进入人物图鉴或站点目录。" }
  ];
}

function valueCard(title, text, icon) {
  return `
    <article class="value-card">
      <div class="value-icon ${escapeAttribute(icon)}">${valueIcon(icon)}</div>
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
      </div>
    </article>
  `;
}

function valueIcon(icon) {
  return {
    person: "人",
    star: "☆",
    shield: "盾"
  }[icon] || "•";
}

function contactBadge(contact) {
  return `
    <span class="contact-badge">
      <b>${escapeHtml(contactIcon(contact.type))}</b>
      <span class="contact-text">${escapeHtml(contact.value || contact.label || "待补充")}</span>
    </span>
  `;
}

function contactIcon(type) {
  return {
    wechat: "微",
    github: "G",
    telegram: "T",
    email: "@",
    x: "X"
  }[type] || "链";
}

function featuredCard(person) {
  const site = findSite(person.siteId);
  const contacts = (person.contacts || []).slice(0, 2);
  const wechat = (person.contacts || []).find((contact) => contact.type === "wechat");
  const achievement = person.featureAchievement || person.featureReason || person.subtitle || person.highlight || "";
  const proofTags = (person.featureTags || person.tags || []).slice(0, 4);
  return `
    <article class="featured-card" data-detail="${escapeAttribute(person.id)}">
      <div class="featured-main">
        <div class="avatar featured-avatar">${escapeHtml(person.avatarText || person.name.slice(0, 1))}</div>
        <div class="featured-info">
          <div class="featured-name">
            <h3>${escapeHtml(person.name)}</h3>
            ${pill(person.title || person.tags?.[0] || "公开人物", "gold")}
            ${wechat ? featuredWechat(wechat) : ""}
          </div>
          ${site ? `<a class="featured-site-link" href="${escapeAttribute(site.entryUrl || "#")}" target="_blank" rel="noreferrer">关联站点 ${escapeHtml(site.name)} <span aria-hidden="true">↗</span></a>` : `<p class="featured-identity">关联站点待补充</p>`}
        </div>
      </div>
      <div class="featured-achievement">
        <span>主要成就</span>
        <p>${escapeHtml(achievement)}</p>
      </div>
      <div class="featured-proof">${proofTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="featured-meta">
        <div class="featured-contacts">
          ${contacts.length ? contacts.map(contactBadge).join("") : `<span class="contact-badge">待补充公开联系方式</span>`}
        </div>
        <div class="featured-site-meta">
          <span>${escapeHtml(site?.modelStatus || "待测")}</span>
          <span>${escapeHtml(site ? `稳定性 ${site.uptime24h}%` : "稳定性待测")}</span>
        </div>
      </div>
    </article>
  `;
}

function featuredWechat(contact) {
  const value = contact.value || contact.label || "待补充";
  return `
    <span class="featured-wechat" aria-label="微信 ${escapeAttribute(value)}" tabindex="0">
      <span class="wechat-button" aria-hidden="true">微</span>
      <span class="wechat-popover">
        <span class="qr-placeholder" aria-hidden="true"></span>
        <span><b>微信</b>${escapeHtml(value)}</span>
      </span>
    </span>
  `;
}

function personCard(person) {
  const site = findSite(person.siteId);
  return `
    <article class="person-card">
      <div class="person-line">
        <div class="avatar">${escapeHtml(person.avatarText || person.name.slice(0, 1))}</div>
        <div>
          <h3>${escapeHtml(person.name)}</h3>
          <p>${escapeHtml(person.subtitle || person.title)}</p>
        </div>
      </div>
      <div class="tag-row">${(person.tags || []).map((tag) => pill(tag, "neutral")).join("")}</div>
      <dl>
        <div><dt>公开身份</dt><dd>${escapeHtml((person.identities || []).slice(0, 2).join(" / ") || "待补充")}</dd></div>
        <div><dt>联系方式</dt><dd>${escapeHtml((person.contacts || []).length ? `${person.contacts.length} 个公开联系方式` : "待补充")}</dd></div>
        <div><dt>关联站点</dt><dd>${escapeHtml(site?.name || "暂无")}</dd></div>
      </dl>
      <button class="secondary-button compact" data-detail="${escapeAttribute(person.id)}" type="button">查看人物与站点</button>
    </article>
  `;
}

function siteTable(sites, { compact, numbered = false } = {}) {
  if (!sites.length) return emptyState("没有匹配的站点。");
  return `
    <div class="table-wrap ${compact ? "compact" : ""}">
      <table>
        <thead>
          <tr>
            ${numbered ? "<th>#</th>" : ""}
            <th>站点</th>
            <th>背后人物</th>
            <th>支持模型</th>
            <th>联系方式</th>
            <th>网络</th>
            <th>首帧</th>
            <th>24h 稳定性</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${sites.map((site, index) => siteRow(site, index, numbered)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function siteRow(site, index = 0, numbered = false) {
  const owner = findPerson(site.ownerId);
  const contact = owner?.contacts?.[0];
  return `
    <tr>
      ${numbered ? `<td>${index + 1}</td>` : ""}
      <td>
        <strong>${escapeHtml(site.name)}</strong>
        <span>${escapeHtml(site.domain)}</span>
      </td>
      <td>${escapeHtml(owner?.name || "待认领")}</td>
      <td>${escapeHtml((site.models || []).join(" / "))}</td>
      <td>${contact ? contactBadge(contact) : "待补充"}</td>
      <td>${pill(site.network || "待测", site.network === "可达" ? "good" : "warn")}</td>
      <td>${escapeHtml(site.firstTokenMs ? `${site.firstTokenMs}ms` : "--")}</td>
      <td>${escapeHtml(site.uptime24h ? `${site.uptime24h}%` : "--")}</td>
      <td><button class="text-button" data-detail="${escapeAttribute(owner?.id || site.ownerId)}" type="button">详情</button></td>
    </tr>
  `;
}

function siteInfo(site, person) {
  return `
    ${infoRow("站点名称", escapeHtml(site.name))}
    ${infoRow("域名", `<code>${escapeHtml(site.domain)}</code>`)}
    ${infoRow("API Base", `<code>${escapeHtml(site.apiBase)}</code>`)}
    ${infoRow("注册入口", `<a href="${escapeAttribute(site.entryUrl)}" target="_blank" rel="noreferrer">${escapeHtml(site.entryUrl)}</a>`)}
    ${infoRow("支持模型", tags(site.models || []))}
    ${infoRow("负责人", escapeHtml(person.name))}
    <div class="tag-row">${pill(site.network, "good")}${pill(site.modelStatus, site.modelStatus === "在线" ? "good" : "warn")}${pill(site.announcement, "neutral")}</div>
  `;
}

function statusSection(site) {
  return `
    <section class="status-section">
      <div class="section-head">
        <div>
          <p class="eyebrow">Monitor</p>
          <h2>站点状态</h2>
        </div>
      </div>
      <div class="metric-grid">
        ${metricCard("网络", site.network || "待测", `${site.latencyMs || 0}ms`, "good")}
        ${metricCard("模型", site.modelStatus || "待测", `${(site.models || []).length * 14 || 0} 个模型`, site.modelStatus === "在线" ? "good" : "warn")}
        ${metricCard("首帧", `${site.firstTokenMs || "--"}ms`, "近24h中位数", "neutral")}
        ${metricCard("稳定性", `${site.uptime24h || "--"}%`, "近24h", Number(site.uptime24h || 0) >= 98 ? "good" : "warn")}
      </div>
      <div class="trend-panel">
        <div>
          <h3>首帧趋势</h3>
          <p>轻量监控预览，后续可接真实定时任务数据。</p>
        </div>
        <div class="line-chart" aria-label="首帧趋势图">
          <span style="height: 32%"></span>
          <span style="height: 46%"></span>
          <span style="height: 38%"></span>
          <span style="height: 54%"></span>
          <span style="height: 41%"></span>
          <span style="height: 36%"></span>
        </div>
        <div class="check-list">
          <div><b>03:20</b><span>正常</span></div>
          <div><b>03:00</b><span>正常</span></div>
          <div><b>02:40</b><span>轻微波动</span></div>
        </div>
      </div>
    </section>
  `;
}

function metricCard(label, value, note, tone) {
  return `
    <article class="metric-card ${escapeAttribute(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(note)}</p>
    </article>
  `;
}

function localSearch(placeholder) {
  return `
    <label class="local-search">
      <span>查证</span>
      <input id="local-search" value="${escapeAttribute(state.query)}" placeholder="${escapeAttribute(placeholder)}" />
    </label>
  `;
}

function bindLocalSearch() {
  const input = document.querySelector("#local-search");
  input?.addEventListener("input", () => {
    state.query = input.value.trim();
    const [pageName] = state.route.split("/");
    renderPage(pageName, state.route.split("/").slice(1));
  });
}

function collectFormPayload(form) {
  const formData = new FormData(form);
  const payload = {};
  for (const [key, value] of formData.entries()) {
    if (key === "confirmed") {
      payload[key] = true;
      continue;
    }
    if (payload[key]) {
      payload[key] = Array.isArray(payload[key]) ? [...payload[key], value] : [payload[key], value];
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

function field(label, name, placeholder) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input name="${escapeAttribute(name)}" placeholder="${escapeAttribute(placeholder)}" />
    </label>
  `;
}

function textarea(label, name, placeholder) {
  return `
    <label class="full">
      <span>${escapeHtml(label)}</span>
      <textarea name="${escapeAttribute(name)}" placeholder="${escapeAttribute(placeholder)}"></textarea>
    </label>
  `;
}

function chipField(label, name, options) {
  return `
    <fieldset class="full chip-field">
      <legend>${escapeHtml(label)}</legend>
      <div>
        ${options.map((option) => `
          <label>
            <input name="${escapeAttribute(name)}" type="checkbox" value="${escapeAttribute(option)}" />
            <span>${escapeHtml(option)}</span>
          </label>
        `).join("")}
      </div>
    </fieldset>
  `;
}

function radioField(label, name, options) {
  return `
    <fieldset class="full radio-field">
      <legend>${escapeHtml(label)}</legend>
      <div>
        ${options.map((option, index) => `
          <label>
            <input ${index === 0 ? "checked" : ""} name="${escapeAttribute(name)}" type="radio" value="${escapeAttribute(option)}" />
            <span>${escapeHtml(option)}</span>
          </label>
        `).join("")}
      </div>
    </fieldset>
  `;
}

function selectField(label, name, options) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <select name="${escapeAttribute(name)}">
        ${options.map((option) => `<option value="${escapeAttribute(option)}">${escapeHtml(option)}</option>`).join("")}
      </select>
    </label>
  `;
}

function sideCards(cards) {
  return cards
    .map(([title, items]) => `
      <article class="side-card">
        <h3>${escapeHtml(title)}</h3>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    `)
    .join("");
}

function submitButtonText(tab) {
  return {
    person: "提交线索",
    site: "提交站点",
    claim: "提交申请",
    business: "提交合作意向"
  }[tab];
}

function filterPeople(people) {
  const query = state.query.toLowerCase();
  if (!query) return people;
  return people.filter((person) => {
    const site = findSite(person.siteId);
    return [person.name, person.title, person.subtitle, person.bio, site?.name, site?.domain, ...(person.tags || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function filterSites(sites) {
  const query = state.query.toLowerCase();
  if (!query) return sites;
  return sites.filter((site) => {
    const owner = findPerson(site.ownerId);
    return [site.name, site.domain, site.type, site.apiBase, owner?.name, ...(site.models || []), ...(site.characteristics || [])]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function findPerson(id) {
  return (state.ecosystem.people || []).find((person) => person.id === id);
}

function findSite(id) {
  return (state.ecosystem.sites || []).find((site) => site.id === id);
}

function averageFirstToken(sites = []) {
  const values = sites.map((site) => Number(site.firstTokenMs || 0)).filter(Boolean);
  if (!values.length) return "--";
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averageUptime(sites = []) {
  const values = sites.map((site) => Number(site.uptime24h || 0)).filter(Boolean);
  if (!values.length) return "--";
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
}

function infoRow(label, value) {
  return `
    <div class="info-row">
      <span>${escapeHtml(label)}</span>
      <div>${value || "待补充"}</div>
    </div>
  `;
}

function tags(items) {
  return `<div class="tag-row">${items.map((item) => pill(item, "neutral")).join("") || pill("待补充", "warn")}</div>`;
}

function contactList(contacts) {
  if (!contacts.length) return "待补充";
  return contacts.map((item) => `<div class="contact-row"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.value)}</span></div>`).join("");
}

function linkList(links) {
  if (!links.length) return "待补充";
  return links.map((item) => `<a href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.label || item.url)}</a>`).join("<br />");
}

function pill(text, tone = "neutral") {
  return `<span class="pill ${escapeAttribute(tone)}">${escapeHtml(text || "待补充")}</span>`;
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
