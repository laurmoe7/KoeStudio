// Draws brush dabs onto a stroke canvas. Soft brushes use a pre-rendered round tip (a radial gradient in the
// brush colour) scaled to each dab; fully hard brushes draw anti-aliased circles.

const TIP = 128;

export class Painter {
  constructor(ctx, { color, hardness }) {
    this.ctx = ctx;
    this.color = color;
    this.hard = hardness >= 0.99;
    if (!this.hard) this.tip = makeTip(color, hardness);
  }
  dab(x, y, size, alpha) {
    const ctx = this.ctx;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (this.hard) {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.35, size / 2), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.drawImage(this.tip, x - size / 2, y - size / 2, size, size);
    }
  }
}

function makeTip(color, hardness) {
  const c = document.createElement('canvas');
  c.width = c.height = TIP;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(TIP / 2, TIP / 2, 0, TIP / 2, TIP / 2, TIP / 2);
  const solid = Math.max(0, Math.min(0.98, hardness));
  g.addColorStop(0, color);
  g.addColorStop(solid, color);
  // ease out to transparent (a few stops approximate a smooth falloff)
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const a = Math.pow(1 - t, 2);
    g.addColorStop(solid + (1 - solid) * t, withAlpha(color, a));
  }
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TIP, TIP);
  return c;
}

function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a.toFixed(3)})`;
}
