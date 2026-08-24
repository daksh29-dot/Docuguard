import React, { useEffect, useRef, useState } from 'react';

/* ── ML anomaly score — hardcoded for UI demo ── */
function computeAnomalyScore(submission) {
  if (!submission?.extraction) return null;
  return 96.4; // demo override
}

/* ── Animated confidence counter ── */
function AnimatedNumber({ value, suffix = '', decimals = 0, duration = 1100 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const target = parseFloat(value);
    const start  = performance.now();
    const raf = (now) => {
      const t     = Math.min((now - start) / duration, 1);
      const ease  = 1 - Math.pow(1 - t, 3);
      const cur   = (target * ease).toFixed(decimals);
      ref.current.textContent = cur + suffix;
      if (t < 1) requestAnimationFrame(raf);
      else ref.current.textContent = value + suffix;
    };
    requestAnimationFrame(raf);
  }, [value, duration, suffix, decimals]);
  return <span ref={ref}>0{suffix}</span>;
}

/* ── Animated bar ── */
function AnimatedBar({ pct, color = '#00FF41', delay = 0 }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), delay + 50);
    return () => clearTimeout(t);
  }, [pct, delay]);

  return (
    <div className="neon-bar" style={{ flex: 1 }}>
      <div style={{
        height: '100%', borderRadius: '2px',
        background: `linear-gradient(90deg, #006618, ${color})`,
        boxShadow: `0 0 8px ${color}88`,
        width: `${width}%`,
        transition: `width 1s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
      }} />
    </div>
  );
}

/* ── Animated SVG check mark ── */
function CheckMark({ pass, delay = 0 }) {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0, overflow: 'visible' }}>
      {pass ? (
        <path
          d="M2.5 7.5L6 11L12.5 4"
          stroke="#00FF41"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 16,
            strokeDashoffset: 16,
            animation: `checkDraw 0.45s cubic-bezier(0.16,1,0.3,1) ${delay}ms both`,
          }}
        />
      ) : (
        <>
          <line x1="3.5" y1="3.5" x2="11.5" y2="11.5" stroke="#00881A" strokeWidth="1.6" strokeLinecap="round"
            style={{ strokeDasharray: 12, strokeDashoffset: 12, animation: `checkDraw 0.3s ease ${delay}ms both` }}
          />
          <line x1="11.5" y1="3.5" x2="3.5"  y2="11.5" stroke="#006618" strokeWidth="1.6" strokeLinecap="round"
            style={{ strokeDasharray: 12, strokeDashoffset: 12, animation: `checkDraw 0.3s ease ${delay + 80}ms both` }}
          />
        </>
      )}
    </svg>
  );
}

/* ── ML Anomaly score block ── */
function AnomalyBar({ score }) {
  const color  = score < 20 ? '#00FF41' : score < 60 ? '#00CC33' : '#00881A';
  const label  = score < 20 ? 'Clean'   : score < 60 ? 'Flagged' : 'High risk';
  const cls    = score < 20 ? 'anomaly-clean' : score < 60 ? 'anomaly-flagged' : 'anomaly-highrisk';

  return (
    <div className="metric-box" style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) 0.5s both' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <p className="section-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ color: '#006618', fontSize: '0.6rem' }}>⬡</span>
          ML Anomaly Score
        </p>
        <span className={cls} style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <AnimatedBar pct={score} color={color} delay={300} />
        <span style={{
          fontSize: '0.95rem', fontWeight: 700, fontFamily: 'Courier New, monospace',
          color, minWidth: '36px', textAlign: 'right',
          animation: 'numberShimmer 0.5s ease 0.4s both',
        }}>
          <AnimatedNumber value={score} decimals={1} duration={1100} />
        </span>
      </div>
    </div>
  );
}

/* ── Empty state ── */
function EmptyState() {
  return (
    <div className="monster-card" style={{
      padding: '52px 24px', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px',
      minHeight: '320px', justifyContent: 'center',
      animation: 'scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
    }}>
      {/* Rippling radar icon */}
      <div style={{ position: 'relative', width: '60px', height: '60px' }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: '1px solid #00FF4120',
          animation: 'pulseRing 2.5s ease-out infinite',
        }} />
        <div style={{
          position: 'absolute', inset: '6px', borderRadius: '50%',
          border: '1px solid #00FF4110',
          animation: 'pulseRing 2.5s ease-out 0.5s infinite',
        }} />
        <div style={{
          width: '100%', height: '100%', borderRadius: '50%',
          background: '#090909', border: '1px solid #141414',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#00881A', fontSize: '1.2rem' }}>◎</span>
        </div>
      </div>

      <div>
        <p style={{ color: '#8aaa85', fontWeight: 600, fontSize: '0.875rem', marginBottom: '6px' }}>
          Awaiting your first submission
        </p>
        <p style={{ color: '#3d5239', fontSize: '0.75rem', lineHeight: 1.6 }}>
          Upload an invoice or photo to trigger<br />AI extraction and on-chain verification.
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════ */
export default function SubmissionHistory({ latestSubmission }) {
  if (!latestSubmission) return <EmptyState />;

  const { verdict, chain, extraction } = latestSubmission;
  const isApproved   = verdict.pass;
  const anomalyScore = computeAnomalyScore(latestSubmission);
  const confidence   = (verdict.confidence * 100).toFixed(1);
  const anomalyList  = extraction?.fields?.anomalies ?? [];

  const txColor = chain.status === 'confirmed' ? '#00FF41' :
                  chain.status === 'failed'    ? '#006618' : '#00CC33';

  return (
    <div className="monster-card" style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', flex: 1, animation: 'scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <p className="section-label" style={{ marginBottom: '5px' }}>AI oracle output</p>
          <h2 style={{
            fontFamily: 'Rajdhani, sans-serif', fontWeight: 700,
            fontSize: '1.05rem', letterSpacing: '0.05em', color: '#d4f0cf',
          }}>
            Latest Verdict
          </h2>
        </div>

        <div className={isApproved ? 'badge-approved' : 'badge-rejected'} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '5px 13px', borderRadius: '6px',
          fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em',
          animation: 'scaleIn 0.45s cubic-bezier(0.34,1.56,0.64,1) 0.15s both',
        }}>
          <CheckMark pass={isApproved} delay={300} />
          {isApproved ? 'Approved' : 'Rejected'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        {/* ── Deterministic Checks ── */}
        <div>
          <p className="section-label" style={{ marginBottom: '8px' }}>
            Verification checks
          </p>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {verdict.checks.map((check, i) => (
              <li
                key={i}
                className="check-row"
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <span style={{ color: '#8aaa85', fontSize: '0.825rem', textTransform: 'capitalize' }}>
                  {check.id.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <CheckMark pass={check.pass} delay={i * 80 + 150} />
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.05em',
                    color: check.pass ? '#00FF41' : '#006618',
                    textShadow: check.pass ? '0 0 8px #00FF4177' : 'none',
                  }}>
                    {check.pass ? 'Pass' : 'Fail'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* ── Anomaly notices ── */}
        {anomalyList.length > 0 && (
          <div style={{
            padding: '12px 14px', borderRadius: '8px',
            background: '#05100a', border: '1px solid #006618',
            animation: 'fadeUp 0.4s ease 0.2s both',
          }}>
            <p className="section-label" style={{ color: '#00881A', marginBottom: '8px' }}>
              Anomalies detected
            </p>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {anomalyList.map((a, i) => (
                <li key={i} style={{
                  color: '#4a6645', fontSize: '0.75rem', lineHeight: 1.5,
                  animation: `slideRight 0.35s ease ${i * 0.07 + 0.2}s both`,
                }}>
                  · {a}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Metrics: Confidence + TX Status ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>

          {/* AI Confidence */}
          <div className="metric-box" style={{ animation: 'fadeUp 0.5s ease 0.25s both' }}>
            <p className="section-label" style={{ marginBottom: '10px' }}>AI confidence</p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', marginBottom: '10px' }}>
              <span style={{
                fontSize: '2rem', fontWeight: 700, lineHeight: 1,
                color: '#00FF41', textShadow: '0 0 14px #00FF41',
                fontFamily: 'Rajdhani, sans-serif',
              }}>
                <AnimatedNumber value={confidence} decimals={1} suffix="" duration={1000} />
              </span>
              <span style={{ color: '#00CC33', fontSize: '0.9rem', marginBottom: '3px', fontWeight: 500 }}>%</span>
            </div>
            <AnimatedBar pct={parseFloat(confidence)} delay={200} />
          </div>

          {/* Relayer TX Status */}
          <div className="metric-box" style={{ animation: 'fadeUp 0.5s ease 0.32s both' }}>
            <p className="section-label" style={{ marginBottom: '10px' }}>Relayer status</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <div style={{
                width: '9px', height: '9px', borderRadius: '50%', flexShrink: 0,
                background: txColor,
                boxShadow: chain.status === 'confirmed' ? `0 0 10px ${txColor}` : 'none',
                animation: chain.status === 'pending' ? 'liveDot 2s ease-in-out infinite' : 'none',
                transition: 'background 0.3s',
              }} />
              <span style={{
                fontSize: '0.8rem', fontWeight: 600,
                letterSpacing: '0.04em', textTransform: 'capitalize', color: txColor,
              }}>
                {chain.status}
              </span>
            </div>
            {chain.error && (
              <p title={chain.error} style={{
                color: '#3d5239', fontSize: '0.65rem',
                marginTop: '7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                lineHeight: 1.4,
              }}>
                {chain.error}
              </p>
            )}
          </div>
        </div>

        {/* ── ML Anomaly Score ── */}
        {anomalyScore !== null && <AnomalyBar score={anomalyScore} />}

        {/* ── TX link ── */}
        {chain.txHash && (
          <div style={{
            paddingTop: '14px', borderTop: '1px solid #111',
            animation: 'fadeIn 0.5s ease 0.5s both',
          }}>
            <a
              href={`https://sepolia.basescan.org/tx/${chain.txHash}`}
              target="_blank"
              rel="noreferrer"
              style={{
                color: '#00CC33', fontSize: '0.75rem',
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                textDecoration: 'none', fontWeight: 500,
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#00FF41'}
              onMouseLeave={e => e.currentTarget.style.color = '#00CC33'}
            >
              ↗ View on Basescan
            </a>
            <p className="hex-addr" style={{
              marginTop: '5px', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {chain.txHash}
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes checkDraw {
          from { stroke-dashoffset: 16; opacity: 0; }
          to   { stroke-dashoffset: 0;  opacity: 1; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.94); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes numberShimmer {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseRing {
          0%  { transform: scale(1);   opacity: 0.7; }
          70% { transform: scale(1.7); opacity: 0;   }
          100%{ transform: scale(1.7); opacity: 0;   }
        }
        @keyframes liveDot {
          0%,100% { box-shadow: 0 0 4px #00FF41; }
          50%      { box-shadow: 0 0 12px #00FF41; }
        }
      `}</style>
    </div>
  );
}