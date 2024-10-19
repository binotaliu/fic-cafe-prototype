// Order Service Module

export function getOrdersByClientId(db, clientId) {
  const orders = db.query("SELECT * FROM orders WHERE user_id = (SELECT id FROM users WHERE client_id = ?)", [clientId]);
  return orders.map(mapOrder);
}

export function getOrderById(db, orderId) {
  const order = db.query("SELECT * FROM orders WHERE id = ?", [orderId]);
  return order.length > 0 ? mapOrder(order[0]) : null;
}

export function createOrder(db, userId, itemKey, price, deliveredAt, capacity) {
  db.query("INSERT INTO orders (user_id, item_key, price, delivered_at, status, capacity) VALUES (?, ?, ?, ?, ?, ?)", [
    userId,
    itemKey,
    price,
    deliveredAt,
    'pending',
    capacity
  ]);
}

export function updateOrderCapacity(db, orderId, capacity) {
  db.query("UPDATE orders SET capacity = ? WHERE id = ?", [capacity, orderId]);
}

export function deleteOrder(db, orderId) {
  db.query("DELETE FROM orders WHERE id = ?", [orderId]);
}

export function deleteOrdersByClientId(db, clientId) {
  db.query("DELETE FROM orders WHERE user_id = (SELECT id FROM users WHERE client_id = ?)", [clientId]);
}

export function updateOrderStatusToDelivered(db, orderId) {
  db.query("UPDATE orders SET status = 'delivered' WHERE id = ?", [orderId]);
}

export function getPendingOrders(db, currentTime) {
  const orders = db.query("SELECT orders.id, users.client_id FROM orders JOIN users ON users.id = orders.user_id WHERE status = 'pending' AND delivered_at <= ?", [currentTime]);
  return orders.map(order => ({ id: order[0], client_id: order[1] }));
}

function mapOrder(row) {
  return {
    id: row[0],
    user_id: row[1],
    item_key: row[2],
    price: row[3],
    delivered_at: row[4],
    status: row[5],
    capacity: row[6]
  };
}
