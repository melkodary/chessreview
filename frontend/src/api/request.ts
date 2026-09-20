import { API_BASE } from '../config'

export async function postJson<T>(
  path: string,
  body: unknown,
  errorFor: (response: Response) => Error,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) throw errorFor(response)
  return response.json() as Promise<T>
}
