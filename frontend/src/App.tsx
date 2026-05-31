import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import Home from './pages/Home'
import Learn from './pages/Learn'
import Verify from './pages/Verify'
import Dashboard from './pages/Dashboard'
import Leaderboard from './pages/Leaderboard'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Account from './pages/Account'
import AIAnalysis from './pages/AIAnalysis'
import Community from './pages/Community'
import CommunityPost from './pages/CommunityPost'
import BattleRoyale from './pages/BattleRoyale'
import TimedChallenge from './pages/TimedChallenge'
import PageStub from './components/PageStub'

/**
 * Route map for the Newisance app (Brain Hack 2026).
 * Each screen corresponds to a frame in the Figma file:
 * https://www.figma.com/design/oVa4fI7alXQRgAADqF4RUd/Brain-Hack-2026
 *
 * Most screens sit inside MainLayout (navbar + footer). The two game screens
 * (Battle Royale, Timed Challenge) are full-screen with their own HUDs, so
 * they're routed standalone outside the layout.
 */
export default function App() {
  return (
    <Routes>
      {/* Standalone full-screen game routes (no navbar/footer) */}
      <Route path="/battle-royale" element={<BattleRoyale />} />
      <Route path="/timed-challenge" element={<TimedChallenge />} />

      {/* Standard layout routes */}
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route path="learn" element={<Learn />} />
        <Route path="verify" element={<Verify />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="account" element={<Account />} />
        <Route path="ai-analysis" element={<AIAnalysis />} />
        <Route path="community" element={<Community />} />
        <Route path="community/post" element={<CommunityPost />} />
        <Route path="*" element={<PageStub title="Page not found" figmaNode="" />} />
      </Route>
    </Routes>
  )
}
