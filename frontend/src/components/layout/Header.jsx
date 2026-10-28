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
  HelpCircle,
  FileText,
  Cloud,
  Folder,
  LogOut,
  Check,
  GraduationCap,
  ShieldCheck,
  ArrowLeftRight,
  Calendar as CalendarIcon
} from 'lucide-react';
import { ProtonThemeSelector } from '@dipesh.singh/proton';
import { LMS_THEMES } from '../../store/themeStore';
import GoogleIcon from '../common/GoogleIcon';
import GoogleDriveIcon from '../common/GoogleDriveIcon';

export default function Header({
  activeData,
  activeTab,
  setActiveTab,
  summaryOutdated,
  openDownloadModal,
  googleUser,
  userRole = 'student',
  onSwitchRole,
  handleGoogleSignIn,
  handleGoogleSignOut,
  handleBackToHub,
  handleNavigateHome,
  onNavigateCalendar,
  isCalendarPage = false,
  userLibrary = [],
  userMenuAnchor,
  setUserMenuAnchor,
  currentThemeId,
  setTheme,
  currentTheme
}) {
  const onHomeClick = handleNavigateHome || handleBackToHub;
  const isTutor = userRole === 'tutor';

  return (
    <header className="app-header" style={{
      background: currentTheme.palette.headerGradient || currentTheme.palette.headerBg,
      color: currentTheme.palette.headerText || '#ffffff',
      borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '62px',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
      paddingTop: 'var(--safe-top, 0px)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700 }}>
        <span
          className="app-brand-title"
          onClick={onHomeClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onHomeClick?.();
            }
          }}
        >
          LearnScribe LMS
        </span>
      </div>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 0.75 } }}>
        {activeData && (
          <>
            <Box sx={{
              display: { xs: 'none', md: 'flex' },
              gap: '3px',
              background: 'rgba(0, 0, 0, 0.2)',
              padding: '3px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.15)'
            }}>
              <button
                aria-label="Lecture Summary"
                onClick={() => setActiveTab('summary')}
                style={{
                  background: activeTab === 'summary' ? '#ffffff' : 'transparent',
                  color: activeTab === 'summary' ? currentTheme.palette.headerBg : 'rgba(255, 255, 255, 0.85)',
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.2s ease'
                }}
              >
                <FileText size={15} /> Summary
                {(summaryOutdated || activeData?.is_outdated || activeData?.summary_outdated) && (
                  <span
                    title="Transcript cues modified — summary may be outdated"
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      backgroundColor: '#f59e0b',
                      boxShadow: '0 0 6px #f59e0b',
                      display: 'inline-block'
                    }}
                  />
                )}
              </button>
              <button
                aria-label="AI Tutor"
                onClick={() => setActiveTab('tutor')}
                style={{
                  background: activeTab === 'tutor' ? '#ffffff' : 'transparent',
                  color: activeTab === 'tutor' ? currentTheme.palette.headerBg : 'rgba(255, 255, 255, 0.85)',
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.2s ease'
                }}
              >
                <Bot size={16} /> AI Tutor
              </button>
              <button
                onClick={() => setActiveTab('quiz')}
                style={{
                  background: activeTab === 'quiz' ? '#ffffff' : 'transparent',
                  color: activeTab === 'quiz' ? currentTheme.palette.headerBg : 'rgba(255, 255, 255, 0.85)',
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.2s ease'
                }}
              >
                <HelpCircle size={15} /> Quiz
              </button>
              <button
                aria-label="Search Transcript"
                onClick={() => setActiveTab('transcript')}
                style={{
                  background: activeTab === 'transcript' ? '#ffffff' : 'transparent',
                  color: activeTab === 'transcript' ? currentTheme.palette.headerBg : 'rgba(255, 255, 255, 0.85)',
                  border: 'none',
                  padding: '5px 10px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.2s ease'
                }}
              >
                <Search size={15} /> Search
              </button>
            </Box>

            {(() => {
              const driveFolderUrl = (
                activeData?.drive_folder_url ||
                activeData?.driveFolderUrl ||
                userLibrary?.find(l => String(l.video_id) === String(activeData?.videoId))?.drive_folder_url ||
                userLibrary?.find(l => String(l.video_id) === String(activeData?.videoId))?.driveFolderUrl
              );

              return (
                <Tooltip
                  title={driveFolderUrl ? "Saved in Google Drive — Click to view folder or upload details" : "Save to Google Drive"}
                  arrow
                >
                  <button
                    onClick={() => openDownloadModal()}
                    aria-label={driveFolderUrl ? "Saved in Google Drive" : "Save to Google Drive"}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      background: driveFolderUrl ? 'rgba(16, 185, 129, 0.22)' : 'rgba(255, 255, 255, 0.16)',
                      color: '#ffffff',
                      border: driveFolderUrl ? '1px solid rgba(16, 185, 129, 0.6)' : '1px solid rgba(255, 255, 255, 0.3)',
                      padding: '5px 8px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      height: '34px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = driveFolderUrl ? 'rgba(16, 185, 129, 0.32)' : 'rgba(255, 255, 255, 0.26)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = driveFolderUrl ? 'rgba(16, 185, 129, 0.22)' : 'rgba(255, 255, 255, 0.16)';
                    }}
                  >
                    <GoogleDriveIcon size={18} />
                    {driveFolderUrl && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: '-2px',
                          right: '-2px',
                          background: '#10b981',
                          borderRadius: '50%',
                          width: '12px',
                          height: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                          border: '1.5px solid #000'
                        }}
                        title="Saved in Drive"
                      >
                        <Check size={8} color="#ffffff" strokeWidth={3.5} />
                      </span>
                    )}
                  </button>
                </Tooltip>
              );
            })()}
          </>
        )}

        {/* Global Full Calendar Navigation Button (Desktop only, mobile has bottom bar) */}
        {googleUser && !activeData && typeof onNavigateCalendar === 'function' && (
          <Tooltip title="Open Full Academic Calendar & AI Exam Schedule" arrow>
            <Button
              size="small"
              onClick={onNavigateCalendar}
              startIcon={<CalendarIcon size={15} />}
              sx={{
                display: { xs: 'none', md: 'inline-flex' },
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                borderRadius: '8px',
                px: 1,
                py: 0.4,
                color: isCalendarPage ? currentTheme.palette.headerBg : '#ffffff',
                bgcolor: isCalendarPage ? '#ffffff' : 'rgba(255, 255, 255, 0.14)',
                border: '1px solid rgba(255, 255, 255, 0.28)',
                '&:hover': {
                  bgcolor: isCalendarPage ? '#f8fafc' : 'rgba(255, 255, 255, 0.24)'
                }
              }}
            >
              Calendar
            </Button>
          </Tooltip>
        )}

        {/* LMS Theme Selector from Proton (only for signed-in users) */}
        {googleUser && (
          <ProtonThemeSelector
            themes={LMS_THEMES}
            currentThemeId={currentThemeId}
            onSelectTheme={(themeId) => setTheme(themeId)}
            title="LMS Theme Selector"
            subtitle="Authentic campus & higher-ed LMS palettes"
            triggerSx={{
              '& .MuiTypography-root': { display: 'none !important' },
              minWidth: 'auto',
              px: 0.6,
              py: 0.4
            }}
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
              padding: '4px 10px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              '&:hover': { background: '#f3f4f6' }
            }}
          >
            Sign in with Google
          </Button>
        ) : (
          <>
            <Tooltip title={isTutor ? "Tutor Mode (Instructor capabilities enabled) — Click to switch to Student view" : "Student Mode (Learner view) — Click to switch to Tutor view"}>
              <button
                type="button"
                data-testid="header-role-badge"
                aria-label={`Active role: ${isTutor ? 'Tutor' : 'Student'}`}
                onClick={() => typeof onSwitchRole === 'function' && onSwitchRole(isTutor ? 'student' : 'tutor')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  borderRadius: '16px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: typeof onSwitchRole === 'function' ? 'pointer' : 'default',
                  background: isTutor ? 'rgba(16, 185, 129, 0.22)' : 'rgba(255, 255, 255, 0.16)',
                  color: '#ffffff',
                  border: isTutor ? '1px solid rgba(16, 185, 129, 0.65)' : '1px solid rgba(255, 255, 255, 0.3)',
                  transition: 'all 0.2s ease'
                }}
              >
                {isTutor ? <ShieldCheck size={14} color="#34d399" /> : <GraduationCap size={14} />}
                <span>{isTutor ? 'Tutor' : 'Student'}</span>
              </button>
            </Tooltip>

            <Tooltip title={`${googleUser.name || 'Google User'} (${googleUser.email})`}>
              <IconButton
                onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                sx={{ p: 0.35, border: '2px solid rgba(255, 255, 255, 0.6)', '&:hover': { borderColor: '#ffffff' } }}
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
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.3 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#f8fafc' }}>
                    {googleUser.name || 'Google Scholar'}
                  </Typography>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: '10px',
                      backgroundColor: isTutor ? 'rgba(16, 185, 129, 0.18)' : 'rgba(59, 130, 246, 0.18)',
                      color: isTutor ? '#34d399' : '#60a5fa',
                      border: isTutor ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(59, 130, 246, 0.4)',
                      textTransform: 'uppercase'
                    }}
                  >
                    {isTutor ? 'Tutor' : 'Student'}
                  </span>
                </Box>
                <Typography variant="caption" sx={{ color: '#94a3b8', wordBreak: 'break-all', display: 'block' }}>
                  {googleUser.email}
                </Typography>
              </Box>
              <Divider sx={{ my: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }} />
              {typeof onSwitchRole === 'function' && (
                <MenuItem
                  data-testid="menu-switch-role"
                  onClick={() => {
                    onSwitchRole(isTutor ? 'student' : 'tutor');
                    setUserMenuAnchor(null);
                  }}
                  sx={{ borderRadius: 1, py: 1 }}
                >
                  <ListItemIcon>
                    <ArrowLeftRight size={18} color={isTutor ? '#60a5fa' : '#10b981'} />
                  </ListItemIcon>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {isTutor ? 'Switch to Student View' : 'Switch to Tutor View'}
                  </Typography>
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  setUserMenuAnchor(null);
                  onHomeClick?.();
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
