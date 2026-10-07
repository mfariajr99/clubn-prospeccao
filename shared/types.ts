import type {
  CampaignStatus,
  ContactStatus,
  LeadSource,
  LinkType,
  PotentialLevel,
  PreviewStatus,
  QualityLevel,
  RegistrationStatus,
} from "./constants.js";
import type { CampaignRuleView, LotsView } from "./campaignRule.js";

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface LeadLink {
  id: number;
  lead_id: number;
  url: string;
  link_type: LinkType;
  is_primary: 0 | 1;
}

export interface Lead {
  id: number;
  establishment_name: string;
  segment: string;
  neighborhood: string;
  city: string;
  state: string;
  whatsapp: string;
  whatsapp_valid: 0 | 1;
  digital_presence_url: string | null;
  digital_presence_type: LinkType | null;
  cover_image_url: string | null;
  registration_status: RegistrationStatus;
  contact_status: ContactStatus;
  source: LeadSource;
  import_batch_id: number | null;
  import_batch_filename?: string | null;
  created_by: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  potential_level?: PotentialLevel | null;
  score?: number | null;
  links?: LeadLink[];
  /** Most recent campaign "em andamento" that includes this lead (its message is used by "Enviar mensagem"). */
  active_campaign_id?: number | null;
  active_campaign_name?: string | null;
  active_campaign_message?: string | null;
  active_campaign_message_2?: string | null;
  active_campaign_message_3?: string | null;
}

export interface Campaign {
  id: number;
  name: string;
  description: string;
  message_template: string;
  message_template_2?: string;
  message_template_3?: string;
  status: CampaignStatus;
  created_by: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  lead_count?: number;
  opened_count?: number;
  contacted_count?: number;
  interested_count?: number;
  partnership_count?: number;
  last_activity_at?: string | null;
  send_limit?: number | null;
  send_window_hours?: number | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  rule?: CampaignRuleView;
  batch_size?: number | null;
  batch_hours?: number | null;
  lots?: LotsView | null;
}

export interface CampaignLead extends Lead {
  campaign_lead_id: number;
  campaign_id: number;
  campaign_contact_status: ContactStatus;
  whatsapp_opened_at: string | null;
  last_contact_at: string | null;
  notes: string | null;
  campaign_potential_level?: PotentialLevel | null;
  batch_number?: number | null;
}

