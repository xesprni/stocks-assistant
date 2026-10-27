import type { Messages } from "@/i18n/types";

export type TwoFactorInput = { method: "totp" | "recovery"; code: string };

export function emptyTwoFactorInput(): TwoFactorInput {
  return { method: "totp", code: "" };
}

export function isCompleteTwoFactorInput(value: TwoFactorInput) {
  return value.method === "totp" ? /^[0-9]{6}$/.test(value.code) : Boolean(value.code.trim());
}

export function requiresTwoFactor(error: unknown) {
  return error instanceof Error && ["Two-factor code required", "Invalid or already used two-factor code"].includes(error.message);
}

export function twoFactorError(error: unknown, copy: Messages["twoFactor"]) {
  const message = error instanceof Error ? error.message : "";
  const translations: Record<string, string> = {
    "Two-factor code required": copy.required,
    "Invalid or already used two-factor code": copy.invalid,
    "Too many verification attempts; try again in 5 minutes": copy.rateLimited,
    "Two-factor setup expired; start again": copy.expired,
    "Current password is incorrect": copy.passwordIncorrect,
    "Two-factor authentication is already enabled": copy.alreadyEnabled,
    "Two-factor authentication is not enabled": copy.notEnabled,
  };
  return translations[message] || message || copy.failure;
}
