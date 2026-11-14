import { toUserMessage } from '@/lib/user-message';
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

export const useAudioPlayer = (audioPath: string | null) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const rafRef = useRef<number>();
  const seekTimeRef = useRef<number>(0);

  const mountedRef = useRef(false);
  const loadVersionRef = useRef(0);
  const playbackVersionRef = useRef(0);

  const initAudioContext = async (isCurrent: () => boolean) => {
    try {
      if (!audioRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioRef.current = new AudioContextClass();
      }

      if (audioRef.current.state === 'suspended') {
        await audioRef.current.resume();
      }
      
      if (!isCurrent()) return false;
      return true;
    } catch (error) {
      console.error('Error initializing AudioContext:', error);
      if (isCurrent()) setError(toUserMessage(error, '无法初始化音频播放，请重试。'));
      return false;
    }
  };

  // Cleanup function
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadVersionRef.current += 1;
      playbackVersionRef.current += 1;
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      if (sourceRef.current) {
        sourceRef.current.onended = null;
        try { sourceRef.current.stop(); } catch { /* Already stopped. */ }
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      const context = audioRef.current;
      audioRef.current = null;
      if (context && context.state !== 'closed') {
        void context.close().catch(error => console.warn('Failed to close audio context:', error));
      }
    };
  }, []);

  const loadAudio = async (version: number) => {
    const isCurrent = () => mountedRef.current && version === loadVersionRef.current;
    if (!audioPath) {
      return;
    }

    try {
      // Initialize context first
      const initialized = await initAudioContext(isCurrent);
      if (!isCurrent()) return;
      if (!initialized || !audioRef.current) {
        console.error('Failed to initialize audio context');
        return;
      }

      
      // Read the file using Tauri command
      const result = await invoke<number[]>('read_audio_file', { 
        filePath: audioPath 
      });
      
      if (!isCurrent()) return;
      if (!result || result.length === 0) {
        throw new Error('Empty audio data received');
      }
      
      
      // Create a copy of the audio data
      const audioData = new Uint8Array(result).buffer;
      
      
      // Decode the audio data
      const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        audioRef.current!.decodeAudioData(
          audioData,
          buffer => {
            resolve(buffer);
          },
          error => {
            console.error('Audio decoding failed:', error);
            reject(new Error('Failed to decode audio data: ' + error));
          }
        );
      });
      
      if (!isCurrent()) return;
      audioBufferRef.current = audioBuffer;
      setDuration(audioBuffer.duration);
      setCurrentTime(0);
      setError(null);
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Error loading audio:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
      }
      setError(toUserMessage(error, '无法读取录音文件，请检查文件后重试。'));
    }
  };

  // Load audio when path changes
  useEffect(() => {
    const version = ++loadVersionRef.current;
    stopPlayback();
    audioBufferRef.current = null;
    seekTimeRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    if (audioPath) void loadAudio(version);
    return () => { loadVersionRef.current += 1; playbackVersionRef.current += 1; };
  }, [audioPath]);

  const stopPlayback = () => {
    playbackVersionRef.current += 1;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try {
        sourceRef.current.stop();
        sourceRef.current.disconnect();
      } catch { /* The source may already have ended. */ }
      sourceRef.current = null;
    }
    if (mountedRef.current) setIsPlaying(false);
  };

  const play = async () => {
    const version = ++playbackVersionRef.current;
    
    try {
      // Initialize context if needed
      const initialized = await initAudioContext(() => mountedRef.current && version === playbackVersionRef.current);
      if (!mountedRef.current || version !== playbackVersionRef.current) return;
      if (!initialized) {
        throw new Error('Audio context initialization failed');
      }
      if (!audioRef.current) {
        throw new Error('Audio context is null after initialization');
      }
      if (!audioBufferRef.current) {
        throw new Error('No audio buffer loaded - try loading the audio file first');
      }
      if (audioRef.current.state !== 'running') {
        throw new Error(`Audio context is in invalid state: ${audioRef.current.state}`);
      }

      // Stop any existing playback
      stopPlayback();

      // Create and setup new source
      sourceRef.current = audioRef.current.createBufferSource();
      sourceRef.current.buffer = audioBufferRef.current;
      
      
      sourceRef.current.connect(audioRef.current.destination);
      
      // Setup ended callback
      sourceRef.current.onended = () => {
        stopPlayback();
        setCurrentTime(0);
      };
      
      // Start playback from the seek time
      const startTime = seekTimeRef.current;
      startTimeRef.current = audioRef.current.currentTime - startTime;
      
      sourceRef.current.start(0, startTime);
      setIsPlaying(true);
      setError(null);

      // Setup time update
      const updateTime = () => {
        if (!audioRef.current || !sourceRef.current) {
          return;
        }
        
        const newTime = audioRef.current.currentTime - startTimeRef.current;
        
        if (newTime >= duration) {
          stopPlayback();
          setCurrentTime(0);
          seekTimeRef.current = 0;
        } else {
          setCurrentTime(newTime);
          seekTimeRef.current = newTime;
          rafRef.current = requestAnimationFrame(updateTime);
        }
      };
      
      rafRef.current = requestAnimationFrame(updateTime);
    } catch (error) {
      if (!mountedRef.current) return;
      console.error('Error during playback:', error);
      setError(toUserMessage(error, '无法播放录音，请重试。'));
      stopPlayback();
    }
  };

  const seek = async (time: number) => {
    if (time < 0) time = 0;
    if (time > duration) time = duration;
    
    const wasPlaying = isPlaying;
    
    // Stop current playback
    stopPlayback();
    
    // Update both current time and seek time reference
    seekTimeRef.current = time;
    setCurrentTime(time);
    
    // If it was playing before, restart playback at new position
    if (wasPlaying) {
      await play();
    }
  };

  const pause = () => {
    stopPlayback();
  };

  return {
    isPlaying,
    currentTime,
    duration,
    error,
    play,
    pause,
    seek
  };
};
