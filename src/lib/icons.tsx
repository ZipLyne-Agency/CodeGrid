/**
 * Central icon set — the one place icons are chosen, so the whole app stays
 * visually consistent. We use Phosphor: a single outline family with a `fill`
 * weight for active/selected/running states.
 *
 *   <Icon size={16} weight={active ? "fill" : "regular"} color={color} />
 *
 * The folder/file tree keeps its own vscode-material-icons — do not route those
 * through here.
 */
import {
  Folder, MagnifyingGlass, GitBranch, Broadcast, ChartLineUp, GearSix,
  SidebarSimple, SquaresFour, Command, Plus, Terminal,
  Sparkle, Star, Cursor, Lightning, BracketsAngle, Browser, Note, CopySimple, Waves,
  Crown, Lock, LockOpen, X, CaretDown, CaretRight, Check, Warning, Eye, EyeSlash,
  ArrowsDownUp, PencilSimple, Trash, Plugs, BookOpen, DotsThree, MagicWand,
  Minus, CornersOut, CornersIn, GitFork,
  type Icon, type IconWeight,
} from "@phosphor-icons/react";
import type { AgentKind } from "./paneTheme";

export type { Icon, IconWeight };

/** Agent / pane-kind identity icons. Color is supplied by paneTheme. */
export const AGENT_ICON: Record<AgentKind, Icon> = {
  claude:  Sparkle,
  codex:   BracketsAngle,
  gemini:  Star,
  cursor:  Cursor,
  grok:    Lightning,
  venice:  Waves,
  shell:   Terminal,
  browser: Browser,
  note:    Note,
};

/** Semantic chrome icons used around the app shell. */
export const UI_ICON = {
  files:           Folder,
  search:          MagnifyingGlass,
  git:             GitBranch,
  bus:             Broadcast,
  pro:             ChartLineUp,
  settings:        GearSix,
  sidebar:         SidebarSimple,
  manageTerminals: SquaresFour,
  command:         Command,
  plus:            Plus,
  terminals:       Terminal,
  scratch:         Lightning,
  preview:         Browser,
  note:            Note,
  sameAgent:       CopySimple,
  newAgent:        Sparkle,
  crown:           Crown,
  lock:            Lock,
  lockOpen:        LockOpen,
  eye:             Eye,
  eyeSlash:        EyeSlash,
  close:           X,
  caretDown:       CaretDown,
  caretRight:      CaretRight,
  check:           Check,
  warning:         Warning,
  sort:            ArrowsDownUp,
  rename:          PencilSimple,
  trash:           Trash,
  mcp:             Plugs,
  skills:          BookOpen,
  more:            DotsThree,
  ai:              MagicWand,
  minimize:        Minus,
  maximize:        CornersOut,
  restore:         CornersIn,
  worktree:        GitFork,
} satisfies Record<string, Icon>;
