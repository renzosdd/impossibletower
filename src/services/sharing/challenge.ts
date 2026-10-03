import type { Challenge, RunResult } from '../../types';

const MAX_TOKEN_LENGTH = 2048;
const MAX_SEED_LENGTH = 128;
const MAX_HEIGHT = 100_000;
const MAX_SCORE = 100_000_000;

/** Public labels are text, never HTML. Keep them short enough for a share card. */
function publicName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.normalize('NFC').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  return Array.from(cleaned).slice(0, 32).join('') || undefined;
}

function validateChallenge(value: unknown): Challenge | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.seed !== 'string') return null;
  if (!candidate.seed.length || candidate.seed.length > MAX_SEED_LENGTH || /[\u0000-\u001f\u007f]/.test(candidate.seed)) return null;
  if (typeof candidate.height !== 'number' || !Number.isFinite(candidate.height) || candidate.height < 0 || candidate.height > MAX_HEIGHT) return null;
  if (typeof candidate.score !== 'number' || !Number.isSafeInteger(candidate.score) || candidate.score < 0 || candidate.score > MAX_SCORE) return null;
  if (candidate.name !== undefined && (typeof candidate.name !== 'string' || candidate.name.length > 256)) return null;
  const name = publicName(candidate.name);
  return { version: 1, seed: candidate.seed, height: candidate.height, score: candidate.score, ...(name ? { name } : {}) };
}

/** Portable UTF-8 base64url. It carries a seed and a target, not trusted ranking data. */
export function encodeChallenge(challenge: Challenge): string {
  const validated = validateChallenge(challenge);
  if (!validated) throw new Error('Invalid challenge');
  const bytes = new TextEncoder().encode(JSON.stringify(validated));
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeChallenge(token: string): Challenge | null {
  try {
    if (typeof token !== 'string' || !token.length || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    // A one-character remainder can never be a complete base64 representation.
    if (token.length % 4 === 1) return null;
    const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - token.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return validateChallenge(JSON.parse(json));
  } catch {
    return null;
  }
}

export function challengeUrl(challenge: Challenge, base?: string): string {
  const fallback = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  let url: URL;
  try { url = new URL(base ?? fallback, fallback); } catch { url = new URL(fallback); }
  // Only page URLs are shareable. Never propagate a supplied javascript:/data: URL.
  if (!['http:', 'https:'].includes(url.protocol)) url = new URL(fallback);
  url.search = '';
  url.hash = '';
  url.searchParams.set('challenge', encodeChallenge(challenge));
  return url.toString();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

/** Original procedural 9:16 artwork. Only actual run metrics are printed. */
export async function createShareCard(result: RunResult, name?: string): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const gradient = context.createLinearGradient(0, 0, 0, 1920);
    gradient.addColorStop(0, '#f7f2e9');
    gradient.addColorStop(1, '#e8ddff');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1080, 1920);
    context.fillStyle = '#ded0ff';
    context.beginPath(); context.arc(910, 205, 235, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#f4d94e';
    context.beginPath(); context.arc(85, 1200, 175, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#252440';
    context.textAlign = 'left';
    context.font = '900 98px Arial, sans-serif';
    context.fillText('IMPOSSIBLE', 86, 171);
    context.fillText('TOWER', 86, 278);
    context.font = '700 29px Arial, sans-serif';
    context.fillStyle = '#6d6386';
    context.fillText('UN TOQUE. UNA TORRE. TU RÉCORD.', 91, 340);
    context.textAlign = 'center';
    context.fillStyle = '#252440';
    const heightText = `${result.height.toFixed(1)}`;
    context.font = `900 ${heightText.length > 6 ? 175 : 246}px Arial, sans-serif`;
    context.fillText(heightText, 540, 637);
    context.font = '800 45px Arial, sans-serif';
    context.fillStyle = '#7960c8';
    context.fillText('METROS DE LOCURA', 540, 710);
    // The stylized blocks are artwork; the exact placed-object count is printed below.
    const blocks = Math.max(1, Math.min(9, result.objectsPlaced));
    const colors = ['#7960c8', '#f5c74b', '#e99194', '#67b9a1', '#749fdd'];
    const blockHeight = Math.min(78, 570 / blocks);
    for (let index = 0; index < blocks; index += 1) {
      const width = 350 - (index % 3) * 33;
      const x = 540 + Math.sin(index * 2.3) * 48;
      const y = 1340 - index * blockHeight;
      context.save();
      context.translate(x, y);
      context.rotate(Math.sin(index * 1.4) * 0.045);
      roundedRect(context, -width / 2 + 10, 11, width, blockHeight - 5, 14, '#39314d22');
      roundedRect(context, -width / 2, 0, width, blockHeight - 5, 14, colors[index % colors.length]);
      roundedRect(context, -width / 2 + 14, 10, width - 28, 9, 4, '#ffffff35');
      context.restore();
    }
    roundedRect(context, 232, 1425, 616, 14, 7, '#252440');
    context.font = '800 37px Arial, sans-serif';
    context.fillStyle = '#252440';
    context.fillText(`${result.perfectDrops} PERFECT DROPS`, 540, 1534);
    context.font = '500 30px Arial, sans-serif';
    context.fillStyle = '#6d6386';
    context.fillText(`${result.objectsPlaced} objetos · ${Math.round(result.score)} puntos`, 540, 1585);
    roundedRect(context, 85, 1660, 910, 131, 35, '#252440');
    context.font = '900 62px Arial, sans-serif';
    context.fillStyle = '#f7f2e9';
    context.fillText('¿ME SUPERÁS?', 540, 1746);
    context.font = '600 28px Arial, sans-serif';
    context.fillStyle = '#6d6386';
    context.fillText(publicName(name) ? `DESAFÍO DE ${publicName(name)?.toLocaleUpperCase()}` : 'MISMO SEED. TU MEJOR TORRE.', 540, 1840);
    return await new Promise<Blob | null>(resolve => {
      const timeout = setTimeout(() => resolve(null), 2500);
      canvas.toBlob(blob => { clearTimeout(timeout); resolve(blob); }, 'image/png');
    });
  } catch {
    return null;
  }
}

export async function shareResult(result: RunResult, name?: string, image = false): Promise<{ method: 'share' | 'copy' | 'manual'; url: string }> {
  const challenge: Challenge = { version: 1, seed: result.seed, height: result.height, score: result.score, ...(publicName(name) ? { name: publicName(name) } : {}) };
  const url = challengeUrl(challenge);
  const text = `Llegué a ${result.height.toFixed(1)} m en Impossible Tower. ¿Me superás?`;
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const data: ShareData = { title: 'Impossible Tower', text, url };
      if (image && typeof File !== 'undefined') {
        const blob = await createShareCard(result, name);
        if (blob) {
          const file = new File([blob], 'impossible-tower.png', { type: 'image/png' });
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) data.files = [file];
        }
      }
      await navigator.share(data);
      return { method: 'share', url };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return { method: 'manual', url };
    }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return { method: 'copy', url };
    }
  } catch { /* The UI can display/select the link if clipboard permission is denied. */ }
  return { method: 'manual', url };
}
