type ApiError = {
  error?: string;
};

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  let result: T & ApiError;
  try {
    result = await response.json();
  } catch {
    throw new Error(`การเชื่อมต่อล้มเหลว (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(result.error || `การเชื่อมต่อล้มเหลว (HTTP ${response.status})`);
  }
  return result;
}

export function jsonBody(body: unknown): string {
  return JSON.stringify(body);
}
