import { readFile } from "node:fs/promises";
import { Pool } from "pg";

let pool = null;
let ready = false;

export function isDatabaseEnabled() {
  return Boolean(pool && ready);
}

export async function initializeDatabase({ schemaFile, ecosystemFile, rankingSitesFile }) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;

  pool = new Pool({
    connectionString,
    ssl: parseDatabaseSsl()
  });

  const client = await pool.connect();
  try {
    const schema = await readFile(schemaFile, "utf8");
    await client.query(schema);

    if (process.env.DB_SEED_ON_START !== "false") {
      await seedEmptyDatabase(client, { ecosystemFile, rankingSitesFile });
    }

    ready = true;
    return true;
  } catch (error) {
    ready = false;
    await pool.end().catch(() => {});
    pool = null;
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  ready = false;
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function loadEcosystemFromDb() {
  ensureDatabase();
  const [peopleResult, sitesResult, settingsResult] = await Promise.all([
    pool.query("SELECT * FROM people ORDER BY sort_order, name"),
    pool.query("SELECT * FROM ecosystem_sites ORDER BY sort_order, name"),
    pool.query("SELECT value FROM app_settings WHERE key = 'ecosystem'")
  ]);

  const people = peopleResult.rows;
  const sites = sitesResult.rows;

  if (!people.length && !sites.length) {
    return { updatedAt: null, featured: [], people: [], sites: [] };
  }

  const [identities, tags, contacts, links, models, characteristics] = await Promise.all([
    pool.query("SELECT * FROM person_identities ORDER BY person_id, sort_order"),
    pool.query("SELECT * FROM person_tags ORDER BY person_id, kind, sort_order"),
    pool.query("SELECT * FROM person_contacts ORDER BY person_id, sort_order, id"),
    pool.query("SELECT * FROM person_links ORDER BY person_id, sort_order, id"),
    pool.query("SELECT * FROM ecosystem_site_models ORDER BY site_id, sort_order"),
    pool.query("SELECT * FROM ecosystem_site_characteristics ORDER BY site_id, sort_order")
  ]);

  const identitiesByPerson = groupRows(identities.rows, "person_id", (row) => row.identity);
  const tagsByPerson = groupRows(tags.rows.filter((row) => row.kind === "tag"), "person_id", (row) => row.tag);
  const featureTagsByPerson = groupRows(tags.rows.filter((row) => row.kind === "feature"), "person_id", (row) => row.tag);
  const contactsByPerson = groupRows(contacts.rows, "person_id", contactFromRow);
  const linksByPerson = groupRows(links.rows, "person_id", (row) => ({
    label: row.label,
    url: row.url
  }));
  const modelsBySite = groupRows(models.rows, "site_id", (row) => row.model);
  const characteristicsBySite = groupRows(characteristics.rows, "site_id", (row) => row.characteristic);

  return {
    updatedAt: settingsResult.rows[0]?.value?.updatedAt || null,
    featured: people.filter((person) => person.featured).map((person) => person.id),
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      title: person.title,
      subtitle: person.subtitle,
      avatarText: person.avatar_text,
      tags: tagsByPerson.get(person.id) || [],
      identities: identitiesByPerson.get(person.id) || [],
      contacts: contactsByPerson.get(person.id) || [],
      links: linksByPerson.get(person.id) || [],
      bio: person.bio,
      siteId: person.site_id,
      highlight: person.highlight,
      featureReason: person.feature_reason,
      featureAchievement: person.feature_achievement,
      featureTags: featureTagsByPerson.get(person.id) || []
    })),
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      domain: site.domain,
      apiBase: site.api_base,
      entryUrl: site.entry_url,
      type: site.type,
      models: modelsBySite.get(site.id) || [],
      ownerId: site.owner_id,
      network: site.network,
      modelStatus: site.model_status,
      firstTokenMs: Number(site.first_token_ms || 0),
      latencyMs: Number(site.latency_ms || 0),
      uptime24h: Number(site.uptime_24h || 0),
      announcement: site.announcement,
      characteristics: characteristicsBySite.get(site.id) || []
    }))
  };
}

