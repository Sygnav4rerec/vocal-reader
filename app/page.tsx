'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export default function VocalReader() {
  const [text, setText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(150);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isFinished, setIsFinished] = useState(false);
  const [translateY, setTranslateY] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const translateYRef = useRef(0);
  const wpmRef = useRef(150);
  const wordCountRef = useRef(0);
  const totalScrollRef = useRef(0);

  const WINDOW_HEIGHT = 140;
  const WINDOW_BOTTOM = 72;

  const chunks = text
    .split(/[.!?]+/)
    .map(c => c.trim())
    .filter(c => c.length > 5);

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { wpmRef.current = wpm; }, [wpm]);
  useEffect(() => {
    wordCountRef.current = wordCount;
    totalScrollRef.current = chunks.length * 132 + WINDOW_HEIGHT;
    translateYRef.current = 0;
    setTranslateY(0);
  }, [text, chunks.length, wordCount]);

  const getSpeed = () => {
    if (wordCountRef.current === 0 || totalScrollRef.current === 0) return 0;
    const totalMs = (wordCountRef.current / wpmRef.current) * 60000 * 1.3;
    return totalScrollRef.current / totalMs;
  };

  const tick = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) { lastTimeRef.current = null; return; }
    if (lastTimeRef.current === null) lastTimeRef.current = timestamp;
    const delta = timestamp - lastTimeRef.current;
    lastTimeRef.current = timestamp;

    const speed = getSpeed();
    const next = translateYRef.current - speed * delta;

    if (Math.abs(next) >= totalScrollRef.current) {
      translateYRef.current = -totalScrollRef.current;
      setTranslateY(-totalScrollRef.current);
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsFinished(true);
      return;
    }

    translateYRef.current = next;
    setTranslateY(next);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = null;
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, tick]);

  // Camera
  const startCamera = useCallback(async () => {
    try {
      setCameraError('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraEnabled(true);
    } catch {
      setCameraError('Camera or microphone access denied.');
      setCameraEnabled(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraEnabled(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Pick the best supported mimeType for this browser
  const getSupportedMimeType = () => {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  };

  // Recording
  const startRecording = useCallback(() => {
    if (!streamRef.current) return;

    recordedChunksRef.current = [];
    const mimeType = getSupportedMimeType();

    let mediaRecorder: MediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {});
    } catch {
      setCameraError('Recording not supported in this browser.');
      return;
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const chunks = recordedChunksRef.current;
      if (chunks.length === 0) {
        setCameraError('No recording data captured.');
        setIsRecording(false);
        setRecordingTime(0);
        return;
      }

      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use .webm extension — browser-native, compatible with most editors
      const filename = `rehearsal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);

      setIsRecording(false);
      setRecordingTime(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };

    mediaRecorderRef.current = mediaRecorder;

    // start(1000) = emit ondataavailable every 1 second while recording
    // This is the key fix — without a timeslice, data only arrives on stop
    // which means the blob is empty if stop() is called before first chunk
    mediaRecorder.start(1000);
    setIsRecording(true);
    setRecordingTime(0);

    recordingTimerRef.current = setInterval(() => {
      setRecordingTime(t => t + 1);
    }, 1000);
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  const togglePlay = useCallback(() => {
    if (chunks.length === 0) return;
    setIsFinished(false);
    setIsPlaying(prev => !prev);
  }, [chunks.length]);

  const reset = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    lastTimeRef.current = null;
    translateYRef.current = 0;
    setTranslateY(0);
    setIsPlaying(false);
    setIsFinished(false);
    if (isRecording) stopRecording();
  }, [isRecording, stopRecording]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'Escape') {
        setIsPlaying(false);
        if (isRecording) stopRecording();
      }
      if (e.key.toLowerCase() === 'r' && cameraEnabled) toggleRecording();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleRecording, cameraEnabled, isRecording, stopRecording]);

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col overflow-hidden">
      <header className="border-b border-zinc-800 px-6 py-4 flex-shrink-0 z-50 relative bg-zinc-950">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Vocal Reader</h1>
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="text-zinc-400 hover:text-white text-sm px-3 py-1 rounded border border-zinc-700 hover:border-zinc-500 transition"
            >
              {isSidebarOpen ? 'Hide Input' : 'Show Input'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => cameraEnabled ? stopCamera() : startCamera()}
              className={`flex items-center gap-2 text-sm px-4 py-2 rounded-xl border transition-all ${
                cameraEnabled
                  ? 'bg-amber-400 border-amber-400 text-zinc-950 font-semibold'
                  : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500'
              }`}
            >
              📷 {cameraEnabled ? 'Camera On' : 'Use Camera'}
            </button>

            {cameraEnabled && (
              <button
                onClick={toggleRecording}
                className={`flex items-center gap-2 text-sm px-4 py-2 rounded-xl border transition-all font-semibold ${
                  isRecording
                    ? 'bg-red-500 border-red-500 text-white animate-pulse'
                    : 'border-red-500/50 text-red-400 hover:bg-red-500/10 hover:border-red-500'
                }`}
              >
                {isRecording ? `⏹ Stop • ${formatTime(recordingTime)}` : '⏺ Record Rehearsal'}
              </button>
            )}

            {cameraError && <span className="text-red-400 text-xs">{cameraError}</span>}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden max-w-7xl mx-auto w-full">
        {isSidebarOpen && (
          <div className="w-96 border-r border-zinc-800 p-6 flex-shrink-0 flex flex-col bg-zinc-950 z-40">
            <h2 className="text-lg font-medium mb-4">Your Script</h2>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); reset(); }}
              placeholder="Paste your Ted Talk, podcast script, or rehearsal text here..."
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-2xl p-5 text-base leading-relaxed resize-none focus:outline-none focus:border-amber-400 font-light"
            />
            <div className="mt-5 flex gap-3">
              <button
                onClick={togglePlay}
                disabled={chunks.length === 0}
                className="flex-1 bg-amber-400 hover:bg-amber-300 disabled:bg-zinc-700 text-zinc-950 font-semibold py-3 rounded-2xl text-base transition-all active:scale-[0.98]"
              >
                {isFinished ? '↩ Restart' : isPlaying ? '⏸ Pause' : '▶ Start Rehearsal'}
              </button>
              <button onClick={reset} className="px-6 bg-zinc-800 hover:bg-zinc-700 rounded-2xl transition-all text-sm">
                Reset
              </button>
            </div>
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2 text-zinc-400">
                <span>Reading Speed</span>
                <span className="font-mono text-amber-400">{wpm} WPM</span>
              </div>
              <input
                type="range" min="80" max="280" step="10" value={wpm}
                onChange={(e) => setWpm(Number(e.target.value))}
                className="w-full accent-amber-400"
              />
              <div className="flex justify-between text-xs text-zinc-500 mt-1">
                <span>Slow • Natural pauses</span><span>Fast delivery</span>
              </div>
            </div>
            {wordCount > 0 && (
              <div className="mt-5 text-center font-mono text-xs text-zinc-500">
                {wordCount} words • ~{Math.round(wordCount / wpm)} min at {wpm} WPM
              </div>
            )}
          </div>
        )}

        {/* Teleprompter Stage */}
        <div className="flex-1 relative overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ display: cameraEnabled ? 'block' : 'none', transform: 'scaleX(-1)' }}
          />

          <div
            className="absolute inset-0 transition-all duration-500"
            style={{ background: cameraEnabled ? 'rgba(0,0,0,0.45)' : '#09090b' }}
          />

          {/* Recording indicator on stage */}
          {isRecording && (
            <div className="absolute top-4 right-4 z-40 flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400 text-xs font-mono font-semibold">{formatTime(recordingTime)}</span>
            </div>
          )}

          {/* Fixed clipped text window */}
          <div
            className="absolute left-0 right-0 z-20"
            style={{ bottom: WINDOW_BOTTOM, height: WINDOW_HEIGHT, overflow: 'hidden' }}
          >
            <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
              style={{ height: '40%', background: 'linear-gradient(to bottom, rgba(0,0,0,0.95) 0%, transparent 100%)' }} />
            <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none"
              style={{ height: '30%', background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, transparent 100%)' }} />

            {chunks.length === 0 ? (
              <div className="h-full flex items-center justify-center text-zinc-500 text-center text-sm px-8">
                Paste your script and press Start Rehearsal
              </div>
            ) : (
              <div
                className="absolute left-0 right-0 px-6 text-center"
                style={{
                  transform: `translateY(${translateY + WINDOW_HEIGHT}px)`,
                  willChange: 'transform',
                }}
              >
                <div className="max-w-3xl mx-auto space-y-8">
                  {chunks.map((chunk, idx) => (
                    <p
                      key={idx}
                      className="text-xl leading-relaxed tracking-wide font-light text-white inline-block px-5 py-2 rounded-xl"
                      style={{ background: 'rgba(0,0,0,0.72)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}
                    >
                      {chunk}.
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="absolute z-30 text-center text-xs text-zinc-600 pointer-events-none"
            style={{ bottom: WINDOW_BOTTOM - 22, left: 0, right: 0 }}>
            Spacebar = Play / Pause • R = Record • Esc = Stop
          </div>
        </div>
      </div>
    </div>
  );
}