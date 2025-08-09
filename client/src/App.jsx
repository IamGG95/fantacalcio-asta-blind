/* =============================
   2) client/src/App.jsx
   ============================= */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import './styles.css';

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
  const [settings, setSettings] = useState({ duration: 10 }); // DEFAULT 10s

  const [callPlayerName, setCallPlayerName] = useState('');
  const [auction, setAuction] = useState(null); // {playerName, duration, endsAt}
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);

  const [myBid, setMyBid] = useState('');
  const [offers, setOffers] = useState([]);
  const [winner, setWinner] = useState(null);
  const [toast, setToast] = useState(null);
  const [bidderIds, setBidderIds] = useState(() => new Set()); // socketIds che hanno offerto nell'asta corrente
  const [lastResultPlayer, setLastResultPlayer] = useState('');

  function sanitizePlayers(rawPlayers) {
    if (!Array.isArray(rawPlayers)) return [];
    return rawPlayers.map(p => ({ id: String(p.id || ''), name: String(p.name || 'sconosciuto') }));
  }

  const adminId = useMemo(() => (players[0] ? players[0].id : null), [players]);
  const amIAdmin = useMemo(() => currentSocketId && adminId && adminId === currentSocketId, [currentSocketId, adminId]);

  useEffect(() => {
    const s = io(SOCKET_URL, { autoConnect: true });
    socketRef.current = s;

    s.on('connect', () => { setConnected(true); setCurrentSocketId(s.id); });
    s.on('disconnect', () => { setConnected(false); setCurrentSocketId(null); });

    s.on('lobby:update', (pls) => setPlayers(sanitizePlayers(pls)));
    s.on('settings:update', (newSettings) => setSettings({ duration: Number(newSettings && newSettings.duration) || 10 }));

    s.on('auction:start', (a) => {
      const playerName = a && a.playerName ? String(a.playerName) : 'Giocatore sconosciuto';
      const duration = a && Number.isFinite(Number(a.duration)) ? Number(a.duration) : settings.duration || 10;
      const endsAt = a && Number.isFinite(Number(a.endsAt)) ? Number(a.endsAt) : Date.now() + duration * 1000;
      const auctionObj = { playerName, duration, endsAt };

      setAuction(auctionObj);
      setOffers([]);
      setWinner(null);
      setBidderIds(new Set());
      setLastResultPlayer('');
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

    s.on('auction:bid:ack', ({ amount }) => { showToast(`Offerta inviata: ${amount} crediti`); });

    s.on('auction:bid:mark', ({ socketId }) => {
      if (!socketId) return;
      setBidderIds(prev => { const next = new Set(prev); next.add(String(socketId)); return next; });
    });

    s.on('auction:end', (payload) => {
      try {
        const sanitizedOffers = Array.isArray(payload && payload.offers)
          ? payload.offers.map(o => ({ socketId: String(o.socketId || ''), name: String(o.name || 'sconosciuto'), amount: Number.isFinite(Number(o.amount)) ? Number(o.amount) : 0 }))
          : [];
        const sanitizedWinner = payload && payload.winner
          ? { socketId: String(payload.winner.socketId || ''), name: String(payload.winner.name || ''), amount: Number(payload.winner.amount || 0) }
          : null;
        const resultPlayer = payload && payload.playerName ? String(payload.playerName) : '';

        setOffers(sanitizedOffers);
        setWinner(sanitizedWinner);
        setLastResultPlayer(resultPlayer);
        setAuction(null);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setTimeLeft(0);
        setBidderIds(new Set());

        showToast(sanitizedWinner ? `Aggiudicatario: ${sanitizedWinner.name} (${sanitizedWinner.amount} crediti)` : 'Nessuna offerta inviata');
      } catch (err) { console.error('Error processing auction:end', err); }
    });

    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } s.off(); s.disconnect(); };
  }, []);

  function joinLobby() {
    if (!name) return alert('Inserisci un nickname');
    if (!socketRef.current || !socketRef.current.connected) return alert('Socket non connesso');
    socketRef.current.emit('lobby:join', { name });
    setJoined(true);
  }

  function leaveLobby() {
    if (socketRef.current && socketRef.current.connected) socketRef.current.emit('lobby:leave');
    setJoined(false);
  }

  // SOLO ADMIN può cambiare countdown
  function setServerSettingsDuration(newDuration) {
    if (!amIAdmin) return alert('Solo l\'admin può modificare il countdown');
    if (!socketRef.current || !socketRef.current.connected) return;
    const numeric = Number(newDuration);
    if (!Number.isFinite(numeric) || numeric < 1) return alert('Durata non valida');
    socketRef.current.emit('settings:set', { duration: Math.round(numeric) });
    showToast(`Countdown impostato a ${Math.round(numeric)}s`);
  }

  // SOLO ADMIN può chiamare il giocatore
  function callPlayer() {
    if (!amIAdmin) return alert('Solo l\'admin può chiamare un giocatore');
    if (!callPlayerName) return alert('Inserisci il nome del giocatore');
    if (!socketRef.current || !socketRef.current.connected) return alert('Socket non connesso');
    const durationToUse = settings && Number.isFinite(Number(settings.duration)) ? Number(settings.duration) : 10;
    socketRef.current.emit('auction:call', { playerName: callPlayerName, duration: durationToUse });
    setCallPlayerName('');
  }

  // Partecipanti: possono solo offrire
  function sendBid() {
    if (!auction) return alert('Nessuna asta in corso');
    if (amIAdmin) return alert('Gli admin non possono fare offerte');
    const numeric = Number(myBid);
    if (!Number.isFinite(numeric) || numeric < 0) return alert('Offerta non valida');
    setBidderIds(prev => { const next = new Set(prev); if (currentSocketId) next.add(String(currentSocketId)); return next; });
    socketRef.current.emit('auction:bid', { amount: numeric });
  }

  function quickAdd(n) { setMyBid(prev => String(Number(prev || 0) + n)); }
  function showToast(message) { setToast(message); window.clearTimeout(showToast._t); showToast._t = window.setTimeout(() => setToast(null), 2200); }

  const totalDuration = auction ? auction.duration : settings.duration;
  const pct = auction ? Math.max(0, Math.min(100, Math.round(((totalDuration - timeLeft) / totalDuration) * 100))) : 0;

  // Lista lobby senza mostrare l'admin
  const lobbyList = players.filter(p => p.id !== adminId);

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">⚽︎ Fantacalcio – Asta al buio</div>
        <div className="status">
          <span className={"dot " + (connected ? 'dot--on' : 'dot--off')} aria-label={connected ? 'connesso' : 'disconnesso'} />
          <span className="status__text">{connected ? 'Online' : 'Offline'}</span>
          {amIAdmin && <span className="role-badge" title="Sei l'amministratore">ADMIN</span>}
        </div>
      </header>

      {!joined ? (
        <main className="container">
          <section className="card">
            <h2 className="section-title">Entra nella lobby</h2>
            <label className="label" htmlFor="nickname">Nickname</label>
            <input id="nickname" className="input" placeholder="Es. Gabriele" value={name} onChange={e => setName(e.target.value)} />
            <button className="btn btn--primary w-100 mt-12" onClick={joinLobby}>Entra</button>
            <p className="muted mt-8">Socket: {connected ? 'Connesso' : 'Non connesso'}</p>
          </section>
        </main>
      ) : (
        <main className="container">
          {/* AUCTION PANEL UNIFICATO */}
          <section className="card card--stretch">
            <div className="auction__header">
              <div className="auction__title section-title">Asta in corso</div>
              <div className="auction__controls">
                <span className="muted">Countdown: <strong>{settings.duration}s</strong></span>
                {amIAdmin && (
                  <input
                    className="input input--sm"
                    type="number"
                    min="1"
                    defaultValue={settings.duration}
                    onBlur={(e) => setServerSettingsDuration(e.target.value)}
                    title="Modifica countdown (solo admin)"
                  />
                )}
              </div>
            </div>

            {/* Banner giocatore ben evidenziato */}
            <div className={"called-banner " + (auction ? 'called-banner--active' : 'called-banner--idle')}>
              <div className="called-banner__label">Giocatore</div>
              <div className="called-banner__name">{auction ? auction.playerName : '— in attesa —'}</div>
            </div>

            {/* ADMIN: input per chiamare; PARTECIPANTI: solo attesa */}
            {!auction && amIAdmin && (
              <div className="row mt-12 align-center">
                <input className="input flex-1" placeholder="Scrivi il nome del giocatore da chiamare" value={callPlayerName} onChange={(e) => setCallPlayerName(e.target.value)} />
                <button className="btn btn--success" onClick={callPlayer}>Chiama</button>
              </div>
            )}
            {!auction && !amIAdmin && (
              <p className="muted mt-8">In attesa che l'admin chiami un giocatore…</p>
            )}

            {/* Se countdown attivo, mostra barra e input offerta (solo partecipanti) */}
            {auction && (
              <>
                <div className="progress mt-12" aria-label="conto alla rovescia">
                  <div className={"progress__bar " + (timeLeft <= 3 ? 'progress__bar--warn' : '')} style={{ width: `${pct}%` }} />
                </div>
                <div className="timer">{timeLeft}s</div>

                {!amIAdmin ? (
                  <>
                    <div className="row mt-12 align-center">
                      <input className="input flex-1" inputMode="numeric" pattern="[0-9]*" placeholder="Inserisci offerta (crediti)" value={myBid} onChange={e => setMyBid(e.target.value)} />
                      <button className="btn btn--indigo" onClick={sendBid}>Invia</button>
                    </div>
                    <div className="pills mt-8">
                      {[1,5,10,20].map(n => (<button key={n} className="pill" onClick={() => quickAdd(n)}>+{n}</button>))}
                      <button className="pill pill--ghost" onClick={() => setMyBid('')}>Reset</button>
                    </div>
                  </>
                ) : (
                  <p className="muted mt-8">Gli admin non possono inviare offerte.</p>
                )}
              </>
            )}

            {/* RIEPILOGO OFFERTE con nome del giocatore */}
            <div className="card__sub">
              <div className="card__subtitle">Ultimo risultato {lastResultPlayer ? `— ${lastResultPlayer}` : ''}</div>
              {offers && offers.length ? (
                <ol className="ranking">
                  {offers.map((o, idx) => (
                    <li key={o.socketId || idx} className={"ranking__row " + (winner && winner.socketId === o.socketId ? 'ranking__row--win' : '')}>
                      <span className="ranking__name">{String(o.name)}</span>
                      <span className="ranking__amount">{String(o.amount)} crediti</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">Nessun risultato recente</p>
              )}
            </div>
          </section>

          {/* LOBBY compatta e in secondo piano, senza mostrare l'admin */}
          <section className="card card--muted mt-12">
            <div className="card__header"><h2 className="section-title">Lista squadre in lobby</h2></div>
            <ul className="list">
              {lobbyList.map(p => {
                const hasBid = auction && bidderIds.has(p.id);
                return (
                  <li key={p.id} className={"list__row align-center " + (hasBid ? 'list__row--bid' : '')}>
                    <div className="chip">
                      <span className="chip__name">{p.name}</span>
                      {p.id === currentSocketId && !amIAdmin && <span className="badge">tu</span>}
                      {hasBid && <span className="badge badge--offer">ha offerto</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="row mt-12">
              <button className="btn btn--danger" onClick={leaveLobby}>Esci</button>
            </div>
          </section>
        </main>
      )}

      {toast && (<div className="toast" role="status" aria-live="polite">{toast}</div>)}
      <footer className="app__footer"><small>Made for friends ⚽︎</small></footer>
    </div>
  );
}