export async function loadRankingSitesFromDb() {
  ensureDatabase();
  const sitesResult = await pool.query("SELECT * FROM ranking_sites ORDER BY sort_order, name");
  if (!sitesResult.rows.length) return [];

  const [supportsResult, tagsResult] = await Promise.all([
    pool.query("SELECT * FROM ranking_site_supports ORDER BY site_slug, sort_order"),
    pool.query("SELECT * FROM ranking_site_tags ORDER BY site_slug, sort_order")
  ]);

  const supportsBySite = groupRows(supportsResult.rows, "site_slug", (row) => row.support);
  const tagsBySite = groupRows(tagsResult.rows, "site_slug", (row) => row.tag);

  return sitesResult.rows.map((site) => ({
    slug: site.slug,
    name: site.name,
    summary: site.summary,
    canonicalHost: site.canonical_host,
    siteKind: site.site_kind,
    recommendationLevel: site.recommendation_level,
    riskLevel: site.risk_level,
    publicRate: Number(site.public_rate || 1),
    entryUrl: site.entry_url,
    apiBaseUrl: site.api_base_url,
    region: site.region,
    supports: supportsBySite.get(site.slug) || [],
    tags: tagsBySite.get(site.slug) || [],
    source: site.source || {},
    baseline: site.baseline || {},
    monitor: {
      enabled: site.monitor_enabled,
      kind: site.monitor_kind,
      apiKeyEnv: site.monitor_api_key_env,
      model: site.monitor_model
    },
    note: site.note
  }));
}

export async function loadMonitorResultsFromDb() {
  ensureDatabase();
  const result = await pool.query(`
    SELECT *
    FROM monitor_results
    WHERE checked_at >= now() - interval '24 hours'
    ORDER BY site_slug, checked_at ASC
  `);

  const sites = {};
  let updatedAt = null;

  for (const row of result.rows) {
    const checkedAt = toIso(row.checked_at);
    updatedAt = !updatedAt || checkedAt > updatedAt ? checkedAt : updatedAt;
    const previous = sites[row.site_slug] || { history: [] };
    const history = [
      ...previous.history,
      {
        at: checkedAt,
        available: row.available,
        responseMs: Number(row.latest_response_ms || 0),
        status: Number(row.status || 0)
      }
    ].slice(-288);

    sites[row.site_slug] = {
      checkedAt,
      available: row.available,
      monitorMode: row.monitor_mode,
      status: Number(row.status || 0),
      statusText: row.status_text,
      purityScore: Number(row.purity_score || 0),
      uptime24h: Number(row.uptime_24h || 0),
      firstTokenMs: Number(row.first_token_ms || 0),
      latestResponseMs: Number(row.latest_response_ms || 0),
      lastError: row.last_error,
      history
    };
  }

  return { updatedAt, sites };
}

export async function saveMonitorResultToDb(siteSlug, result) {
  ensureDatabase();
  await pool.query(
    `
      INSERT INTO monitor_results (
        site_slug,
        checked_at,
        available,
        monitor_mode,
        status,
        status_text,
        purity_score,
        uptime_24h,
        first_token_ms,
        latest_response_ms,
        last_error,
        details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      siteSlug,
      result.checkedAt || new Date().toISOString(),
      Boolean(result.available),
      result.monitorMode || "public",
      Number(result.status || 0),
      result.statusText || "",
      Number(result.purityScore || 0),
      Number(result.uptime24h || 0),
      Number(result.firstTokenMs || 0),
      Number(result.latestResponseMs || 0),
      result.lastError || "",
      { source: "scheduled-monitor" }
    ]
  );
}

export async function saveLeadToDb(lead) {
  ensureDatabase();
  await pool.query(
    `
      INSERT INTO leads (id, type, created_at, remote_address, user_agent, payload)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [lead.id, lead.type, lead.createdAt, lead.remoteAddress, lead.userAgent, lead.payload]
  );
  return lead;
}

async function seedEmptyDatabase(client, { ecosystemFile, rankingSitesFile }) {
  const { rows: peopleRows } = await client.query("SELECT count(*)::int AS count FROM people");
  const { rows: rankingRows } = await client.query("SELECT count(*)::int AS count FROM ranking_sites");

  if (peopleRows[0].count === 0) {
    const ecosystem = await readJsonFile(ecosystemFile, { updatedAt: null, featured: [], people: [], sites: [] });
    await seedEcosystem(client, ecosystem);
  }

  if (rankingRows[0].count === 0) {
    const rankingSites = await readJsonFile(rankingSitesFile, []);
    await seedRankingSites(client, rankingSites);
  }
}

