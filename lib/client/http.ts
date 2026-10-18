type ApiErrorBody = { error?: unknown };

export class ApiResponseError<T extends ApiErrorBody = ApiErrorBody> extends Error {
  constructor(message: string, readonly status: number, readonly body: T) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(response.ok
      ? "The server returned an unexpected response instead of JSON."
      : `The server could not complete the request (${response.status}). Check the server console for details.`);
  }

  let body: T & ApiErrorBody;
  try {
    body = await response.json() as T & ApiErrorBody;
  } catch {
    throw new Error("The server returned malformed JSON. Check the server console for details.");
  }

  if (!response.ok) {
    const message = typeof body.error === "string" && body.error.trim()
      ? body.error
      : `The request failed with status ${response.status}.`;
    throw new ApiResponseError(message, response.status, body);
  }
  return body;
}
