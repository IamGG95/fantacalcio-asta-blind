/* =============================
   1) server/server.js
   ============================= */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;

// Stato in-memory
let lobby = {
  players: [], // {id, name}
  adminId: null, // primo che entra
  inAuction: null, // {playerName, callerId, duration, endsAt, bids: {socketId: amount}}
  settings: { duration: 10 }, // DEFAULT 10s
};

function sanitizePlayer(raw) {
  return { id: String(raw.id || ''), name: String(raw.name || 'sconosciuto') };
}

io.on('connection', (socket) => {
  socket.emit('settings:update', lobby.settings);
  socket.emit('lobby:update', lobby.players.map(sanitizePlayer));

  socket.on('lobby:join', (payload = {}) => {
    const name = payload.name ? String(payload.name) : `Giocatore-${socket.id.slice(0,4)}`;

    // rejoin safe
    lobby.players = lobby.players.filter(p => p.id !== socket.id);
    lobby.players.push({ id: socket.id, name });

    if (!lobby.adminId) lobby.adminId = socket.id; // primo è admin

    io.emit('lobby:update', lobby.players.map(sanitizePlayer));
    io.emit('settings:update', lobby.settings);
  });

  socket.on('lobby:leave', () => {
    lobby.players = lobby.players.filter(p => p.id !== socket.id);
    if (lobby.adminId === socket.id) {
      lobby.adminId = lobby.players.length ? lobby.players[0].id : null;
    }
    io.emit('lobby:update', lobby.players.map(sanitizePlayer));
    io.emit('settings:update', lobby.settings);
  });

  // Solo l'ADMIN può cambiare il countdown
  socket.on('settings:set', (newSettings = {}) => {
    if (socket.id !== lobby.adminId) return; // blocco non-admin
    const duration = Number.isFinite(Number(newSettings.duration)) ? Math.max(1, Number(newSettings.duration)) : lobby.settings.duration;
    lobby.settings.duration = duration;
    io.emit('settings:update', lobby.settings);
  });

  // Solo l'ADMIN può chiamare il giocatore
  socket.on('auction:call', (payload = {}) => {
    if (socket.id !== lobby.adminId) return; // blocco non-admin
    if (lobby.inAuction) return; // già in corso

    const playerName = payload.playerName ? String(payload.playerName) : 'Giocatore sconosciuto';
    const duration = Number.isFinite(Number(payload.duration)) ? Math.max(1, Number(payload.duration)) : Number(lobby.settings.duration || 10);

    const now = Date.now();
    const endsAt = now + duration * 1000;

    lobby.inAuction = { playerName, callerId: socket.id, duration, endsAt, bids: {} };

    io.emit('auction:start', { playerName, duration, endsAt });

    const durationMs = endsAt - Date.now();
    setTimeout(() => {
      const auction = lobby.inAuction;
      if (!auction) return;

      const offers = Object.entries(auction.bids).map(([socketId, amount]) => {
        const player = lobby.players.find(p => p.id === socketId);
        return { socketId: String(socketId), name: player ? String(player.name) : 'sconosciuto', amount: Number(amount) || 0 };
      }).sort((a,b) => b.amount - a.amount);

      const winner = offers.length ? offers[0] : null;

      io.emit('auction:end', {
        playerName: String(auction.playerName),
        offers,
        winner: winner ? { socketId: winner.socketId, name: winner.name, amount: winner.amount } : null,
      });

      lobby.inAuction = null;
    }, Math.max(0, durationMs) + 250);
  });

  socket.on('auction:bid', (payload = {}) => {
    if (!lobby.inAuction) return;
    // blocca offerte dall'admin
    if (socket.id === lobby.adminId) return;
    const numeric = Number.isFinite(Number(payload.amount)) ? Number(payload.amount) : NaN;
    if (isNaN(numeric) || numeric < 0) return; // numerico e non negativo
    lobby.inAuction.bids[socket.id] = numeric;
    socket.emit('auction:bid:ack', { amount: numeric });
    // Notifica a tutti che questo socket ha offerto (senza rivelare importo)
    io.emit('auction:bid:mark', { socketId: socket.id });
  });

  socket.on('disconnect', () => {
    lobby.players = lobby.players.filter(p => p.id !== socket.id);
    if (lobby.adminId === socket.id) {
      lobby.adminId = lobby.players.length ? lobby.players[0].id : null;
    }
    io.emit('lobby:update', lobby.players.map(sanitizePlayer));
    io.emit('settings:update', lobby.settings);
  });
});

app.get('/', (req, res) => res.send('Fantacalcio Asta - Server attivo'));
server.listen(PORT, () => console.log('Server listening on', PORT));
