const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { sql } = require("../utils/db");
const { uploadToBlob, getBlobStream, deleteBlob } = require("../utils/blob");
const upload = require("../middleware/drive");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// Lister contenu
router.get("/", verifyToken, async (req, res) => {
  const parentId = req.query.parentId || null;

  try {
    const pool = await sql.connect();
    // Gestion du NULL pour parentId dans la requête SQL
    let query = "SELECT * FROM Items WHERE ";
    query += req.user ? "userId = @uid AND " : "";
    query += parentId ? "parentId = @pid" : "parentId IS NULL";

    console.log(query);

    const reqSql = pool.request();
    if (req.user) reqSql.input("uid", sql.NVarChar, req.user.id);
    if (parentId) reqSql.input("pid", sql.NVarChar, parentId);

    const result = await reqSql.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

// Créer dossier (Métadonnée SQL uniquement)
router.post("/folders", verifyToken, async (req, res) => {
  const { name, parentId } = req.body;
  const id = uuidv4();

  try {
    const pool = await sql.connect();
    await pool
      .request()
      .input("id", sql.NVarChar, id)
      .input("uid", sql.NVarChar, req.user.id)
      .input("type", sql.NVarChar, "folder")
      .input("name", sql.NVarChar, name)
      .input("pid", sql.NVarChar, parentId || null).query(`INSERT INTO Items (id, userId, type, name, parentId) 
                    VALUES (@id, @uid, @type, @name, @pid)`);

    res.status(201).json({ id, name, type: "folder" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

// // Upload fichier (Blob + SQL)
router.post("/files", verifyToken, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "aucun fichier" });

  const id = uuidv4();
  const blobName = `${id}-${req.file.originalname}`; // Nom unique pour le blob

  try {
    // 1. Upload vers Azure Blob Storage
    await uploadToBlob(req.file.buffer, blobName);

    // 2. Sauvegarde métadonnées dans Azure SQL
    const pool = await sql.connect();
    await pool
      .request()
      .input("id", sql.NVarChar, id)
      .input("uid", sql.NVarChar, req.user.id)
      .input("type", sql.NVarChar, "file")
      .input("name", sql.NVarChar, req.file.originalname)
      .input("size", sql.BigInt, req.file.size)
      .input("mime", sql.NVarChar, req.file.mimetype)
      .input("pid", sql.NVarChar, req.body.parentId || null)
      .input("blob", sql.NVarChar, blobName)
      .query(`INSERT INTO Items (id, userId, type, name, size, mimetype, parentId, blobName)
                    VALUES (@id, @uid, @type, @name, @size, @mime, @pid, @blob)`);

    res.status(201).json({ id, name: req.file.originalname, type: "file" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

// // Téléchargement fichier (Stream depuis Blob)
router.get("/files/:id/content", verifyToken, async (req, res) => {
  try {
    const pool = await sql.connect();
    const result = await pool
      .request()
      .input("id", sql.NVarChar, req.params.id)
      .input("uid", sql.NVarChar, req.user.id)
      .query("SELECT * FROM Items WHERE id = @id AND userId = @uid");

    const item = result.recordset[0];
    if (!item || item.type !== "file") return res.status(404).json({ error: "Fichier introuvable" });

    // Récupération du stream Azure Blob
    const blobStream = await getBlobStream(`${item.id}-${item.name}`);

    res.setHeader("Content-Disposition", `attachment; filename="${item.name}"`);
    res.setHeader("Content-Type", item.mimetype);
    blobStream.pipe(res);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

// // Suppression (SQL + Blob)
router.delete("/items/:id", verifyToken, async (req, res) => {
  try {
    const pool = await sql.connect();

    // Récupérer l'item pour savoir si c'est un fichier avec un blob
    const result = await pool
      .request()
      .input("id", sql.NVarChar, req.params.id)
      .input("uid", sql.NVarChar, req.user.id)
      .query("SELECT * FROM Items WHERE id = @id AND userId = @uid");

    const item = result.recordset[0];
    if (!item) return res.status(404).json({ error: "Introuvable" });

    // Suppression SQL
    await pool.request().input("id", sql.NVarChar, req.params.id).query("DELETE FROM Items WHERE id = @id");

    // Suppression Blob si nécessaire (asynchrone, on n'attend pas forcément)
    if (item.type === "file" && item.blobName) {
      deleteBlob(item.blobName).catch(console.error);
    }

    res.status(204).send();
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

  router.get("/health", (req, res) => {
    res.status(200).json({ status: "OK" }).send();
  });

module.exports = router;
