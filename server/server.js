// server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3001;

// Stato in-memory (semplice prototipo)
let lobby = {
  players: [], // {id, name, budget}
  adminId: null, // socket id of admin (first who joined)
  inAuction: null, // {playerName, callerId, duration, endsAt, bids: {socketId: amount}}
  settings: { duration: 30 },
};

function sanitizePlayer(raw) {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'sconosciuto'),
    budget: Number.isFinite(Number(raw.budget)) ? Number(raw.budget) : 100,
  };
}

io.on('connection', (socket) => {
  console.log('connessione:', socket.id);

  // send back lobby/settings info on connect
  socket.emit('settings:update', lobby.settings);
  socket.emit('lobby:update', lobby.players);

  socket.on('lobby:join', (payload) => {
    try {
      const name = payload && payload.name ? String(payload.name) : `Giocatore-${socket.id.slice(0,4)}`;
      const budget = payload && Number.isFinite(Number(payload.budget)) ? Number(payload.budget) : 100;

      // Remove any existing entry for this socket id (re-join)
      lobby.players = lobby.players.filter(p => p.id !== socket.id);
      const player = { id: socket.id, name, budget };
      lobby.players.push(player);

      // Set admin if missing
      if (!lobby.adminId) {
        lobby.adminId = socket.id;
      }

      // Broadcast sanitized players and settings
      io.emit('lobby:update', lobby.players.map(sanitizePlayer));
      io.emit('settings:update', lobby.settings);

    } catch (err) {
      console.error('lobby:join error', err);
    }
  });

  socket.on('lobby:leave', () => {
    lobby.players = lobby.players.filter(p => p.id !== socket.id);
    // reassign admin if needed
    if (lobby.adminId === socket.id) {
      lobby.adminId = lobby.players.length ? lobby.players[0].id : null;
      io.emit('settings:update', lobby.settings);
    }
    io.emit('lobby:update', lobby.players.map(sanitizePlayer));
  });

  socket.on('settings:set', (newSettings) => {
    // Only admin can change
    if (socket.id !== lobby.adminId) return;
    const duration = newSettings && Number.isFinite(Number(newSettings.duration)) ? Math.max(1, Number(newSettings.duration)) : lobby.settings.duration;
    lobby.settings.duration = duration;
    io.emit('settings:update', lobby.settings);
  });

  socket.on('auction:call', (payload) => {
    try {
      // Don't start if there's already an auction
      if (lobby.inAuction) return;
      const playerName = payload && payload.playerName ? String(payload.playerName) : 'Giocatore sconosciuto';
      const duration = payload && Number.isFinite(Number(payload.duration)) ? Math.max(1, Number(payload.duration)) : Number(lobby.settings.duration || 30);

      const now = Date.now();
      const endsAt = now + duration * 1000;

      lobby.inAuction = {
        playerName,
        callerId: socket.id,
        duration,
        endsAt,
        bids: {},
      };

      // Emit sanitized start event
      io.emit('auction:start', {
        playerName: String(lobby.inAuction.playerName),
        duration: Number(lobby.inAuction.duration),
        endsAt: Number(lobby.inAuction.endsAt),
      });

      // Use a snapshot of endsAt to schedule the end
      const durationMs = endsAt - Date.now();
      setTimeout(() => {
        const auction = lobby.inAuction;
        if (!auction) return; // maybe cancelled

        const offers = Object.entries(auction.bids).map(([socketId, amount]) => {
          const player = lobby.players.find(p => p.id === socketId);
          return {
            socketId: String(socketId),
            name: player ? String(player.name) : 'sconosciuto',
            amount: Number(amount) || 0,
          };
        }).sort((a,b) => b.amount - a.amount);

        const winner = offers.length ? offers[0] : null;
        if (winner) {
          const p = lobby.players.find(pp => pp.id === winner.socketId);
          if (p) p.budget = Math.max(0, Number(p.budget) - Number(winner.amount));
        }

        // Send sanitized result
        io.emit('auction:end', {
          playerName: String(auction.playerName),
          offers,
          winner: winner ? { socketId: winner.socketId, name: winner.name, amount: winner.amount } : null,
          updatedPlayers: lobby.players.map(sanitizePlayer),
        });

        // clean auction state
        lobby.inAuction = null;

      }, Math.max(0, durationMs) + 250);

    } catch (err) {
      console.error('auction:call error', err);
    }
  });

  socket.on('auction:bid', (payload) => {
    try {
      if (!lobby.inAuction) return;
      const player = lobby.players.find(p => p.id === socket.id);
      if (!player) return;
      const numeric = payload && Number.isFinite(Number(payload.amount)) ? Number(payload.amount) : NaN;
      if (isNaN(numeric) || numeric < 0) return;
      if (numeric > player.budget) return; // can't bid more than budget

      // store bid
      lobby.inAuction.bids[socket.id] = numeric;
      socket.emit('auction:bid:ack', { amount: numeric });
    } catch (err) {
      console.error('auction:bid error', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('disconnesso', socket.id);
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
