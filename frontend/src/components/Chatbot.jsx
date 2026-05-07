import { useState, useRef, useEffect, useMemo } from 'react';
import { X, Send, Bot, User, Minimize2, Maximize2, Sparkles } from 'lucide-react';
import { useApp } from '../context/useApp';
import ReactMarkdown from 'react-markdown';
import { ChatAPI } from '../services/api';

/**
 * Build a rich context snapshot from the current app state.
 * This lets the chatbot answer questions about projects, criteria, status, etc.
 */
function buildContextSnapshot(projects, selectedProject, activeProcess) {
  const snapshot = {
    identity: "You are InferX AI Assistant — the built-in help and intelligence assistant for the InferX Tender Evaluation platform. You help government officers use the platform, explain evaluation results, troubleshoot issues, and answer questions about their projects. Always identify yourself as 'InferX AI Assistant'. Never pretend to be a human.",
    platform_guide: {
      overview: "InferX is an AI-powered tender evaluation system for government procurement (CRPF). It extracts eligibility criteria from tender documents, parses bidder submissions, and produces explainable evaluation reports.",
      workflow: [
        "1. Dashboard: Create a new Tender Project",
        "2. Upload: Upload tender documents and bidder documents (PDFs, scanned images, Word files)",
        "3. Tender Setup: Review AI-extracted criteria, edit/add/remove criteria, lock schema",
        "4. Review & Correct: Clean extracted data, mask PII, link documents",
        "5. Evaluation: Run AI evaluation for each bidder against criteria, view results with evidence",
        "6. Consolidated: Generate a consolidated multi-bidder comparison report",
        "7. Settings: Configure AI provider (Gemini/OpenRouter), view audit logs",
      ],
      tips: [
        "You can switch between light and dark theme using the moon/sun icon in the header",
        "The header shows a spinning indicator when any process (extraction/evaluation) is running",
        "If a process is running, the system will warn you before starting another one",
        "Use 'View LLM Payload Preview' to see exactly what the AI model receives",
        "All evaluations are versioned — you can compare different runs",
        "The system never silently disqualifies a bidder — ambiguous cases are flagged for review",
      ],
    },
    total_projects: projects.length,
    projects_summary: projects.map(p => ({
      name: p.name,
      status: p.status,
      bidders: p.bidders?.length || 0,
      tender_documents: p.tenderDocuments?.length || 0,
      evaluation_versions: p.versions?.length || 0,
      has_consolidated: !!p.consolidatedReport,
      created: p.createdAt,
    })),
    active_process: activeProcess ? {
      type: activeProcess.type,
      started: activeProcess.startedAt,
      progress: activeProcess.progress,
    } : null,
  };

  if (selectedProject) {
    snapshot.current_project = {
      name: selectedProject.name,
      status: selectedProject.status,
      extraction_status: selectedProject.extractionStatus,
      criteria_count: selectedProject.extractedCriteria?.length || 0,
      criteria_locked: selectedProject.criteriaLocked,
      bidders: (selectedProject.bidders || []).map(b => ({
        name: b.name,
        id: b.id,
        document_count: b.documents?.length || 0,
      })),
      tender_documents: (selectedProject.tenderDocuments || []).map(d => ({
        name: d.name,
        type: d.type,
      })),
      versions: (selectedProject.versions || []).map(v => ({
        version_id: v.version_id,
        status: v.status,
        bidder_name: v.bidder_name,
        bidder_id: v.bidder_id,
        pass_count: v.output?.filter(e => e.result === 'PASS')?.length || 0,
        fail_count: v.output?.filter(e => e.result === 'FAIL')?.length || 0,
        review_count: v.output?.filter(e => e.result === 'REVIEW')?.length || 0,
        created_at: v.created_at,
      })),
      criteria: (selectedProject.extractedCriteria || []).map(c => ({
        name: c.criteria_name || c.criterion_name,
        category: c.category,
        mandatory: c.mandatory,
        required_value: c.required_value,
      })),
    };

    // Include consolidated report summary if available
    if (selectedProject.consolidatedReport) {
      snapshot.current_project.consolidated = {
        eligible: selectedProject.consolidatedReport.summary?.eligible || 0,
        not_eligible: selectedProject.consolidatedReport.summary?.not_eligible || 0,
        review_required: selectedProject.consolidatedReport.summary?.review_required || 0,
        bidder_count: selectedProject.consolidatedReport.bidder_count || 0,
      };
    }
  }

  return snapshot;
}

/**
 * Handle messages locally for common questions without hitting the API
 */
