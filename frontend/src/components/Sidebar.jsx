import { NavLink } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { BarChart2, Upload, ClipboardList, Search, Scale, Settings, PieChart } from 'lucide-react';


export default function Sidebar() {
  const { sidebarCollapsed, selectedProject } = useApp();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <BarChart2 size={18} />, enabled: true },
    { path: '/upload', label: 'Upload', icon: <Upload size={18} />, enabled: true },
    { path: '/tender', label: 'Tender Setup', icon: <ClipboardList size={18} />, enabled: true },
    { path: '/review', label: 'Review & Correct', icon: <Search size={18} />, enabled: true },
    { path: '/evaluation', label: 'Evaluation', icon: <Scale size={18} />, enabled: true },
    { path: '/consolidated', label: 'Consolidated', icon: <PieChart size={18} />, enabled: true },
    { path: '/settings', label: 'Settings', icon: <Settings size={18} />, enabled: true },
  ];

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-logo">
        <h1>{sidebarCollapsed ? 'IX' : 'InferX'}</h1>
        {!sidebarCollapsed && <span>Document AI • Tender Evaluation</span>}
      </div>

      {/* Active Project Indicator */}
      {selectedProject && !sidebarCollapsed && (
        <div className="sidebar-project">
          <div className="sidebar-project-label">Active Project</div>
          <div className="sidebar-project-name" title={selectedProject.name}>
            {selectedProject.name.length > 22
              ? selectedProject.name.slice(0, 22) + '…'
              : selectedProject.name}
          </div>
          <div className="sidebar-project-status">
            <span className={`status-dot ${
              selectedProject.status === 'evaluated' ? 'online' :
              selectedProject.status === 'extracted' ? 'pending' :
              selectedProject.status === 'uploaded' ? 'pending' : 'offline'
            }`}></span>
            {selectedProject.status}
          </div>
        </div>
      )}

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => (isActive ? 'active' : '')}
            end={item.path === '/'}
            title={sidebarCollapsed ? item.label : ''}
          >
            <span className="icon">{item.icon}</span>
            {!sidebarCollapsed && (
              <span className="nav-label">
                {item.label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        {sidebarCollapsed ? 'v2' : 'InferX v2.0 • Government Grade'}
      </div>
    </aside>
  );
}
