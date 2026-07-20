import { create } from "zustand";
import { runReview, type ReviewResponse } from "../lib/ipc";
import { useToastStore } from "./toastStore";

export type ReviewDimension = "security" | "code" | "ux";

/** Review dimensions the user can pick. Keys match the BYOK review payload. */
export const REVIEW_DIMENSIONS: { key: ReviewDimension; label: string; blurb: string }[] = [
  { key: "security", label: "Security", blurb: "injection · auth · secrets · validation" },
  { key: "code", label: "Correctness", blurb: "logic bugs · edge cases · leaks" },
  { key: "ux", label: "UX / UI", blurb: "states · a11y · copy · hierarchy" },
];

export type ReviewStatus = "running" | "done" | "error";

/** One review run. Reviews are kept in a history so you can run several, revisit
 *  finished ones, and delete the ones you're done with. */
export interface ReviewRecord {
  id: string;
  dir: string;
  /** Short label for the history list — the repo's folder name. */
  label: string;
  createdAt: number;
  dimensions: ReviewDimension[];
  status: ReviewStatus;
  data: ReviewResponse | null;
  error: string | null;
}

interface ReviewState {
  reviews: ReviewRecord[]; // newest first
  /** Which review is shown in the panel. null = the "new review" picker. */
  activeId: string | null;
  /** Default reviewer selection for the next review. */
  dimensions: ReviewDimension[];
  setDimensions: (d: ReviewDimension[]) => void;
  toggleDimension: (d: ReviewDimension) => void;
  selectReview: (id: string | null) => void;
  removeReview: (id: string) => void;
  /**
   * Start a review. It runs in the background — state lives here, not in the
   * panel — so you can close the panel, run another, and come back. On
   * completion it raises a toast so you know it's ready even if the panel is shut.
   */
  startReview: (dir: string, dims?: ReviewDimension[]) => Promise<void>;
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rev_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  reviews: [],
  activeId: null,
  dimensions: ["security", "code", "ux"],

  setDimensions: (dimensions) => set({ dimensions }),
  toggleDimension: (d) =>
    set((s) => ({
      dimensions: s.dimensions.includes(d)
        ? s.dimensions.filter((x) => x !== d)
        : [...s.dimensions, d],
    })),

  selectReview: (id) => set({ activeId: id }),
  removeReview: (id) =>
    set((s) => ({
      reviews: s.reviews.filter((r) => r.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    })),

  startReview: async (dir, dims) => {
    const dimensions = dims ?? get().dimensions;
    if (dimensions.length === 0) return;
    const id = uid();
    const label = dir.split("/").filter(Boolean).pop() ?? dir;
    const record: ReviewRecord = {
      id, dir, label, createdAt: Date.now(), dimensions, status: "running", data: null, error: null,
    };
    set((s) => ({ reviews: [record, ...s.reviews], activeId: id }));

    const patch = (p: Partial<ReviewRecord>) =>
      set((s) => ({ reviews: s.reviews.map((r) => (r.id === id ? { ...r, ...p } : r)) }));

    try {
      const data = await runReview(dir, dimensions);
      patch({ status: "done", data });
      const n = data.reviews.reduce((a, r) => a + r.findings.length, 0);
      useToastStore.getState().addToast(
        `Review complete — ${n} finding${n === 1 ? "" : "s"} in ${label}. Open the review panel to see it.`,
        n > 0 ? "warning" : "success",
        7000,
      );
    } catch (e) {
      const msg = typeof e === "string" ? e : (e as Error)?.message ?? "Review failed.";
      patch({ status: "error", error: msg });
      useToastStore.getState().addToast(`Review failed in ${label}: ${msg}`, "error", 7000);
    }
  },
}));

/**
 * The whole review, formatted as a prompt the user can paste into an agent. The
 * lead line tells the agent to triage the findings rather than blindly apply them.
 */
export function reviewToPrompt(data: ReviewResponse): string {
  const lines: string[] = [
    "Analyze this code review and let me know if there are any specific things from this review that we actually need to fix. Double-check each finding against the real code before acting — call out false positives, and for the ones that are real, propose the concrete fix.",
    "",
  ];
  for (const r of data.reviews) {
    if (!r.findings.length) continue;
    lines.push(`## ${r.label}`);
    for (const f of r.findings) {
      const loc = `${f.file}${f.line != null ? `:${f.line}` : ""}`;
      lines.push(`- [${f.severity.toUpperCase()}] ${loc} — ${f.title}`);
      lines.push(`  Why: ${f.why}`);
      lines.push(`  Fix: ${f.fix}`);
    }
    lines.push("");
  }
  if (data.reviews.every((r) => r.findings.length === 0)) {
    lines.push("(The review found no issues across the selected reviewers.)");
  }
  return lines.join("\n") + "\n";
}
