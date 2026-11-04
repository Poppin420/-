import type { Appointment } from "@core/calendar/appointments";
import type { Client } from "@core/clients/clients";
import type { Vehicle, ServiceTarget } from "@core/vehicles/vehicles";
import type { ServiceItem } from "@core/vehicles/serviceItems";
import type { ServiceRecord } from "@core/vehicles/serviceRecords";
import type { BusinessProfile } from "@core/invoicing/profile";
import type { CheckResult, InvoiceRow, InvoicePlan } from "@core/invoicing/invoices";
import type { CredentialStatus } from "@core/aade/credentials";

export type { Appointment, Client, Vehicle, ServiceTarget, ServiceItem, ServiceRecord, BusinessProfile, CheckResult, InvoiceRow, CredentialStatus };

/** Writable vehicle fields as sent from the UI; year may be a string the server coerces. */
export type VehicleFields = Partial<Omit<Vehicle, "id" | "client_id" | "year">> & { year?: number | string | null };

/** Writable service-record fields as sent from the UI; odometer may be a string. */
export type ServiceFields = Partial<Omit<ServiceRecord, "id" | "vehicle_id" | "odometer">> & { odometer?: number | string | null };

export interface ManualInvoiceInput {
  client_id: string;
  description: string;
  amount: string;
  price_basis: "with_vat" | "without_vat";
  documentTypeId?: string;
  lineVatCategoryId?: string;
}
export interface ManualInvoiceResult {
  plan: InvoicePlan;
  invoice: InvoiceRow | null;
  blockers: string[];
  warnings: string[];
}

export interface SpecInfo {
  version: string | null;
  verified: boolean;
}

export interface ProfileResponse {
  profile: BusinessProfile;
  issues: Array<{ field: string; message: string }>;
  spec: SpecInfo;
}

export interface InvoiceDetail {
  invoice: InvoiceRow;
  issuer: Pick<BusinessProfile, "afm" | "legal_name" | "trade_name" | "doy" | "address" | "branch" | "activity">;
  checks: CheckResult[];
}

