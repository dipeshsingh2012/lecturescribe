import React from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  IconButton,
  Tooltip,
  CircularProgress,
  Chip,
  Paper,
  Alert
} from '@mui/material';
import {
  Sparkles,
  Send,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  Play,
  Clock,
  BookOpen,
  HelpCircle,
  GraduationCap
} from 'lucide-react';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

const STARTER_PROMPTS = [
  {
    title: "Course Overview & Core Themes",
    prompt: "What are the core concepts and fundamental themes covered across all lectures in this course?"
  },
  {
    title: "Exam Preparation Sheet",
    prompt: "Synthesize a high-yield formula and definition revision sheet for my upcoming exam based on the lectures."
  },
  {
    title: "Compare Methodologies",
    prompt: "Compare the main algorithms and methodologies discussed across different lectures in this course."
  },
  {
    title: "Conceptual Practice Questions",
    prompt: "Generate 3 challenging conceptual practice questions with step-by-step explanations to test my exam readiness."
  }
];

export default function CourseTutor({
  courseName,
  lectureCount = 0,
  messages = [],
  input = '',
  setInput = () => {},
  loading = false,
  error = null,
  sendMessage = () => {},
  clearHistory = () => {},
  deleteMessage = () => {},
  copyText = () => {},
  copiedPromptId = null,
  copiedResponseId = null,
  chatEndRef,
  chatInputRef,
  handleSelectLecture = () => {},
  currentTheme
}) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)', minHeight: '600px', gap: 2 }}>
      {/* Header Bar */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, var(--theme-primary) 0%, #3b82f6 100%)',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(0, 117, 237, 0.25)'
            }}
          >
            <Sparkles size={20} />
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.05rem', color: currentTheme.palette.textPrimary }}>
                Course AI Tutor
              </Typography>
              <Chip
                label={`${lectureCount} ${lectureCount === 1 ? 'lecture' : 'lectures'} indexed`}
                size="small"
                sx={{
                  height: 22,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  bgcolor: currentTheme.palette.badgeBg,
                  color: currentTheme.palette.badgeColor,
                  border: `1px solid ${currentTheme.palette.badgeBorder}`
                }}
              />
            </Box>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: currentTheme.palette.textSecondary }}>
              Grounded in all lecture transcripts and course syllabus for <strong>{courseName}</strong>
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {messages.length > 0 && (
            <Tooltip title="Clear Course Chat History">
              <Button
                variant="outlined"
                size="small"
                startIcon={<Trash2 size={14} />}
                onClick={clearHistory}
                sx={{
                  textTransform: 'none',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  borderRadius: 2,
                  color: '#ef4444',
                  borderColor: 'rgba(239, 68, 68, 0.3)',
                  '&:hover': {
                    borderColor: '#ef4444',
                    bgcolor: 'rgba(239, 68, 68, 0.08)'
                  }
                }}
              >
                Clear Chat
              </Button>
            </Tooltip>
          )}
        </Box>
      </Paper>

      {/* Chat Messages Body */}
      <Paper
        elevation={0}
        sx={{
          flex: 1,
          p: { xs: 1.5, sm: 2.5 },
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5
        }}
      >
        {messages.length === 0 ? (
          /* Empty State with Starter Prompts */
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              my: 'auto',
              py: 4,
              textAlign: 'center',
              maxWidth: 680,
              mx: 'auto'
            }}
          >
            <Box
              sx={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                bgcolor: 'rgba(0, 117, 237, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: currentTheme.palette.primary,
                mb: 2
              }}
            >
              <GraduationCap size={32} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 800, mb: 1, color: currentTheme.palette.textPrimary }}>
              Ask anything about {courseName}
            </Typography>
            <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, mb: 3.5, maxWidth: 520, fontSize: '0.88rem' }}>
              Your tutor has synthesized all {lectureCount} lectures in this course. Ask questions across lectures,
              clarify derivations, or prepare for exams with grounded citations.
            </Typography>

            <Box sx={{ width: '100%', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
              {STARTER_PROMPTS.map((item, idx) => (
                <Button
                  key={idx}
                  variant="outlined"
                  onClick={() => sendMessage(item.prompt)}
                  disabled={loading}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    textAlign: 'left',
                    justifyContent: 'flex-start',
                    alignItems: 'flex-start',
                    flexDirection: 'column',
                    borderColor: currentTheme.palette.cardBorder,
                    bgcolor: 'var(--highlight-bg)',
                    textTransform: 'none',
                    '&:hover': {
                      borderColor: currentTheme.palette.primary,
                      bgcolor: 'rgba(0, 117, 237, 0.05)'
                    }
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.82rem', color: currentTheme.palette.textPrimary, mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.8 }}>
                    <Sparkles size={13} color="var(--theme-primary)" /> {item.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontSize: '0.74rem', lineHeight: 1.4 }}>
                    {item.prompt}
                  </Typography>
                </Button>
              ))}
            </Box>
          </Box>
        ) : (
          /* Render Messages */
          messages.map((msg, idx) => (
            <Box
              key={msg.id || idx}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                width: '100%'
              }}
            >
              {msg.sender === 'user' ? (
                /* User Message Bubble */
                <Box sx={{ maxWidth: { xs: '90%', sm: '75%' } }}>
                  <Box
                    sx={{
                      p: 1.5,
                      px: 2,
                      borderRadius: '16px 16px 2px 16px',
                      bgcolor: currentTheme.palette.primary,
                      color: '#fff',
                      fontSize: '0.9rem',
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                      boxShadow: '0 2px 8px rgba(0, 117, 237, 0.2)'
                    }}
                  >
                    {msg.text}
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 0.5 }}>
                    <Button
                      size="small"
                      onClick={() => copyText(msg.text, msg.id || idx, false)}
                      startIcon={copiedPromptId === (msg.id || idx) ? <Check size={11} /> : <Copy size={11} />}
                      sx={{
                        textTransform: 'none',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        p: '2px 8px',
                        minWidth: 0,
                        color: copiedPromptId === (msg.id || idx) ? '#10b981' : currentTheme.palette.textSecondary
                      }}
                    >
                      {copiedPromptId === (msg.id || idx) ? 'Copied' : 'Copy'}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setInput(msg.text);
                        chatInputRef.current?.focus();
                      }}
                      startIcon={<RefreshCw size={11} />}
                      sx={{
                        textTransform: 'none',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        p: '2px 8px',
                        minWidth: 0,
                        color: currentTheme.palette.textSecondary
                      }}
                    >
                      Reuse
                    </Button>
                  </Box>
                </Box>
              ) : (
                /* AI Bot Message Bubble */
                <Box sx={{ maxWidth: { xs: '95%', sm: '88%' }, width: '100%' }}>
                  <Box
                    sx={{
                      p: { xs: 2, sm: 2.5 },
                      borderRadius: '16px 16px 16px 2px',
                      bgcolor: 'var(--highlight-bg)',
                      border: `1px solid ${currentTheme.palette.cardBorder}`,
                      fontSize: '0.9rem',
                      lineHeight: 1.6,
                      color: currentTheme.palette.textPrimary,
                      wordBreak: 'break-word'
                    }}
                  >
                    <MarkdownWithTimestamps
                      content={msg.text}
                      citations={msg.citations || []}
                      onCrossLectureClick={(vid, ts, vTitle) => handleSelectLecture(vid, courseName, ts)}
                    />

                    {/* Citations block */}
                    {msg.citations && msg.citations.length > 0 && (
                      <Box
                        sx={{
                          mt: 2,
                          pt: 1.5,
                          borderTop: `1px dashed ${currentTheme.palette.cardBorder}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, color: currentTheme.palette.textSecondary, fontSize: '0.76rem', fontWeight: 700 }}>
                          <Clock size={13} color="var(--theme-primary)" /> Lecture Citations (Click to jump):
                        </Box>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                          {msg.citations.map((cite, cIdx) => (
                            <Button
                              key={cIdx}
                              size="small"
                              variant="outlined"
                              startIcon={<Play size={10} style={{ fill: 'currentColor' }} />}
                              onClick={() => handleSelectLecture(cite.video_id, courseName, cite.timestamp)}
                              title={cite.text ? `[${cite.video_title || 'Lecture'}] ${cite.timestamp}: "${cite.text}"` : `Jump to ${cite.video_title || 'Lecture'} at ${cite.timestamp}`}
                              sx={{
                                textTransform: 'none',
                                fontSize: '0.74rem',
                                fontWeight: 700,
                                borderRadius: 1.5,
                                py: '2px',
                                px: 1,
                                color: currentTheme.palette.primary,
                                borderColor: 'rgba(0, 117, 237, 0.3)',
                                bgcolor: 'rgba(0, 117, 237, 0.05)',
                                '&:hover': {
                                  bgcolor: 'rgba(0, 117, 237, 0.12)',
                                  borderColor: currentTheme.palette.primary
                                }
                              }}
                            >
                              {cite.video_title ? `${cite.video_title.length > 25 ? cite.video_title.slice(0, 23) + '…' : cite.video_title} [${cite.timestamp}]` : cite.timestamp}
                            </Button>
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>

                  {/* Bot Actions */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5, pl: 0.5 }}>
                    <Button
                      size="small"
                      onClick={() => copyText(msg.text, msg.id || idx, true)}
                      startIcon={copiedResponseId === (msg.id || idx) ? <Check size={11} color="#10b981" /> : <Copy size={11} />}
                      sx={{
                        textTransform: 'none',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        p: '2px 8px',
                        minWidth: 0,
                        color: copiedResponseId === (msg.id || idx) ? '#10b981' : currentTheme.palette.textSecondary
                      }}
                    >
                      {copiedResponseId === (msg.id || idx) ? 'Copied' : 'Copy'}
                    </Button>
                    {msg.model && (
                      <Typography variant="caption" sx={{ fontSize: '0.7rem', color: currentTheme.palette.textSecondary, opacity: 0.8 }}>
                        Generated by {msg.model}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          ))
        )}

        {/* Error Alert */}
        {error && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        {/* Loading Spinner Indicator */}
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, color: currentTheme.palette.textSecondary }}>
            <CircularProgress size={18} thickness={5} sx={{ color: currentTheme.palette.primary }} />
            <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
              Course AI Tutor is searching lecture transcripts and synthesizing an answer...
            </Typography>
          </Box>
        )}

        <div ref={chatEndRef} />
      </Paper>

      {/* Input Bar */}
      <Paper
        elevation={0}
        sx={{
          p: 1.5,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 1.5
        }}
      >
        <TextField
          inputRef={chatInputRef}
          fullWidth
          multiline
          maxRows={4}
          placeholder={`Ask anything about ${courseName} (e.g. explain a concept, compare lectures, exam formulas)...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          slotProps={{
            input: {
              sx: {
                fontSize: '0.9rem',
                color: currentTheme.palette.textPrimary,
                p: '6px 12px',
                '& fieldset': { border: 'none' }
              }
            }
          }}
        />
        <Button
          variant="contained"
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          sx={{
            minWidth: 44,
            height: 44,
            borderRadius: 2.5,
            bgcolor: currentTheme.palette.primary,
            color: '#fff',
            p: 0,
            '&:hover': {
              bgcolor: 'var(--theme-primary-hover, #005ecb)'
            },
            '&.Mui-disabled': {
              bgcolor: 'rgba(0, 117, 237, 0.3)',
              color: '#fff'
            }
          }}
          aria-label="Send query"
        >
          {loading ? <CircularProgress size={18} color="inherit" /> : <Send size={18} />}
        </Button>
      </Paper>
    </Box>
  );
}
