import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppLanguage } from "@/i18n";
import { getMessages, localeFor } from "@/i18n";
import { cn } from "@/lib/utils";
import type {
  AuthUser
} from "@/types/app";
import {
  ChevronDown,
  Loader2,
  LogOut,
  Upload,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function userInitials(user: AuthUser | null) {
  const source = (user?.display_name || user?.username || "?").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function formatProfileTime(value: string | null | undefined, language: AppLanguage) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(localeFor(language), { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function readAvatarDataUrl(file: File, language: AppLanguage): Promise<string> {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(file.type)) {
    return Promise.reject(new Error(getMessages(language).shell.avatarFormatError));
  }
  if (file.size > 512 * 1024) {
    return Promise.reject(new Error(getMessages(language).shell.avatarSizeError));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(getMessages(language).shell.imageReadError));
    };
    reader.onerror = () => reject(new Error(getMessages(language).shell.imageReadError));
    reader.readAsDataURL(file);
  });
}

export function AvatarVisual({ user, size = "md" }: { user: AuthUser | null; size?: "md" | "lg" }) {
  const className = size === "lg" ? "size-11 text-sm" : "size-8 text-xs";
  if (user?.avatar_base64) {
    return (
      <img
        alt={user.display_name || user.username}
        className={cn(className, "rounded-full border border-border/70 object-cover")}
        src={user.avatar_base64}
      />
    );
  }
  return (
    <span className={cn(className, "grid shrink-0 place-items-center rounded-full border border-primary/35 bg-primary/10 font-semibold text-primary")}>
      {userInitials(user)}
    </span>
  );
}

export function UserAvatarMenu({
  language,
  onLogout,
  onUpdateProfile,
  user,
}: {
  language: AppLanguage;
  onLogout: () => void;
  onUpdateProfile: (payload: { display_name?: string; avatar_base64?: string }) => Promise<AuthUser>;
  user: AuthUser | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const copy = getMessages(language).shell.accountMenu;
  useEffect(() => {
    if (!isOpen) return undefined;
    function handlePointerDown(event: PointerEvent) {
      const path = event.composedPath();
      if (!menuRef.current || !path.includes(menuRef.current)) setIsOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleAvatarFile(file: File | undefined) {
    if (!file) return;
    setAvatarError("");
    setIsUploading(true);
    try {
      const avatar_base64 = await readAvatarDataUrl(file, language);
      await onUpdateProfile({ avatar_base64 });
    } catch (caught) {
      setAvatarError(caught instanceof Error ? caught.message : (getMessages(language).shell.uploadFailed));
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError("");
    setIsUploading(true);
    try {
      await onUpdateProfile({ avatar_base64: "" });
    } catch (caught) {
      setAvatarError(caught instanceof Error ? caught.message : (getMessages(language).shell.removeAvatarFailed));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={getMessages(language).shell.openAccountMenu}
        className="apple-pressable flex h-10 items-center gap-1 rounded-full border border-input bg-[var(--control-bg)] p-0.5 pr-2 shadow-[var(--control-shadow)] transition-[background-color,border-color,transform] hover:bg-[var(--control-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <AvatarVisual user={user} />
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      {isOpen ? (
        <div
          className="account-menu-popover absolute right-0 top-[calc(100%+0.45rem)] z-[1000] max-h-[min(680px,calc(100dvh-4rem))] w-[320px] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border/90 p-2 text-popover-foreground shadow-2xl ring-1 ring-border/40"
          aria-label={copy.account}
          onPointerDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          role="dialog"
        >
          <div className="flex min-w-0 items-center gap-2 border-b border-border/65 pb-2">
            <AvatarVisual size="lg" user={user} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user?.display_name || user?.username || copy.account}</p>
              <p className="truncate text-xs text-muted-foreground">@{user?.username || "-"}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {(user?.permissions?.length ?? 0).toLocaleString(localeFor(language))} {copy.permissions}
              </p>
            </div>
          </div>

          <div className="space-y-2 py-2">
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="rounded-md bg-muted/25 px-2 py-1.5">
                <p className="text-muted-foreground">{copy.lastLogin}</p>
                <p className="truncate font-semibold">{formatProfileTime(user?.last_login_at, language)}</p>
              </div>
              <div className="rounded-md bg-muted/25 px-2 py-1.5">
                <p className="text-muted-foreground">{copy.created}</p>
                <p className="truncate font-semibold">{formatProfileTime(user?.created_at, language)}</p>
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{copy.roles}</p>
              <div className="flex flex-wrap gap-1">
                {user?.roles?.length ? user.roles.map((role) => (
                  <Badge className="border-transparent bg-muted/45 shadow-none" key={role} variant="outline">{role}</Badge>
                )) : <span className="text-xs text-muted-foreground">{copy.noRoles}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <input
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(event) => void handleAvatarFile(event.target.files?.[0])}
                ref={inputRef}
                type="file"
              />
              <Button className="h-7 px-2 text-xs" disabled={isUploading} onClick={() => inputRef.current?.click()} size="sm" type="button" variant="outline">
                {isUploading ? <Loader2 className="animate-spin" /> : <Upload />}
                {isUploading ? copy.uploading : copy.upload}
              </Button>
              {user?.avatar_base64 ? (
                <Button className="h-7 px-2 text-xs" disabled={isUploading} onClick={() => void handleRemoveAvatar()} size="sm" type="button" variant="ghost">
                  <X className="size-4" />
                  {copy.remove}
                </Button>
              ) : null}
            </div>
            {avatarError ? <p className="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{avatarError}</p> : null}
          </div>

          <div className="border-t border-border/65 pt-2">
            <Button className="h-8 w-full justify-start text-destructive hover:text-destructive" onClick={onLogout} size="sm" type="button" variant="ghost">
              <LogOut />
              {copy.logout}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
