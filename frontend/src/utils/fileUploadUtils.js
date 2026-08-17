/**
 * Recursive traversal for HTML5 FileSystemEntry (Drag and Drop files & folders)
 * Handles both files and arbitrarily nested folders.
 * Browsers batch directory entries in chunks of 100, so readEntries must be called in a loop until empty.
 */
export async function traverseFileSystemEntry(entry, path = '') {
  if (!entry) return [];

  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file) => {
          // Attach relative path property for folder reconstruction
          file.relativePath = path ? `${path}/${file.name}` : file.name;
          resolve([file]);
        },
        (err) => {
          console.warn('Failed to read file from entry:', entry.name, err);
          resolve([]);
        }
      );
    });
  }

  if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const currentPath = path ? `${path}/${entry.name}` : entry.name;
    const allFiles = [];

    const readBatch = () => {
      return new Promise((resolve) => {
        dirReader.readEntries(
          async (entries) => {
            if (!entries || entries.length === 0) {
              resolve([]);
            } else {
              const nestedFiles = [];
              for (const childEntry of entries) {
                const childFiles = await traverseFileSystemEntry(childEntry, currentPath);
                nestedFiles.push(...childFiles);
              }
              // Directory might have more entries, continue reading
              const nextBatch = await readBatch();
              resolve([...nestedFiles, ...nextBatch]);
            }
          },
          (err) => {
            console.warn('Failed to read directory entries:', entry.name, err);
            resolve([]);
          }
        );
      });
    };

    return readBatch();
  }

  return [];
}

/**
 * Extracts all files (including nested files within dropped folders) from a drag-and-drop event
 */
export async function extractFilesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];

  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (typeof item.webkitGetAsEntry === 'function') {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    }

    if (entries.length > 0) {
      const allFiles = [];
      for (const entry of entries) {
        const files = await traverseFileSystemEntry(entry);
        allFiles.push(...files);
      }
      if (allFiles.length > 0) {
        return allFiles;
      }
    }
  }

  if (dataTransfer.files && dataTransfer.files.length > 0) {
    return Array.from(dataTransfer.files);
  }

  return [];
}
