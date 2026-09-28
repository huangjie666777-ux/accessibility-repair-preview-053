const OUTLINE_ID = 'kfi-focus-outline';

/**
 * 使用独立的 fixed 定位描边层，在滚动、缩放与布局变化时逐帧跟随真实节点。
 */
export class FocusOutline {
  private el: HTMLDivElement;
  private target: HTMLElement | null = null;
  private rafId = 0;

  constructor(private doc: Document) {
    this.el = doc.createElement('div');
    this.el.dataset.kfiIgnore = 'true';
    Object.assign(this.el.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      border: '2px solid #e53935',
      borderRadius: '4px',
      boxShadow: '0 0 0 3px rgba(229,57,53,0.25)',
      transition: 'all 120ms ease-out',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    doc.body.appendChild(this.el);
  }

  track(target: HTMLElement): void {
    this.target = target;
    this.el.style.display = 'block';
    this.draw();
    cancelAnimationFrame(this.rafId);
    const loop = () => {
      this.draw();
      this.rafId = this.doc.defaultView?.requestAnimationFrame(loop) ?? 0;
    };
    this.rafId = this.doc.defaultView?.requestAnimationFrame(loop) ?? 0;
  }

  private draw(): void {
    if (!this.target || !this.target.isConnected) {
      this.clear();
      return;
    }
    const rect = this.target.getBoundingClientRect();
    this.el.style.top = `${rect.top - 3}px`;
    this.el.style.left = `${rect.left - 3}px`;
    this.el.style.width = `${rect.width + 6}px`;
    this.el.style.height = `${rect.height + 6}px`;
  }

  clear(): void {
    if (this.rafId) this.doc.defaultView?.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.target = null;
    this.el.style.display = 'none';
  }

  destroy(): void {
    this.clear();
    this.el.remove();
  }
}
