import { useState } from 'react';

/**
 * KeyRestoreModal — shown on new-device login when an encrypted key backup
 * exists on the server. The user enters their password; keys are decrypted
 * entirely client-side. The password is never stored or sent to the server.
 *
 * Props:
 *   onRestore(password)  — called with the user's password when they submit
 *   onSkip()             — called if user opts to generate new keys (loses history)
 *   isLoading            — true while decryption / restore is in progress
 *   error                — error string to display (e.g. wrong password)
 *   noBackup             — true if server has no backup (first-ever device)
 */
export default function KeyRestoreModal({ onRestore, onSkip, isLoading, error, noBackup }) {
  const [password, setPassword] = useState('');
  const [showWarning, setShowWarning] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (password.trim()) onRestore(password);
  };

  if (noBackup) {
    return (
      <div className="modal-overlay">
        <div className="modal-content" style={{ maxWidth: 420 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔑</div>
          <h3 style={{ marginBottom: '0.5rem' }}>No Key Backup Found</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.25rem' }}>
            No encrypted key backup was found for your account. This can happen if you registered
            with an older version of the app. New encryption keys will be generated for this device.
          </p>
          <div className="encryption-badge" style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
            ⚠️ <strong>Note:</strong> Messages from before this session cannot be recovered — they were
            encrypted with your old keys, which are only available on your original device.
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={onSkip}>
            Generate New Keys &amp; Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 420 }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔐</div>
        <h3 style={{ marginBottom: '0.25rem' }}>Restore Your Encryption Keys</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.25rem' }}>
          You are signing in from a new device. Enter your password to decrypt and restore
          your encryption keys. Your password is never sent to the server.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label" htmlFor="restore-password">Password</label>
            <input
              id="restore-password"
              type="password"
              className="input-field"
              placeholder="Enter your login password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={isLoading}
            />
          </div>

          {error && (
            <div style={{
              color: 'var(--accent-red, #ff5555)',
              fontSize: '0.88rem',
              background: 'rgba(255,85,85,0.1)',
              borderRadius: '8px',
              padding: '0.6rem 0.75rem',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isLoading || !password.trim()}
            style={{ marginTop: '0.25rem' }}
          >
            {isLoading ? 'Restoring Keys…' : 'Restore Keys'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          {!showWarning ? (
            <button
              className="btn btn-ghost"
              style={{ width: '100%', fontSize: '0.85rem', opacity: 0.7 }}
              onClick={() => setShowWarning(true)}
            >
              Generate new keys instead (not recommended)
            </button>
          ) : (
            <div>
              <div className="encryption-badge" style={{ textAlign: 'left', marginBottom: '0.75rem' }}>
                Warning: Generating new keys will make all your previous messages
                permanently unreadable and will invalidate your key backup.
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1, fontSize: '0.85rem' }}
                  onClick={() => setShowWarning(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn"
                  style={{
                    flex: 1,
                    fontSize: '0.85rem',
                    background: 'var(--accent-red, #ff5555)',
                    color: '#fff',
                    border: 'none',
                  }}
                  onClick={onSkip}
                >
                  Generate New Keys
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
