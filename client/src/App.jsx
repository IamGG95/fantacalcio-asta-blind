// client/src/App.jsx
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// Cambia l'URL se il server è su host diverso (Vite usa import.meta.env)
const SOCKET_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SOCKET_URL) ? import.meta.env.VITE_SOCKET_URL : 'http://localhost:3001';

export default function App() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [currentSocketId, setCurrentSocketId] = useState(null);

  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]); // sanitized list
  const [settings, setSettings] = useState({ duration: 30 });

  const [callPlayerName, setCallPlayerName] = useState('');
  const [auction, setAuction] = useState(null); // {playerName, duration, endsAt}
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);

  const [myBid, setMyBid] = useState('');
  const [offers, setOffers] = useState([]);
  const [winner, setWinner] = useState(null);

  // Helpers
  function sanitizePlayers(rawPlayers) {
    if (!Array.isArray(rawPlayers)) return [];
    return rawPlayers.map(p => ({ id: String(p.id || ''), name: String(p.name || 'sconosciuto'), budget: Number.isFinite(Number(p.budget)) ? Number(p.budget) : 100 }));
  }

  useEffect(() => {
    // Initialize socket on mount
    const s = io(SOCKET_URL, { autoConnect: true });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      setCurrentSocketId(s.id);
    });

    s.on('disconnect', () => {
      setConnected(false);
      setCurrentSocketId(null);
    });

    s.on('lobby:update', (pls) => {
      setPlayers(sanitizePlayers(pls));
    });

    s.on('settings:update', (newSettings) => {
      setSettings({ duration: Number(newSettings && newSettings.duration) || 30 });
    });

    s.on('auction:start', (a) => {
      // sanitize payload
      const playerName = a && a.playerName ? String(a.playerName) : 'Giocatore sconosciuto';
      const duration = a && Number.isFinite(Number(a.duration)) ? Number(a.duration) : settings.duration || 30;
      const endsAt = a && Number.isFinite(Number(a.endsAt)) ? Number(a.endsAt) : Date.now() + duration * 1000;

      const auctionObj = { playerName, duration, endsAt };
      setAuction(auctionObj);
      setOffers([]);
      setWinner(null);

      // setup timer
      const update = () => {
        const left = Math.max(0, Math.round((auctionObj.endsAt - Date.now()) / 1000));
        setTimeLeft(left);
        if (left <= 0 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
      update();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(update, 250);
    });

    s.on('auction:bid:ack', ({ amount }) => {
      // optionally show a small confirmation
    });

    s.on('auction:end', (payload) => {
      // sanitize incoming payload
      try {
        const sanitizedOffers = Array.isArray(payload && payload.offers) ? payload.offers.map(o => ({ socketId: String(o.socketId || ''), name: String(o.name || 'sconosciuto'), amount: Number.isFinite(Number(o.amount)) ? Number(o.amount) : 0 })) : [];
        const sanitizedWinner = payload && payload.winner ? { socketId: String(payload.winner.socketId || ''), name: String(payload.winner.name || ''), amount: Number(payload.winner.amount || 0) } : null;
        const updatedPlayers = sanitizePlayers(payload && payload.updatedPlayers ? payload.updatedPlayers : players);

        setOffers(sanitizedOffers);
        setWinner(sanitizedWinner);
        setPlayers(updatedPlayers);
        setAuction(null);

        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setTimeLeft(0);
      } catch (err) {
        console.error('Error processing auction:end', err);
      }
    });

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      s.off();
      s.disconnect();
    };
  }, []);

  // Helpers
  const myInfo = players.find(p => p.name === name) || players.find(p => p.id === currentSocketId) || null;
  const amIAdmin = currentSocketId && players.length && players[0] && players[0].id === currentSocketId;

  function joinLobby() {
    if (!name) return alert('Inserisci un nickname');
    if (!socketRef.current || !socketRef.current.connected) return alert('Socket non connesso');
    socketRef.current.emit('lobby:join', { name, budget: 100 });
    setJoined(true);
  }

  function leaveLobby() {
    if (socketRef.current && socketRef.current.connected) socketRef.current.emit('lobby:leave');
    setJoined(false);
  }

  function setServerSettingsDuration(newDuration) {
    if (!socketRef.current || !socketRef.current.connected) return;
    const numeric = Number(newDuration);
    if (!Number.isFinite(numeric) || numeric < 1) return alert('Durata non valida');
    socketRef.current.emit('settings:set', { duration: Math.round(numeric) });
  }

  function callPlayer() {
    if (!callPlayerName) return alert('Inserisci il nome del giocatore');
    if (!socketRef.current || !socketRef.current.connected) return alert('Socket non connesso');
    const durationToUse = settings && Number.isFinite(Number(settings.duration)) ? Number(settings.duration) : 30;

    socketRef.current.emit('auction:call', { playerName: callPlayerName, duration: durationToUse });
    setCallPlayerName('');
  }

  function sendBid() {
    if (!auction) return alert('Nessuna asta in corso');
    const numeric = Number(myBid);
    if (!Number.isFinite(numeric)) return alert('Offerta non valida');
    if (!myInfo) return alert('Non sei riconosciuto nella lobby');
    if (numeric > myInfo.budget) return alert('Offerta superiore al tuo budget');
    socketRef.current.emit('auction:bid', { amount: numeric });
  }

  return (
    <div className="min-h-screen p-6" style={{ background: '#f9fafb' }}>
      <div className="max-w-4xl" style={{ margin: '0 auto' }}>
        <h1 className="text-2xl" style={{ fontWeight: 'bold', marginBottom: '1rem' }}>Fantacalcio - Asta al buio (Prototipo)</h1>

        {!joined ? (
          <div style={{ padding: '1rem', background: '#fff', borderRadius: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
            <label className="block mb-2">Nickname</label>
            <input style={{ border: '1px solid #e5e7eb', padding: '0.5rem', width: '100%' }} value={name} onChange={e => setName(e.target.value)} />
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
              <button style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', borderRadius: '0.375rem' }} onClick={joinLobby}>Entra</button>
            </div>
            <p style={{ fontSize: '0.875rem', marginTop: '0.5rem', color: '#6b7280' }}>Stato connessione socket: {connected ? 'Connesso' : 'Non connesso'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            <div className="md:col-span-2">
              <div style={{ padding: '1rem', background: '#fff', borderRadius: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.08)', marginBottom: '1rem' }}>
                <h2 className="font-semibold">Lobby</h2>
                <div className="mt-2">Partecipanti:</div>
                <ul className="mt-2">
                  {players.map(p => (
                    <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', borderBottom: '1px solid #e5e7eb' }}>
                      <span>{p.name}{p.id === currentSocketId ? ' (tu)' : ''}{p.id === (players[0] && players[0].id) ? ' (admin)' : ''}</span>
                      <span>Budget: {typeof p.budget === 'number' ? p.budget : String(p.budget)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3" style={{ marginTop: '0.75rem' }}>
                  <button style={{ padding: '0.25rem 0.75rem', background: '#ef4444', color: '#fff', borderRadius: '0.375rem' }} onClick={leaveLobby}>Esci</button>
                </div>
              </div>

              <div style={{ padding: '1rem', background: '#fff', borderRadius: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
                <h2 className="font-semibold">Chiama giocatore (è il tuo turno?)</h2>
                <div className="mt-2" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <input style={{ border: '1px solid #e5e7eb', padding: '0.5rem', flex: 1 }} placeholder="Es. Lautaro Martinez" value={callPlayerName} onChange={e => setCallPlayerName(e.target.value)} />
                  <button style={{ padding: '0.5rem 0.75rem', background: '#16a34a', color: '#fff', borderRadius: '0.375rem' }} onClick={callPlayer}>Chiama</button>
                </div>
                <p style={{ fontSize: '0.875rem', marginTop: '0.5rem', color: '#6b7280' }}>Il server gestisce il countdown e mostra i risultati alla fine.</p>
                <div className="mt-3" style={{ marginTop: '0.75rem' }}>
                  <p style={{ fontSize: '0.875rem' }}>Durata attuale countdown: <strong>{settings.duration}s</strong></p>
                  {amIAdmin and (
                    <div className="mt-2" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <input type="number" min="1" style={{ border: '1px solid #e5e7eb', padding: '0.5rem' }} defaultValue={settings.duration} onBlur={(e) => setServerSettingsDuration(e.target.value)} />
                      <span style={{ fontSize: '0.875rem', color: '#6b7280', alignSelf: 'center' }}>(modifica come admin)</span>
                    </div>
                  )}
                </div>
              </div>

            </div>

            <div>
              <div style={{ padding: '1rem', background: '#fff', borderRadius: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.08)', marginBottom: '1rem' }}>
                <h3 className="font-semibold">La tua scheda</h3>
                <p className="mt-2">Nickname: <strong>{name}</strong></p>
                <p>Budget: <strong>{myInfo ? myInfo.budget : '---'}</strong></p>
              </div>

              <div style={{ padding: '1rem', background: '#fff', borderRadius: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
                <h3 className="font-semibold">Asta in corso</h3>
                {auction ? (
                  <div>
                    <p>Giocatore: <strong>{String(auction.playerName)}</strong></p>
                    <p>Tempo rimasto: <strong>{timeLeft}s</strong></p>
                    <div className="mt-2">
                      <input style={{ border: '1px solid #e5e7eb', padding: '0.5rem', width: '100%' }} placeholder="Inserisci offerta" value={myBid} onChange={e => setMyBid(e.target.value)} />
                      <button style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#4f46e5', color: '#fff', borderRadius: '0.375rem', width: '100%' }} onClick={sendBid}>Invia offerta (al buio)</button>
                    </div>
                  </div>
                ) : (
                  <p>Nessuna asta in corso</p>
                )}
              </div>

              <div style={{ padding: '1rem', background: '#fff', borderRadius: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.08)', marginTop: '1rem' }}>
                <h3 className="font-semibold">Ultimo risultato</h3>
                {offers && offers.length ? (
                  <div>
                    <p>Giocatore: {offers[0] ? String(offers[0].playerName || offers[0].name || '---') : '---'}</p>
                    <ol className="mt-2">
                      {offers.map((o, idx) => (
                        <li key={o.socketId || idx} style={{ padding: '0.25rem 0' }}>
                          {String(o.name)} — {String(o.amount)} {winner && winner.socketId === o.socketId ? '(VINCE)' : ''}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p>Nessun risultato recente</p>
                )}
              </div>

            </div>

          </div>
        )}
      </div>
    </div>
  );
}
