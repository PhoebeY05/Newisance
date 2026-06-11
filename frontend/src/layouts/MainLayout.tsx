import { Outlet } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import UserOnboarding from '../components/UserOnboarding'

export default function MainLayout() {
  return (
    <div className="flex min-h-full flex-col">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <UserOnboarding />
    </div>
  )
}
