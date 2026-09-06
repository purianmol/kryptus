import { useState } from 'react';

/**
 * KeyRestoreModal — shown when the key sync system detects an issue.
 * Handles multiple scenarios:
 *   - 'needs_password'        → New device, backup exists, enter password to restore
 *   - 'no_backup'             → No backup exists, generate new keys WITH password (so backup is created)
 *   - 'needs_backup_upload'   → Keys work but no backup, enter password to create one
 *   - 'needs_reupload'        → Local keys don't match server, no backup, re-upload + create backup
 *   - 'keys_mismatch_restore' → Local keys don't match server, backup exists, restore from backup
 *
 * Props:
 *   mode                        — one of the states above
 *   onRestore(password)         — restore keys from backup
 *   onGenerateNew(password)     — generate new keys with backup
 *   onUploadBackup(password)    — upload backup of current keys
 *   onReupload(password)        — re-upload current keys + create backup
 *   isLoading                   — true while operation is in progress
 *   error                       — error string to display
 */
export default function KeyRestoreModal({
  mode,
  onRestore,
  onGenerateNew,
  onUploadBackup,
  onReupload,
  isLoading,
  error,
}) {
  const [password, setPassword] = useState('');
  const [showWarning, setShowWarning] = useState(false);

  // ── needs_backup_upload: Keys work but no backup on server ──
  if (mode === 'needs_backup_upload') {
    return (
      <div className="modal-overlay">
        <div className="modal-content" style={{ maxWidth: 420 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>☁️</div>
          <h3 style={{ marginBottom: '0.5rem' }}>Create Key Backup</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.25rem' }}>
            Your encryption keys are not backed up. Enter your password to create an encrypted
            backup so you can access your messages on other devices.
          </p>

          <form onSubmit={(e) => { e.preventDefault(); if (password.trim()) onUploadBackup(password); }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" htmlFor="backup-password">Password</label>
              <input
                id="backup-password"
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
              {isLoading ? 'Creating Backup…' : 'Create Backup'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── needs_reupload: Local keys don't match server, no backup ──
  if (mode === 'needs_reupload') {
    return (
      <div className="modal-overlay">
        <div className="modal-content" style={{ maxWidth: 420 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔄</div>
          <h3 style={{ marginBottom: '0.5rem' }}>Keys Out of Sync</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.25rem' }}>
            Your encryption keys on this device don't match the server. This can happen if you
            generated new keys on another device. Enter your password to re-sync your keys
            and create a backup.
          </p>

          <form onSubmit={(e) => { e.preventDefault(); if (password.trim()) onReupload(password); }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" htmlFor="reupload-password">Password</label>
              <input
                id="reupload-password"
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
              {isLoading ? 'Syncing Keys…' : 'Re-sync Keys & Create Backup'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── keys_mismatch_restore: Local keys don't match server, backup exists ──
  if (mode === 'keys_mismatch_restore') {
    return (
      <div className="modal-overlay">
        <div className="modal-content" style={{ maxWidth: 420 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚠️</div>
          <h3 style={{ marginBottom: '0.5rem' }}>Key Mismatch Detected</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.25rem' }}>
            Your encryption keys on this device don't match the server. Another device has updated
            your keys. Enter your password to restore the correct keys from your backup.
          </p>

          <div className="encryption-badge" style={{ marginBottom: '1rem', textAlign: 'left' }}>
            ⚠️ <strong>Note:</strong> Messages sent from this device after the mismatch occurred
            may become unreadable. New messages will work correctly after restoring.
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (password.trim()) onRestore(password); }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" htmlFor="mismatch-password">Password</label>
              <input
                id="mismatch-password"
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
              {isLoading ? 'Restoring Keys…' : 'Restore Keys from Backup'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── no_backup: No backup on server, generate new keys WITH password ──
  if (mode === 'no_backup') {
    return (
      <div className="modal-overlay">
        <div className="modal-content" style={{ maxWidth: 420 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔑</div>
          <h3 style={{ marginBottom: '0.5rem' }}>Set Up Encryption Keys</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.25rem' }}>
            No encrypted key backup was found for your account. Enter your password to generate new 
            encryption keys and create a backup for cross-device sync.
          </p>
          <div className="encryption-badge" style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
            ⚠️ <strong>Note:</strong> Messages from before this session cannot be recovered — they were
            encrypted with your old keys, which are only available on your original device.
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (password.trim()) onGenerateNew(password); }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" htmlFor="new-keys-password">Password</label>
              <input
                id="new-keys-password"
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
              {isLoading ? 'Generating Keys…' : 'Generate Keys & Create Backup'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── needs_password: Backup exists on server, restore by entering password ──
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 420 }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔐</div>
        <h3 style={{ marginBottom: '0.25rem' }}>Restore Your Encryption Keys</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.25rem' }}>
          You are signing in from a new device. Enter your password to decrypt and restore
          your encryption keys. Your password is never sent to the server.
        </p>

        <form onSubmit={(e) => { e.preventDefault(); if (password.trim()) onRestore(password); }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
                  onClick={() => {
                    if (password.trim()) {
                      onGenerateNew(password);
                    }
                  }}
                  disabled={!password.trim() || isLoading}
                >
                  Generate New Keys
                </button>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.5rem', textAlign: 'center' }}>
                Enter your password above first, then click Generate.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
