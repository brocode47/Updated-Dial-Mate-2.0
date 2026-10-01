import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Download,
  AudioWaveform,
  ExternalLink
} from 'lucide-react?deps=react';

export function AudioPlayer({ recordingUrl, durationSec = 0 }) {
  const audioRef = React.useRef(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(durationSec || 0);
  const [playbackRate, setPlaybackRate] = React.useState(1.0);
  const [isMuted, setIsMuted] = React.useState(false);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(Math.round(audio.duration));
      }
    };
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [recordingUrl]);

  if (!recordingUrl) {
    return (
      <div className="p-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <AudioWaveform className="w-4 h-4 text-slate-400" />
          <span>Call audio recording will appear here once finalized by carrier.</span>
        </div>
        <span className="text-[11px] font-mono text-slate-400">Duration: {durationSec}s</span>
      </div>
    );
  }

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  };

  const handleSeek = (e) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const changePlaybackRate = () => {
    const speeds = [1.0, 1.25, 1.5, 2.0];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackRate(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="bg-slate-900 text-white rounded-xl p-4 shadow-md border border-slate-800">
      <audio ref={audioRef} src={recordingUrl} preload="metadata" />

      <div className="flex items-center justify-between gap-4">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white flex items-center justify-center shrink-0 shadow-md transition-all active:scale-95"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 ml-0.5 fill-current" />}
        </button>

        {/* Progress Bar & Waveform representation */}
        <div className="flex-1 space-y-1">
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.1"
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-400"
          />
          <div className="flex justify-between text-[11px] font-mono text-slate-400">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls: Speed, Mute, Download */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={changePlaybackRate}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-mono rounded text-slate-300 transition-colors"
            title="Toggle playback speed"
          >
            {playbackRate}x
          </button>

          <a
            href={recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            download="call_recording.mp3"
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
            title="Download Recording"
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
