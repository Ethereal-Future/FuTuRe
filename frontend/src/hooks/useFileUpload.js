import { useState, useCallback } from 'react';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 10;

function validateFile(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) return `"${file.name}": unsupported file type`;
  if (file.size > MAX_FILE_SIZE) return `"${file.name}": exceeds 10MB limit`;
  return null;
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(new File([blob], file.name, { type: 'image/jpeg' })), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export function useFileUpload(uploadFn) {
  const [files, setFiles] = useState([]); // { id, file, preview, status, progress, error }
  const [errors, setErrors] = useState([]);

  const addFiles = useCallback((incoming) => {
    const list = Array.from(incoming);
    const validationErrors = [];
    const valid = [];

    for (const file of list) {
      const err = validateFile(file);
      if (err) { validationErrors.push(err); continue; }
      if (files.length + valid.length >= MAX_FILES) {
        validationErrors.push(`Max ${MAX_FILES} files allowed`);
        break;
      }
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      valid.push({ id: `${Date.now()}-${Math.random()}`, file, preview, status: 'pending', progress: 0, error: null });
    }

    setErrors(validationErrors);
    if (valid.length) setFiles((prev) => [...prev, ...valid]);
  }, [files.length]);

  const removeFile = useCallback((id) => {
    setFiles((prev) => {
      const entry = prev.find((f) => f.id === id);
      if (entry?.preview) URL.revokeObjectURL(entry.preview);
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const uploadAll = useCallback(async () => {
    const pending = files.filter((f) => f.status === 'pending');
    if (!pending.length || !uploadFn) return;

    for (const entry of pending) {
      setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, status: 'uploading', progress: 0 } : f));
      try {
        const compressed = await compressImage(entry.file);
        await uploadFn(compressed, (progress) => {
          setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, progress } : f));
        });
        setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, status: 'done', progress: 100 } : f));
      } catch (err) {
        setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, status: 'error', error: err.message } : f));
      }
    }
  }, [files, uploadFn]);

  const clearAll = useCallback(() => {
    setFiles((prev) => { prev.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)); return []; });
    setErrors([]);
  }, []);

  return { files, errors, addFiles, removeFile, uploadAll, clearAll };
}
