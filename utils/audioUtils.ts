
/**
 * 建立並預載音效物件，用於在使用者互動時「解鎖」行動裝置音效
 */
export const createSFX = (url: string): HTMLAudioElement => {
  const audio = new Audio();
  audio.src = url;
  audio.preload = 'auto';
  // 重要：行動裝置有時需要 crossOrigin 權限才能正常播放
  audio.crossOrigin = 'anonymous';
  audio.load();
  return audio;
};

/**
 * 播放音效工具函式
 * @param audioOrUrl 音效物件或網址
 * @param volume 音量 (0.0 到 1.0)
 */
export const playSFX = (audioOrUrl: string | HTMLAudioElement, volume: number = 0.5) => {
  try {
    let audio: HTMLAudioElement;
    
    if (typeof audioOrUrl === 'string') {
      audio = new Audio(audioOrUrl);
      audio.crossOrigin = 'anonymous';
    } else {
      audio = audioOrUrl;
    }

    // 確保音量與進度正確
    audio.volume = volume;
    audio.currentTime = 0;
    
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        console.warn("Audio playback failed (interaction required):", e);
      });
    }
    return audio;
  } catch (error) {
    console.error("Failed to play sound:", error);
    return null;
  }
};

export const stopSFX = (audio: HTMLAudioElement | null) => {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
};
