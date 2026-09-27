import React from 'react';
import { Box, Paper, CircularProgress, Typography } from '@mui/material';

export default function LoadingView({ currentTheme }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', p: 3 }}>
      <Paper
        elevation={0}
        sx={{
          p: 5,
          borderRadius: 4,
          bgcolor: currentTheme.palette.cardBg,
          border: `1px solid ${currentTheme.palette.cardBorder}`,
          textAlign: 'center',
          maxWidth: 420,
          boxShadow: currentTheme.palette.cardShadow
        }}
      >
        <CircularProgress size={48} sx={{ color: currentTheme.palette.primary, mb: 3 }} />
        <Typography variant="h6" sx={{ fontWeight: 800, color: currentTheme.palette.textPrimary, mb: 1 }}>
          Ingesting Lecture...
        </Typography>
        <Typography variant="body2" sx={{ color: currentTheme.palette.textSecondary }}>
          Downloading audio, extracting verbatim captions with timestamps, and training AI Tutor.
        </Typography>
      </Paper>
    </Box>
  );
}
