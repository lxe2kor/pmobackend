const express = require("express");
const db = require("../config/dbconnect");
const dbpool = require("../config/dbpool");
const Router = express.Router();
const os = require("os");
const XLSX = require("xlsx");
const multer = require("multer");
const fs = require("fs");
const helper = require("../middlewares/helper");
const planiswaremapping = require("../middlewares/planiswaremapping");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require('dotenv').config();

const saltRound = 10;
let tokenBlacklist = [];

const verifyToken = (req, res, next) => {
  const token = req.headers['x-access-token'];
  if (token && !tokenBlacklist.includes(token)) {
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ success: false, message: 'Failed to authenticate token' });
      } else {
        req.userId = decoded.id;
        next();
      }
    });
  } else {
    return res.status(401).json({ success: false, message: 'No token provided or token is blacklisted' });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'files/');
  }
});

const upload = multer({ storage });

Router.post('/register', (req, res, next) => {
  const { username, password } = req.body;
  
  bcrypt.hash(password, saltRound, (err, hash) => {
    if (err) return next(err);
    
    db.execute(
      "INSERT INTO pmodb.adminlogin (username, password) VALUES (?,?)",
      [username, hash],
      (err, result) => {
        if (err) return next(err);
        res.status(201).json({ message: 'User registered successfully' });
      }
    );
  });
});

Router.post('/adminLogin', (req, res, next) => {
  const { username, password } = req.body;

  db.execute(
    "SELECT * FROM pmodb.adminlogin WHERE username = ?;",
    [username],
    (err, result) => {
      if (err) return next(err);
      
      if (result.length > 0) {
        bcrypt.compare(password, result[0].password, (error, response) => {
          if (error) return next(error);
          
          if (response) {
            const id = result[0].id;
            const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
            req.session.user = result;
            return res.json({ auth: true, token, result });
          } else {
            return res.status(401).json({ auth: false, message: "Wrong username/password combination!" });
          }
        });
      } else {
        return res.status(404).json({ auth: false, message: "No user exists" });
      }
    }
  );
});

Router.post('/logout', (req, res, next) => {
  const token = req.headers['x-access-token'];
  if (token) {
    tokenBlacklist.push(token);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.json({ success: true, message: 'Logged out successfully' });
    });
  } else {
    return res.status(400).json({ success: false, message: 'No token provided' });
  }
});

Router.get('/protectedRoute', verifyToken, (req, res) => {
  res.json({ success: true, message: 'Token is valid' });
});

Router.post('/userLogin', (req, res, next) => {
  const { username, pmodepartment, pmogroup } = req.body;
  
  db.query('SELECT * FROM pmodb.loginuser WHERE username = ? and pmodepartment = ? and pmogroup = ?', [username, pmodepartment, pmogroup], (err, results) => {
    if (err) return next(err);

    if (results.length > 0) {
      const user = results[0];
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.status(200).send({ auth: true, token });
    } else {
      return res.status(404).json({ auth: false, message: "No user exists" });
    }
  });
});

Router.post('/userRegister', (req, res, next) => {
  const { username, department, group } = req.query;

  db.query('INSERT INTO pmodb.loginuser (username, pmodepartment, pmogroup) VALUES (?, ?, ?)', [username, department, group], (err, results) => {
      if (err) return next(err);
      res.status(201).json({ message: 'User registered successfully' });
  });
  
});

Router.post('/mcrupload', upload.single('file'), (req, res, next) => {
  const filePath = req.file.path;
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (worksheet.length === 0) {
      return res.status(400).send('Excel file is empty');
    }

    const data = worksheet.map(row => {
      const newRow = {};
      Object.keys(row).forEach((key) => {
        const value = row[key];
        const mappedKey = helper[key];
        if (mappedKey) {
          if (typeof value === 'number' && value > 25569 && mappedKey !== 'planned_cost' && mappedKey !== 'planned_efforts') {
            const dateValue = XLSX.SSF.format('yyyy-mm-dd', value);
            newRow[mappedKey] = dateValue;
          } else {
            newRow[mappedKey] = value;
          }
        }
      });
      return newRow;
    });

    const query = 'INSERT INTO pmodb.mcrplan SET ?';
    data.forEach(row => {
      db.query(query, row, (err, result) => {
        if (err) return next(err);
      });
    });

    res.send({ message: 'File uploaded and data stored in database', success: true });
  } catch (error) {
    next(error);
  } finally {
    fs.unlinkSync(filePath);
  }
});

