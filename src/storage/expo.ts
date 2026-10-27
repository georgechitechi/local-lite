import { FileDriver } from './types.js';

export interface ExpoFileSystemModule {
  // Modern Expo (>57/58) Object API
  File?: any;
  Directory?: any;
  Paths?: any;

  // Legacy Expo API
  documentDirectory?: string | null;
  cacheDirectory?: string | null;
  EncodingType?: {
    UTF8: string;
    Base64: string;
  };
  getInfoAsync?(
    fileUri: string,
    options?: { md5?: boolean; size?: boolean }
  ): Promise<{ exists: boolean; isDirectory?: boolean; size?: number; uri?: string }>;
  writeAsStringAsync?(
    fileUri: string,
    contents: string,
    options?: { encoding?: string }
  ): Promise<void>;
  readAsStringAsync?(
    fileUri: string,
    options?: { encoding?: string; length?: number; position?: number }
  ): Promise<string>;
  makeDirectoryAsync?(
    fileUri: string,
    options?: { intermediates?: boolean }
  ): Promise<void>;
  deleteAsync?(
    fileUri: string,
    options?: { idempotent?: boolean }
  ): Promise<void>;
  copyAsync?(options: { from: string; to: string }): Promise<void>;
  moveAsync?(options: { from: string; to: string }): Promise<void>;
  downloadAsync?(
    url: string,
    fileUri: string,
    options?: { md5?: boolean; headers?: Record<string, string>; sessionType?: any }
  ): Promise<{ uri: string; status: number; headers: Record<string, string>; md5?: string }>;
}

export interface ExpoFileDriverOptions {
  /**
   * The modern `File` class from `expo-file-system` (SDK >57/58).
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
   * The `expo-file-system` module instance.
   * e.g. `import * as FileSystem from 'expo-file-system'`
   */
  fileSystem?: ExpoFileSystemModule | any;

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
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
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
 * Uses modern Expo (>57/58) `File`, `Directory`, and `Paths` APIs when available,
 * with seamless fallback for legacy `expo-file-system` environments.
 */
export class ExpoFileDriver implements FileDriver {
  private FileClass?: any;
  private DirectoryClass?: any;
  private PathsObj?: any;
  private legacyFs?: any;

  private baseDirOption?: any;
  private useCache: boolean;
  private resolvedBaseDir: any = null;
  private resolvedBaseDirPath: string | null = null;
  private ensuredDirs = new Set<string>();

  constructor(options: ExpoFileDriverOptions = {}) {
    this.FileClass = options.File ?? options.fileSystem?.File;
    this.DirectoryClass = options.Directory ?? options.fileSystem?.Directory;
    this.PathsObj = options.Paths ?? options.fileSystem?.Paths;
    this.legacyFs = options.fileSystem;
    this.baseDirOption = options.baseDir;
    this.useCache = Boolean(options.useCache);
  }

  private async resolveClasses(): Promise<{
    FileClass: any;
    DirectoryClass: any;
    PathsObj: any;
    legacyFs: any;
  }> {
    if (!this.FileClass || !this.DirectoryClass || !this.PathsObj) {
      try {
        // @ts-ignore
        const mod = await import('expo-file-system');
        this.FileClass = this.FileClass ?? mod.File;
        this.DirectoryClass = this.DirectoryClass ?? mod.Directory;
        this.PathsObj = this.PathsObj ?? mod.Paths;
        this.legacyFs = this.legacyFs ?? mod;
      } catch {
        // Dynamic import may fail if not installed or bundler forbids
      }
    }
    return {
      FileClass: this.FileClass,
      DirectoryClass: this.DirectoryClass,
      PathsObj: this.PathsObj,
      legacyFs: this.legacyFs,
    };
  }

  private async getBaseDirectory(): Promise<any> {
    if (this.resolvedBaseDir) return this.resolvedBaseDir;

    const { DirectoryClass, PathsObj, legacyFs } = await this.resolveClasses();

    if (this.baseDirOption) {
      if (typeof this.baseDirOption === 'string') {
        if (DirectoryClass) {
          this.resolvedBaseDir = new DirectoryClass(this.baseDirOption);
        } else {
          this.resolvedBaseDirPath = this.baseDirOption.endsWith('/')
            ? this.baseDirOption
            : `${this.baseDirOption}/`;
        }
      } else {
        this.resolvedBaseDir = this.baseDirOption;
      }
    } else if (DirectoryClass && PathsObj) {
      const root = this.useCache ? PathsObj.cache : PathsObj.document;
      this.resolvedBaseDir = new DirectoryClass(root, 'local-lite-blobs');
    } else if (legacyFs) {
      const root = this.useCache ? legacyFs.cacheDirectory : legacyFs.documentDirectory;
      if (!root) {
        throw new Error('ExpoFileDriver: FileSystem documentDirectory is null or unavailable.');
      }
      this.resolvedBaseDirPath = root.endsWith('/') ? `${root}local-lite-blobs/` : `${root}/local-lite-blobs/`;
    }

    if (this.resolvedBaseDir) {
      try {
        if (!this.resolvedBaseDir.exists && typeof this.resolvedBaseDir.create === 'function') {
          this.resolvedBaseDir.create({ idempotent: true });
        }
      } catch {}
    }

    return this.resolvedBaseDir;
  }

