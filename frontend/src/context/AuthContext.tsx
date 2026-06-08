import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export interface UserProfile {
  id: number
  username: string
  email: string
  is_guest: boolean
  credibility_score: number
  tier: string
  is_admin: boolean
  created_at: string
  updated_at: string
}

interface AuthResponse {
  access_token: string
  token_type: 'bearer'
  user: UserProfile
}

interface LoginInput {
  email: string
  password: string
}

interface RegisterInput extends LoginInput {
  username: string
}

interface AuthContextValue {
  user: UserProfile | null
  token: string | null
  loading: boolean
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  loginWithGoogle: () => Promise<void>
  loginAsGuest: () => Promise<void>
  logout: () => void
}

const AUTH_STORAGE_KEY = 'newisance.auth.token'

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function parseAuthResponse(response: Response): Promise<AuthResponse> {
  if (!response.ok) {
    const rawMessage = await response.text()
    let message = rawMessage
    try {
      const parsed = JSON.parse(rawMessage) as { detail?: string }
      message = parsed.detail ?? rawMessage
    } catch {
      // Keep non-JSON server/proxy errors as-is.
    }
    throw new Error(message || `Authentication request failed (${response.status})`)
  }
  return (await response.json()) as AuthResponse
}

async function fetchAuth(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error('Cannot reach the community service. Start it on port 8003 and try again.')
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  useEffect(() => {
    const storedToken = window.localStorage.getItem(AUTH_STORAGE_KEY)
    if (!storedToken) {
      setLoading(false)
      return
    }

    setToken(storedToken)
    void fetch('/api/community/users/me', {
      headers: {
        Authorization: `Bearer ${storedToken}`,
      },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Token validation failed')
        }
        const profile = (await response.json()) as UserProfile
        setUser(profile)
      })
      .catch(() => {
        window.localStorage.removeItem(AUTH_STORAGE_KEY)
        setToken(null)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const applyAuth = (response: AuthResponse) => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, response.access_token)
    setToken(response.access_token)
    setUser(response.user)
  }

  const loadGoogleScript = async () => {
    if (typeof window === 'undefined') {
      throw new Error('Google sign-in is only available in the browser')
    }
    if ((window as any).google?.accounts?.id) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Failed to load Google Sign-In library'))
      document.head.appendChild(script)
    })
  }

  const requestGoogleCredential = async (): Promise<string> => {
    if (!googleClientId) {
      throw new Error('Missing Google client ID. Set VITE_GOOGLE_CLIENT_ID in .env.')
    }

    await loadGoogleScript()
    return await new Promise<string>((resolve, reject) => {
      const google = (window as any).google
      if (!google?.accounts?.id) {
        return reject(new Error('Google Identity Services is unavailable'))
      }

      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response: any) => {
          if (response?.credential) {
            resolve(response.credential)
          } else {
            reject(new Error('Google authentication failed'))
          }
        },
        auto_select: false,
      })

      google.accounts.id.prompt((notification: any) => {
        if (notification?.isNotDisplayed?.()) {
          reject(new Error('Google sign-in is blocked for this app origin or client ID. Check the OAuth client settings.'))
        } else if (notification?.isSkippedMoment?.()) {
          reject(new Error('Google sign-in was skipped by the browser. Try again or use email/guest login.'))
        } else if (notification?.isDismissedMoment?.()) {
          reject(new Error('Google sign-in was closed before a token was returned.'))
        }
      })
    })
  }

  const loginWithGoogle = async () => {
    const idToken = await requestGoogleCredential()
    const response = await parseAuthResponse(
      await fetchAuth('/api/community/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id_token: idToken }),
      }),
    )
    applyAuth(response)
  }

  const login = async (input: LoginInput) => {
    const response = await parseAuthResponse(
      await fetchAuth('/api/community/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }),
    )
    applyAuth(response)
  }

  const register = async (input: RegisterInput) => {
    const response = await parseAuthResponse(
      await fetchAuth('/api/community/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }),
    )
    applyAuth(response)
  }

  const loginAsGuest = async () => {
    const response = await parseAuthResponse(
      await fetchAuth('/api/community/auth/guest', {
        method: 'POST',
      }),
    )
    applyAuth(response)
  }

  const logout = () => {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    setToken(null)
    setUser(null)
  }

  const value = useMemo(
    () => ({ user, token, loading, login, register, loginWithGoogle, loginAsGuest, logout }),
    [user, token, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
