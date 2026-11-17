/**
 * Builds a JSON HTTP Response with a UTF-8 `Content-Type` header.
 */
export function jsonResponse(
  data: unknown,
  statusOrInit: number | ResponseInit = 200,
): Response {
  const init: ResponseInit =
    typeof statusOrInit === 'number' ? { status: statusOrInit } : statusOrInit;
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), {
    ...init,
    status: init.status ?? 200,
    headers,
  });
}

/**
 * Builds a standardized `{ error: message }` JSON HTTP Response.
 */
export function jsonError(
  message: string,
  statusOrInit: number | ResponseInit = 400,
): Response {
  const init: ResponseInit =
    typeof statusOrInit === 'number' ? { status: statusOrInit } : statusOrInit;
  return jsonResponse(
    { error: message },
    { ...init, status: init.status ?? 400 },
  );
}
