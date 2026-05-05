import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/useApp';

/**
 * RouteTracker — Persists the current route to localStorage.
 * Renders nothing. Runs as a side-effect inside BrowserRouter.
 */
export default function RouteTracker() {
  const location = useLocation();
  const { setLastRoute } = useApp();

  useEffect(() => {
    setLastRoute(location.pathname);
  }, [location.pathname, setLastRoute]);

  return null;
}
