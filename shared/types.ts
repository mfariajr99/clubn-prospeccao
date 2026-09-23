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
}

export interface CampaignLead extends Lead {
  campaign_lead_id: number;
  campaign_id: number;
  campaign_contact_status: ContactStatus;
  whatsapp_opened_at: string | null;
  last_contact_at: string | null;
  notes: string | null;
  campaign_potential_level?: PotentialLevel | null;
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
}
