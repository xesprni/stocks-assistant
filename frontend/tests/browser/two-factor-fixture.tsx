import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthPage } from "@/pages/AuthPage";
import { ReauthDialog } from "@/components/ReauthDialog";
import { ChangePasswordDialog } from "@/components/security/ChangePasswordDialog";
import { TwoFactorSettings } from "@/components/security/TwoFactorSettings";
import { ToastProvider } from "@/components/common/Toast";
import { I18nProvider } from "@/i18n/react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { notifyAuthExpired } from "@/lib/api/transport";
import { Button } from "@/components/ui/button";

function Fixture() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  if (auth.loading) return null;
  if (!auth.user) return <AuthPage />;
  return <main className="mx-auto max-w-2xl p-4">
    <div className="panel rounded-xl p-5">
      <h1 className="mb-4 text-xl font-semibold">账号安全</h1>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen(true)}>修改密码</Button>
        <Button variant="outline" onClick={() => notifyAuthExpired("Fixture session expired")}>测试重新认证</Button>
      </div>
      <TwoFactorSettings />
    </div>
    <ChangePasswordDialog open={open} onClose={() => setOpen(false)} language="zh" />
    <ReauthDialog />
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><I18nProvider language="zh"><ToastProvider><AuthProvider><Fixture /></AuthProvider></ToastProvider></I18nProvider></StrictMode>,
);
