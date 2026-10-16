export type EvidenceQuestion = "popularity" | "speed" | "cost" | "scale" | "choice";

export interface EvidenceMetric {
  name: string;
  value: number | null;
  text: string | null;
  unit: string;
  sourceUrl: string;
  fetchedAt: string;
  error?: string;
}

export interface EvidenceOption {
  label: string;
  metrics: EvidenceMetric[];
  docsUrl: string | null;
  docsSourceUrl: string | null;
  docsError?: string;
}

export interface EvidenceReport {
  claim: string;
  question: EvidenceQuestion;
  options: EvidenceOption[];
  fetchedAt: string;
  note?: string;
}

export interface TechSelection {
  recommendation: string;
  confidence: "low" | "medium" | "high";
  pros: string[];
  cons: string[];
  sources: string[];
}

export interface Debate {
  architect: string;
  skeptic: string;
  conclusion: string;
}

export interface PackageTarget {
  label: string;
  github?: { owner: string; repo: string };
  npm?: string;
  pypi?: string;
}
