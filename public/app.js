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
        <p class="trust-note"><span class="trust-icon" aria-hidden="true">◇</span>仅整理公开信息；更正、认领与下架请求请通过公开联系方式主动联系。</p>
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
        <h2>信息需要更正？</h2>
        <p>请优先通过人物或站点已公开的联系方式主动联系，避免网页匿名提交带来的真假难辨。</p>
      </div>
      <button class="primary-button compact" data-route="submit" type="button">查看联系规则</button>
    </section>
  `;
}

function renderPeople() {
  const people = filterPeople(state.ecosystem.people || []);
  roots.people.innerHTML = `
    <section class="page-head">
      <div>
        <p class="eyebrow">People</p>
        <h1 id="people-title">中转生态人物图鉴</h1>
        <p>从人物进入中转生态：谁在维护项目，谁在运营站点，谁提供检测与判断依据。这里只整理公开线索，信息更正以主动联系和可验证材料为准。</p>
      </div>
      ${localSearch("搜索人物、身份、微信、GitHub、站点名")}
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
        <p class="trust-note inline">仅展示公开信息与可验证的主动联系信息。</p>
      </div>
      <div class="detail-actions">
        <button class="primary-button compact" data-route="submit" type="button">查看联系规则</button>
        <button class="secondary-button compact" data-route="sites" type="button">返回站点目录</button>
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
        <h2>更正与下架</h2>
        <p class="muted">如果你是本人或站点维护者，请通过公开联系方式主动联系，并附可验证材料。网页匿名提交暂不开放。</p>
        <div class="split-actions">
          <button class="primary-button compact" data-route="submit" type="button">查看处理规则</button>
          <button class="secondary-button compact" data-route="sites" type="button">查看站点目录</button>
        </div>
      </article>
    </section>
  `;
}

function renderSubmit() {
  roots.submit.innerHTML = `
    <section class="page-head submit-head">
      <div>
        <p class="eyebrow">Contact Rules</p>
        <h1 id="submit-title">联系与更正规则</h1>
        <p>暂不开放网页提交线索、认领或纠错表单。人物与站点信息需要可验证来源，匿名网页提交很难判断真假。</p>
      </div>
      <div class="rule-box">优先通过已公开联系方式沟通；涉及下架、认领、联系方式更新时，需要能证明身份或站点归属的公开材料。</div>
    </section>

    <section class="submit-layout">
      <article class="panel contact-panel">
        <h2>为什么关闭网页提交？</h2>
        <div class="note-list">
          <div>人物页、站点归属和联系方式都属于高信任信息，匿名提交无法确认信息来源。</div>
          <div>开放表单容易引入冒名认领、恶意纠错、竞争对手攻击和不可验证爆料。</div>
          <div>当前只整理公开信息、站点方公开说明、本人或团队能验证的主动联系信息。</div>
        </div>
        <div class="split-actions contact-actions">
          <button class="primary-button compact" data-route="people" type="button">查看人物图鉴</button>
          <button class="secondary-button compact" data-route="sites" type="button">查看站点目录</button>
        </div>
      </article>
      <aside class="submit-side">
        ${sideCards([
          ["更正信息", ["通过人物或站点已公开渠道联系", "说明要修改的页面与字段", "附公开证明链接或站点公告"]],
          ["认领页面", ["使用可验证身份联系", "提供 GitHub / 官网 / X 等公开材料", "不接受匿名冒名申请"]],
          ["下架请求", ["本人或站点方优先处理", "隐私与错误信息优先隐藏", "争议信息以公开来源为准"]]
        ])}
      </aside>
    </section>

    <section class="process">
      ${[
        { title: "主动联系", text: "通过已公开微信、GitHub、Telegram、官网或邮箱联系。" },
        { title: "提供依据", text: "说明更正内容，并给出公开证明或可验证身份材料。" },
        { title: "人工核对", text: "核对公开来源、站点归属和联系方式有效性。" },
        { title: "更新展示", text: "确认后更新、隐藏或下架相关条目。" }
      ].map((step, index) => `
        <div>
          <span>0${index + 1}</span>
          <strong>${escapeHtml(step.title)}</strong>
          <p>${escapeHtml(step.text)}</p>
        </div>
      `).join("")}
    </section>
  `;
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
  const value = contact.value || contact.label || "待补充";
  if (contact.type === "wechat") {
    return `
      <span class="contact-badge contact-wechat featured-wechat" aria-label="微信 ${escapeAttribute(value)}" tabindex="0">
        <b>微信号</b>
        <span class="contact-text">${escapeHtml(value)}</span>
        ${featuredWechat(contact)}
      </span>
    `;
  }

  return `
    <span class="contact-badge">
      <b>${escapeHtml(contactIcon(contact.type))}</b>
      <span class="contact-text">${escapeHtml(value)}</span>
    </span>
  `;
}

function contactIcon(type) {
  return {
    wechat: "微",
    github: "github",
    telegram: "telegram",
    email: "email",
    x: "X"
  }[type] || "链";
}

function featuredCard(person) {
  const site = findSite(person.siteId);
  const contacts = (person.contacts || []).filter((contact) => contact.type !== "wechat").slice(0, 2);
  const wechat = (person.contacts || []).find((contact) => contact.type === "wechat");
  const achievement = person.featureAchievement || person.featureReason || person.subtitle || person.highlight || "";
  const proofTags = (person.featureTags || person.tags || []).slice(0, 4);
  return `
    <article class="featured-card" data-detail="${escapeAttribute(person.id)}">
      <div class="featured-main">
        <div class="featured-avatar-wrap ${wechat ? "featured-wechat" : ""}" ${wechat ? `aria-label="微信 ${escapeAttribute(wechat.value || wechat.label || "待补充")}" tabindex="0"` : ""}>
          <div class="avatar featured-avatar">${escapeHtml(person.avatarText || person.name.slice(0, 1))}</div>
          ${wechat ? featuredWechat(wechat) : ""}
        </div>
        <div class="featured-info">
          <div class="featured-name">
            <h3>${escapeHtml(person.name)}</h3>
            ${pill(person.title || person.tags?.[0] || "公开人物", "gold")}
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
        ${contacts.length ? `<div class="featured-contacts">${contacts.map(contactBadge).join("")}</div>` : ""}
        <div class="featured-site-meta">
          ${pill(site?.modelStatus || "待测", site?.modelStatus === "在线" ? "good" : "warn")}
          ${pill(site ? `稳定性 ${site.uptime24h}%` : "稳定性待测", Number(site?.uptime24h || 0) >= 98 ? "good" : "warn")}
        </div>
      </div>
    </article>
  `;
}

function featuredWechat(contact) {
  const value = contact.value || contact.label || "待补充";
  const qrImage = contact.qrImage || contact.qrUrl || "";
  return `
    <span class="wechat-popover">
      ${
        qrImage
          ? `<img class="wechat-qr" src="${escapeAttribute(qrImage)}" alt="微信二维码 ${escapeAttribute(value)}" />`
          : `<span class="qr-placeholder">二维码待补充</span>`
      }
      <span class="wechat-meta"><b>微信号</b><span>${escapeHtml(value)}</span><em>头像悬停查看，真实二维码可后续补图</em></span>
    </span>
  `;
}

function personCard(person) {
  const site = findSite(person.siteId);
  const contacts = (person.contacts || []).filter((contact) => contact.type !== "wechat").slice(0, 2);
  const wechat = (person.contacts || []).find((contact) => contact.type === "wechat");
  const reason =
    person.featureAchievement ||
    person.featureReason ||
    person.highlight ||
    person.bio ||
    "公开线索待补充，当前作为中转生态人物条目记录。";
  const proofTags = (person.featureTags || person.tags || person.identities || []).slice(0, 4);
  return `
    <article class="person-card" data-detail="${escapeAttribute(person.id)}">
      <div class="person-card-head">
        <div class="featured-avatar-wrap person-avatar-wrap ${wechat ? "featured-wechat" : ""}" ${wechat ? `aria-label="微信 ${escapeAttribute(wechat.value || wechat.label || "待补充")}" tabindex="0"` : ""}>
          <div class="avatar featured-avatar person-avatar">${escapeHtml(person.avatarText || person.name.slice(0, 1))}</div>
          ${wechat ? featuredWechat(wechat) : ""}
        </div>
        <div class="person-card-title">
          <div class="person-name-row">
            <h3>${escapeHtml(person.name)}</h3>
            ${pill(person.title || person.tags?.[0] || "公开人物", "gold")}
          </div>
          ${
            site
              ? `<a class="person-site-link" href="${escapeAttribute(site.entryUrl || "#")}" target="_blank" rel="noreferrer">关联站点 ${escapeHtml(site.name)} <span aria-hidden="true">↗</span></a>`
              : `<p class="person-site-missing">关联站点待补充</p>`
          }
        </div>
      </div>
      <div class="person-reason">
        <span>收录理由</span>
        <p>${escapeHtml(reason)}</p>
      </div>
      <div class="person-proof">${proofTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="person-card-meta">
        <div class="person-contact-strip">
          ${contacts.length ? contacts.map(contactBadge).join("") : `<span class="person-muted">联系方式待补充</span>`}
        </div>
        <div class="person-status-strip">
          ${pill(site?.modelStatus || "状态待测", site?.modelStatus === "在线" ? "good" : "warn")}
          ${pill(site ? `稳定性 ${site.uptime24h}%` : "稳定性待测", Number(site?.uptime24h || 0) >= 98 ? "good" : "warn")}
        </div>
        <button class="text-button person-detail-link" data-detail="${escapeAttribute(person.id)}" type="button">查看档案</button>
      </div>
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

function filterPeople(people) {
  const query = state.query.toLowerCase();
  if (!query) return people;
  return people.filter((person) => {
    const site = findSite(person.siteId);
    const contacts = (person.contacts || []).flatMap((contact) => [contact.type, contact.label, contact.value]);
    return [person.name, person.title, person.subtitle, person.bio, site?.name, site?.domain, ...(person.tags || []), ...contacts]
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
