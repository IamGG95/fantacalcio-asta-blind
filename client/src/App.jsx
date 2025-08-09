// client/src/App.jsx
// Correzione errore JSX: sostituito "and" con "&&" per condizione admin

<p style={{ fontSize: '0.875rem' }}>Durata attuale countdown: <strong>{settings.duration}s</strong></p>
{amIAdmin && (
  <div className="mt-2" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
    <input
      type="number"
      min="1"
      style={{ border: '1px solid #e5e7eb', padding: '0.5rem' }}
      defaultValue={settings.duration}
      onBlur={(e) => setServerSettingsDuration(e.target.value)}
    />
    <span style={{ fontSize: '0.875rem', color: '#6b7280', alignSelf: 'center' }}>
      (modifica come admin)
    </span>
  </div>
)}
