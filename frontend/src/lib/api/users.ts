import { request } from "@/lib/api/transport";
import type {
  AuthUser,
  PagePermissionUpdateRequest,
  RoleListResponse,
  RoleUpdateRequest,
  UserCreateRequest,
  UserListResponse,
  UserUpdateRequest,
} from "@/types/app";

export function listUsers() {
  return request<UserListResponse>("/api/v1/users");
}

export function createUser(payload: UserCreateRequest) {
  return request<AuthUser>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUser(userId: string, payload: UserUpdateRequest) {
  return request<AuthUser>(`/api/v1/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function listRoles() {
  return request<RoleListResponse>("/api/v1/roles");
}

export function saveRole(name: string, payload: RoleUpdateRequest) {
  return request<RoleListResponse["roles"][number]>(`/api/v1/roles/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function savePagePermission(page: string, payload: PagePermissionUpdateRequest) {
  return request<RoleListResponse>(`/api/v1/roles/pages/${encodeURIComponent(page)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
