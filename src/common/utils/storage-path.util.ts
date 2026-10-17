//* REVERSES StorageService.saveFile()'S OUTPUT SHAPE. A SAVED FILE'S `path` LOOKS
//* LIKE "/uploads/blogs/images/abc.webp" — deleteFile() NEEDS THAT SAME
//* PATH SPLIT BACK INTO {filename, folder}. WORKS FOR ANY FOLDER DEPTH, SO IT
//* DOESN'T NEED TO HARDCODE FOLDER NAMES THE WAY STRING-MATCHING ON THE URL WOULD.
export function parseStoragePath(path: string): {
  filename: string;
  folder?: string;
} {
  const segments = path
    .replace(/^\/?uploads\//, '')
    .split('/')
    .filter(Boolean);
  const filename = segments.pop() ?? path;
  return { filename, folder: segments.length ? segments.join('/') : undefined };
}
