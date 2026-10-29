/**
 * TS mirrors of the Phase-2 SSE wire (backend/schemas.py `model_dump()` shapes).
 * Snake_case on purpose — the stream IS the contract; no client-side renaming.
 * Additive at most: every field here is nullable-tolerant the way the wire is.
 */

export type Severity = "CRITICAL" | "WARNING";
export type FindingKind = "INCIDENTAL_FINDING_DROP" | "KINETIC_MED_COLLISION";
export type SlopeStatus = "VALID" | "INSUFFICIENT_TIME_SERIES";

/** Console state machine phases (verifying is folded into running→safe). */
export type Phase =
  | "boot"
  | "idle"
  | "running"
  | "pass"
  | "intercept"
  | "safe"
  | "error";

export interface LabPoint {
  timestamp_hr: number;
  value: number;
  ref_min?: number | null;
  ref_max?: number | null;
}

export interface RadiologyStudy {
  modality: string;
  slice_image_url?: string | null;
  report_text: string;
}

export interface Prescription {
  drug_name: string;
  dose: string;
  days: number;
  drug_class?: string;
  class?: string;
}

export interface FollowUpOrder {
  specialty: string;
  timeframe: string;
  reason: string;
  cpt_code: string;
}

export interface DischargePacket {
  primary_diagnosis_icd10: string;
  discharge_instructions: string;
  prescriptions: Prescription[];
  follow_up_orders: FollowUpOrder[];
}

export interface LabNote {
  text: string;
}

export interface Encounter {
  encounter_id: string;
  patient_scenario: string;
  chief_complaint: string;
  radiology_study: RadiologyStudy;
  serial_labs: Record<string, LabPoint[]>;
  lab_note?: LabNote | null;
  draft_discharge_packet: DischargePacket;
}

export interface DischargePatchPiece {
  remove_drug_name?: string | null;
  add_prescription?: Prescription | null;
  add_follow_up_order?: FollowUpOrder | null;
  note: string;
}

export interface VerifiedSpan {
  start_char: number;
  end_char: number;
  match_mode: string; // "WS_PUNCT_COLLAPSED" | "ALNUM_ONLY"
}

export interface InterceptionVerdict {
  kind: FindingKind;
  severity: Severity;
  explanation: string;
  source_quote: string;
  verified_span: VerifiedSpan;
  guideline_url?: string | null;
  discharge_patch: DischargePatchPiece;
}

export interface ScanFinding {
  description: string;
  location?: string | null;
  measurement_mm?: number | null;
  acute: boolean;
  verbatim_quote: string;
  recommended_cpt?: string | null;
}

export interface GateDecision {
  action: string; // SILENT_PASS | ESCALATE
  reasons: string[];
  confidence: number;
  source: string; // code-set
}

/** Client-side mirror of backend KinematicSlope (kinematic_labs.py). */
export interface KinematicSlope {
  analyte: string;
  status: SlopeStatus;
  slope_per_hour?: number | null;
  slope_per_day?: number | null;
  pct_delta_from_baseline?: number | null;
  abs_delta?: number | null;
  first_value?: number | null;
  last_value?: number | null;
  n_points: number;
  flags: string[];
}

export interface StageTrace {
  stage: string; // vision | gate | guideline | reasoning | span_guard
  model_id?: string | null;
  replayed: boolean;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  est_cost_usd: number | null;
  payload: Record<string, unknown>;
  note: string;
  /** Stable machine-readable provenance set by the backend (never by a model). */
  source: string;
}

export interface Guideline {
  title: string;
  url: string;
  snippet: string;
  source: "tavily_live" | "cache_snapshot";
}

export interface AuditResult {
  encounter_id: string;
  status: string; // SILENT_PASS | CRITICAL_INTERCEPT | INCOMPLETE | ERROR
  verdicts: InterceptionVerdict[];
  traces: StageTrace[];
  total_cost_usd: number;
  elapsed_ms: number;
  execution_mode?: string; // LIVE | MIXED | REPLAYED | FAILED | ERROR
  stage_sources?: Record<string, string>;
  fallback_used?: boolean;
  error?: string; // rides the SSE payload only on crash
}

export interface RunStartEvent {
  encounter_id: string;
  mode: "LIVE" | "REPLAYED";
  requested_mode?: "LIVE" | "REPLAYED";
  daily_spend_usd: number;
  mode_note: string;
  allow_seed_fallback?: boolean;
}


