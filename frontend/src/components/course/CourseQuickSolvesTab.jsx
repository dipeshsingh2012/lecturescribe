import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
  Chip,
  TextField,
  InputAdornment,
  Dialog,
  DialogContent
} from '@mui/material';
import {
  Zap,
  Camera,
  Search,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react';
import { API_BASE } from '../../utils/constants';
import { formatRelativeTime } from '../../utils/formatters';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function CourseQuickSolvesTab({
  courseName = '',
  userEmail = '',
  currentTheme
}) {
  const [solves, setSolves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);

  const fetchCourseSolves = useCallback(async () => {
    if (!courseName) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        course_name: courseName,
        limit: '100'
      });
      if (userEmail && userEmail !== 'anonymous') {
        params.append('user_email', userEmail);
      }
      const res = await fetch(`${API_BASE}/api/quick-solve/history?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSolves(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn('Failed to load course quick solves:', err);
    } finally {
      setLoading(false);
    }
  }, [courseName, userEmail]);

  useEffect(() => {
    fetchCourseSolves();
  }, [fetchCourseSolves]);

  const handleOpenSolver = () => {
    window.dispatchEvent(
      new CustomEvent('open-quick-solver', {
        detail: { course: courseName }
      })
    );
  };

  const handleDeleteSolve = async (solveId, e) => {
    e?.stopPropagation();
    if (!window.confirm('Delete this solved question from cloud history?')) return;
    try {
      const params = userEmail ? `?user_email=${encodeURIComponent(userEmail)}` : '';
      await fetch(`${API_BASE}/api/quick-solve/history/${solveId}${params}`, {
        method: 'DELETE'
      });
      setSolves((prev) => prev.filter((s) => s.solve_id !== solveId));
    } catch (err) {
      console.error('Failed to delete solve:', err);
    }
  };

  const handleCopy = (solveId, text, e) => {
    e?.stopPropagation();
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedId(solveId);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const filteredSolves = solves.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (s.prompt || '').toLowerCase().includes(q) ||
      (s.final_answer || '').toLowerCase().includes(q) ||
      (s.detailed_solution || '').toLowerCase().includes(q)
    );
  });

  return (
    <Box
      data-testid="course-quick-solves-tab"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box'
      }}
    >
      {/* Header Row */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Zap size={22} style={{ fill: '#ffd700', stroke: '#ffd700' }} />
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 800, color: currentTheme?.palette?.textPrimary || '#fff', fontSize: '1.1rem' }}
          >
            Quick Solves & Exam Archive
          </Typography>
          <Chip
            label={solves.length}
            size="small"
            sx={{
              height: 22,
              fontSize: '0.75rem',
              fontWeight: 700,
              bgcolor: currentTheme?.palette?.badgeBg || 'rgba(0,117,237,0.15)',
              color: currentTheme?.palette?.primary || '#3b82f6'
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Refresh History">
            <IconButton
              size="small"
              onClick={fetchCourseSolves}
              disabled={loading}
              sx={{ color: currentTheme?.palette?.textSecondary || '#94a3b8' }}
            >
              <RotateCcw size={16} />
            </IconButton>
          </Tooltip>

          <Button
            variant="contained"
            size="small"
            startIcon={<Camera size={16} />}
            onClick={handleOpenSolver}
            sx={{
              textTransform: 'none',
              fontWeight: 800,
              fontSize: '0.82rem',
              borderRadius: 2,
              bgcolor: currentTheme?.palette?.primary || '#0075ed',
              color: '#fff',
              boxShadow: '0 2px 10px rgba(0, 117, 237, 0.35)',
              '&:hover': {
                bgcolor: currentTheme?.palette?.primaryHover || '#005bb5'
              }
            }}
          >
            ⚡ Snap & Solve Question
          </Button>
        </Box>
      </Box>

      {/* Search Input */}
      {solves.length > 0 && (
        <TextField
          size="small"
          placeholder="Search solved problems, formulas, or answers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} color={currentTheme?.palette?.textSecondary || '#94a3b8'} />
                </InputAdornment>
              ),
              sx: {
                borderRadius: 2,
                fontSize: '0.85rem',
                bgcolor: currentTheme?.palette?.cardBg || '#181b22',
                color: currentTheme?.palette?.textPrimary || '#fff',
                '& fieldset': {
                  borderColor: currentTheme?.palette?.cardBorder || '#2d3340'
                }
              }
            }
          }}
          sx={{ maxWidth: 440 }}
        />
      )}

      {/* Loading Indicator */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={32} sx={{ color: currentTheme?.palette?.primary || '#0075ed' }} />
        </Box>
      )}

      {/* Empty State */}
      {!loading && solves.length === 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 5,
            textAlign: 'center',
            borderRadius: 3,
            border: `1.5px dashed ${currentTheme?.palette?.cardBorder || '#2d3340'}`,
            bgcolor: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2
          }}
        >
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              bgcolor: 'rgba(255, 215, 0, 0.12)',
              color: '#ffd700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Zap size={28} style={{ fill: '#ffd700' }} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme?.palette?.textPrimary || '#fff' }}>
              No Handwritten Solves for {courseName || 'this course'}
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: currentTheme?.palette?.textSecondary || '#94a3b8', mt: 0.5, maxWidth: 460 }}
            >
              Snap a picture of a handwritten equation, textbook problem, or exam MCQ using the button above to get sub-second AI answers and step-by-step derivations saved to this course.
            </Typography>
          </Box>
        </Paper>
      )}

      {/* Cards List */}
      {!loading && filteredSolves.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {filteredSolves.map((item) => {
            const isExpanded = expandedId === item.solve_id;
            const isCopied = copiedId === item.solve_id;

            return (
              <Paper
                key={item.solve_id}
                elevation={0}
                sx={{
                  p: 2.2,
                  borderRadius: 2.5,
                  border: `1px solid ${currentTheme?.palette?.cardBorder || '#2d3340'}`,
                  bgcolor: currentTheme?.palette?.cardBg || '#181b22',
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: 2,
                  transition: 'border-color 0.15s ease',
                  '&:hover': {
                    borderColor: currentTheme?.palette?.primary || '#0075ed'
                  }
                }}
              >
                {/* Thumbnail */}
                {item.image_data && (
                  <Box
                    onClick={() => setPreviewImage(item.image_data)}
                    sx={{
                      width: { xs: '100%', sm: 110 },
                      height: { xs: 140, sm: 110 },
                      minWidth: { sm: 110 },
                      borderRadius: 2,
                      overflow: 'hidden',
                      bgcolor: '#000',
                      cursor: 'pointer',
                      position: 'relative',
                      border: '1px solid rgba(255,255,255,0.08)',
                      '&:hover .thumb-overlay': { opacity: 1 }
                    }}
                  >
                    <img
                      src={item.image_data}
                      alt="Question snippet"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <Box
                      className="thumb-overlay"
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        bgcolor: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: 0,
                        transition: 'opacity 0.15s ease',
                        color: '#fff'
                      }}
                    >
                      <ImageIcon size={18} />
                    </Box>
                  </Box>
                )}

                {/* Content */}
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Top Meta Row */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Chip
                        label={item.course_name || courseName}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          bgcolor: 'rgba(0,117,237,0.12)',
                          color: currentTheme?.palette?.primary || '#3b82f6'
                        }}
                      />
                      <Typography
                        variant="caption"
                        sx={{ color: currentTheme?.palette?.textSecondary || '#94a3b8' }}
                      >
                        {formatRelativeTime(item.created_at)}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Tooltip title="Copy Answer">
                        <IconButton
                          size="small"
                          onClick={(e) => handleCopy(item.solve_id, item.final_answer, e)}
                          sx={{ color: isCopied ? '#10b981' : currentTheme?.palette?.textSecondary || '#94a3b8' }}
                        >
                          {isCopied ? <Check size={16} /> : <Copy size={16} />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          onClick={(e) => handleDeleteSolve(item.solve_id, e)}
                          sx={{ color: '#ef4444' }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>

                  {/* Optional Prompt */}
                  {item.prompt && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: currentTheme?.palette?.textSecondary || '#94a3b8',
                        fontStyle: 'italic',
                        display: 'block'
                      }}
                    >
                      "{item.prompt}"
                    </Typography>
                  )}

                  {/* Final Answer */}
                  <Box
                    sx={{
                      p: 1.5,
                      borderRadius: 1.5,
                      bgcolor: 'rgba(0, 117, 237, 0.08)',
                      border: '1px solid rgba(0, 117, 237, 0.25)',
                      fontSize: '0.92rem',
                      color: currentTheme?.palette?.textPrimary || '#fff'
                    }}
                  >
                    <MarkdownWithTimestamps content={item.final_answer} />
                  </Box>

                  {/* Step-by-Step Toggle */}
                  {item.detailed_solution && (
                    <Box sx={{ mt: 0.5 }}>
                      <Button
                        size="small"
                        startIcon={isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        onClick={() => setExpandedId(isExpanded ? null : item.solve_id)}
                        sx={{
                          textTransform: 'none',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: currentTheme?.palette?.textSecondary || '#94a3b8',
                          p: 0
                        }}
                      >
                        {isExpanded ? 'Hide Steps' : 'View Step-by-Step Derivation'}
                      </Button>

                      {isExpanded && (
                        <Box
                          sx={{
                            mt: 1,
                            p: 1.8,
                            borderRadius: 1.5,
                            bgcolor: 'rgba(0,0,0,0.2)',
                            border: `1px solid ${currentTheme?.palette?.cardBorder || '#2d3340'}`,
                            fontSize: '0.85rem',
                            lineHeight: 1.6,
                            color: currentTheme?.palette?.textPrimary || '#fff'
                          }}
                        >
                          <MarkdownWithTimestamps content={item.detailed_solution} />
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      {/* Lightbox Image Preview Dialog */}
      <Dialog
        open={Boolean(previewImage)}
        onClose={() => setPreviewImage(null)}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: '#111',
            borderRadius: 3,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)'
          }
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
          <IconButton onClick={() => setPreviewImage(null)} sx={{ color: '#fff' }}>
            <X size={20} />
          </IconButton>
        </Box>
        <DialogContent sx={{ p: 2, pt: 0, display: 'flex', justifyContent: 'center' }}>
          {previewImage && (
            <img
              src={previewImage}
              alt="Enlarged preview"
              style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain', borderRadius: 8 }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
