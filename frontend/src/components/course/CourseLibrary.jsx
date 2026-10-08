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
  Sparkles,
  Globe,
  Search,
  BookMarked,
  CheckCircle,
  FileText
} from 'lucide-react';
import { formatRelativeTime, formatBytes, getFileTypeBadge } from '../../utils/formatters';
import { normalizeCourseSlug } from '../../utils/routing';

export default function CourseLibrary({
  courseResourcesLoading = false,
  courseResources = [],
  courseReadings = [],
  courseReadingsLoading = false,
  isExtractingReadings = false,
  triggerExtractReadings,
  handleDeleteCourseReading,
  searchReadingWeb,
  googleUser,
  userLibrary = [],
  selectedCourse,
  activeCourseData,
  openUploadModal,
  handleDeleteResource,
  openPreviewModal,
  currentTheme
}) {
  const [webSearchOpen, setWebSearchOpen] = useState(false);
  const [activeSearchBook, setActiveSearchBook] = useState(null);
  const [customWebQuery, setCustomWebQuery] = useState('');
  const [webSearchResults, setWebSearchResults] = useState([]);
  const [webSearchLoading, setWebSearchLoading] = useState(false);
  const [extractSuccessMsg, setExtractSuccessMsg] = useState('');

  const courseDisplayName = activeCourseData?.course_name || selectedCourse || 'Course Library';
  const exactCourseSlug =
    activeCourseData?.course_slug ||
    (activeCourseData?.course_name ? normalizeCourseSlug(activeCourseData.course_name) : normalizeCourseSlug(selectedCourse));

  // Trigger manual book extraction
  const handleExtractClick = async () => {
    if (!triggerExtractReadings) return;
    setExtractSuccessMsg('');
    const res = await triggerExtractReadings(exactCourseSlug || courseDisplayName);
    if (res && res.status === 'success') {
      const added = res.newly_extracted_count || 0;
      setExtractSuccessMsg(
        added > 0
          ? `Discovered ${added} new recommended reading${added > 1 ? 's' : ''}!`
          : `Scan complete! All current readings are up to date (${res.count || 0} books found).`
      );
      setTimeout(() => setExtractSuccessMsg(''), 6000);
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      
      
      {/* ========================================================================= */}
      {/* SECTION 1: LECTURE SLIDES & PRESENTATION DECKS */}
      {/* ========================================================================= */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
          <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
            PowerPoints and PDFs used by the professor during lectures
          </Typography>
        </Box>

        {courseResourcesLoading ? (
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
            {googleUser && (
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
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: currentTheme.palette.textPrimary, mb: 0.2 }}>
                        {res.title || res.filename}
                      </Typography>
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
                      <Button
                        variant="outlined"
                        size="small"
                        component="a"
                        href={res.view_url || res.download_url || res.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        startIcon={<ExternalLink size={14} />}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 600,
                          fontSize: '0.78rem',
                          borderRadius: 2,
                          color: currentTheme.palette.textPrimary,
                          borderColor: currentTheme.palette.cardBorder
                        }}
                      >
                        Open
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => {
                            if (typeof openPreviewModal === 'function') {
                              openPreviewModal(res);
                            } else {
                              window.open(res.view_url || res.download_url || res.file_url, '_blank', 'noopener,noreferrer');
                            }
                          }}
                          startIcon={<Eye size={14} />}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            borderRadius: 2,
                            color: currentTheme.palette.textPrimary,
                            borderColor: currentTheme.palette.cardBorder
                          }}
                        >
                          View
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          component="a"
                          href={res.download_url || res.view_url}
                          download={res.filename}
                          startIcon={<Download size={14} />}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            borderRadius: 2,
                            color: currentTheme.palette.textPrimary,
                            borderColor: currentTheme.palette.cardBorder
                          }}
                        >
                          Download
                        </Button>
                      </>
                    )}

                    {isOwner && (
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
        )}
      </Box>
      
      {/* ========================================================================= */}
      {/* TOP HEADER: LIBRARY OVERVIEW & QUICK ACTIONS */}
      {/* ========================================================================= */}
      {/* <Paper
        elevation={0}
        sx={{
          p: 3,
          borderRadius: 3,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2
        }}
      > */}
        {/* <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <BookOpen size={24} color={currentTheme.palette.primary} />
            <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary }}>
              Course Library
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
            Lecture slides used in class and AI-extracted supporting textbooks & journals.
          </Typography>
        </Box> */}

        {/* <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}> */}
          {/* <Tooltip title={!googleUser ? "Sign in with Google to upload course slides" : "Upload PPT/PDF slides used during lectures"}>
            <span>
              <Button
                variant="outlined"
                size="small"
                disabled={!googleUser}
                startIcon={<Upload size={14} />}
                onClick={() => openUploadModal({
                  courseName: courseDisplayName,
                  videoId: null
                })}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  borderRadius: 2,
                  color: currentTheme.palette.primary,
                  borderColor: currentTheme.palette.cardBorder,
                  bgcolor: currentTheme.palette.cardBg,
                  '&:hover': { bgcolor: 'var(--highlight-bg)', borderColor: currentTheme.palette.primary }
                }}
              >
                Upload Lecture Slides
              </Button>
            </span>
          </Tooltip> */}

          {/* <Button
            variant="contained"
            size="small"
            disabled={isExtractingReadings}
            startIcon={isExtractingReadings ? <CircularProgress size={14} color="inherit" /> : <Sparkles size={14} />}
            onClick={handleExtractClick}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.82rem',
              borderRadius: 2,
              bgcolor: currentTheme.palette.primary,
              color: '#fff',
              '&:hover': { bgcolor: currentTheme.palette.primaryHover }
            }}
          >
            {isExtractingReadings ? "Extracting Readings..." : "Scan & Extract Books"}
          </Button> */}
        {/* </Box> */}
      {/* </Paper> */}

      {/* SUCCESS / SCAN BANNER */}
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


      {/* ========================================================================= */}
      {/* SECTION 2: RECOMMENDED BOOKS & ACADEMIC READINGS */}
      {/* ========================================================================= */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
          <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary }}>
            Auto-extracted from lecture audio transcripts and professor presentation slides
          </Typography>
        </Box>

        {isExtractingReadings ? (
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
              Click the button below to scan all video lecture transcripts and uploaded PowerPoint slides to extract textbooks and syllabus readings.
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<Sparkles size={14} />}
              onClick={handleExtractClick}
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
          </Paper>
        ) : (
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: 2.5
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
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: currentTheme.palette.primary,
                      boxShadow: currentTheme.palette.cardShadow
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 2 }}>
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
                      <Box sx={{ mb: 0.5 }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '6px',
                            backgroundColor: catBadge.bg,
                            color: catBadge.color,
                            border: `1px solid ${catBadge.border}`
                          }}
                        >
                          {catBadge.label}
                        </span>
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
                          overflow: 'hidden'
                        }}
                      >
                        {book.title}
                      </Typography>

                      {book.author && (
                        <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, fontWeight: 600, mb: 0.3 }}>
                          by {book.author}
                        </Typography>
                      )}

                      {book.edition && (
                        <Typography variant="caption" sx={{ color: currentTheme.palette.textSecondary, opacity: 0.8, fontSize: '0.7rem' }}>
                          {book.edition}
                        </Typography>
                      )}

                      {book.source_context && (
                        <Box sx={{ mt: 'auto', pt: 1, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.7rem', color: currentTheme.palette.primary }}>
                          <FileText size={12} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    gap: 1
                  }}>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {book.preview_url ? (
                        <Button
                          variant="outlined"
                          size="small"
                          component="a"
                          href={book.preview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          startIcon={<BookOpen size={13} />}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            borderRadius: 2,
                            borderColor: currentTheme.palette.cardBorder,
                            color: currentTheme.palette.textPrimary
                          }}
                        >
                          Preview
                        </Button>
                      ) : null}

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
                          color: currentTheme.palette.primary
                        }}
                      >
                        Search Web
                      </Button>
                    </Box>

                    {handleDeleteCourseReading && (
                      <Tooltip title="Remove reading">
                        <IconButton
                          size="small"
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
                </Paper>
              );
            })}
          </Box>
        )}
      </Box>

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
