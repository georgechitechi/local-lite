import { FileDriver } from './types.js';

/**
 * Universal in-memory driver (ideal for tests, memory caches, and browser storage fallback).
 */
export class MemoryFileDriver implements FileDriver {
  private files: Map<string, Uint8Array> = new Map();

  async write(key: string, data: Uint8Array): Promise<string> {
    this.files.set(key, new Uint8Array(data));
    return `memory://${key}`;
  }

  async read(key: string): Promise<Uint8Array | null> {
    const file = this.files.get(key);
    return file ? new Uint8Array(file) : null;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  clear(): void {
    this.files.clear();
  }
}

/**
 * Node.js filesystem driver for writing blobs to disk.
 */
export class NodeFileDriver implements FileDriver {
  constructor(private baseDir: string = './.local-lite-blobs') {}

  private async getFs() {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      return { fs, path };
    } catch {
      throw new Error('NodeFileDriver is only supported in Node.js environments.');
    }
  }

  private async getResolvedPath(key: string): Promise<string> {
    const { path } = await this.getFs();
    // sanitize key to prevent directory traversal
    const safeKey = key.replace(/\.\./g, '_');
    return path.resolve(this.baseDir, safeKey);
  }

  async write(key: string, data: Uint8Array): Promise<string> {
    const { fs, path } = await this.getFs();
    const filePath = await this.getResolvedPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async read(key: string): Promise<Uint8Array | null> {
    const { fs } = await this.getFs();
    const filePath = await this.getResolvedPath(key);
    try {
      const buffer = await fs.readFile(filePath);
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const { fs } = await this.getFs();
    const filePath = await this.getResolvedPath(key);
    try {
      await fs.unlink(filePath);
    } catch {
      // file might already be removed
    }
  }

  async exists(key: string): Promise<boolean> {
    const { fs } = await this.getFs();
    const filePath = await this.getResolvedPath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
