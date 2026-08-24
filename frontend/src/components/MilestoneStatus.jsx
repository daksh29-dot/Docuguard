import React, { useEffect, useRef } from 'react';

const STATE_CONFIG = {
  PAID:         { label: 'Paid',         cls: 'badge-approved' },
  APPROVED:     { label: 'Approved',     cls: 'badge-approved' },
  REJECTED:     { label: 'Rejected',     cls: 'badge-rejected' },
  PENDING:      { label: 'Pending',      cls: 'badge-pending'  },
  UNDER_REVIEW: { label: 'Under Review', cls: 'badge-pending'  },
  UNKNOWN:      { label: 'Unknown',      cls: 'badge-unknown'  },
};

/* Animated counter for numeric values */
function CountUp({ to, duration = 900, suffix = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const start = performance.now();
    const raf = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out-cubic
      ref.current.textContent = (to * ease).toFixed(typeof to === 'float' ? 2 : 0) + suffix;
      if (t < 1) requestAnimationFrame(raf);
      else ref.current.textContent = to + suffix;
    };
    requestAnimationFrame(raf);
  }, [to, duration, suffix]);
  return <span ref={ref}>0{suffix}</span>;
}

export default function MilestoneStatus({ data }) {
  const { milestone, onChain } = data;
  const stateBadge = onChain?.state || 'UNKNOWN';
  const cfg = STATE_CONFIG[stateBadge] || STATE_CONFIG.UNKNOWN;

  const items = [
    {
      label: 'Expected Item',
      value: milestone.expectedItem,
      icon: '◈',
    },
    {
      label: 'Required Quantity',
      value: `${milestone.expectedQty} ${milestone.unit}`,
      icon: '▣',
      isNum: true,
      num: milestone.expectedQty,
      numSuffix: ` ${milestone.unit}`,
    },
    {
      label: 'Unit Price',
      value: `$${milestone.unitPriceUSD.toFixed(2)} USD`,
      icon: '◆',
    },
    {
      label: 'Document Type',
      value: milestone.requiredDocType.replace(/_/g, ' '),
      icon: '◉',
    },
  ];

  return (
    <div className="monster-card" style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '22px' }}>
        <div>
          <p className="section-label" style={{ marginBottom: '5px' }}>On-chain milestone</p>
          <h2 style={{
            fontFamily: 'Rajdhani, sans-serif', fontWeight: 700,
            fontSize: '1.05rem', letterSpacing: '0.06em',
            color: '#d4f0cf',
          }}>
            Requirements
          </h2>
        </div>
        <span className={cfg.cls} style={{
          padding: '4px 13px', borderRadius: '6px',
          fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.06em',
          animation: 'scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.2s both',
        }}>
          {cfg.label}
        </span>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {items.map(({ label, value, icon, isNum, num, numSuffix }, i) => (
          <div
            key={label}
            className="metric-box"
            style={{ animationDelay: `${i * 0.07}s` }}
          >
            <p className="section-label" style={{ marginBottom: '7px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ color: '#00881A', fontSize: '0.6rem' }}>{icon}</span>
              {label}
            </p>
            <p style={{ color: '#c8e8c3', fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.3 }}>
              {isNum
                ? <CountUp to={num} suffix={numSuffix} />
                : value
              }
            </p>
          </div>
        ))}
      </div>

      {/* Tranche */}
      {onChain?.tranche && (
        <div style={{
          marginTop: '14px', paddingTop: '14px',
          borderTop: '1px solid #111',
          display: 'flex', alignItems: 'center', gap: '8px',
          animation: 'fadeIn 0.5s ease 0.4s both',
        }}>
          <span className="section-label">Escrow tranche</span>
          <span className="hex-addr" style={{ color: '#00881A' }}>{onChain.tranche} USDG</span>
        </div>
      )}
    </div>
  );
}