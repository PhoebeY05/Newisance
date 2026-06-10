import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { AuthProvider } from './context/AuthContext'
import './index.css'
import App from './App.tsx'

// A new deploy rotates the hashed chunk filenames. A tab still running the old
// index.html will 404 on a lazy-loaded chunk (e.g. Wardrobe) — Vite fires
// 'vite:preloadError'. Reload once to fetch the fresh index.html with current
// hashes. The timestamp guard re-arms after 10s so a genuinely-missing asset
// can't put us in a reload loop.
window.addEventListener('vite:preloadError', () => {
  const last = Number(sessionStorage.getItem('preloadErrorReload') || 0)
  if (Date.now() - last < 10_000) return
  sessionStorage.setItem('preloadErrorReload', String(Date.now()))
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
