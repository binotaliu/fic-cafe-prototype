// Import necessary modules
import { WebSocketServer } from "https://deno.land/x/websocket@v0.1.4/mod.ts";
import { DB } from "https://deno.land/x/sqlite/mod.ts";
import * as UserService from './services/userService.js';
import * as OrderService from './services/orderService.js';

const PORT = 8000;
const wss = new WebSocketServer(8080);
const db = new DB("cafe.db");

// Initialize the database
db.query(`
  CREATE TABLE IF NOT EXISTS users (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   username TEXT,
   balance INTEGER,
   client_id TEXT,
   last_earned INTEGER
  )
`);
db.query(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    item_key TEXT,
    price INTEGER,
    delivered_at INTEGER,
    status TEXT,
    capacity INTEGER
  )
`);
db.query(`
  CREATE TABLE IF NOT EXISTS seats (
    id TEXT PRIMARY KEY,
    occupied INTEGER,
    time INTEGER,
    user_id INTEGER
  )
`);

// Load seats from the database
function loadSeatsFromDB() {
  const rows = db.query("SELECT id, occupied, time, user_id FROM seats");
  const loadedSeats = Object.fromEntries(
    rows.map(([id, occupied, time, user_id]) => [
      id,
      {
        id,
        occupied: !!occupied,
        time,
        user: user_id ? { id: user_id, name: UserService.getUserById(db, user_id).username } : { id: null, name: null }
      },
    ])
  );
  return loadedSeats;
}

let seats = loadSeatsFromDB();

// If no seats are loaded (e.g., first run), initialize them
db.query(`
  INSERT OR IGNORE INTO seats (id, occupied, time, user_id) VALUES 
  ('A1', 0, NULL, NULL),
  ('A2', 0, NULL, NULL),
  ('A3', 0, NULL, NULL),
  ('A4', 0, NULL, NULL),
  ('B1', 0, NULL, NULL),
  ('B2', 0, NULL, NULL),
  ('B3', 0, NULL, NULL),
  ('B4', 0, NULL, NULL),
  ('C1', 0, NULL, NULL),
  ('C2', 0, NULL, NULL),
  ('C3', 0, NULL, NULL),
  ('C4', 0, NULL, NULL),
  ('D1', 0, NULL, NULL),
  ('D2', 0, NULL, NULL),
  ('D3', 0, NULL, NULL),
  ('D4', 0, NULL, NULL)
