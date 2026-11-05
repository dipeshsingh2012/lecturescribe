import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import MathRenderer from '../common/MathRenderer';
import { parseTimestampToSeconds } from '../../utils/formatters';
import { useTranscriptAppearanceStore, FONT_COLORS, FONT_FAMILIES } from '../../store/transcriptAppearanceStore';

/**
 * On-video cue / subtitle overlay modeled after Prime Video, YouTube, and Udemy.
 * Synchronizes with video playback time, renders KaTeX math formulas, avoids player
 * controls collision, and provides touch-friendly replay capability.
 */
export default function VideoCueOverlay({
  cues = [],
  currentTime = 0,
  activeCueIdx = null,
  showControls = true,
  isPlaying = false,
  visible = true,
  onCueClick = null,
  appearance = null
}) {
  const storeAppearance = useTranscriptAppearanceStore();
  const effectiveAppearance = appearance || storeAppearance;

  // Resolve the active cue using currentTime or fallback to activeCueIdx
  const resolvedCue = useMemo(() => {
    if (!visible || !Array.isArray(cues) || cues.length === 0) return null;

    let matchIdx = -1;
    // Find the latest cue whose start time is <= currentTime
    for (let i = cues.length - 1; i >= 0; i--) {
      const cueSec = parseTimestampToSeconds(cues[i]?.time);
      if (currentTime >= cueSec) {
        matchIdx = i;
        break;
      }
    }

    // Fallback to activeCueIdx if within range
    if (matchIdx === -1 && typeof activeCueIdx === 'number' && activeCueIdx >= 0 && activeCueIdx < cues.length) {
      matchIdx = activeCueIdx;
    }

    if (matchIdx === -1) return null;

    const cue = cues[matchIdx];
    if (!cue || !cue.text || !cue.text.trim()) return null;

    const currentCueSec = parseTimestampToSeconds(cue.time);
    const nextCue = cues[matchIdx + 1];
    const nextCueSec = nextCue?.time ? parseTimestampToSeconds(nextCue.time) : Infinity;

    // Silence handling: Estimate max display duration based on word count.
    // Minimum 5 seconds, roughly 0.35s per word, capped at 14s.
    // If the next cue begins sooner, display until next cue begins.
    const wordCount = (cue.text.match(/\S+/g) || []).length;
    const estimatedDuration = Math.max(5, Math.min(14, wordCount * 0.35 + 2));
    const effectiveDisplayDuration = Math.min(
      nextCueSec > currentCueSec ? (nextCueSec - currentCueSec) : estimatedDuration,
      estimatedDuration
    );

    // If we've passed the effective reading duration and there's a prolonged pause, fade out
    if (currentTime > currentCueSec + effectiveDisplayDuration && (nextCueSec - currentCueSec) > 8) {
      return null;
    }

    return cue;
  }, [visible, cues, currentTime, activeCueIdx]);

  if (!resolvedCue) {
    return null;
  }

  // Handle color / font overrides
  const matchedColor = FONT_COLORS.find(c => c.id === effectiveAppearance?.fontColor);
  const fontColor = matchedColor?.value || (effectiveAppearance?.fontColor === 'yellow' ? '#facc15' : '#f8fafc');

  const matchedFamily = FONT_FAMILIES.find(f => f.id === effectiveAppearance?.fontFamily);
  const fontFamily = matchedFamily?.value && matchedFamily.id !== 'sans' ? matchedFamily.value : 'inherit';

  // Collision avoidance with player controls
  // When controls are visible (or video is paused), float higher so progress bar is clear.
  // When controls hide, float close to the bottom.
  const bottomOffset = (showControls || !isPlaying)
    ? { xs: '68px', sm: '76px' }
    : { xs: '14px', sm: '18px' };

  const handlePillClick = (e) => {
    e.stopPropagation();
    if (typeof onCueClick === 'function' && resolvedCue.time) {
      onCueClick(resolvedCue.time);
    }
  };

  return (
    <Box
      data-testid="video-cue-overlay"
      role="region"
      aria-label="Video captions"
      aria-live="polite"
      onClick={handlePillClick}
      title={onCueClick ? `Replay from [${resolvedCue.time}]` : undefined}
      sx={{
        position: 'absolute',
        bottom: bottomOffset,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: { xs: '92%', sm: '86%', md: '80%' },
        width: 'max-content',
        px: { xs: 1.5, sm: 2 },
        py: { xs: 0.7, sm: 0.9 },
        borderRadius: '8px',
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.65)',
        color: fontColor,
        fontFamily,
        textAlign: 'center',
        zIndex: 9,
        cursor: onCueClick ? 'pointer' : 'default',
        userSelect: 'none',
        pointerEvents: 'auto',
        transition: 'bottom 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, transform 0.15s ease',
        '&:hover': onCueClick ? {
          background: 'rgba(15, 23, 42, 0.95)',
          borderColor: 'rgba(255, 255, 255, 0.32)'
        } : {},
        '&:active': onCueClick ? {
          transform: 'translateX(-50%) scale(0.98)'
        } : {}
      }}
    >
      <Box
        sx={{
          fontSize: { xs: '0.84rem', sm: '0.94rem', md: '1.02rem' },
          lineHeight: 1.35,
          fontWeight: 500,
          letterSpacing: '0.01em',
          textShadow: '0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.75)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
          '& .cue-math-expression': {
            color: 'inherit',
            fontWeight: 600
          }
        }}
      >
        <MathRenderer text={resolvedCue.text} />
      </Box>
    </Box>
  );
}
