import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFileUpload } from '../hooks/useFileUpload';

const STATUS_ICON = { pending: '⏳', uploading: '⬆️', done: '✅', error: '❌' };

function FilePreview({ entry, onRemove }) {
  return (
    <motion.div
      className="fu-file-item"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      layout
    >
      {entry.preview
        ? <img src={entry.preview} alt={entry.file.name} className="fu-thumb" />
        : <span className="fu-file-icon">📄</span>
      }
      <div className="fu-file-info">
        <span className="fu-file-name" title={entry.file.name}>{entry.file.name}</span>
        <span className="fu-file-size">{(entry.file.size / 1024).toFixed(1)} KB</span>
        {entry.status === 'uploading' && (
          <div className="fu-progress-bar" role="progressbar" aria-valuenow={entry.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="fu-progress-fill" style={{ width: `${entry.progress}%` }} />
          </div>
        )}
        {entry.status === 'error' && <span className="fu-file-error">{entry.error}</span>}
      </div>
      <span className="fu-status-icon" aria-label={entry.status}>{STATUS_ICON[entry.status]}</span>
      <button
        type="button"
        className="fu-remove-btn"
        onClick={() => onRemove(entry.id)}
        aria-label={`Remove ${entry.file.name}`}
        disabled={entry.status === 'uploading'}
      >
        ✕
      </button>
    </motion.div>
  );
}

export function FileUpload({ onUpload, label = 'Upload Files' }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const { files, errors, addFiles, removeFile, uploadAll, clearAll } = useFileUpload(onUpload);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const hasFiles = files.length > 0;

  return (
    <div className="fu-container">
      <div
        className={`fu-dropzone${dragging ? ' fu-dropzone--active' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop files here or click to browse"
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <span className="fu-dropzone-icon">📁</span>
        <p className="fu-dropzone-text">Drag &amp; drop files here, or <u>browse</u></p>
        <p className="fu-dropzone-hint">Images, PDF, CSV, TXT · max 10MB · up to 10 files</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.csv"
          style={{ display: 'none' }}
          onChange={(e) => addFiles(e.target.files)}
          aria-hidden="true"
        />
      </div>

      <AnimatePresence>
        {errors.map((err, i) => (
          <motion.p key={i} className="fu-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {err}
          </motion.p>
        ))}
      </AnimatePresence>

      {hasFiles && (
        <div className="fu-file-list">
          <AnimatePresence>
            {files.map((entry) => (
              <FilePreview key={entry.id} entry={entry} onRemove={removeFile} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {hasFiles && (
        <div className="fu-actions">
          {onUpload && pendingCount > 0 && (
            <button type="button" onClick={uploadAll}>
              {label} ({pendingCount})
            </button>
          )}
          <button type="button" className="btn-clear" onClick={clearAll} style={{ background: 'var(--muted)' }}>
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}
