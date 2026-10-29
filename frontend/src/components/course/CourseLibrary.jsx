import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip
} from '@mui/material';
import {
  BookOpen,
  Presentation,
  Paperclip,
  Video,
  ExternalLink,
  Download,
  Trash2,
  Upload,
  Eye,
  Edit2,
  Check,
  X,
  Sparkles,
  Globe,
  Search,
  BookMarked,
  CheckCircle,
  FileText,
  RotateCw,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { formatRelativeTime, formatBytes, getFileTypeBadge } from '../../utils/formatters';
import { normalizeCourseSlug } from '../../utils/routing';
import BookReaderModal from '../modals/BookReaderModal';
import ResearchLiteratureModal from '../modals/ResearchLiteratureModal';

const DEFAULT_SECTION_ORDER = ['notes', 'slides', 'books'];

export default function CourseLibrary({
  courseResourcesLoading = false,
  courseResources = [],
  courseReadings = [],
  courseReadingsLoading = false,
  courseNotes = [],
  courseNotesLoading = false,
  onCreateNewNote,
  onOpenNote,
  onDeleteNote,
  isExtractingReadings = false,
  triggerExtractReadings,
  handleRefreshReadingReader,
  handleDeleteCourseReading,
  searchReadingWeb,
  searchLiterature,
  addCourseReading,
  googleUser,
  userLibrary = [],
  selectedCourse,
  activeCourseData,
  openUploadModal,
  handleDeleteResource,
  handleRenameResource,
  openPreviewModal,
  currentTheme
}) {
  const [editingResourceId, setEditingResourceId] = useState(null);
  const [renameTitleInput, setRenameTitleInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  const startRenaming = (res) => {
    setEditingResourceId(res.id);
    setRenameTitleInput(res.title || res.filename || '');
  };

  const cancelRenaming = () => {
    setEditingResourceId(null);
    setRenameTitleInput('');
  };

  const saveRename = async (resId) => {
    if (!renameTitleInput.trim() || !handleRenameResource) {
      cancelRenaming();
      return;
    }
    setIsRenaming(true);
    try {
      await handleRenameResource(resId, renameTitleInput.trim());
      setEditingResourceId(null);
    } finally {
      setIsRenaming(false);
    }
  };

  const [researchModalOpen, setResearchModalOpen] = useState(false);
  const [webSearchOpen, setWebSearchOpen] = useState(false);
  const [activeSearchBook, setActiveSearchBook] = useState(null);
  const [customWebQuery, setCustomWebQuery] = useState('');
  const [webSearchResults, setWebSearchResults] = useState([]);
  const [webSearchLoading, setWebSearchLoading] = useState(false);
  const [extractSuccessMsg, setExtractSuccessMsg] = useState('');
  const [activeReaderBook, setActiveReaderBook] = useState(null);
  const [refreshingReadingId, setRefreshingReadingId] = useState(null);

  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('lecturescribe_library_collapsed') : null;
      return saved ? JSON.parse(saved) : { notes: false, slides: false, books: false };
    } catch {
      return { notes: false, slides: false, books: false };
    }
  });

  const [sectionOrder, setSectionOrder] = useState(() => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem('lecturescribe_library_order') : null;
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed) && parsed.length === 3) return parsed;
    } catch {
      // ignore
    }
    return DEFAULT_SECTION_ORDER;
  });

  const toggleSectionCollapse = (key) => {
    setCollapsedSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem('lecturescribe_library_collapsed', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const moveSectionOrder = (key, direction) => {
    setSectionOrder(prev => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const next = [...prev];
      if (direction === 'top') {
        next.splice(idx, 1);
        next.unshift(key);
      } else {
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= next.length) return prev;
        [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      }
      try {
        window.localStorage.setItem('lecturescribe_library_order', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleFocusAcademicBooks = () => {
    const nextCollapsed = { notes: true, slides: true, books: false };
    setCollapsedSections(nextCollapsed);
    try {
      window.localStorage.setItem('lecturescribe_library_collapsed', JSON.stringify(nextCollapsed));
    } catch {
      // ignore
    }
  };

  const handleExpandAllSections = () => {
    const nextCollapsed = { notes: false, slides: false, books: false };
    setCollapsedSections(nextCollapsed);
    try {
      window.localStorage.setItem('lecturescribe_library_collapsed', JSON.stringify(nextCollapsed));
    } catch {
      // ignore
    }
  };

  const courseDisplayName = activeCourseData?.course_name || selectedCourse || 'Course Library';
  const exactCourseSlug =
    activeCourseData?.course_slug ||
    (activeCourseData?.course_name ? normalizeCourseSlug(activeCourseData.course_name) : normalizeCourseSlug(selectedCourse));

  // Trigger book extraction (incremental or full regeneration)
  const handleExtractClick = async (regenerate = false) => {
    if (!triggerExtractReadings) return;
    setExtractSuccessMsg('');
    const res = await triggerExtractReadings(exactCourseSlug || courseDisplayName, regenerate);
    if (res && res.status === 'success') {
      const added = res.newly_extracted_count || 0;
      setExtractSuccessMsg(
        regenerate
          ? `Regeneration complete! Extracted and verified ${res.count || 0} books afresh.`
          : added > 0
            ? `Discovered ${added} new recommended reading${added > 1 ? 's' : ''}!`
            : `Scan complete! All current readings are up to date (${res.count || 0} books found).`
      );
      setTimeout(() => setExtractSuccessMsg(''), 6000);
    }
  };

  // Re-resolve digital reader link dynamically for a single book
  const handleRefreshSingleReader = async (bookId) => {
    if (!handleRefreshReadingReader || !bookId) return;
    setRefreshingReadingId(bookId);
    try {
      await handleRefreshReadingReader(bookId);
    } finally {
      setRefreshingReadingId(null);
    }
  };

  // Open web search / scraper modal for a specific book
  const handleOpenWebSearch = async (book) => {
    setActiveSearchBook(book);
    const query = `${book.title} ${book.author || ''} textbook pdf`.trim();
    setCustomWebQuery(query);
    setWebSearchOpen(true);
    setWebSearchLoading(true);
    if (searchReadingWeb) {
      const results = await searchReadingWeb(book.title, book.author, courseDisplayName);
      setWebSearchResults(results || []);
    }
    setWebSearchLoading(false);
  };

  // Run custom query inside modal
  const handleRunCustomWebSearch = async () => {
    if (!customWebQuery.trim() || !searchReadingWeb) return;
    setWebSearchLoading(true);
    const results = await searchReadingWeb(customWebQuery, '', courseDisplayName);
    setWebSearchResults(results || []);
    setWebSearchLoading(false);
  };

  const getReadingCategoryBadge = (cat) => {
    const c = (cat || 'recommended').toLowerCase();
    if (c.includes('primary') || c.includes('textbook')) {
      return { label: 'Primary Textbook', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' };
    }
    if (c.includes('journal') || c.includes('paper')) {
      return { label: 'Journal / Paper', bg: 'rgba(168, 85, 247, 0.15)', color: '#a855f7', border: 'rgba(168, 85, 247, 0.3)' };
    }
    return { label: 'Reference / Reading', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: 'rgba(16, 185, 129, 0.3)' };
  };

  const renderSectionOrderControls = (secKey) => {
    const idx = sectionOrder.indexOf(secKey);
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title="Move section up">
          <span>
            <IconButton
              size="small"
              data-testid={`move-up-${secKey}`}
              aria-label={`Move ${secKey} section up`}
              disabled={idx <= 0}
              onClick={(e) => {
                e.stopPropagation();
                moveSectionOrder(secKey, 'up');
              }}
              sx={{ p: 0.4, color: currentTheme.palette.textSecondary }}
            >
              <ArrowUp size={14} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Move section down">
          <span>
            <IconButton
              size="small"
              data-testid={`move-down-${secKey}`}
              aria-label={`Move ${secKey} section down`}
              disabled={idx === sectionOrder.length - 1}
              onClick={(e) => {
                e.stopPropagation();
                moveSectionOrder(secKey, 'down');
              }}
              sx={{ p: 0.4, color: currentTheme.palette.textSecondary }}
            >
              <ArrowDown size={14} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    );
  };

  const sectionMap = {
    notes: (
      /* ========================================================================= */
      /* SECTION 0: COURSE NOTES & SCRATCHPADS (MINI DROPBOX) */
      /* ========================================================================= */
      <Box key="notes" data-testid="library-section-notes" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box
            onClick={() => toggleSectionCollapse('notes')}
            data-testid="toggle-section-notes"
            role="button"
            aria-expanded={!collapsedSections.notes}
            aria-label="Toggle My Notes & Scratchpads section"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none' }}
          >
            {collapsedSections.notes ? <ChevronRight size={18} color={currentTheme.palette.textSecondary} /> : <ChevronDown size={18} color={currentTheme.palette.textSecondary} />}
            <FileText size={20} color={currentTheme.palette.primary} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
              My Notes & Scratchpads
            </Typography>
            <Chip
              label={courseNotes.length}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.72rem',
                fontWeight: 700,
                bgcolor: currentTheme.palette.badgeBg,
                color: currentTheme.palette.textSecondary
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {googleUser && onCreateNewNote && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<Plus size={13} />}
                onClick={onCreateNewNote}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.74rem',
                  borderRadius: 2,
                  borderColor: currentTheme.palette.cardBorder,
                  color: currentTheme.palette.primary,
                  bgcolor: currentTheme.palette.cardBg,
                  '&:hover': { borderColor: currentTheme.palette.primary, bgcolor: 'var(--highlight-bg)' }
                }}
              >
                New Note
              </Button>
            )}
            {renderSectionOrderControls('notes')}
            <Button
              size="small"
              onClick={() => toggleSectionCollapse('notes')}
              sx={{ textTransform: 'none', fontSize: '0.74rem', fontWeight: 600, color: currentTheme.palette.textSecondary }}
            >
              {collapsedSections.notes ? 'Expand' : 'Collapse'}
            </Button>
          </Box>
        </Box>
        {!collapsedSections.notes && (courseNotesLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} sx={{ color: currentTheme.palette.primary, mr: 1.5 }} />
            <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
              Loading notes...
            </Typography>
          </Box>
        ) : courseNotes.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: 3,
              textAlign: 'center',
              bgcolor: currentTheme.palette.cardBg,
              border: `1px dashed ${currentTheme.palette.cardBorder}`,
              borderRadius: 3
            }}
          >
            <FileText size={32} color={currentTheme.palette.primary} style={{ margin: '0 auto 8px', opacity: 0.8 }} />
            <Typography variant="subtitle2" sx={{ color: currentTheme.palette.textPrimary, fontWeight: 700, mb: 0.5 }}>
              No Notes Created Yet
            </Typography>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, display: 'block', maxWidth: 420, mx: 'auto', mb: 1.5 }}>
              Create a scratchpad to jot down quick notes, lecture reflections, or your M.Tech project outline.
            </Typography>
            {googleUser && onCreateNewNote && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<Plus size={14} />}
                onClick={onCreateNewNote}
                sx={{
                  bgcolor: currentTheme.palette.cardBg,
                  color: currentTheme.palette.primary,
                  borderColor: currentTheme.palette.cardBorder,
                  fontWeight: 700,
                  textTransform: 'none',
                  borderRadius: 2
                }}
              >
                Create First Note
              </Button>
            )}
          </Paper>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 1.5 }}>
            {courseNotes.map((note) => (
              <Paper
                key={note.note_id}
                elevation={0}
                sx={{
                  p: 2,
                  borderRadius: 2.5,
                  bgcolor: currentTheme.palette.cardBg,
                  border: `1px solid ${currentTheme.palette.cardBorder}`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 1.5,
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  '&:hover': {
                    borderColor: currentTheme.palette.primary,
                    boxShadow: currentTheme.palette.cardShadow,
                    transform: 'translateY(-2px)'
                  }
                }}
                onClick={() => onOpenNote && onOpenNote(note)}
              >
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Box
                      sx={{
                        px: 1,
                        py: 0.3,
                        borderRadius: 1.5,
                        fontWeight: 800,
                        fontSize: '0.68rem',
                        letterSpacing: '0.5px',
                        bgcolor: 'rgba(16, 185, 129, 0.12)',
                        color: '#10b981'
                      }}
                    >
                      TXT
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
                      {onDeleteNote && (
                        <Tooltip title="Delete note">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`Delete "${note.title || 'Untitled Note'}"?`)) {
                                onDeleteNote(note.note_id);
                              }
                            }}
                            sx={{
                              color: currentTheme.palette.textSecondary,
                              p: 0.5,
                              '&:hover': { color: '#ef4444' }
                            }}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                  <Typography
                    variant="subtitle2"
                    sx={{
                      fontWeight: 700,
                      color: currentTheme.palette.textPrimary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {note.title || 'Untitled Note'}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1, borderTop: `1px solid ${currentTheme.palette.cardBorder}` }}>
                  <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontSize: '0.72rem' }}>
                    {formatRelativeTime(note.updated_at || note.created_at)}
                  </Typography>
                  <Button
                    size="small"
                    sx={{
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      textTransform: 'none',
                      color: currentTheme.palette.primary,
                      p: 0,
                      minWidth: 0
                    }}
                  >
                    Open →
                  </Button>
                </Box>
              </Paper>
            ))}
          </Box>
        ))}
      </Box>
    ),
    slides: (
      /* ========================================================================= */
      /* SECTION 1: LECTURE SLIDES & PRESENTATION DECKS */
      /* ========================================================================= */
      <Box key="slides" data-testid="library-section-slides" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box
            onClick={() => toggleSectionCollapse('slides')}
            data-testid="toggle-section-slides"
            role="button"
            aria-expanded={!collapsedSections.slides}
            aria-label="Toggle Lecture Slides & Decks section"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none' }}
          >
            {collapsedSections.slides ? <ChevronRight size={18} color={currentTheme.palette.textSecondary} /> : <ChevronDown size={18} color={currentTheme.palette.textSecondary} />}
            <Presentation size={20} color={currentTheme.palette.primary} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
              Lecture Slides & Decks
            </Typography>
            <Chip
              label={courseResources.length}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.72rem',
                fontWeight: 700,
                bgcolor: currentTheme.palette.badgeBg,
                color: currentTheme.palette.textSecondary
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, display: { xs: 'none', sm: 'inline' } }}>
              PowerPoints and PDFs used by the professor during lectures
            </Typography>
            {renderSectionOrderControls('slides')}
            <Button
              size="small"
              onClick={() => toggleSectionCollapse('slides')}
              sx={{ textTransform: 'none', fontSize: '0.74rem', fontWeight: 600, color: currentTheme.palette.textSecondary }}
            >
              {collapsedSections.slides ? 'Expand' : 'Collapse'}
            </Button>
          </Box>
        </Box>

        {!collapsedSections.slides && (courseResourcesLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} sx={{ color: currentTheme.palette.primary, mr: 1.5 }} />
            <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
              Loading course materials...
            </Typography>
          </Box>
        ) : courseResources.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: 4,
              textAlign: 'center',
              bgcolor: currentTheme.palette.cardBg,
              border: `1px dashed ${currentTheme.palette.cardBorder}`,
              borderRadius: 3
            }}
          >
            <Presentation size={36} color={currentTheme.palette.primary} style={{ margin: '0 auto 10px', opacity: 0.85 }} />
            <Typography variant="subtitle1" sx={{ color: currentTheme.palette.textPrimary, fontWeight: 700, mb: 0.5 }}>
              No Course Materials Yet
            </Typography>
            <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, maxWidth: 420, mx: 'auto', mb: 2 }}>
              Upload PowerPoint (.pptx) or PDF presentation slides used by the professor for this course.
            </Typography>
            {googleUser && typeof openUploadModal === 'function' && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<Upload size={14} />}
                onClick={() => openUploadModal({
                  courseName: courseDisplayName,
                  videoId: null
                })}
                sx={{
                  bgcolor: currentTheme.palette.cardBg,
                  color: currentTheme.palette.primary,
                  borderColor: currentTheme.palette.cardBorder,
                  fontWeight: 700,
                  textTransform: 'none',
                  borderRadius: 2
                }}
              >
                Upload First Presentation Deck
              </Button>
            )}
          </Paper>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {courseResources.map((res) => {
              const badge = getFileTypeBadge(res.file_type, res.filename);
              const isOwner = googleUser?.email && res.user_email?.toLowerCase() === googleUser.email.toLowerCase();
              const associatedLecture = res.video_id
                ? (userLibrary.find(l => l.video_id === res.video_id)?.video_title || `Lecture ${res.video_id}`)
                : null;
              const ft = (res.file_type || res.filename?.split('.').pop() || '').toLowerCase();
              const isLink = ft === 'link' || ft === 'gdrive' || ft === 'drive' || ft === 'url';

              return (
                <Paper
                  key={res.id}
                  elevation={0}
                  sx={{
                    p: 2,
                    borderRadius: 2.5,
                    bgcolor: currentTheme.palette.cardBg,
                    border: `1px solid ${currentTheme.palette.cardBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 2,
                    transition: 'all 0.2s ease',
                    '&:hover': { borderColor: currentTheme.palette.primary, boxShadow: currentTheme.palette.cardShadow }
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1 }}>
                    <Box sx={{
                      px: 1.2,
                      py: 0.5,
                      borderRadius: 1.5,
                      fontWeight: 800,
                      fontSize: '0.72rem',
                      letterSpacing: '0.5px',
                      bgcolor: badge.bg,
                      color: badge.color,
                      flexShrink: 0
                    }}>
                      {badge.label}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      {editingResourceId === res.id ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 0.5 }}>
                          <TextField
                            size="small"
                            autoFocus
                            value={renameTitleInput}
                            onChange={(e) => setRenameTitleInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveRename(res.id);
                              if (e.key === 'Escape') cancelRenaming();
                            }}
                            placeholder="Slide / Resource title"
                            sx={{
                              '& .MuiInputBase-input': {
                                py: 0.5,
                                px: 1,
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                color: currentTheme.palette.textPrimary
                              }
                            }}
                          />
                          <Tooltip title="Save title">
                            <IconButton
                              size="small"
                              disabled={isRenaming}
                              onClick={() => saveRename(res.id)}
                              sx={{ color: '#10b981' }}
                              aria-label="Save title"
                            >
                              <Check size={14} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Cancel">
                            <IconButton
                              size="small"
                              onClick={cancelRenaming}
                              sx={{ color: '#ef4444' }}
                              aria-label="Cancel"
                            >
                              <X size={14} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary, mb: 0.2 }}>
                            {res.title || res.filename}
                          </Typography>
                          {typeof handleRenameResource === 'function' && (
                            <Tooltip title="Rename slide">
                              <IconButton
                                size="small"
                                aria-label="Rename slide"
                                onClick={() => startRenaming(res)}
                                sx={{
                                  p: '3px',
                                  color: currentTheme.palette.textSecondary,
                                  opacity: 0.7,
                                  '&:hover': { opacity: 1, color: currentTheme.palette.primary }
                                }}
                              >
                                <Edit2 size={13} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', fontSize: '0.75rem', color: currentTheme.palette.textSecondary }}>
                        {associatedLecture && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: currentTheme.palette.primary }}>
                            <Video size={13} /> {associatedLecture}
                          </Box>
                        )}
                        {res.file_size_bytes > 0 && <span>{formatBytes(res.file_size_bytes)}</span>}
                        <span>Uploaded {formatRelativeTime(res.created_at)}</span>
                        {res.user_email && <span style={{ opacity: 0.75 }}>by {res.user_email}</span>}
                      </Box>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                    {isLink ? (
                      <Tooltip title="Open">
                        <IconButton
                          size="small"
                          aria-label="Open"
                          component="a"
                          href={res.view_url || res.download_url || res.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{
                            color: currentTheme.palette.textPrimary,
                            border: `1px solid ${currentTheme.palette.cardBorder}`,
                            borderRadius: 2,
                            p: '6px',
                            '&:hover': {
                              borderColor: currentTheme.palette.primary,
                              bgcolor: 'var(--highlight-bg)'
                            }
                          }}
                        >
                          <ExternalLink size={15} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <>
                        <Tooltip title="View">
                          <IconButton
                            size="small"
                            aria-label="View"
                            onClick={() => {
                              if (typeof openPreviewModal === 'function') {
                                openPreviewModal(res);
                              } else {
                                window.open(res.view_url || res.download_url || res.file_url, '_blank', 'noopener,noreferrer');
                              }
                            }}
                            sx={{
                              color: currentTheme.palette.textPrimary,
                              border: `1px solid ${currentTheme.palette.cardBorder}`,
                              borderRadius: 2,
                              p: '6px',
                              '&:hover': {
                                borderColor: currentTheme.palette.primary,
                                bgcolor: 'var(--highlight-bg)'
                              }
                            }}
                          >
                            <Eye size={15} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Download">
                          <IconButton
                            size="small"
                            aria-label="Download"
                            component="a"
                            href={res.download_url || res.view_url}
                            download={res.filename}
                            sx={{
                              color: currentTheme.palette.textPrimary,
                              border: `1px solid ${currentTheme.palette.cardBorder}`,
                              borderRadius: 2,
                              p: '6px',
                              '&:hover': {
                                borderColor: currentTheme.palette.primary,
                                bgcolor: 'var(--highlight-bg)'
                              }
                            }}
                          >
                            <Download size={15} />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}

                    {isOwner && typeof handleDeleteResource === 'function' && (
                      <Tooltip title="Delete Resource">
                        <IconButton
                          size="small"
                          aria-label="Delete Resource"
                          onClick={() => handleDeleteResource(res.id, res.blob_name, activeCourseData?.course_name || selectedCourse)}
                          sx={{
                            color: '#ef4444',
                            '&:hover': { bgcolor: 'rgba(239, 68, 68, 0.1)' }
                          }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Paper>
              );
            })}
          </Box>
        ))}
      </Box>
    ),
    books: (
      /* ========================================================================= */
      /* SECTION 2: RECOMMENDED BOOKS & ACADEMIC READINGS */
      /* ========================================================================= */
      <Box key="books" data-testid="library-section-books" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {extractSuccessMsg && (
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 2.5,
              bgcolor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              color: '#10b981'
            }}
          >
            <CheckCircle size={18} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {extractSuccessMsg}
            </Typography>
          </Paper>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <Box
            onClick={() => toggleSectionCollapse('books')}
            data-testid="toggle-section-books"
            role="button"
            aria-expanded={!collapsedSections.books}
            aria-label="Toggle Recommended Books & Readings section"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none' }}
          >
            {collapsedSections.books ? <ChevronRight size={18} color={currentTheme.palette.textSecondary} /> : <ChevronDown size={18} color={currentTheme.palette.textSecondary} />}
            <BookMarked size={20} color={currentTheme.palette.primary} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary }}>
              Recommended Books & Readings
            </Typography>
            <Chip
              label={courseReadings.length}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.72rem',
                fontWeight: 700,
                bgcolor: currentTheme.palette.badgeBg,
                color: currentTheme.palette.textSecondary
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            {renderSectionOrderControls('books')}
            <Button
              size="small"
              onClick={() => toggleSectionCollapse('books')}
              sx={{ textTransform: 'none', fontSize: '0.74rem', fontWeight: 600, color: currentTheme.palette.textSecondary }}
            >
              {collapsedSections.books ? 'Expand' : 'Collapse'}
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<Search size={13} />}
              onClick={() => setResearchModalOpen(true)}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.75rem',
                borderRadius: 2,
                bgcolor: currentTheme.palette.primary,
                color: '#fff',
                '&:hover': { bgcolor: currentTheme.palette.primaryHover }
              }}
            >
              Research Literature & Books
            </Button>
            {courseReadings.length > 0 && typeof triggerExtractReadings === 'function' && (
              <Button
                variant="outlined"
                size="small"
                disabled={isExtractingReadings}
                onClick={() => handleExtractClick(true)}
                startIcon={isExtractingReadings ? <CircularProgress size={13} color="inherit" /> : <RotateCw size={13} />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  borderRadius: 2,
                  borderColor: currentTheme.palette.cardBorder,
                  color: currentTheme.palette.textSecondary,
                  '&:hover': {
                    borderColor: currentTheme.palette.primary,
                    color: currentTheme.palette.primary,
                    bgcolor: 'var(--highlight-bg, rgba(59, 130, 246, 0.08))'
                  }
                }}
              >
                {isExtractingReadings ? "Regenerating..." : "Regenerate All"}
              </Button>
            )}
          </Box>
        </Box>

        {!collapsedSections.books && (isExtractingReadings ? (
          <Paper
            elevation={0}
            sx={{
              p: 5,
              textAlign: 'center',
              bgcolor: currentTheme.palette.cardBg,
              border: `1px solid ${currentTheme.palette.primary}`,
              borderRadius: 3
            }}
          >
            <CircularProgress size={36} sx={{ color: currentTheme.palette.primary, mb: 2 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary, mb: 0.5 }}>
              Analyzing Course Materials...
            </Typography>
            <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, maxWidth: 440, mx: 'auto' }}>
              Scanning lecture transcripts and PowerPoint slide decks to identify recommended textbooks, reference volumes, and academic journal papers.
            </Typography>
          </Paper>
        ) : courseReadingsLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} sx={{ color: currentTheme.palette.primary, mr: 1.5 }} />
            <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
              Loading recommended books...
            </Typography>
          </Box>
        ) : courseReadings.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: 5,
              textAlign: 'center',
              bgcolor: currentTheme.palette.cardBg,
              border: `1px dashed ${currentTheme.palette.cardBorder}`,
              borderRadius: 3
            }}
          >
            <BookMarked size={36} color={currentTheme.palette.primary} style={{ margin: '0 auto 10px', opacity: 0.85 }} />
            <Typography variant="subtitle1" sx={{ color: currentTheme.palette.textPrimary, fontWeight: 700, mb: 0.5 }}>
              No Recommended Books Extracted Yet
            </Typography>
            <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, maxWidth: 440, mx: 'auto', mb: 2 }}>
              Click below to scan lecture transcripts & slides, or research and add peer-reviewed papers & textbooks directly.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              {typeof triggerExtractReadings === 'function' && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Sparkles size={14} />}
                  onClick={() => handleExtractClick(false)}
                  sx={{
                    bgcolor: currentTheme.palette.primary,
                    color: '#fff',
                    fontWeight: 700,
                    textTransform: 'none',
                    borderRadius: 2,
                    px: 2.5,
                    '&:hover': { bgcolor: currentTheme.palette.primaryHover }
                  }}
                >
                  Scan & Extract Books
                </Button>
              )}
              <Button
                variant="outlined"
                size="small"
                startIcon={<Search size={14} />}
                onClick={() => setResearchModalOpen(true)}
                sx={{
                  borderColor: currentTheme.palette.cardBorder,
                  color: currentTheme.palette.textPrimary,
                  fontWeight: 700,
                  textTransform: 'none',
                  borderRadius: 2,
                  px: 2.5,
                  bgcolor: currentTheme.palette.cardBg,
                  '&:hover': {
                    borderColor: currentTheme.palette.primary,
                    color: currentTheme.palette.primary,
                    bgcolor: 'var(--highlight-bg, rgba(59, 130, 246, 0.08))'
                  }
                }}
              >
                Research Literature & Books
              </Button>
            </Box>
          </Paper>
        ) : (
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(auto-fill, minmax(320px, 1fr))'
            },
            gap: 2.5,
            width: '100%',
            minWidth: 0
          }}>
            {courseReadings.map((book) => {
              const catBadge = getReadingCategoryBadge(book.category);
              return (
                <Paper
                  key={book.id}
                  elevation={0}
                  sx={{
                    p: 2.5,
                    borderRadius: 3,
                    bgcolor: currentTheme.palette.cardBg,
                    border: `1px solid ${currentTheme.palette.cardBorder}`,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 2,
                    minWidth: 0,
                    width: '100%',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: currentTheme.palette.primary,
                      boxShadow: currentTheme.palette.cardShadow
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 2, minWidth: 0 }}>
                    {/* BOOK COVER OR STYLIZED EMBOSSED SPINE */}
                    {book.cover_url ? (
                      <Box
                        component="img"
                        src={book.cover_url}
                        alt={book.title}
                        sx={{
                          width: 82,
                          height: 118,
                          objectFit: 'cover',
                          borderRadius: 2,
                          boxShadow: '0 4px 10px rgba(0,0,0,0.18)',
                          flexShrink: 0
                        }}
                      />
                    ) : (
                      <Box
                        sx={{
                          width: 82,
                          height: 118,
                          borderRadius: 2,
                          bgcolor: 'var(--highlight-bg, rgba(59, 130, 246, 0.08))',
                          border: `1px solid ${currentTheme.palette.cardBorder}`,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          p: 1,
                          textAlign: 'center',
                          flexShrink: 0
                        }}
                      >
                        <BookOpen size={24} color={currentTheme.palette.primary} style={{ marginBottom: 4 }} />
                        <Typography
                          variant="caption"
                          sx={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            lineHeight: 1.1,
                            color: currentTheme.palette.textSecondary,
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                        >
                          {book.title}
                        </Typography>
                      </Box>
                    )}

                    {/* BOOK DETAILS */}
                    <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <Box sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '6px',
                            backgroundColor: catBadge.bg,
                            color: catBadge.color,
                            border: `1px solid ${catBadge.border}`,
                            display: 'inline-block',
                            maxWidth: '100%',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {catBadge.label}
                        </span>

                        {book.is_lending ? (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(245, 158, 11, 0.12)',
                              color: '#f59e0b',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              display: 'inline-block',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            1-Hr Loan
                          </span>
                        ) : book.embed_url ? (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(16, 185, 129, 0.12)',
                              color: '#10b981',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              display: 'inline-block',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            Full Book
                          </span>
                        ) : null}
                      </Box>

                      <Typography
                        variant="subtitle2"
                        sx={{
                          fontWeight: 700,
                          color: currentTheme.palette.textPrimary,
                          lineHeight: 1.3,
                          mb: 0.5,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          wordBreak: 'break-word'
                        }}
                      >
                        {book.title}
                      </Typography>

                      {book.author && (
                        <Typography
                          variant="caption"
                          sx={{
                            color: currentTheme.palette.textSecondary,
                            fontWeight: 600,
                            mb: 0.3,
                            display: '-webkit-box',
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word'
                          }}
                        >
                          by {book.author}
                        </Typography>
                      )}

                      {book.edition && (
                        <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, opacity: 0.8, fontSize: '0.7rem' }}>
                          {book.edition}
                        </Typography>
                      )}

                      {book.source_context && (
                        <Box sx={{ mt: 'auto', pt: 1, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.7rem', color: currentTheme.palette.primary, minWidth: 0 }}>
                          <FileText size={12} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {book.source_context}
                          </span>
                        </Box>
                      )}
                    </Box>
                  </Box>

                  {/* ACTION BUTTONS */}
                  <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop: `1px solid ${currentTheme.palette.cardBorder}`,
                    pt: 1.5,
                    gap: 1,
                    flexWrap: 'wrap',
                    minWidth: 0
                  }}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => setActiveReaderBook(book)}
                        startIcon={<BookOpen size={13} />}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          borderRadius: 2,
                          backgroundColor: currentTheme.palette.primary,
                          color: '#ffffff',
                          boxShadow: 'none',
                          whiteSpace: 'nowrap',
                          '&:hover': {
                            backgroundColor: currentTheme.palette.primaryDark || currentTheme.palette.primary,
                            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
                          }
                        }}
                      >
                        Read Book
                      </Button>

                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => handleOpenWebSearch(book)}
                        startIcon={<Globe size={13} />}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          borderRadius: 2,
                          borderColor: currentTheme.palette.cardBorder,
                          color: currentTheme.palette.textSecondary,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        Search Web
                      </Button>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                      {handleRefreshReadingReader && (
                        <Tooltip title="Re-resolve / refresh digital reader link">
                          <span>
                            <IconButton
                              size="small"
                              aria-label="Refresh Reader Link"
                              disabled={refreshingReadingId === book.id}
                              onClick={() => handleRefreshSingleReader(book.id)}
                              sx={{
                                color: currentTheme.palette.textSecondary,
                                '&:hover': { color: currentTheme.palette.primary }
                              }}
                            >
                              {refreshingReadingId === book.id ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <RotateCw size={14} />
                              )}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}

                      {handleDeleteCourseReading && (
                        <Tooltip title="Remove reading">
                          <IconButton
                            size="small"
                            aria-label="Remove Reading"
                            onClick={() => handleDeleteCourseReading(book.id)}
                            sx={{
                              color: currentTheme.palette.textSecondary,
                              '&:hover': { color: '#ef4444' }
                            }}
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                </Paper>
              );
            })}
          </Box>
        ))}
      </Box>
    )
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* Top Quick-Access & Section Controls Bar */}
      <Paper
        elevation={0}
        data-testid="library-section-control-bar"
        sx={{
          p: 1.5,
          borderRadius: 2.5,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: currentTheme.palette.textSecondary, mr: 0.5 }}>
            SECTIONS:
          </Typography>
          <Button
            size="small"
            variant="contained"
            data-testid="focus-academic-books-btn"
            onClick={handleFocusAcademicBooks}
            startIcon={<BookMarked size={13} />}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.74rem',
              borderRadius: 1.5,
              bgcolor: currentTheme.palette.primary,
              color: '#fff',
              py: 0.4,
              px: 1.2,
              '&:hover': { bgcolor: currentTheme.palette.primaryHover }
            }}
          >
            Focus Academic Books
          </Button>
          <Button
            size="small"
            variant="outlined"
            data-testid="move-books-top-btn"
            onClick={() => moveSectionOrder('books', 'top')}
            disabled={sectionOrder[0] === 'books'}
            startIcon={<ArrowUp size={13} />}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.74rem',
              borderRadius: 1.5,
              borderColor: currentTheme.palette.cardBorder,
              color: currentTheme.palette.textPrimary,
              py: 0.4,
              px: 1.2
            }}
          >
            Pin Books to Top
          </Button>
          {(collapsedSections.notes || collapsedSections.slides || collapsedSections.books) && (
            <Button
              size="small"
              data-testid="expand-all-sections-btn"
              onClick={handleExpandAllSections}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.74rem',
                color: currentTheme.palette.primary
              }}
            >
              Expand All
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {[
            { key: 'notes', label: `Notes (${courseNotes.length})` },
            { key: 'slides', label: `Slides (${courseResources.length})` },
            { key: 'books', label: `Books (${courseReadings.length})` }
          ].map(sec => (
            <Chip
              key={sec.key}
              label={`${collapsedSections[sec.key] ? '▸' : '▾'} ${sec.label}`}
              size="small"
              onClick={() => toggleSectionCollapse(sec.key)}
              sx={{
                fontWeight: 600,
                fontSize: '0.72rem',
                cursor: 'pointer',
                bgcolor: collapsedSections[sec.key] ? 'transparent' : currentTheme.palette.badgeBg,
                color: collapsedSections[sec.key] ? currentTheme.palette.textSecondary : currentTheme.palette.textPrimary,
                border: `1px solid ${currentTheme.palette.cardBorder}`
              }}
            />
          ))}
        </Box>
      </Paper>

      {sectionOrder.map((secKey) => sectionMap[secKey])}

      {/* ========================================================================= */}
      {/* IN-PAGE DIGITAL BOOK READER MODAL */}
      {/* ========================================================================= */}
      <BookReaderModal
        open={Boolean(activeReaderBook)}
        onClose={() => setActiveReaderBook(null)}
        book={activeReaderBook}
        currentTheme={currentTheme}
      />

      {/* ========================================================================= */}
      {/* RESEARCH ACADEMIC LITERATURE & BOOKS MODAL */}
      {/* ========================================================================= */}
      <ResearchLiteratureModal
        open={researchModalOpen}
        onClose={() => setResearchModalOpen(false)}
        courseDisplayName={courseDisplayName}
        courseReadings={courseReadings}
        searchLiterature={searchLiterature}
        addCourseReading={addCourseReading}
        currentTheme={currentTheme}
      />


      {/* ========================================================================= */}
      {/* WEB SCRAPER / SEARCH MODAL */}
      {/* ========================================================================= */}
      <Dialog
        open={webSearchOpen}
        onClose={() => setWebSearchOpen(false)}
        maxWidth="md"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 3,
              bgcolor: currentTheme.palette.cardBg,
              border: `1px solid ${currentTheme.palette.cardBorder}`
            }
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Globe size={20} color={currentTheme.palette.primary} />
          Web & Syllabus Search
        </DialogTitle>

        <DialogContent dividers sx={{ borderColor: currentTheme.palette.cardBorder }}>
          <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, mb: 2 }}>
            Searches academic repositories, OpenStax, university syllabus archives, and free PDFs for this book or paper.
          </Typography>

          <Box sx={{ display: 'flex', gap: 1.5, mb: 3 }}>
            <TextField
              size="small"
              fullWidth
              value={customWebQuery}
              onChange={(e) => setCustomWebQuery(e.target.value)}
              placeholder="Search query..."
              onKeyDown={(e) => { if (e.key === 'Enter') handleRunCustomWebSearch(); }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  bgcolor: currentTheme.palette.inputBg || currentTheme.palette.cardBg,
                  color: currentTheme.palette.textPrimary
                }
              }}
            />
            <Button
              variant="contained"
              onClick={handleRunCustomWebSearch}
              disabled={webSearchLoading}
              startIcon={webSearchLoading ? <CircularProgress size={14} color="inherit" /> : <Search size={14} />}
              sx={{
                bgcolor: currentTheme.palette.primary,
                color: '#fff',
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 2,
                px: 2.5
              }}
            >
              Search
            </Button>
          </Box>

          {webSearchLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 5 }}>
              <CircularProgress size={32} sx={{ color: currentTheme.palette.primary, mb: 1.5 }} />
              <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
                Scraping academic web results for "{activeSearchBook?.title}"...
              </Typography>
            </Box>
          ) : webSearchResults.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center', color: currentTheme.palette.textSecondary }}>
              <Typography variant="body2">
                No web results found for this specific query. Try modifying the keywords above.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {webSearchResults.map((item, idx) => (
                <Paper
                  key={idx}
                  elevation={0}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    border: `1px solid ${currentTheme.palette.cardBorder}`,
                    bgcolor: 'var(--highlight-bg, rgba(255,255,255,0.02))'
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                    <Typography
                      variant="subtitle2"
                      component="a"
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        fontWeight: 700,
                        color: currentTheme.palette.primary,
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' }
                      }}
                    >
                      {item.title}
                    </Typography>
                    <ExternalLink size={14} color={currentTheme.palette.primary} style={{ flexShrink: 0, marginTop: 3 }} />
                  </Box>
                  <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary, fontSize: '0.8rem', lineHeight: 1.4 }}>
                    {item.snippet}
                  </Typography>
                  <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, opacity: 0.7, wordBreak: 'break-all', mt: 0.5, display: 'block' }}>
                    {item.url}
                  </Typography>
                </Paper>
              ))}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2, borderColor: currentTheme.palette.cardBorder }}>
          <Button
            onClick={() => setWebSearchOpen(false)}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              color: currentTheme.palette.textSecondary
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
