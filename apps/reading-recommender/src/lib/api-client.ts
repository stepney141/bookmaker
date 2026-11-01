type ApiErrorResponse = {
  readonly error: string;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Request failed: ${status} ${code}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string";
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body !== undefined && init.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  const payload: unknown = await response.json();

  if (!response.ok) {
    if (!isApiErrorResponse(payload)) {
      throw new Error(`Request failed with an invalid error response: ${response.status}`);
    }

    throw new ApiRequestError(response.status, payload.error);
  }

  return payload as T;
}