Router.post('/planiswareupload', upload.single('file'), (req, res, next) => {
  const filePath = req.file.path;
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (worksheet.length === 0) {
      return res.status(400).send('Excel file is empty');
    }

    const data = worksheet.map(row => {
      const newRow = {};
      Object.keys(row).forEach((key) => {
        const value = row[key];
        const mappedKey = planiswaremapping[key];
        if (mappedKey) {
          newRow[mappedKey] = value;
        }
      });
      return newRow;
    });

    const query = 'INSERT INTO pmodb.planisware SET ?';
    data.forEach(row => {
      db.query(query, row, (err, result) => {
        if (err) return next(err);
      });
    });

    res.send({ message: 'File uploaded and data stored in database', success: true });
  } catch (error) {
    next(error);
  } finally {
    fs.unlinkSync(filePath);
  }
});

Router.get('/group', (req, res, next) => {
  const query = 'SELECT DISTINCT `cgroup` from pmodb.groupandteam';
  db.query(query, (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
});

Router.get('/allTeam', (req, res, next) => {
  db.query('SELECT DISTINCT cteam FROM groupandteam', (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
});

Router.get('/team', (req, res, next) => {
  const team = req.query.group;
  const query = 'SELECT `cteam` from pmodb.groupandteam where cgroup = ?';
  db.query(query, [team], (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
});

Router.get('/verifyplanisware', (req, res, next) => {
  const { group, team, month } = req.query;
  
  const finalQuery = `
    SELECT a.employee_name, a.employee_team, m.pmo
    FROM pmodb.associates a
    left join pmodb.nonmcrbilling m
    on a.employee_id = m.empno and m.pmo_month = ?
    where m.empno is null
    union
    select employeename, cteam, pmo
    from pmodb.nonmcrbilling
    WHERE pmo >= 0 and pmo < 1.0 and cgroup = ? and cteam = ? and pmo_month = ?;`;
  
  db.query(finalQuery, [month, group, team, month], (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
});

Router.get('/notallocated', (req, res, next) => {
  const { group, team, month } = req.query;
  
  const finalQuery = `
  SELECT 
    employee_team, 
    SUM(Count) AS Count
  FROM (
      SELECT a.employee_team, COUNT(*) AS Count
      FROM pmodb.associates a
      LEFT JOIN pmodb.nonmcrbilling m
      ON a.employee_id = m.empno AND m.pmo_month = ?
      WHERE m.empno IS NULL
      GROUP BY a.employee_team
      UNION ALL
      SELECT cteam AS employee_team, COUNT(*) AS Count
      FROM pmodb.nonmcrbilling
      WHERE pmo >= 0 AND pmo < 1.0 AND cteam = ? AND pmo_month = ?
      GROUP BY cteam
  ) AS combined
  GROUP BY 
      employee_team;
  `;
  
  db.query(finalQuery, [month, group, team, month], (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
});

Router.get('/fetchallteams', (req, res, next) => {
  const { group, month } = req.query;
  
  const finalQuery = `
    SELECT a.employee_name, a.employee_team, m.pmo
    FROM pmodb.associates a
    left join pmodb.nonmcrbilling m
    on a.employee_id = m.empno and m.pmo_month = ?
    where m.empno is null
    union
    select employeename, cteam, pmo
    from pmodb.nonmcrbilling
    WHERE pmo >= 0 and pmo < 1.0 and cgroup = ? and pmo_month = ?;
  `;
  
  db.query(finalQuery, [month, group, month], (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
});

Router.get('/fetchnotallocated', (req, res, next) => {
  const { group, month } = req.query;
  
  const finalQuery = `
    SELECT 
      employee_team, 
      SUM(Count) AS Count
    FROM (
        SELECT a.employee_team, COUNT(*) AS Count
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m
        ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL
        GROUP BY a.employee_team
        UNION ALL
        SELECT cteam AS employee_team, COUNT(*) AS Count
        FROM pmodb.nonmcrbilling
        WHERE pmo >= 0 AND pmo < 1.0 AND cgroup = ? AND pmo_month = ?
        GROUP BY cteam
    ) AS combined
    GROUP BY 
        employee_team;
  `;
  
  db.query(finalQuery, [month, group, month], (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
});

Router.get('/deptAssociates', (req, res, next) => {
  const team = req.query.team;
  
  const finalQuery = `
    SELECT employee_name AS label, employee_id AS value
    FROM pmodb.associates 
    WHERE employee_team = ?`;

  db.query(finalQuery, [team], (err, results) => {
    if (err) return next(err);
    res.json(results);
  });
});


Router.post('/savebillingdata', (req, res, next) => {
  try {
    const { month, bmNumber, taskID, rgid, rgd, wStatus, pd, pbu, company, associateName, empNumber, hours, pmo, pif, billingStatus, remarks, cTeam } = req.body;

    const query = 'INSERT INTO pmodb.mcrbilling (pmo_month, bmnumber, taskid, rgid, rgd, wstatus, pd, pbu, company, associatename, empno, hours, pmo, pif, billingstatus, remarks, cteam) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    db.query(query, [month, bmNumber, taskID, rgid, rgd, wStatus, pd, pbu, company, associateName, empNumber, hours, pmo, pif, billingStatus, remarks, cTeam], (err, results) => {
      if (err) return next(err);
      res.send('Data saved successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/fetchmcrbilling', (req, res, next) => {
  try {
    const team = req.query.team;
    const query = 'SELECT * FROM pmodb.mcrbilling WHERE cteam = ?';
    db.query(query, [team], (err, results) => {
      if (err) return next(err);
      res.json(results);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/fetchmcrbilling1', (req, res, next) => {
  try {
    const team = req.query.team;
    const username = req.query.username;
    const query = 'SELECT * FROM pmodb.mcrbilling WHERE cteam = ? and username = ?';
    db.query(query, [team, username], (err, results) => {
      if (err) return next(err);
      res.json(results);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/associatehours', (req, res, next) => {
  try {
    const employee = req.query.associate;
    const mon = req.query.cMonth;

    const query = 'SELECT hours FROM pmodb.mcrbilling WHERE associatename = ? AND pmo_month = ?';
    db.query(query, [employee, mon], (err, result) => {
      if (err) return next(err);
      if (result.length > 0) {
        const hours = result[0].hours;
        if (hours < 156) {
          const remainingHrs = 156 - hours;
          res.json({ hours: remainingHrs });
        } else if (hours === 156) {
          res.json({ hours: 156 });
        }
      } else {
        res.json(null);
      }
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updatemcrbilling', (req, res, next) => {
  try {
    const { id, pmo_month, bmnumber, wstatus, company, pd, pbu, taskid, rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks } = req.body;
  
    const query = `UPDATE pmodb.mcrbilling SET pmo_month=?, bmnumber=?, wstatus=?, company=?, pd=?, pbu=?, taskid=?, rgd=?, rgid=?, associatename=?, empno=?, hours=?, pmo=?, pif=?, billingstatus=?, remarks=? WHERE id=?`;
    db.query(query, [pmo_month, bmnumber, wstatus, company, pd, pbu, taskid, rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks, id], (err, results) => {
      if (err) return next(err);
      res.send({ message: 'Data updated successfully' });
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/fetchNonMcrData', (req, res, next) => {
  try {
    const team = req.query.team;
    const query = 'SELECT * FROM pmodb.nonmcrbilling WHERE cteam = ?';
    db.query(query, [team], (err, results) => {
      if (err) return next(err);
      res.json(results);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/fetchNonMcrData1', (req, res, next) => {
  try {
    const team = req.query.team;
    const username = req.query.username;
    const query = 'SELECT * FROM pmodb.nonmcrbilling WHERE cteam = ? and username = ?';
    db.query(query, [team, username], (err, results) => {
      if (err) return next(err);
      res.json(results);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/fetchAllStatus', async (req, res, next) => {
  const selected = req.query.dataSelected;
  try {
    let query1, query2;

    if (selected === 'all') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'mcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'nonmcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    }

    const [result1, result2] = await Promise.all([
      dbpool.execute(query1),
      dbpool.execute(query2)
    ]);

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
    next(error);
  }
});

Router.get('/fetchAllButMonth', async (req, res, next) => {
  const cmonth = req.query.pmomonth;
  const selected = req.query.dataSelected;

  try {
    let query1, query2;

    if (selected === 'all') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours), m.pmo_month, 'Non-MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'mcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'nonmcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL;
      `;
    }

    const [result1, result2] = await Promise.all([
      dbpool.execute(query1, [cmonth, cmonth]),
      dbpool.execute(query2, [cmonth, cmonth])
    ]);

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
    next(error);
  }
});

Router.get('/fetchAllButTeam', async (req, res, next) => {
  const team = req.query.cteam;
  const selected = req.query.dataSelected;

  try {
    let query1, query2;

    if (selected === 'all') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing_type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.cteam = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.cteam = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'mcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.cteam = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'nonmcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.cteam = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    }

    const [result1, result2] = await Promise.all([
      dbpool.execute(query1, [team, team]),
      dbpool.execute(query2, [team, team])
    ]);

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
    next(error);
  }
});

Router.get('/fetchAllButGroup', async (req, res, next) => {
  const grp = req.query.cgroup;
  const selected = req.query.dataSelected;

  try {
    let query1, query2;

    if (selected === 'all') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'mcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'nonmcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    }

    const [result1, result2] = await Promise.all([
      dbpool.execute(query1, [grp, grp]),
      dbpool.execute(query2, [grp, grp])
    ]);

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
    next(error);
  }
});

Router.get('/fetchAllButGM', async (req, res, next) => {
  const grp = req.query.cgroup;
  const mon = req.query.pmomonth;
  const selected = req.query.dataSelected;

  try {
    let query1, query2;

    if (selected === 'all') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'mcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'nonmcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL;
      `;
    }

    const [result1, result2] = await Promise.all([
      dbpool.execute(query1, [grp, mon, grp, mon]),
      dbpool.execute(query2)
    ]);

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
    next(error);
  }
});

Router.get('/fetchAllButTM', async (req, res, next) => {
  const team = req.query.cteam;
  const mon = req.query.pmomonth;
  const selected = req.query.dataSelected;

  try {
    let query1, query2;

    if (selected === 'all') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_team = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_team = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'mcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_team = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'nonmcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_team = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL;
      `;
    }

    const [result1, result2] = await Promise.all([
      dbpool.execute(query1, [team, mon, team, mon]),
      dbpool.execute(query2)
    ]);

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
    next(error);
  }
});

Router.get('/fetchAllButGTM', async (req, res, next) => {
  const grp = req.query.cgroup;
  const team = req.query.cteam;
  const mon = req.query.pmomonth;
  const selected = req.query.dataSelected;

  try {
    let query1, query2;

    if (selected === 'all') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ? AND a.employee_team = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ? AND a.employee_team = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL
        UNION
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'mcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.mcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ? AND a.employee_team = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.mcrbilling m ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL;
      `;
    } else if (selected === 'nonmcr') {
      query1 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, SUM(m.hours) AS hours, m.pmo_month, 'Non-MCR' AS billing type
        FROM pmodb.associates a
        INNER JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno
        WHERE a.employee_dept = ? AND a.employee_team = ? AND m.pmo_month = ?
        GROUP BY a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `;
      query2 = `
        SELECT a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing type, m.pmo_month
        FROM pmodb.associates a
        LEFT JOIN pmodb.nonmcrbilling m ON a.employee_id = m.empno AND m.pmo_month = ?
        WHERE m.empno IS NULL;
      `;
    }

    const [result1, result2] = await Promise.all([
      dbpool.execute(query1, [grp, team, mon, grp, team, mon]),
      dbpool.execute(query2)
    ]);

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
    next(error);
  }
});

Router.post('/addAssociates', (req, res, next) => {
  try {
    const { associates, employee_dept, employee_team } = req.body;
    const query = 'INSERT INTO pmodb.associates (employee_name, employee_id, employee_status, employee_dept, employee_team) VALUES ?';
    const values = associates.map(associate => [associate.employee_name, associate.employee_id, associate.employee_status, employee_dept, employee_team]);

    db.query(query, [values], (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/getAssociateData', (req, res, next) => {
  try {
    const team = req.query.team;

    const query = 'SELECT * FROM pmodb.associates WHERE employee_team = ?';
    db.query(query, [team], (err, results) => {
      if (err) return next(err);
      res.json(results);
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updateAssociates/:id', (req, res, next) => {
  try {
    const { employee_name, employee_id, employee_status } = req.body;
    const { id } = req.params;

    const query = `UPDATE pmodb.associates SET employee_name = ?, employee_id = ?, employee_status = ? WHERE id=?`;

    db.query(query, [employee_name, employee_id, employee_status, id], (err, result) => {
      if (err) return next(err);
      res.send({ message: 'Data updated successfully' });
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deleteAssociates/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM pmodb.associates WHERE id = ?';

    db.query(query, [id], (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/addGroupTeam', (req, res, next) => {
  try {
    const { teamName, groupName, grm } = req.body;

    const query = 'INSERT INTO pmodb.groupandteam (cteam, cgroup, grmname) values (?, ?, ?)';

    db.query(query, [teamName, groupName, grm], (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/fetchGrmData', (req, res, next) => {
  try {
    const query = 'SELECT * FROM pmodb.grminfo';

    db.query(query, (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/saveGrmData', (req, res, next) => {
  try {
    const { grmname, grmemail, grm_dept } = req.body;

    const query = 'INSERT INTO pmodb.grminfo (grmname, grmemail, grm_dept) VALUES (?, ?, ?)';

    db.query(query, [grmname, grmemail, grm_dept], (err, result) => {
      if (err) return next(err);
      res.status(200).send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updateGrmInfo/:grmid', (req, res, next) => {
  try {
    const { grmid } = req.params;
    const { grmname, grmemail, grm_dept } = req.body;

    const query = `UPDATE pmodb.grminfo SET grmname = ?, grmemail = ?, grm_dept = ? WHERE grmid=?`;

    db.query(query, [grmname, grmemail, grm_dept, grmid], (err, result) => {
      if (err) return next(err);
      res.send({ message: 'Data updated successfully' });
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deleteGrm/:grmid', (req, res, next) => {
  try {
    const { grmid } = req.params;
    const query = 'DELETE FROM pmodb.grminfo WHERE grmid = ?';

    db.query(query, [grmid], (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/saveNonMcrData', (req, res, next) => {
  try {
    const { month, pifId, poNo, contractNo, legalCompany, custDetails, associateName, empNumber, onsite, hours, pmo, soNo, sdcStatus, soStatus, soText, remarks, cTeam } = req.body;

    const query = 'INSERT INTO pmodb.nonmcrbilling (pmo_month, pif, ponumber, contractno, legalcompany, custcoorddetails, employeename, empno, onsite, hours, pmo, sonumber, sdcstatus, sostatus, sotext, remarks, cteam) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    db.query(query, [month, pifId, poNo, contractNo, legalCompany, custDetails, associateName, empNumber, onsite, hours, pmo, soNo, sdcStatus, soStatus, soText, remarks, cTeam], (err, result) => {
      if (err) return next(err);
      res.send('Data saved successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updateNonMcrBilling/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { pmo_month, pif, ponumber, contractno, legalcompany, custcoorddetails, employeename, empno, onsite, hours, pmo, sonumber, sdcstatus, sostatus, sotext, remarks } = req.body;

    const query = `UPDATE pmodb.nonmcrbilling SET pmo_month=?, pif=?, ponumber=?, contractno=?, legalcompany=?, custcoorddetails=?, employeename=?, empno=?, onsite=?, hours=?, pmo=?, sonumber=?, sdcstatus=?, sostatus=?, sotext=?, remarks=? WHERE id=?`;

    db.query(query, [pmo_month, pif, ponumber, contractno, legalcompany, custcoorddetails, employeename, empno, onsite, hours, pmo, sonumber, sdcstatus, sostatus, sotext, remarks, id], (err, result) => {
      if (err) return next(err);
      res.send({ message: 'Data updated successfully' });
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deleteMcrData/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM pmodb.mcrbilling WHERE id = ?';

    db.query(query, [id], (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deleteNonMcrData/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM pmodb.nonmcrbilling WHERE id = ?';

    db.query(query, [id], (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/getGrmDetails', (req, res, next) => {
  try {
    const grm_dept = req.query.grm_dept;

    const query = 'SELECT grmname, grmemail FROM pmodb.grminfo WHERE grm_dept = ?';

    db.query(query, [grm_dept], (err, result) => {
      if (err) return next(err);
      res.send(result[0]);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/associateNonMcrHours', (req, res, next) => {
  try {
    const employee = req.query.associate;
    const mon = req.query.cMonth;

    const query = 'SELECT hours FROM pmodb.nonmcrbilling WHERE employeename = ? AND pmo_month = ?';
    db.query(query, [employee, mon], (err, result) => {
      if (err) return next(err);
      if (result.length > 0) {
        const hours = result[0].hours;
        if (hours < 156) {
          const remainingHrs = 156 - hours;
          res.json({ hours: remainingHrs });
        } else if (hours === 156) {
          res.json({ hours: 156 }); // No data to send
        }
      } else {
        res.json(null); // No data found for the associate and month
      }
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/fetchBmResourceGroup', (req, res, next) => {
  try {
    const query = 'Select * from pmodb.resourcegroup';

    db.query(query, (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/saveResourceGroup', (req, res, next) => {
  try {
    const { bmnumber, rgid, rgd } = req.body;

    const query = 'INSERT INTO pmodb.resourcegroup (bmnumber, rgid, rgd) VALUES (?, ?, ?)';
    db.query(query, [bmnumber, rgid, rgd, username], (err, result) => {
      if (err) return next(err);
      res.status(200).send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updateResourceGroup/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { bmnumber, rgid, rgd } = req.body;

    const query = `UPDATE pmodb.resourcegroup SET bmnumber = ?, rgid = ?, rgd = ? WHERE id=?`;

    db.query(query, [bmnumber, rgid, rgd, id], (err, result) => {
      if (err) return next(err);
      res.send({ message: 'Data updated successfully' });
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deleteResourceGroup/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM pmodb.resourcegroup WHERE id = ?';

    db.query(query, [id], (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/addmcrbilling1', (req, res, next) => {
  try {
    const data = req.body.rowData;
    const group = req.body.groupSelected;

    const query = `INSERT INTO pmodb.mcrbilling (pmo_month, bmnumber, wstatus, company, pd, pbu, taskid,
                    rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks, cteam)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      data.pmo_month, data.bmnumber, data.wstatus, data.company, data.pd, data.pbu, data.taskid,
      data.rgd, data.rgid, data.associatename, data.empno, data.hours, data.pmo, data.pif, data.billingstatus, data.remarks, group
    ];

    db.query(query, values, (err, results) => {
      if (err) return next(err);
      res.send('Data added successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/addmcrbilling2', (req, res, next) => {
  try {
    const data = req.body.rowData;
    const group = req.body.group;
    const username = req.body.username;

    const query = `INSERT INTO pmodb.mcrbilling (pmo_month, bmnumber, wstatus, company, pd, pbu, taskid,
                    rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks, cteam, username)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      data.pmo_month, data.bmnumber, data.wstatus, data.company, data.pd, data.pbu, data.taskid,
      data.rgd, data.rgid, data.associatename, data.empno, data.hours, data.pmo, data.pif, data.billingstatus, data.remarks, group, username
    ];

    db.query(query, values, (err, results) => {
      if (err) return next(err);
      res.send('Data added successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updatemcrbilling1/:id', (req, res, next) => {
  try {
    const id = req.params.id;
    const data = req.body.rowData;

    const query = `UPDATE pmodb.mcrbilling SET
                    pmo_month = ?, bmnumber = ?, wstatus = ?, company = ?, pd = ?, pbu = ?, taskid = ?,
                    rgd = ?, rgid = ?, associatename = ?, empno = ?, hours = ?, pmo = ?, pif = ?, billingstatus = ?, remarks = ?
                    WHERE id = ?`;

    const values = [
      data.pmo_month, data.bmnumber, data.wstatus, data.company, data.pd, data.pbu, data.taskid,
      data.rgd, data.rgid, data.associatename, data.empno, data.hours, data.pmo, data.pif, data.billingstatus, data.remarks, id
    ];

    db.query(query, values, (err, results) => {
      if (err) return next(err);
      res.send('Data updated successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updatemcrbilling2/:id', (req, res, next) => {
  try {
    const id = req.params.id;
    const data = req.body.rowData;
    const username = req.body.username;

    const query = `UPDATE pmodb.mcrbilling SET
                    pmo_month = ?, bmnumber = ?, wstatus = ?, company = ?, pd = ?, pbu = ?, taskid = ?,
                    rgd = ?, rgid = ?, associatename = ?, empno = ?, hours = ?, pmo = ?, pif = ?, billingstatus = ?, remarks = ?
                    WHERE id = ? and username = ?`;

    const values = [
      data.pmo_month, data.bmnumber, data.wstatus, data.company, data.pd, data.pbu, data.taskid,
      data.rgd, data.rgid, data.associatename, data.empno, data.hours, data.pmo, data.pif, data.billingstatus, data.remarks, id, username
    ];

    db.query(query, values, (err, results) => {
      if (err) return next(err);
      res.send('Data updated successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/detailsByBmNumber', (req, res, next) => {
  try {
    const bmnumber = req.query.bmnumber;
    db.execute(
      "SELECT mcr_id_status, project_division, project_business_unit FROM pmodb.mcrplan WHERE mcr_id = ?;",
      [bmnumber],
      (err, result) => {
        if (err) return next(err);
        if (result.length > 0) {
          return res.json(result[0]);
        } else {
          return res.status(404).json({ message: "BM Number not found" });
        }
      }
    );
  } catch (err) {
    next(err);
  }
});

// Endpoint to get rgd options by bmnumber
Router.get('/rgdOptions', (req, res, next) => {
  try {
    const bmnumber = req.query.bmnumber;
    db.execute(
      "SELECT resource_group_description, resource_group_id FROM pmodb.mcrplan WHERE mcr_id = ?;",
      [bmnumber],
      (err, result) => {
        if (err) return next(err);
        return res.json(result);
      }
    );
  } catch (err) {
    next(err);
  }
});

// Get rgid by rgd
Router.get('/rgidByRgd', (req, res, next) => {
  try {
    const { rgd } = req.query;
    const query = 'SELECT resource_group_id FROM pmodb.mcrplan WHERE resource_group_description = ?';
    db.query(query, [rgd], (err, results) => {
      if (err) return next(err);
      res.json(results[0]);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/remainingHours', (req, res, next) => {
  try {
    const { empno, pmo_month } = req.query;
    const query = 'SELECT SUM(hours) AS totalBilledHours FROM pmodb.mcrbilling WHERE empno = ? AND pmo_month = ?';
    db.query(query, [empno, pmo_month], (err, results) => {
      if (err) return next(err);
      const totalBilledHours = results[0].totalBilledHours || 0;
      const remainingHours = Math.max(0, 156 - totalBilledHours);
      res.json({ remainingHours });
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deletemcrbilling1/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM pmodb.mcrbilling WHERE id = ?';
    db.query(query, [id, username], (err, result) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deletemcrbilling2/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { username } = req.query;
    const query = 'DELETE FROM pmodb.mcrbilling WHERE id = ? and username = ?';
    db.query(query, [id, username], (err, result) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/addnonmcrbilling1', (req, res, next) => {
  try {
    const data = req.body.rowData;
    const group = req.body.groupSelected;

    const query = `INSERT INTO pmodb.nonmcrbilling (pmo_month, pif, ponumber, contractno, legalcompany, custcoorddetails, employeename, empno,
                    onsite, hours, pmo, sonumber, sdcstatus, sostatus, sotext, remarks, cteam)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      data.pmo_month, data.pif, data.ponumber, data.contractno, data.legalcompany, data.custcoorddetails, data.employeename,
      data.empno, data.onsite, data.hours, data.pmo, data.sonumber, data.sdcstatus, data.sostatus, data.sotext, data.remarks, group
    ];

    db.query(query, values, (err, results) => {
      if (err) return next(err);
      res.send('Data added successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/addnonmcrbilling2', (req, res, next) => {
  try {
    const data = req.body.rowData;
    const group = req.body.group;
    const username = req.body.username;

    const query = `INSERT INTO pmodb.nonmcrbilling (pmo_month, pif, ponumber, contractno, legalcompany, custcoorddetails, employeename, empno,
                    onsite, hours, pmo, sonumber, sdcstatus, sostatus, sotext, remarks, cteam, username)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      data.pmo_month, data.pif, data.ponumber, data.contractno, data.legalcompany, data.custcoorddetails, data.employeename,
      data.empno, data.onsite, data.hours, data.pmo, data.sonumber, data.sdcstatus, data.sostatus, data.sotext, data.remarks, group, username
    ];

    db.query(query, values, (err, results) => {
      if (err) return next(err);
      res.send('Data added successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updatenonmcrbilling1/:id', (req, res, next) => {
  try {
    const id = req.params.id;
    const data = req.body.rowData;

    const query = `UPDATE pmodb.nonmcrbilling SET
                    pmo_month = ?, pif = ?, ponumber = ?, contractno = ?, legalcompany = ?, custcoorddetails = ?, employeename = ?, 
                    empno = ?, onsite = ?, hours = ?, pmo = ?, sonumber = ?, sdcstatus = ?, sostatus = ?, sotext = ?, remarks = ?
                    WHERE id = ?`;

    const values = [
      data.pmo_month, data.pif, data.ponumber, data.contractno, data.legalcompany, data.custcoorddetails, data.employeename,
      data.empno, data.onsite, data.hours, data.pmo, data.sonumber, data.sdcstatus, data.sostatus, data.sotext, data.remarks, id
    ];

    db.query(query, values, (err, results) => {
      if (err) return next(err);
      res.send('Data updated successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.put('/updatenonmcrbilling2/:id', (req, res, next) => {
  try {
    const id = req.params.id;
    const data = req.body.rowData;
    const username = req.body.username;

    const query = `UPDATE pmodb.nonmcrbilling SET
                    pmo_month = ?, pif = ?, ponumber = ?, contractno = ?, legalcompany = ?, custcoorddetails = ?, employeename = ?, 
                    empno = ?, onsite = ?, hours = ?, pmo = ?, sonumber = ?, sdcstatus = ?, sostatus = ?, sotext = ?, remarks = ?
                    WHERE id = ? and username = ?`;

    const values = [
      data.pmo_month, data.pif, data.ponumber, data.contractno, data.legalcompany, data.custcoorddetails, data.employeename,
      data.empno, data.onsite, data.hours, data.pmo, data.sonumber, data.sdcstatus, data.sostatus, data.sotext, data.remarks, id, username
    ];

    db.query(query, values, (err, results) => {
      if (err) return next(err);
      res.send('Data updated successfully');
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/remainingNonMcrHours', (req, res, next) => {
  try {
    const { empno, pmo_month } = req.query;
    const query = 'SELECT SUM(hours) AS totalBilledHours FROM pmodb.nonmcrbilling WHERE empno = ? AND pmo_month = ?';
    db.query(query, [empno, pmo_month], (err, results) => {
      if (err) return next(err);
      const totalBilledHours = results[0].totalBilledHours || 0;
      const remainingHours = Math.max(0, 156 - totalBilledHours);
      res.json({ remainingHours });
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deletenonmcrbilling1/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM pmodb.nonmcrbilling WHERE id = ?';
    db.query(query, [id], (err, result) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  } catch (err) {
    next(err);
  }
});

Router.delete('/deletenonmcrbilling2/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const { username } = req.query;
    const query = 'DELETE FROM pmodb.nonmcrbilling WHERE id = ? and username = ?';
    db.query(query, [id, username], (err, result) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  } catch (err) {
    next(err);
  }
});

Router.get('/getAggregateHrs', (req, res, next) => {
  try {
    const finalQuery = 'SELECT associatename, sum(hours) as hours, pmo_month FROM pmodb.mcrbilling GROUP BY associatename, pmo_month;';
    db.query(finalQuery, (err, result) => {
      if (err) return next(err);
      res.send(result);
    });
  } catch (err) {
    next(err);
  }
});

Router.post('/session', (req, res, next) => {
  try {
    const { userId, userData, department, group, token } = req.body;
    db.query(
      'INSERT INTO pmodb.user_sessions (user_id, user_data, department, `group`, token) VALUES (?, ?, ?, ?, ?)',
      [userId, JSON.stringify(userData), department, group, token],
      (err, result) => {
        if (err) return next(err);
        res.status(200).send({ message: 'Session saved' });
      }
    );
  } catch (error) {
    next(error);
  }
});

Router.get('/session/:token', (req, res, next) => {
  try {
    const { token } = req.params;
    db.query(
      'SELECT user_data, department, `group` FROM user_sessions WHERE token = ?',
      [token],
      (err, results) => {
        if (err) return next(err);
        if (results.length > 0) {
          res.status(200).send(results[0]);
        } else {
          res.status(404).send({ error: 'Session not found' });
        }
      }
    );
  } catch (error) {
    next(error);
  }
});

Router.delete('/session/:token', (req, res, next) => {
  try {
    const { token } = req.params;
    db.query('DELETE FROM user_sessions WHERE token = ?', [token], (err, result) => {
      if (err) return next(err);
      res.status(200).send({ message: 'Session cleared' });
    });
  } catch (error) {
    next(error);
  }
});

// Error handling middleware
Router.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

module.exports = Router;
