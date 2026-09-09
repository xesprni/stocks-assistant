import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, Circle, Eye, EyeOff, Info, KeyRound, Loader2 } from "lucide-react";

import { SideDrawer } from "@/components/common/SideDrawer";
import { useToast } from "@/components/common/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeOwnPassword } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { passwordCopy, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type PasswordField = "current" | "next" | "confirm";
const EMPTY_FORM = { current: "", next: "", confirm: "" };
const HIDDEN_FIELDS = { current: false, next: false, confirm: false };

export function ChangePasswordDialog({ open, onClose, language }: {
  open: boolean;
  onClose: () => void;
  language: AppLanguage;
}) {
  const copy = passwordCopy[language];
  const auth = useAuth();
  const { showToast } = useToast();
  const id = useId();
  const formId = `${id}-password-form`;
  const [form, setForm] = useState(EMPTY_FORM);
  const [visible, setVisible] = useState(HIDDEN_FIELDS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const nextLength = Array.from(form.next).length;
  const currentTooLong = Array.from(form.current).length > 256;
  const validLength = nextLength >= 8 && nextLength <= 256;
  const different = Boolean(form.current && form.next && form.current !== form.next);
  const mismatch = Boolean(form.confirm && form.next !== form.confirm);
  const canSubmit = Boolean(form.current && !currentTooLong && validLength && different && form.confirm && !mismatch);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setVisible(HIDDEN_FIELDS);
      setError("");
    }
  }, [open]);

  function close() {
    if (submitting.current) return;
    setForm(EMPTY_FORM);
    setVisible(HIDDEN_FIELDS);
    setError("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await changeOwnPassword({ current_password: form.current, new_password: form.next });
      setForm(EMPTY_FORM);
      setVisible(HIDDEN_FIELDS);
      onClose();
      showToast({ kind: "success", message: copy.success });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(message === "Current password is incorrect"
        ? copy.currentIncorrect
        : message === "New password must be different from current password"
          ? copy.samePassword
          : message || copy.failure);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function passwordField(field: PasswordField, descriptionId?: string, invalid = false) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${id}-${field}`}>{copy[field]}</label>
        <div className="relative">
          <Input
            aria-describedby={descriptionId}
            aria-invalid={invalid || undefined}
            autoCapitalize="none"
            autoComplete={field === "current" ? "current-password" : "new-password"}
            className="min-h-11 pr-12"
            disabled={saving}
            id={`${id}-${field}`}
            name={field === "current" ? "current-password" : field === "next" ? "new-password" : "confirm-password"}
            onChange={(event) => {
              setForm((current) => ({ ...current, [field]: event.target.value }));
              setError("");
            }}
            required
            spellCheck={false}
            type={visible[field] ? "text" : "password"}
            value={form[field]}
          />
          <Button
            aria-label={`${visible[field] ? copy.hidePassword : copy.showPassword} ${copy[field]}`}
            aria-pressed={visible[field]}
            className="absolute right-1 top-1/2 size-9 -translate-y-1/2 text-muted-foreground"
            disabled={saving}
            onClick={() => setVisible((current) => ({ ...current, [field]: !current[field] }))}
            size="icon"
            type="button"
            variant="ghost"
          >
            {visible[field] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SideDrawer
      closeLabel={copy.close}
      dismissDisabled={saving}
      footer={(
        <>
          <Button disabled={saving} onClick={close} type="button" variant="outline">{copy.cancel}</Button>
          <Button disabled={saving || !canSubmit} form={formId} type="submit">
            {saving ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {saving ? copy.saving : copy.submit}
          </Button>
        </>
      )}
      isSaving={saving}
      onClose={close}
      open={open}
      subtitle={copy.subtitle}
      title={copy.title}
    >
      <form aria-busy={saving} className="space-y-5 pb-2" id={formId} onSubmit={submit}>
        <input autoComplete="username" name="username" readOnly type="hidden" value={auth.user?.username ?? ""} />
        {passwordField("current", currentTooLong ? `${id}-current-error` : undefined, currentTooLong)}
        {currentTooLong ? <p className="text-xs text-destructive" id={`${id}-current-error`}>{copy.currentTooLong}</p> : null}
        <div className="space-y-3">
          {passwordField("next", `${id}-requirements`, (Boolean(form.next) && !validLength) || (Boolean(form.current && form.next) && !different))}
          <ul className="space-y-1.5 text-xs" id={`${id}-requirements`}>
            {[
              { label: copy.lengthRule, valid: validLength, invalid: Boolean(form.next) && !validLength },
              { label: copy.differentRule, valid: different, invalid: Boolean(form.current && form.next) && !different },
            ].map((rule) => (
              <li className={cn("flex items-center gap-2", rule.valid ? "text-primary" : rule.invalid ? "text-destructive" : "text-muted-foreground")} key={rule.label}>
                {rule.valid ? <Check aria-hidden="true" className="size-3.5" /> : <Circle aria-hidden="true" className="size-3.5" />}
                {rule.label}
                <span className="sr-only">{rule.valid ? copy.ruleMet : copy.ruleUnmet}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          {passwordField("confirm", mismatch ? `${id}-mismatch` : undefined, mismatch)}
          {mismatch ? <p className="text-xs text-destructive" id={`${id}-mismatch`}>{copy.mismatch}</p> : null}
        </div>
        <div className="flex gap-2.5 rounded-xl border border-border/70 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{copy.sessionHint}</p>
        </div>
        {error ? <p className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</p> : null}
      </form>
    </SideDrawer>
  );
}
