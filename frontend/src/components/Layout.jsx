import Sidebar from './Sidebar';
import Header from './Header';
import { useApp } from '../context/useApp';

export default function Layout({ children }) {
  const { sidebarCollapsed } = useApp();

  return (
    <div className={`app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar />
      <div className="main">
        <Header />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
