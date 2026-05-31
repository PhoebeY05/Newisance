import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import Home from './pages/Home'
import Learn from './pages/Learn'
import Verify from './pages/Verify'
import Dashboard from './pages/Dashboard'
import Leaderboard from './pages/Leaderboard'
import Login from './pages/Login'
import Signup from './pages/Signup'
import PageStub from './components/PageStub'

/**
 * Route map for the Newisance app (Brain Hack 2026).
 * Each screen corresponds to a frame in the Figma file:
 * https://www.figma.com/design/oVa4fI7alXQRgAADqF4RUd/Brain-Hack-2026
 *
 * The main screens are built as static shells. The remaining screens are
 * placeholders wired into routing, ready to be built out next
 * (Figma node id noted on each).
 */
export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route path="learn" element={<Learn />} />
        <Route path="verify" element={<Verify />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />

        <Route path="account" element={<PageStub title="Account" figmaNode="89:221" />} />
        <Route path="ai-analysis" element={<PageStub title="AI Analysis" figmaNode="92:2" />} />
        <Route path="battle-royale" element={<PageStub title="Battle Royale" figmaNode="78:736" />} />
        <Route path="timed-challenge" element={<PageStub title="Timed Challenge" figmaNode="81:914" />} />
        <Route path="community" element={<PageStub title="Community Verification Feed" figmaNode="89:594" />} />
        <Route path="*" element={<PageStub title="Page not found" figmaNode="" />} />
      </Route>
    </Routes>
  )
}
