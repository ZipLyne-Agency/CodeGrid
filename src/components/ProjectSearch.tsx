import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { searchFiles, type SearchResult } from "../lib/ipc";
import { useAppStore } from "../stores/appStore";
import { getFileIconUrl } from "../lib/fileIcons";

interface ProjectSearchProps {
  rootPath: string;
}

const MONO_FONT = "var(--font-ui)";
const MAX_RESULTS = 500;
const DEBOUNCE_MS = 300;

export const ProjectSearch = memo(function ProjectSearch({ rootPath }: ProjectSearchProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(0);

  const doSearch = useCallback(
    async (text: string, matchCase: boolean) => {
      if (!text.trim()) {
        setResults([]);
        setSearching(false);
        return;
      }
      const id = ++abortRef.current;
      setSearching(true);
      try {
        const res = await searchFiles(rootPath, text, matchCase, false, MAX_RESULTS);
        if (id === abortRef.current) {
          setResults(res);
        }
      } catch {
        if (id === abortRef.current) {
          setResults([]);
        }
      } finally {
        if (id === abortRef.current) {
          setSearching(false);
        }
      }
    },
    [rootPath],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(query, caseSensitive), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, caseSensitive, doSearch]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const r of results) {
      const list = map.get(r.file_path);
      if (list) list.push(r);
      else map.set(r.file_path, [r]);
    }
    return map;
  }, [results]);

  const totalCount = results.length;

  const toggleCollapse = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const handleResultClick = useCallback(
    (filePath: string, lineNumber: number) => {
      useAppStore.getState().setCodeViewerOpen(true, filePath, { workingDir: rootPath, lineNumber });
    },
    [rootPath],
  );

  const highlightMatch = useCallback(
    (line: string, searchQuery: string) => {
      if (!searchQuery) return <span>{line}</span>;
      const flags = caseSensitive ? "g" : "gi";
      const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, flags);
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let key = 0;
      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push(<span key={key++}>{line.slice(lastIndex, match.index)}</span>);
        }
        parts.push(
          <span key={key++} style={{ color: "#ff8c00", fontWeight: 600 }}>
            {match[0]}
          </span>,
        );
        lastIndex = regex.lastIndex;
        if (match[0].length === 0) break;
      }
      if (lastIndex < line.length) {
        parts.push(<span key={key++}>{line.slice(lastIndex)}</span>);
      }
      return <>{parts}</>;
    },
    [caseSensitive],
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "#0a0a0a",
        color: "#ccc",
        fontFamily: MONO_FONT,
        fontSize: 12,
      }}
    >
      {/* Search input row */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #222", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in files..."
            style={{
              flex: 1,
              backgroundColor: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 4,
              padding: "6px 8px",
              color: "#eee",
              fontFamily: MONO_FONT,
              fontSize: 12,
              outline: "none",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#ff8c00")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#333")}
          />
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            title="Case sensitive"
            style={{
              backgroundColor: caseSensitive ? "#ff8c00" : "#1a1a1a",
              color: caseSensitive ? "#000" : "#888",
              border: `1px solid ${caseSensitive ? "#ff8c00" : "#333"}`,
              borderRadius: 4,
              padding: "4px 8px",
              fontFamily: MONO_FONT,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Aa
          </button>
        </div>
        {/* Status line */}
        <div style={{ marginTop: 4, fontSize: 11, color: "#666" }}>
          {searching
            ? "Searching..."
            : query.trim()
              ? `${totalCount} result${totalCount !== 1 ? "s" : ""} in ${grouped.size} file${grouped.size !== 1 ? "s" : ""}${totalCount >= MAX_RESULTS ? " (limit reached)" : ""}`
              : ""}
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {Array.from(grouped.entries()).map(([filePath, matches]) => {
          const collapsed = collapsedFiles.has(filePath);
          const shortPath = filePath.startsWith(rootPath)
            ? filePath.slice(rootPath.length).replace(/^\//, "")
            : filePath;
          return (
            <div key={filePath}>
              <div
                onClick={() => toggleCollapse(filePath)}
                style={{
                  padding: "4px 10px",
                  backgroundColor: "#111",
                  borderBottom: "1px solid #1a1a1a",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  userSelect: "none",
                }}
              >
                <span style={{ fontSize: 10, color: "#666", width: 12 }}>{collapsed ? "\u25b6" : "\u25bc"}</span>
                <img src={getFileIconUrl(shortPath.split("/").pop() ?? shortPath)} width={14} height={14} style={{ flexShrink: 0, verticalAlign: "middle" }} draggable={false} />
                <span style={{ color: "#ddd", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortPath}
                </span>
                <span style={{ color: "#666", fontSize: 11, flexShrink: 0 }}>{matches.length}</span>
              </div>
              {!collapsed &&
                matches.map((r, i) => (
                  <div
                    key={i}
                    onClick={() => handleResultClick(filePath, r.line_number)}
                    style={{
                      padding: "2px 10px 2px 28px",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      borderBottom: "1px solid #111",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#1a1a1a")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <span style={{ color: "#555", marginRight: 8, fontSize: 11 }}>{r.line_number}</span>
                    <span style={{ color: "#aaa" }}>{highlightMatch(r.line_content, query)}</span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
});
