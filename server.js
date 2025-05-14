require('dotenv').config();

const express = require('express');
const mysql = require('mysql2');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Prüfe, ob .env geladen wurde
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASS:', process.env.DB_PASS);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('TOKEN_SECRET:', process.env.TOKEN_SECRET ? 'gesetzt' : 'nicht gesetzt');

const app = express();
const port = process.env.PORT || 3000;
const TOKEN_SECRET = process.env.TOKEN_SECRET;

// JSON-Validator konfigurieren
const ajv = new Ajv();
addFormats(ajv);

// Datenbank-Verbindung einrichten
const db = mysql.createPool({
  host: process.env.DB_HOST || '10.115.2.17',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '12345678',
  database: process.env.DB_NAME || 'sigma',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Verbindungstest
db.getConnection((err, conn) => {
  if (err) {
    console.error('Verbindungsfehler:', err);
  } else {
    console.log('DB-Verbindung OK');
    conn.release();
  }
});

app.use(express.json());

// Rate-Limiter für Login
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 5,             // max. 5 Versuche pro Minute
  message: { message: 'Zu viele Login-Versuche – bitte später erneut versuchen' }
});

// JWT-Hilfsfunktionen
function generateAccessToken(payload) {
  return jwt.sign(payload, TOKEN_SECRET, { expiresIn: '1800s' });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Kein Token gefunden', status: 401 });
  jwt.verify(token, TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Ungültiger Token', status: 403 });
    req.user = user;
    next();
  });
}

// Schema und Validator für Person
const personSchema = {
  type: 'object',
  properties: {
    vorname: { type: 'string' },
    nachname: { type: 'string' },
    email: { type: 'string', format: 'email' }
  },
  required: ['vorname', 'nachname', 'email'],
  additionalProperties: false
};
const validatePerson = ajv.compile(personSchema);

// ---- User-Routen ----
// Registrierung
app.post('/user/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username und Password sind erforderlich.' });
  }
  const sql = 'INSERT INTO user (username, password) VALUES (?, ?)';
  db.query(sql, [username, password], (err, result) => {
    if (err) {
      console.error('Registrierung-DB-Fehler:', err);
      return res.status(500).json({ message: 'Datenbankfehler bei Registrierung.' });
    }
    res.status(201).json({ message: 'Benutzer registriert', id: result.insertId });
  });
});

// Login
app.post('/user/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username und Password sind erforderlich.' });
  }
  const sql = 'SELECT id, username FROM user WHERE username = ? AND password = ?';
  db.query(sql, [username, password], (err, results) => {
    if (err) {
      console.error('Login-DB-Fehler:', err);
      return res.status(500).json({ message: 'Datenbankfehler beim Login.' });
    }
    if (results.length === 0) {
      return res.status(401).json({ message: 'Falsche Anmeldedaten.' });
    }
    const user = { id: results[0].id, username: results[0].username };
    const token = generateAccessToken(user);
    res.status(200).json({ message: 'Erfolgreich eingeloggt', token });
  });
});

// ---- CRUD für Person (geschützt) ----
// Create
app.post('/person', authenticateToken, (req, res) => {
  const valid = validatePerson(req.body);
  if (!valid) return res.status(400).json({ errors: validatePerson.errors });
  const { vorname, nachname, email } = req.body;
  const sql = 'INSERT INTO person (vorname, nachname, email) VALUES (?, ?, ?)';
  db.query(sql, [vorname, nachname, email], (err, result) => {
    if (err) {
      console.error('Person-DB-Fehler:', err);
      return res.status(500).json({ message: 'Fehler beim Speichern der Person.' });
    }
    res.status(201).json({ message: 'Person hinzugefügt', id: result.insertId });
  });
});

// Read all
app.get('/person', authenticateToken, (req, res) => {
  db.query('SELECT * FROM person', (err, results) => {
    if (err) return res.status(500).json({ message: 'Fehler beim Abrufen der Personen.' });
    res.status(200).json(results);
  });
});

// Read one
app.get('/person/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('SELECT * FROM person WHERE id = ?', [id], (err, results) => {
    if (err) return res.status(500).json({ message: 'Fehler beim Abrufen der Person.' });
    if (results.length === 0) return res.status(404).json({ message: 'Person nicht gefunden.' });
    res.status(200).json(results[0]);
  });
});

// Update
app.put('/person/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const valid = validatePerson(req.body);
  if (!valid) return res.status(400).json({ errors: validatePerson.errors });
  const { vorname, nachname, email } = req.body;
  const sql = 'UPDATE person SET vorname = ?, nachname = ?, email = ? WHERE id = ?';
  db.query(sql, [vorname, nachname, email, id], (err, result) => {
    if (err) return res.status(500).json({ message: 'Fehler beim Aktualisieren der Person.' });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Person nicht gefunden.' });
    res.status(200).json({ message: 'Person aktualisiert', id });
  });
});

// Delete
app.delete('/person/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM person WHERE id = ?', [id], (err, result) => {
    if (err) return res.status(500).json({ message: 'Fehler beim Löschen der Person.' });
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Person nicht gefunden.' });
    res.status(200).json({ message: 'Person gelöscht' });
  });
});

// Health-Check
app.get('/health', (req, res) => res.send('OK'));

// Server starten
app.listen(port, () => console.log(`Server läuft unter http://localhost:${port}`));
