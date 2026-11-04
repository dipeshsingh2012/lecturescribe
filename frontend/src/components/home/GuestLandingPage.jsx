import React from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { BookOpen, FileText, Search, Sparkles } from 'lucide-react';

const learningTools = [
  {
    icon: FileText,
    title: 'Clear lecture notes',
    description: 'Turn long lectures into readable summaries and study notes.'
  },
  {
    icon: Search,
    title: 'Find the moment',
    description: 'Search transcripts and jump straight to the relevant point.'
  },
  {
    icon: Sparkles,
    title: 'Study with AI',
    description: 'Explore course material with an interactive AI tutor.'
  }
];

export default function GuestLandingPage({ currentTheme }) {
  const palette = currentTheme.palette;

  return (
    <Box
      component="main"
      sx={{
        maxWidth: 1200,
        width: '100%',
        mx: 'auto',
        px: { xs: 2, sm: 3, md: 5 },
        py: { xs: 4, md: 8 }
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.05fr 0.95fr' },
          alignItems: 'center',
          gap: { xs: 4, md: 8 },
          mb: { xs: 6, md: 9 }
        }}
      >
        <Box>
          <Chip
            icon={<BookOpen size={15} />}
            label="A better place to study"
            sx={{
              mb: 2.5,
              bgcolor: palette.badgeBg,
              color: palette.badgeColor,
              border: `1px solid ${palette.badgeBorder}`,
              fontWeight: 700,
              '& .MuiChip-icon': { color: palette.primary }
            }}
          />
          <Typography
            component="h1"
            sx={{
              color: palette.textPrimary,
              fontSize: { xs: '2.5rem', sm: '3.2rem', md: '3.8rem' },
              fontWeight: 800,
              letterSpacing: '-0.045em',
              lineHeight: 1.08,
              maxWidth: 650,
              mb: 2.5
            }}
          >
            Make every lecture easier to learn.
          </Typography>
          <Typography
            sx={{
              color: palette.textSecondary,
              fontSize: { xs: '1rem', md: '1.15rem' },
              lineHeight: 1.75,
              maxWidth: 590
            }}
          >
            LectureScribe is your personal AI-assisted learning management system,
            bringing searchable transcripts, clear summaries, and study tools into one place.
          </Typography>
        </Box>

        <Paper
          elevation={0}
          sx={{
            p: { xs: 2.5, sm: 3.5 },
            borderRadius: 4,
            bgcolor: palette.cardBg,
            border: `1px solid ${palette.cardBorder}`,
            boxShadow: palette.cardShadow,
            transform: { md: 'rotate(1deg)' }
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
            <Box
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: 42,
                height: 42,
                borderRadius: 2,
                bgcolor: palette.badgeBg,
                color: palette.primary
              }}
            >
              <BookOpen size={21} />
            </Box>
            <Box>
              <Typography sx={{ color: palette.textPrimary, fontWeight: 800 }}>
                Your learning workspace
              </Typography>
              <Typography variant="caption" sx={{ color: palette.textSecondary }}>
                Everything connected to your courses
              </Typography>
            </Box>
          </Box>

          <Paper
            elevation={0}
            sx={{
              p: 2,
              mb: 1.5,
              borderRadius: 2.5,
              bgcolor: palette.panelBg || palette.bgDark,
              border: `1px solid ${palette.cardBorder}`
            }}
          >
            <Typography variant="overline" sx={{ color: palette.primary, fontWeight: 800 }}>
              LECTURE TRANSCRIPT
            </Typography>
            <Typography sx={{ color: palette.textPrimary, fontWeight: 600, mt: 0.5 }}>
              Key ideas, ready when you need them.
            </Typography>
            <Box sx={{ mt: 1.5, display: 'grid', gap: 0.8 }}>
              {[0.92, 0.76, 0.58].map((width, index) => (
                <Box
                  key={index}
                  sx={{
                    width: `${width * 100}%`,
                    height: 7,
                    borderRadius: 4,
                    bgcolor: palette.cardBorder
                  }}
                />
              ))}
            </Box>
          </Paper>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            {['Study summary', 'Ask your AI tutor'].map((label, index) => (
              <Box
                key={label}
                sx={{
                  p: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  borderRadius: 2.5,
                  bgcolor: palette.badgeBg,
                  color: palette.badgeColor,
                  fontSize: '0.82rem',
                  fontWeight: 700
                }}
              >
                {index === 0 ? <FileText size={17} /> : <Sparkles size={17} />}
                {label}
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>

      <Box>
        <Typography
          component="h2"
          sx={{
            color: palette.textPrimary,
            fontSize: { xs: '1.4rem', md: '1.7rem' },
            fontWeight: 800,
            mb: 0.75
          }}
        >
          Built around the way you learn
        </Typography>
        <Typography sx={{ color: palette.textSecondary, mb: 3.5 }}>
          Spend less time searching and more time understanding.
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
            gap: 2
          }}
        >
          {learningTools.map(({ icon: Icon, title, description }) => (
            <Paper
              key={title}
              elevation={0}
              sx={{
                p: 2.5,
                borderRadius: 3,
                bgcolor: palette.cardBg,
                border: `1px solid ${palette.cardBorder}`
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 40,
                  height: 40,
                  mb: 2,
                  borderRadius: 2,
                  bgcolor: palette.badgeBg,
                  color: palette.primary
                }}
              >
                <Icon size={20} />
              </Box>
              <Typography sx={{ color: palette.textPrimary, fontWeight: 750, mb: 0.75 }}>
                {title}
              </Typography>
              <Typography variant="body2" sx={{ color: palette.textSecondary, lineHeight: 1.65 }}>
                {description}
              </Typography>
            </Paper>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
