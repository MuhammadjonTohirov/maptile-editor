// Right-click operations menu for the currently selected feature (rule F1
// pure-ish UI wrapper, mirrors BulkLoadUI/AuthController's self-wiring shape).
const APPLICABLE_OPS = {
  Point: ['copy', 'delete'],
  LineString: ['flipLong', 'flipShort', 'copy', 'delete'],
  Polygon: ['circularise', 'square', 'flipLong', 'flipShort', 'copy', 'delete'],
};

export class FeatureMenuUI {
  constructor({ onOperation }) {
    this.onOperation = onOperation;
    this.menu = document.getElementById('feature-context-menu');
    this.list = document.getElementById('feature-context-menu-list');
    this.list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-op]');
      if (button && !button.disabled) {
        this.close();
        this.onOperation(button.dataset.op);
      }
    });
    document.addEventListener('click', (event) => {
      if (!this.isOpen() || this.menu.contains(event.target)) return;
      this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen()) this.close();
    });
  }

  isOpen() {
    return !this.menu.hidden;
  }

  // pageX/pageY are viewport coordinates (contextmenu's clientX/clientY);
  // geometryType picks which ops are enabled, matching iD/RapiD graying out
  // operations that don't apply to the selected shape.
  open(pageX, pageY, geometryType) {
    const applicable = APPLICABLE_OPS[geometryType] || [];
    for (const button of this.list.querySelectorAll('button[data-op]')) {
      button.disabled = !applicable.includes(button.dataset.op);
    }
    this.menu.hidden = false;
    const { offsetWidth: width, offsetHeight: height } = this.menu;
    const maxX = window.innerWidth - width - 8;
    const maxY = window.innerHeight - height - 8;
    this.menu.style.left = `${Math.max(8, Math.min(pageX, maxX))}px`;
    this.menu.style.top = `${Math.max(8, Math.min(pageY, maxY))}px`;
  }

  close() {
    this.menu.hidden = true;
  }
}
