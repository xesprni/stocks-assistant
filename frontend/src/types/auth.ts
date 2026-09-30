import type { Page } from "@/types/ui";

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  avatar_base64?: string;
  roles: string[];
  permissions: string[];
  page_permissions?: Partial<Record<Page, string>>;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  last_login_at?: string | null;
}

export interface UserListResponse {
  users: AuthUser[];
  total: number;
}

export interface UserCreateRequest {
  username: string;
  password: string;
  display_name?: string;
  roles: string[];
  is_active?: boolean;
}

export interface UserUpdateRequest {
  display_name?: string;
  password?: string;
  roles?: string[];
  is_active?: boolean;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface UserProfileUpdateRequest {
  display_name?: string;
  avatar_base64?: string;
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  permissions: string[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RoleListResponse {
  roles: RoleInfo[];
  permissions: Record<string, string>;
  page_permissions: Partial<Record<Page, string>>;
}

export interface RoleUpdateRequest {
  name: string;
  description: string;
  permissions: string[];
}

export interface PagePermissionUpdateRequest {
  permission: string;
}

export interface AuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export interface SetupStatusResponse {
  setup_required: boolean;
}

export interface LoginRecord {
  id: string;
  device_id: string;
  user_id: string;
  username: string;
  display_name: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at?: string | null;
  user_agent: string;
  ip_address: string;
  last_ip_address: string;
  session_count: number;
  active_refresh_tokens: number;
  is_current: boolean;
  is_active: boolean;
  is_online: boolean;
}

export interface LoginSession extends LoginRecord {
  records: LoginRecord[];
}

export interface LoginDeviceHeartbeatResponse {
  status: string;
  device_id: string;
  last_seen_at: string;
  is_online: boolean;
}

export interface LoginSessionListResponse {
  sessions: LoginSession[];
  max_lifetime_days: number;
  max_devices_per_user: number;
  refresh_token_days: number;
}
