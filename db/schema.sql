CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  avatar_text TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  site_id TEXT NOT NULL DEFAULT '',
  highlight TEXT NOT NULL DEFAULT '',
  feature_reason TEXT NOT NULL DEFAULT '',
  feature_achievement TEXT NOT NULL DEFAULT '',
  featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS person_identities (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  identity TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, identity)
);

CREATE TABLE IF NOT EXISTS person_tags (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'tag',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, kind, tag)
);

CREATE TABLE IF NOT EXISTS person_contacts (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  qr_url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_contacts_person_id ON person_contacts(person_id);

CREATE TABLE IF NOT EXISTS person_links (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_links_person_id ON person_links(person_id);

CREATE TABLE IF NOT EXISTS ecosystem_sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  api_base TEXT NOT NULL DEFAULT '',
  entry_url TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '',
  network TEXT NOT NULL DEFAULT '',
  model_status TEXT NOT NULL DEFAULT '',
  first_token_ms INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  uptime_24h NUMERIC(6, 2) NOT NULL DEFAULT 0,
  announcement TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_sites_owner_id ON ecosystem_sites(owner_id);

CREATE TABLE IF NOT EXISTS ecosystem_site_models (
  site_id TEXT NOT NULL REFERENCES ecosystem_sites(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, model)
);

CREATE TABLE IF NOT EXISTS ecosystem_site_characteristics (
  site_id TEXT NOT NULL REFERENCES ecosystem_sites(id) ON DELETE CASCADE,
  characteristic TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, characteristic)
);

CREATE TABLE IF NOT EXISTS ranking_sites (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  canonical_host TEXT NOT NULL DEFAULT '',
  site_kind TEXT NOT NULL DEFAULT 'api_relay',
  recommendation_level TEXT NOT NULL DEFAULT 'none',
  risk_level TEXT NOT NULL DEFAULT 'unknown',
  public_rate NUMERIC(10, 4) NOT NULL DEFAULT 1,
  entry_url TEXT NOT NULL DEFAULT '',
  api_base_url TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  monitor_enabled BOOLEAN NOT NULL DEFAULT true,
  monitor_kind TEXT NOT NULL DEFAULT '',
  monitor_api_key_env TEXT NOT NULL DEFAULT '',
  monitor_model TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source JSONB NOT NULL DEFAULT '{}'::jsonb,
  baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ranking_sites_monitor_enabled ON ranking_sites(monitor_enabled);

CREATE TABLE IF NOT EXISTS ranking_site_supports (
  site_slug TEXT NOT NULL REFERENCES ranking_sites(slug) ON DELETE CASCADE,
  support TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_slug, support)
);

CREATE TABLE IF NOT EXISTS ranking_site_tags (
  site_slug TEXT NOT NULL REFERENCES ranking_sites(slug) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_slug, tag)
);

CREATE TABLE IF NOT EXISTS monitor_results (
  id BIGSERIAL PRIMARY KEY,
  site_slug TEXT NOT NULL REFERENCES ranking_sites(slug) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  available BOOLEAN NOT NULL DEFAULT false,
  monitor_mode TEXT NOT NULL DEFAULT 'public',
  status INTEGER NOT NULL DEFAULT 0,
  status_text TEXT NOT NULL DEFAULT '',
  purity_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  uptime_24h NUMERIC(6, 2) NOT NULL DEFAULT 0,
  first_token_ms INTEGER NOT NULL DEFAULT 0,
  latest_response_ms INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_monitor_results_site_checked ON monitor_results(site_slug, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_results_checked_at ON monitor_results(checked_at DESC);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  remote_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_type_created ON leads(type, created_at DESC);
