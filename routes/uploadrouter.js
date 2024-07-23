const express = require("express");
const db = require("../config/dbconnect");
const UploadRouter = express.Router();
const xlsx = require("xlsx");
const multer = require("multer");

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname)); 
    }
});

const upload = multer({ storage });

UploadRouter.post('/api/mcrupload', upload.single('file'), (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).send('No file uploaded');
    }
  
    const workbook = xlsx.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);
    console.log(data);

    data.forEach(row => {
      const { month, bmnumber, wstatus, company, pd, pbu, taskid, rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks } = row; 
      const query = 'INSERT INTO pmodb.mcrbilling (month, bmnumber, wstatus, company, pd, pbu, taskid, rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
      db.query(query, [month, bmnumber, wstatus, company, pd, pbu, taskid, rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks], (err, result) => {
        if (err) throw err;
      });
    });
  
    res.send('File uploaded and data stored in database');
});


module.exports = UploadRouter;