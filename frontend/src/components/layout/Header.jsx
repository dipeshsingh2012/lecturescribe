import React from 'react';
import {
  Box,
  Button,
  IconButton,
  Avatar,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  Typography,
  Divider
} from '@mui/material';
import {
  Search,
  Bot,
  Cloud,
  Folder,
  LogOut
} from 'lucide-react';
import { ProtonThemeSelector } from '@dipesh.singh/proton';
import { LMS_THEMES } from '../../store/themeStore';
import GoogleIcon from '../common/GoogleIcon';

export default function Header({
  activeData,
  activeTab,
  setActiveTab,
  openDownloadModal,
  googleUser,
  handleGoogleSignIn,
  handleGoogleSignOut,
  handleBackToHub,
  userLibrary = [],
  userMenuAnchor,
  setUserMenuAnchor,
  currentThemeId,
  setTheme,
  currentTheme
}) {
  return (
    <header style={{
      background: currentTheme.palette.headerGradient || currentTheme.palette.headerBg,
      color: currentTheme.palette.headerText || '#ffffff',
      borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
      padding: '0 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '62px',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '1.15rem' }}>
        <span
          style={{ color: '#ffffff', fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.3px', cursor: 'pointer' }}
          onClick={handleBackToHub}
        >
          LearnScribe LMS
        </span>
      </div>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {activeData && (
          <>
            <div style={{
              display: 'flex',
              gap: '4px',
              background: 'rgba(0, 0, 0, 0.2)',
              padding: '4px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.15)'
            }}>
              <button
                onClick={() => setActiveTab('transcript')}
                style={{
                  background: activeTab === 'transcript' ? '#ffffff' : 'transparent',
                  color: activeTab === 'transcript' ? currentTheme.palette.headerBg : 'rgba(255, 255, 255, 0.85)',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                <Search size={15} /> Search Transcript
              </button>
              <button
                onClick={() => setActiveTab('tutor')}
                style={{
                  background: activeTab === 'tutor' ? '#ffffff' : 'transparent',
                  color: activeTab === 'tutor' ? currentTheme.palette.headerBg : 'rgba(255, 255, 255, 0.85)',
                  border: 'none',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s ease'
                }}
              >
                <Bot size={16} /> AI Tutor
              </button>
            </div>

            <button
              onClick={() => openDownloadModal()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.16)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                padding: '6px 14px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
                transition: 'all 0.2s ease'
              }}
            >
              <Cloud size={15} /> Save to Google Drive
            </button>
          </>
        )}

        {/* LMS Theme Selector from Proton (only for signed-in users) */}
        {googleUser && (
          <ProtonThemeSelector
            themes={LMS_THEMES}
            currentThemeId={currentThemeId}
            onSelectTheme={(themeId) => setTheme(themeId)}
            title="LMS Theme Selector"
            subtitle="Authentic campus & higher-ed LMS palettes"
          />
        )}

        {/* Top-Right Google Sign-In or User Profile Menu */}
        {!googleUser ? (
          <Button
            variant="contained"
            onClick={() => handleGoogleSignIn(false)}
            startIcon={<GoogleIcon />}
            sx={{
              background: '#ffffff',
              color: '#1f2937',
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.84rem',
              borderRadius: '20px',
              padding: '5px 14px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              '&:hover': { background: '#f3f4f6' }
            }}
          >
            Sign in with Google
          </Button>
        ) : (
          <>
            <Tooltip title={`${googleUser.name || 'Google User'} (${googleUser.email})`}>
              <IconButton
                onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                sx={{ p: 0.5, border: '2px solid rgba(255, 255, 255, 0.6)', '&:hover': { borderColor: '#ffffff' } }}
              >
                <Avatar
                  alt={googleUser.name || googleUser.email}
                  src={googleUser.picture}
                  sx={{ width: 34, height: 34, bgcolor: currentTheme.palette.primary, fontSize: '0.85rem', fontWeight: 700 }}
                >
                  {(googleUser.name || googleUser.email || 'U').charAt(0).toUpperCase()}
                </Avatar>
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={userMenuAnchor}
              open={Boolean(userMenuAnchor)}
              onClose={() => setUserMenuAnchor(null)}
              PaperProps={{
                sx: {
                  bgcolor: currentTheme.palette.cardBg,
                  color: currentTheme.palette.textPrimary,
                  border: `1px solid ${currentTheme.palette.cardBorder}`,
                  boxShadow: currentTheme.palette.cardShadow,
                  minWidth: 240,
                  borderRadius: 2,
                  mt: 1.5,
                  p: 1
                }
              }}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#f8fafc' }}>
                  {googleUser.name || 'Google Scholar'}
                </Typography>
                <Typography variant="caption" sx={{ color: '#94a3b8', wordBreak: 'break-all', display: 'block' }}>
                  {googleUser.email}
                </Typography>
              </Box>
              <Divider sx={{ my: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }} />
              <MenuItem
                onClick={() => {
                  setUserMenuAnchor(null);
                  handleBackToHub();
                }}
                sx={{ borderRadius: 1, py: 1 }}
              >
                <ListItemIcon>
                  <Folder size={18} color={currentTheme.palette.primary} />
                </ListItemIcon>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  My Lecture Library ({userLibrary.length})
                </Typography>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setUserMenuAnchor(null);
                  if (activeData) openDownloadModal();
                }}
                disabled={!activeData}
                sx={{ borderRadius: 1, py: 1 }}
              >
                <ListItemIcon>
                  <Cloud size={18} color="#10b981" />
                </ListItemIcon>
                <Typography variant="body2">
                  Google Drive Sync Active
                </Typography>
              </MenuItem>
              <Divider sx={{ my: 1, borderColor: currentTheme.palette.cardBorder }} />
              <MenuItem
                onClick={() => {
                  setUserMenuAnchor(null);
                  handleGoogleSignOut();
                }}
                sx={{ borderRadius: 1, py: 1, color: '#dc2626' }}
              >
                <ListItemIcon>
                  <LogOut size={18} color="#dc2626" />
                </ListItemIcon>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Sign Out
                </Typography>
              </MenuItem>
            </Menu>
          </>
        )}
      </Box>
    </header>
  );
}
