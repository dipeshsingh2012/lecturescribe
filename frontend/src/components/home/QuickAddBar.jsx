import React from 'react';
import {
  Paper,
  InputBase,
  Button
} from '@mui/material';
import {
  Video,
  RefreshCw,
  Sparkles
} from 'lucide-react';

export default function QuickAddBar({
  urlInput,
  setUrlInput,
  setCacheNotice,
  handlePasteUrl,
  handleTranscribe,
  loading,
  currentTheme
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: '6px 12px',
        mb: 3,
        borderRadius: 3,
        display: 'flex',
        alignItems: 'center',
        bgcolor: currentTheme.palette.cardBg,
        border: `1px solid ${currentTheme.palette.cardBorder}`,
        boxShadow: currentTheme.palette.cardShadow
      }}
    >
      <Video
        size={22}
        color={currentTheme.palette.textSecondary}
        style={{ marginLeft: 8, marginRight: 12, flexShrink: 0 }}
      />
      <InputBase
        placeholder="Paste any lecture video URL or ID to study & save..."
        value={urlInput}
        onChange={(e) => {
          setUrlInput(e.target.value);
          if (typeof setCacheNotice === 'function') setCacheNotice(null);
        }}
        onPaste={handlePasteUrl}
        onKeyDown={(e) => e.key === 'Enter' && handleTranscribe(urlInput, true)}
        sx={{ flex: 1, color: currentTheme.palette.textPrimary, fontSize: '0.95rem' }}
      />
      <Button
        variant="contained"
        onClick={() => handleTranscribe(urlInput, true)}
        disabled={loading || !urlInput.trim()}
        startIcon={loading ? <RefreshCw className="loading-pulse" size={16} /> : <Sparkles size={16} />}
        sx={{
          bgcolor: currentTheme.palette.primary,
          color: '#ffffff',
          fontWeight: 700,
          textTransform: 'none',
          px: 3,
          py: 1,
          borderRadius: 2,
          '&:hover': { bgcolor: currentTheme.palette.primaryHover }
        }}
      >
        {loading ? 'Ingesting...' : 'Transcribe & Study'}
      </Button>
    </Paper>
  );
}
