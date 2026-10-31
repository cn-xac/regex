import {
  applyCanvasOps,
  renderCanvasOps
} from '@x-ac/regex-core';
import type { Diagram, PaintContext } from '@x-ac/regex-core';

/**
 * Canvas 后端适配器 —— 把 core 的 DOM-free 指令序列落到真实的 CanvasRenderingContext2D。
 *
 * core 的 `PaintContext` 里有三个**原生 ctx 没有/不兼容**的方法，必须在此实现：
 * - `rect(x,y,w,h,radius)`：原生 `rect` 无 radius 且**不会 beginPath**；这里自带 beginPath +
 *   `roundRect`（回退 arcTo 手工圆角），使每个盒是独立子路径 —— 顺带修掉 `renderCanvasOps`
 *   未发 beginPath 导致多个盒累积进同一条 path、fill/stroke 串盒的问题。
 * - `circle(x,y,r)`：原生无此方法，实心圆点用 beginPath + arc + fill。
 * - `path(points,radius,dash)`：原生无此方法；ops 已在其前发 beginPath，这里只做 moveTo +
 *   圆角折线（`arcTo` 自动按段长 clamp 半径）+ 末点，并按 dash `setLineDash`。
 *
 * `setLineDash(null)`（core 对实线/锚点这么传）原生会抛，这里统一把 null 归一成 []。
 */
export function renderDiagramToCanvas(
  canvas: HTMLCanvasElement,
  diagram: Diagram,
  theme: string
): void {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssW = Math.max(1, Math.ceil(diagram.width));
  const cssH = Math.max(1, Math.ceil(diagram.height));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const native = canvas.getContext('2d');
  if (native === null) return;
  native.setTransform(dpr, 0, 0, dpr, 0, 0);
  native.clearRect(0, 0, cssW, cssH);

  const ctx: PaintContext = {
    get strokeStyle() {
      return native.strokeStyle as string;
    },
    set strokeStyle(v: string) {
      native.strokeStyle = v;
    },
    get fillStyle() {
      return native.fillStyle as string;
    },
    set fillStyle(v: string) {
      native.fillStyle = v;
    },
    get lineWidth() {
      return native.lineWidth;
    },
    set lineWidth(v: number) {
      native.lineWidth = v;
    },
    get font() {
      return native.font;
    },
    set font(v: string) {
      native.font = v;
    },
    get textBaseline() {
      return native.textBaseline;
    },
    set textBaseline(v: string) {
      native.textBaseline = v as CanvasTextBaseline;
    },
    get textAlign() {
      return native.textAlign;
    },
    set textAlign(v: string) {
      native.textAlign = v as CanvasTextAlign;
    },
    beginPath: () => native.beginPath(),
    moveTo: (x, y) => native.moveTo(x, y),
    lineTo: (x, y) => native.lineTo(x, y),
    fill: () => native.fill(),
    stroke: () => native.stroke(),
    fillText: (text, x, y) => native.fillText(text, x, y),
    setLineDash: (dash) => native.setLineDash(dash ?? []),
    rect: (x, y, w, h, radius) => {
      native.beginPath();
      if (typeof native.roundRect === 'function' && radius > 0) {
        native.roundRect(x, y, w, h, radius);
      } else if (radius > 0) {
        roundedRectFallback(native, x, y, w, h, radius);
      } else {
        native.rect(x, y, w, h);
      }
    },
    circle: (x, y, r) => {
      native.beginPath();
      native.arc(x, y, r, 0, Math.PI * 2);
      native.fill();
    },
    path: (points, radius, dash) => {
      native.setLineDash(dash ?? []);
      const n = points.length;
      if (n === 0) return;
      const first = points[0];
      if (first === undefined) return;
      native.moveTo(first[0], first[1]);
      if (n === 1) return;
      const last = points[n - 1];
      if (n === 2) {
        if (last !== undefined) native.lineTo(last[0], last[1]);
        return;
      }
      for (let i = 1; i < n - 1; i++) {
        const cur = points[i];
        const next = points[i + 1];
        if (cur === undefined || next === undefined) continue;
        native.arcTo(cur[0], cur[1], next[0], next[1], radius);
      }
      if (last !== undefined) native.lineTo(last[0], last[1]);
    }
  };

  applyCanvasOps(renderCanvasOps(diagram, { theme }), ctx);
}

/** roundRect 不可用时手工圆角（与 arcTo 一致的观感，四角用 quadratic 更贴合 core 的 SVG）。 */
function roundedRectFallback(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rRaw: number
): void {
  const r = Math.min(rRaw, w / 2, h / 2);
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
