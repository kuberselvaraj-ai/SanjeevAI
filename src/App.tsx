import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Login from "./pages/Login"
import Admin from "./pages/Admin"
import SharePage from "./pages/SharePage"
import NotFound from "./pages/NotFound"
import { BootSplash } from './components/BootSplash'

export default function App() {
  return (
    <>
    <BootSplash />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/share/:slug" element={<SharePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  )
}
