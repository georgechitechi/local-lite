import { FileDriver } from './types.js';
import { safeDynamicImport, safeDynamicRequire } from '../utils/dynamic.js';

const EXPO_FILE_SYSTEM_PKG = ['expo', 'file', 'system'].join('-');

export interface ExpoFileDriverOptions {
  /**
   * The modern `File` class from `expo-file-system` (SDK 57+).
   * e.g. `import { File } from 'expo-file-system'`
   */
  File?: any;

  /**
   * The modern `Directory` class from `expo-file-system`.
   * e.g. `import { Directory } from 'expo-file-system'`
   */
  Directory?: any;

  /**
   * The modern `Paths` object from `expo-file-system`.
   * e.g. `import { Paths } from 'expo-file-system'`
   */
  Paths?: any;

  /**
   * Base directory path or `Directory` instance for storing files.
   * Defaults to: `new Directory(Paths.document, 'local-lite-blobs')`
   */
  baseDir?: any;

  /**
   * Whether to store files in `Paths.cache` instead of `Paths.document`.
   * Files in cache directory may be cleared by the OS if device storage runs low.
   * Default: false
   */
  useCache?: boolean;
}

/**
 * Universal binary <-> base64 utilities compatible with Node, Browser, and React Native (Hermes).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * FileDriver implementation for Expo / React Native environments.
 * Uses the Expo SDK 58+ `File`, `Directory`, and `Paths` APIs.
 */
export class ExpoFileDriver implements FileDriver {
  private FileClass?: any;
  private DirectoryClass?: any;
  private PathsObj?: any;

  private baseDirOption?: any;
  private useCache: boolean;
  private resolvedBaseDir: any = null;
  private resolvedBaseDirPath: string | null = null;

  constructor(options: ExpoFileDriverOptions = {}) {
    if ('fileSystem' in options) {
      throw new TypeError(
        'ExpoFileDriver no longer accepts fileSystem. Pass File, Directory, and Paths instead.',
      );
    }
    this.FileClass = options.File;
    this.DirectoryClass = options.Directory;
    this.PathsObj = options.Paths;
    this.baseDirOption = options.baseDir;
    this.useCache = Boolean(options.useCache);
  }

  private async resolveClasses(): Promise<void> {
    if (!this.FileClass || !this.DirectoryClass || !this.PathsObj) {
      try {
        const mod =
          safeDynamicRequire(EXPO_FILE_SYSTEM_PKG) ??
          (await safeDynamicImport(EXPO_FILE_SYSTEM_PKG));
        if (mod) {
          this.FileClass = this.FileClass ?? mod.File;
          this.DirectoryClass = this.DirectoryClass ?? mod.Directory;
          this.PathsObj = this.PathsObj ?? mod.Paths;
        }
      } catch (error) {
        if (!this.FileClass) {
          throw new Error(
            'ExpoFileDriver requires expo-file-system SDK 58 or newer.',
            { cause: error },
          );
        }
      }
    }
    if (!this.FileClass) {
      throw new Error(
        'ExpoFileDriver requires the modern File API from expo-file-system SDK 58 or newer.',
      );
    }
  }

  private async getBaseDirectory(): Promise<any> {
    if (this.resolvedBaseDir) return this.resolvedBaseDir;

    await this.resolveClasses();

    if (this.baseDirOption) {
      if (typeof this.baseDirOption === 'string') {
        if (this.DirectoryClass) {
          this.resolvedBaseDir = new this.DirectoryClass(this.baseDirOption);
        } else {
          this.resolvedBaseDirPath = this.baseDirOption.endsWith('/')
            ? this.baseDirOption
            : `${this.baseDirOption}/`;
        }
      } else {
        this.resolvedBaseDir = this.baseDirOption;
      }
    } else if (this.DirectoryClass && this.PathsObj) {
      const root = this.useCache ? this.PathsObj.cache : this.PathsObj.document;
      this.resolvedBaseDir = new this.DirectoryClass(root, 'local-lite-blobs');
    } else {
      throw new Error(
        'ExpoFileDriver requires the modern Directory and Paths APIs from expo-file-system.',
      );
    }

    if (this.resolvedBaseDir) {
      try {
        if (
          !this.resolvedBaseDir.exists &&
          typeof this.resolvedBaseDir.create === 'function'
        ) {
          this.resolvedBaseDir.create({ idempotent: true });
        }
      } catch {}
    }

    return this.resolvedBaseDir;
  }

