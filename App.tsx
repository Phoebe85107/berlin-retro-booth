
import React, { useState, useRef, useEffect } from 'react';
import { BoothState, FilterType } from './types';
import { processWithFilter, createFinalStrip, GET_FILTER_CSS } from './utils/imageUtils';
import BoothExterior from './components/BoothExterior';
import { Download, RefreshCw, Video, Zap, ZapOff, Camera, FlipHorizontal } from 'lucide-react';

const App: React.FC = () => {
  const [state, setState] = useState<BoothState>(BoothState.EXTERIOR);
  const [photos, setPhotos] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number>(0);
  const [finalImage, setFinalImage] = useState<string | null>(null);
  const [isFlashActive, setIsFlashActive] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [isTorchSupported, setIsTorchSupported] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isMirrored, setIsMirrored] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<FilterType>(FilterType.BERLIN_BW);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoSegmentsRef = useRef<Blob[]>([]);
  const segmentRecorderRef = useRef<MediaRecorder | null>(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false 
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = (track as any).getCapabilities?.() || {};
        setIsTorchSupported(!!capabilities.torch);
      }
      return stream;
    } catch (err) {
      console.error("Camera access error:", err);
      alert("Please enable camera permissions to start your photo session.");
      return null;
    }
  };

  const toggleTorch = async () => {
    if (!streamRef.current || !isTorchSupported) return;
    const track = streamRef.current.getVideoTracks()[0];
    const nextState = !isTorchOn;
    try {
      await (track as any).applyConstraints({ advanced: [{ torch: nextState }] });
      setIsTorchOn(nextState);
    } catch (e) {
      console.error("Failed to toggle torch:", e);
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
    setIsTorchOn(false);
  };

  const handleEnterBooth = async () => {
    const stream = await startCamera();
    if (stream) {
      setState(BoothState.ENTERING);
      setTimeout(() => setState(BoothState.READY), 1500);
    } else {
      setState(BoothState.EXTERIOR);
    }
  };

  const getSupportedMimeType = () => {
    const types = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  };

  const startShootingSequence = async () => {
    if (!streamRef.current) return;
    const stream = streamRef.current;
    videoSegmentsRef.current = [];
    const captured: string[] = [];
    const mimeType = getSupportedMimeType();

    for (let i = 0; i < 4; i++) {
      setState(BoothState.COUNTDOWN);
      for (let c = 3; c > 0; c--) {
        setCountdown(c);
        if (c === 3 && mimeType) {
          const chunks: Blob[] = [];
          const rec = new MediaRecorder(stream, { mimeType });
          rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          rec.onstop = () => {
            videoSegmentsRef.current.push(new Blob(chunks, { type: mimeType }));
          };
          segmentRecorderRef.current = rec;
          rec.start();
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (segmentRecorderRef.current && segmentRecorderRef.current.state !== 'inactive') {
        segmentRecorderRef.current.stop();
      }
      setState(BoothState.SHUTTER);
      setIsFlashActive(true);
      if (videoRef.current) {
        const photo = processWithFilter(videoRef.current, selectedFilter, isMirrored);
        captured.push(photo);
        setPhotos([...captured]);
      }
      await new Promise(r => setTimeout(r, 200));
      setIsFlashActive(false);
      await new Promise(r => setTimeout(r, 1200));
    }
    setState(BoothState.DEVELOPING);
    stopCamera();
  };

  const createAnimatedStrip = async () => {
    if (videoSegmentsRef.current.length < 4 || !compositeCanvasRef.current) return;
    const canvas = compositeCanvasRef.current;
    const frameWidth = 480;
    const frameHeight = 360;
    const margin = 30;
    const spacing = 15;
    const bottomPadding = 120;
    canvas.width = frameWidth + (margin * 2);
    canvas.height = (frameHeight * 4) + (spacing * 3) + margin + bottomPadding;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const videos = await Promise.all(videoSegmentsRef.current.map(blob => {
      return new Promise<HTMLVideoElement>((resolve) => {
        const v = document.createElement('video');
        v.src = URL.createObjectURL(blob);
        v.muted = true; v.loop = true; v.playsInline = true;
        v.onloadedmetadata = () => v.play().then(() => resolve(v));
      });
    }));

    const mimeType = getSupportedMimeType();
    const stream = canvas.captureStream(30);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    
    const renderLoop = () => {
      if (recorder.state === 'inactive') return;
      ctx.fillStyle = '#fdfdfd';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      videos.forEach((v, i) => {
        const x = margin;
        const y = margin + (i * (frameHeight + spacing));
        ctx.save();
        ctx.filter = GET_FILTER_CSS(selectedFilter);
        const sw = v.videoWidth; const sh = v.videoHeight;
        if (sw > 0 && sh > 0) {
          const dr = frameWidth / frameHeight; const sr = sw / sh;
          let dw, dh, dx, dy;
          if (sr > dr) { dw = sh * dr; dh = sh; dx = (sw - dw) / 2; dy = 0; }
          else { dw = sw; dh = sw / dr; dx = 0; dy = (sh - dh) / 2; }
          if (isMirrored) {
            ctx.translate(x + frameWidth, y);
            ctx.scale(-1, 1);
            ctx.drawImage(v, dx, dy, dw, dh, 0, 0, frameWidth, frameHeight);
          } else {
            ctx.drawImage(v, dx, dy, dw, dh, x, y, frameWidth, frameHeight);
          }
        }
        ctx.restore();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, frameWidth, frameHeight);
      });
      ctx.fillStyle = '#888';
      ctx.font = '16px "Share Tech Mono"';
      ctx.fillText('PHOTOAUTOMAT // ANIMATED', margin, canvas.height - 40);
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
        setTimeout(() => setState(BoothState.RESULT), 3000);
      };
      generate();
    }
  }, [state, photos]);

  const resetBooth = () => {
    setPhotos([]); setFinalImage(null); setRecordedVideoUrl(null);
    videoSegmentsRef.current = []; setState(BoothState.EXTERIOR);
  };

  const downloadImage = () => {
    if (!finalImage) return;
    const link = document.createElement('a');
    link.download = `photoautomat-strip-${Date.now()}.png`;
    link.href = finalImage;
    link.click();
  };

  const downloadVideo = () => {
    if (!recordedVideoUrl) return;
    const link = document.createElement('a');
    const ext = recordedVideoUrl.includes('mp4') ? 'mp4' : 'webm';
    link.download = `photoautomat-animated-${Date.now()}.${ext}`;
    link.href = recordedVideoUrl;
    link.click();
  };

  const isInside = state === BoothState.READY || state === BoothState.COUNTDOWN || state === BoothState.SHUTTER || state === BoothState.DEVELOPING;

  return (
    <div className="relative w-full h-screen bg-[#0c0c0c] flex items-center justify-center overflow-hidden">
      <canvas ref={compositeCanvasRef} className="hidden" />
      {(state === BoothState.EXTERIOR || state === BoothState.ENTERING || state === BoothState.RESULT) && (
        <BoothExterior 
          onEnter={handleEnterBooth} 
          isOpening={state === BoothState.ENTERING} 
          photoStrip={finalImage}
          state={state}
        />
      )}
      {isInside && (
        <div className="relative w-full h-full max-w-5xl md:h-auto md:aspect-[16/11] bg-[#141414] p-4 md:p-10 flex flex-col items-center justify-center shadow-[0_60px_120px_rgba(0,0,0,1)] border border-white/5 animate-[zoomIn_0.6s_ease-out]">
          <div className="relative w-full aspect-[4/3] max-h-[70vh] bg-black overflow-hidden border-[8px] md:border-[18px] border-white shadow-inner flex items-center justify-center">
            <video 
              ref={videoRef} autoPlay muted playsInline 
              className={`w-full h-full object-cover transition-all duration-300 ${isMirrored ? 'scale-x-[-1]' : 'scale-x-[1]'}`}
              style={{ filter: GET_FILTER_CSS(selectedFilter) }}
            />
            {state === BoothState.READY && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md p-4 md:p-8 text-center animate-fade-in z-[80]">
                 <h2 className="elegant-font italic text-white text-xl md:text-4xl mb-4 md:mb-6 tracking-widest uppercase">Select Style</h2>
                 <div className="flex flex-wrap justify-center gap-2 md:gap-4 mb-6 md:mb-10 max-w-xl">
                   {[
                     { id: FilterType.NATURAL, label: 'Natural' },
                     { id: FilterType.FUJI_STYLE, label: 'Fuji Style' },
                     { id: FilterType.BERLIN_BW, label: 'Berlin B&W' },
                     { id: FilterType.SEPIA, label: 'Sepia' },
                     { id: FilterType.CYANOTYPE, label: 'Cyanotype' },
                     { id: FilterType.ANALOG_COLOR, label: 'Analog' },
                   ].map((f) => (
                     <button
                        key={f.id} onClick={() => setSelectedFilter(f.id)}
                        className={`px-3 md:px-6 py-2 md:py-3 border-2 transition-all clean-font text-[10px] md:text-xs uppercase tracking-widest font-bold ${
                          selectedFilter === f.id ? 'bg-white text-black border-white' : 'bg-black/20 text-white/60 border-white/20'
                        }`}
                     >
                       {f.label}
                     </button>
                   ))}
                 </div>
                 <button 
                  onClick={startShootingSequence}
                  className="bg-red-600 hover:bg-red-500 text-white px-8 md:px-10 py-4 md:py-5 rounded-full flex items-center gap-3 transition-all active:scale-95 shadow-[0_0_30px_rgba(220,38,38,0.5)] group"
                 >
                   <Camera size={20} className="group-hover:rotate-12 transition-transform md:w-6 md:h-6" />
                   <span className="elegant-font font-bold text-lg md:text-2xl uppercase tracking-[0.2em]">Start Session</span>
                 </button>
              </div>
            )}
            {state === BoothState.COUNTDOWN && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[80]">
                 <div className="elegant-font italic text-white text-[120px] md:text-[240px] drop-shadow-[0_10px_40px_rgba(0,0,0,0.9)] animate-[pop_0.5s_ease-out]">{countdown}</div>
              </div>
            )}
            <div className={`absolute inset-0 bg-white transition-opacity duration-75 pointer-events-none z-[90] ${isFlashActive ? 'opacity-100' : 'opacity-0'}`} />
            <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-[100]">
              <div className="flex gap-2">
                {isTorchSupported && (state === BoothState.READY || state === BoothState.COUNTDOWN || state === BoothState.SHUTTER) && (
                  <button onClick={toggleTorch} className={`p-3 md:p-4 rounded-full backdrop-blur-xl border border-white/20 shadow-lg ${isTorchOn ? 'bg-yellow-500 text-black border-yellow-300' : 'bg-black/40 text-white'}`}>
                    {isTorchOn ? <Zap size={20} /> : <ZapOff size={20} />}
                  </button>
                )}
                {(state === BoothState.READY) && (
                  <button onClick={() => setIsMirrored(!isMirrored)} className={`p-3 md:p-4 rounded-full backdrop-blur-xl border border-white/20 shadow-lg ${isMirrored ? 'bg-blue-600 text-white border-blue-400' : 'bg-black/40 text-white'}`}>
                    <FlipHorizontal size={20} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="w-full flex items-center justify-between px-2 md:px-6 mt-4 md:mt-8">
            <div className="flex items-center gap-3 md:gap-6">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-4 h-4 rounded-full transition-all duration-300 ${state === BoothState.SHUTTER ? 'bg-red-500 shadow-[0_0_15px_red] scale-125' : 'bg-red-950 shadow-none'}`}></div>
                <span className="clean-font text-[9px] text-white/20 uppercase tracking-tighter">REC</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className={`w-4 h-4 rounded-full transition-all duration-300 ${state === BoothState.READY ? 'bg-green-500 shadow-[0_0_15px_green] scale-110' : 'bg-green-950 shadow-none'}`}></div>
                <span className="clean-font text-[9px] text-white/20 uppercase tracking-tighter">RDY</span>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <span className="elegant-font text-white/40 text-[10px] md:text-sm italic tracking-[0.1em]">Session Progress</span>
              <span className="elegant-font text-white text-xl md:text-5xl tracking-[0.1em] uppercase">
                POSE <span className="font-bold">{photos.length + (state === BoothState.READY ? 0 : 1)}</span> <span className="text-white/20 italic">/</span> 4
              </span>
            </div>
          </div>
          {state === BoothState.DEVELOPING && (
            <div className="absolute inset-0 bg-[#080808] z-[120] flex flex-col items-center justify-center p-6 text-center">
               <div className="elegant-font italic text-white text-4xl md:text-6xl animate-pulse tracking-[0.2em]">Developing...</div>
               <div className="w-full max-w-xs md:max-w-md h-1.5 bg-white/5 rounded-full overflow-hidden mt-8 mb-4">
                 <div className="h-full bg-white/50 animate-[progress_3s_linear]"></div>
               </div>
               <p className="vintage-font text-white/20 text-[10px] md:text-xs uppercase tracking-[0.4em]">Analog processing in darkroom</p>
            </div>
          )}
        </div>
      )}
      {state === BoothState.RESULT && (
        <div className="fixed bottom-0 left-0 w-full px-4 pb-8 md:pb-12 pt-12 flex flex-col items-center gap-5 z-[200] animate-[slideUp_0.8s_ease-out] bg-gradient-to-t from-black via-black/90 to-transparent">
           <div className="flex flex-col sm:flex-row items-center gap-3 md:gap-5 p-4 bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2rem] md:rounded-full shadow-[0_40px_100px_rgba(0,0,0,1)] w-full max-w-md sm:max-w-fit mx-auto">
              <button onClick={downloadImage} className="w-full sm:w-auto bg-white hover:bg-gray-100 text-black px-8 py-4 rounded-full flex items-center justify-center gap-3 transition-all active:scale-95 shadow-2xl">
                <Download size={18} className="md:w-5 md:h-5" /> 
                <span className="elegant-font text-[14px] md:text-lg font-bold">Save Photo</span>
              </button>
              {recordedVideoUrl && (
                <button onClick={downloadVideo} className="w-full sm:w-auto bg-neutral-900 hover:bg-neutral-800 text-white px-8 py-4 rounded-full flex items-center justify-center gap-3 border border-white/10 transition-all active:scale-95 shadow-2xl">
                  <Video size={18} className="md:w-5 md:h-5 text-red-500" /> 
                  <span className="elegant-font text-[14px] md:text-lg font-bold">Save Video</span>
                </button>
              )}
              <button onClick={resetBooth} className="bg-white/10 hover:bg-white/20 text-white p-4 rounded-full flex items-center justify-center transition-all md:hover:rotate-180">
                <RefreshCw size={22} />
              </button>
           </div>
           <div className="flex items-center gap-4">
              <div className="h-px w-8 md:w-16 bg-white/20"></div>
              <p className="elegant-font italic text-white/60 text-[10px] md:text-sm tracking-[0.2em] uppercase">Portraits Created Successfully</p>
              <div className="h-px w-8 md:w-16 bg-white/20"></div>
           </div>
        </div>
      )}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-[999] opacity-[0.04]">
        <div className="absolute inset-0 bg-white mix-blend-overlay animate-[flicker_0.1s_infinite]" />
      </div>
    </div>
  );
};

export default App;
