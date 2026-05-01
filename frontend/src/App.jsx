import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout.jsx'
import { Upload } from './pages/Upload.jsx'
import { Campaigns } from './pages/Campaigns.jsx'
import { Batches } from './pages/Batches.jsx'
import { Schedule } from './pages/Schedule.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/upload" replace />} />
        <Route path="upload" element={<Upload />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="batches" element={<Batches />} />
        <Route path="schedule" element={<Schedule />} />
      </Route>
    </Routes>
  )
}
