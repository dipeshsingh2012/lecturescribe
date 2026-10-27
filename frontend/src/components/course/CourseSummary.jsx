import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Chip,
  Paper,
  Divider,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Checkbox,
  FormControlLabel
} from '@mui/material';
import {
  Sparkles,
  BookOpen,
  RotateCcw,
  Copy,
  Check,
  CheckCircle2,
  Video,
  ChevronDown,
  Layers,
  Calculator,
  CheckSquare,
  ListOrdered
} from 'lucide-react';
import MarkdownWithTimestamps from '../common/MarkdownWithTimestamps';

export default function CourseSummary({
  courseName = 'Active Course',
  lectureCount = 0,
  summaryData,
  loading = false,
  error = null,
  fetchSummary,
  regenerateSummary,
  isTutor = true,
  handleSelectLecture,
  currentTheme
}) {
  const [copied, setCopied] = useState(false);
  const [checkedItems, setCheckedItems] = useState({});

  const primaryColor = currentTheme?.palette?.primary || '#6366f1';
  const cardBg = currentTheme?.palette?.cardBg || '#1e293b';
  const cardBorder = currentTheme?.palette?.cardBorder || 'rgba(255, 255, 255, 0.1)';
  const textPrimary = currentTheme?.palette?.textPrimary || '#f8fafc';
  const textSecondary = currentTheme?.palette?.textSecondary || '#94a3b8';

  const toggleCheck = (idx) => {
    setCheckedItems(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const formatFormulaForDisplay = (str) => {
    if (!str || typeof str !== 'string') return '';
    const trimmed = str.trim();
    if (!trimmed) return '';
    if (
      (trimmed.startsWith('$') && trimmed.endsWith('$')) ||
      (trimmed.startsWith('\\[') && trimmed.endsWith('\\]'))
    ) {
      return trimmed;
    }
    if (/\\(?:frac|sum|prod|mathcal|mathbb|mathbf|sqrt|int|alpha|beta|sigma|theta|lambda|mu|hat|vec|partial|le|ge|cdot|times|big|Big|left|right)\b/.test(trimmed)) {
      return `$$${trimmed}$$`;
    }
    return trimmed;
  };

  const normalizeFormulas = (rawList) => {
    if (!Array.isArray(rawList)) return [];
    return rawList.map((item) => {
      if (typeof item === 'string') {
        return {
          term: 'Key Formula / Definition',
          name: 'Key Formula / Definition',
          formula_or_def: item,
          formula: item,
          significance: '',
          description: ''
        };
      }
      const term =
        item?.term ||
        item?.name ||
        item?.title ||
        item?.concept ||
        item?.formula_name ||
        item?.topic ||
        'Core Concept';
      const formula_or_def =
        item?.formula_or_def ||
        item?.formula ||
        item?.equation ||
        item?.definition ||
        item?.math ||
        item?.rule ||
        item?.expression ||
        item?.content ||
        '';
      const significance =
        item?.significance ||
        item?.description ||
        item?.explanation ||
        item?.notes ||
        item?.meaning ||
        item?.context ||
        '';
      return {
        term,
        name: term,
        formula_or_def,
        formula: formula_or_def,
        significance,
        description: significance
      };
    });
  };

  const rawFormulas =
    summaryData?.core_formulas_and_definitions ||
    summaryData?.formulas_and_definitions ||
    summaryData?.formulas ||
    summaryData?.core_equations ||
    summaryData?.key_formulas ||
    [];
  const core_formulas_and_definitions = normalizeFormulas(rawFormulas);

  const handleCopyMarkdown = () => {
    if (!summaryData) return;
    const lines = [];
    lines.push(`# ${summaryData.course_name || courseName} - Executive Course Summary\n`);
    if (summaryData.executive_summary) {
      lines.push(`## Executive Summary\n${summaryData.executive_summary}\n`);
    }

    if (summaryData.thematic_modules?.length) {
      lines.push(`## Thematic Modules\n`);
      summaryData.thematic_modules.forEach((mod, i) => {
        lines.push(`### Module ${i + 1}: ${mod.module_title}`);
        if (mod.lectures_covered?.length) {
          lines.push(`*Lectures: ${mod.lectures_covered.join(', ')}*`);
        }
        lines.push(`\n${mod.core_themes}\n`);
        if (mod.key_takeaways?.length) {
          lines.push(`**Key Takeaways:**`);
          mod.key_takeaways.forEach(kt => lines.push(`- ${kt}`));
          lines.push('');
        }
      });
    }

    if (core_formulas_and_definitions?.length) {
      lines.push(`## Core Formulas & Definitions\n`);
      core_formulas_and_definitions.forEach(fd => {
        lines.push(`- **${fd.term}**: ${fd.formula_or_def}`);
        if (fd.significance) {
          lines.push(`  *Significance:* ${fd.significance}`);
        }
      });
      lines.push('');
    }

    if (summaryData.lecture_summaries?.length) {
      lines.push(`## Lecture-by-Lecture Breakdown\n`);
      summaryData.lecture_summaries.forEach((ls, i) => {
        lines.push(`### ${ls.lecture_title || `Lecture ${i + 1}`}`);
        if (ls.synopsis) lines.push(`${ls.synopsis}\n`);
        if (ls.key_points?.length) {
          ls.key_points.forEach(kp => lines.push(`- ${kp}`));
          lines.push('');
        }
      });
    }

    if (summaryData.master_exam_checklist?.length) {
      lines.push(`## Master Exam Checklist\n`);
      summaryData.master_exam_checklist.forEach(item => {
        lines.push(`- [ ] ${item}`);
      });
      lines.push('');
    }

    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 1. Initial State: No summary yet
  if (!summaryData && !loading) {
    return (
      <Box
        sx={{
          flex: 1,
          width: '100%',
          py: 6,
          px: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          maxWidth: 860,
          mx: 'auto'
        }}
      >
        <Paper
          elevation={0}
          sx={{
            maxWidth: 580,
            width: '100%',
            p: { xs: 3, sm: 5 },
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            textAlign: 'center',
            boxShadow: currentTheme?.palette?.cardShadow || '0 8px 32px rgba(0, 0, 0, 0.25)'
          }}
        >
          <Box
            sx={{
              width: 68,
              height: 68,
              borderRadius: '50%',
              bgcolor: 'rgba(99, 102, 241, 0.15)',
              color: primaryColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 2.5
            }}
          >
            <BookOpen size={36} />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: textPrimary, mb: 1 }}>
            {courseName} Course Summary
          </Typography>
          <Typography variant="body2" sx={{ color: textSecondary, mb: 3.5, lineHeight: 1.6, maxWidth: 480, mx: 'auto' }}>
            Synthesize an executive curriculum overview across all {lectureCount > 0 ? lectureCount : ''} lectures.
            Generates thematic modules, core definitions, mathematical formulas, lecture synopses, and an exam checklist.
          </Typography>

          {error && (
            <Alert
              severity="error"
              sx={{ mb: 3, textAlign: 'left' }}
              action={
                typeof regenerateSummary === 'function' ? (
                  <Button color="inherit" size="small" onClick={() => regenerateSummary()} disabled={loading}>
                    Retry
                  </Button>
                ) : typeof fetchSummary === 'function' ? (
                  <Button color="inherit" size="small" onClick={() => fetchSummary(true)} disabled={loading}>
                    Retry
                  </Button>
                ) : null
              }
            >
              {error}
            </Alert>
          )}

          <Button
            variant="contained"
            size="large"
            onClick={() => (typeof regenerateSummary === 'function' ? regenerateSummary() : fetchSummary && fetchSummary(true))}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <Sparkles size={18} />}
            sx={{
              bgcolor: primaryColor,
              color: '#fff',
              fontWeight: 700,
              textTransform: 'none',
              px: 4,
              py: 1.4,
              borderRadius: 2.5,
              fontSize: '0.95rem',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
              '&:hover': { bgcolor: primaryColor, opacity: 0.9 }
            }}
          >
            Generate Course Summary
          </Button>
        </Paper>
      </Box>
    );
  }

  // 2. Loading State
  if (loading) {
    return (
      <Box
        sx={{
          flex: 1,
          width: '100%',
          py: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2.5
        }}
      >
        <CircularProgress size={44} sx={{ color: primaryColor }} />
        <Typography variant="h6" sx={{ fontWeight: 700, color: textPrimary }}>
          Synthesizing Course-Level Summary...
        </Typography>
        <Typography variant="body2" sx={{ color: textSecondary, maxWidth: 440, textAlign: 'center', lineHeight: 1.5 }}>
          Condensing lecture notes, key formulas, and thematic modules across <strong>{courseName}</strong> into a structured study guide.
        </Typography>
      </Box>
    );
  }

  const {
    executive_summary,
    thematic_modules = summaryData?.modules || [],
    lecture_summaries = summaryData?.lectures || summaryData?.synopses || [],
    master_exam_checklist = summaryData?.checklist || summaryData?.exam_checklist || []
  } = summaryData || {};

  return (
    <Box sx={{ width: '100%', py: { xs: 1.5, sm: 3 }, px: { xs: 0.5, sm: 1 }, maxWidth: '100%' }}>
      {/* Top Action Header */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'center' },
          mb: 3,
          gap: 1.5
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: textPrimary, fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
              Course Executive Summary
            </Typography>
            <Chip
              label={`${lectureCount || lecture_summaries.length} lectures condensed`}
              size="small"
              sx={{
                bgcolor: 'rgba(99, 102, 241, 0.12)',
                color: primaryColor,
                fontWeight: 700,
                fontSize: '0.75rem'
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: textSecondary, display: 'block', lineHeight: 1.4 }}>
            Complete thematic roadmap, formulas, and master exam checklist for {courseName}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: { xs: '100%', sm: 'auto' } }}>
          <Button
            size="small"
            variant="outlined"
            onClick={handleCopyMarkdown}
            startIcon={copied ? <Check size={14} color="#22c55e" /> : <Copy size={14} />}
            sx={{
              flex: { xs: 1, sm: 'none' },
              minHeight: 38,
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.78rem',
              borderRadius: 2,
              borderColor: cardBorder,
              color: copied ? '#22c55e' : textPrimary,
              '&:hover': { borderColor: primaryColor }
            }}
          >
            {copied ? 'Copied Markdown' : 'Copy Summary'}
          </Button>

          {typeof regenerateSummary === 'function' && (
            <Tooltip title="Regenerate summary from latest lecture notes">
              <Button
                size="small"
                variant="contained"
                onClick={() => regenerateSummary()}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <RotateCcw size={14} />}
                sx={{
                  flex: { xs: 1, sm: 'none' },
                  minHeight: 38,
                  bgcolor: primaryColor,
                  color: '#fff',
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.78rem',
                  borderRadius: 2,
                  '&:hover': { bgcolor: primaryColor, opacity: 0.9 }
                }}
              >
                {loading ? 'Regenerating...' : 'Regenerate'}
              </Button>
            </Tooltip>
          )}
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            typeof regenerateSummary === 'function' ? (
              <Button color="inherit" size="small" onClick={() => regenerateSummary()} disabled={loading}>
                Retry
              </Button>
            ) : typeof fetchSummary === 'function' ? (
              <Button color="inherit" size="small" onClick={() => fetchSummary(true)} disabled={loading}>
                Retry
              </Button>
            ) : null
          }
        >
          {error}
        </Alert>
      )}

      {/* 1. Executive Summary Card */}
      {executive_summary && (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, sm: 3.5 },
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            mb: 3,
            boxShadow: currentTheme?.palette?.cardShadow || '0 4px 20px rgba(0,0,0,0.1)'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <BookOpen size={20} color={primaryColor} />
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: textPrimary }}>
              Executive Overview
            </Typography>
          </Box>
          <Typography
            component="div"
            sx={{
              color: textPrimary,
              lineHeight: 1.7,
              fontSize: '0.95rem',
              '& p': { mb: 1.5 },
              '& p:last-child': { mb: 0 }
            }}
          >
            <MarkdownWithTimestamps
              content={executive_summary}
              text={executive_summary}
              onTimestampClick={(ts) => handleSelectLecture && handleSelectLecture(null, courseName, ts)}
              onCueClick={(ts) => handleSelectLecture && handleSelectLecture(null, courseName, ts)}
            />
          </Typography>
        </Paper>
      )}

      {/* 2. Thematic Modules */}
      {thematic_modules.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, sm: 3.5 },
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            mb: 3,
            boxShadow: currentTheme?.palette?.cardShadow || '0 4px 20px rgba(0,0,0,0.1)'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
            <Layers size={20} color={primaryColor} />
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: textPrimary }}>
              Thematic Course Modules
            </Typography>
            <Chip
              label={`${thematic_modules.length} modules`}
              size="small"
              sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'rgba(99, 102, 241, 0.12)', color: primaryColor }}
            />
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {thematic_modules.map((mod, i) => (
              <Box
                key={i}
                sx={{
                  p: 2.5,
                  borderRadius: 2.5,
                  bgcolor: 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${cardBorder}`
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: textPrimary, fontSize: '0.98rem' }}>
                    {mod.module_title}
                  </Typography>
                  {mod.lectures_covered?.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
                      {mod.lectures_covered.map((lec, lIdx) => (
                        <Chip
                          key={lIdx}
                          label={lec}
                          size="small"
                          sx={{ fontSize: '0.7rem', fontWeight: 600, bgcolor: 'rgba(255, 255, 255, 0.06)', color: textSecondary }}
                        />
                      ))}
                    </Box>
                  )}
                </Box>

                <Typography variant="body2" sx={{ color: textSecondary, mb: 2, lineHeight: 1.6 }}>
                  {mod.core_themes}
                </Typography>

                {mod.key_takeaways?.length > 0 && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: textPrimary, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Key Takeaways:
                    </Typography>
                    {mod.key_takeaways.map((takeaway, tIdx) => (
                      <Box key={tIdx} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                        <CheckCircle2 size={15} color={primaryColor} style={{ marginTop: 2, flexShrink: 0 }} />
                        <Typography variant="body2" sx={{ color: textPrimary, fontSize: '0.88rem', lineHeight: 1.5 }}>
                          {takeaway}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* 3. Core Formulas & Definitions */}
      {core_formulas_and_definitions.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, sm: 3.5 },
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            mb: 3,
            boxShadow: currentTheme?.palette?.cardShadow || '0 4px 20px rgba(0,0,0,0.1)'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
            <Calculator size={20} color={primaryColor} />
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: textPrimary }}>
              Core Formulas & Definitions
            </Typography>
            <Chip
              label={`${core_formulas_and_definitions.length} formulas`}
              size="small"
              sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'rgba(99, 102, 241, 0.12)', color: primaryColor }}
            />
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            {core_formulas_and_definitions.map((item, idx) => {
              const term = item.term || item.name || 'Core Formula';
              const formula = item.formula_or_def || item.formula || '';
              const significance = item.significance || item.description || '';
              return (
                <Box
                  key={idx}
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: 'rgba(255, 255, 255, 0.02)',
                    border: `1px solid ${cardBorder}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, color: primaryColor, fontSize: '0.92rem' }}>
                    {term}
                  </Typography>
                  {formula ? (
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 1.5,
                        bgcolor: 'rgba(0, 0, 0, 0.25)',
                        border: `1px solid rgba(255, 255, 255, 0.05)`,
                        overflowX: 'auto'
                      }}
                    >
                      <Typography component="div" sx={{ fontFamily: 'monospace', fontSize: '0.88rem', color: textPrimary }}>
                        <MarkdownWithTimestamps content={formatFormulaForDisplay(formula)} text={formatFormulaForDisplay(formula)} />
                      </Typography>
                    </Box>
                  ) : null}
                  {significance && (
                    <Typography variant="caption" sx={{ color: textSecondary, lineHeight: 1.4, mt: 0.5 }}>
                      <strong>Significance:</strong> {significance}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Paper>
      )}

      {/* 4. Lecture-by-Lecture Breakdown */}
      {lecture_summaries.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, sm: 3.5 },
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            mb: 3,
            boxShadow: currentTheme?.palette?.cardShadow || '0 4px 20px rgba(0,0,0,0.1)'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
            <ListOrdered size={20} color={primaryColor} />
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: textPrimary }}>
              Lecture-by-Lecture Synopsis
            </Typography>
            <Chip
              label={`${lecture_summaries.length} lectures`}
              size="small"
              sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: 'rgba(99, 102, 241, 0.12)', color: primaryColor }}
            />
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {lecture_summaries.map((lec, idx) => (
              <Accordion
                key={lec.lecture_id || idx}
                defaultExpanded={idx === 0}
                sx={{
                  bgcolor: 'rgba(255, 255, 255, 0.02)',
                  border: `1px solid ${cardBorder}`,
                  borderRadius: '10px !important',
                  '&:before': { display: 'none' },
                  boxShadow: 'none',
                  overflow: 'hidden'
                }}
              >
                <AccordionSummary
                  expandIcon={<ChevronDown size={18} color={textSecondary} />}
                  sx={{
                    px: { xs: 1.5, sm: 2 },
                    '& .MuiAccordionSummary-content': {
                      minWidth: 0,
                      overflow: 'hidden',
                      my: 1
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap', width: '100%', minWidth: 0 }}>
                    <Chip
                      icon={<Video size={13} style={{ marginLeft: 6, flexShrink: 0 }} />}
                      label={lec.lecture_title || `Lecture ${idx + 1}`}
                      size="small"
                      onClick={
                        lec.lecture_id && handleSelectLecture
                          ? (e) => {
                              e.stopPropagation();
                              handleSelectLecture(lec.lecture_id, courseName);
                            }
                          : undefined
                      }
                      sx={{
                        bgcolor: 'rgba(99, 102, 241, 0.15)',
                        color: primaryColor,
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        cursor: lec.lecture_id && handleSelectLecture ? 'pointer' : 'default',
                        maxWidth: '100%',
                        height: 'auto',
                        py: 0.5,
                        '& .MuiChip-label': {
                          whiteSpace: 'normal',
                          wordBreak: 'break-word',
                          lineHeight: 1.35,
                          px: 1
                        },
                        '&:hover': lec.lecture_id && handleSelectLecture ? { opacity: 0.85 } : {}
                      }}
                    />
                    {lec.lecture_id && handleSelectLecture && (
                      <Typography variant="caption" sx={{ color: textSecondary, fontSize: '0.72rem', alignSelf: 'center', mt: { xs: 0.5, sm: 0 } }}>
                        (Click badge to jump to lecture)
                      </Typography>
                    )}
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 2.5, px: { xs: 1.5, sm: 2.5 } }}>
                  {lec.synopsis && (
                    <Typography variant="body2" sx={{ color: textPrimary, mb: 2, lineHeight: 1.6 }}>
                      {lec.synopsis}
                    </Typography>
                  )}
                  {lec.key_points?.length > 0 && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: textSecondary, textTransform: 'uppercase' }}>
                        Core Takeaways:
                      </Typography>
                      {lec.key_points.map((pt, pIdx) => (
                        <Box key={pIdx} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                          <Box
                            sx={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              bgcolor: primaryColor,
                              mt: 0.9,
                              flexShrink: 0
                            }}
                          />
                          <Typography variant="body2" sx={{ color: textSecondary, fontSize: '0.85rem', lineHeight: 1.5 }}>
                            {pt}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        </Paper>
      )}

      {/* 5. Master Exam Checklist */}
      {master_exam_checklist.length > 0 && (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, sm: 3.5 },
            borderRadius: 3,
            bgcolor: cardBg,
            border: `1px solid ${cardBorder}`,
            boxShadow: currentTheme?.palette?.cardShadow || '0 4px 20px rgba(0,0,0,0.1)'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CheckSquare size={20} color={primaryColor} />
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: textPrimary }}>
                Master Exam Study Checklist
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: textSecondary, fontWeight: 700 }}>
              {Object.values(checkedItems).filter(Boolean).length} / {master_exam_checklist.length} Completed
            </Typography>
          </Box>

          <Typography variant="body2" sx={{ color: textSecondary, mb: 2.5, fontSize: '0.85rem' }}>
            Check off key competencies and concepts as you prepare for midterms and final exams.
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {master_exam_checklist.map((item, idx) => {
              const isChecked = Boolean(checkedItems[idx]);
              return (
                <Box
                  key={idx}
                  onClick={() => toggleCheck(idx)}
                  sx={{
                    p: { xs: 1.25, sm: 1.5 },
                    minHeight: 44,
                    borderRadius: 2,
                    bgcolor: isChecked ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                    border: `1px solid ${isChecked ? 'rgba(34, 197, 94, 0.3)' : cardBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    '&:hover': {
                      bgcolor: isChecked ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255, 255, 255, 0.05)'
                    }
                  }}
                >
                  <Checkbox
                    checked={isChecked}
                    size="small"
                    sx={{
                      p: 0,
                      color: textSecondary,
                      '&.Mui-checked': { color: '#22c55e' }
                    }}
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      color: isChecked ? '#22c55e' : textPrimary,
                      textDecoration: isChecked ? 'line-through' : 'none',
                      fontSize: '0.9rem',
                      lineHeight: 1.4,
                      flex: 1
                    }}
                  >
                    {item}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Paper>
      )}
    </Box>
  );
}

