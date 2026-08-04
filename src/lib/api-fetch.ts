/**
 * API fetch wrapper that automatically includes credentials (HTTP-only Cookie).
 * Use this for all authenticated API calls.
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(url, {
    ...options,
    credentials: 'include',
  });
}
