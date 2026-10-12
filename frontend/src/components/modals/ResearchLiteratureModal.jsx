import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Chip,
  Paper,
  CircularProgress,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Search,
  BookOpen,
  Plus,
  CheckCircle,
  ExternalLink,
  X,
  FileText,
  Sparkles,
  BookMarked
} from 'lucide-react';

export default function ResearchLiteratureModal({
  open,
  onClose,
  courseDisplayName = '',
  courseReadings = [],
  searchLiterature,
  addCourseReading,
  currentTheme
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [addedTitles, setAddedTitles] = useState(new Set());

  // Existing library titles set for deduplication check
  const existingNormalizedTitles = new Set(
    (courseReadings || []).map((r) =>
      (r.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    )
  );

  const handleSearch = async (overrideQuery) => {
    const q = (overrideQuery !== undefined ? overrideQuery : query).trim();
    if (!q || !searchLiterature) return;
    setLoading(true);
    setHasSearched(true);
    try {
      const res = await searchLiterature(q, courseDisplayName, 8);
      setResults(res || []);
    } catch (err) {
      console.error('Failed to search literature:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (item) => {
    if (!addCourseReading || !item || !item.title) return;
    const norm = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    setAddingId(norm);
    try {
      await addCourseReading(courseDisplayName, item);
      setAddedTitles((prev) => new Set([...prev, norm]));
    } catch (err) {
      console.error('Failed to add reading to course:', err);
    } finally {
      setAddingId(null);
    }
  };

  const isItemAdded = (item) => {
    const norm = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return existingNormalizedTitles.has(norm) || addedTitles.has(norm);
  };

  const handleChipClick = (sampleQuery) => {
    setQuery(sampleQuery);
    handleSearch(sampleQuery);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            bgcolor: currentTheme?.palette?.cardBg || '#1e1e24',
            border: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(255,255,255,0.1)'}`,
            maxHeight: '88vh',
            display: 'flex',
            flexDirection: 'column'
          }
        }
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1.5,
          borderBottom: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(255,255,255,0.1)'}`
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              p: 1,
              borderRadius: 2,
              bgcolor: 'var(--highlight-bg, rgba(59, 130, 246, 0.12))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <BookMarked size={22} color={currentTheme?.palette?.primary || '#3b82f6'} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme?.palette?.textPrimary || '#fff', fontSize: '1.1rem' }}>
              Research Academic Literature & Books
            </Typography>
            <Typography variant="caption" sx={{ color: currentTheme?.palette?.textSecondary || '#9ca3af' }}>
              Search across Crossref, Europe PMC / PubMed Central, and Google Books
            </Typography>
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: currentTheme?.palette?.textSecondary || '#9ca3af' }} aria-label="Close modal">
          <X size={18} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 3, overflowY: 'auto' }}>
        {/* SEARCH BAR */}
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
          <TextField
            size="small"
            fullWidth
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='e.g. Singer et al. (2016) Sepsis-3 JAMA, or Cormen Introduction to Algorithms'
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2.5,
                bgcolor: currentTheme?.palette?.inputBg || currentTheme?.palette?.cardBg,
                color: currentTheme?.palette?.textPrimary || '#fff',
                borderColor: currentTheme?.palette?.cardBorder
              }
            }}
          />
          <Button
            variant="contained"
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <Search size={15} />}
            sx={{
              bgcolor: currentTheme?.palette?.primary || '#3b82f6',
              color: '#fff',
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: 2.5,
              px: 3,
              whiteSpace: 'nowrap',
              '&:hover': { bgcolor: currentTheme?.palette?.primaryHover || '#2563eb' }
            }}
          >
            Search
          </Button>
        </Box>

        {/* QUICK SUGGESTIONS */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 3 }}>
          <Typography variant="caption" sx={{ color: currentTheme?.palette?.textSecondary, fontWeight: 600 }}>
            Quick Examples:
          </Typography>
          <Chip
            size="small"
            label="Singer et al. (2016) Sepsis-3 JAMA"
            onClick={() => handleChipClick('Singer et al. (2016) Sepsis-3 JAMA')}
            sx={{
              fontSize: '0.72rem',
              cursor: 'pointer',
              bgcolor: 'var(--highlight-bg, rgba(59, 130, 246, 0.08))',
              color: currentTheme?.palette?.primary || '#3b82f6',
              border: `1px solid ${currentTheme?.palette?.cardBorder}`,
              '&:hover': { bgcolor: 'var(--highlight-bg, rgba(59, 130, 246, 0.16))' }
            }}
          />
          <Chip
            size="small"
            label="Vaswani et al. Attention Is All You Need"
            onClick={() => handleChipClick('Vaswani et al. Attention Is All You Need')}
            sx={{
              fontSize: '0.72rem',
              cursor: 'pointer',
              bgcolor: 'var(--highlight-bg, rgba(168, 85, 247, 0.08))',
              color: '#a855f7',
              border: `1px solid ${currentTheme?.palette?.cardBorder}`,
              '&:hover': { bgcolor: 'var(--highlight-bg, rgba(168, 85, 247, 0.16))' }
            }}
          />
          <Chip
            size="small"
            label="Cormen Algorithms 4th Edition"
            onClick={() => handleChipClick('Cormen Introduction to Algorithms')}
            sx={{
              fontSize: '0.72rem',
              cursor: 'pointer',
              bgcolor: 'var(--highlight-bg, rgba(16, 185, 129, 0.08))',
              color: '#10b981',
              border: `1px solid ${currentTheme?.palette?.cardBorder}`,
              '&:hover': { bgcolor: 'var(--highlight-bg, rgba(16, 185, 129, 0.16))' }
            }}
          />
        </Box>

        {/* RESULTS AREA */}
        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={36} sx={{ color: currentTheme?.palette?.primary, mb: 2 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: currentTheme?.palette?.textPrimary }}>
              Searching Academic Repositories...
            </Typography>
            <Typography variant="body2" sx={{ color: currentTheme?.palette?.textSecondary, mt: 0.5 }}>
              Querying Crossref DOIs, Europe PMC open access papers, and Google Books
            </Typography>
          </Box>
        ) : !hasSearched ? (
          <Box sx={{ py: 6, textAlign: 'center', color: currentTheme?.palette?.textSecondary }}>
            <BookOpen size={40} color={currentTheme?.palette?.primary} style={{ margin: '0 auto 12px', opacity: 0.7 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: currentTheme?.palette?.textPrimary, mb: 0.5 }}>
              Find Supporting Papers & Books
            </Typography>
            <Typography variant="body2" sx={{ maxWidth: 420, mx: 'auto', fontSize: '0.85rem' }}>
              Paste any literature citation, paper title, or textbook name to retrieve peer-reviewed journal metadata, open access PDFs, and 1-click pin them to your course library.
            </Typography>
          </Box>
        ) : results.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center', color: currentTheme?.palette?.textSecondary }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: currentTheme?.palette?.textPrimary, mb: 0.5 }}>
              No Literature or Books Found
            </Typography>
            <Typography variant="body2" sx={{ maxWidth: 420, mx: 'auto', fontSize: '0.85rem' }}>
              No matches found for "{query}". Try searching with the primary author's last name, key title words, or DOI.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {results.map((item, idx) => {
              const isAdded = isItemAdded(item);
              const norm = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const isAdding = addingId === norm;
              const isJournal = item.reading_type === 'journal' || item.reading_type === 'paper';

              return (
                <Paper
                  key={idx}
                  elevation={0}
                  sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    border: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(255,255,255,0.1)'}`,
                    bgcolor: 'var(--highlight-bg, rgba(255,255,255,0.02))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1.5,
                    transition: 'border-color 0.2s ease',
                    '&:hover': {
                      borderColor: currentTheme?.palette?.primary
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {/* BADGES */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexWrap: 'wrap', mb: 1 }}>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '6px',
                            backgroundColor: isJournal ? 'rgba(168, 85, 247, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                            color: isJournal ? '#a855f7' : '#3b82f6',
                            border: `1px solid ${isJournal ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
                          }}
                        >
                          {isJournal ? 'Journal / Paper' : 'Book / Textbook'}
                        </span>

                        {item.is_open_access && (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(16, 185, 129, 0.15)',
                              color: '#10b981',
                              border: '1px solid rgba(16, 185, 129, 0.3)'
                            }}
                          >
                            Open Access
                          </span>
                        )}

                        {item.source_provider && (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              color: currentTheme?.palette?.textSecondary || '#9ca3af',
                              border: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(255,255,255,0.1)'}`
                            }}
                          >
                            {item.source_provider}
                          </span>
                        )}
                      </Box>

                      {/* TITLE */}
                      <Typography
                        variant="subtitle1"
                        sx={{
                          fontWeight: 700,
                          color: currentTheme?.palette?.textPrimary || '#fff',
                          lineHeight: 1.3,
                          fontSize: '0.95rem',
                          mb: 0.5
                        }}
                      >
                        {item.title}
                      </Typography>

                      {/* AUTHORS & JOURNAL */}
                      <Typography
                        variant="caption"
                        sx={{
                          color: currentTheme?.palette?.textSecondary || '#9ca3af',
                          display: 'block',
                          fontSize: '0.78rem',
                          mb: 0.3
                        }}
                      >
                        {item.author && <strong style={{ color: currentTheme?.palette?.textPrimary }}>{item.author}</strong>}
                        {item.edition && ` (${item.edition})`}
                        {item.journal && ` — ${item.journal}`}
                        {!item.journal && item.publisher && ` — ${item.publisher}`}
                      </Typography>

                      {/* DOI / ISBN LINK */}
                      {item.doi && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                          <Typography variant="caption" sx={{ color: currentTheme?.palette?.textSecondary, fontSize: '0.72rem' }}>
                            DOI:
                          </Typography>
                          <a
                            href={item.preview_url || `https://doi.org/${item.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: currentTheme?.palette?.primary || '#3b82f6',
                              fontSize: '0.72rem',
                              textDecoration: 'none',
                              fontWeight: 600
                            }}
                          >
                            {item.doi}
                          </a>
                        </Box>
                      )}

                      {/* ABSTRACT PREVIEW */}
                      {item.abstract && (
                        <Typography
                          variant="body2"
                          sx={{
                            color: currentTheme?.palette?.textSecondary || '#9ca3af',
                            fontSize: '0.78rem',
                            lineHeight: 1.4,
                            mt: 1,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                        >
                          {item.abstract}
                        </Typography>
                      )}
                    </Box>

                    {/* COVER PREVIEW (IF BOOK) */}
                    {item.cover_url && (
                      <Box
                        component="img"
                        src={item.cover_url}
                        alt={item.title}
                        sx={{
                          width: 58,
                          height: 82,
                          objectFit: 'cover',
                          borderRadius: 1.5,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                          flexShrink: 0
                        }}
                      />
                    )}
                  </Box>

                  {/* BOTTOM ACTION BAR */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: 1.5,
                      pt: 1,
                      borderTop: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(255,255,255,0.06)'}`
                    }}
                  >
                    {item.preview_url && (
                      <Button
                        size="small"
                        component="a"
                        href={item.preview_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        startIcon={<ExternalLink size={13} />}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          color: currentTheme?.palette?.textSecondary,
                          '&:hover': { color: currentTheme?.palette?.primary }
                        }}
                      >
                        Official Source
                      </Button>
                    )}

                    <Button
                      variant={isAdded ? 'outlined' : 'contained'}
                      size="small"
                      disabled={isAdded || isAdding}
                      onClick={() => handleAdd(item)}
                      startIcon={
                        isAdding ? (
                          <CircularProgress size={13} color="inherit" />
                        ) : isAdded ? (
                          <CheckCircle size={14} color="#10b981" />
                        ) : (
                          <Plus size={14} />
                        )
                      }
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        borderRadius: 2,
                        px: 2,
                        ...(isAdded
                          ? {
                              borderColor: 'rgba(16, 185, 129, 0.4)',
                              color: '#10b981',
                              bgcolor: 'rgba(16, 185, 129, 0.08)'
                            }
                          : {
                              bgcolor: currentTheme?.palette?.primary || '#3b82f6',
                              color: '#fff',
                              '&:hover': { bgcolor: currentTheme?.palette?.primaryHover || '#2563eb' }
                            })
                      }}
                    >
                      {isAdded ? 'Added to Course' : isAdding ? 'Adding...' : 'Add to Course'}
                    </Button>
                  </Box>
                </Paper>
              );
            })}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: `1px solid ${currentTheme?.palette?.cardBorder || 'rgba(255,255,255,0.1)'}` }}>
        <Button
          onClick={onClose}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            color: currentTheme?.palette?.textSecondary || '#9ca3af'
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

