// ── Memory ────────────────────────────────────────────────────────────────────

export interface MemorySearchResult {
  path: string;
  start_line: number;
  end_line: number;
  score: number;
  snippet: string;
  source: string;
  user_id: string | null;
}

export interface MemoryStatus {
  chunks: number;
  files: number;
  workspace: string;
  dirty: boolean;
  embedding_enabled: boolean;
  embedding_provider: string;
  embedding_model: string;
  search_mode: string;
}

export interface MemoryFile {
  path: string;
  size: number;
  modified: number;
  indexed_only?: boolean;
}

export interface MemoryFileContent {
  path: string;
  content: string;
  size: number;
}
