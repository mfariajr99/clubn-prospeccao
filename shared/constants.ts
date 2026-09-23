// Domain constants shared by the API and the web client.

export const REGISTRATION_STATUSES = ["prospect", "qualified", "client", "inactive"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  prospect: "Prospect",
  qualified: "Lead qualificado",
  client: "Cliente",
  inactive: "Inativo",
};

/**
 * Commercial contact status. Only "whatsapp_opened" may be set by the system
 * (when the operator clicks "Enviar mensagem"). Every other change is manual.
 */
export const CONTACT_STATUSES = [
  "not_contacted",
  "whatsapp_opened",
  "message_sent",
  "replied",
  "interested",
  "not_interested",
  "partnership",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  not_contacted: "Não contatado",
  whatsapp_opened: "WhatsApp aberto",
  message_sent: "Mensagem enviada",
  replied: "Respondeu",
  interested: "Interessado",
  not_interested: "Não interessado",
  partnership: "Parceria concluída",
};
/** Statuses that mean the operator confirmed a real contact happened. */
export const CONTACTED_STATUSES: ContactStatus[] = [
  "message_sent",
  "replied",
  "interested",
  "not_interested",
  "partnership",
];

export const CAMPAIGN_STATUSES = ["draft", "ready", "in_progress", "paused", "completed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Rascunho",
  ready: "Pronta para iniciar",
  in_progress: "Em andamento",
  paused: "Pausada",
  completed: "Concluída",
};
export const EDITABLE_CAMPAIGN_STATUSES: CampaignStatus[] = ["draft", "ready", "paused"];

export const LINK_TYPES = [
  "instagram",
  "site",
  "facebook",
  "tiktok",
  "linktree",
  "google_maps",
  "other",
] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  instagram: "Instagram",
  site: "Site",
  facebook: "Facebook",
  tiktok: "TikTok",
  linktree: "Linktree",
  google_maps: "Google Maps",
  other: "Outro",
};

export const PREVIEW_STATUSES = [
  "not_requested",
  "pending",
  "processing",
  "available",
  "stale",
  "blocked",
  "invalid_link",
  "error",
] as const;
export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];
export const PREVIEW_STATUS_LABELS: Record<PreviewStatus, string> = {
  not_requested: "Não solicitado",
  pending: "Aguardando captura",
  processing: "Processando",
  available: "Disponível",
  stale: "Desatualizado",
  blocked: "Bloqueado pelo site",
  invalid_link: "Link inválido",
  error: "Erro na captura",
};

export const POTENTIAL_LEVELS = ["high", "medium", "low"] as const;
export type PotentialLevel = (typeof POTENTIAL_LEVELS)[number];
export const POTENTIAL_LABELS: Record<PotentialLevel | "none", string> = {
  high: "Alto potencial",
  medium: "Médio potencial",
  low: "Baixo potencial",
  none: "Não avaliado",
};

export const QUALITY_LEVELS = ["low", "medium", "high"] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];
export const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

export const EVALUATION_CHECKLIST = [
  { key: "active_profile", label: "Perfil ou site ativo" },
  { key: "professional_identity", label: "Identidade visual profissional" },
  { key: "recent_content", label: "Conteúdo recente" },
  { key: "contact_info", label: "Informações de contato disponíveis" },
  { key: "compatible_audience", label: "Público compatível" },
  { key: "location_confirmed", label: "Localização confirmada" },
  { key: "compatible_offer", label: "Produtos ou serviços compatíveis" },
  { key: "commercial_potential", label: "Bom potencial comercial" },
] as const;
export type ChecklistKey = (typeof EVALUATION_CHECKLIST)[number]["key"];

export const LEAD_SOURCES = ["manual", "import", "seed"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  manual: "Cadastro manual",
  import: "Importação",
  seed: "Demonstração",
};

/** Message used when the operator opens WhatsApp outside of any campaign. */
export const DEFAULT_WHATSAPP_MESSAGE =
  "Olá, {{nome_estabelecimento}}! Aqui é do Club’n. Gostaríamos de apresentar uma proposta de parceria para o seu negócio em {{cidade}}. Podemos conversar?";

/** Three default wordings (rotated) for sends outside any campaign. */
export const DEFAULT_WHATSAPP_MESSAGES = [
  DEFAULT_WHATSAPP_MESSAGE,
  "Oi, {{nome_estabelecimento}}! Tudo bem? Sou do Club’n e tenho uma proposta de parceria para negócios de {{cidade}}. Posso te explicar rapidinho?",
  "Bom dia, {{nome_estabelecimento}}! O Club’n está selecionando parceiros em {{cidade}} e pensamos em vocês. Podemos conversar?",
];
