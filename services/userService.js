// User Service Module

export function getUserByUsername(db, username) {
  const user = db.query("SELECT * FROM users WHERE username = ?", [username]);
  return user.length > 0 ? mapUser(user[0]) : null;
}

export function getUserByClientId(db, clientId) {
  const user = db.query("SELECT * FROM users WHERE client_id = ?", [clientId]);
  return user.length > 0 ? mapUser(user[0]) : null;
}

export function getUserById(db, userId) {
  const user = db.query("SELECT * FROM users WHERE id = ?", [userId]);
  return user.length > 0 ? mapUser(user[0]) : null;
}

export function createUser(db, username, clientId, lastEarned) {
  db.query("INSERT INTO users (username, balance, client_id, last_earned) VALUES (?, ?, ?, ?)", [username, 0, clientId, lastEarned]);
}

export function updateUserClientId(db, userId, clientId) {
  db.query("UPDATE users SET client_id = ? WHERE id = ?", [clientId, userId]);
}

export function updateUserBalance(db, userId, amount, lastEarned) {
  db.query("UPDATE users SET balance = balance + ?, last_earned = ? WHERE id = ?", [amount, lastEarned, userId]);
}

function mapUser(row) {
  return {
    id: row[0],
    username: row[1],
    balance: row[2],
    client_id: row[3],
    last_earned: row[4]
  };
}
