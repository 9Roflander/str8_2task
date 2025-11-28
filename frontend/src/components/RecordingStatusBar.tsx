'use client';

import { motion } from 'framer-motion';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useEffect, useRef, useState } from 'react';

interface RecordingStatusBarProps {
  isPaused?: boolean;
}

export const RecordingStatusBar: React.FC<RecordingStatusBarProps> = ({ isPaused = false }) => {
  // Get recording duration from backend-synced context (in seconds)
  const { activeDuration, isRecording } = useRecordingState();

  // Local state for smooth, monotonic timer display
  const [displaySeconds, setDisplaySeconds] = useState(0);

  // Remember the last backend sync (duration/ timestamp)
  const lastSyncRef = useRef<{ duration: number; timestamp: number } | null>(null);

  // Sync with backend duration when it changes (handles refresh/navigation)
  useEffect(() => {
    if (activeDuration !== null) {
      lastSyncRef.current = {
        duration: activeDuration,
        timestamp: performance.now(),
      };
      setDisplaySeconds(activeDuration);
    } else {
      lastSyncRef.current = null;
      setDisplaySeconds(0);
    }
  }, [activeDuration]);

  // Live timer that uses requestAnimationFrame for smooth, non-jittery increments
  useEffect(() => {
    if (!isRecording || isPaused) {
      return;
    }

    let rafId: number;

    const tick = () => {
      const syncPoint = lastSyncRef.current;
      if (syncPoint) {
        const elapsed = (performance.now() - syncPoint.timestamp) / 1000;
        const nextValue = syncPoint.duration + elapsed;
        setDisplaySeconds(prev => (nextValue < prev ? prev : nextValue));
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isRecording, isPaused]);

  const formatDuration = (seconds: number): string => {
    const clamped = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(clamped / 60);
    const secs = clamped % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg mb-2"
    >
      <div className={`w-2 h-2 rounded-full ${isPaused ? 'bg-orange-500' : 'bg-red-500 animate-pulse'}`} />
      <span className={`text-sm ${isPaused ? 'text-orange-700' : 'text-gray-700'}`}>
        {isPaused ? 'Paused' : 'Recording'} • {formatDuration(displaySeconds)}
      </span>
    </motion.div>
  );
};