  /**
   * Resolves a key to a modern Expo `File` instance.
   */
  private async resolveFile(key: string): Promise<any> {
    await this.resolveClasses();
    const baseDir = await this.getBaseDirectory();

    const safeKey = key.replace(/\.\./g, '_').replace(/^[/\\?%*:|"<>]+/, '');

    if (baseDir && this.DirectoryClass) {
      const segments = safeKey.split('/').filter(Boolean);
      const fileName = segments.pop() || 'blob';

      let currentDir = baseDir;
      for (const seg of segments) {
        const safeSeg = seg.replace(/[/\\?%*:|"<>]/g, '_');
        const subDir = new this.DirectoryClass(currentDir, safeSeg);
        if (!subDir.exists) {
          subDir.create({ idempotent: true, intermediates: true });
        }
        currentDir = subDir;
      }

      const safeFileName = fileName.replace(/[/\\?%*:|"<>]/g, '_');
      const file = new this.FileClass(currentDir, safeFileName);
      if (file.parentDirectory && !file.parentDirectory.exists) {
        file.parentDirectory.create({ idempotent: true, intermediates: true });
      }
      return file;
    }

    const basePath =
      this.resolvedBaseDirPath ||
      (this.resolvedBaseDir?.uri
        ? this.resolvedBaseDir.uri.endsWith('/')
          ? this.resolvedBaseDir.uri
          : `${this.resolvedBaseDir.uri}/`
        : undefined);
    if (!basePath) {
      throw new Error(
        'ExpoFileDriver could not resolve a base directory for the requested file.',
      );
    }

    const safePath = safeKey
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.replace(/[/\\?%*:|"<>]/g, '_'))
      .join('/');
    return new this.FileClass(`${basePath}${safePath}`);
  }

  async resolveUri(key: string): Promise<string> {
    const file = await this.resolveFile(key);
    return file.uri;
  }

  async getUri(key: string): Promise<string> {
    return this.resolveUri(key);
  }

  async write(key: string, data: Uint8Array): Promise<string> {
    const file = await this.resolveFile(key);
    if (typeof file.write === 'function') {
      await file.write(data);
    } else if (typeof file.writeSync === 'function') {
      file.writeSync(data);
    } else {
      throw new Error(
        'ExpoFileDriver: The Expo File instance does not support writing.',
      );
    }
    return file.uri;
  }

  async read(key: string): Promise<Uint8Array | null> {
    const file = await this.resolveFile(key);
    if (!file.exists) return null;
    if (typeof file.bytes === 'function')
      return new Uint8Array(await file.bytes());
    if (typeof file.bytesSync === 'function')
      return new Uint8Array(file.bytesSync());
    if (typeof file.arrayBuffer === 'function')
      return new Uint8Array(await file.arrayBuffer());
    if (typeof file.base64 === 'function')
      return base64ToBytes(await file.base64());
    if (typeof file.base64Sync === 'function')
      return base64ToBytes(file.base64Sync());
    throw new Error(
      'ExpoFileDriver: The Expo File instance does not support reading.',
    );
  }

  async delete(key: string): Promise<void> {
    const file = await this.resolveFile(key);
    if (file.exists && typeof file.delete === 'function') await file.delete();
  }

  async exists(key: string): Promise<boolean> {
    const file = await this.resolveFile(key);
    return Boolean(file.exists);
  }

  async getSize(key: string): Promise<number> {
    const file = await this.resolveFile(key);
    if (!file.exists) return 0;
    if (typeof file.size === 'number') return file.size;
    if (typeof file.info === 'function') return (await file.info())?.size ?? 0;
    return 0;
  }

  /**
   * Fast file copy from an existing local URI (e.g. from expo-image-picker or expo-document-picker)
   * into local-lite managed storage without reading entire file contents into memory.
   */
  async copyFrom(sourceUri: string, key: string): Promise<string> {
    const file = await this.resolveFile(key);
    const sourceFile = new this.FileClass(sourceUri);
    if (!sourceFile.exists)
      throw new Error(
        `ExpoFileDriver: Source file "${sourceUri}" does not exist.`,
      );
    if (typeof sourceFile.copy === 'function') {
      await sourceFile.copy(file);
    } else {
      const contents =
        typeof sourceFile.bytes === 'function'
          ? await sourceFile.bytes()
          : typeof sourceFile.bytesSync === 'function'
            ? sourceFile.bytesSync()
            : null;
      if (!contents) {
        throw new Error(
          'ExpoFileDriver: The source File instance does not support copying or reading.',
        );
      }
      await this.write(key, new Uint8Array(contents));
    }
    return file.uri;
  }

  /**
   * Downloads a remote URL directly to the destination key on disk.
   */
  async downloadFrom(remoteUrl: string, key: string): Promise<string> {
    const file = await this.resolveFile(key);

    if (typeof this.FileClass.downloadFileAsync === 'function') {
      try {
        await this.FileClass.downloadFileAsync(remoteUrl, file, {
          idempotent: true,
        });
        return file.uri;
      } catch {}
    }

    const response = await fetch(remoteUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download file from "${remoteUrl}": ${response.statusText}`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return await this.write(key, new Uint8Array(arrayBuffer));
  }
}
