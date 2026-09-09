import { RequestScope } from "@/lib/request-scope";
import type { ResearchDocument } from "@/types/app";

export type ResearchDocumentForm = {
  document_id: string; title: string; document_type: string; source_url: string; published_at: string; content: string;
};
const freshForm = (): ResearchDocumentForm => ({ document_id: "", title: "", document_type: "filing", source_url: "", published_at: "", content: "" });
type State = {
  symbol: string; documents: ResearchDocument[]; detail: ResearchDocument | null; form: ResearchDocumentForm;
  file: File | null; loading: boolean; opening: boolean; saving: boolean; error: string;
};
type Dependencies = {
  list: (symbol: string, init: RequestInit) => Promise<ResearchDocument[]>;
  get: (id: string, init: RequestInit) => Promise<ResearchDocument>;
  create: (symbol: string, payload: Record<string, unknown>) => Promise<ResearchDocument>;
  upload: (symbol: string, payload: FormData) => Promise<ResearchDocument>;
  changed: () => Promise<void>;
};

export class ResearchDocumentsController {
  private scope: RequestScope<string>;
  private listeners = new Set<() => void>();
  private state: State;
  private draftRevision = 0;
  private disposed = false;
  constructor(symbol: string, private readonly api: Dependencies) {
    this.scope = new RequestScope(symbol);
    this.state = { symbol, documents: [], detail: null, form: freshForm(), file: null, loading: false, opening: false, saving: false, error: "" };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<State>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private fail(error: unknown) { this.patch({ error: error instanceof Error ? error.message : "Request failed" }); }
  activate(symbol: string) {
    this.disposed = false;
    this.scope.reset(symbol);
    this.draftRevision += 1;
    this.patch({ symbol, documents: [], detail: null, form: freshForm(), file: null, loading: false, opening: false, saving: false, error: "" });
    void this.load();
  }
  dispose() { this.disposed = true; this.scope.reset(this.scope.key); }
  setForm = (form: ResearchDocumentForm) => { this.draftRevision += 1; this.patch({ form }); };
  setFile = (file: File | null) => { this.draftRevision += 1; this.patch({ file }); };
  async load() {
    const request = this.scope.begin("list");
    this.patch({ loading: true });
    try {
      const documents = await this.api.list(request.key, { signal: request.signal });
      if (request.isCurrent()) this.patch({ documents });
    } catch (error) { if (request.isCurrent()) this.fail(error); }
    finally { if (request.isCurrent()) this.patch({ loading: false }); }
  }
  open = async (document: ResearchDocument) => {
    const request = this.scope.begin("detail");
    this.patch({ opening: true, detail: null, error: "" });
    try {
      const detail = await this.api.get(document.id, { signal: request.signal });
      if (request.isCurrent()) this.patch({ detail });
    } catch (error) { if (request.isCurrent()) this.fail(error); }
    finally { if (request.isCurrent()) this.patch({ opening: false }); }
  };
  save = async () => {
    const { form, file, saving } = this.state;
    if (saving || !form.title.trim() || (!form.content.trim() && !file)) return;
    const ticket = this.scope.capture();
    const revision = this.draftRevision;
    this.patch({ saving: true, error: "" });
    try {
      if (file) {
        const data = new FormData();
        data.set("file", file);
        for (const key of ["title", "document_type", "document_id", "source_url", "published_at"] as const) {
          if (form[key]) data.set(key, form[key]);
        }
        await this.api.upload(ticket.key, data);
      } else {
        await this.api.create(ticket.key, { ...form, document_id: form.document_id || null, source_url: form.source_url || null, published_at: form.published_at || null });
      }
      if (!ticket.isCurrent()) return;
      // Do not erase edits made while ingestion was in flight.
      if (this.draftRevision === revision) this.patch({ form: { ...form, document_id: "", title: "", content: "" }, file: null });
      await this.load();
      if (ticket.isCurrent()) await this.api.changed();
    } catch (error) { if (ticket.isCurrent()) this.fail(error); }
    finally { if (ticket.isCurrent()) this.patch({ saving: false }); }
  };
}
