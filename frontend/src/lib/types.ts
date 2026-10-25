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
  stage: string; // vision | gate | guideline | reasoning
  model_id?: string | null;
  replayed: boolean;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  est_cost_usd: number;
  payload: Record<string, unknown>;
  note: string;
}

export interface Guideline {
  title: string;
  url: string;
  snippet: string;
  source: "tavily_live" | "cache_snapshot";
}

export interface AuditResult {
  encounter_id: string;
  status: string; // SILENT_PASS | CRITICAL_INTERCEPT | ERROR
  verdicts: InterceptionVerdict[];
  traces: StageTrace[];
  total_cost_usd: number;
  elapsed_ms: number;
  error?: string; // rides the SSE payload only on crash
}

export interface RunStartEvent {
  encounter_id: string;
  mode: "LIVE" | "REPLAYED";
  daily_spend_usd: number;
  mode_note: string;
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
  inference_mode: "LIVE" | "REPLAYED";
  nebius_base_url: string;
  models: Partial<Record<"vision" | "gate" | "reasoning" | "failsafe", string | null>>;
  tavily_live: boolean;
  spend_caps: Record<string, number>;
}
