
import React, { useState, useRef, useEffect } from 'react';
import { BoothState, FilterType } from './types';
import { processWithFilter, createFinalStrip, GET_FILTER_CSS } from './utils/imageUtils';
import { playSFX, createSFX } from './utils/audioUtils';
import BoothExterior from './components/BoothExterior';
import { Download, RefreshCw, Video, Camera, X, Pause, Play, Loader2 } from 'lucide-react';

// --- 音效網址 ---
const SHUTTER_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2857/2857-preview.mp3';
const CURTAIN_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2858/2858-preview.mp3';
const PRINT_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2556/2556-preview.mp3';

const App: React.FC = () => {
  const [state, setState] = useState<BoothState>(BoothState.EXTERIOR);
  const [photos, setPhotos] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number>(0);
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [isFlashActive, setIsFlashActive] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedBlobType, setRecordedBlobType] = useState<string>('');
  const [isMirrored, setIsMirrored] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<FilterType>(FilterType.BERLIN_BW);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  
  const isPausedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const [isPausedUI, setIsPausedUI] = useState(false);

  // 使用 Ref 儲存音效物件以供重用
  const shutterSoundRef = useRef<HTMLAudioElement | null>(null);
  const curtainSoundRef = useRef<HTMLAudioElement | null>(null);
  const printSoundRef = useRef<HTMLAudioElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoSegmentsRef = useRef<Blob[]>([]);
  const segmentRecorderRef = useRef<MediaRecorder | null>(null);

  // 初始化音效物件（僅建立，不播放）
  useEffect(() => {
    shutterSoundRef.current = createSFX(SHUTTER_SOUND_URL);
    curtainSoundRef.current = createSFX(CURTAIN_SOUND_URL);
    printSoundRef.current = createSFX(PRINT_SOUND_URL);
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false 
      });
      streamRef.current = stream;
      return stream;
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Please enable camera permissions to start your photo session.");
      return null;
    }
  };

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(e => console.error("Video play failed:", e));
    }
  }, [state]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const resetBooth = () => {
    if (segmentRecorderRef.current && segmentRecorderRef.current.state !== 'inactive') {
      segmentRecorderRef.current.stop();
    }
    stopCamera();
    setPhotos([]); 
    setFinalImage(null); 
    setRecordedVideoUrl(null);
    videoSegmentsRef.current = []; 
    isPausedRef.current = false;
    isCancelledRef.current = false;
    setIsPausedUI(false);
    setIsDownloading(null);
    setState(BoothState.EXTERIOR);
  };

  const handleEnterBooth = async () => {
    // 進入亭子時順便「解鎖」音效
    if (curtainSoundRef.current) playSFX(curtainSoundRef.current, 0.7);
    const stream = await startCamera();
    if (stream) {
      setState(BoothState.ENTERING);
      setTimeout(() => setState(BoothState.READY), 1500);
    } else {
      setState(BoothState.EXTERIOR);
    }
  };

  const waitControl = async (ms: number) => {
    const startTime = Date.now();
    while (Date.now() - startTime < ms) {
      if (isCancelledRef.current) throw new Error("CANCELLED");
      while (isPausedRef.current) {
        if (isCancelledRef.current) throw new Error("CANCELLED");
        await new Promise(r => setTimeout(r, 50));
      }
      await new Promise(r => setTimeout(r, 50));
    }
  };

  const startShootingSequence = async () => {
    if (!streamRef.current) return;
    isCancelledRef.current = false;
    isPausedRef.current = false;
    setIsPausedUI(false);
    
    // 行動裝置關鍵：在使用者點擊按鈕的瞬間「解鎖」快門音效
    // 播放一個靜音的片刻來取得瀏覽器授權
    if (shutterSoundRef.current) {
      const originalVolume = shutterSoundRef.current.volume;
      shutterSoundRef.current.volume = 0;
      shutterSoundRef.current.play().then(() => {
        shutterSoundRef.current!.pause();
        shutterSoundRef.current!.volume = originalVolume;
      }).catch(() => {});
    }

    const stream = streamRef.current;
    videoSegmentsRef.current = [];
    const captured: string[] = [];
    
    const getMimeType = () => {
      const types = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
      for (const t of types) if (MediaRecorder.isTypeSupported(t)) return t;
      return '';
    };
    const mimeType = getMimeType();

    try {
      for (let i = 0; i < 4; i++) {
        setState(BoothState.COUNTDOWN);
        for (let c = 3; c > 0; c--) {
          setCountdown(c);
          if (c === 3 && mimeType) {
            const chunks: Blob[] = [];
            const rec = new MediaRecorder(stream, { mimeType });
            rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            rec.onstop = () => { videoSegmentsRef.current.push(new Blob(chunks, { type: mimeType })); };
            segmentRecorderRef.current = rec;
            rec.start();
          }
          await waitControl(1000);
        }

        if (segmentRecorderRef.current && segmentRecorderRef.current.state !== 'inactive') {
          segmentRecorderRef.current.stop();
        }
        
        setState(BoothState.SHUTTER);
        // 使用預載且解鎖過的音效物件播放
        if (shutterSoundRef.current) {
          playSFX(shutterSoundRef.current, 0.8);
        } else {
          playSFX(SHUTTER_SOUND_URL, 0.8);
        }

        setIsFlashActive(true);
        if (videoRef.current) {
          const photo = processWithFilter(videoRef.current, selectedFilter, isMirrored);
          captured.push(photo);
          setPhotos([...captured]);
        }
        await waitControl(200);
        setIsFlashActive(false);
        await waitControl(1200);
      }
      setState(BoothState.DEVELOPING);
      stopCamera();
    } catch (err) {
      if (err instanceof Error && err.message === "CANCELLED") {
        resetBooth();
      }
    }
  };

  const createAnimatedStrip = async () => {
    if (videoSegmentsRef.current.length < 4 || !compositeCanvasRef.current) return;
    const canvas = compositeCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const frameWidth = 480; const frameHeight = 360;
    const margin = 30; const spacing = 15; const bottomPadding = 120;
    canvas.width = frameWidth + (margin * 2);
    canvas.height = (frameHeight * 4) + (spacing * 3) + margin + bottomPadding;

    const videos = await Promise.all(videoSegmentsRef.current.map(blob => {
      return new Promise<HTMLVideoElement>((resolve) => {
        const v = document.createElement('video');
        v.src = URL.createObjectURL(blob);
        v.muted = true; v.loop = true; v.playsInline = true;
        v.onloadedmetadata = () => v.play().then(() => resolve(v));
      });
    }));

    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
    const stream = canvas.captureStream(30);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    
    const renderLoop = () => {
      if (recorder.state === 'inactive') return;
      ctx.fillStyle = '#fdfdfd';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      videos.forEach((v, i) => {
        ctx.save();
        ctx.filter = GET_FILTER_CSS(selectedFilter);
        const y = margin + (i * (frameHeight + spacing));
        if (isMirrored) {
          ctx.translate(margin + frameWidth, y);
          ctx.scale(-1, 1);
          ctx.drawImage(v, 0, 0, frameWidth, frameHeight);
        } else {
          ctx.drawImage(v, margin, y, frameWidth, frameHeight);
        }
        ctx.restore();
        ctx.strokeStyle = '#222'; ctx.strokeRect(margin, y, frameWidth, frameHeight);
      });
      ctx.fillStyle = '#888'; ctx.font = '16px "Share Tech Mono"';
      ctx.fillText('PHOTOAUTOMAT // ANIMATED', margin, canvas.height - 40);
      requestAnimationFrame(renderLoop);
    };

    recorder.start(); renderLoop();
    await new Promise(r => setTimeout(r, 4000));
    recorder.stop();

    return new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        setRecordedBlobType(mimeType);
        setRecordedVideoUrl(URL.createObjectURL(blob));
        videos.forEach(v => { v.pause(); URL.revokeObjectURL(v.src); });
        resolve();
      };
    });
  };

  useEffect(() => {
    if (state === BoothState.DEVELOPING) {
      const generate = async () => {
        const strip = await createFinalStrip(photos);
        setFinalImage(strip);
        await createAnimatedStrip();
        setTimeout(() => {
          if (printSoundRef.current) playSFX(printSoundRef.current, 1.0);
          setState(BoothState.RESULT);
        }, 3000);
      };
      generate();
    }
  }, [state, photos]);

  const triggerDownload = (url: string, filename: string, type: 'image' | 'video') => {
    setIsDownloading(type);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    try {
      link.click();
    } catch (e) {
      window.open(url, '_blank');
    }
    setTimeout(() => {
      document.body.removeChild(link);
      setIsDownloading(null);
    }, 1200);
  };

  const abortSession = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    isCancelledRef.current = true;
    if (state === BoothState.READY) {
      resetBooth();
    }
  };

  const isInside = state === BoothState.READY || state === BoothState.COUNTDOWN || state === BoothState.SHUTTER || state === BoothState.DEVELOPING;
  const isShooting = state === BoothState.COUNTDOWN || state === BoothState.SHUTTER;

  return (
    <div className="relative w-full h-screen bg-[#0c0c0c] flex items-center justify-center overflow-hidden">
      <canvas ref={compositeCanvasRef} className="hidden" />
      
      {(state === BoothState.EXTERIOR || state === BoothState.ENTERING || state === BoothState.RESULT) && (
        <div className={`transition-all duration-1000 ${state === BoothState.RESULT ? 'opacity-85 blur-[2px] scale-100' : 'opacity-100 scale-100'}`}>
          <BoothExterior 
            onEnter={handleEnterBooth} 
            isOpening={state === BoothState.ENTERING} 
            photoStrip={finalImage}
            state={state}
          />
        </div>
      )}

      {state === BoothState.RESULT && finalImage && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center pointer-events-none overflow-hidden pb-[15vh]">
             <div className="relative animate-[centerPhysicalDrop_4.5s_cubic-bezier(0.2, 0.8, 0.2, 1)_forwards]">
                <img src={finalImage} alt="Strip" className="h-[65vh] md:h-[70vh] w-auto border-[4px] border-white shadow-[0_50px_150px_rgba(0,0,0,1)] pointer-events-auto" style={{ transform: 'rotate(-4deg)' }} />
             </div>
        </div>
      )}

      {isInside && (
        <div className="relative w-full h-full max-w-5xl md:h-auto md:aspect-[16/11] bg-[#141414] p-4 md:p-10 flex flex-col items-center justify-center shadow-[0_60px_120px_rgba(0,0,0,1)] border border-white/5 animate-[zoomIn_0.6s_ease-out] z-[100]">
          
          {(isShooting || state === BoothState.READY) && (
            <div className="absolute top-4 md:top-8 right-4 md:right-12 flex items-center gap-4 z-[300]">
               {isShooting && (
                 <button 
                  onClick={(e) => { e.stopPropagation(); isPausedRef.current = !isPausedRef.current; setIsPausedUI(isPausedRef.current); }}
                  className={`p-3 md:p-4 rounded-full border transition-all active:scale-90 ${isPausedUI ? 'bg-white text-black border-white' : 'bg-white/5 text-white border-white/20 hover:bg-white/10'}`}
                 >
                   {isPausedUI ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
                 </button>
               )}
               <button 
                onClick={abortSession}
                className="p-3 md:p-4 rounded-full bg-red-600/20 text-red-500 border border-red-500/30 hover:bg-red-600 hover:text-white transition-all active:scale-90"
               >
                 <X size={20} />
               </button>
            </div>
          )}

          <div className="relative w-full aspect-[4/3] max-h-[70vh] bg-black overflow-hidden border-[8px] md:border-[18px] border-white shadow-inner flex items-center justify-center">
            <video 
              ref={videoRef} autoPlay muted playsInline 
              className={`w-full h-full object-cover transition-all duration-300 ${isMirrored ? 'scale-x-[-1]' : 'scale-x-[1]'} ${isPausedUI ? 'grayscale brightness-50' : ''}`}
              style={{ filter: GET_FILTER_CSS(selectedFilter) }}
            />
            
            {isPausedUI && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-[150]">
                 <div className="elegant-font italic text-white text-4xl tracking-[0.2em]">PAUSED</div>
              </div>
            )}

            {state === BoothState.READY && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-md p-6 text-center z-[80] animate-fade-in">
                 <h2 className="elegant-font italic text-white text-2xl md:text-4xl mb-4 md:mb-8 tracking-widest uppercase">Select Style</h2>
                 
                 <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 md:gap-4 mb-8 md:mb-12 w-full max-w-md md:max-w-xl">
                   {Object.values(FilterType).map((fid) => (
                     <button
                        key={fid} onClick={(e) => { e.stopPropagation(); setSelectedFilter(fid); }}
                        className={`py-2 md:py-4 px-1 md:px-3 border-2 transition-all clean-font text-[9px] md:text-xs uppercase tracking-tighter sm:tracking-widest font-bold h-12 md:h-16 flex items-center justify-center ${
                          selectedFilter === fid ? 'bg-white text-black border-white scale-105 shadow-[0_0_15px_rgba(255,255,255,0.3)]' : 'bg-black/40 text-white/50 border-white/10 hover:border-white/30'
                        }`}
                     >
                       {fid.replace('_', ' ')}
                     </button>
                   ))}
                 </div>

                 <button 
                  onClick={(e) => { e.stopPropagation(); startShootingSequence(); }}
                  className="bg-red-600 hover:bg-red-500 text-white px-8 md:px-12 py-4 md:py-6 rounded-full flex items-center gap-3 transition-all active:scale-95 shadow-[0_0_30px_rgba(220,38,38,0.5)] group"
                 >
                   <Camera size={24} className="group-hover:rotate-12 transition-transform" />
                   <span className="elegant-font font-bold text-lg md:text-2xl uppercase tracking-[0.2em]">Start Session</span>
                 </button>
              </div>
            )}
            
            {state === BoothState.COUNTDOWN && !isPausedUI && (
              <div className="absolute inset-0 flex items-center justify-center z-[80] pointer-events-none">
                 <div className="elegant-font italic text-white text-[120px] md:text-[240px] drop-shadow-[0_10px_40px_rgba(0,0,0,0.9)] animate-[pop_0.5s_ease-out]">{countdown}</div>
              </div>
            )}
            <div className={`absolute inset-0 bg-white transition-opacity duration-75 pointer-events-none z-[90] ${isFlashActive ? 'opacity-100' : 'opacity-0'}`} />
          </div>
          
          <div className="w-full flex items-center justify-between px-2 md:px-6 mt-6">
            <div className="flex items-center gap-6">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 md:w-4 md:h-4 rounded-full transition-all ${isShooting && !isPausedUI ? 'bg-red-500 shadow-[0_0_15px_red] scale-125' : 'bg-red-950'}`}></div>
                <span className="clean-font text-[8px] md:text-[9px] text-white/20 uppercase mt-1">REC</span>
              </div>
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 md:w-4 md:h-4 rounded-full ${state === BoothState.READY ? 'bg-green-500 shadow-[0_0_15px_green]' : 'bg-green-950'}`}></div>
                <span className="clean-font text-[8px] md:text-[9px] text-white/20 uppercase mt-1">RDY</span>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="elegant-font text-white/40 text-[9px] md:text-[10px] italic tracking-[0.1em]">Session Progress</span>
              <span className="elegant-font text-white text-lg md:text-5xl tracking-[0.1em] uppercase">
                POSE <span className="font-bold">{photos.length + (state === BoothState.READY ? 0 : 1)}</span> <span className="text-white/20">/</span> 4
              </span>
            </div>
          </div>

          {state === BoothState.DEVELOPING && (
            <div className="absolute inset-0 bg-[#080808] z-[250] flex flex-col items-center justify-center p-6 text-center">
               <div className="elegant-font italic text-white text-3xl md:text-6xl animate-pulse tracking-[0.2em]">Developing...</div>
               <div className="w-full max-w-xs md:max-w-md h-1.5 bg-white/5 rounded-full overflow-hidden mt-8">
                 <div className="h-full bg-white/50 animate-[progress_3s_linear]"></div>
               </div>
               <p className="clean-font text-white/20 text-[10px] uppercase tracking-[0.3em] mt-4">Analog processing in darkroom</p>
            </div>
          )}
        </div>
      )}

      {state === BoothState.RESULT && (
        <div className="fixed bottom-0 left-0 w-full px-4 pb-12 pt-16 flex flex-col items-center gap-6 z-[300] animate-[slideUpUI_1.2s_ease-out_1.2s_both]">
           <div className="flex flex-col sm:flex-row items-center gap-6 p-6 bg-black/85 backdrop-blur-[45px] border border-white/20 rounded-[3rem] shadow-[0_-30px_150px_rgba(0,0,0,1)] ring-1 ring-white/10">
              <button 
                disabled={isDownloading !== null}
                onClick={() => { if(finalImage) triggerDownload(finalImage, `photo-${Date.now()}.png`, 'image'); }} 
                className="w-full sm:w-auto bg-white text-black px-10 py-5 rounded-full flex items-center justify-center gap-3 transition-all active:scale-95 shadow-[0_15px_45px_rgba(255,255,255,0.25)] disabled:opacity-50"
              >
                {isDownloading === 'image' ? <Loader2 size={28} className="animate-spin" /> : <Download size={28} />}
                <span className="elegant-font text-[18px] font-bold uppercase tracking-widest">
                  {isDownloading === 'image' ? 'Saving...' : 'Save Memory'}
                </span>
              </button>
              
              {recordedVideoUrl && (
                <button 
                  disabled={isDownloading !== null}
                  onClick={() => { if(recordedVideoUrl) triggerDownload(recordedVideoUrl, `video-${Date.now()}.mp4`, 'video'); }} 
                  className="w-full sm:w-auto bg-white/10 text-white px-10 py-5 rounded-full flex items-center justify-center gap-3 border border-white/20 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isDownloading === 'video' ? <Loader2 size={28} className="animate-spin text-red-500" /> : <Video size={28} className="text-red-500" />}
                  <span className="elegant-font text-[18px] font-bold uppercase tracking-widest">
                    {isDownloading === 'video' ? 'Saving...' : 'Animated'}
                  </span>
                </button>
              )}
              
              <button onClick={resetBooth} className="bg-white/5 text-white p-6 rounded-full border border-white/10 hover:rotate-180 transition-all">
                <RefreshCw size={32} />
              </button>
           </div>
        </div>
      )}

      <style>{`
        @keyframes centerPhysicalDrop {
          0% { transform: translateY(-120vh); opacity: 0; }
          10% { opacity: 1; }
          100% { transform: translateY(8vh) rotate(-4deg); opacity: 1; }
        }
        @keyframes slideUpUI { from { transform: translateY(300px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes zoomIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes pop { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes progress { from { width: 0%; } to { width: 100%; } }
        .animate-fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
};

export default App;