async function seedEcosystem(client, ecosystem) {
  const featured = new Set(ecosystem.featured || []);
  await client.query("BEGIN");
  try {
    await client.query(
      `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('ecosystem', $1, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `,
      [{ updatedAt: ecosystem.updatedAt || null }]
    );

    for (const [index, person] of (ecosystem.people || []).entries()) {
      await client.query(
        `
          INSERT INTO people (
            id, name, title, subtitle, avatar_text, bio, site_id, highlight,
            feature_reason, feature_achievement, featured, sort_order, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            title = EXCLUDED.title,
            subtitle = EXCLUDED.subtitle,
            avatar_text = EXCLUDED.avatar_text,
            bio = EXCLUDED.bio,
            site_id = EXCLUDED.site_id,
            highlight = EXCLUDED.highlight,
            feature_reason = EXCLUDED.feature_reason,
            feature_achievement = EXCLUDED.feature_achievement,
            featured = EXCLUDED.featured,
            sort_order = EXCLUDED.sort_order,
            updated_at = now()
        `,
        [
          person.id,
          person.name || "",
          person.title || "",
          person.subtitle || "",
          person.avatarText || "",
          person.bio || "",
          person.siteId || "",
          person.highlight || "",
          person.featureReason || "",
          person.featureAchievement || "",
          featured.has(person.id),
          index
        ]
      );

      await client.query("DELETE FROM person_identities WHERE person_id = $1", [person.id]);
      await client.query("DELETE FROM person_tags WHERE person_id = $1", [person.id]);
      await client.query("DELETE FROM person_contacts WHERE person_id = $1", [person.id]);
      await client.query("DELETE FROM person_links WHERE person_id = $1", [person.id]);

      await insertPersonList(client, "person_identities", ["person_id", "identity", "sort_order"], person.id, person.identities || []);
      await insertPersonTags(client, person.id, person.tags || [], "tag");
      await insertPersonTags(client, person.id, person.featureTags || [], "feature");
      await insertPersonContacts(client, person.id, person.contacts || []);
      await insertPersonLinks(client, person.id, person.links || []);
    }

    for (const [index, site] of (ecosystem.sites || []).entries()) {
      await client.query(
        `
          INSERT INTO ecosystem_sites (
            id, name, domain, api_base, entry_url, type, owner_id, network,
            model_status, first_token_ms, latency_ms, uptime_24h, announcement,
            sort_order, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            domain = EXCLUDED.domain,
            api_base = EXCLUDED.api_base,
            entry_url = EXCLUDED.entry_url,
            type = EXCLUDED.type,
            owner_id = EXCLUDED.owner_id,
            network = EXCLUDED.network,
            model_status = EXCLUDED.model_status,
            first_token_ms = EXCLUDED.first_token_ms,
            latency_ms = EXCLUDED.latency_ms,
            uptime_24h = EXCLUDED.uptime_24h,
            announcement = EXCLUDED.announcement,
            sort_order = EXCLUDED.sort_order,
            updated_at = now()
        `,
        [
          site.id,
          site.name || "",
          site.domain || "",
          site.apiBase || "",
          site.entryUrl || "",
          site.type || "",
          site.ownerId || "",
          site.network || "",
          site.modelStatus || "",
          Number(site.firstTokenMs || 0),
          Number(site.latencyMs || 0),
          Number(site.uptime24h || 0),
          site.announcement || "",
          index
        ]
      );

      await client.query("DELETE FROM ecosystem_site_models WHERE site_id = $1", [site.id]);
      await client.query("DELETE FROM ecosystem_site_characteristics WHERE site_id = $1", [site.id]);
      await insertSiteList(client, "ecosystem_site_models", ["site_id", "model", "sort_order"], site.id, site.models || []);
      await insertSiteList(
        client,
        "ecosystem_site_characteristics",
        ["site_id", "characteristic", "sort_order"],
        site.id,
        site.characteristics || []
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seedRankingSites(client, sites) {
  await client.query("BEGIN");
  try {
    for (const [index, site] of sites.entries()) {
      await client.query(
        `
          INSERT INTO ranking_sites (
            slug, name, summary, canonical_host, site_kind, recommendation_level,
            risk_level, public_rate, entry_url, api_base_url, region,
            monitor_enabled, monitor_kind, monitor_api_key_env, monitor_model,
            note, source, baseline, sort_order, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, now())
          ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name,
            summary = EXCLUDED.summary,
            canonical_host = EXCLUDED.canonical_host,
            site_kind = EXCLUDED.site_kind,
            recommendation_level = EXCLUDED.recommendation_level,
            risk_level = EXCLUDED.risk_level,
            public_rate = EXCLUDED.public_rate,
            entry_url = EXCLUDED.entry_url,
            api_base_url = EXCLUDED.api_base_url,
            region = EXCLUDED.region,
            monitor_enabled = EXCLUDED.monitor_enabled,
            monitor_kind = EXCLUDED.monitor_kind,
            monitor_api_key_env = EXCLUDED.monitor_api_key_env,
            monitor_model = EXCLUDED.monitor_model,
            note = EXCLUDED.note,
            source = EXCLUDED.source,
            baseline = EXCLUDED.baseline,
            sort_order = EXCLUDED.sort_order,
            updated_at = now()
        `,
        [
          site.slug,
          site.name || "",
          site.summary || "",
          site.canonicalHost || "",
          site.siteKind || "api_relay",
          site.recommendationLevel || "none",
          site.riskLevel || "unknown",
          Number(site.publicRate || 1),
          site.entryUrl || "",
          site.apiBaseUrl || "",
          site.region || "",
          site.monitor?.enabled !== false,
          site.monitor?.kind || "",
          site.monitor?.apiKeyEnv || "",
          site.monitor?.model || "",
          site.note || "",
          site.source || {},
          site.baseline || {},
          index
        ]
      );

      await client.query("DELETE FROM ranking_site_supports WHERE site_slug = $1", [site.slug]);
      await client.query("DELETE FROM ranking_site_tags WHERE site_slug = $1", [site.slug]);
      await insertSiteList(client, "ranking_site_supports", ["site_slug", "support", "sort_order"], site.slug, site.supports || []);
      await insertSiteList(client, "ranking_site_tags", ["site_slug", "tag", "sort_order"], site.slug, site.tags || []);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function insertPersonList(client, table, columns, personId, values) {
  for (const [index, value] of unique(values).entries()) {
    await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ($1, $2, $3)`, [personId, value, index]);
  }
}

async function insertPersonTags(client, personId, tags, kind) {
  for (const [index, tag] of unique(tags).entries()) {
    await client.query("INSERT INTO person_tags (person_id, tag, kind, sort_order) VALUES ($1, $2, $3, $4)", [
      personId,
      tag,
      kind,
      index
    ]);
  }
}

async function insertPersonContacts(client, personId, contacts) {
  for (const [index, contact] of contacts.entries()) {
    await client.query(
      `
        INSERT INTO person_contacts (person_id, type, label, value, qr_url, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        personId,
        contact.type || "",
        contact.label || "",
        contact.value || "",
        contact.qrImage || contact.qrUrl || "",
        index
      ]
    );
  }
}

async function insertPersonLinks(client, personId, links) {
  for (const [index, link] of links.entries()) {
    await client.query("INSERT INTO person_links (person_id, label, url, sort_order) VALUES ($1, $2, $3, $4)", [
      personId,
      link.label || "",
      link.url || "",
      index
    ]);
  }
}

async function insertSiteList(client, table, columns, siteId, values) {
  for (const [index, value] of unique(values).entries()) {
    await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ($1, $2, $3)`, [siteId, value, index]);
  }
}

function contactFromRow(row) {
  const contact = {
    type: row.type,
    label: row.label,
    value: row.value
  };
  if (row.qr_url) contact.qrUrl = row.qr_url;
  return contact;
}

function groupRows(rows, key, transform) {
  const map = new Map();
  for (const row of rows) {
    const id = row[key];
    const values = map.get(id) || [];
    values.push(transform(row));
    map.set(id, values);
  }
  return map;
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function parseDatabaseSsl() {
  const value = String(process.env.DB_SSL || "").toLowerCase();
  if (!value || value === "false" || value === "0") return false;
  if (value === "require" || value === "true" || value === "1") return { rejectUnauthorized: false };
  return false;
}

function ensureDatabase() {
  if (!isDatabaseEnabled()) {
    throw new Error("Database is not initialized.");
  }
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
