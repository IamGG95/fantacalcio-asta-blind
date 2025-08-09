// client/src/App.jsx
import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// Cambia l'URL se il server è su host diverso (Vite usa import.meta.env)
const SOCKET_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.VITE_SOCKET_URL)
    ? import.meta.env.VITE_SOCKET_URL
    : 'http://localhost:3001';

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
    return rawPlayers.map(p => ({
      id: String(p.id || ''),
      name: String(p.name || 'sconosciuto'),
      budget: Number.isFinite(Number(p.budget)) ? Number(p.budget) : 100
    }));
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
      // console.log('bid ack', amount);
    });

    s.on('auction:end', (payload) => {
