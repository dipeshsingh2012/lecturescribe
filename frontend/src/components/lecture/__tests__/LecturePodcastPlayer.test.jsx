import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LecturePodcastPlayer from '../LecturePodcastPlayer';

describe('LecturePodcastPlayer Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders initial state and fetches existing podcast status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { exists: false }
      })
    });

    render(
      <LecturePodcastPlayer
        videoId="test-vid-123"
        title="Intro to AI"
        mode="study"
        summaryText="Sample lecture summary text."
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Podcast Audio Recap/i)).toBeInTheDocument();
    expect(screen.getByText(/Single Narrator • Google TTS/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generate Podcast Audio/i })).toBeInTheDocument();
    });
  });

  it('handles generating podcast audio and displays playback controls', async () => {
    // 1st call: GET podcast status (not found)
    // 2nd call: POST generate podcast (returns ready)
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success', data: { exists: false } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            exists: true,
            status: 'ready',
            video_id: 'test-vid-123',
            script: 'Welcome to LectureScribe. Today we discuss AI.',
            audio_url: '/api/lectures/test-vid-123/podcast/stream?mode=study'
          }
        })
      });

    const onClose = vi.fn();
    render(
      <LecturePodcastPlayer
        videoId="test-vid-123"
        title="Intro to AI"
        mode="study"
        summaryText="Sample lecture summary text."
        onClose={onClose}
      />
    );

    const genBtn = await screen.findByRole('button', { name: /Generate Podcast Audio/i });
    fireEvent.click(genBtn);

    // After generation, player controls appear
    const playBtn = await screen.findByRole('button', { name: /Play podcast/i });
    expect(playBtn).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Skip back 10 seconds/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip forward 10 seconds/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Podcast audio scrubber/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Playback speed 1x/i })).toBeInTheDocument();
  });

  it('cycles playback speed and triggers onClose', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          exists: true,
          status: 'ready',
          video_id: 'test-vid-123',
          audio_url: '/api/lectures/test-vid-123/podcast/stream?mode=study'
        }
      })
    });

    const onClose = vi.fn();
    render(
      <LecturePodcastPlayer
        videoId="test-vid-123"
        title="Intro to AI"
        mode="study"
        summaryText="Sample text."
        onClose={onClose}
      />
    );

    const speedBtn = await screen.findByRole('button', { name: /Playback speed 1x/i });
    fireEvent.click(speedBtn);
    expect(screen.getByRole('button', { name: /Playback speed 1.25x/i })).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /Close audio player/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('polls status every 5 seconds when status is generating until ready', async () => {
    vi.useFakeTimers();

    global.fetch = vi.fn()
      // Initial mount check -> generating
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          data: { exists: false, status: 'generating' }
        })
      })
      // 2nd poll check after 5s -> still generating
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          data: { exists: false, status: 'generating' }
        })
      })
      // 3rd poll check after 10s -> ready
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            exists: true,
            status: 'ready',
            video_id: 'test-vid-123',
            audio_url: '/api/lectures/test-vid-123/podcast/stream?mode=study'
          }
        })
      });

    render(
      <LecturePodcastPlayer
        videoId="test-vid-123"
        title="Intro to AI"
        mode="study"
        summaryText="Sample text."
        onClose={vi.fn()}
      />
    );

    // Initial check triggers generating indicator
    await vi.waitFor(() => {
      expect(screen.getByText(/Synthesizing Single-Narrator Podcast/i)).toBeInTheDocument();
    });

    // Advance 5 seconds -> polls second time
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Advance 5 more seconds -> polls third time and becomes ready
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Play podcast/i })).toBeInTheDocument();
    });

    vi.useRealTimers();
  });
});

