// ── Knowledge ─────────────────────────────────────────────────────────────────

export interface KnowledgeFile {
  name: string;
  title: string;
  size: number;
}

export interface KnowledgeDir {
  dir: string;
  files: KnowledgeFile[];
  children: KnowledgeDir[];
}

export interface KnowledgeTree {
  root_files: KnowledgeFile[];
  tree: KnowledgeDir[];
  stats: { pages: number; size: number };
  enabled: boolean;
}

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  category: string;
}

export interface KnowledgeGraphLink {
  source: string;
  target: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphLink[];
}

export interface KnowledgeFileContent {
  content: string;
  path: string;
}

export interface KnowledgeSaveResponse {
  status: string;
  path: string;
  size: number;
  source?: string | null;
}
