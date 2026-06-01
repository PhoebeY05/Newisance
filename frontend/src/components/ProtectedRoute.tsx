import { Navigate } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
  guestAllowed?: boolean
}

export default function ProtectedRoute({ children, guestAllowed = false }: ProtectedRouteProps) {
  const { user, token, loading } = useAuth()

  if (loading) {
    return <div className="px-6 py-16 text-center text-ink-soft">Loading...</div>
  }

  if (!token) {
    return <Navigate to="/login" replace />
  }

  if (!guestAllowed && user?.is_guest) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}