import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ListChecks, Loader2, Plus, RefreshCw, Save, ShieldCheck, UserCog, UserPlus, Users } from "lucide-react";

import { Field } from "@/components/common/Field";
import { SideDrawer } from "@/components/common/SideDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createUser, listRoles, listUsers, saveRole, updateUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AuthUser, RoleInfo } from "@/types/app";

type UserForm = {
  username: string;
  password: string;
  display_name: string;
  roles: string[];
  is_active: boolean;
};

type UserEditForm = Omit<UserForm, "username">;

type RoleForm = {
  name: string;
  description: string;
  permissions: string[];
};

type ManagementView = "roles" | "users" | "permissions";

const copy = {
  zh: {
    title: "用户管理",
    subtitle: "账号、角色与权限",
    users: "用户",
    roles: "角色",
    roleCatalog: "角色列表",
    roleCatalogHint: "默认视图只展示角色与权限概览，具体管理进入下一级。",
    manageUsers: "管理用户",
    userManagement: "用户管理",
    userManagementHint: "编辑账号状态、显示名称、密码和角色绑定。",
    manageRolePermissions: "角色权限管理",
    rolePermissionManagement: "角色权限管理",
    rolePermissionHint: "创建自定义角色，调整权限点授权。",
    backToRoles: "返回角色列表",
    newRole: "新建角色",
    refresh: "刷新",
    createUser: "新建用户",
    createUserHint: "创建账号并分配初始角色。",
    cancel: "取消",
    username: "用户名",
    password: "密码",
    resetPassword: "重置密码",
    displayName: "显示名称",
    active: "启用",
    disabled: "停用",
    role: "角色",
    save: "保存",
    create: "创建",
    editRole: "编辑角色",
    createRole: "创建角色",
    roleName: "角色名",
    description: "描述",
    permissions: "权限",
    builtin: "内置",
    custom: "自定义",
    current: "当前账号",
    noUsers: "暂无用户",
    noRoles: "暂无角色",
    loading: "正在加载...",
    loadFailed: "加载失败",
    createFailed: "创建失败",
    updateFailed: "保存失败",
    roleSaveFailed: "角色保存失败",
    saved: "已保存",
    userCreated: "用户已创建",
    roleSaved: "角色已保存",
    passwordHint: "留空则不修改密码",
  },
  en: {
    title: "User Management",
    subtitle: "Accounts, roles, and permissions",
    users: "Users",
    roles: "Roles",
    roleCatalog: "Role List",
    roleCatalogHint: "The default view shows role and permission summaries. Management actions live one level deeper.",
    manageUsers: "Manage Users",
    userManagement: "User Management",
    userManagementHint: "Edit account state, display names, passwords, and role bindings.",
    manageRolePermissions: "Role Permissions",
    rolePermissionManagement: "Role Permission Management",
    rolePermissionHint: "Create custom roles and adjust permission grants.",
    backToRoles: "Back to Roles",
    newRole: "New Role",
    refresh: "Refresh",
    createUser: "Create User",
    createUserHint: "Create an account and assign its initial roles.",
    cancel: "Cancel",
    username: "Username",
    password: "Password",
    resetPassword: "Reset password",
    displayName: "Display name",
    active: "Active",
    disabled: "Disabled",
    role: "Role",
    save: "Save",
    create: "Create",
    editRole: "Edit Role",
    createRole: "Create Role",
    roleName: "Role name",
    description: "Description",
    permissions: "Permissions",
    builtin: "Built-in",
    custom: "Custom",
    current: "Current account",
    noUsers: "No users",
    noRoles: "No roles",
    loading: "Loading...",
    loadFailed: "Failed to load",
    createFailed: "Create failed",
    updateFailed: "Save failed",
    roleSaveFailed: "Role save failed",
    saved: "Saved",
    userCreated: "User created",
    roleSaved: "Role saved",
    passwordHint: "Leave blank to keep password",
  },
} as const;

function defaultUserForm(defaultRole: string): UserForm {
  return {
    username: "",
    password: "",
    display_name: "",
    roles: [defaultRole],
    is_active: true,
  };
}

