import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { BackupDatabase, BackupStorage } from './index.js';

const MAGIC_HEADER = new Uint8Array([0x4c, 0x4c, 0x45, 0x4e, 0x43, 0x31]); // "LLENC1"
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const DEFAULT_ITERATIONS = 50000;

export interface EncryptedBackupOptions {
  passphrase: string;
  fileName?: string;
  iterations?: number;
}

export interface RestoreEncryptedBackupOptions {
  passphrase: string;
}

function getRandomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error('Secure random generation is unavailable for backup encryption.');
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

const ITERATIONS_LENGTH = 4;

export function isEncryptedBackup(data: Uint8Array): boolean {
  if (data.length < MAGIC_HEADER.length + ITERATIONS_LENGTH + SALT_LENGTH + IV_LENGTH + 16) {
    return false;
  }
  for (let i = 0; i < MAGIC_HEADER.length; i++) {
    if (data[i] !== MAGIC_HEADER[i]) return false;
  }
  return true;
}

export async function encryptBackupData(
  plainData: Uint8Array,
  passphrase: string,
  options: { iterations?: number } = {},
): Promise<Uint8Array> {
  if (!passphrase || !passphrase.trim()) {
    throw new Error('A non-empty passphrase is required for backup encryption.');
  }

  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const salt = getRandomBytes(SALT_LENGTH);
  const iv = getRandomBytes(IV_LENGTH);

  // Derive 256-bit AES key using PBKDF2 with SHA-256
  const keyBytes = pbkdf2(sha256, utf8ToBytes(passphrase), salt, {
    c: iterations,
    dkLen: 32,
  });

  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error('WebCrypto subtle is unavailable for AES-GCM encryption.');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    'AES-GCM',
    false,
    ['encrypt'],
  );

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    cryptoKey,
    plainData as BufferSource,
  );

  const ciphertext = new Uint8Array(encryptedBuffer);

  // Payload format: [MAGIC(6)][ITERATIONS(4)][SALT(16)][IV(12)][CIPHERTEXT+TAG]
  const headerSize = MAGIC_HEADER.length + ITERATIONS_LENGTH + SALT_LENGTH + IV_LENGTH;
  const result = new Uint8Array(headerSize + ciphertext.length);

  result.set(MAGIC_HEADER, 0);

  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  view.setUint32(MAGIC_HEADER.length, iterations, false); // big-endian

  result.set(salt, MAGIC_HEADER.length + ITERATIONS_LENGTH);
  result.set(iv, MAGIC_HEADER.length + ITERATIONS_LENGTH + SALT_LENGTH);
  result.set(ciphertext, headerSize);

  return result;
}

export async function decryptBackupData(
  encryptedData: Uint8Array,
  passphrase: string,
  options: { iterations?: number } = {},
): Promise<Uint8Array> {
  if (!passphrase || !passphrase.trim()) {
    throw new Error('A non-empty passphrase is required for backup decryption.');
  }

  if (!isEncryptedBackup(encryptedData)) {
    throw new Error('Invalid backup file format: missing LLENC1 encryption header.');
  }

  const view = new DataView(
    encryptedData.buffer,
    encryptedData.byteOffset,
    encryptedData.byteLength,
  );
  const storedIterations = view.getUint32(MAGIC_HEADER.length, false);
  const iterations = options.iterations ?? (storedIterations > 0 ? storedIterations : DEFAULT_ITERATIONS);

  const saltOffset = MAGIC_HEADER.length + ITERATIONS_LENGTH;
  const ivOffset = saltOffset + SALT_LENGTH;
  const ciphertextOffset = ivOffset + IV_LENGTH;

  const salt = encryptedData.slice(saltOffset, ivOffset);
  const iv = encryptedData.slice(ivOffset, ciphertextOffset);
  const ciphertext = encryptedData.slice(ciphertextOffset);

  const keyBytes = pbkdf2(sha256, utf8ToBytes(passphrase), salt, {
    c: iterations,
    dkLen: 32,
  });

  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error('WebCrypto subtle is unavailable for AES-GCM decryption.');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    'AES-GCM',
    false,
    ['decrypt'],
  );

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      cryptoKey,
      ciphertext as BufferSource,
    );
    return new Uint8Array(decryptedBuffer);
  } catch {
    throw new Error(
      'Backup decryption failed: Incorrect passphrase or corrupted database backup.',
    );
  }
}

export async function createEncryptedDatabaseBackup(
  database: BackupDatabase,
  storage: BackupStorage,
  options: EncryptedBackupOptions,
): Promise<string> {
  const fileName =
    options.fileName ??
    `local-lite-enc-${new Date().toISOString().replace(/[:.]/g, '-')}.enc.db`;

  if (!fileName || /[\\/]/.test(fileName)) {
    throw new Error('Backup file name must be a single file name.');
  }

  const plainBytes = await database.exportDatabase();
  if (plainBytes.length === 0) {
    throw new Error('Cannot create a backup from an empty database.');
  }

  const encryptedBytes = await encryptBackupData(plainBytes, options.passphrase, {
    iterations: options.iterations,
  });

  await storage.save(fileName, encryptedBytes);
  return fileName;
}

export async function restoreEncryptedDatabaseBackup(
  database: BackupDatabase,
  storage: BackupStorage,
  fileName: string,
  options: RestoreEncryptedBackupOptions,
): Promise<void> {
  if (!fileName || /[\\/]/.test(fileName)) {
    throw new Error('Backup file name must be a single file name.');
  }

  const rawBytes = await storage.read(fileName);
  if (rawBytes.length === 0) {
    throw new Error('Cannot restore an empty database backup.');
  }

  const decryptedBytes = await decryptBackupData(rawBytes, options.passphrase);
  await database.importDatabase(decryptedBytes);
}
