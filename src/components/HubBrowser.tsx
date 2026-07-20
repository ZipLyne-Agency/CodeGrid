import { memo, useState, useCallback, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { cloneRepo, listGithubRepos, searchGithubRepos } from "../lib/ipc";
import type { GitHubRepo } from "../lib/ipc";

interface HubRepo {
  name: string;
  url: string;
  description: string;
  category: string;
  stars?: string;
}

const FEATURED_REPOS: HubRepo[] = [
  {
    name: "claude-code",
    url: "https://github.com/anthropics/claude-code",
    description: "Official Claude Code CLI by Anthropic",
    category: "AI Tools",
    stars: "30k+",
  },
  {
    name: "anthropic-cookbook",
    url: "https://github.com/anthropics/anthropic-cookbook",
    description: "Recipes and examples for building with Claude",
    category: "AI Tools",
    stars: "8k+",
  },
  {
    name: "next.js",
    url: "https://github.com/vercel/next.js",
    description: "The React framework for the web",
    category: "Frameworks",
    stars: "130k+",
  },
  {
    name: "shadcn-ui",
    url: "https://github.com/shadcn-ui/ui",
    description: "Beautiful UI components built with Radix + Tailwind",
    category: "UI",
    stars: "80k+",
  },
  {
    name: "tauri",
    url: "https://github.com/tauri-apps/tauri",
    description: "Build native desktop apps with web tech",
    category: "Frameworks",
    stars: "90k+",
  },
];

type Tab = "my-repos" | "featured";

function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

export const HubBrowser = memo(function HubBrowser() {
  const { hubBrowserOpen, setHubBrowserOpen } = useAppStore();
  const [tab, setTab] = useState<Tab>("my-repos");
  const [filter, setFilter] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [cloneTargetDir, setCloneTargetDir] = useState("");
  const [cloning, setCloning] = useState<string | null>(null);
  const [cloned, setCloned] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // GitHub repos state
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [ghLoading, setGhLoading] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);

  // Fetch GitHub repos when hub opens
  useEffect(() => {
    if (hubBrowserOpen && ghRepos.length === 0) {
      setGhLoading(true);
      setGhError(null);
      listGithubRepos(undefined, 100)
        .then((repos) => {
          setGhRepos(repos);
          setGhLoading(false);
        })
        .catch((err) => {
          setGhError(String(err));
          setGhLoading(false);
        });
    }
  }, [hubBrowserOpen]);

  useEffect(() => {
    if (!hubBrowserOpen) return;
    (async () => {
      try {
        const { getHomeDir } = await import("../lib/ipc");
        const home = await getHomeDir();
        setCloneTargetDir(`${home}/Projects`);
      } catch {
        // Keep current value if home lookup fails
      }
    })();
  }, [hubBrowserOpen]);

  // Org repos loading
  const [orgName, setOrgName] = useState("");
  const [orgLoading, setOrgLoading] = useState(false);

  const loadOrgRepos = useCallback(async (org: string) => {
    if (!org.trim()) return;
    setOrgLoading(true);
    setGhError(null);
    try {
      const repos = await listGithubRepos(org.trim(), 100);
      setGhRepos((prev) => {
        const existing = new Set(prev.map((r) => r.full_name));
        const newRepos = repos.filter((r) => !existing.has(r.full_name));
        return [...prev, ...newRepos];
      });
    } catch (err) {
      setGhError(String(err));
    }
    setOrgLoading(false);
  }, []);

  // GitHub search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GitHubRepo[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setGhError(null);
    try {
      const results = await searchGithubRepos(searchQuery.trim(), 30);
      setSearchResults(results);
    } catch (err) {
      setGhError(String(err));
    }
    setSearching(false);
  }, [searchQuery]);

  const displayedRepos = searchResults.length > 0 ? searchResults : (
    filter
      ? ghRepos.filter(
          (r) =>
            r.name.toLowerCase().includes(filter.toLowerCase()) ||
            r.description.toLowerCase().includes(filter.toLowerCase()) ||
            r.language.toLowerCase().includes(filter.toLowerCase()),
        )
      : ghRepos
  );

  const filteredFeatured = filter
    ? FEATURED_REPOS.filter(
        (r) =>
          r.name.toLowerCase().includes(filter.toLowerCase()) ||
          r.description.toLowerCase().includes(filter.toLowerCase()),
      )
    : FEATURED_REPOS;

  const handleClone = useCallback(
    async (url: string, name: string) => {
      setCloning(name);
      setError(null);
      try {
        const targetDir = cloneTargetDir.trim() || undefined;
        const path = await cloneRepo(url, targetDir);
        setCloned((prev) => ({ ...prev, [name]: path }));
        setCloning(null);
      } catch (e) {
        setError(String(e));
        setCloning(null);
      }
    },
    [cloneTargetDir],
  );

  const handleCloneCustom = useCallback(async () => {
    if (!customUrl.trim()) return;
    const name = customUrl.split("/").pop()?.replace(".git", "") ?? "repo";
    await handleClone(customUrl.trim(), name);
  }, [customUrl, handleClone]);

  const handleOpenInCodeGrid = useCallback(
    (path: string) => {
      setHubBrowserOpen(false);
      window.dispatchEvent(
        new CustomEvent("codegrid:quick-session", {
          detail: { path, type: "claude" },
        }),
      );
    },
    [setHubBrowserOpen],
  );

  const handlePickCloneDestination = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Choose clone destination" });
      if (selected) setCloneTargetDir(selected as string);
    } catch (e) {
      setError(`Could not open folder picker: ${e}`);
    }
  }, []);

  if (!hubBrowserOpen) return null;

  const timeAgo = (dateStr: string) => {
    if (!dateStr) return "";
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        paddingTop: "40px",
      }}
      onClick={() => setHubBrowserOpen(false)}
    >
      <div
        style={{ position: "absolute", inset: 0, background: "rgba(0, 0, 0, 0.6)" }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Hub Browser"
        style={{
          position: "relative",
          width: "700px",
          maxHeight: "650px",
          background: "#141414",
          border: "1px solid #ff8c00",
          fontFamily: "var(--font-ui)",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid #2a2a2a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ color: "#ff8c00", fontSize: "12px", fontWeight: "bold", letterSpacing: "1px" }}>
              HUB — CLONE & OPEN
            </div>
            <div style={{ color: "#555555", fontSize: "10px", marginTop: "2px" }}>
              Browse your GitHub repos or clone any URL
            </div>
          </div>
          <button
            onClick={() => setHubBrowserOpen(false)}
            style={{
              background: "none", border: "none", color: "#555555",
              fontSize: "14px", cursor: "pointer", fontFamily: "var(--font-ui)",
            }}
          >
            x
          </button>
        </div>

        {/* Custom URL input */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #2a2a2a" }}>
          <div style={{ display: "flex", gap: "4px" }}>
            <input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              style={{
                flex: 1,
                background: "#0a0a0a",
                border: "1px solid #2a2a2a",
                color: "#e0e0e0",
                fontSize: "12px",
                fontFamily: "var(--font-ui)",
                padding: "8px",
                outline: "none",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#ff8c00")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCloneCustom();
              }}
            />
            <button
              onClick={handleCloneCustom}
              disabled={!customUrl.trim()}
              style={{
                background: customUrl.trim() ? "#ff8c00" : "#2a2a2a",
                border: "none",
                color: customUrl.trim() ? "#0a0a0a" : "#555555",
                fontSize: "11px",
                fontFamily: "var(--font-ui)",
                cursor: customUrl.trim() ? "pointer" : "default",
                padding: "8px 16px",
                fontWeight: "bold",
              }}
            >
              CLONE
            </button>
          </div>
          <div style={{ marginTop: "8px" }}>
            <div style={{ color: "#666666", fontSize: "10px", marginBottom: "4px", letterSpacing: "0.4px" }}>
              CLONE DESTINATION
            </div>
            <div style={{ display: "flex", gap: "4px" }}>
              <input
                value={cloneTargetDir}
                onChange={(e) => setCloneTargetDir(e.target.value)}
                placeholder="~/Projects (or absolute path)"
                style={{
                  flex: 1,
                  background: "#0a0a0a",
                  border: "1px solid #2a2a2a",
                  color: "#e0e0e0",
                  fontSize: "11px",
                  fontFamily: "var(--font-ui)",
                  padding: "7px 8px",
                  outline: "none",
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "#ff8c00")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
              />
              <button
                onClick={handlePickCloneDestination}
                style={{
                  background: "#1e1e1e",
                  border: "1px solid #2a2a2a",
                  color: "#888888",
                  fontSize: "10px",
                  fontFamily: "var(--font-ui)",
                  cursor: "pointer",
                  padding: "7px 10px",
                  fontWeight: "bold",
                }}
              >
                BROWSE
              </button>
            </div>
            <div style={{ color: "#555555", fontSize: "10px", marginTop: "4px" }}>
              Saving to {cloneTargetDir ? shortenPath(cloneTargetDir) : "default location"}
            </div>
          </div>
          {error && (
            <div style={{ color: "#ff3d00", fontSize: "10px", marginTop: "4px" }}>
              {error}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #2a2a2a" }}>
          {(["my-repos", "featured"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: "8px",
                background: tab === t ? "#1e1e1e" : "transparent",
                border: "none",
                borderBottom: tab === t ? "2px solid #ff8c00" : "2px solid transparent",
                color: tab === t ? "#ff8c00" : "#555555",
                fontSize: "11px",
                fontWeight: "bold",
                fontFamily: "var(--font-ui)",
                cursor: "pointer",
                letterSpacing: "1px",
              }}
            >
              {t === "my-repos" ? `MY REPOS${ghRepos.length ? ` (${ghRepos.length})` : ""}` : "FEATURED"}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid #2a2a2a" }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={tab === "my-repos" ? "Search your repos..." : "Search featured repos..."}
            autoFocus
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: "#e0e0e0",
              fontSize: "12px",
              fontFamily: "var(--font-ui)",
              padding: "4px 0",
              outline: "none",
            }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
          {tab === "my-repos" && (
            <>
              {/* GitHub Search + Org loader */}
              <div style={{ padding: "8px 16px", borderBottom: "1px solid #1e1e1e", display: "flex", gap: "4px" }}>
                <input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults([]); }}
                  placeholder="Search GitHub (all repos, orgs)..."
                  style={{
                    flex: 1, background: "#0a0a0a", border: "1px solid #2a2a2a", color: "#e0e0e0",
                    fontSize: "11px", fontFamily: "var(--font-ui)", padding: "6px 8px", outline: "none",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "#ff8c00")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
                />
                <button
                  onClick={handleSearch}
                  disabled={!searchQuery.trim() || searching}
                  style={{
                    background: searchQuery.trim() ? "#ff8c00" : "#2a2a2a", border: "none",
                    color: searchQuery.trim() ? "#0a0a0a" : "#555", fontSize: "10px",
                    fontFamily: "var(--font-ui)", padding: "6px 12px", fontWeight: "bold", cursor: "pointer",
                  }}
                >
                  {searching ? "..." : "SEARCH"}
                </button>
              </div>
              <div style={{ padding: "6px 16px", borderBottom: "1px solid #1e1e1e", display: "flex", gap: "4px", alignItems: "center" }}>
                <span style={{ color: "#555", fontSize: "10px", whiteSpace: "nowrap" }}>ORG:</span>
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="organization name"
                  style={{
                    flex: 1, background: "#0a0a0a", border: "1px solid #2a2a2a", color: "#e0e0e0",
                    fontSize: "11px", fontFamily: "var(--font-ui)", padding: "4px 8px", outline: "none",
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") loadOrgRepos(orgName); }}
                />
                <button
                  onClick={() => loadOrgRepos(orgName)}
                  disabled={!orgName.trim() || orgLoading}
                  style={{
                    background: orgName.trim() ? "#1e1e1e" : "#1a1a1a", border: "1px solid #2a2a2a",
                    color: orgName.trim() ? "#4a9eff" : "#555", fontSize: "10px",
                    fontFamily: "var(--font-ui)", padding: "4px 10px", cursor: "pointer",
                  }}
                >
                  {orgLoading ? "..." : "LOAD"}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div style={{ padding: "4px 16px", color: "#4a9eff", fontSize: "10px", borderBottom: "1px solid #1e1e1e" }}>
                  {searchResults.length} search results for "{searchQuery}" — <button onClick={() => { setSearchResults([]); setSearchQuery(""); }} style={{ background: "none", border: "none", color: "#ff8c00", fontSize: "10px", cursor: "pointer", fontFamily: "var(--font-ui)", padding: 0 }}>CLEAR</button>
                </div>
              )}
              {ghLoading && (
                <div style={{ padding: "24px 16px", color: "#ffab00", fontSize: "11px", textAlign: "center" }}>
                  Loading your GitHub repos...
                </div>
              )}
              {ghError && (
                <div style={{ padding: "24px 16px", color: "#ff3d00", fontSize: "11px", textAlign: "center" }}>
                  {ghError}
                  <div style={{ color: "#555555", marginTop: "8px" }}>
                    Make sure GitHub CLI is installed and authenticated: gh auth login
                  </div>
                </div>
              )}
              {!ghLoading && !ghError && displayedRepos.length === 0 && (
                <div style={{ padding: "24px 16px", color: "#555555", fontSize: "11px", textAlign: "center" }}>
                  {filter || searchQuery ? "No repos match" : "No repos found"}
                </div>
              )}
              {displayedRepos.map((repo) => {
                const isCloning = cloning === repo.name;
                const clonedPath = cloned[repo.name];
                return (
                  <div
                    key={repo.full_name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "10px 16px",
                      gap: "12px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#1e1e1e")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "#e0e0e0", fontSize: "12px", fontWeight: "bold" }}>
                          {repo.name}
                        </span>
                        {repo.is_private && (
                          <span style={{
                            color: "#ffab00", fontSize: "10px", border: "1px solid #ffab00",
                            padding: "0 4px", lineHeight: "14px",
                          }}>
                            PRIVATE
                          </span>
                        )}
                        {repo.is_fork && (
                          <span style={{
                            color: "#4a9eff", fontSize: "10px", border: "1px solid #4a9eff",
                            padding: "0 4px", lineHeight: "14px",
                          }}>
                            FORK
                          </span>
                        )}
                        {repo.language && (
                          <span style={{ color: "#888888", fontSize: "10px" }}>
                            {repo.language}
                          </span>
                        )}
                        {repo.stars > 0 && (
                          <span style={{ color: "#ffab00", fontSize: "10px" }}>
                            {repo.stars}
                          </span>
                        )}
                      </div>
                      {repo.description && (
                        <div style={{
                          color: "#888888", fontSize: "10px", marginTop: "2px",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {repo.description}
                        </div>
                      )}
                      <div style={{ color: "#444444", fontSize: "10px", marginTop: "2px" }}>
                        {repo.full_name} · {timeAgo(repo.updated_at)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                      {clonedPath ? (
                        <button
                          onClick={() => handleOpenInCodeGrid(clonedPath)}
                          style={{
                            background: "#00c853", border: "none", color: "#0a0a0a",
                            fontSize: "10px", fontFamily: "var(--font-ui)",
                            cursor: "pointer", padding: "4px 10px", fontWeight: "bold",
                          }}
                        >
                          OPEN
                        </button>
                      ) : (
                        <button
                          onClick={() => handleClone(repo.url, repo.name)}
                          disabled={isCloning}
                          style={{
                            background: isCloning ? "#2a2a2a" : "#1e1e1e",
                            border: "1px solid #2a2a2a",
                            color: isCloning ? "#ffab00" : "#888888",
                            fontSize: "10px",
                            fontFamily: "var(--font-ui)",
                            cursor: isCloning ? "default" : "pointer",
                            padding: "4px 10px",
                          }}
                          onMouseEnter={(e) => {
                            if (!isCloning) {
                              e.currentTarget.style.borderColor = "#ff8c00";
                              e.currentTarget.style.color = "#ff8c00";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isCloning) {
                              e.currentTarget.style.borderColor = "#2a2a2a";
                              e.currentTarget.style.color = "#888888";
                            }
                          }}
                        >
                          {isCloning ? "CLONING..." : "CLONE"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {tab === "featured" && (
            <>
              {filteredFeatured.map((repo) => {
                const isCloning = cloning === repo.name;
                const clonedPath = cloned[repo.name];
                return (
                  <div
                    key={repo.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "10px 16px",
                      gap: "12px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#1e1e1e")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "#e0e0e0", fontSize: "12px", fontWeight: "bold" }}>
                          {repo.name}
                        </span>
                        {repo.stars && (
                          <span style={{ color: "#ffab00", fontSize: "10px" }}>
                            {repo.stars}
                          </span>
                        )}
                      </div>
                      <div style={{ color: "#888888", fontSize: "10px", marginTop: "2px" }}>
                        {repo.description}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                      {clonedPath ? (
                        <button
                          onClick={() => handleOpenInCodeGrid(clonedPath)}
                          style={{
                            background: "#00c853", border: "none", color: "#0a0a0a",
                            fontSize: "10px", fontFamily: "var(--font-ui)",
                            cursor: "pointer", padding: "4px 10px", fontWeight: "bold",
                          }}
                        >
                          OPEN
                        </button>
                      ) : (
                        <button
                          onClick={() => handleClone(repo.url, repo.name)}
                          disabled={isCloning}
                          style={{
                            background: isCloning ? "#2a2a2a" : "#1e1e1e",
                            border: "1px solid #2a2a2a",
                            color: isCloning ? "#ffab00" : "#888888",
                            fontSize: "10px",
                            fontFamily: "var(--font-ui)",
                            cursor: isCloning ? "default" : "pointer",
                            padding: "4px 10px",
                          }}
                          onMouseEnter={(e) => {
                            if (!isCloning) {
                              e.currentTarget.style.borderColor = "#ff8c00";
                              e.currentTarget.style.color = "#ff8c00";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isCloning) {
                              e.currentTarget.style.borderColor = "#2a2a2a";
                              e.currentTarget.style.color = "#888888";
                            }
                          }}
                        >
                          {isCloning ? "CLONING..." : "CLONE"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
});
