require('dotenv').config();
const express = require("express");
const mysql = require("mysql2/promise"); // Promise-basierte Version
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const app = express();
const port = process.env.PORT || 3000;

// AJV-Konfiguration
const ajv = new Ajv();
addFormats(ajv);

// Database Pool mit Environment Variables
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Middleware für JSON-Parsing mit Fehlerbehandlung
app.use((req, res, next) => {
  express.json()(req, res, err => {
    if (err) {
      return res.status(400).json({
        error: "Invalid JSON format",
        details: err.message
      });
    }
    next();
  });
});

// Routes mit async/await
app.get('/hello', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: "Name parameter missing" });

    await db.query(
      "INSERT INTO greetings (name, source) VALUES (?, ?)",
      [name, "query"]
    );
    
    res.json({ message: `hallo mein query ist: ${name}` });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Database operation failed" });
  }
});

app.get('/hello/:name', async (req, res) => {
  try {
    const name = req.params.name;
    
    await db.query(
      "INSERT INTO greetings (name, source) VALUES (?, ?)",
      [name, "param"]
    );
    
    res.json({ message: `hallo mein Name ist auch ${name}` });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Database operation failed" });
  }
});

app.post('/hello/body', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name field required" });

    await db.query(
      "INSERT INTO greetings (name, source) VALUES (?, ?)",
      [name, "body"]
    );
    
    res.json({ message: "Name gespeichert", name });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Database operation failed" });
  }
});

// Person Schema Validation
const personSchema = {
  type: "object",
  properties: {
    vorname: { type: "string" },
    nachname: { type: "string" },
    plz: { type: ["string", "null"] },
    strasse: { type: ["string", "null"] },
    ort: { type: ["string", "null"] },
    telefonnummer: { type: ["string", "null"] },
    email: { type: "string", format: "email" },
  },
  required: ["vorname", "nachname", "email"],
  additionalProperties: false,
};

const validatePerson = ajv.compile(personSchema);

// Personen-Routen mit async/await
app.post('/person', async (req, res) => {
  try {
    if (!validatePerson(req.body)) {
      return res.status(400).json({
        error: "Validation failed",
        details: validatePerson.errors
      });
    }

    const { vorname, nachname, plz, strasse, ort, telefonnummer, email } = req.body;
    
    const [result] = await db.query(
      `INSERT INTO personen 
      (vorname, nachname, plz, strasse, ort, telefonnummer, email)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [vorname, nachname, plz, strasse, ort, telefonnummer, email]
    );

    res.status(201).json({
      message: "Person angelegt",
      id: result.insertId
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Person creation failed" });
  }
});

app.get('/person', async (req, res) => {
  try {
    const [results] = await db.query("SELECT * FROM personen");
    res.json(results);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Could not fetch persons" });
  }
});

app.get('/person/:id', async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT * FROM personen WHERE id = ?",
      [req.params.id]
    );
    
    if (results.length === 0) {
      return res.status(404).json({ error: "Person not found" });
    }
    
    res.json(results[0]);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Database operation failed" });
  }
});

app.delete('/person/:id', async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM personen WHERE id = ?",
      [req.params.id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Person not found" });
    }
    
    res.json({ message: "Person deleted successfully" });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Deletion failed" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});