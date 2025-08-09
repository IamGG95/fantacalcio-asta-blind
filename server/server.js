/* =====================================
   File: server/server.js
   ===================================== */
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
  adminId: null, // impostato SOLO via admin:claim
  inAuction: null, // {playerName, callerId, duration, endsAt, bids:{socketId:amount}, tickTimer}
  settings: { duration: 30 }, // DEFAULT 30s
};

function sanitizePlayer(raw) {
  return { id: String(raw.id || ''), name: String(raw.name || 'sconosciuto') };
}
function broadcastAdmin() {
  io.emit('admin:update', { adminId: lobby.adminId });
}

io.on('connection', (socket) => {
  // Sync orario immediato
  socket.emit('time:pong', { serverNow: Date.now() });

  socket.emit('settings:update', lobby.settings);
  socket.emit('lobby:update', lobby.players.map(sanitizePlayer));
  broadcastAdmin();

  // Ping/pong per offset
  socket.on('time:ping', (payload = {}) => {
    socket.emit('time:pong', { serverNow: Date.now(), echo: payload && payload.echo });
  });

  // Claim ruolo ADMIN tramite bottone
  socket.on('admin:claim', () => {
    if (lobby.adminId && lobby.adminId !== socket.id) {
      socket.emit('admin:deny', { reason: 'Admin già assegnato' });
      return;
    }
    lobby.adminId = socket.id;
    broadcastAdmin();
  });

  // Partecipante entra in lobby con nome squadra
  socket.on('lobby:join', (payload = {}) => {
    const name = payload.name ? String(payload.name) : `Squadra-${socket.id.slice(0, 4)}`;
    lobby.players = lobby.players.filter((p) => p.id !== socket.id);
    lobby.players.push({ id: socket.id, name });
    io.emit('lobby:update', lobby.players.map(sanitizePlayer));
    io.emit('settings:update', lobby.settings);
    broadcastAdmin();
  });

  socket.on('lobby:leave', () => {
    lobby.players = lobby.players.filter((p) => p.id !== socket.id);
    if (lobby.adminId === socket.id) {
      lobby.adminId = null; // ruolo liberato
    }
    io.emit('lobby:update', lobby.players.map(sanitizePlayer));
    io.emit('settings:update', lobby.settings);
    broadcastAdmin();
  });

  // Solo ADMIN può cambiare il countdown
  socket.on('settings:set', (newSettings = {}) => {
    if (socket.id !== lobby.adminId) return;
    const duration = Number.isFinite(Number(newSettings.duration))
      ? Math.max(1, Number(newSettings.duration))
      : lobby.settings.duration;
    lobby.settings.duration = duration;
    io.emit('settings:update', lobby.settings);
  });

  // Solo ADMIN può chiamare il giocatore
  socket.on('auction:call', (payload = {}) => {
    if (socket.id !== lobby.adminId) return;
    if (lobby.inAuction) return; // già in corso

    const playerName = payload.playerName ? String(payload.playerName) : 'Giocatore sconosciuto';
    const duration = Number.isFinite(Number(payload.duration))
      ? Math.max(1, Number(payload.duration))
      : Number(lobby.settings.duration || 30);

    const now = Date.now();
    const endsAt = now + duration * 1000; // server-autoritative

    lobby.inAuction = {
      playerName,
      callerId: socket.id,
      duration,
      endsAt,
      bids: {},
      tickTimer: null,
    };

    io.emit('auction:start', { playerName, duration, endsAt, serverNow: now });

    // Tick server-autoritative per sincronizzare tutti (ogni 500ms)
    lobby.inAuction.tickTimer = setInterval(() => {
      if (!lobby.inAuction) return;
      io.emit('auction:sync', { serverNow: Date.now(), endsAt: lobby.inAuction.endsAt });
    }, 500);

    const durationMs = endsAt - Date.now();
    setTimeout(() => {
      const auction = lobby.inAuction;
      if (!auction) return;

      const offers = Object.entries(auction.bids)
        .map(([socketId, amount]) => {
          const player = lobby.players.find((p) => p.id === socketId);
          return {
            socketId: String(socketId),
            name: player ? String(player.name) : 'sconosciuto',
            amount: Number(amount) || 0,
          };
        })
        .sort((a, b) => b.amount - a.amount);

      const winner = offers.length ? offers[0] : null;

      io.emit('auction:end', {
        playerName: String(auction.playerName),
        offers,
        winner: winner
          ? { socketId: winner.socketId, name: winner.name, amount: winner.amount }
          : null,
      });

      if (lobby.inAuction && lobby.inAuction.tickTimer) clearInterval(lobby.inAuction.tickTimer);
      lobby.inAuction = null;
    }, Math.max(0, durationMs) + 250);
  });

  // Offerte (vietato all'admin)
  socket.on('auction:bid', (payload = {}) => {
    if (!lobby.inAuction) return;
    if (socket.id === lobby.adminId) return; // admin non può offrire
    const numeric = Number.isFinite(Number(payload.amount)) ? Number(payload.amount) : NaN;
    if (isNaN(numeric) || numeric < 0) return;
    lobby.inAuction.bids[socket.id] = numeric;
    socket.emit('auction:bid:ack', { amount: numeric });
    // Notifica a tutti chi ha offerto (senza importo)
    io.emit('auction:bid:mark', { socketId: socket.id });
  });

  socket.on('disconnect', () => {
    lobby.players = lobby.players.filter((p) => p.id !== socket.id);
    if (lobby.adminId === socket.id) lobby.adminId = null;
    io.emit('lobby:update', lobby.players.map(sanitizePlayer));
    io.emit('settings:update', lobby.settings);
    broadcastAdmin();
  });
});

app.get('/', (req, res) => res.send('Fantacalcio Asta - Server attivo'));
server.listen(PORT, () => console.log('Server listening on', PORT));
