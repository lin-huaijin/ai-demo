import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ArchivePage } from './pages/ArchivePage'
import { ArtifactDetailPage } from './pages/ArtifactDetailPage.tsx'
import { InspirePage } from './pages/InspirePage'
import { OverviewPage } from './pages/OverviewPage'
import { ProducePage } from './pages/ProducePage'
import { PushPage } from './pages/PushPage'
import { ScreenPage } from './pages/ScreenPage'
import { AppProvider } from './state'

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="inspire" element={<InspirePage />} />
            <Route path="screen" element={<ScreenPage />} />
            <Route path="produce" element={<ProducePage />} />
            <Route path="push" element={<PushPage />} />
            <Route path="archive" element={<ArchivePage />} />
            <Route path="archive/:projectId/:assetId" element={<ArtifactDetailPage />} />
            <Route path="create" element={<Navigate to="/screen" replace />} />
            <Route path="optimize" element={<Navigate to="/screen" replace />} />
            <Route path="train" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
