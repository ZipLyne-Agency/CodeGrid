import { create } from "zustand";

// Memory cost estimates (MB) — single source of truth for both the
// recommendation math and the UI breakdown (ResourceIndicator / dialog).
export const SHELL_COST_MB = 50;
export const AGENT_COST_MB = 400;

export type WarningLevel = "none" | "soft" | "hard";

interface ResourceState {
  totalMemoryMb: number;
  availableMemoryMb: number;
  usedMemoryMb: number;
  usagePercent: number;
  warningLevel: WarningLevel;
  lastPollTime: number;

  // Computed from sessions
  shellCount: number;
  agentCount: number;
  estimatedTerminalUsageMb: number;
  recommendedMaxMore: number;

  // Actions
  updateMemory: (info: {
    total_memory_mb: number;
    available_memory_mb: number;
    used_memory_mb: number;
    usage_percent: number;
  }) => void;
  updateSessionCounts: (shellCount: number, agentCount: number) => void;
  getScrollbackForCount: (terminalCount: number) => number;
  canCreateTerminal: () => { allowed: boolean; reason?: string };
}

function computeWarningLevel(availableMb: number): WarningLevel {
  if (availableMb >= 2048) return "none";
  if (availableMb >= 1024) return "soft";
  return "hard";
}

function computeEstimatedUsage(shellCount: number, agentCount: number): number {
  return shellCount * SHELL_COST_MB + agentCount * AGENT_COST_MB;
}

function computeRecommendedMaxMore(
  availableMb: number,
  shellCount: number,
  agentCount: number,
): number {
  const totalSessions = shellCount + agentCount;
  if (totalSessions === 0) {
    // Default to shell cost when no sessions exist
    return Math.floor(availableMb / SHELL_COST_MB);
  }
  const weightedAvg =
    (shellCount * SHELL_COST_MB + agentCount * AGENT_COST_MB) / totalSessions;
  return Math.floor(availableMb / weightedAvg);
}

export const useResourceStore = create<ResourceState>((set, get) => ({
  totalMemoryMb: 0,
  availableMemoryMb: 0,
  usedMemoryMb: 0,
  usagePercent: 0,
  warningLevel: "none",
  lastPollTime: 0,

  shellCount: 0,
  agentCount: 0,
  estimatedTerminalUsageMb: 0,
  recommendedMaxMore: 0,

  updateMemory: (info) => {
    const { shellCount, agentCount } = get();
    set({
      totalMemoryMb: info.total_memory_mb,
      availableMemoryMb: info.available_memory_mb,
      usedMemoryMb: info.used_memory_mb,
      usagePercent: info.usage_percent,
      warningLevel: computeWarningLevel(info.available_memory_mb),
      lastPollTime: Date.now(),
      recommendedMaxMore: computeRecommendedMaxMore(
        info.available_memory_mb,
        shellCount,
        agentCount,
      ),
    });
  },

  updateSessionCounts: (shellCount, agentCount) => {
    const { availableMemoryMb } = get();
    set({
      shellCount,
      agentCount,
      estimatedTerminalUsageMb: computeEstimatedUsage(shellCount, agentCount),
      recommendedMaxMore: computeRecommendedMaxMore(
        availableMemoryMb,
        shellCount,
        agentCount,
      ),
    });
  },

  getScrollbackForCount: (terminalCount: number): number => {
    if (terminalCount <= 5) return 50_000;
    if (terminalCount <= 15) return 20_000;
    if (terminalCount <= 30) return 10_000;
    return 5_000;
  },

  // CodeGrid is unlimited — terminal creation is NEVER blocked. Low-memory
  // conditions are surfaced as a non-blocking advisory (see warningLevel and
  // the ResourceIndicator), but the user is always allowed to create more.
  canCreateTerminal: () => {
    const { availableMemoryMb, warningLevel } = get();
    return {
      allowed: true,
      reason:
        warningLevel === "hard"
          ? `Low memory (${Math.round(availableMemoryMb)} MB free) — additional terminals may run slowly.`
          : undefined,
    };
  },
}));
