import { useState, useEffect } from 'react';
import { useCrypto } from '../context/CryptoContext';

export default function SafetyNumber({ peerId, peerName, onClose }) {
  const { getFingerprint } = useCrypto();
  const [fingerprint, setFingerprint] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const fp = await getFingerprint(peerId);
        setFingerprint(fp);
      } catch (err) {
        console.error('Failed to compute fingerprint:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [peerId, getFingerprint]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>🛡️ Safety Number</h3>
        <p>
          Compare this number with <strong>{peerName}</strong> to verify
          your encrypted connection. If they match, your conversation is
          secure and no one is intercepting your messages.
        </p>

        {loading ? (
          <div className="fingerprint-display" style={{ opacity: 0.5 }}>
            Computing...
          </div>
        ) : fingerprint ? (
          <div className="fingerprint-display">{fingerprint}</div>
        ) : (
          <div className="fingerprint-display" style={{ color: 'var(--accent-red)' }}>
            Unable to compute safety number.
          </div>
        )}

        <button
          className="btn btn-ghost modal-close-btn"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
