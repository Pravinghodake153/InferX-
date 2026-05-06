import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Bot, User, Minimize2, Maximize2 } from 'lucide-react';
import { useApp } from '../context/useApp';
import ReactMarkdown from 'react-markdown';
import { ChatAPI } from '../services/api';

export default function Chatbot() {
  const { selectedProject } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      content: "Hello! I am an InferX AI chatbot. I can guide you through the platform, troubleshoot issues, or explain specific evaluation results. How can I help you today?"
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

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
    
    // Add user message to UI
    const newUserMsg = { id: Date.now(), role: 'user', content: userMsg };
    setMessages(prev => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
      // Build context payload
      const contextPayload = {
        project_name: selectedProject?.name || null,
        project_status: selectedProject?.status || null,
      };

      // Check if we are viewing evaluations
      if (selectedProject?.evaluationResults) {
         contextPayload.tender_criteria = selectedProject.evaluationResults.criteria || [];
         contextPayload.bidder_evaluations = selectedProject.evaluationResults.bidder_results || [];
      } else if (selectedProject?.sandboxData?.bidders) {
         contextPayload.tender_criteria = selectedProject.sandboxData.tender?.criteria || [];
         contextPayload.bidder_evaluations = selectedProject.sandboxData.bidders;
      }

      const response = await ChatAPI.sendMessage(userMsg, contextPayload);
      
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: response.reply
      }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        content: "⚠️ Sorry, I encountered an error communicating with the AI server. Please check your network or try again later.",
        isError: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button 
        className="chatbot-fab" 
        onClick={() => setIsOpen(true)}
        title="Open InferX AI Assistant"
      >
        <MessageSquare size={24} />
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

          <form className="chatbot-input" onSubmit={handleSend}>
            <input 
              type="text" 
              placeholder="Ask about evaluations, criteria, etc..." 
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
