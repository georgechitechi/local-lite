import { NetworkStatusProvider } from '../../core/types.js';

export class DefaultNetworkStatusProvider implements NetworkStatusProvider {
  private _isOnline: boolean = true;
  private listeners: Set<(isOnline: boolean) => void> = new Set();
  private cleanupBrowserListeners?: () => void;

  constructor(initialOnline: boolean = true) {
    this._isOnline = initialOnline;

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
        this._isOnline = navigator.onLine;
      }

      const onOnline = () => this.setOnline(true);
      const onOffline = () => this.setOnline(false);

      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);

      this.cleanupBrowserListeners = () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    }
  }

  isOnline(): boolean {
    return this._isOnline;
  }

  setOnline(status: boolean): void {
    if (this._isOnline !== status) {
      this._isOnline = status;
      for (const listener of this.listeners) {
        try {
          listener(status);
        } catch (err) {
          console.error('Error in network listener:', err);
        }
      }
    }
  }

  subscribe(callback: (isOnline: boolean) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  destroy(): void {
    if (this.cleanupBrowserListeners) {
      this.cleanupBrowserListeners();
    }
    this.listeners.clear();
  }
}