function userToEditForm(user: AuthUser): UserEditForm {
  return {
    password: "",
    display_name: user.display_name ?? "",
    roles: user.roles.length ? user.roles : ["user"],
    is_active: user.is_active,
  };
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function roleVariant(role: string) {
  if (role === "admin") return "default";
  if (role === "readonly") return "muted";
  return "secondary";
}

function permissionEntries(permissions: Record<string, string>) {
  return Object.entries(permissions).sort(([a], [b]) => {
    if (a === "*") return -1;
    if (b === "*") return 1;
    return a.localeCompare(b);
  });
}

export function UsersPage({ language }: { language: AppLanguage }) {
  const auth = useAuth();
  const t = copy[language];
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [editForms, setEditForms] = useState<Record<string, UserEditForm>>({});
  const [roleForm, setRoleForm] = useState<RoleForm>({ name: "", description: "", permissions: [] });
  const [userForm, setUserForm] = useState<UserForm>(() => defaultUserForm("user"));
  const [loading, setLoading] = useState(true);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [view, setView] = useState<ManagementView>("roles");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const defaultRole = useMemo(() => roles.find((role) => role.name === "user")?.name ?? roles[0]?.name ?? "user", [roles]);
  const permissionList = useMemo(() => permissionEntries(permissions), [permissions]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [userResponse, roleResponse] = await Promise.all([listUsers(), listRoles()]);
      setUsers(userResponse.users);
      setRoles(roleResponse.roles);
      setPermissions(roleResponse.permissions);
      setEditForms(Object.fromEntries(userResponse.users.map((user) => [user.id, userToEditForm(user)])));
      const nextDefaultRole = roleResponse.roles.find((role) => role.name === "user")?.name ?? roleResponse.roles[0]?.name ?? "user";
      setUserForm((current) => current.roles.length ? current : defaultUserForm(nextDefaultRole));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateCreateForm(patch: Partial<UserForm>) {
    setUserForm((current) => ({ ...current, ...patch }));
  }

  function updateEditForm(userId: string, patch: Partial<UserEditForm>) {
    setEditForms((current) => ({
      ...current,
      [userId]: {
        ...(current[userId] ?? userToEditForm(users.find((user) => user.id === userId) ?? {
          id: userId,
          username: "",
          display_name: "",
          roles: [defaultRole],
          permissions: [],
          is_active: true,
        })),
        ...patch,
      },
    }));
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userForm.username.trim() || !userForm.password.trim() || userForm.roles.length === 0) return;
    setCreatingUser(true);
    setError("");
    setNotice("");
    try {
      await createUser({
        username: userForm.username.trim(),
        password: userForm.password,
        display_name: userForm.display_name.trim(),
        roles: userForm.roles,
        is_active: userForm.is_active,
      });
      setUserForm(defaultUserForm(defaultRole));
      setCreateUserOpen(false);
      setNotice(t.userCreated);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.createFailed);
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleSaveUser(user: AuthUser) {
    const form = editForms[user.id];
    if (!form || form.roles.length === 0) return;
    setSavingUser(user.id);
    setError("");
    setNotice("");
    try {
      const updated = await updateUser(user.id, {
        display_name: form.display_name.trim(),
        password: form.password.trim() || undefined,
        roles: user.id === auth.user?.id ? undefined : form.roles,
        is_active: user.id === auth.user?.id ? undefined : form.is_active,
      });
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditForms((current) => ({ ...current, [updated.id]: userToEditForm(updated) }));
      setNotice(t.saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.updateFailed);
    } finally {
      setSavingUser(null);
    }
  }

  function startRoleEdit(role: RoleInfo) {
    if (role.builtin) return;
    setRoleForm({
      name: role.name,
      description: role.description ?? "",
      permissions: role.permissions,
    });
    setView("permissions");
  }

  function startRoleCreate() {
    setRoleForm({ name: "", description: "", permissions: [] });
    setView("permissions");
  }

  async function handleSaveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roleForm.name.trim()) return;
    setSavingRole(true);
    setError("");
    setNotice("");
    try {
      await saveRole(roleForm.name.trim(), {
        name: roleForm.name.trim(),
        description: roleForm.description.trim(),
        permissions: roleForm.permissions,
      });
      setRoleForm({ name: "", description: "", permissions: [] });
      setNotice(t.roleSaved);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.roleSaveFailed);
    } finally {
      setSavingRole(false);
    }
  }

  return (
    <>
      <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
        <div className="panel-header flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <UserCog className="size-5 text-primary" />
              <p className="font-semibold">{t.title}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{users.length} {t.users}</Badge>
            <Badge variant="outline">{roles.length} {t.roles}</Badge>
            {view !== "roles" ? (
              <Button variant="outline" size="sm" onClick={() => setView("roles")}>
                <ArrowLeft />
                {t.backToRoles}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {t.refresh}
            </Button>
            <Button size="sm" onClick={() => setCreateUserOpen(true)}>
              <UserPlus />
              {t.createUser}
            </Button>
          </div>
        </div>

        <div className="panel-body min-h-0 flex-1 overflow-y-auto">
          {error ? <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          {notice ? <div className="mb-3 rounded-md border border-secondary/30 bg-secondary/10 px-3 py-2 text-sm text-secondary">{notice}</div> : null}

          {view === "roles" ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-md border border-border/80 bg-background/60 p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-secondary" />
                    <p className="text-sm font-semibold">{t.roleCatalog}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.roleCatalogHint}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setView("users")}>
                    <Users />
                    {t.manageUsers}
                  </Button>
                  <Button size="sm" onClick={() => setView("permissions")}>
                    <ListChecks />
                    {t.manageRolePermissions}
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t.loading}
                </div>
              ) : roles.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">{t.noRoles}</div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {roles.map((role) => (
                    <article key={role.id} className="rounded-md border border-border/80 bg-background/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">{role.name}</p>
                            <Badge variant={role.builtin ? "outline" : "secondary"}>{role.builtin ? t.builtin : t.custom}</Badge>
                            <Badge variant="muted">{role.permissions.length} {t.permissions}</Badge>
                          </div>
                          {role.description ? <p className="mt-1 text-xs text-muted-foreground">{role.description}</p> : null}
                        </div>
                        {!role.builtin ? (
                          <Button variant="outline" size="sm" onClick={() => startRoleEdit(role)}>
                            <ListChecks />
                            {t.editRole}
                          </Button>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {role.permissions.slice(0, 10).map((permission) => <Badge key={permission} variant="muted">{permission}</Badge>)}
                        {role.permissions.length > 10 ? <Badge variant="outline">+{role.permissions.length - 10}</Badge> : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {view === "users" ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-md border border-border/80 bg-background/60 p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-primary" />
                    <p className="text-sm font-semibold">{t.userManagement}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.userManagementHint}</p>
                </div>
                <Button size="sm" onClick={() => setCreateUserOpen(true)}>
                  <UserPlus />
                  {t.createUser}
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t.loading}
                </div>
              ) : users.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">{t.noUsers}</div>
              ) : users.map((user) => {
                const form = editForms[user.id] ?? userToEditForm(user);
                const isSelf = user.id === auth.user?.id;
                return (
                  <article key={user.id} className="rounded-md border border-border/80 bg-background/60 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold">{user.username}</p>
                          {isSelf ? <Badge variant="outline">{t.current}</Badge> : null}
                          <Badge variant={user.is_active ? "secondary" : "muted"}>{user.is_active ? t.active : t.disabled}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {user.roles.map((role) => <Badge key={role} variant={roleVariant(role)}>{role}</Badge>)}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => handleSaveUser(user)} disabled={savingUser === user.id || form.roles.length === 0}>
                        {savingUser === user.id ? <Loader2 className="animate-spin" /> : <Save />}
                        {t.save}
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <Field label={t.displayName}>
                        <Input value={form.display_name} onChange={(event) => updateEditForm(user.id, { display_name: event.target.value })} />
                      </Field>
                      <Field label={t.resetPassword}>
                        <Input
                          value={form.password}
                          onChange={(event) => updateEditForm(user.id, { password: event.target.value })}
                          placeholder={t.passwordHint}
                          type="password"
                          autoComplete="new-password"
                        />
                      </Field>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-md border border-border/80 bg-muted/20 px-3 py-2">
                      <span className="text-sm font-medium">{t.active}</span>
                      <Switch checked={form.is_active} disabled={isSelf} onCheckedChange={(value) => updateEditForm(user.id, { is_active: value })} />
                    </div>
                    <RolePicker
                      className="mt-3"
                      disabled={isSelf}
                      roles={roles}
                      selected={form.roles}
                      onChange={(next) => updateEditForm(user.id, { roles: next })}
                    />
                  </article>
                );
              })}
            </div>
          ) : null}

          {view === "permissions" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
              <form onSubmit={handleSaveRole} className="rounded-md border border-border/80 bg-background/60 p-3">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ListChecks className="size-4 text-secondary" />
                      <p className="text-sm font-semibold">{t.rolePermissionManagement}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t.rolePermissionHint}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={startRoleCreate}>
                    <Plus />
                    {t.newRole}
                  </Button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t.roleName}>
                    <Input value={roleForm.name} onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))} />
                  </Field>
                  <Field label={t.description}>
                    <Input value={roleForm.description} onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))} />
                  </Field>
                </div>
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">{t.permissions}</p>
                  <div className="grid max-h-[460px] gap-2 overflow-y-auto rounded-md border border-border/80 bg-muted/10 p-2 lg:grid-cols-2">
                    {permissionList.map(([permission, description]) => (
                      <label key={permission} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/40">
                        <input
                          className="mt-0.5 size-4 accent-primary"
                          type="checkbox"
                          checked={roleForm.permissions.includes(permission)}
                          onChange={() => setRoleForm((current) => ({ ...current, permissions: toggleValue(current.permissions, permission) }))}
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold">{permission}</span>
                          <span className="block text-muted-foreground">{description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button type="submit" disabled={savingRole || !roleForm.name.trim()}>
                    {savingRole ? <Loader2 className="animate-spin" /> : <Save />}
                    {t.save}
                  </Button>
                </div>
              </form>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-secondary" />
                  <p className="text-sm font-semibold">{t.roles}</p>
                </div>
                {roles.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">{t.noRoles}</div>
                ) : roles.map((role) => (
                  <article key={role.id} className="rounded-md border border-border/80 bg-background/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{role.name}</p>
                          <Badge variant={role.builtin ? "outline" : "secondary"}>{role.builtin ? t.builtin : t.custom}</Badge>
                        </div>
                        {role.description ? <p className="mt-1 text-xs text-muted-foreground">{role.description}</p> : null}
                      </div>
                      {!role.builtin ? (
                        <Button variant="outline" size="sm" onClick={() => startRoleEdit(role)}>{t.editRole}</Button>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {role.permissions.slice(0, 8).map((permission) => <Badge key={permission} variant="muted">{permission}</Badge>)}
                      {role.permissions.length > 8 ? <Badge variant="outline">+{role.permissions.length - 8}</Badge> : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <SideDrawer
        cancelText={t.cancel}
        formId="create-user-form"
        isSaving={creatingUser}
        onClose={() => setCreateUserOpen(false)}
        open={createUserOpen}
        saveDisabled={!userForm.username.trim() || !userForm.password.trim() || userForm.roles.length === 0}
        saveText={t.create}
        subtitle={t.createUserHint}
        title={t.createUser}
      >
        <form id="create-user-form" onSubmit={handleCreateUser} className="space-y-3">
          <Field label={t.username}>
            <Input value={userForm.username} onChange={(event) => updateCreateForm({ username: event.target.value })} autoComplete="username" />
          </Field>
          <Field label={t.password}>
            <Input value={userForm.password} onChange={(event) => updateCreateForm({ password: event.target.value })} type="password" autoComplete="new-password" />
          </Field>
          <Field label={t.displayName}>
            <Input value={userForm.display_name} onChange={(event) => updateCreateForm({ display_name: event.target.value })} />
          </Field>
          <div className="flex items-center justify-between rounded-md border border-border/80 bg-muted/20 px-3 py-2">
            <span className="text-sm font-medium">{t.active}</span>
            <Switch checked={userForm.is_active} onCheckedChange={(value) => updateCreateForm({ is_active: value })} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{t.roles}</p>
            <RolePicker disabled={creatingUser} roles={roles} selected={userForm.roles} onChange={(next) => updateCreateForm({ roles: next })} />
          </div>
        </form>
      </SideDrawer>
    </>
  );
}

function RolePicker({
  className,
  disabled,
  onChange,
  roles,
  selected,
}: {
  className?: string;
  disabled?: boolean;
  onChange: (next: string[]) => void;
  roles: RoleInfo[];
  selected: string[];
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {roles.map((role) => {
        const active = selected.includes(role.name);
        return (
          <button
            key={role.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(toggleValue(selected, role.name))}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "border-primary/40 bg-primary text-primary-foreground"
                : "border-border/80 bg-background/60 text-muted-foreground hover:bg-muted/50",
            )}
          >
            {role.name}
          </button>
        );
      })}
    </div>
  );
}
