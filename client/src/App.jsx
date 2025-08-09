// client/src/App.jsx — UI rinnovata (mobile-first, progress bar countdown, pill buttons)
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { io } from 'socket.io-client';
import './styles.css'; // vedi in fondo al documento il contenuto del file

const SOCKET_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SOCKET_URL)
  ? import.meta.env.VITE_SOCKET_URL
  : 'http://localhost:3001';

export default function App() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [currentSocketId, setCurrentSocketId] = useState(null);

  const [name, setName] = useState('');
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [settings, setSettings] = useState({ duration: 30 });

  const [callPlayerName, setCallPlayerName] = useState('');
  const [auction, setAuction] = useState(null); // {playerName, duration, endsAt}
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);

  const [myBid, setMyBid] = useState('');
  const [offers, setOffers] = useState([]);
  const [winner, setWinner] = useState(null);
  const [toast, setToast] = useState(null);

  // Helpers
  function sanitizePlayers(rawPlayers) {
    if (!Array.isArray(rawPlayers)) return [];
    return rawPlayers.map(p => ({ id: String(p.id || ''), name: String(p.name || 'sconosciuto'), budget: Number.isFinite(Number(p.budget)) ? Number(p.budget) : 100 }));
  }

  const amIAdmin = useMemo(() => currentSocketId && players.length && players[0] && players[0].id === currentSocketId, [currentSocketId, players]);
  const myInfo = useMemo(() => players.find(p => p.name === name) || players.find(p => p.id === currentSocketId) || null, [players, name, currentSocketId]);

  useEffect(() => {
    const s = io(SOCKET_URL, { autoConnect: true });
    socketRef.current = s;

    s.on('connect', () => { setConnected(true); setCurrentSocketId(s.id); });
    s.on('disconnect', () => { setConnected(false); setCurrentSocketId(null); });

    s.on('lobby:update', (pls) => setPlayers(sanitizePlayers(pls)));
    s.on('settings:update', (newSettings) => setSettings({ duration: Number(newSettings && newSettings.duration) || 30 }));

    s.on('auction:start', (a) => {
      const playerName = a && a.playerName ? String(a.playerName) : 'Giocatore sconosciuto';
      const duration = a && Number.isFinite(Number(a.duration)) ? Number(a.duration) : settings.duration || 30;
      const endsAt = a && Number.isFinite(Number(a.endsAt)) ? Number(a.endsAt) : Date.now() + duration * 1000;
      const auctionObj = { playerName, duration, endsAt };
      setAuction(auctionObj);
      setOffers([]);
      setWinner(null);
      showToast(`Asta avviata: ${playerName}`);

      const update = () => {
        const left = Math.max(0, Math.round((auctionObj.endsAt - Date.now()) / 1000));
        setTimeLeft(left);
        if (left <= 0 && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      };
      update();
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(update, 250);
    });

    s.on('auction:bid:ack', ({ amount }) => {
      showToast(`Offerta inviata: ${amount}`);
    });

    s.on('auction:end', (payload) => {
      try {
        const sanitizedOffers = Array.isArray(payload && payload.offers)
          ? payload.offers.map(o => ({ socketId: String(o.socketId || ''), name: String(o.name || 'sconosciuto'), amount: Number.isFinite(Number(o.amount)) ? Number(o.amount) : 0 }))
          : [];
        const sanitizedWinner = payload && payload.winner
          ? { socketId: String(payload.winner.socketId || ''), name: String(payload.winner.name || ''), amount: Number(payload.winner.amount || 0) }
          : null;
        const updatedPlayers = sanitizePlayers(payload && payload.updatedPlayers ? payload.updatedPlayers : players);

        setOffers(sanitizedOffers);
        setWinner(sanitizedWinner);
        setPlayers(updatedPlayers);
        setAuction(null);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setTimeLeft(0);

        showToast(sanitizedWinner ? `Aggiudicatario: ${sanitizedWinner.name} (${sanitizedWinner.amount})` : 'Nessuna offerta inviata');
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
    showToast(`Countdown impostato a ${Math.round(numeric)}s`);
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

  function quickAdd(n) { setMyBid(prev => String(Number(prev || 0) + n)); }

  function showToast(message) {
    setToast(message);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2200);
  }

  const totalDuration = auction ? auction.duration : settings.duration;
  const pct = auction ? Math.max(0, Math.min(100, Math.round(((totalDuration - timeLeft) / totalDuration) * 100))) : 0;

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">⚽︎ Fantacalcio – Asta al buio</div>
        <div className="status">
          <span className={"dot " + (connected ? 'dot--on' : 'dot--off')} aria-label={connected ? 'connesso' : 'disconnesso'} />
          <span className="status__text">{connected ? 'Online' : 'Offline'}</span>
        </div>
      </header>

      {!joined ? (
        <main className="container">
          <section className="card">
            <h2>Entra nella lobby</h2>
            <label className="label" htmlFor="nickname">Nickname</label>
            <input id="nickname" className="input" placeholder="Es. Gabriele" value={name} onChange={e => setName(e.target.value)} />
            <button className="btn btn--primary w-100 mt-12" onClick={joinLobby}>Entra</button>
            <p className="muted mt-8">Socket: {connected ? 'Connesso' : 'Non connesso'}</p>
          </section>
        </main>
      ) : (
        <main className="container grid">
          <section className="card card--stretch">
            <div className="card__header">
              <h2>Lobby</h2>
            </div>
            <ul className="list">
              {players.map(p => (
                <li key={p.id} className="list__row">
                  <div className="chip">
                    <span className="chip__name">{p.name}</span>
                    {p.id === currentSocketId && <span className="badge">tu</span>}
                    {p.id === (players[0] && players[0].id) && <span className="badge badge--gold">admin</span>}
                  </div>
                  <div className="mono">€ {p.budget}</div>
                </li>
              ))}
            </ul>
            <div className="row mt-12">
              <button className="btn btn--danger" onClick={leaveLobby}>Esci</button>
            </div>
          </section>

          <section className="card card--stretch">
            <div className="card__header"><h2>Chiamata giocatore</h2></div>
            <div className="row">
              <input className="input flex-1" placeholder="Es. Lautaro Martinez" value={callPlayerName} onChange={e => setCallPlayerName(e.target.value)} />
              <button className="btn btn--success" onClick={callPlayer}>Chiama</button>
            </div>
            <p className="muted mt-8">Il server gestisce countdown e reveal offerte.</p>
            <div className="mt-12">
              <p className="muted">Countdown attuale: <strong>{settings.duration}s</strong></p>
              {amIAdmin && (
                <div className="row mt-8">
                  <input type="number" min="1" className="input" defaultValue={settings.duration} onBlur={(e) => setServerSettingsDuration(e.target.value)} />
                  <span className="muted">(solo admin)</span>
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card__header"><h3>La tua scheda</h3></div>
            <div className="kv"><span>Nickname</span><strong>{name}</strong></div>
            <div className="kv"><span>Budget</span><strong>€ {myInfo ? myInfo.budget : '—'}</strong></div>
          </section>

          <section className="card">
            <div className="card__header"><h3>Asta in corso</h3></div>
            {auction ? (
              <>
                <div className="kv"><span>Giocatore</span><strong>{String(auction.playerName)}</strong></div>
                <div className="progress mt-8" aria-label="conto alla rovescia">
                  <div className={"progress__bar " + (timeLeft <= 5 ? 'progress__bar--warn' : '')} style={{ width: `${pct}%` }} />
                </div>
                <div className="timer">{timeLeft}s</div>
                <div className="row mt-12">
                  <input className="input flex-1" inputMode="numeric" pattern="[0-9]*" placeholder="Inserisci offerta" value={myBid} onChange={e => setMyBid(e.target.value)} />
                  <button className="btn btn--indigo" onClick={sendBid}>Invia</button>
                </div>
                <div className="pills mt-8">
                  {[1,5,10,20].map(n => (
                    <button key={n} className="pill" onClick={() => quickAdd(n)}>+{n}</button>
                  ))}
                  <button className="pill pill--ghost" onClick={() => setMyBid('')}>Reset</button>
                </div>
              </>
            ) : (
              <p className="muted">Nessuna asta in corso</p>
            )}
          </section>

          <section className="card">
            <div className="card__header"><h3>Ultimo risultato</h3></div>
            {offers && offers.length ? (
              <>
                <ol className="ranking">
                  {offers.map((o, idx) => (
                    <li key={o.socketId || idx} className={"ranking__row " + (winner && winner.socketId === o.socketId ? 'ranking__row--win' : '')}>
                      <span className="ranking__name">{String(o.name)}</span>
                      <span className="ranking__amount">€ {String(o.amount)}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="muted">Nessun risultato recente</p>
            )}
          </section>
        </main>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">{toast}</div>
      )}

      <footer className="app__footer">
        <small>Made for friends ⚽︎</small>
      </footer>
    </div>
  );
}
