import React, { useState, useRef } from 'react';
import '../index.css';
export const OraclePanel: React.FC = () => {
  const [status, setStatus] = useState<'dormant' | 'communing' | 'speaking'>('dormant');
  const [ticker, setTicker] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const consultOracle = async () => {
    if (!ticker) return;
    setStatus('communing');

    try {
      const response = await fetch('/api/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });

      const audioBlob = await response.blob();
      const url = URL.createObjectURL(audioBlob);

      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.onplay = () => setStatus('speaking');
        audioRef.current.onended = () => setStatus('dormant');
        audioRef.current.play();
      }
    } catch (err) {
      console.error("The earth is silent:", err);
      setStatus('dormant');
    }
  };

  return (
    <div className="oracle-frame">
      {/* THE SPORE VISUAL */}
      <div className={`spore-core ${status}`}>
        <div className="spore-glow"></div>
      </div>

      <div className="oracle-interface">
        <input 
          className="brutalist-input"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="TICKER_ID"
        />
        <button className="brutalist-button" onClick={consultOracle}>
          {status === 'communing' ? 'SENSING...' : 'CONSULT MYCELIUM'}
        </button>
      </div>

      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  );
};