export interface Me {
  user: { id: string; email: string };
  google: { available: boolean; connected: boolean };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Called on any 401 so the app can return to the login screen. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown | FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body instanceof FormData || body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Δεν υπάρχει σύνδεση με τον server. Έλεγξε το δίκτυο.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized();
    throw new ApiError(typeof data.error === "string" ? data.error : "Κάτι πήγε στραβά. Δοκίμασε ξανά.", res.status, data);
  }
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/auth/me"),
  login: (email: string, password: string) => request("POST", "/api/auth/login", { email, password }),
  signup: (email: string, password: string, signupCode: string) =>
    request("POST", "/api/auth/signup", { email, password, signupCode }),
  logout: () => request("POST", "/api/auth/logout"),

  appointments: (from: string, to: string) =>
    request<{ appointments: Appointment[] }>("GET", `/api/appointments?from=${from}&to=${to}`),
  cancel: (id: string) => request<{ appointment: Appointment }>("POST", `/api/appointments/${id}/cancel`),
  retrySync: (id: string) => request<{ appointment: Appointment }>("POST", `/api/appointments/${id}/sync`),

  googleConnect: () => request<{ url: string }>("POST", "/api/google/connect"),
  googleDisconnect: () => request("POST", "/api/google/disconnect"),
  deleteAccount: (password: string) => request("POST", "/api/account/delete", { password }),

  profile: () => request<ProfileResponse>("GET", "/api/profile"),
  saveProfile: (profile: BusinessProfile) => request<ProfileResponse>("PUT", "/api/profile", profile),

  aadeCredentials: () =>
    request<{ credentials: Record<"test" | "prod", CredentialStatus>; encryptionConfigured: boolean; spec: SpecInfo }>("GET", "/api/aade/credentials"),
  saveAadeCredentials: (env: "test" | "prod", username: string, subscriptionKey: string, confirmProduction = false) =>
    request<{ credentials: Record<"test" | "prod", CredentialStatus> }>("PUT", `/api/aade/credentials/${env}`, { username, subscriptionKey, confirmProduction }),
  deleteAadeCredentials: (env: "test" | "prod") =>
    request<{ credentials: Record<"test" | "prod", CredentialStatus> }>("DELETE", `/api/aade/credentials/${env}`),
  testAade: (env: "test" | "prod") => request("POST", `/api/aade/test/${env}`),

  clients: () => request<{ clients: Client[] }>("GET", "/api/clients"),
  searchClients: (q: string) => request<{ clients: Client[] }>("GET", `/api/clients/search?q=${encodeURIComponent(q)}`),
  createClient: (data: Partial<Client> & { name: string }) => request<{ client: Client }>("POST", "/api/clients", data),
  updateClient: (id: string, data: Partial<Client>) => request<{ client: Client }>("PUT", `/api/clients/${id}`, data),

  vehicles: (clientId: string) => request<{ vehicles: Vehicle[] }>("GET", `/api/clients/${clientId}/vehicles`),
  createVehicle: (clientId: string, data: VehicleFields & { plate: string }) =>
    request<{ vehicle: Vehicle }>("POST", `/api/clients/${clientId}/vehicles`, data),
  updateVehicle: (id: string, data: VehicleFields) => request<{ vehicle: Vehicle }>("PUT", `/api/vehicles/${id}`, data),
  deleteVehicle: (id: string) => request("DELETE", `/api/vehicles/${id}`),
  findVehiclesByPlate: (plate: string) => request<{ vehicles: Vehicle[] }>("GET", `/api/vehicles?plate=${encodeURIComponent(plate)}`),
  serviceTargets: (q: string) => request<{ targets: ServiceTarget[] }>("GET", `/api/service-targets?q=${encodeURIComponent(q)}`),

  serviceItems: (activeOnly = false) =>
    request<{ items: ServiceItem[] }>("GET", `/api/service-items${activeOnly ? "?active=1" : ""}`),
  createServiceItem: (data: { label: string; category?: string | null }) =>
    request<{ item: ServiceItem }>("POST", "/api/service-items", data),
  updateServiceItem: (id: string, data: Partial<ServiceItem>) => request<{ item: ServiceItem }>("PUT", `/api/service-items/${id}`, data),
  deleteServiceItem: (id: string) => request("DELETE", `/api/service-items/${id}`),

  importGarage: (rows: Record<string, string>[]) =>
    request<{ summary: Record<string, number> }>("POST", "/api/import/garage", { rows }),

  services: (vehicleId: string) => request<{ records: ServiceRecord[] }>("GET", `/api/vehicles/${vehicleId}/services`),
  createService: (vehicleId: string, data: ServiceFields) =>
    request<{ record: ServiceRecord }>("POST", `/api/vehicles/${vehicleId}/services`, data),
  updateService: (id: string, data: ServiceFields) => request<{ record: ServiceRecord }>("PUT", `/api/services/${id}`, data),
  deleteService: (id: string) => request("DELETE", `/api/services/${id}`),

  invoices: (params: { q?: string; status?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.offset != null) qs.set("offset", String(params.offset));
    const s = qs.toString();
    return request<{ invoices: InvoiceRow[]; hasMore: boolean }>("GET", `/api/invoices${s ? `?${s}` : ""}`);
  },
  createInvoice: (data: ManualInvoiceInput) => request<ManualInvoiceResult>("POST", "/api/invoices", data),
  invoice: (id: string) => request<InvoiceDetail>("GET", `/api/invoices/${id}`),
  deleteInvoice: (id: string) => request("POST", `/api/invoices/${id}/delete`),
  issueInvoice: (id: string, paymentMethod: string) =>
    request<{ checks: CheckResult[] }>("POST", `/api/invoices/${id}/issue`, { confirm: true, paymentMethod }),
};
