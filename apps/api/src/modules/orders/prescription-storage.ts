import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { OrderError } from './order-input.js';

export const maxPrescriptionBytes = 5 * 1024 * 1024; // 5 MiB

export const allowedPrescriptionMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedPrescriptionMimeType = (typeof allowedPrescriptionMimeTypes)[number];

export interface PrescriptionFileInput {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export interface ValidatedPrescriptionFile {
  fileName: string;
  mimeType: AllowedPrescriptionMimeType;
  fileSizeBytes: number;
  fileSha256: string;
  data: Buffer;
  extension: 'pdf' | 'jpg' | 'png' | 'webp';
}

export interface PrescriptionStorage {
  save(storageKey: string, data: Buffer): Promise<void>;
  read(storageKey: string): Promise<Buffer | null>;
  remove(storageKey: string): Promise<void>;
}

const MIME_TO_EXTENSION: Record<AllowedPrescriptionMimeType, 'pdf' | 'jpg' | 'png' | 'webp'> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const STORAGE_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,199}$/;

export function detectPrescriptionMimeType(data: Buffer): AllowedPrescriptionMimeType | null {
  if (data.length >= 5
    && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46 && data[4] === 0x2d) {
    return 'application/pdf';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 8
    && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
    && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    return 'image/png';
  }
  if (data.length >= 12
    && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    return 'image/webp';
  }
  return null;
}

export function sanitizePrescriptionFileName(rawName: string, extension: 'pdf' | 'jpg' | 'png' | 'webp'): string {
  const baseName = rawName.split(/[\\/]/).pop() ?? '';
  const cleaned = [...baseName]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && char !== '"' && char !== '\r' && char !== '\n';
    })
    .join('')
    .trim()
    .slice(0, 180);
  return cleaned || `receta.${extension}`;
}

export function validatePrescriptionFile(input: PrescriptionFileInput): ValidatedPrescriptionFile {
  if (!Buffer.isBuffer(input.data) || input.data.length === 0) {
    throw new OrderError('invalid_input', 'Prescription file cannot be empty');
  }
  if (input.data.length > maxPrescriptionBytes) {
    throw new OrderError('invalid_input', 'Prescription file exceeds the 5 MB size limit');
  }
  const normalizedMime = input.mimeType.trim().toLowerCase();
  const allowedMime = allowedPrescriptionMimeTypes.find((candidate) => candidate === normalizedMime);
  if (!allowedMime) {
    throw new OrderError('invalid_input', 'Prescription file must be a PDF, JPEG, PNG or WEBP image');
  }
  const detectedMime = detectPrescriptionMimeType(input.data);
  if (!detectedMime || detectedMime !== allowedMime) {
    throw new OrderError('invalid_input', 'Prescription file content does not match the declared file type');
  }
  const extension = MIME_TO_EXTENSION[allowedMime];
  const fileName = sanitizePrescriptionFileName(input.fileName, extension);
  const fileSha256 = createHash('sha256').update(input.data).digest('hex');

  return {
    fileName,
    mimeType: allowedMime,
    fileSizeBytes: input.data.length,
    fileSha256,
    data: input.data,
    extension,
  };
}

export function createPrescriptionStorageKey(extension: 'pdf' | 'jpg' | 'png' | 'webp'): string {
  return `${randomUUID()}.${extension}`;
}

export function assertValidStorageKey(storageKey: string): void {
  if (!STORAGE_KEY_PATTERN.test(storageKey) || storageKey.includes('..')) {
    throw new OrderError('invalid_input', 'Invalid prescription storage key');
  }
}

export function createLocalPrescriptionStorage(baseDir: string): PrescriptionStorage {
  const rootDir = resolve(baseDir);

  function resolveKeyPath(storageKey: string): string {
    assertValidStorageKey(storageKey);
    const fullPath = resolve(rootDir, storageKey);
    if (!fullPath.startsWith(`${rootDir}${sep}`)) {
      throw new OrderError('invalid_input', 'Storage key resolves outside storage root');
    }
    return fullPath;
  }

  return {
    async save(storageKey, data) {
      const targetPath = resolveKeyPath(storageKey);
      await mkdir(rootDir, { recursive: true, mode: 0o700 });
      const tempPath = resolveKeyPath(`${storageKey}.${randomUUID()}.tmp`);
      try {
        await writeFile(tempPath, data, { flag: 'wx', mode: 0o600 });
        await rename(tempPath, targetPath);
      } catch (error) {
        await unlink(tempPath).catch(() => undefined);
        throw error;
      }
    },
    async read(storageKey) {
      const targetPath = resolveKeyPath(storageKey);
      try {
        return await readFile(targetPath);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async remove(storageKey) {
      const targetPath = resolveKeyPath(storageKey);
      try {
        await unlink(targetPath);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return;
        }
        throw error;
      }
    },
  };
}

export function createMemoryPrescriptionStorage(): PrescriptionStorage {
  const files = new Map<string, Buffer>();
  return {
    async save(storageKey, data) {
      assertValidStorageKey(storageKey);
      files.set(storageKey, Buffer.from(data));
    },
    async read(storageKey) {
      assertValidStorageKey(storageKey);
      const data = files.get(storageKey);
      return data ? Buffer.from(data) : null;
    },
    async remove(storageKey) {
      assertValidStorageKey(storageKey);
      files.delete(storageKey);
    },
  };
}
