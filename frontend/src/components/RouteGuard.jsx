import { useApp } from '../context/useApp';

/**
 * RouteGuard — Prevents navigation to pages when pipeline prerequisites are not met.
 *
 * Rules:
 *   /tender   → requires extractionStatus === 'complete'
 *   /review   → requires extraction complete + criteria locked
 *   /evaluation → requires extraction complete + criteria locked
 *
 * If prerequisites not met → redirects to the correct step.
 * If no project selected → redirects to dashboard.
 */
export default function RouteGuard({ page, children }) {
  const { hydrated } = useApp();

  // Don't guard until hydration complete (prevents flash redirects)
  if (!hydrated) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <div>
          <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading project data...</p>
        </div>
      </div>
    );
  }

  // Pages that don't need project context
  if (['dashboard', 'settings', 'upload'].includes(page)) {
    return children;
  }

  // We no longer strictly redirect. The individual pages will display 
  // their own "Empty States" (e.g. "No Project Selected" or "Extraction Required")
  // which provides much better UX than silent redirects.
  return children;
}
