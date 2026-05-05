import { useState, useRef } from 'react';

export default function FileUpload({ label, accept = '.pdf,.docx,.txt,.png,.jpg,.jpeg,.tiff,.tif,.webp,.bmp', onFile }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const handleFile = (f) => {
    setFile(f);
    onFile?.(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <div
      className={`upload-zone ${dragOver ? 'dragover' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files[0])}
      />
      {file ? (
        <>
          <div className="icon">✅</div>
          <p><strong>{file.name}</strong></p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {(file.size / 1024).toFixed(1)} KB • Click to change
          </p>
        </>
      ) : (
        <>
          <div className="icon">📁</div>
          <p><strong>{label || 'Drop file here or click to browse'}</strong></p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            PDF, DOCX, TXT, PNG, JPG, TIFF, BMP
          </p>
        </>
      )}
    </div>
  );
}