  /**
   * Resolves a key to a modern Expo `File` instance (if File class is available)
   * or a string URI path.
   */
  private async resolveFileOrUri(key: string): Promise<{ file: any | null; uri: string }> {
    const { FileClass, DirectoryClass } = await this.resolveClasses();
    const baseDir = await this.getBaseDirectory();

    const safeKey = key.replace(/\.\./g, '_').replace(/^[/\\?%*:|"<>]+/, '');

    // Modern Expo File & Directory path
    if (FileClass && baseDir) {
      const segments = safeKey.split('/').filter(Boolean);
      const fileName = segments.pop() || 'blob';

      let currentDir = baseDir;
      for (const seg of segments) {
        const safeSeg = seg.replace(/[/\\?%*:|"<>]/g, '_');
        if (DirectoryClass) {
          const subDir = new DirectoryClass(currentDir, safeSeg);
          try {
            if (!subDir.exists && typeof subDir.create === 'function') {
              subDir.create({ idempotent: true });
            }
          } catch {}
          currentDir = subDir;
        }
      }

      const safeFileName = fileName.replace(/[/\\?%*:|"<>]/g, '_');
      const file = new FileClass(currentDir, safeFileName);
      return { file, uri: file.uri };
    }

    // Legacy URI resolution
    const basePath =
      this.resolvedBaseDirPath ||
      (this.resolvedBaseDir?.uri
        ? this.resolvedBaseDir.uri.endsWith('/')
          ? this.resolvedBaseDir.uri
          : `${this.resolvedBaseDir.uri}/`
        : 'file:///local-lite-blobs/');

    const uri = `${basePath}${safeKey}`;
    return { file: null, uri };
  }

  async resolveUri(key: string): Promise<string> {
    const { uri } = await this.resolveFileOrUri(key);
    return uri;
  }

  async getUri(key: string): Promise<string> {
    return this.resolveUri(key);
  }

  private async ensureDirectory(fileUri: string): Promise<void> {
    const { legacyFs } = await this.resolveClasses();
    if (!legacyFs || typeof legacyFs.makeDirectoryAsync !== 'function') return;

    const lastSlash = fileUri.lastIndexOf('/');
    if (lastSlash === -1) return;
    const dir = fileUri.substring(0, lastSlash);

    if (this.ensuredDirs.has(dir)) return;

    try {
      await legacyFs.makeDirectoryAsync(dir, { intermediates: true });
      this.ensuredDirs.add(dir);
    } catch {
      this.ensuredDirs.add(dir);
    }
  }

  async write(key: string, data: Uint8Array): Promise<string> {
    const { file, uri } = await this.resolveFileOrUri(key);

    // Modern Expo File (>57/58)
    if (file) {
      // Ensure parent directory exists before writing
      try {
        if (file.parentDirectory && !file.parentDirectory.exists) {
          file.parentDirectory.create({ idempotent: true });
        }
      } catch {}

      if (typeof file.write === 'function') {
        await file.write(data);
        return file.uri;
      }
      if (typeof file.writeSync === 'function') {
        file.writeSync(data);
        return file.uri;
      }
    }

    // Legacy FileSystem API
    const { legacyFs } = await this.resolveClasses();
    if (legacyFs && typeof legacyFs.writeAsStringAsync === 'function') {
      await this.ensureDirectory(uri);
      const base64 = bytesToBase64(data);
      const encoding = legacyFs.EncodingType?.Base64 ?? 'base64';
      await legacyFs.writeAsStringAsync(uri, base64, { encoding });
      return uri;
    }

    throw new Error('ExpoFileDriver: No supported File or write method found on expo-file-system.');
  }

  async read(key: string): Promise<Uint8Array | null> {
    const { file, uri } = await this.resolveFileOrUri(key);

    // Modern Expo File (>57/58)
    if (file) {
      try {
        if (!file.exists) {
          return null;
        }
        if (typeof file.bytes === 'function') {
          const res = await file.bytes();
          return new Uint8Array(res);
        }
        if (typeof file.bytesSync === 'function') {
          return new Uint8Array(file.bytesSync());
        }
        if (typeof file.arrayBuffer === 'function') {
          const ab = await file.arrayBuffer();
          return new Uint8Array(ab);
        }
        if (typeof file.base64 === 'function') {
          const b64 = await file.base64();
          return base64ToBytes(b64);
        }
        if (typeof file.base64Sync === 'function') {
          return base64ToBytes(file.base64Sync());
        }
      } catch {
        return null;
      }
    }

    // Legacy FileSystem API
    const { legacyFs } = await this.resolveClasses();
    if (legacyFs && typeof legacyFs.readAsStringAsync === 'function') {
      try {
        if (typeof legacyFs.getInfoAsync === 'function') {
          const info = await legacyFs.getInfoAsync(uri);
          if (!info.exists) return null;
        }
        const encoding = legacyFs.EncodingType?.Base64 ?? 'base64';
        const base64 = await legacyFs.readAsStringAsync(uri, { encoding });
        return base64ToBytes(base64);
      } catch {
        return null;
      }
    }

    return null;
  }

  async delete(key: string): Promise<void> {
    const { file, uri } = await this.resolveFileOrUri(key);

    // Modern Expo File (>57/58)
    if (file) {
      try {
        if (file.exists && typeof file.delete === 'function') {
          file.delete();
        }
        return;
      } catch {
        return;
      }
    }

    // Legacy FileSystem API
    const { legacyFs } = await this.resolveClasses();
    if (legacyFs && typeof legacyFs.deleteAsync === 'function') {
      try {
        await legacyFs.deleteAsync(uri, { idempotent: true });
      } catch {}
    }
  }

  async exists(key: string): Promise<boolean> {
    const { file, uri } = await this.resolveFileOrUri(key);

    // Modern Expo File (>57/58)
    if (file) {
      try {
        return Boolean(file.exists);
      } catch {
        return false;
      }
    }

    // Legacy FileSystem API
    const { legacyFs } = await this.resolveClasses();
    if (legacyFs && typeof legacyFs.getInfoAsync === 'function') {
      try {
        const info = await legacyFs.getInfoAsync(uri);
        return Boolean(info.exists);
      } catch {
        return false;
      }
    }

    return false;
  }

  async getSize(key: string): Promise<number> {
    const { file, uri } = await this.resolveFileOrUri(key);

    // Modern Expo File (>57/58)
    if (file) {
      try {
        if (!file.exists) return 0;
        if (typeof file.size === 'number') return file.size;
        if (typeof file.info === 'function') {
          const info = file.info();
          return info?.size ?? 0;
        }
      } catch {
        return 0;
      }
    }

    // Legacy FileSystem API
    const { legacyFs } = await this.resolveClasses();
    if (legacyFs && typeof legacyFs.getInfoAsync === 'function') {
      try {
        const info = await legacyFs.getInfoAsync(uri, { size: true });
        return info.size ?? 0;
      } catch {
        return 0;
      }
    }

    return 0;
  }

  /**
   * Fast file copy from an existing local URI (e.g. from expo-image-picker or expo-document-picker)
   * into local-lite managed storage without reading entire file contents into memory.
   */
  async copyFrom(sourceUri: string, key: string): Promise<string> {
    const { file, uri } = await this.resolveFileOrUri(key);
    const { FileClass, legacyFs } = await this.resolveClasses();

    // Modern Expo File (>57/58)
    if (file && FileClass) {
      try {
        const srcFile = new FileClass(sourceUri);
        if (srcFile.exists && typeof srcFile.copy === 'function') {
          if (file.parentDirectory && !file.parentDirectory.exists) {
            file.parentDirectory.create({ idempotent: true });
          }
          await srcFile.copy(file);
          return file.uri;
        }
      } catch {}
    }

    // Legacy FileSystem API
    if (legacyFs && typeof legacyFs.copyAsync === 'function') {
      await this.ensureDirectory(uri);
      await legacyFs.copyAsync({ from: sourceUri, to: uri });
      return uri;
    }

    // Fallback: read bytes and write
    if (legacyFs && typeof legacyFs.readAsStringAsync === 'function') {
      const encoding = legacyFs.EncodingType?.Base64 ?? 'base64';
      const content = await legacyFs.readAsStringAsync(sourceUri, { encoding });
      await this.write(key, base64ToBytes(content));
      return uri;
    }

    return uri;
  }

  /**
   * Downloads a remote URL directly to the destination key on disk.
   */
  async downloadFrom(remoteUrl: string, key: string): Promise<string> {
    const { file, uri } = await this.resolveFileOrUri(key);
    const { FileClass, legacyFs } = await this.resolveClasses();

    // Modern Expo File (>57/58)
    if (file && FileClass && typeof FileClass.downloadFileAsync === 'function') {
      try {
        if (file.parentDirectory && !file.parentDirectory.exists) {
          file.parentDirectory.create({ idempotent: true });
        }
        await FileClass.downloadFileAsync(remoteUrl, file, { idempotent: true });
        return file.uri;
      } catch {}
    }

    // Legacy FileSystem API
    if (legacyFs && typeof legacyFs.downloadAsync === 'function') {
      await this.ensureDirectory(uri);
      const res = await legacyFs.downloadAsync(remoteUrl, uri);
      return res.uri;
    }

    // Universal fetch fallback
    const response = await fetch(remoteUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file from "${remoteUrl}": ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return await this.write(key, new Uint8Array(arrayBuffer));
  }
}
