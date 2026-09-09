import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createResearchDocument, getResearchDocument, listResearchDocuments, uploadResearchDocument } from "@/lib/api";
import { ResearchDocumentsController } from "@/lib/research-documents-controller";

export function useResearchDocuments(symbol: string, onChanged: () => Promise<void>) {
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [controller] = useState(() => new ResearchDocumentsController(symbol, {
    list: listResearchDocuments, get: getResearchDocument, create: createResearchDocument,
    upload: uploadResearchDocument, changed: () => changed.current(),
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.activate(symbol); return () => controller.dispose(); }, [controller, symbol]);
  return { ...state, setForm: controller.setForm, setFile: controller.setFile, save: controller.save, open: controller.open };
}
