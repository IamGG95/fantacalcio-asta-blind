// client/src/App.jsx
// Aggiornato: rimosso ogni riferimento a budget e "la tua scheda"
// Solo admin può impostare giocatore e countdown (default 10s), puntate illimitate in crediti

import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import './styles.css';

const socket = io(import.meta.env.VITE_SOCKET_URL);

export default function App() {
  const [players, setPlayers] = useState([]);
  const [offers, setOffers] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(null);
  const [settings, setSettings] = useState({ duration: 10 });
  const [timeLeft, setTimeLeft] = useState(0);
  const [amIAdmin, setAmIAdmin] = useState(false);
  const [nickname, setNickname] = useState('');
  const [inLobby, setInLobby] = useState(true);
  const [offerAmount, setOfferAmount] = useState('');

  useEffect(() => {
    socket.on('init', ({ players, settings, currentPlayer, adminId }) => {
      setPlayers(players);
      setSettings(settings);
      setCurrentPlayer(currentPlayer);
      setAmIAdmin(socket.id === adminId);
    });

    socket.on('updatePlayers', setPlayers);
    socket.on('updateSettings', setSettings);
    socket.on('playerCalled', (player) => {
      setCurrentPlayer(player);
      setOffers([]);
    });
    socket.on('startCountdown', setTimeLeft);
    socket.on('tick', setTimeLeft);
    socket.on('offersRevealed', setOffers);

    return () => {
      socket.off();
    };
  }, []);

  const joinLobby = () => {
    if (!nickname.trim()) return;
    socket.emit('join', nickname.trim());
    setInLobby(false);
  };

  const callPlayer = (name) => {
    if (!name.trim()) return;
    socket.emit('callPlayer', name.trim());
  };

  const sendOffer = () => {
    if (!offerAmount) return;
    socket.emit('sendOffer', { amount: Number(offerAmount) });
    setOfferAmount('');
  };

  const changeDuration = (val) => {
    socket.emit('changeDuration', Number(val));
  };

  return (
    <div className="app">
      {inLobby ? (
        <div className="lobby">
          <h1>Fantacalcio - Asta al buio</h1>
          <input
            placeholder="Il tuo nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <button onClick={joinLobby}>Entra</button>
        </div>
      ) : (
        <div className="game">
          <h2>Giocatore in asta: {currentPlayer || '—'}</h2>
          {amIAdmin && (
            <div className="admin-controls">
              <input
                placeholder="Nome giocatore"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') callPlayer(e.target.value);
                }}
              />
              <div>
                <label>Countdown (s):</label>
                <input
                  type="number"
                  min="1"
                  defaultValue={settings.duration}
                  onBlur={(e) => changeDuration(e.target.value)}
                />
              </div>
            </div>
          )}

          {timeLeft > 0 && (
            <div>
              <p>Tempo rimanente: {timeLeft}s</p>
              <input
                type="number"
                placeholder="Offerta (crediti)"
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
              />
              <button onClick={sendOffer}>Invia offerta</button>
            </div>
          )}

          {offers.length > 0 && (
            <div className="offers">
              <h3>Offerte</h3>
              <ul>
                {offers.map((o, i) => (
                  <li key={i}>{o.name}: {o.amount} crediti</li>
                ))}
              </ul>
            </div>
          )}

          <div className="players">
            <h3>Partecipanti</h3>
            <ul>
              {players.map((p) => (
                <li key={p.id}>{p.name} {p.id === socket.id && '(Tu)'} {p.id === socket.id && amIAdmin && '[Admin]'}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
