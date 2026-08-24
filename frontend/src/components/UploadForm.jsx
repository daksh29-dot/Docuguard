import React, { useState, useRef, useCallback } from 'react';

const BACKEND_URL = 'http://localhost:4000';

/* ── Ripple effect hook ── */
function useRipple() {
  const [ripples, setRipples] = useState([]);
  const trigger = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();
    setRipples(r => [...r, { id, x, y }]);
    setTimeout(() => setRipples(r => r.filter(rp => rp.id !== id)), 700);
  }, []);
  return [ripples, trigger];
}

export default function UploadForm({ milestoneId, onUploadComplete }) {
  const [file,      setFile]      = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState(null);
  const [dragOver,  setDragOver]  = useState(false);
  const [success,   setSuccess]   = useState(false);
  const inputRef = useRef(null);
  const [ripples, triggerRipple] = useRipple();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    triggerRipple(e);
    setUploading(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData();
    formData.append('document', file); // Must match the multer field name in server.js

    try {
      const res = await fetch(`${BACKEND_URL}/api/milestones/${milestoneId}/submissions`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Upload failed');
      }
      setSuccess(true);
      setFile(null);
      e.target.reset();
      setTimeout(() => {
        setSuccess(false);
        onUploadComplete(); // Refresh dashboard state
      }, 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const ext = file?.name.split('.').pop().toUpperCase() ?? '';

  /* Processing steps displayed while uploading */
  const steps = ['Extracting fields via Gemini', 'Running rules engine', 'Signing verdict', 'Submitting on-chain'];
  const [stepIdx, setStepIdx] = useState(0);
  const stepRef = useRef(null);

  React.useEffect(() => {
    if (!uploading) { setStepIdx(0); return; }
    stepRef.current = setInterval(() => {
      setStepIdx(i => (i + 1) % steps.length);
    }, 1800);
    return () => clearInterval(stepRef.current);
  }, [uploading]);

  return (
    <div className="monster-card" style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <p className="section-label" style={{ marginBottom: '5px' }}>Vendor portal</p>
        <h2 style={{
          fontFamily: 'Rajdhani, sans-serif', fontWeight: 700,
          fontSize: '1.05rem', letterSpacing: '0.05em', color: '#d4f0cf',
        }}>
          Submit a Document
        </h2>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'start' }}>
        {/* ── Drop zone ── */}
        <div
          className={`drop-zone${dragOver ? ' active' : ''}`}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            marginBottom: '14px',
            transition: 'all 0.25s ease',
            cursor: uploading ? 'default' : 'pointer',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.pdf"
            onChange={(e) => setFile(e.target.files[0])}
            style={{ display: 'none' }}
            disabled={uploading}
          />

          {file ? (
            /* File selected state */
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px',
              animation: 'scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
            }}>
              {/* File badge */}
              <div style={{
                width: '36px', height: '42px', flexShrink: 0,
                background: '#0a130a', border: '1px solid #00CC3330',
                borderRadius: '6px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '2px',
              }}>
                <span style={{ color: '#00CC33', fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.05em' }}>{ext}</span>
                <div style={{ width: '18px', height: '1px', background: '#00CC3330' }} />
                <div style={{ width: '12px', height: '1px', background: '#00CC3320' }} />
                <div style={{ width: '14px', height: '1px', background: '#00CC3218' }} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{
                  color: '#00FF41', fontSize: '0.85rem', fontWeight: 600,
                  maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {file.name}
                </p>
                <p style={{ color: '#3d5239', fontSize: '0.7rem', marginTop: '3px' }}>
                  {(file.size / 1024).toFixed(1)} KB
                  <span style={{ margin: '0 6px', color: '#141414' }}>·</span>
                  <span style={{ color: '#00881A' }}>Ready to verify</span>
                </p>
              </div>
            </div>
          ) : (
            /* Empty drop zone */
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
              padding: '10px 0',
            }}>
              {/* Animated upload icon */}
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                border: '1px dashed #00CC3335', background: '#090d09',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                animation: 'breatheIcon 3s ease-in-out infinite',
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 13V5M10 5L7 8M10 5L13 8"
                    stroke="#00CC33" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ animation: 'arrowBob 2s ease-in-out infinite' }}
                  />
                  <path d="M4 16h12" stroke="#006618" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>

              <div>
                <p style={{ color: '#4a6645', fontSize: '0.82rem', lineHeight: 1 }}>
                  Drop file here or{' '}
                  <span style={{ color: '#00CC33', fontWeight: 500 }}>browse</span>
                </p>
              </div>
              <p style={{ color: '#2a3a2a', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                JPEG · PNG · PDF
              </p>
            </div>
          )}
        </div>

        {/* Right column: button + status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '180px' }}>
          {/* Error — shown above button in right col */}
          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '9px',
              padding: '11px 13px',
              background: '#050f05', border: '1px solid #006618', borderRadius: '7px',
              animation: 'fadeUp 0.3s ease both',
            }}>
              <span style={{ color: '#00881A', fontSize: '0.7rem', marginTop: '1px', flexShrink: 0 }}>⚠</span>
              <p style={{ color: '#4a6645', fontSize: '0.75rem', lineHeight: 1.5 }}>{error}</p>
            </div>
          )}

        {/* ── Submit button ── */}
        <button
          type="submit"
          id="upload-verify-btn"
          disabled={!file || uploading}
          className="btn-monster"
          onClick={triggerRipple}
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          {/* Ripples */}
          {ripples.map(({ id, x, y }) => (
            <span
              key={id}
              style={{
                position: 'absolute',
                left: x, top: y,
                width: '60px', height: '60px',
                marginLeft: '-30px', marginTop: '-30px',
                borderRadius: '50%',
                background: '#00FF4125',
                animation: 'ripple 0.65s ease-out forwards',
                pointerEvents: 'none',
              }}
            />
          ))}

          {success ? (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7L5.5 10.5L12 3.5" stroke="#00FF41" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Submitted
            </>
          ) : uploading ? (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
                <circle cx="7" cy="7" r="5" stroke="#00FF41" strokeWidth="1.5" strokeDasharray="6 8" />
              </svg>
              Processing
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 10V3M7 3L4 6M7 3L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Upload &amp; Verify
            </>
          )}
        </button>

        {/* ── Processing step indicator ── */}
        {uploading && (
          <div style={{ marginTop: '14px', textAlign: 'center' }}>
            <p style={{
              color: '#3d5239', fontSize: '0.7rem', letterSpacing: '0.06em',
              fontWeight: 500, lineHeight: 1.4,
              animation: 'fadeStepIn 0.4s ease both',
            }}>
              {steps[stepIdx]}
              <span style={{ animation: 'blink 0.9s step-end infinite', color: '#00CC33', marginLeft: '2px' }}>...</span>
            </p>
            {/* Progress dots */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '8px' }}>
              {steps.map((_, i) => (
                <div key={i} style={{
                  width: '4px', height: '4px', borderRadius: '50%',
                  background: i <= stepIdx ? '#00CC33' : '#141414',
                  boxShadow: i === stepIdx ? '0 0 6px #00CC33' : 'none',
                  transition: 'background 0.3s, box-shadow 0.3s',
                }} />
              ))}
            </div>
          </div>
        )}
        </div>
        </div>
      </form>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes ripple {
          from { transform: scale(0); opacity: 0.5; }
          to   { transform: scale(5); opacity: 0; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes arrowBob {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-2px); }
        }
        @keyframes breatheIcon {
          0%, 100% { box-shadow: none; }
          50%       { box-shadow: 0 0 12px #00CC3318; }
        }
        @keyframes fadeStepIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}