import React from 'react';
import {
  Bot,
  Globe,
  Trash2,
  Sparkles,
  BookOpen,
  FileText,
  CheckCircle2,
  Clock,
  Play,
  Zap,
  ExternalLink,
  User,
  RefreshCw,
  Send,
  Check,
  Copy
} from 'lucide-react';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function AITutor({
  webSearchEnabled,
  setWebSearchEnabled,
  clearChatHistory,
  selectedModel,
  setSelectedModel,
  availableModels = [],
  chatMessages = [],
  setChatMessages,
  viewMode,
  submissionSummaries = {},
  cleanSubmissionFallback,
  handleCueClick,
  copiedPromptId,
  copyUserPrompt,
  copiedSubmissionId,
  copySubmissionText,
  chatLoading,
  chatInput,
  setChatInput,
  chatInputRef,
  chatEndRef,
  handleSendMessage
}) {
  return (
    <div style={{ flex: 1, background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Chat Header with Model Selector & Web Search Toggle */}
      <div style={{
        padding: '12px 18px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        background: 'var(--card-bg)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'var(--highlight-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <Bot size={18} color="var(--theme-primary)" />
          </div>
          <div>
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              AI Tutor
            </h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>
              Grounded Lecture & Web Socratic Tutor
            </p>
          </div>
        </div>

        {/* Model Selector & View Mode Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Web Grounding Toggle */}
          <button
            onClick={() => setWebSearchEnabled(prev => !prev)}
            title={webSearchEnabled ? "Web grounding ENABLED (Free DuckDuckGo & Wikipedia search)" : "Web grounding DISABLED (Transcripts only)"}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: webSearchEnabled ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
              background: webSearchEnabled ? 'rgba(16, 185, 129, 0.12)' : 'var(--panel-bg)',
              color: webSearchEnabled ? '#10b981' : 'var(--text-secondary)',
              transition: 'all 0.2s ease'
            }}
          >
            <Globe size={13} color={webSearchEnabled ? '#10b981' : 'var(--text-secondary)'} />
            <span>Web: {webSearchEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* New Chat / Reset Thread Button */}
          <button
            onClick={clearChatHistory}
            title="Start a new chat thread (clears chat for this lecture)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 10px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: '1px solid var(--border-color)',
              background: 'var(--panel-bg)',
              color: 'var(--text-secondary)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.borderColor = 'var(--theme-primary)';
              e.currentTarget.style.background = 'var(--card-bg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.borderColor = 'var(--border-color)';
              e.currentTarget.style.background = 'var(--panel-bg)';
            }}
          >
            <Trash2 size={13} />
            <span>New Chat</span>
          </button>

          {/* Model Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              title="Select the active LLM engine"
              style={{
                background: 'var(--panel-bg)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '5px 10px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
              }}
            >
              {(availableModels.length > 0 ? availableModels : [
                { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', badge: '⚡ Free 1.5k/day' },
                { id: 'llama-3.3-70b-versatile', name: 'Groq Llama 3.3 70B', badge: '🚀 Free 1k/day' },
                { id: 'meta-llama/Llama-3.1-8B-Instruct', name: 'HF Llama 3.1 8B', badge: '🤗 Active Free' }
              ]).map(m => (
                <option key={m.id} value={m.id}>
                  {m.badge ? `${m.name} (${m.badge})` : m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Chat Messages Container */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px'
      }}>
        {chatMessages.length === 0 && (
          <div style={{
            margin: 'auto',
            textAlign: 'center',
            maxWidth: '460px',
            padding: '24px 16px',
            color: 'var(--text-secondary)'
          }}>
            <div style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              background: 'var(--highlight-bg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px'
            }}>
              <Sparkles size={20} color="var(--theme-primary)" />
            </div>
            <h4 style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontSize: '0.96rem', fontWeight: 700 }}>
              AI Tutor Ready
            </h4>
            <p style={{ margin: '0 0 16px', fontSize: '0.8rem', lineHeight: '1.5' }}>
              Ask questions grounded in the lecture transcript, or click a quick prompt below:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                "Generate Summary for 30 mins read",
                "Create a summary for a 15 min read",
                "Explain key concepts and definitions",
                "Summarize main takeaways for an assignment"
              ].map((promptText) => (
                <button
                  key={promptText}
                  onClick={() => {
                    setChatInput(promptText);
                    chatInputRef.current?.focus();
                  }}
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    textAlign: 'left',
                    fontSize: '0.82rem',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--theme-primary)';
                    e.currentTarget.style.background = 'var(--panel-bg)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                    e.currentTarget.style.background = 'var(--card-bg)';
                  }}
                >
                  <span>{promptText}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--theme-primary)', fontWeight: 600 }}>Use prompt →</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {chatMessages.map((msg, idx) => {
          const currentMsgMode = msg.viewOverride || viewMode;
          const submissionText = submissionSummaries[msg.id] || msg.submission_text || cleanSubmissionFallback(msg.text);
          const submissionWords = submissionText ? submissionText.trim().split(/\s+/).filter(Boolean).length : 0;
          const isTargetRange = submissionWords >= 85 && submissionWords <= 155;

          return (
            <div
              key={msg.id || idx}
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%'
              }}
            >
              {msg.sender === 'bot' && (
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'var(--highlight-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px'
                }}>
                  <Bot size={16} color="var(--theme-primary)" />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '100%' }}>
                {/* Per-Message View Mode Toggle */}
                {msg.sender === 'bot' && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    marginBottom: '2px',
                    flexWrap: 'wrap'
                  }}>
                    <div style={{
                      display: 'inline-flex',
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      padding: '1px',
                      gap: '2px'
                    }}>
                      <button
                        onClick={() => {
                          setChatMessages(prev => prev.map((m, i) => (i === idx || m.id === msg.id) ? { ...m, viewOverride: 'learning' } : m));
                        }}
                        style={{
                          background: currentMsgMode === 'learning' ? 'var(--theme-primary)' : 'transparent',
                          color: currentMsgMode === 'learning' ? '#ffffff' : 'var(--text-secondary)',
                          border: 'none',
                          padding: '3px 8px',
                          borderRadius: '5px',
                          fontSize: '0.72rem',
                          fontWeight: currentMsgMode === 'learning' ? 700 : 500,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <BookOpen size={11} /> Learning View
                      </button>
                      <button
                        onClick={() => {
                          setChatMessages(prev => prev.map((m, i) => (i === idx || m.id === msg.id) ? { ...m, viewOverride: 'submission' } : m));
                        }}
                        style={{
                          background: currentMsgMode === 'submission' ? 'var(--theme-primary)' : 'transparent',
                          color: currentMsgMode === 'submission' ? '#ffffff' : 'var(--text-secondary)',
                          border: 'none',
                          padding: '3px 8px',
                          borderRadius: '5px',
                          fontSize: '0.72rem',
                          fontWeight: currentMsgMode === 'submission' ? 700 : 500,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <FileText size={11} /> Submission View
                      </button>
                    </div>

                    {currentMsgMode === 'submission' && (
                      <span style={{
                        fontSize: '0.7rem',
                        color: isTargetRange ? '#10b981' : 'var(--text-secondary)',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px'
                      }}>
                        {isTargetRange ? '✓' : '•'} {submissionWords} words (Target: 100–150)
                      </span>
                    )}
                  </div>
                )}

                {/* Main Message Bubble */}
                <div style={{
                  background: msg.sender === 'user' ? 'var(--theme-primary)' : 'var(--card-bg)',
                  color: msg.sender === 'user' ? '#ffffff' : 'var(--text-primary)',
                  padding: currentMsgMode === 'submission' && msg.sender === 'bot' ? '14px 16px' : '10px 14px',
                  borderRadius: '12px',
                  borderTopLeftRadius: msg.sender === 'bot' ? '2px' : '12px',
                  borderTopRightRadius: msg.sender === 'user' ? '2px' : '12px',
                  fontSize: '0.88rem',
                  lineHeight: '1.6',
                  border: msg.sender === 'bot' ? (currentMsgMode === 'submission' ? '1px solid rgba(0, 117, 237, 0.25)' : '1px solid var(--border-color)') : 'none',
                  boxShadow: currentMsgMode === 'submission' && msg.sender === 'bot' ? '0 2px 8px rgba(0, 117, 237, 0.08)' : '0 1px 3px rgba(0,0,0,0.06)'
                }}>
                  {msg.sender === 'user' ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                  ) : currentMsgMode === 'learning' ? (
                    <MarkdownWithTimestamps content={msg.text} onCueClick={handleCueClick} />
                  ) : (
                    /* Submission Mode View: Clean human academic prose */
                    <div>
                      <div style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--theme-primary)',
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}>
                        <FileText size={12} />
                        <span>Academic Assignment Submission (Graduate Tone)</span>
                      </div>
                      <div style={{
                        fontSize: '0.88rem',
                        lineHeight: '1.65',
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        whiteSpace: 'pre-wrap'
                      }}>
                        {submissionText || 'Generating condensed submission...'}
                      </div>
                    </div>
                  )}
                </div>

                {/* User Prompt Action Bar: Copy & Reuse */}
                {msg.sender === 'user' && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '6px',
                    marginTop: '2px'
                  }}>
                    <button
                      onClick={() => copyUserPrompt(msg.text, msg.id || idx)}
                      title="Copy prompt text to clipboard"
                      style={{
                        background: copiedPromptId === (msg.id || idx) ? 'rgba(16, 185, 129, 0.15)' : 'var(--card-bg)',
                        color: copiedPromptId === (msg.id || idx) ? '#10b981' : 'var(--text-secondary)',
                        border: '1px solid ' + (copiedPromptId === (msg.id || idx) ? '#10b981' : 'var(--border-color)'),
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {copiedPromptId === (msg.id || idx) ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copiedPromptId === (msg.id || idx) ? 'Copied!' : 'Copy'}</span>
                    </button>

                    <button
                      onClick={() => {
                        setChatInput(msg.text);
                        chatInputRef.current?.focus();
                      }}
                      title="Insert prompt back into input box"
                      style={{
                        background: 'var(--card-bg)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--theme-primary)';
                        e.currentTarget.style.borderColor = 'var(--theme-primary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--text-secondary)';
                        e.currentTarget.style.borderColor = 'var(--border-color)';
                      }}
                    >
                      <RefreshCw size={10} />
                      <span>Reuse</span>
                    </button>
                  </div>
                )}

                {/* Submission Mode Footer Bar: Word Count & 1-Click Copy */}
                {msg.sender === 'bot' && currentMsgMode === 'submission' && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 12px',
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    gap: '8px',
                    flexWrap: 'wrap'
                  }}>
                    <span style={{
                      color: isTargetRange ? '#10b981' : 'var(--text-secondary)',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {isTargetRange ? <CheckCircle2 size={12} color="#10b981" /> : <Clock size={12} />}
                      {submissionWords} words • Target: 100–150 words
                    </span>

                    <button
                      onClick={() => copySubmissionText(submissionText, msg.id)}
                      style={{
                        background: copiedSubmissionId === msg.id ? '#10b981' : 'var(--highlight-bg)',
                        color: copiedSubmissionId === msg.id ? '#ffffff' : 'var(--theme-primary)',
                        border: '1px solid ' + (copiedSubmissionId === msg.id ? '#10b981' : 'rgba(0, 117, 237, 0.3)'),
                        padding: '5px 12px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {copiedSubmissionId === msg.id ? <Check size={13} /> : <Copy size={13} />}
                      <span>{copiedSubmissionId === msg.id ? 'Copied to Clipboard!' : 'Copy for Submission'}</span>
                    </button>
                  </div>
                )}

                {/* Lecture Transcript Citations Pill Bar (Shown in Learning Mode) */}
                {msg.sender === 'bot' && currentMsgMode === 'learning' && msg.citations && msg.citations.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '8px 12px',
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    marginTop: '2px'
                  }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Clock size={12} color="var(--theme-primary)" /> Lecture Citations (Click to jump):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {msg.citations.map((cite, cIdx) => (
                        <button
                          key={cIdx}
                          onClick={(e) => {
                            e.preventDefault();
                            handleCueClick(cite.timestamp);
                          }}
                          title={cite.text ? `Jump to ${cite.timestamp}: "${cite.text}"` : `Jump to ${cite.timestamp}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: 'var(--card-bg)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--theme-primary)',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <Play size={10} style={{ fill: 'currentColor' }} />
                          <span>{cite.timestamp}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Model & Web Source Badges (Shown in Learning Mode) */}
                {msg.sender === 'bot' && currentMsgMode === 'learning' && (msg.model || (msg.web_sources && msg.web_sources.length > 0)) && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexWrap: 'wrap',
                    fontSize: '0.72rem',
                    color: 'var(--text-secondary)',
                    paddingLeft: '2px'
                  }}>
                    {msg.model && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'var(--highlight-bg)',
                        color: 'var(--theme-primary)',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontWeight: 600
                      }}>
                        <Zap size={10} /> {msg.model}
                      </span>
                    )}
                    {msg.web_sources && msg.web_sources.length > 0 && (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'rgba(16, 185, 129, 0.1)',
                        color: '#10b981',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontWeight: 600
                      }}>
                        <Globe size={10} /> {msg.web_sources.length} Web Sources Grounded
                      </span>
                    )}
                  </div>
                )}

                {/* Web References Links */}
                {msg.sender === 'bot' && msg.web_sources && msg.web_sources.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    padding: '6px 10px',
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '0.74rem'
                  }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Globe size={11} color="#10b981" /> Web References:
                    </div>
                    {msg.web_sources.map((src, sIdx) => (
                      <a
                        key={sIdx}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: 'var(--theme-primary)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={src.snippet || src.title}
                      >
                        <ExternalLink size={10} /> {src.title || src.url}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {msg.sender === 'user' && (
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px'
                }}>
                  <User size={15} color="var(--text-secondary)" />
                </div>
              )}
            </div>
          );
        })}

        {chatLoading && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: 'var(--highlight-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Bot size={16} color="var(--theme-primary)" />
            </div>
            <div style={{
              background: 'var(--card-bg)',
              padding: '8px 14px',
              borderRadius: '12px',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              border: '1px solid var(--border-color)'
            }}>
              <RefreshCw className="loading-pulse" size={14} /> Thinking...
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Simple Input Text Box */}
      <div style={{ padding: '12px 20px', background: 'var(--panel-bg)', borderTop: '1px solid var(--border-color)' }}>
        {/* Quick Prompt Suggestions Row */}
        <div style={{
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '8px',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none'
        }}>
          {[
            "Generate Summary for 30 mins read",
            "Create a summary for a 15 min read",
            "Explain key concepts and definitions",
            "Summarize core takeaways"
          ].map((pText) => (
            <button
              key={pText}
              onClick={() => {
                setChatInput(pText);
                chatInputRef.current?.focus();
              }}
              title="Click to insert this prompt"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '3px 10px',
                fontSize: '0.73rem',
                fontWeight: 500,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.15s ease',
                flexShrink: 0
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--theme-primary)';
                e.currentTarget.style.color = 'var(--theme-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <span>{pText}</span>
            </button>
          ))}
        </div>

        <div style={{
          display: 'flex',
          gap: '8px',
          background: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          padding: '6px 6px 6px 14px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
        }}>
          <input
            ref={chatInputRef}
            type="text"
            placeholder="Ask AI tutor anything about this lecture..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.9rem'
            }}
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={!chatInput.trim() || chatLoading}
            style={{
              background: 'var(--theme-primary)',
              color: '#ffffff',
              border: 'none',
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: !chatInput.trim() || chatLoading ? 'not-allowed' : 'pointer',
              opacity: !chatInput.trim() || chatLoading ? 0.4 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
