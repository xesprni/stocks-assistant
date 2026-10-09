import { request } from "@/lib/api/transport";
import type { EarningsRadarRequest, EarningsRadarResponse } from "@/types/earnings";

export function scanEarningsRadar(body: EarningsRadarRequest, init?: RequestInit) {
  return request<EarningsRadarResponse>("/api/v1/fundamentals/earnings-radar", {
    ...init, method: "POST", body: JSON.stringify(body),
  });
}
