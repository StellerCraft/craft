/**
 * Template Hot Reload Tests (#376)
 *
 * Tests for template hot reload during development:
 * - File change detection
 * - Reload trigger correctness
 * - Preview update after reload
 * - State preservation during reload
 * - Reload error handling
 *
 * Run: vitest run tests/templates/hot-reload.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileType = 'tsx' | 'ts' | 'css' | 'json' | 'md' | 'png';

interface FileChangeEvent {
  path: string;
  type: 'add' | 'change' | 'unlink';
  fileType: FileType;
  timestamp: Date;
}

interface ReloadResult {
  success: boolean;
  reloadedAt: Date;
  affectedFiles: string[];
  error?: string;
}

interface PreviewState {
  templateId: string;
  content: string;
  version: number;
  lastReloadedAt: Date | null;
}

interface WatcherState {
  watching: boolean;
  watchedPaths: string[];
}

// ---------------------------------------------------------------------------
// Hot Reload Service
// ---------------------------------------------------------------------------

class TemplateHotReloadService {
  private watcher: WatcherState = { watching: false, watchedPaths: [] };
  private previews = new Map<string, PreviewState>();
  private reloadHistory: ReloadResult[] = [];
  private onReloadCallbacks: Array<(result: ReloadResult) => void> = [];

  // File extensions that trigger a reload
  private readonly reloadTriggerExtensions: FileType[] = ['tsx', 'ts', 'css', 'json'];

  startWatcher(paths: string[]): void {
    if (paths.length === 0) throw new Error('At least one path must be watched');
    this.watcher = { watching: true, watchedPaths: paths };
  }

  stopWatcher(): void {
    this.watcher = { watching: false, watchedPaths: [] };
  }

  isWatching(): boolean {
    return this.watcher.watching;
  }

  getWatchedPaths(): string[] {
    return [...this.watcher.watchedPaths];
  }

  onReload(cb: (result: ReloadResult) => void): void {
    this.onReloadCallbacks.push(cb);
  }

  initPreview(templateId: string, content: string): PreviewState {
    const state: PreviewState = {
      templateId,
      content,
      version: 1,
      lastReloadedAt: null,
    };
    this.previews.set(templateId, state);
    return state;
  }

  getPreview(templateId: string): PreviewState | undefined {
    return this.previews.get(templateId);
  }

  handleFileChange(templateId: string, event: FileChangeEvent): ReloadResult {
    if (!this.watcher.watching) {
      return {
        success: false,
        reloadedAt: new Date(),
        affectedFiles: [],
        error: 'Watcher is not running',
      };
    }

    const shouldReload = this.reloadTriggerExtensions.includes(event.fileType);

    if (!shouldReload) {
      return {
        success: false,
        reloadedAt: new Date(),
        affectedFiles: [],
        error: `File type .${event.fileType} does not trigger reload`,
      };
    }

    // Simulate reload
    const preview = this.previews.get(templateId);
    if (preview) {
      preview.version += 1;
      preview.lastReloadedAt = new Date();
    }

    const result: ReloadResult = {
      success: true,
      reloadedAt: new Date(),
      affectedFiles: [event.path],
    };

    this.reloadHistory.push(result);
    this.onReloadCallbacks.forEach((cb) => cb(result));
    return result;
  }

  handleFileChangeWithError(templateId: string, event: FileChangeEvent, errorMsg: string): ReloadResult {
    const result: ReloadResult = {
      success: false,
      reloadedAt: new Date(),
      affectedFiles: [event.path],
      error: errorMsg,
    };
    this.reloadHistory.push(result);
    return result;
  }

  getReloadHistory(): ReloadResult[] {
    return [...this.reloadHistory];
  }

  clearHistory(): void {
    this.reloadHistory = [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(path: string, fileType: FileType, type: FileChangeEvent['type'] = 'change'): FileChangeEvent {
  return { path, fileType, type, timestamp: new Date() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Template Hot Reload', () => {
  let service: TemplateHotReloadService;
  const templateId = 'tmpl_stellar_dex';

  beforeEach(() => {
    service = new TemplateHotReloadService();
    service.startWatcher(['/templates/stellar-dex/src']);
    service.initPreview(templateId, '<div>Initial content</div>');
  });

  // -------------------------------------------------------------------------
  describe('File Watcher', () => {
    it('starts watching the specified paths', () => {
      expect(service.isWatching()).toBe(true);
      expect(service.getWatchedPaths()).toContain('/templates/stellar-dex/src');
    });

    it('stops watching when stopWatcher is called', () => {
      service.stopWatcher();
      expect(service.isWatching()).toBe(false);
    });

    it('throws when starting with no paths', () => {
      const svc = new TemplateHotReloadService();
      expect(() => svc.startWatcher([])).toThrow('At least one path');
    });

    it('watches multiple paths', () => {
      const svc = new TemplateHotReloadService();
      svc.startWatcher(['/path/a', '/path/b', '/path/c']);
      expect(svc.getWatchedPaths()).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  describe('Reload Trigger on File Change', () => {
    it('triggers reload on .tsx file change', () => {
      const result = service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));
      expect(result.success).toBe(true);
      expect(result.affectedFiles).toContain('src/App.tsx');
    });

    it('triggers reload on .ts file change', () => {
      const result = service.handleFileChange(templateId, makeEvent('src/utils.ts', 'ts'));
      expect(result.success).toBe(true);
    });

    it('triggers reload on .css file change', () => {
      const result = service.handleFileChange(templateId, makeEvent('src/styles.css', 'css'));
      expect(result.success).toBe(true);
    });

    it('triggers reload on .json file change', () => {
      const result = service.handleFileChange(templateId, makeEvent('config.json', 'json'));
      expect(result.success).toBe(true);
    });

    it('does NOT trigger reload on .md file change', () => {
      const result = service.handleFileChange(templateId, makeEvent('README.md', 'md'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('.md');
    });

    it('does NOT trigger reload on image file change', () => {
      const result = service.handleFileChange(templateId, makeEvent('logo.png', 'png'));
      expect(result.success).toBe(false);
    });

    it('does NOT trigger reload when watcher is stopped', () => {
      service.stopWatcher();
      const result = service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('not running');
    });
  });

  // -------------------------------------------------------------------------
  describe('Preview Update After Reload', () => {
    it('increments preview version on reload', () => {
      const before = service.getPreview(templateId)!.version;
      service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));
      const after = service.getPreview(templateId)!.version;
      expect(after).toBe(before + 1);
    });

    it('sets lastReloadedAt after reload', () => {
      expect(service.getPreview(templateId)!.lastReloadedAt).toBeNull();
      service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));
      expect(service.getPreview(templateId)!.lastReloadedAt).toBeInstanceOf(Date);
    });

    it('increments version on each successive reload', () => {
      service.handleFileChange(templateId, makeEvent('src/A.tsx', 'tsx'));
      service.handleFileChange(templateId, makeEvent('src/B.tsx', 'tsx'));
      service.handleFileChange(templateId, makeEvent('src/C.tsx', 'tsx'));
      expect(service.getPreview(templateId)!.version).toBe(4); // 1 initial + 3
    });

    it('does not update preview version when reload is skipped', () => {
      const before = service.getPreview(templateId)!.version;
      service.handleFileChange(templateId, makeEvent('README.md', 'md'));
      expect(service.getPreview(templateId)!.version).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('State Preservation During Reload', () => {
    it('preserves templateId across reloads', () => {
      service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));
      expect(service.getPreview(templateId)!.templateId).toBe(templateId);
    });

    it('preserves content across reloads (content is not cleared)', () => {
      const originalContent = service.getPreview(templateId)!.content;
      service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));
      expect(service.getPreview(templateId)!.content).toBe(originalContent);
    });

    it('maintains independent state for multiple templates', () => {
      const tmpl2 = 'tmpl_payment_gateway';
      service.initPreview(tmpl2, '<div>Payment</div>');

      service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));

      expect(service.getPreview(templateId)!.version).toBe(2);
      expect(service.getPreview(tmpl2)!.version).toBe(1); // untouched
    });
  });

  // -------------------------------------------------------------------------
  describe('Reload Callbacks', () => {
    it('invokes registered callback on successful reload', () => {
      const cb = vi.fn();
      service.onReload(cb);

      service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));

      expect(cb).toHaveBeenCalledOnce();
      expect(cb.mock.calls[0][0].success).toBe(true);
    });

    it('does not invoke callback when reload is skipped', () => {
      const cb = vi.fn();
      service.onReload(cb);

      service.handleFileChange(templateId, makeEvent('README.md', 'md'));

      expect(cb).not.toHaveBeenCalled();
    });

    it('invokes multiple callbacks', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      service.onReload(cb1);
      service.onReload(cb2);

      service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  describe('Reload Error Handling', () => {
    it('records failed reload in history', () => {
      service.handleFileChangeWithError(
        templateId,
        makeEvent('src/App.tsx', 'tsx'),
        'Compilation error: unexpected token'
      );

      const history = service.getReloadHistory();
      expect(history).toHaveLength(1);
      expect(history[0].success).toBe(false);
      expect(history[0].error).toContain('Compilation error');
    });

    it('continues tracking history after errors', () => {
      service.handleFileChangeWithError(templateId, makeEvent('src/A.tsx', 'tsx'), 'Error A');
      service.handleFileChange(templateId, makeEvent('src/B.tsx', 'tsx'));

      const history = service.getReloadHistory();
      expect(history).toHaveLength(2);
      expect(history[0].success).toBe(false);
      expect(history[1].success).toBe(true);
    });

    it('does not increment preview version on error', () => {
      const before = service.getPreview(templateId)!.version;
      service.handleFileChangeWithError(templateId, makeEvent('src/App.tsx', 'tsx'), 'Error');
      expect(service.getPreview(templateId)!.version).toBe(before);
    });

    it('clears reload history', () => {
      service.handleFileChange(templateId, makeEvent('src/App.tsx', 'tsx'));
      service.clearHistory();
      expect(service.getReloadHistory()).toHaveLength(0);
    });
  });
});
