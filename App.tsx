
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
  const [isMirrored, setIsMirrored] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<FilterType>(FilterType.BERLIN_BW);
  const [isDownloading, setIsDownloading] = useState<'image' | 'video' | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  
  const isPausedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const [isPausedUI, setIsPausedUI] = useState(false);

  const shutterSoundRef = useRef<HTMLAudioElement | null>(null);
  const curtainSoundRef = useRef<HTMLAudioElement | null>(null);
  const printSoundRef = useRef<HTMLAudioElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoSegmentsRef = useRef<Blob[]>([]);
  const segmentRecorderRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    shutterSoundRef.current = createSFX(SHUTTER_SOUND_URL);
    curtainSoundRef.current = createSFX(CURTAIN_SOUND_URL);
    printSoundRef.current = createSFX(PRINT_SOUND_URL);
  }, []);

  const startCamera = async () => {
    if (isStartingCamera) return null;
    setIsStartingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false 
      });
      streamRef.current = stream;
      return stream;
    } catch (err) {
      console.error("Camera access error:", err);
      return null;
    } finally {
      setIsStartingCamera(false);
    }
  };

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
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
    const resumeAudio = () => {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
    };
    resumeAudio();

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
    
    const stream = streamRef.current;
    videoSegmentsRef.current = [];
    const captured: string[] = [];
    
    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';

    try {
      for (let i = 0; i < 4; i++) {
        setState(BoothState.COUNTDOWN);
        for (let c = 3; c > 0; c--) {
          setCountdown(c);
          if (c === 3) {
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
        if (shutterSoundRef.current) playSFX(shutterSoundRef.current, 0.9);

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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
    
    const filterString = GET_FILTER_CSS(selectedFilter);

    const renderLoop = () => {
      if (recorder.state === 'inactive') return;
      ctx.fillStyle = '#fdfdfd';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      videos.forEach((v, i) => {
        const y = margin + (i * (frameHeight + spacing));
        ctx.save();
        ctx.filter = filterString;
        if (isMirrored) {
          ctx.translate(margin + frameWidth, y);
          ctx.scale(-1, 1);
          ctx.drawImage(v, 0, 0, frameWidth, frameHeight);
        } else {
          ctx.drawImage(v, margin, y, frameWidth, frameHeight);
        }
        ctx.restore();
        ctx.strokeStyle = '#222'; 
        ctx.lineWidth = 1;
        ctx.strokeRect(margin, y, frameWidth, frameHeight);
      });
      ctx.fillStyle = '#888'; 
      ctx.font = '16px "Share Tech Mono"';
      ctx.fillText('PHOTOAUTOMAT // ANIMATED STRIP', margin, canvas.height - 40);
      requestAnimationFrame(renderLoop);
    };

    recorder.start(); 
    renderLoop();
    await new Promise(r => setTimeout(r, 4000));
    recorder.stop();

    return new Promise<void>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
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
        }, 3500);
      };
      generate();
    }
  }, [state, photos]);

  const triggerDownload = (url: string, filename: string, type: 'image' | 'video') => {
    setIsDownloading(type);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    try {
      link.click();
    } catch (e) {
      window.open(url, '_blank');
    }
    setTimeout(() => {
      if (document.body.contains(link)) document.body.removeChild(link);
      setIsDownloading(null);
    }, 2000);
  };

  const isInside = state === BoothState.READY || state === BoothState.COUNTDOWN || state === BoothState.SHUTTER || state === BoothState.DEVELOPING;
  const isShooting = state === BoothState.COUNTDOWN || state === BoothState.SHUTTER;

  return (
    <div className="relative w-full h-screen bg-[#0c0c0c] flex items-center justify-center overflow-hidden">
      <canvas ref={compositeCanvasRef} className="hidden" />
      
      {(state === BoothState.EXTERIOR || state === BoothState.ENTERING || state === BoothState.RESULT) && (
        <div className={`transition-all duration-1000 ${state === BoothState.RESULT ? 'opacity-85 blur-[5px] scale-105' : 'opacity-100 scale-100'}`}>
          <BoothExterior 
            onEnter={handleEnterBooth} 
            isOpening={state === BoothState.ENTERING} 
            photoStrip={finalImage}
            state={state}
          />
        </div>
      )}

      {state === BoothState.RESULT && finalImage && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center pointer-events-none overflow-hidden pb-[22vh] md:pb-[25vh]">
             <div className="relative animate-[centerPhysicalDrop_4.5s_cubic-bezier(0.2, 0.8, 0.2, 1)_forwards]">
                <img src={finalImage} alt="Strip" className="h-[55vh] md:h-[70vh] w-auto border-[6px] border-white shadow-[0_80px_200px_rgba(0,0,0,1)] pointer-events-auto" style={{ transform: 'rotate(-4deg)' }} />
                <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none"></div>
             </div>
        </div>
      )}

      {isInside && (
        <div className="relative w-full h-full max-w-5xl md:h-auto md:aspect-[16/11] bg-[#141414] p-4 md:p-10 flex flex-col items-center justify-center shadow-[0_60px_120px_rgba(0,0,0,1)] border border-white/5 animate-[zoomIn_0.6s_ease-out] z-[100]">
          
          {(isShooting || state === BoothState.READY) && (
            <div className="absolute top-6 right-6 md:top-10 md:right-14 flex items-center gap-4 z-[300]">
               {isShooting && (
                 <button 
                  onClick={(e) => { e.stopPropagation(); isPausedRef.current = !isPausedRef.current; setIsPausedUI(isPausedRef.current); }}
                  className={`w-12 h-12 md:w-16 md:h-16 flex items-center justify-center rounded-full border-2 transition-all active:scale-90 shadow-2xl flex-shrink-0 ${isPausedUI ? 'bg-white text-black border-white' : 'bg-black/60 text-white border-white/30 hover:bg-white/10'}`}
                 >
                   {isPausedUI ? <Play size={24} fill="currentColor" /> : <Pause size={24} fill="currentColor" />}
                 </button>
               )}
               <button 
                onClick={() => { isCancelledRef.current = true; resetBooth(); }}
                className="w-12 h-12 md:w-16 md:h-16 flex items-center justify-center rounded-full bg-red-600/20 text-red-500 border-2 border-red-500/30 hover:bg-red-600 hover:text-white transition-all active:scale-90 shadow-2xl flex-shrink-0"
               >
                 <X size={24} />
               </button>
            </div>
          )}

          <div className="relative w-full aspect-[4/3] max-h-[65vh] bg-black overflow-hidden border-[10px] md:border-[20px] border-white shadow-inner flex items-center justify-center">
            <video 
              ref={videoRef} autoPlay muted playsInline 
              className={`w-full h-full object-cover transition-all duration-300 ${isMirrored ? 'scale-x-[-1]' : 'scale-x-[1]'} ${isPausedUI ? 'grayscale brightness-50' : ''}`}
              style={{ filter: GET_FILTER_CSS(selectedFilter) }}
            />
            
            {isPausedUI && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md z-[150]">
                 <div className="elegant-font italic text-white text-4xl tracking-[0.2em] animate-pulse">PAUSED</div>
              </div>
            )}

            {state === BoothState.READY && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-xl p-4 md:p-10 text-center z-[80] animate-fade-in">
                 {isStartingCamera ? (
                    <div className="flex flex-col items-center gap-6">
                        <Loader2 size={48} className="text-white animate-spin opacity-50" />
                        <p className="elegant-font italic text-white/50 text-xl tracking-widest">Warming up lens...</p>
                    </div>
                 ) : (
                    <>
                        <h2 className="elegant-font italic text-white text-2xl md:text-5xl mb-4 md:mb-10 tracking-[0.1em] uppercase">Style Selection</h2>
                        
                        <div className="grid grid-cols-3 gap-2 md:gap-5 mb-8 md:mb-14 w-full max-w-lg md:max-w-2xl px-2">
                        {Object.values(FilterType).map((fid) => (
                            <button
                                key={fid} onClick={(e) => { e.stopPropagation(); setSelectedFilter(fid); }}
                                className={`py-3 md:py-6 px-1 md:px-2 border-2 transition-all clean-font text-[8px] md:text-[11px] uppercase font-black min-h-[48px] md:min-h-[72px] flex items-center justify-center leading-tight tracking-tighter sm:tracking-normal ${
                                selectedFilter === fid ? 'bg-white text-black border-white scale-105 shadow-2xl' : 'bg-black/40 text-white/50 border-white/20 hover:border-white/50'
                                }`}
                            >
                            {fid.replace('_', ' ')}
                            </button>
                        ))}
                        </div>

                        <button 
                        onClick={(e) => { e.stopPropagation(); startShootingSequence(); }}
                        className="bg-red-600 hover:bg-red-500 text-white px-8 md:px-16 py-4 md:py-8 rounded-full flex items-center gap-3 md:gap-4 transition-all active:scale-95 shadow-[0_0_40px_rgba(220,38,38,0.6)] group"
                        >
                        <Camera size={28} className="group-hover:rotate-12 transition-transform" />
                        <span className="elegant-font font-bold text-lg md:text-3xl uppercase tracking-[0.15em]">Start Session</span>
                        </button>
                    </>
                 )}
              </div>
            )}
            
            {state === BoothState.COUNTDOWN && !isPausedUI && (
              <div className="absolute inset-0 flex items-center justify-center z-[80] pointer-events-none">
                 <div className="elegant-font italic text-white text-[120px] md:text-[280px] animate-[pop_0.5s_ease-out] drop-shadow-[0_20px_50px_rgba(0,0,0,0.8)]">{countdown}</div>
              </div>
            )}
            <div className={`absolute inset-0 bg-white transition-opacity duration-75 pointer-events-none z-[90] ${isFlashActive ? 'opacity-100' : 'opacity-0'}`} />
          </div>
          
          <div className="w-full flex items-center justify-between px-4 md:px-8 mt-6 md:mt-10">
            <div className="flex items-center gap-6 md:gap-10">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 md:w-5 md:h-5 rounded-full transition-all ${isShooting && !isPausedUI ? 'bg-red-500 shadow-[0_0_20px_red] scale-125' : 'bg-red-950'}`}></div>
                <span className="clean-font text-[8px] md:text-[10px] text-white/30 uppercase mt-2 font-bold">REC</span>
              </div>
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 md:w-5 md:h-5 rounded-full ${state === BoothState.READY ? 'bg-green-500 shadow-[0_0_20px_green]' : 'bg-green-950'}`}></div>
                <span className="clean-font text-[8px] md:text-[10px] text-white/30 uppercase mt-2 font-bold">RDY</span>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="elegant-font text-white text-xl md:text-6xl tracking-[0.1em] uppercase leading-none">
                POSE <span className="font-bold">{photos.length + (state === BoothState.READY ? 0 : 1)}</span> <span className="text-white/30">/</span> 4
              </span>
            </div>
          </div>

          {state === BoothState.DEVELOPING && (
            <div className="absolute inset-0 bg-[#080808] z-[250] flex flex-col items-center justify-center p-8 text-center animate-fade-in">
               <div className="elegant-font italic text-white text-3xl md:text-7xl animate-pulse tracking-[0.2em] mb-4 md:mb-6">Developing...</div>
               <p className="clean-font text-white/40 text-[10px] md:text-sm uppercase tracking-[0.4em] mb-8 md:mb-10">Authentic Chemical Processing</p>
               <div className="w-full max-w-xs md:max-w-xl h-2 md:h-3 bg-white/10 rounded-full overflow-hidden mt-4 md:mt-8 border border-white/20">
                 <div className="h-full bg-gradient-to-r from-white/30 via-white/80 to-white/30 animate-[progress_3.5s_linear]"></div>
               </div>
               <p className="elegant-font italic text-white/20 mt-12 md:mt-16 text-sm md:text-lg tracking-widest animate-pulse">Wait for the silver nitrate to settle...</p>
            </div>
          )}
        </div>
      )}

      {state === BoothState.RESULT && (
        <div className="fixed bottom-0 left-0 w-full px-5 pb-10 pt-12 flex flex-col items-center z-[300] animate-[slideUpUI_1.2s_ease-out_1.2s_both]">
           <div className="flex flex-col gap-4 p-5 md:p-7 bg-black/90 backdrop-blur-[60px] border border-white/20 rounded-[2.5rem] md:rounded-[3.5rem] shadow-[0_-30px_150px_rgba(0,0,0,1)] ring-1 ring-white/10 w-full max-w-lg mx-auto">
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button 
                  disabled={isDownloading !== null}
                  onClick={() => { if(finalImage) triggerDownload(finalImage, `photoautomat-${Date.now()}.png`, 'image'); }} 
                  className="bg-white text-black h-16 md:h-20 rounded-[1.5rem] flex items-center justify-center gap-3 transition-all active:scale-95 shadow-[0_15px_40px_rgba(255,255,255,0.25)] disabled:opacity-50"
                >
                  {isDownloading === 'image' ? <Loader2 size={24} className="animate-spin" /> : <Download size={24} />}
                  <span className="elegant-font text-base md:text-xl font-black uppercase tracking-widest">
                    {isDownloading === 'image' ? 'Saving...' : 'Save Strip'}
                  </span>
                </button>
                
                {recordedVideoUrl && (
                  <button 
                    disabled={isDownloading !== null}
                    onClick={() => { if(recordedVideoUrl) triggerDownload(recordedVideoUrl, `photoautomat-${Date.now()}.mp4`, 'video'); }} 
                    className="bg-zinc-800 text-white h-16 md:h-20 rounded-[1.5rem] flex items-center justify-center gap-3 border border-white/10 transition-all active:scale-95 disabled:opacity-50 hover:bg-zinc-700"
                  >
                    {isDownloading === 'video' ? <Loader2 size={24} className="animate-spin text-red-500" /> : <Video size={24} className="text-red-500" />}
                    <span className="elegant-font text-base md:text-xl font-black uppercase tracking-widest">
                      {isDownloading === 'video' ? 'Saving...' : 'Save Video'}
                    </span>
                  </button>
                )}
              </div>
              
              <button 
                onClick={resetBooth} 
                className="w-full bg-red-600/20 hover:bg-red-600/30 text-red-500 h-14 rounded-full border border-red-600/30 transition-all flex items-center justify-center gap-3 group"
              >
                <RefreshCw size={20} className="group-hover:rotate-180 transition-transform duration-700" />
                <span className="clean-font text-[10px] md:text-xs font-black uppercase tracking-[0.2em]">New Session</span>
              </button>
           </div>
        </div>
      )}

      <style>{`
        @keyframes centerPhysicalDrop {
          0% { transform: translateY(-120vh); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(0vh) rotate(-4deg); opacity: 1; }
        }
        @keyframes slideUpUI { from { transform: translateY(400px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes zoomIn { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes pop { 0% { transform: scale(0.7); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes progress { from { width: 0%; } to { width: 100%; } }
        .animate-fade-in { animation: fadeIn 0.5s ease-out; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
};

export default App;
