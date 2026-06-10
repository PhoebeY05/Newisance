import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import Home from './pages/Home'
import Verify from './pages/Verify'
import Dashboard from './pages/Dashboard'
import Leaderboard from './pages/Leaderboard'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Account from './pages/Account'
import Profile from './pages/Profile'
import Admin from './pages/Admin'
import AIAnalysis from './pages/AIAnalysis'
import Community from './pages/Community'
import CommunityPost from './pages/CommunityPost'
import Shop from './pages/Shop'
import BattleRoyale from './pages/BattleRoyale'
import TimedChallenge from './pages/TimedChallenge'
import TruthTower from './pages/TruthTower'
import PageStub from './components/PageStub'
import ProtectedRoute from './components/ProtectedRoute'

// The 3D town pulls in three.js / react-three-fiber — lazy-load it so those
// libraries only download when the Learn route is actually visited. The Wardrobe
// renders 3D avatar previews, so it gets the same treatment.
const Learn = lazy(() => import('./pages/Learn'))
const Wardrobe = lazy(() => import('./pages/Wardrobe'))

/**
 * Route map for the Newisance app (Brain Hack 2026).
 * Each screen corresponds to a frame in the Figma file:
 * https://www.figma.com/design/oVa4fI7alXQRgAADqF4RUd/Brain-Hack-2026
 *
 * Most screens sit inside MainLayout (navbar + footer). The 3D town hub
 * (Learn) and the two game screens (Battle Royale, Timed Challenge) are
 * full-screen with their own HUDs, so they're routed standalone outside the
 * layout.
 */
export default function App() {
  return (
    <Routes>
      {/* Standalone full-screen routes (no navbar/footer): the 3D town hub
          and the two game screens, each with their own HUD. */}
      <Route
        path="/learn"
        element={
          <Suspense
            fallback={
              <div className="grid h-[100dvh] place-items-center text-ink-soft">
                Loading Newisance Town…
              </div>
            }
          >
            <Learn />
          </Suspense>
        }
      />
      <Route path="/battle-royale" element={<BattleRoyale />} />
      <Route path="/timed-challenge" element={<TimedChallenge />} />
      <Route path="/truth-tower" element={<TruthTower />} />

      {/* Standard layout routes */}
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route path="verify" element={<Verify />} />
        <Route path="shop" element={<Shop />} />
        <Route
          path="wardrobe"
          element={
            <Suspense
              fallback={
                <div className="grid min-h-[60vh] place-items-center text-ink-soft">
                  Loading the Style Studio…
                </div>
              }
            >
              <Wardrobe />
            </Suspense>
          }
        />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route
          path="account"
          element={
            <ProtectedRoute>
              <Account />
            </ProtectedRoute>
          }
        />
        <Route
          path="profile"
          element={
            <ProtectedRoute guestAllowed>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin"
          element={
            <ProtectedRoute>
              <Admin />
            </ProtectedRoute>
          }
        />
        <Route path="ai-analysis/:id" element={<AIAnalysis />} />
        <Route path="community" element={<Community />} />
        <Route path="community/post/:id" element={<CommunityPost />} />
        <Route path="*" element={<PageStub title="Page not found" figmaNode="" />} />
      </Route>
    </Routes>
  )
}
