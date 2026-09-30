import { useEffect, useState } from "react";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { SideDrawer } from "@/components/common/SideDrawer";
import { useConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { matchesCompany } from "@/lib/watchlist-view";
import { i18n, type AppLanguage } from "@/lib/i18n";
import type { WatchlistGroupsController } from "@/lib/watchlist-groups-controller";
import type { WatchlistGroup, WatchlistItem } from "@/types/app";

export function WatchlistGroupsDrawer({ open, onClose, language, items, groups, controller, saving, initialGroup }: {
  open: boolean; onClose: () => void; language: AppLanguage; items: WatchlistItem[];
  groups: WatchlistGroup[]; controller: WatchlistGroupsController; saving: boolean; initialGroup?: number;
}) {
  const copy = i18n[language].watchlist, common = i18n[language].common;
  const [selectedId, setSelectedId] = useState<number | null>(initialGroup ?? groups[0]?.id ?? null);
  const selected = groups.find((group) => group.id === selectedId);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<number[]>([]);
  const [saved, setSaved] = useState(false);
  const { confirm, dialog } = useConfirmDialog();
  useEffect(() => { setName(selected?.name ?? ""); setMembers(selected?.item_ids ?? []); }, [selected]);
  const visible = items.filter((item) => matchesCompany(item, query));
  async function saveName() {
    if (!name.trim()) return;
    if (await controller.save(name.trim(), selected?.id)) {
      if (!selected) setSelectedId(controller.snapshot().groups.at(-1)?.id ?? null);
    }
  }
  async function remove() {
    if (!selected || !await confirm({ title: copy.deleteGroup, description: copy.deleteGroupHint,
      cancelText: common.cancel, confirmText: common.delete, destructive: true })) return;
    if (await controller.remove(selected.id)) setSelectedId(controller.snapshot().groups[0]?.id ?? null);
  }
  return <>
    <SideDrawer open={open} onClose={onClose} title={copy.manageGroups} subtitle={copy.groupHint} dismissDisabled={saving}
      footer={<Button disabled={!selected || saving} onClick={async () => {
        if (selected && await controller.setMembers(selected.id, members)) setSaved(true);
      }}>{copy.saveMembers}</Button>}>
      <div className="space-y-5 p-4">
        <div className="flex items-center gap-2">
          <Select aria-label={copy.groups} className="flex-1" disabled={saving} value={String(selectedId ?? "new")}
            onValueChange={(value) => { setSelectedId(value === "new" ? null : Number(value)); setSaved(false); }}
            options={[{ value: "new", label: copy.newGroup }, ...groups.map((group) => ({ value: String(group.id), label: `${group.name} · ${group.item_ids.length}` }))]} />
          <Button variant="outline" size="icon" disabled={saving} aria-label={copy.newGroup} onClick={() => { setSelectedId(null); setName(""); setSaved(false); }}><FolderPlus /></Button>
        </div>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void saveName(); }}>
          <Input aria-label={copy.groupName} placeholder={copy.groupName} value={name} maxLength={40} disabled={saving} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" variant="outline" disabled={saving || !name.trim()} aria-label={selected ? common.save : copy.newGroup}><Pencil /><span>{common.save}</span></Button>
          {selected && <Button variant="ghost" size="icon" disabled={saving} className="shrink-0 text-destructive" aria-label={copy.deleteGroup} onClick={() => void remove()}><Trash2 /></Button>}
        </form>
        {selected ? <div className="space-y-3">
          <div className="flex justify-between text-sm font-medium"><span>{copy.groupMembers}</span><span>{members.length}</span></div>
          <Input aria-label={copy.localFilter} placeholder={copy.localFilterPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={saving} onClick={() => { setMembers([...new Set([...members, ...visible.map((item) => item.id)])]); setSaved(false); }}>{copy.selectVisible}</Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setMembers([]); setSaved(false); }}>{copy.clearMembers}</Button>
          </div>
          <div className="divide-y divide-border/60">
            {visible.map((item) => <label key={item.id} className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
              <input type="checkbox" className="size-4 accent-primary" disabled={saving} checked={members.includes(item.id)} onChange={(event) => {
                setMembers(event.target.checked ? [...members, item.id] : members.filter((id) => id !== item.id)); setSaved(false);
              }} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name || item.symbol}</span><span className="block text-xs text-muted-foreground">{item.symbol}</span></span>
            </label>)}
            {!visible.length && <p className="py-6 text-center text-sm text-muted-foreground">{copy.localNoMatch}</p>}
          </div>
          {saved && <p role="status" className="text-sm text-primary">{copy.membersSaved}</p>}
        </div> : <p className="text-sm text-muted-foreground">{copy.noGroups}</p>}
      </div>
    </SideDrawer>
    {dialog}
  </>;
}
