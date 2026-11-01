import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Paper,
  Collapse,
  Switch,
  FormControlLabel
} from '@mui/material';
import {
  Zap,
  GraduationCap,
  Flame,
  Sliders,
  Clock,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const PRESETS = [
  {
    id: 'warmup',
    title: 'Quick Warmup',
    badge: '10 Qs • 10m',
    difficulty: 'easy',
    numQuestions: 10,
    timeLimitMinutes: 10,
    timed: true,
    questionTypes: 'mixed',
    icon: Zap,
    color: '#22c55e',
    desc: 'Core definitions, formulas & 1-step direct recall'
  },
  {
    id: 'standard',
    title: 'Standard Exam',
    badge: '20 Qs • 20m',
    difficulty: 'medium',
    numQuestions: 20,
    timeLimitMinutes: 20,
    timed: true,
    questionTypes: 'mixed',
    icon: GraduationCap,
    color: '#f59e0b',
    desc: 'University balance of calculations, failure modes & tradeoffs'
  },
  {
    id: 'mastery',
    title: 'Mastery Challenge',
    badge: '30 Qs • 30m',
    difficulty: 'hard',
    numQuestions: 30,
    timeLimitMinutes: 30,
    timed: true,
    questionTypes: 'mixed',
    icon: Flame,
    color: '#ef4444',
    desc: 'Multi-step derivations, edge cases & diagnostic paradoxes'
  }
];

export default function QuizSettingsSelector({
  settings = {
    difficulty: 'medium',
    numQuestions: 20,
    questionTypes: 'mixed',
    timed: true,
    timeLimitMinutes: 20
  },
  onUpdateSettings,
  themeStyles = {}
}) {
  const {
    primaryColor = '#6366f1',
    cardBorder = 'rgba(255, 255, 255, 0.1)',
    textPrimary = '#f8fafc',
    textSecondary = '#94a3b8'
  } = themeStyles;

  // Detect active preset based on current settings
  const matchingPreset = PRESETS.find(
    (p) =>
      p.difficulty === settings.difficulty &&
      p.numQuestions === settings.numQuestions &&
      p.timed === settings.timed &&
      p.questionTypes === settings.questionTypes
  );

  const [activePresetId, setActivePresetId] = useState(matchingPreset ? matchingPreset.id : 'custom');
  const [showCustomControls, setShowCustomControls] = useState(!matchingPreset);

  const handleSelectPreset = (preset) => {
    setActivePresetId(preset.id);
    if (typeof onUpdateSettings === 'function') {
      onUpdateSettings({
        difficulty: preset.difficulty,
        numQuestions: preset.numQuestions,
        questionTypes: preset.questionTypes,
        timed: preset.timed,
        timeLimitMinutes: preset.timeLimitMinutes
      });
    }
  };

  const handleSelectCustom = () => {
    setActivePresetId('custom');
    setShowCustomControls(true);
  };

  const updateSetting = (key, value) => {
    setActivePresetId('custom');
    if (typeof onUpdateSettings === 'function') {
      const next = { ...settings, [key]: value };
      if (key === 'numQuestions' && next.timed) {
        next.timeLimitMinutes = value; // Default 1 min per question
      }
      onUpdateSettings(next);
    }
  };

  const marksTotal = Number((settings.numQuestions * 0.5).toFixed(1));

  return (
    <Box sx={{ width: '100%', my: 3, textAlign: 'left' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: textPrimary, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Sliders size={16} color={primaryColor} />
          Quiz Complexity & Settings
        </Typography>
        <Chip
          label={`${settings.numQuestions} Qs • ${settings.difficulty.toUpperCase()} • ${settings.timed ? `${settings.timeLimitMinutes || settings.numQuestions}m` : 'Untimed'}`}
          size="small"
          sx={{
            fontWeight: 800,
            fontSize: '0.72rem',
            bgcolor: 'rgba(99, 102, 241, 0.12)',
            color: primaryColor,
            borderRadius: 1.5
          }}
        />
      </Box>

      {/* Preset Cards Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: 1.5,
          mb: 2
        }}
      >
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isSelected = activePresetId === p.id;
          return (
            <Paper
              key={p.id}
              onClick={() => handleSelectPreset(p)}
              elevation={0}
              sx={{
                p: 2,
                borderRadius: 2.5,
                bgcolor: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                border: isSelected ? `2px solid ${p.color}` : `1px solid ${cardBorder}`,
                cursor: 'pointer',
                transition: 'all 0.18s ease-in-out',
                '&:hover': {
                  borderColor: p.color,
                  bgcolor: 'rgba(255, 255, 255, 0.04)',
                  transform: 'translateY(-1px)'
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: `${p.color}1f`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Icon size={16} color={p.color} />
                </Box>
                <Chip
                  label={p.badge}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    bgcolor: `${p.color}15`,
                    color: p.color
                  }}
                />
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 800, color: textPrimary, mb: 0.5 }}>
                {p.title}
              </Typography>
              <Typography variant="caption" sx={{ color: textSecondary, display: 'block', lineHeight: 1.35 }}>
                {p.desc}
              </Typography>
            </Paper>
          );
        })}
      </Box>

      {/* Toggle to Open Custom Settings */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Button
          size="small"
          variant="text"
          onClick={() => {
            if (!showCustomControls) {
              handleSelectCustom();
            } else {
              setShowCustomControls(false);
            }
          }}
          endIcon={showCustomControls ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          sx={{
            textTransform: 'none',
            fontSize: '0.78rem',
            fontWeight: 700,
            color: activePresetId === 'custom' ? primaryColor : textSecondary
          }}
        >
          {showCustomControls ? 'Hide Custom Controls' : 'Customize Quiz Settings'}
        </Button>
      </Box>

      {/* Custom Controls Collapsible Panel */}
      <Collapse in={showCustomControls}>
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: 2.5,
            bgcolor: 'rgba(255, 255, 255, 0.02)',
            border: `1px solid ${cardBorder}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            mb: 2
          }}
        >
          {/* 1. Difficulty Level Selector */}
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: textSecondary, display: 'block', mb: 1 }}>
              DIFFICULTY LEVEL:
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {[
                { id: 'easy', label: 'Easy (Foundational)', color: '#22c55e' },
                { id: 'medium', label: 'Medium (Standard)', color: '#f59e0b' },
                { id: 'hard', label: 'Hard (Mastery)', color: '#ef4444' },
                { id: 'mixed', label: 'Mixed (Bell Curve)', color: '#6366f1' }
              ].map((d) => {
                const isActive = settings.difficulty === d.id;
                return (
                  <Chip
                    key={d.id}
                    label={d.label}
                    onClick={() => updateSetting('difficulty', d.id)}
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      bgcolor: isActive ? `${d.color}25` : 'transparent',
                      color: isActive ? d.color : textSecondary,
                      border: `1px solid ${isActive ? d.color : cardBorder}`,
                      '&:hover': { bgcolor: `${d.color}15` }
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          {/* 2. Question Count Selector */}
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: textSecondary, display: 'block', mb: 1 }}>
              QUESTION COUNT:
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {[
                { count: 10, label: '10 Questions (Quick Warmup • 5.0 Marks)' },
                { count: 20, label: '20 Questions (Standard Exam • 10.0 Marks)' },
                { count: 30, label: '30 Questions (Full Assessment • 15.0 Marks)' }
              ].map((c) => {
                const isActive = settings.numQuestions === c.count;
                return (
                  <Chip
                    key={c.count}
                    label={c.label}
                    onClick={() => updateSetting('numQuestions', c.count)}
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      bgcolor: isActive ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                      color: isActive ? primaryColor : textSecondary,
                      border: `1px solid ${isActive ? primaryColor : cardBorder}`,
                      '&:hover': { bgcolor: 'rgba(99, 102, 241, 0.1)' }
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          {/* 3. Question Types Selector */}
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, color: textSecondary, display: 'block', mb: 1 }}>
              QUESTION TYPES:
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {[
                { id: 'mixed', label: 'Balanced Mix (MCQ + Fill-in)' },
                { id: 'mcq', label: 'Multiple Choice Only (MCQ)' },
                { id: 'fill_in_the_blank', label: 'Fill-in-the-Blank Only' }
              ].map((t) => {
                const isActive = settings.questionTypes === t.id;
                return (
                  <Chip
                    key={t.id}
                    label={t.label}
                    onClick={() => updateSetting('questionTypes', t.id)}
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      bgcolor: isActive ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                      color: isActive ? primaryColor : textSecondary,
                      border: `1px solid ${isActive ? primaryColor : cardBorder}`,
                      '&:hover': { bgcolor: 'rgba(99, 102, 241, 0.1)' }
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          {/* 4. Timer & Pacing Mode */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700, color: textPrimary }}>
                {settings.timed ? `Timed Exam (${settings.timeLimitMinutes || settings.numQuestions} Minutes)` : 'Untimed Practice Mode'}
              </Typography>
              <Typography variant="caption" sx={{ color: textSecondary }}>
                {settings.timed
                  ? 'Includes countdown timer with automatic submission on expiry'
                  : 'No countdown timer. Practice at your own pace without pressure'}
              </Typography>
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(settings.timed)}
                  onChange={(e) => updateSetting('timed', e.target.checked)}
                  color="primary"
                />
              }
              label={
                <Typography variant="caption" sx={{ fontWeight: 700, color: textPrimary }}>
                  {settings.timed ? 'Timer Active' : 'Untimed'}
                </Typography>
              }
            />
          </Box>
        </Paper>
      </Collapse>

      {/* Dynamic Summary Bar */}
      <Box
        sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'rgba(255, 255, 255, 0.02)',
          border: `1px solid ${cardBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1
        }}
      >
        <Typography variant="caption" sx={{ color: textSecondary, fontWeight: 600 }}>
          Configuration: <strong>{settings.numQuestions} Questions</strong> • <strong>{marksTotal} Total Marks</strong> (0.5 mark each) • <strong>{settings.timed ? `${settings.timeLimitMinutes || settings.numQuestions} Mins` : 'Untimed'}</strong>
        </Typography>
        <Chip
          label={`Level: ${settings.difficulty.toUpperCase()}`}
          size="small"
          sx={{
            height: 20,
            fontSize: '0.68rem',
            fontWeight: 800,
            letterSpacing: '0.5px',
            bgcolor:
              settings.difficulty === 'easy'
                ? 'rgba(34, 197, 94, 0.15)'
                : settings.difficulty === 'hard'
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(245, 158, 11, 0.15)',
            color:
              settings.difficulty === 'easy'
                ? '#22c55e'
                : settings.difficulty === 'hard'
                ? '#ef4444'
                : '#f59e0b'
          }}
        />
      </Box>
    </Box>
  );
}