export interface ImportBatch {
  id: number;
  original_filename: string;
  total_rows: number;
  imported_rows: number;
  updated_rows: number;
  skipped_rows: number;
  error_rows: number;
  duplicate_rows: number;
  status: "processing" | "completed" | "completed_with_errors" | "failed";
  imported_by: number | null;
  imported_by_name?: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ContactHistoryEntry {
  id: number;
  lead_id: number;
  campaign_id: number | null;
  campaign_name?: string | null;
  previous_status: ContactStatus | null;
  new_status: ContactStatus;
  notes: string | null;
  event_type?: "status_change" | "whatsapp_opened" | "whatsapp_sent";
  message_type?: number | null;
  changed_by: number | null;
  changed_by_name?: string | null;
  changed_at: string;
}

export interface LinkPreview {
  id: number | null;
  lead_id: number;
  link_type: LinkType;
  original_url: string;
  normalized_url: string;
  final_url: string | null;
  page_title: string | null;
  page_description: string | null;
  domain: string | null;
  favicon_url: string | null;
  open_graph_image_url: string | null;
  screenshot_storage_path: string | null;
  screenshot_url?: string | null;
  preview_status: PreviewStatus;
  error_code: string | null;
  error_message: string | null;
  captured_at: string | null;
  expires_at: string | null;
  refreshing?: boolean;
  next_refresh_allowed_at?: string | null;
}

export interface Evaluation {
  id: number;
  lead_id: number;
  campaign_id: number | null;
  evaluator_user_id: number;
  evaluator_name?: string | null;
  potential_level: PotentialLevel;
  score: number;
  digital_presence_quality: QualityLevel | null;
  campaign_compatibility: QualityLevel | null;
  perceived_popularity: QualityLevel | null;
  visual_quality: QualityLevel | null;
  checklist_data: Record<string, boolean>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type DuplicateAction = "skip" | "update";

export interface ImportAnalysisRow {
  rowNumber: number;
  values: Record<string, string>;
  valid: boolean;
  errors: string[];
  lead: import("./leadInput.js").NormalizedLead | null;
  duplicate: null | {
    kind: "sheet_phone" | "sheet_name" | "existing_phone" | "existing_name";
    existingLeadId?: number;
    existingName?: string;
    existingBatchId?: number | null;
    firstRowNumber?: number;
    message: string;
  };
}

export interface ImportAnalysis {
  filename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  rows: ImportAnalysisRow[];
}

export interface DashboardMetrics {
  total_leads: number;
  total_prospects: number;
  imported_prospects: number;
  with_presence: number;
  without_link: number;
  evaluated: number;
  high_potential: number;
  campaigns_in_progress: number;
  contacted: number;
  interested: number;
  partnerships: number;
  previews_problem: number;
  conversion_by_potential: { level: PotentialLevel | "none"; total: number; interested: number; partnerships: number }[];
  conversion_by_campaign: { id: number; name: string; status: CampaignStatus; total: number; contacted: number; interested: number; partnerships: number }[];
  tracking: CampaignTrackingSummary;
}

/** Main dashboard: active/scheduled campaigns, this week's plan and replies vs the 20% goal. */
export interface CampaignTrackingSummary {
  week_start: string;
  week_end: string;
  reply_goal: number; // 0.2 = 20%
  active_campaigns: number;
  scheduled_campaigns: number;
  /** Messages planned for this week (already sent this week + still to send). */
  planned_this_week: number;
  sent_this_week: number;
  sent_total: number;
  replied_total: number;
  campaigns: CampaignTracking[];
}

export interface CampaignTracking {
  id: number;
  name: string;
  status: CampaignStatus;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  started_at: string | null;
  rule: CampaignRuleView;
  lots: LotsView | null;
  total: number;
  pending: number;
  sent: number;
  replied: number;
  interested: number;
  sent_this_week: number;
  planned_this_week: number;
}

// ---------------- Access (master admin + independent client logins) ----------------
export type Role = "admin" | "client";

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
  role: Role | null;
  account: { id: number; name: string; login: string } | null;
  /** Demo build only: credentials hint shown on the login screen. */
  hint?: string;
}

/** Numbers only: the admin follows clients without seeing their leads or messages. */
export interface ClientMetrics {
  leads: number;
  campaigns: number;
  campaigns_in_progress: number;
  whatsapp_opened: number;
  contacted: number;
  replied: number;
  interested: number;
  partnerships: number;
  sends_today: number;
  last_activity_at: string | null;
}

export interface ClientAccountSummary {
  id: number;
  name: string;
  login: string;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
  metrics: ClientMetrics;
}

export interface ClientCampaignNumbers {
  id: number;
  name: string;
  status: CampaignStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  total: number;
  whatsapp_opened: number;
  contacted: number;
  replied: number;
  interested: number;
  not_interested: number;
  partnerships: number;
}

export interface ClientAccountDetail extends ClientAccountSummary {
  campaigns: ClientCampaignNumbers[];
}

// ---------------- WhatsApp "conexão própria" (one number per operator) ----------------
export type WhatsAppState = "disconnected" | "connecting" | "qr" | "pairing" | "connected";

export interface WhatsAppStatus {
  state: WhatsAppState;
  /** QR Code image (data URL) while waiting for the scan. */
  qr: string | null;
  /** 8-character code for "Conectar com número de telefone". */
  pairing_code: string | null;
  phone: string | null;
  name: string | null;
  error: string | null;
  updated_at: string;
  /** Demo build: connection is simulated, nothing is sent. */
  simulated?: boolean;
}

// ---------------- "Mensagens" (WhatsApp inbox of the selected operator) ----------------
export interface InboxConversation {
  chat_jid: string;
  phone: string | null;
  lead_id: number | null;
  lead_name: string | null;
  contact_name: string | null;
  last_body: string;
  last_from_me: boolean;
  last_at: string;
  unread: number;
}

export interface InboxMessage {
  id: number;
  from_me: boolean;
  body: string;
  sent_at: string;
}
