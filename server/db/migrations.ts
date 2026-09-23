// Versioned, forward-only SQL migrations. Never edit an applied migration:
// add a new entry instead.

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_filename TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_action TEXT NOT NULL DEFAULT 'skip' CHECK (duplicate_action IN ('skip','update','review')),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','completed','completed_with_errors','failed')),
  report_json TEXT NOT NULL DEFAULT '[]',
  imported_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  completed_at TEXT
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  establishment_name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  whatsapp_valid INTEGER NOT NULL DEFAULT 1 CHECK (whatsapp_valid IN (0,1)),
  digital_presence_url TEXT,
  digital_presence_type TEXT CHECK (digital_presence_type IS NULL OR digital_presence_type IN ('instagram','site','facebook','tiktok','linktree','google_maps','other')),
  cover_image_url TEXT,
  registration_status TEXT NOT NULL DEFAULT 'prospect' CHECK (registration_status IN ('prospect','qualified','client','inactive')),
  contact_status TEXT NOT NULL DEFAULT 'not_contacted' CHECK (contact_status IN ('not_contacted','whatsapp_opened','message_sent','replied','interested','not_interested','partnership')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','seed')),
  import_batch_id INTEGER REFERENCES import_batches(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX leads_whatsapp_unique ON leads(whatsapp) WHERE whatsapp_valid = 1;
CREATE INDEX leads_name_key ON leads(name_key);
CREATE INDEX leads_city_state ON leads(state, city);
CREATE INDEX leads_segment ON leads(segment);
CREATE INDEX leads_batch ON leads(import_batch_id);
CREATE INDEX leads_created_at ON leads(created_at);

CREATE TABLE lead_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (lead_id, url)
);

-- Every lead created or updated by a batch (used by the batch filter and the history).
CREATE TABLE import_batch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('imported','updated')),
  UNIQUE (batch_id, lead_id)
);
CREATE INDEX import_batch_items_lead ON import_batch_items(lead_id);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  message_template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','in_progress','paused','completed')),
  created_by INTEGER REFERENCES users(id),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE campaign_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contact_status TEXT NOT NULL DEFAULT 'not_contacted' CHECK (contact_status IN ('not_contacted','whatsapp_opened','message_sent','replied','interested','not_interested','partnership')),
  whatsapp_opened_at TEXT,
  last_contact_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (campaign_id, lead_id)
);
CREATE INDEX campaign_leads_lead ON campaign_leads(lead_id);

CREATE TABLE contact_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL DEFAULT 'status_change' CHECK (event_type IN ('status_change','whatsapp_opened')),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  notes TEXT,
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX contact_history_lead ON contact_history(lead_id, changed_at);
CREATE INDEX contact_history_campaign ON contact_history(campaign_id);

-- Technical cache for digital presence previews. Never used for messages.
CREATE TABLE link_previews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  original_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  final_url TEXT,
  page_title TEXT,
  page_description TEXT,
  domain TEXT,
  favicon_url TEXT,
  open_graph_image_url TEXT,
  screenshot_storage_path TEXT,
  preview_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (preview_status IN ('not_requested','pending','processing','available','stale','blocked','invalid_link','error')),
  error_code TEXT,
  error_message TEXT,
  captured_at TEXT,
  expires_at TEXT,
  last_requested_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (lead_id, normalized_url)
);

CREATE TABLE prospect_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  evaluator_user_id INTEGER NOT NULL REFERENCES users(id),
  potential_level TEXT NOT NULL CHECK (potential_level IN ('low','medium','high')),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  digital_presence_quality TEXT CHECK (digital_presence_quality IS NULL OR digital_presence_quality IN ('low','medium','high')),
  campaign_compatibility TEXT CHECK (campaign_compatibility IS NULL OR campaign_compatibility IN ('low','medium','high')),
  perceived_popularity TEXT CHECK (perceived_popularity IS NULL OR perceived_popularity IN ('low','medium','high')),
  visual_quality TEXT CHECK (visual_quality IS NULL OR visual_quality IN ('low','medium','high')),
  checklist_data TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
-- One general evaluation (campaign_id NULL) and one per campaign, per lead.
CREATE UNIQUE INDEX prospect_evaluations_scope ON prospect_evaluations(lead_id, IFNULL(campaign_id, 0));
`,
  },
  {
    id: 2,
    name: "operators_messages_and_send_quota",
    sql: `
-- Team operators
INSERT OR IGNORE INTO users (name, email) VALUES ('Thomaz', 'thomaz@clubn.local');
INSERT OR IGNORE INTO users (name, email) VALUES ('Lucas', 'lucas@clubn.local');
INSERT OR IGNORE INTO users (name, email) VALUES ('Marcos', 'marcos@clubn.local');

-- Each campaign has 3 alternating messages (type 1 = message_template).
ALTER TABLE campaigns ADD COLUMN message_template_2 TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN message_template_3 TEXT NOT NULL DEFAULT '';

-- Which message type was used when WhatsApp was opened.
ALTER TABLE contact_history ADD COLUMN message_type INTEGER;

-- Sending discipline per operator (sessions 30/15/30/15 in a 24h cycle).
CREATE TABLE operator_send_quota (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cycle_started_at TEXT,
  session_index INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
`,
  },
];
