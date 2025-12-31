
import { FilterType } from '../types';

/**
 * Manually applies color transformations to pixel data
 * This ensures filters are "baked" into the image data even if the browser 
 * doesn't support canvas.filter during export.
 */
const applyPixelFilter = (data: Uint8ClampedArray, type: FilterType) => {
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    switch (type) {
      case FilterType.BERLIN_BW: {
        // High contrast grayscale
        let gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // Apply high contrast
        gray = ((gray - 128) * 1.8) + 128;
        r = g = b = Math.min(255, Math.max(0, gray + 20)); // slight brightness boost
        break;
      }
      case FilterType.SEPIA: {
        const tr = (r * 0.393) + (g * 0.769) + (b * 0.189);
        const tg = (r * 0.349) + (g * 0.686) + (b * 0.168);
        const tb = (r * 0.272) + (g * 0.534) + (b * 0.131);
        r = Math.min(255, tr);
        g = Math.min(255, tg);
        b = Math.min(255, tb);
        break;
      }
      case FilterType.CYANOTYPE: {
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = gray * 0.2;
        g = gray * 0.5;
        b = gray * 0.9;
        // Boost contrast
        r = ((r - 128) * 1.4) + 128;
        g = ((g - 128) * 1.4) + 128;
        b = ((b - 128) * 1.4) + 128;
        break;
      }
      case FilterType.ANALOG_COLOR: {
        // Desaturate and shift to warm
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = r * 0.6 + gray * 0.4 + 10;
        g = g * 0.6 + gray * 0.4;
        b = b * 0.5 + gray * 0.5 - 10;
        break;
      }
      case FilterType.FUJI_STYLE: {
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum < 100) {
          r *= 0.92; g *= 1.02; b *= 1.08;
        } else if (lum > 160) {
          r *= 1.10; g *= 1.02; b *= 0.90;
        }
        r = ((r - 128) * 1.1) + 128; // contrast
        break;
      }
      case FilterType.NATURAL: {
        r = ((r - 128) * 1.05) + 128;
        g = ((g - 128) * 1.05) + 128;
        b = ((b - 128) * 1.05) + 128;
        break;
      }
    }

    // Add Analog Noise (Grain)
    const noise = (Math.random() - 0.5) * 25;
    data[i] = Math.min(255, Math.max(0, r + noise));
    data[i + 1] = Math.min(255, Math.max(0, g + noise));
    data[i + 2] = Math.min(255, Math.max(0, b + noise));
  }
};

export const GET_FILTER_CSS = (type: FilterType): string => {
  switch (type) {
    case FilterType.BERLIN_BW: return 'grayscale(1) contrast(1.8) brightness(1.1)';
    case FilterType.SEPIA: return 'sepia(1) contrast(1.2) brightness(0.95)';
    case FilterType.CYANOTYPE: return 'grayscale(1) sepia(0.5) hue-rotate(180deg) brightness(1.1) contrast(1.4)';
    case FilterType.ANALOG_COLOR: return 'saturate(0.6) sepia(0.2) hue-rotate(-10deg) contrast(1.1) brightness(1.1)';
    case FilterType.NATURAL: return 'contrast(1.05) brightness(1.02) saturate(1.1)';
    case FilterType.FUJI_STYLE: return 'brightness(1.05) contrast(1.1) saturate(0.85) sepia(0.05)';
    default: return 'none';
  }
};

const drawImageCover = (ctx: CanvasRenderingContext2D, source: HTMLVideoElement | HTMLCanvasElement, x: number, y: number, w: number, h: number) => {
  let sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  let sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const dr = w / h;
  const sr = sw / sh;
  let dw, dh, dx, dy;

  if (sr > dr) {
    dw = sh * dr; dh = sh; dx = (sw - dw) / 2; dy = 0;
  } else {
    dw = sw; dh = sw / dr; dx = 0; dy = (sh - dh) / 2;
  }
  ctx.drawImage(source, dx, dy, dw, dh, x, y, w, h);
};

export const processWithFilter = (video: HTMLVideoElement, filterType: FilterType, mirrored: boolean = true): string => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const width = 480;
  const height = 360;
  canvas.width = width;
  canvas.height = height;

  ctx.save();
  if (mirrored) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  drawImageCover(ctx, video, 0, 0, width, height);
  ctx.restore();

  // Explicitly apply filters via pixel data for download compatibility
  const imageData = ctx.getImageData(0, 0, width, height);
  applyPixelFilter(imageData.data, filterType);
  ctx.putImageData(imageData, 0, 0);

  // Add slight vignette
  const gradient = ctx.createRadialGradient(width/2, height/2, width/4, width/2, height/2, width/1.5);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  return canvas.toDataURL('image/jpeg', 0.9);
};

export const createFinalStrip = (photos: string[]): Promise<string> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolve('');

    const frameWidth = 480;
    const frameHeight = 360;
    const margin = 30;
    const spacing = 15;
    const bottomPadding = 120;

    canvas.width = frameWidth + (margin * 2);
    canvas.height = (frameHeight * 4) + (spacing * 3) + margin + bottomPadding;

    ctx.fillStyle = '#fdfdfd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let loadedCount = 0;
    photos.forEach((src, index) => {
      const img = new Image();
      img.onload = () => {
        const x = margin;
        const y = margin + (index * (frameHeight + spacing));
        ctx.drawImage(img, x, y, frameWidth, frameHeight);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, frameWidth, frameHeight);

        loadedCount++;
        if (loadedCount === photos.length) {
          // Add paper texture noise
          ctx.globalAlpha = 0.03;
          for (let i = 0; i < 15000; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
            ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
          }
          ctx.globalAlpha = 1.0;
          
          ctx.fillStyle = '#888';
          ctx.font = '16px "Share Tech Mono"';
          const dateStr = new Date().toLocaleDateString();
          ctx.fillText('PHOTOAUTOMAT // ' + dateStr, margin, canvas.height - 40);
          resolve(canvas.toDataURL('image/png'));
        }
      };
      img.src = src;
    });
  });
};