`);

let menuItems = {
  WATER: { id: 'WATER', name: '水', price: 0, preparationTime: 1000, capacity: 5 },
  BLACK_COFFEE: { id: 'BLACK_COFFEE', name: '咖啡', price: 100, preparationTime: 3000, capacity: 10 },
  BLACK_TEA: { id: 'BLACK_TEA', name: '紅茶', price: 80, preparationTime: 2000, capacity: 8 },
};

// Modernized WebSocket connection management using a Map to track clients
const clients = new Map();

wss.on("connection", (ws) => {
  let clientId = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "client.connect") {
        clientId = data.clientId;
        if (clients.has(clientId)) {
          clients.delete(clientId); // 清除之前的連線
        }
        clients.set(clientId, ws);
        console.debug(`Client reconnected: ${clientId}`);

        // 發送更新信息給重新連線的用戶
        ws.send(JSON.stringify({ type: "seats.updated", seats }));
        ws.send(JSON.stringify({ type: "menu.updated", menuItems }));

        // 如果用戶已經有選擇座位，恢復座位狀態和餘額信息
        const userId = findUserIdByClientId(clientId);
        if (userId) {
          notifyUserOrders(clientId);
          const user = UserService.getUserById(db, userId);
          pm(clientId, { type: "balance.updated", balance: user.balance });
        }
      } else {
        handleWebSocketMessage(data, clientId);
      }

    } catch (e) {
      console.error(`Invalid message received: ${message}`);
    }
  });

  ws.on("close", () => {
    if (clientId) {
      handleClientDisconnection(clientId);
    }
    console.debug(`Client disconnected`);
  });
});

// WebSocket message router
function handleWebSocketMessage(data, clientId) {
  const routes = {
    'seats.choose': handleChooseSeat,
    'seats.leave': handleLeaveSeat,
    'menu.order': handleOrderItem,
    'items.drink': handleDrinkItem
  };

  console.debug(`[${clientId}][${data.type}] `, data);
  const handler = routes[data.type];
  if (handler) {
    try {
      handler(data, clientId);
    } catch (e) {
      console.error(`Error handling message: ${data.type}`);
      console.error(e);
    }
  } else {
    console.error(`Unknown message type: ${data.type}`);
  }
}

function handleChooseSeat(data, clientId) {
  const seat = seats[data.seatId];
  if (!seat || seat.occupied) {
    console.log(`Seat ${data.seatId} is already occupied`);
    return;
  }

  if (!/^[a-zA-Z0-9]{3,30}$/.test(data.username)) {
    console.log(`Invalid username: ${data.username}`);
    return;
  }

  // Free the previous seat if the user already has one
  Object.keys(seats)
    .filter(id => seats[id].user.id === findUserIdByClientId(clientId))
    .forEach(id => {
      db.query("UPDATE seats SET occupied = 0, time = NULL, user_id = NULL WHERE id = ?", [id]);
      console.debug(`Seat freed: ${id} by user: ${data.username}`);
    });

  seats = loadSeatsFromDB()

  seat.occupied = true;
  seat.time = Date.now();
  let user = UserService.getUserByUsername(db, data.username);
  if (!user) {
    const currentTime = Date.now();
    UserService.createUser(db, data.username, clientId, currentTime);
    user = UserService.getUserByUsername(db, data.username);
  }

  UserService.updateUserClientId(db, user.id, clientId);

  seat.user = { id: user.id, name: user.username };
  console.debug(`Seat chosen: ${data.seatId} by user: ${data.username}`);

  seats[data.seatId] = seat;
  db.query("UPDATE seats SET occupied = 1, time = ?, user_id = ? WHERE id = ?", [seat.time, user.id, data.seatId]);
  broadcast({ type: 'seats.updated', seats });

  // also broadcast the orders to the user
  notifyUserOrders(clientId);

  // also broadcast the balance to the user
  pm(clientId, { type: "balance.updated", balance: user.balance });
}

function handleLeaveSeat(data, clientId) {
  const userId = findUserIdByClientId(clientId);
  if (!userId) {
    console.debug(`No user found for client: ${clientId}`);
    return;
  }

  const seatId = Object.keys(seats).find(id => seats[id].user.id === userId);
  if (seatId) {
    db.query("UPDATE seats SET occupied = 0, time = NULL, user_id = NULL WHERE id = ?", [seatId]);
    console.debug(`Seat left: ${seatId} by user: ${userId}`);
    seats = loadSeatsFromDB();
    broadcast({ type: 'seats.updated', seats });
  }
}

function notifyUserOrders(clientId) {
  const userOrders = OrderService.getOrdersByClientId(db, clientId);

  const orders = userOrders.map(order => ({
    id: order.id,
    itemKey: order.item_key,
    price: order.price,
    status: order.status,
    capacity: order.capacity
  }));

  pm(clientId, { type: "orders.updated", orders });
}

function findUserIdByClientId(clientId) {
  const user = UserService.getUserByClientId(db, clientId);
  return user ? user.id : null;
}

function handleOrderItem(data, clientId) {
  console.log(data);
  const menuItem = menuItems[data.itemKey];

  if (!menuItem) {
    console.warn(`Invalid menu item: ${data.itemKey}`);
    return;
  }

  const userId = findUserIdByClientId(clientId);
  console.debug(`Order received: ${menuItem.name} by user: ${userId}`);

  // check if user has enough balance
  const user = UserService.getUserById(db, userId);
  if (user.balance < menuItem.price) {
    console.debug(`Insufficient balance for user: ${userId}`);
    return;
  }

  UserService.updateUserBalance(db, userId, -menuItem.price, Date.now());

  broadcast({ type: 'balance.updated', userId, balance: user.balance - menuItem.price });

  const randomDelay = Math.floor(Math.random() * 2000);
  const estimatedTime = menuItem.preparationTime + randomDelay;
  const deliveredAt = Date.now() + estimatedTime;

  OrderService.createOrder(db, userId, data.itemKey, menuItem.price, deliveredAt, menuItem.capacity);

  notifyUserOrders(clientId);
}

function handleDrinkItem(data, clientId) {
  const order = OrderService.getOrderById(db, data.orderId);
  if (!order) {
    return;
  }

  let capacity = order.capacity - 1;
  if (capacity <= 0) {
    OrderService.deleteOrder(db, data.orderId);
    console.debug(`Order removed: ${data.orderId} for user: ${clientId}`);
  } else {
    OrderService.updateOrderCapacity(db, data.orderId, capacity);
    console.debug(`Order updated: ${data.orderId} for user: ${clientId}`);
  }

  notifyUserOrders(clientId);
}

// Function to broadcast messages to all connected clients
function broadcast(message) {
  for (const [clientId, client] of clients.entries()) {
    if (client.state === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}

function pm(clientId, message) {
  const client = clients.get(clientId);
  if (client && client.state === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
}

function handleClientDisconnection(clientId) {
  OrderService.deleteOrdersByClientId(db, clientId);
  handleLeaveSeat({ clientId }, clientId);
}

// Function to add balance to users every 20 minutes based on individual timers
setInterval(() => {
  const currentHour = new Date().getHours();
  if (currentHour >= 7 && currentHour < 19) { // Only operate between 7:00 and 19:00
    Object.values(seats).forEach(seat => {
      if (seat.occupied) {
        const userId = seat.user.id;
        const user = UserService.getUserById(db, userId);
        const lastEarned = user.last_earned;
        const currentTime = Date.now();

        if (currentTime - lastEarned >= 20 * 60 * 1000) { // 20 minutes have passed since last reward
          UserService.updateUserBalance(db, userId, 50, currentTime);
          console.debug(`Balance updated for user: ${userId} by 50`);

          pm(user.client_id, { type: "balance.updated", balance: user.balance + 50 });
        }
      }
    });
  }
}, 60 * 1000); // Check every minute

// handle pending items. convert them to delivered and notify the user
setInterval(() => {
  const currentTime = Date.now();
  const pendingOrders = OrderService.getPendingOrders(db, currentTime);

  pendingOrders.forEach(order => {
    const clientId = order.client_id;
    const orderId = order.id;
    OrderService.updateOrderStatusToDelivered(db, orderId);
    console.debug(`Order delivered: ${orderId} for client: ${clientId}`);

    if (clientId) {
      notifyUserOrders(clientId);
    }
  });
}, 1000);

// Read HTML content from an external file
const WSS_URL = Deno.env.WSS_URL || "ws://localhost:8080";
const htmlContent = (await Deno.readTextFile("./index.html"))
  .replace(/<WSS_URL_PLACEHOLDER>/g, WSS_URL);

// Request handler
const handler = (request) => {
  return new Response(htmlContent, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
};

// Start server
console.log(`Server running on http://localhost:${PORT}`);
Deno.serve(handler, { port: PORT });
