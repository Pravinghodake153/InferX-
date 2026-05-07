import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { ToastProvider } from './components/Toast';
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
import Chatbot from './components/Chatbot';

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
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
            <Chatbot />
          </Layout>
        </BrowserRouter>
      </ToastProvider>
    </AppProvider>
  );
}
