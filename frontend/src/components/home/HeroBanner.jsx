import React from 'react';
import {
  Box,
  Paper,
  Avatar,
  Typography,
  Button
} from '@mui/material';
import GoogleIcon from '../common/GoogleIcon';

export default function HeroBanner({
  googleUser,
  userLibrary = [],
  handleGoogleSignIn,
  currentTheme
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2.5, md: 3 },
        mb: 4,
        borderRadius: 3,
        background: currentTheme.palette.headerGradient,
        border: '1px solid rgba(255, 255, 255, 0.12)',
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: { xs: 'flex-start', md: 'center' },
        justifyContent: 'space-between',
        gap: 2,
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)'
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {googleUser?.picture ? (
          <Avatar
            src={googleUser.picture}
            alt={googleUser.name}
            sx={{ width: 56, height: 56, bgcolor: currentTheme.palette.primary, fontWeight: 800, fontSize: '1.4rem' }}
          >
            {(googleUser.name || googleUser.email || 'U').charAt(0).toUpperCase()}
          </Avatar>
        ) : (
          <Box sx={{
            width: 56,
            height: 56,
            borderRadius: 3,
            bgcolor: 'rgba(255, 255, 255, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.8rem'
          }}>
            🎓
          </Box>
        )}
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 1 }}>
            Welcome back, {googleUser ? (googleUser.name ? googleUser.name.split(' ')[0] : (googleUser.email ? googleUser.email.split('@')[0] : 'Scholar')) : 'Scholar'}! 🎓
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.85)', mt: 0.5, fontSize: '0.88rem' }}>
            {googleUser
              ? 'Personal Learning Management System • Verified Study History & Cloud Backups'
              : 'Personal Learning Management System • Instant transcript search, summaries & interactive AI Tutor'}
          </Typography>
        </Box>
      </Box>

      {googleUser ? (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Paper
            elevation={0}
            sx={{
              px: 2.5,
              py: 1.2,
              borderRadius: 2.5,
              bgcolor: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              textAlign: 'center'
            }}
          >
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.9)', display: 'block', fontWeight: 600 }}>Total Lectures</Typography>
            <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 800, lineHeight: 1 }}>{userLibrary.length}</Typography>
          </Paper>
          <Paper
            elevation={0}
            sx={{
              px: 2.5,
              py: 1.2,
              borderRadius: 2.5,
              bgcolor: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              textAlign: 'center'
            }}
          >
            <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.9)', display: 'block', fontWeight: 600 }}>Google Drive Synced</Typography>
            <Typography variant="h6" sx={{ color: '#a7f3d0', fontWeight: 800, lineHeight: 1 }}>
              {userLibrary.filter(x => x.drive_folder_url).length}
            </Typography>
          </Paper>
        </Box>
      ) : (
        <Button
          variant="contained"
          onClick={() => handleGoogleSignIn(false)}
          startIcon={<GoogleIcon />}
          sx={{
            background: '#ffffff',
            color: '#1f2937',
            textTransform: 'none',
            fontWeight: 700,
            fontSize: '0.86rem',
            borderRadius: '20px',
            px: 2.5,
            py: 1,
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            '&:hover': { background: '#f3f4f6' }
          }}
        >
          Sign in with Google
        </Button>
      )}
    </Paper>
  );
}