export type StageDoneEvent =
  | { stage: "vision"; trace: StageTrace; findings: ScanFinding[]; vision_confidence: string }
  | { stage: "gate"; trace: StageTrace; decision: GateDecision }
  | {
      stage: "guideline";
      queries: string[];
      guidelines: Guideline[];
      trace: StageTrace;
      query_trace: StageTrace;
      degraded?: boolean;
    }
  | { stage: "reasoning"; trace: StageTrace; verdicts: InterceptionVerdict[] };

export type AuditEvent =
  | { event: "run_start"; data: RunStartEvent }
  | { event: "stage_start"; data: { stage: string } }
  | { event: "stage_done"; data: StageDoneEvent }
  | { event: "verdict"; data: AuditResult }
  | { event: "done"; data: AuditResult };

export interface Healthz {
  status: string;
  /** Configuration capability only — this endpoint makes no provider call. */
  inference_mode: "LIVE_CAPABLE" | "REPLAY_ONLY";
  live_capable: boolean;
  mode_note: string;
  nebius_base_url: string;
  models: Partial<Record<"vision" | "gate" | "reasoning" | "failsafe", string | null>>;
  tavily_configured: boolean;
  /** @deprecated Backward-compatible alias for `tavily_configured`. */
  tavily_live?: boolean;
  spend_caps: Record<string, number>;
}

/* ------------------------------------------------------------------ benchmark */

export type BenchmarkMode = "LIVE" | "MIXED" | "REPLAYED" | "FAILED";

export interface BenchmarkStage {
  stage: string;
  source: string;
  model_id?: string | null;
  replayed: boolean;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  cost_type: string;
  note: string;
}

export interface BenchmarkCase {
  encounter_id: string;
  expected_contradiction: boolean;
  expected_outcome: "CRITICAL_INTERCEPT" | "SILENT_PASS";
  predicted_outcome: string | null;
  flagged: boolean | null;
  evaluable: boolean;
  scored: boolean;
  score_source?: "live_inference" | "fixture_deterministic" | "fixture_seeded" | null;
  status: string;
  prediction_source: string;
  case_mode: BenchmarkMode | string;
  fallback_affected: boolean;
  verification_rejected: boolean;
  stages: BenchmarkStage[];
  stage_sources: Record<string, string>;
  latency_ms: number | null;
  latency_scope: string;
  cost_usd: number | null;
  cost_type: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  verdicts_count: number;
  error: string | null;
  notes: string[];
}

export interface BenchmarkSummary {
  key: string;
  name: string;
  description: string[];
  input_modality: string;
  mode: string;
  total_cases: number;
  evaluable_cases: number;
  scored_cases: number;
  score_source: "live_inference" | "fixture_deterministic" | "fixture_seeded" | null;
  incomplete_cases: number;
  failed_cases: number;
  fallback_affected_cases: number;
  replay_check_total: number;
  replay_check_matches: number;
  replay_check_pct: number | null;
  positive_cases_total: number;
  negative_cases_total: number;
  positive_cases_scored: number;
  negative_cases_scored: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  recall_pct: number | null;
  precision_pct: number | null;
  specificity_pct: number | null;
  fpr_pct: number | null;
  median_latency_ms: number | null;
  p95_latency_ms: number | null;
  latency_n: number;
  latency_scope: string;
  estimated_latency_ms: Record<string, number> | null;
  cost_per_1k_discharges_usd: number | null;
  cost_per_discharge_avg_usd: number | null;
  cost_type: string;
  pricing_version: string;
  cost_reduction_vs_ultra_pct: number | null;
  notes: string[];
}

export interface BenchmarkMeta {
  schema_version: number;
  eval_date: string;
  mode: string;
  environment: string;
  requested_mode: string;
  scoring_basis?: string;
  git_commit: string | null;
  total_encounters: number;
  positive_cases: number;
  negative_cases: number;
  safe_count: number;
  contradiction_count: number;
  total_eval_runs: number;
  configs_evaluated: string[];
  case_limit: number | null;
  case_ids: string[];
  models_resolved: Record<string, string | null>;
  tavily_configured: boolean;
  pricing: Record<string, unknown>;
  disclaimers: string[];
  limitations: string[];
}

export interface BenchmarkReport {
  schema_version: number;
  meta: BenchmarkMeta;
  summary: Record<string, BenchmarkSummary>;
  configs: Record<string, BenchmarkSummary>;
  cases: BenchmarkCase[];
}
