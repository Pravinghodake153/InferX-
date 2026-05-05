import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import RouteGuard from './components/RouteGuard';
import RouteTracker from './components/RouteTracker';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import TenderSetup from './pages/TenderSetup';
import ReviewCorrection from './pages/ReviewCorrection';
import Evaluation from './pages/Evaluation';
import ConsolidatedReport from './pages/ConsolidatedReport';
import Settings from './pages/Settings';

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <RouteTracker />
        <Layout>
          <Routes>
            <Route path="/" element={
              <RouteGuard page="dashboard"><Dashboard /></RouteGuard>
            } />
            <Route path="/upload" element={
              <RouteGuard page="upload"><Upload /></RouteGuard>
            } />
            <Route path="/tender" element={
              <RouteGuard page="tender"><TenderSetup /></RouteGuard>
            } />
            <Route path="/review" element={
              <RouteGuard page="review"><ReviewCorrection /></RouteGuard>
            } />
            <Route path="/evaluation" element={
              <RouteGuard page="evaluation"><Evaluation /></RouteGuard>
            } />
            <Route path="/consolidated" element={
              <RouteGuard page="consolidated"><ConsolidatedReport /></RouteGuard>
            } />
            <Route path="/settings" element={
              <RouteGuard page="settings"><Settings /></RouteGuard>
            } />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AppProvider>
  );
}
