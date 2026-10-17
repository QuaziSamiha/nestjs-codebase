// GOAL: DEFINE A COMMON CONTRACT FOR FILE STORAGE OPERATIONS (SAVE, DELETE, PATH).
// RELATION: IMPLEMENTED BY LOCALSTORAGESERVICE (AND POTENTIAL FUTURE CLOUD SERVICES).
// WORKFLOW: DICTATES REQUIRED METHODS FOR ANY STORAGE PROVIDER.
// CODE: INTERFACE DECLARING SAVE FILE, DELETE FILE, AND GET UPLOAD PATH METHODS.
import { IStorageFile } from './storage-file.interface';

export interface IStorageService {
  saveFile(file: Express.Multer.File, folder?: string): Promise<IStorageFile>;
  deleteFile(filename: string, folder?: string): Promise<void>;
  getUploadPath(folder?: string): string;
}