function tryLocalAnswer(query, context) {
  const q = query.toLowerCase().trim();
  
  if (q.includes('who are you') || q.includes('what are you') || q.includes('your name')) {
    return "I'm **InferX AI Assistant** — your built-in guide for the InferX Tender Evaluation platform. I can help you navigate the system, explain evaluation results, troubleshoot issues, and answer questions about your projects. How can I help?";
  }

  if (q.includes('how many project') || q.includes('total project')) {
    return `You currently have **${context.total_projects} project(s)** in your workspace.\n\n${context.projects_summary.map(p => `- **${p.name}** — ${p.status} (${p.bidders} bidders, ${p.evaluation_versions} evaluations)`).join('\n')}`;
  }

  if (q.includes('how to use') || q.includes('how does this work') || q.includes('help me') || q === 'help') {
    return `## How to Use InferX\n\n${context.platform_guide.workflow.join('\n')}\n\n### 💡 Tips\n${context.platform_guide.tips.map(t => `- ${t}`).join('\n')}`;
  }

  if ((q.includes('status') || q.includes('current project')) && context.current_project) {
    const p = context.current_project;
    return `### Current Project: ${p.name}\n\n- **Status**: ${p.status}\n- **Extraction**: ${p.extraction_status || 'not started'}\n- **Criteria**: ${p.criteria_count} criteria ${p.criteria_locked ? '(locked ✓)' : '(unlocked)'}\n- **Bidders**: ${p.bidders.length}\n- **Evaluation Versions**: ${p.versions.length}`;
  }

  if (q.includes('criteria') && context.current_project?.criteria?.length > 0) {
    const criteria = context.current_project.criteria;
    return `### Criteria for Current Project (${criteria.length} total)\n\n${criteria.map((c, i) => `${i + 1}. **${c.name}** — ${c.category || 'General'} ${c.mandatory ? '(Mandatory)' : '(Optional)'}\n   Required: ${c.required_value || 'N/A'}`).join('\n')}`;
  }

  if (q.includes('running') || q.includes('process')) {
    if (context.active_process) {
      return `⚙️ A **${context.active_process.type}** process is currently running (started at ${new Date(context.active_process.started).toLocaleTimeString()}).\n\nProgress: ${context.active_process.progress || 'In progress...'}`;
    }
    return "No processes are currently running. You can start an extraction or evaluation from the respective pages.";
  }

  return null; // Fall through to API
}

export default function Chatbot() {
  const { selectedProject, projects, activeProcess } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      content: "👋 Hello! I'm **InferX AI Assistant**. I can help you:\n\n- Navigate the platform\n- Explain evaluation results\n- Check project status & criteria\n- Troubleshoot issues\n\nTry asking: *\"How many projects do I have?\"* or *\"What is the status of my current project?\"*"
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const contextSnapshot = useMemo(
    () => buildContextSnapshot(projects, selectedProject, activeProcess),
    [projects, selectedProject, activeProcess]
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom();
    }
  }, [messages, isOpen, isMinimized]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    
    const newUserMsg = { id: Date.now(), role: 'user', content: userMsg };
    setMessages(prev => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
      // Try local answer first (instant, no API call)
      const localAnswer = tryLocalAnswer(userMsg, contextSnapshot);
      
      if (localAnswer) {
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: 'assistant',
          content: localAnswer
        }]);
      } else {
        // Fall through to API with full context
        const response = await ChatAPI.sendMessage(userMsg, contextSnapshot);
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: 'assistant',
          content: response.reply
        }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      // Provide a helpful fallback instead of just an error
      const fallback = tryLocalAnswer(userMsg, contextSnapshot);
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: fallback || "⚠️ I couldn't reach the AI server, but I can still help with basic questions! Try asking:\n\n- *How many projects do I have?*\n- *What is the status of my current project?*\n- *How to use this platform?*\n- *Show me my criteria*",
        isError: !fallback
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Quick action suggestions
  const quickActions = [
    { label: '📊 Project Status', query: 'What is the status of my current project?' },
    { label: '📋 My Criteria', query: 'Show me the criteria for this project' },
    { label: '❓ How to Use', query: 'How do I use this platform?' },
    { label: '⚙️ Running?', query: 'Is any process running right now?' },
  ];

  if (!isOpen) {
    return (
      <button 
        className="chatbot-fab" 
        onClick={() => setIsOpen(true)}
        title="Open InferX AI Assistant"
      >
        <Sparkles size={24} />
      </button>
    );
  }

  return (
    <div className={`chatbot-window ${isMinimized ? 'minimized' : ''}`}>
      <div className="chatbot-header" onClick={() => setIsMinimized(!isMinimized)}>
        <div className="chatbot-title">
          <Bot size={18} />
          <span>InferX AI Assistant</span>
        </div>
        <div className="chatbot-controls">
          <button onClick={(e) => { e.stopPropagation(); setIsMinimized(!isMinimized); }}>
            {isMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          <div className="chatbot-messages">
            {messages.map(msg => (
              <div key={msg.id} className={`chat-message-row ${msg.role}`}>
                <div className="chat-avatar">
                  {msg.role === 'assistant' ? <Bot size={14} /> : <User size={14} />}
                </div>
                <div className={`chat-bubble ${msg.isError ? 'error' : ''}`}>
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="chat-message-row assistant">
                <div className="chat-avatar"><Bot size={14} /></div>
                <div className="chat-bubble loading">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          {messages.length <= 2 && (
            <div style={{ padding: '4px 12px 8px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {quickActions.map(qa => (
                <button
                  key={qa.label}
                  className="btn btn-sm btn-secondary"
                  style={{ fontSize: '0.7rem', padding: '3px 8px' }}
                  onClick={() => { setInput(qa.query); }}
                >
                  {qa.label}
                </button>
              ))}
            </div>
          )}

          <form className="chatbot-input" onSubmit={handleSend}>
            <input 
              type="text" 
              placeholder="Ask about projects, evaluations, criteria..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isLoading}
            />
            <button type="submit" disabled={!input.trim() || isLoading}>
              <Send size={16} />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
