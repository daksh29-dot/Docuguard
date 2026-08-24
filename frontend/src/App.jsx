import React, { useState, useEffect, useCallback, useRef } from 'react';
import UploadForm from './components/UploadForm';
import MilestoneStatus from './components/MilestoneStatus';
import SubmissionHistory from './components/SubmissionHistory';

const BACKEND_URL      = 'http://localhost:4000';
const DEMO_MILESTONE_ID = 2;
const CONTRACT_ADDRESS  = '0x74cAe24847354beB9fd122513210d9891AC4a257';
const BASESCAN_URL      = `https://sepolia.basescan.org/address/${CONTRACT_ADDRESS}`;

/* ── Floating particle canvas ── */
function ParticleField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const particles = Array.from({ length: 28 }, () => ({
      x:     Math.random() * window.innerWidth,
      y:     Math.random() * window.innerHeight,
      r:     Math.random() * 1.2 + 0.2,
      vy:    -(Math.random() * 0.35 + 0.1),
      vx:    (Math.random() - 0.5) * 0.15,
      alpha: Math.random() * 0.35 + 0.05,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,255,65,${p.alpha})`;
        ctx.shadowColor = '#00FF41';
        ctx.shadowBlur  = 6;
        ctx.fill();
        p.y += p.vy;
        p.x += p.vx;
        if (p.y < -5) {
          p.y = canvas.height + 5;
          p.x = Math.random() * canvas.width;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.6 }}
    />
  );
}

/* ── Typewriter text ── */
function Typewriter({ text, delay = 0 }) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted]     = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(iv);
    }, 38);
    return () => clearInterval(iv);
  }, [started, text]);

  return (
    <span>
      {displayed}
      {displayed.length < text.length && (
        <span style={{ animation: 'blink 0.8s step-end infinite', color: '#00FF41' }}>|</span>
      )}
    </span>
  );
}

export default function App() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMilestone = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/milestones/${DEMO_MILESTONE_ID}`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error('Failed to fetch milestone state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMilestone(); }, [fetchMilestone]);

  /* Loading screen */
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#050505',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: '24px'
      }}>
        <ParticleField />
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          <div className="brand-m" style={{ fontSize: '3rem' }}>DOCUGUARD</div>
          <p style={{
            color: '#00881A', fontSize: '0.7rem', letterSpacing: '0.3em',
            marginTop: '14px', textTransform: 'uppercase', fontWeight: 500
          }}>
            Connecting to network
          </p>
          {/* Animated loader bar */}
          <div style={{
            marginTop: '28px', width: '180px', height: '1px',
            background: '#111', borderRadius: '1px', overflow: 'hidden', margin: '28px auto 0'
          }}>
            <div style={{
              height: '100%', width: '45%',
              background: 'linear-gradient(90deg, transparent, #00FF41, transparent)',
              animation: 'loaderSlide 1.4s ease-in-out infinite'
            }} />
          </div>
        </div>
        <style>{`
          @keyframes loaderSlide {
            0%   { transform: translateX(-100%); }
            100% { transform: translateX(500%); }
          }
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  if (!data?.milestone) {
    return (
      <div style={{
        minHeight: '100vh', background: '#050505',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <div className="monster-card anim-scale-in" style={{ padding: '40px', maxWidth: '420px', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', color: '#006618', marginBottom: '12px' }}>⚠</div>
          <p style={{ color: '#00881A', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '1rem', letterSpacing: '0.08em' }}>
            Backend not reachable
          </p>
          <p style={{ color: '#3d5239', fontSize: '0.8rem', marginTop: '8px', lineHeight: 1.6 }}>
            Make sure the Node server is running on port 4000.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#8aaa85', fontFamily: 'Inter, sans-serif', position: 'relative' }}>
      {/* Background layers */}
      <ParticleField />
      <div className="scanlines" aria-hidden="true" />

      {/* Top neon bar */}
      <div style={{
        height: '1.5px',
        background: 'linear-gradient(90deg, #000 0%, #00CC33 35%, #00FF41 50%, #00CC33 65%, #000 100%)',
        boxShadow: '0 0 16px #00FF4166',
        animation: 'fadeIn 0.5s ease both',
      }} />

      {/* ── HEADER ── */}
      <header style={{ maxWidth: '1080px', margin: '0 auto', padding: '36px 24px 24px', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>

          {/* Brand block */}
          <div className="anim-fade-up" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '46px', height: '46px', borderRadius: '10px',
              background: '#000', border: '1px solid #00FF4150',
              boxShadow: '0 0 20px #00FF4133, inset 0 0 14px #00FF4110',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              transition: 'box-shadow 0.3s',
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 32px #00FF4166, inset 0 0 20px #00FF4118'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 20px #00FF4133, inset 0 0 14px #00FF4110'}
            >
              <span style={{
                fontFamily: 'Rajdhani, Impact, sans-serif', fontWeight: 900,
                fontSize: '1.5rem', color: '#00FF41',
                textShadow: '0 0 10px #00FF41',
              }}>M</span>
            </div>

            <div>
              <h1 style={{
                fontFamily: 'Rajdhani, sans-serif', fontWeight: 700,
                fontSize: '1.6rem', letterSpacing: '0.05em', lineHeight: 1,
                color: '#00FF41', textShadow: '0 0 12px #00FF41, 0 0 32px #00FF4444',
              }}>
                <Typewriter text="DOCUGUARD" delay={100} />
              </h1>
              <p style={{
                color: '#3d5239', fontSize: '0.65rem', letterSpacing: '0.16em',
                textTransform: 'uppercase', marginTop: '5px', fontWeight: 500,
                animation: 'fadeIn 1s ease 0.8s both',
              }}>
                AI‑Audited Public Procurement · Base Sepolia
              </p>
            </div>
          </div>

          {/* Right controls */}
          <div className="anim-fade-up-d1" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Live indicator */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '9px',
              padding: '7px 14px', background: '#090909',
              border: '1px solid #141414', borderRadius: '999px',
            }}>
              <div className="live-dot" />
              <span style={{ color: '#00CC33', fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                Live
              </span>
            </div>

            <a
              href={BASESCAN_URL}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '7px 16px', fontSize: '0.72rem', letterSpacing: '0.06em',
                color: '#00CC33', border: '1px solid #00CC3355', borderRadius: '999px',
                textDecoration: 'none', fontWeight: 600,
                background: '#00CC3310',
                boxShadow: '0 0 10px #00CC3322',
                transition: 'color 0.2s, border-color 0.2s, box-shadow 0.2s, background 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = '#00FF41';
                e.currentTarget.style.borderColor = '#00FF4166';
                e.currentTarget.style.boxShadow = '0 0 18px #00FF4133';
                e.currentTarget.style.background = '#00FF4118';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = '#00CC33';
                e.currentTarget.style.borderColor = '#00CC3355';
                e.currentTarget.style.boxShadow = '0 0 10px #00CC3322';
                e.currentTarget.style.background = '#00CC3310';
              }}
            >
              View Contract ↗
            </a>
          </div>
        </div>

        {/* Sub-row */}
        <div className="anim-fade-up-d2" style={{
          marginTop: '20px', display: 'flex', gap: '14px', alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          {[
            ['Contract', 'TENDER-2026-0143'],
            ['Milestone', `#${DEMO_MILESTONE_ID}`],
            ['Network', 'Base Sepolia'],
          ].map(([label, val]) => (
            <React.Fragment key={label}>
              <span style={{ color: '#2a3e28', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}:</span>
              <span className="hex-addr" style={{ color: '#00881A' }}>{val}</span>
              <span style={{ color: '#111', userSelect: 'none' }}>·</span>
            </React.Fragment>
          ))}
        </div>
      </header>

      {/* Divider */}
      <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '0 24px', position: 'relative', zIndex: 1 }}>
        <div className="neon-divider" />
      </div>

      {/* ── MAIN GRID ── */}
      <main style={{
        maxWidth: '1080px', margin: '0 auto',
        padding: '28px 24px', position: 'relative', zIndex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: 'auto auto',
        gap: '18px',
      }}>
        {/* Row 1 — Left: Milestone status */}
        <div className="anim-fade-up-d2" style={{ gridColumn: '1', gridRow: '1', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <MilestoneStatus data={data} />
        </div>

        {/* Row 1 — Right: Latest verdict */}
        <div className="anim-fade-up-d3" style={{ gridColumn: '2', gridRow: '1', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <SubmissionHistory milestoneId={DEMO_MILESTONE_ID} latestSubmission={data.latestSubmission} />
        </div>

        {/* Row 2 — Full width: Upload form */}
        <div className="anim-fade-up-d4" style={{ gridColumn: '1 / -1', gridRow: '2' }}>
          <UploadForm milestoneId={DEMO_MILESTONE_ID} onUploadComplete={fetchMilestone} />
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        maxWidth: '1080px', margin: '0 auto', padding: '14px 24px',
        borderTop: '1px solid #0c0c0c', position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#2a3e28', fontSize: '0.62rem', letterSpacing: '0.07em' }}>
            DocuGuard © 2026 — Powered by Gemini AI & Base L2
          </span>
          <span style={{ color: '#006618', fontSize: '0.62rem', fontFamily: 'Courier New, monospace' }}>v1.0.0</span>
        </div>
      </footer>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}