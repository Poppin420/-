import type { CardPreview, Choices, ExecutionResult } from "@core/actions/actions";
import type { Appointment } from "@core/calendar/appointments";
import type { Client } from "@core/clients/clients";

export type { CardPreview, Choices, ExecutionResult, Appointment, Client };

export interface Me {
  user: { id: string; email: string };
  google: { available: boolean; connected: boolean };
}

export interface CommandResponse {
  transcript: string;
  unrecognized: string[];
  previews: CardPreview[];
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

  voice(audio: Blob) {
    const form = new FormData();
    form.append("audio", audio, "voice");
    return request<CommandResponse>("POST", "/api/voice", form);
  },
  parse: (text: string) => request<CommandResponse>("POST", "/api/parse", { text }),

  preview: (p: CardPreview, transcript: string, choices: Choices, answer?: { field: string; value: string }) =>
    request<CardPreview>("POST", "/api/actions/preview", { card: cardInput(p), transcript, choices, answer }),
  execute: (p: CardPreview, transcript: string, choices: Choices) =>
    request<ExecutionResult>("POST", "/api/actions/execute", { card: cardInput(p), transcript, choices }),

  appointments: (from: string, to: string) =>
    request<{ appointments: Appointment[] }>("GET", `/api/appointments?from=${from}&to=${to}`),
  cancel: (id: string) => request<{ appointment: Appointment }>("POST", `/api/appointments/${id}/cancel`),
  retrySync: (id: string) => request<{ appointment: Appointment }>("POST", `/api/appointments/${id}/sync`),

  googleConnect: () => request<{ url: string }>("POST", "/api/google/connect"),
  googleDisconnect: () => request("POST", "/api/google/disconnect"),
  deleteAccount: (password: string) => request("POST", "/api/account/delete", { password }),
};

function cardInput(p: CardPreview) {
  return { id: p.card.id, raw: p.card.raw, userProvided: p.card.userProvided };
}
