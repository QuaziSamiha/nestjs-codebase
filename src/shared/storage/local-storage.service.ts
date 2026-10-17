// GOAL: PROVIDE ACTUAL IMPLEMENTATION FOR STORING FILES ON THE LOCAL DISK.
// RELATION: IMPLEMENTS ISTORAGESERVICE. INJECTED VIA STORAGEMODULE.
// WORKFLOW: TAKES MULTER FILE, GENERATES UNIQUE NAME, SAVES TO DISK, RETURNS PATH.
// CODE: USES FS-EXTRA AND FS/PROMISES TO WRITE AND UNLINK FILES ON THE FILESYSTEM.
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ensureDir } from 'fs-extra';
import { writeFile, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { IStorageService } from './interfaces/storage.interface';
import { IStorageFile } from './interfaces/storage-file.interface';
import 'multer';

@Injectable()
export class LocalStorageService implements IStorageService {
  private readonly logger = new Logger(LocalStorageService.name);

  constructor(private readonly configService: ConfigService) {}

  getUploadPath(folder?: string): string {
    const rootDir = this.configService.get<string>(
      'STORAGE_DESTINATION',
      'uploads',
    );
    const basePath = join(process.cwd(), rootDir);
    return folder ? join(basePath, folder) : basePath;
  }

  async saveFile(
    file: Express.Multer.File,
    folder?: string,
  ): Promise<IStorageFile> {
    try {
      const uploadPath = this.getUploadPath(folder);

      await ensureDir(uploadPath);

      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = extname(file.originalname);

      const sanitizedName = file.originalname
        .replace(/[^\w.-]/g, '_')
        .replace(ext, '');

      const filename = `${sanitizedName}-${uniqueSuffix}${ext}`;
      const absolutePath = join(uploadPath, filename);

      const relativePath = folder
        ? `/uploads/${folder}/${filename}`
        : `/uploads/${filename}`;

      await writeFile(absolutePath, file.buffer);

      return { filename, path: relativePath };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to save file: ${errorMessage}`);

      throw new InternalServerErrorException(
        'Error occurred while saving file to disk',
      );
    }
  }

  async deleteFile(filename: string, folder?: string): Promise<void> {
    try {
      const absolutePath = join(this.getUploadPath(folder), filename);
      await unlink(absolutePath);
    } catch (error: unknown) {
      // FIX: Type guarding for Node.js-specific error codes (like ENOENT)
      if (error && typeof error === 'object' && 'code' in error) {
        const nodeError = error as { code: string; message: string };

        if (nodeError.code !== 'ENOENT') {
          this.logger.error(`Delete failed: ${nodeError.message}`);
          throw new InternalServerErrorException('Could not delete file');
        }
      }
    }
  }
}
