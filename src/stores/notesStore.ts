import { create } from "zustand";

export interface StickyNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  workspaceId: string;
  createdAt: number;
}

export const NOTE_COLORS = [
  { name: "yellow", hex: "#ffab00" },
  { name: "blue", hex: "#4a9eff" },
  { name: "green", hex: "#10a37f" },
  { name: "pink", hex: "#ff6b9d" },
  { name: "orange", hex: "#ff8c00" },
];

const DEFAULT_W = 200;
const DEFAULT_H = 150;
const MIN_W = 120;
const MIN_H = 80;

interface NotesState {
  notes: StickyNote[];
  addNote: (workspaceId: string, x: number, y: number) => string;
  updateNote: (id: string, updates: Partial<StickyNote>) => void;
  deleteNote: (id: string) => void;
  moveNote: (id: string, x: number, y: number) => void;
  resizeNote: (id: string, w: number, h: number) => void;
  getWorkspaceNotes: (workspaceId: string) => StickyNote[];
  removeWorkspaceNotes: (workspaceId: string) => void;
}

let noteCounter = 0;

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],

  addNote: (workspaceId, x, y) => {
    const id = `note-${Date.now()}-${++noteCounter}`;
    const note: StickyNote = {
      id,
      x,
      y,
      w: DEFAULT_W,
      h: DEFAULT_H,
      text: "",
      color: NOTE_COLORS[0].hex,
      workspaceId,
      createdAt: Date.now(),
    };
    set((state) => ({ notes: [...state.notes, note] }));
    return id;
  },

  updateNote: (id, updates) =>
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, ...updates } : n,
      ),
    })),

  deleteNote: (id) =>
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) })),

  moveNote: (id, x, y) =>
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, x, y } : n,
      ),
    })),

  resizeNote: (id, w, h) =>
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id
          ? { ...n, w: Math.max(MIN_W, w), h: Math.max(MIN_H, h) }
          : n,
      ),
    })),

  getWorkspaceNotes: (workspaceId) =>
    get().notes.filter((n) => n.workspaceId === workspaceId),

  removeWorkspaceNotes: (workspaceId) =>
    set((state) => ({
      notes: state.notes.filter((n) => n.workspaceId !== workspaceId),
    })),
}));
