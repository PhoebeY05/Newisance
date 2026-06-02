import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

export function useApi() {
  const { token } = useAuth()

  // Memoised on `token` so the returned function keeps a stable identity across
  // renders. Without this, every render produces a new `apiFetch`, which makes
  // it unsafe as a useEffect/useCallback dependency (it would re-fire effects on
  // every render — an infinite refetch loop).
  return useCallback(
    async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
      const headers = new Headers(init.headers)
      if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json')
      }

      const response = await fetch(input, {
        ...init,
        headers,
      })

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || `Request failed with status ${response.status}`)
      }

      return response
    },
    [token],
  )
}