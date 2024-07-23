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

Router.post('/register', (req, res)=> {
  const username = req.body.username;
  const password = req.body.password; 

  bcrypt.hash(password, saltRound, (err, hash) => {

      if (err) {
          console.log(err)
      }
      db.execute( 
          "INSERT INTO pmodb.adminlogin (username, password) VALUES (?,?)",
          [username, hash], 
          (err, result)=> {
              console.log(err);
          }
      );
  })
});

Router.post('/adminLogin', (req, res) => {
  const { username, password } = req.body;

  db.execute(
    "SELECT * FROM pmodb.adminlogin WHERE username = ?;",
    [username],
    (err, result) => {
      if (err) {
        return res.send({ err: err });
      }
      if (result.length > 0) {
        bcrypt.compare(password, result[0].password, (error, response) => {
          if (response) {
            const id = result[0].id;
            const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
            req.session.user = result;
            return res.json({ auth: true, token, result });
          } else {
            return res.json({ auth: false, message: "Wrong username/password combination!" });
          }
        });
      } else {
        return res.json({ auth: false, message: "No user exists" });
      }
    }
  );
});

Router.post('/logout', (req, res) => {
  const token = req.headers['x-access-token'];
  if (token) {
    tokenBlacklist.push(token);
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Failed to logout' });
      } else {
        return res.json({ success: true, message: 'Logged out successfully' });
      }
    });
  } else {
    return res.status(400).json({ success: false, message: 'No token provided' });
  }
});

Router.get('/protectedRoute', verifyToken, (req, res) => {
  return res.json({ success: true, message: 'Token is valid' });
});


Router.post('/userLogin', (req, res) => {
  const { username, department, group } = req.body;
  db.query('SELECT * FROM pmodb.loginuser WHERE username = ?', [username], (err, results) => {
      if (err) return res.status(500).send(err);

      if (results.length > 0) {
          const user = results[0];
          const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
          res.status(200).send({ auth: true, token});
      } else {
          db.query('INSERT INTO pmodb.loginuser (username, pmodepartment, pmogroup) VALUES (?, ?, ?)', [username, department, group], (err, results) => {
              if (err) return res.status(500).send(err);

              db.query('SELECT * FROM pmodb.loginuser WHERE id = ?', [results.insertId], (err, results) => {
                  if (err) return res.status(500).send(err);

                  const user = results[0];
                  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
                  res.status(200).send({ auth: true, token });
              });
          });
      }
  });
});

Router.post('/mcrupload', upload.single('file'), (req, res) => {
  const filePath = req.file.path;
  try {

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  if (worksheet.length === 0) {
      res.status(400).send('Excel file is empty');
      return;
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
        if (err) {
          console.error('Database insertion error:', err);
          return res.status(500).send('Error storing data in the database');
        }
      });
    });

    res.send({ message:'File uploaded and data stored in database', success: true });
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).send({ message:'Error processing file', success: false });
  } finally {
    fs.unlinkSync(filePath);
  }
});

Router.post('/planiswareupload', upload.single('file'), (req, res) => {
  const filePath = req.file.path;
  try {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  if (worksheet.length === 0) {
    res.status(400).send('Excel file is empty');
    return;
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
        if (err) {
          console.error('Database insertion error:', err);
          return res.status(500).send('Error storing data in the database');
        }
      });
    });

    res.send({ message:'File uploaded and data stored in database', success: true });
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).send({ message:'Error processing file', success: false });
  } finally {
    fs.unlinkSync(filePath);
  }
});

Router.get('/group', (req, res) => {
  const query = 'SELECT DISTINCT `cgroup` from pmodb.groupandteam';
  db.query(query, (err, results) => {
    if(err) {
      res.status(500).send(err);
    } else {
      res.json(results);
    }
  })
});

Router.get('/allTeam', (req, res) => {
  db.query('SELECT DISTINCT cteam FROM groupandteam', (err, results) => {
    if (err) {
      console.error('Error fetching all teams:', err);
      res.status(500).send('Error fetching all teams');
      return;
    }
    res.json(results);
  });
});

Router.get('/team', (req, res) => {
  const team = req.query.group;
  const query = 'SELECT `cteam` from pmodb.groupandteam where cgroup = ?';
  db.query(query, [team], (err, results) => {
    if(err) {
      res.status(500).send(err);
    } else {
      res.json(results);
    }
  })
});

Router.get('/verifyplanisware', (req, res) => {
  const group = req.query.group;
  const team = req.query.team;
  const month = req.query.month;
  
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
    if (err) {
        return res.status(500).send('query error');
    } else {
      res.json(results);
    }
  });
});

Router.get('/notallocated', (req, res) => {
  const group = req.query.group;
  const team = req.query.team;
  const month = req.query.month;
  
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
    if (err) {
        return res.status(500).send('query error');
    } else {
      res.json(results);
    }
  });
});

Router.get('/fetchallteams', (req, res) => {
  const group = req.query.group;
  const month = req.query.month;
  
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
    if (err) {
        return res.status(500).send('query error');
    } else {
      res.json(results);
    }
  });
});

Router.get('/fetchnotallocated', (req, res) => {
  const group = req.query.group;
  const month = req.query.month;
  
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
    if (err) {
        return res.status(500).send('query error');
    } else {
      res.json(results);
    }
  });
});



Router.get('/deptAssociates', (req, res) => {
  const team = req.query.team;
  
  const finalQuery = `
    SELECT employee_name AS label, employee_id AS value
    FROM pmodb.associates 
    WHERE employee_team = ?`;

  db.query(finalQuery, [team], (err, results) => {
    if (err) {
        return res.status(500).send('query error');
    } else {
      res.json(results);
    }
  });
});


Router.post('/savebillingdata', (req, res) => {
  const { month, bmNumber, taskID, rgid, rgd, wStatus, pd, pbu, company, associateName, empNumber, hours, pmo, pif, billingStatus, remarks, cTeam } = req.body;
  const username = os.userInfo().username;

  const query = 'INSERT INTO pmodb.mcrbilling (pmo_month, bmnumber, taskid, rgid, rgd, wstatus, pd, pbu, company, associatename, empno, hours, pmo, pif, billingstatus, remarks, username, cteam) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  db.query(query, [month, bmNumber, taskID, rgid, rgd, wStatus, pd, pbu, company, associateName, empNumber, hours, pmo, pif, billingStatus, remarks, username, cTeam], (err, result) => {
      if (err) {
          console.error('Error saving data:', err);
          res.status(500).send('Error saving data');
          return;
      }
      res.send('Data saved successfully');
  });
});

Router.get('/fetchmcrbilling', (req, res) => {
  const team = req.query.team;

  const query = 'SELECT * FROM pmodb.mcrbilling WHERE cteam = ?';
  db.query(query, [team], (err, results) => {
    if (err) {
      return res.status(500).send('query error');
    } else {
      res.json(results);
    }
  });
});

Router.get('/associatehours', (req, res) => {
  const employee = req.query.associate;
  const mon = req.query.cMonth;


  const query = 'SELECT hours FROM pmodb.mcrbilling WHERE associatename = ? AND pmo_month = ?';
  db.query(query, [employee, mon], (err, result) => {
    if (err) {
      return res.status(500).send('query error');
    } 
    if (result.length > 0) {
      const hours = result[0].hours;
      if (hours < 156) {
        const remainingHrs = 156 - hours;
        res.json({ hours: remainingHrs });
      } else if(hours === 156) {
        res.json({ hours: 156 });
      }
    } else {
      res.json(null);
    }
  });
});

Router.put('/updatemcrbilling', (req, res) => {
  const { id, pmo_month, bmnumber, wstatus, company, pd, pbu, taskid, rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks } = req.body;
  
  const query = `UPDATE pmodb.mcrbilling SET pmo_month=?, bmnumber=?, wstatus=?, company=?, pd=?, pbu=?, taskid=?, rgd=?, rgid=?, associatename=?, empno=?, hours=?, pmo=?, pif=?, billingstatus=?, remarks=? WHERE id=?`;
  
  db.query(query, [pmo_month, bmnumber, wstatus, company, pd, pbu, taskid, rgd, rgid, associatename, empno, hours, pmo, pif, billingstatus, remarks, id], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      }
      res.send({ message: 'Data updated successfully' });
  });
});

Router.get('/fetchNonMcrData', (req, res) => {
  const team = req.query.team;

  const query = 'SELECT * FROM pmodb.nonmcrbilling WHERE cteam = ?';
  db.query(query, [team], (err, results) => {
    if (err) {
      return res.status(500).send('query error');
    } else {
      res.json(results);
    }
  });
});

Router.get('/fetchAllStatus', async (req, res) => {
  const selected = req.query.dataSelected;
  try{
    if(selected === 'all'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' as billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
      union
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' as billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      union
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1),
        dbpool.execute(query2)
      ]);
    } else if(selected === 'mcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1),
        dbpool.execute(query2)
      ]);
    } else if(selected === 'nonmcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `

      var [result1, result2] = await Promise.all([
        dbpool.execute(query1),
        dbpool.execute(query2)
      ]);
    }

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
  console.error('Error executing queries', error);
  res.status(500).send('Server error');
  }
});

Router.get('/fetchAllButMonth', async (req, res) => {
  const cmonth = req.query.pmomonth;
  const selected = req.query.dataSelected;

  try{
    if(selected === 'all'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
      union
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours), m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      union
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [cmonth, cmonth]),
        dbpool.execute(query2, [cmonth, cmonth])
      ]);
    } else if(selected === 'mcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno and m.pmo_month = ?
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [cmonth]),
        dbpool.execute(query2, [cmonth])
      ]);
    } else if(selected === 'nonmcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno and m.pmo_month = ?
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [cmonth]),
        dbpool.execute(query2, [cmonth])
      ]);
    }
    
    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
  console.error('Error executing queries', error);
  res.status(500).send('Server error');
  }
});

Router.get('/fetchAllButTeam', async (req, res) => {
  const team = req.query.cteam;
  const selected = req.query.dataSelected;

  try{
    if(selected === 'all'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.cteam = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
      union
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.cteam = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      union
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [team, team]),
        dbpool.execute(query2, [team, team])
      ]);
    } else if(selected === 'mcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.cteam = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [team]),
        dbpool.execute(query2, [team])
      ]);
    } else if(selected === 'nonmcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.cteam = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [team]),
        dbpool.execute(query2, [team])
      ]);
    }

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
  console.error('Error executing queries', error);
  res.status(500).send('Server error');
  }
});

Router.get('/fetchAllButGroup', async (req, res) => {
  const grp = req.query.cgroup;
  const selected = req.query.dataSelected;

  try{
    if(selected === 'all'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
      union
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      union
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, grp]),
        dbpool.execute(query2, [grp, grp])
      ]);
    } else if(selected === 'mcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp]),
        dbpool.execute(query2, [grp])
      ]);
    } else if(selected === 'nonmcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp]),
        dbpool.execute(query2, [grp])
      ]);
    }

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
  console.error('Error executing queries', error);
  res.status(500).send('Server error');
  }
});

Router.get('/fetchAllButGT', async (req, res) => {
  const grp = req.query.cgroup;
  const team = req.query.cteam;
  const selected = req.query.dataSelected;

  try{
    if(selected === 'all'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and a.employee_team = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
      union
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and a.employee_team = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      union
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, team, grp, team]),
        dbpool.execute(query2, [grp, team, grp, team])
      ]);
    } else if(selected === 'mcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and a.employee_team = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, team]),
        dbpool.execute(query2, [grp, team])
      ]);
    } else if(selected === 'nonmcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and a.employee_team = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, team]),
        dbpool.execute(query2, [grp, team])
      ]);
    }

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
  console.error('Error executing queries', error);
  res.status(500).send('Server error');
  }
});

Router.get('/fetchAllButGM', async (req, res) => {
  const grp = req.query.cgroup;
  const mon = req.query.pmomonth;
  const selected = req.query.dataSelected;

  try{
    if(selected === 'all'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
      union
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      union
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, mon, grp, mon]),
        dbpool.execute(query2)
      ]);
    } else if(selected === 'mcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno and m.pmo_month = ?
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, mon]),
        dbpool.execute(query2, [mon])
      ]);
    } else if(selected === 'nonmcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno and m.pmo_month = ?
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, mon]),
        dbpool.execute(query2, [mon])
      ]);
    }

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
  console.error('Error executing queries', error);
  res.status(500).send('Server error');
  }
});

Router.get('/fetchAllButTM', async (req, res) => {
  const team = req.query.cteam;
  const mon = req.query.pmomonth;
  const selected = req.query.dataSelected;

  try{
    if(selected === 'all'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_team = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
      union
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_team = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      union
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [team, mon, team, mon]),
        dbpool.execute(query2)
      ]);
    } else if(selected === 'mcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_team = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno and m.pmo_month = ?
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [team, mon]),
        dbpool.execute(query2, [mon])
      ]);
    } else if(selected === 'nonmcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_team = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno and m.pmo_month = ?
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [team, mon]),
        dbpool.execute(query2, [mon])
      ]);
    }

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
  console.error('Error executing queries', error);
  res.status(500).send('Server error');
  }
});

Router.get('/fetchAllButGTM', async (req, res) => {
  const grp = req.query.cgroup;
  const team = req.query.cteam;
  const mon = req.query.pmomonth;
  const selected = req.query.dataSelected;

  try{
    if(selected === 'all'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and a.employee_team = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team
      union
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and a.employee_team = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where m.empno is null
      union
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, team, mon, grp, team, mon]),
        dbpool.execute(query2)
      ]);
    } else if(selected === 'mcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.mcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and a.employee_team = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.mcrbilling m
      on a.employee_id = m.empno and m.pmo_month = ?
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, team, mon]),
        dbpool.execute(query2, [mon])
      ]);
    } else if(selected === 'nonmcr'){
      const query1 = `
      select a.employee_name, a.employee_dept, a.employee_team, sum(m.hours) as hours, m.pmo_month, 'Non-MCR' AS billing_type
      from pmodb.associates a
      inner join pmodb.nonmcrbilling m
      on a.employee_id = m.empno
      where a.employee_dept = ? and a.employee_team = ? and m.pmo_month = ?
      group by a.employee_name, m.pmo_month, a.employee_dept, a.employee_team;
      `
      const query2 = `
      select a.employee_name, a.employee_dept, a.employee_team, m.hours, 'Non-MCR' AS billing_type, m.pmo_month
      from pmodb.associates a
      left join pmodb.nonmcrbilling m
      on a.employee_id = m.empno and m.pmo_month = ?
      where m.empno is null;
      `
      var [result1, result2] = await Promise.all([
        dbpool.execute(query1, [grp, team, mon]),
        dbpool.execute(query2, [mon])
      ]);
    }

    res.json({
      query1Result: result1[0],
      query2Result: result2[0]
    });
  } catch (error) {
  console.error('Error executing queries', error);
  res.status(500).send('Server error');
  }
});

Router.post('/addAssociates', (req, res) => {
  const { associates, employee_dept, employee_team } = req.body;
  const query = 'INSERT INTO pmodb.associates (employee_name, employee_id, employee_status, employee_dept, employee_team) VALUES ?';
  const values = associates.map(associate => [associate.employee_name, associate.employee_id, associate.employee_status, employee_dept, employee_team]);

  db.query(query, [values], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      }
      res.send(result);
  });
});

Router.get('/getAssociateData', (req, res) => {
  const team = req.query.team;

  const query = 'SELECT * FROM pmodb.associates WHERE employee_team = ?';
  db.query(query, [team], (err, results) => {
    if (err) {
      return res.status(500).send('query error');
    } else {
      res.json(results);
    }
  });
});

Router.put('/updateAssociates/:id', (req, res) => {
  const { employee_name, employee_id, employee_status } = req.body;
  const { id } = req.params;
  
  const query = `UPDATE pmodb.associates SET employee_name = ?, employee_id = ?, employee_status = ? WHERE id=?`;
  
  db.query(query, [employee_name, employee_id, employee_status, id], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      }
      res.send({ message: 'Data updated successfully' });
  });
});

Router.delete('/deleteAssociates/:id', (req, res) => {
  const { id } = req.params;
  const query = 'DELETE FROM pmodb.associates WHERE id = ?';
  
  db.query(query, [id], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      } else {
        res.send(result);
      }
  });
});

Router.post('/addGroupTeam', (req, res) => {
  const { teamName, groupName, grm } = req.body;

  const query = 'INSERT INTO pmodb.groupandteam (cteam, cgroup, grmname) values (?, ?, ?)';

  db.query(query, [teamName, groupName, grm], (err, result) => {
    if (err) {
        return res.status(500).send(err);
    } else {
      res.send(result);
    }
  });
});

Router.get('/fetchGrmData', (req, res) => {
  const query = 'SELECT * FROM pmodb.grminfo';

  db.query(query, (err, result) => {
    if(err) {
      return res.status(500).send(err);
    } else {
      res.send(result);
    }
  });
});

Router.post('/saveGrmData', (req, res) => {
  const {grmname, grmemail, grm_dept} = req.body;

  const query = 'INSERT INTO pmodb.grminfo (grmname, grmemail, grm_dept) VALUES (?, ?, ?)';

  db.query(query, [grmname, grmemail, grm_dept], (err, result) => {
    if(err) {
      return res.status(500).send(err);
    } else {
      res.status(200).send(result);
    }
  });
});

Router.put('/updateGrmInfo/:grmid', (req, res) => {
  const { grmid } = req.params;
  const { grmname, grmemail, grm_dept } = req.body;
  
  const query = `UPDATE pmodb.grminfo SET grmname = ?, grmemail = ?, grm_dept = ? WHERE grmid=?`;
  
  db.query(query, [grmname, grmemail, grm_dept, grmid], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      }
      res.send({ message: 'Data updated successfully' });
  });
});

Router.delete('/deleteGrm/:grmid', (req, res) => {
  const { grmid } = req.params;
  const query = 'DELETE FROM pmodb.grminfo WHERE grmid = ?';
  
  db.query(query, [grmid], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      } else {
        res.send(result);
      }
  });
});

Router.post('/saveNonMcrData', (req, res) => {
  const { month, pifId, poNo, contractNo, legalCompany, custDetails, associateName, empNumber, onsite, hours, pmo, soNo, sdcStatus, soStatus, soText, remarks, cTeam } = req.body;
  const username = os.userInfo().username;

  const query = 'INSERT INTO pmodb.nonmcrbilling (pmo_month, pif, ponumber, contractno, legalcompany, custcoorddetails, employeename, empno, onsite, hours, pmo, sonumber, sdcstatus, sostatus, sotext, remarks, username, cteam) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  db.query(query, [month, pifId, poNo, contractNo, legalCompany, custDetails, associateName, empNumber, onsite, hours, pmo, soNo, sdcStatus, soStatus, soText, remarks, username, cTeam], (err, result) => {
      if (err) {
          console.error('Error saving data:', err);
          res.status(500).send('Error saving data');
          return;
      }
      res.send('Data saved successfully');
  });
});

Router.put('/updateNonMcrBilling/:id', (req, res) => {
  const { id } = req.params;
  const { pmo_month, pif, ponumber, contractno, legalcompany, custcoorddetails, employeename, empno, onsite, hours, pmo, sonumber, sdcstatus, sostatus, sotext, remarks } = req.body;
  
  const query = `UPDATE pmodb.nonmcrbilling SET pmo_month=?, pif=?, ponumber=?, contractno=?, legalcompany=?, custcoorddetails=?, employeename=?, empno=?, onsite=?, hours=?, pmo=?, sonumber=?, sdcstatus=?, sostatus=?, sotext=?, remarks=? WHERE id=?`;
  
  db.query(query, [pmo_month, pif, ponumber, contractno, legalcompany, custcoorddetails, employeename, empno, onsite, hours, pmo, sonumber, sdcstatus, sostatus, sotext, remarks, id], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      }
      res.send({ message: 'Data updated successfully' });
  });
});

Router.delete('/deleteMcrData/:id', (req, res) => {
  const { id } = req.params;
  const query = 'DELETE FROM pmodb.mcrbilling WHERE id = ?';
  
  db.query(query, [id], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      } else {
        res.send(result);
      }
  });
});

Router.delete('/deleteNonMcrData/:id', (req, res) => {
  const { id } = req.params;
  const query = 'DELETE FROM pmodb.nonmcrbilling WHERE id = ?';
  
  db.query(query, [id], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      } else {
        res.send(result);
      }
  });
});

Router.get('/getGrmDetails', (req, res) => {
  const grm_dept = req.query.grm_dept;

  const query = 'SELECT grmname, grmemail FROM pmodb.grminfo WHERE grm_dept = ?';

  db.query(query, [grm_dept], (err, result) => {
    if (err) {
      return res.status(500).send(err);
    } else {
      res.send(result[0]);
    }
  });
});

Router.get('/associateNonMcrHours', (req, res) => {
  const employee = req.query.associate;
  const mon = req.query.cMonth;

  const query = 'SELECT hours FROM pmodb.nonmcrbilling WHERE employeename = ? AND pmo_month = ?';
  db.query(query, [employee, mon], (err, result) => {
    if (err) {
      return res.status(500).send('query error');
    } 
    if (result.length > 0) {
      const hours = result[0].hours;
      if (hours < 156) {
        const remainingHrs = 156 - hours;
        res.json({ hours: remainingHrs });
      } else if(hours === 156) {
        res.json({ hours: 156 }); // No data to send
      }
    } else {
      res.json(null); // No data found for the associate and month
    }
  });
});

Router.get('/fetchBmResourceGroup', (req, res) => {

  const query = 'Select * from pmodb.resourcegroup';

  db.query(query, (err, result) => {
    if (err) {
      return res.status(500).send(err);
    } else {
      res.send(result);
    }
  });
});

Router.post('/saveResourceGroup', (req, res) => {
  const { bmnumber, rgid, rgd } = req.body;
  const username = os.userInfo().username;

  const query = 'INSERT INTO pmodb.resourcegroup (bmnumber, rgid, rgd, username) VALUES (?, ?, ?, ?)';
  db.query(query, [bmnumber, rgid, rgd, username], (err, result) => {
    if(err) {
      return res.status(500).send(err);
    } else {
      res.status(200).send(result);
    }
  });
});

Router.put('/updateResourceGroup/:id', (req, res) => {
  const { id } = req.params;
  const { bmnumber, rgid, rgd } = req.body;
  
  const query = `UPDATE pmodb.resourcegroup SET bmnumber = ?, rgid = ?, rgd = ? WHERE id=?`;
  
  db.query(query, [bmnumber, rgid, rgd, id], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      }
      res.send({ message: 'Data updated successfully' });
  });
});

Router.delete('/deleteResourceGroup/:id', (req, res) => {
  const { id } = req.params;
  const query = 'DELETE FROM pmodb.resourcegroup WHERE id = ?';
  
  db.query(query, [id], (err, result) => {
      if (err) {
          return res.status(500).send(err);
      } else {
        res.send(result);
      }
  });
});

//-------------------------------------------------------------------------------
Router.post('/addmcrbilling1', (req, res) => {
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
      if (err) {
          console.error('Error adding data:', err);
          res.status(500).send('Error adding data');
      } else {
          res.send('Data added successfully');
      }
  });
});


Router.put('/updatemcrbilling1/:id', (req, res) => {
  const id = req.params.id;
  const data = req.body;

  const query = `UPDATE pmodb.mcrbilling SET
                  pmo_month = ?, bmnumber = ?, wstatus = ?, company = ?, pd = ?, pbu = ?, taskid = ?,
                  rgd = ?, rgid = ?, associatename = ?, empno = ?, hours = ?, pmo = ?, pif = ?, billingstatus = ?, remarks = ?
                  WHERE id = ?`;

  const values = [
      data.pmo_month, data.bmnumber, data.wstatus, data.company, data.pd, data.pbu, data.taskid,
      data.rgd, data.rgid, data.associatename, data.empno, data.hours, data.pmo, data.pif, data.billingstatus, data.remarks, id
  ];

  db.query(query, values, (err, results) => {
      if (err) {
          console.error('Error updating data:', err);
          res.status(500).send('Error updating data');
      } else {
          res.send('Data updated successfully');
      }
  });
});


Router.get('/detailsByBmNumber', (req, res) => {
  const bmnumber = req.query.bmnumber;
  db.execute(
      "SELECT mcr_id_status, project_division, project_business_unit FROM pmodb.mcrplan WHERE mcr_id = ?;",
      [bmnumber],
      (err, result) => {
          if (err) {
              return res.status(500).send({ err: err });
          }
          if (result.length > 0) {
              return res.json(result[0]);
          } else {
              return res.status(404).json({ message: "BM Number not found" });
          }
      }
  );
});

// Endpoint to get rgd options by bmnumber
Router.get('/rgdOptions', (req, res) => {
  const bmnumber = req.query.bmnumber;
  db.execute(
      "SELECT resource_group_description, resource_group_id FROM pmodb.mcrplan WHERE mcr_id = ?;",
      [bmnumber],
      (err, result) => {
          if (err) {
              return res.status(500).send({ err: err });
          }
          return res.json(result);
      }
  );
});

// Get rgid by rgd
Router.get('/rgidByRgd', (req, res) => {
  const { rgd } = req.query;
  const query = 'SELECT resource_group_id FROM pmodb.mcrplan WHERE resource_group_description = ?';
  db.query(query, [rgd], (err, results) => {
      if (err) {
          console.error('Error fetching rgid:', err);
          res.status(500).send('Error fetching rgid');
      } else {
          res.json(results[0]);
      }
  });
});

Router.get('/remainingHours', (req, res) => {
  const { empno, pmo_month } = req.query;
  const query = 'SELECT SUM(hours) AS totalBilledHours FROM pmodb.mcrbilling WHERE empno = ? AND pmo_month = ?';
  db.query(query, [empno, pmo_month], (err, results) => {
      if (err) {
          console.error('Error fetching remaining hours:', err);
          res.status(500).send('Error fetching remaining hours');
          return;
      }
      const totalBilledHours = results[0].totalBilledHours || 0;
      const remainingHours = Math.max(0, 156 - totalBilledHours);
      res.json({ remainingHours });
  });
});

Router.delete('/deletemcrbilling1/:id', (req, res) => {
  const { id } = req.params;
  const query = 'DELETE FROM pmodb.mcrbilling WHERE id = ?';
  db.query(query, [id], (err, result) => {
      if (err) {
          console.error('Error deleting MCR billing:', err);
          res.status(500).send('Error deleting MCR billing');
          return;
      }
      res.sendStatus(200);
  });
});

Router.post('/addnonmcrbilling1', (req, res) => {
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
      if (err) {
          console.error('Error adding data:', err);
          res.status(500).send('Error adding data');
      } else {
          res.send('Data added successfully');
      }
  });
});

Router.put('/updatenonmcrbilling1/:id', (req, res) => {
  const id = req.params.id;
  const data = req.body;

  const query = `UPDATE pmodb.nonmcrbilling SET
                  pmo_month = ?, pif = ?, ponumber = ?, contractno = ?, legalcompany = ?, custcoorddetails = ?, employeename = ?, 
                  empno = ?, onsite = ?, hours = ?, pmo = ?, sonumber = ?, sdcstatus = ?, sostatus = ?, sotext = ?, remarks = ?
                  WHERE id = ?`;

  const values = [
    data.pmo_month, data.pif, data.ponumber, data.contractno, data.legalcompany, data.custcoorddetails, data.employeename, 
    data.empno, data.onsite, data.hours, data.pmo, data.sonumber, data.sdcstatus, data.sostatus, data.sotext, data.remarks, id
  ];

  db.query(query, values, (err, results) => {
      if (err) {
          console.error('Error updating data:', err);
          res.status(500).send('Error updating data');
      } else {
          res.send('Data updated successfully');
      }
  });
});

Router.get('/remainingNonMcrHours', (req, res) => {
  const { empno, pmo_month } = req.query;
  const query = 'SELECT SUM(hours) AS totalBilledHours FROM pmodb.nonmcrbilling WHERE empno = ? AND pmo_month = ?';
  db.query(query, [empno, pmo_month], (err, results) => {
      if (err) {
          console.error('Error fetching remaining hours:', err);
          res.status(500).send('Error fetching remaining hours');
          return;
      }
      const totalBilledHours = results[0].totalBilledHours || 0;
      const remainingHours = Math.max(0, 156 - totalBilledHours);
      res.json({ remainingHours });
  });
});

Router.delete('/deletenonmcrbilling1/:id', (req, res) => {
  const { id } = req.params;
  const query = 'DELETE FROM pmodb.nonmcrbilling WHERE id = ?';
  db.query(query, [id], (err, result) => {
      if (err) {
          console.error('Error deleting MCR billing:', err);
          res.status(500).send('Error deleting MCR billing');
          return;
      }
      res.sendStatus(200);
  });
});

Router.get('/getAggregateHrs', (req, res) => {
  const finalQuery = '  select associatename, sum(hours) as hours, pmo_month from pmodb.mcrbilling group by associatename, pmo_month;';
  db.query(finalQuery, (err, result) => {
    if(err){
      console.error('Error deleting MCR billing:', err);
      res.status(500).send('Error deleting MCR billing');
      return;
    }
    res.sendStatus(200);
  });
});

Router.post('/session', (req, res) => {
  const { userId, userData, department, group, token } = req.body;
  try {
      db.query(
          'INSERT INTO pmodb.user_sessions (user_id, user_data, department, `group`, token) VALUES (?, ?, ?, ?, ?)',
          [userId, JSON.stringify(userData), department, group, token]
      );
      res.status(200).send({ message: 'Session saved' });
  } catch (error) {
      res.status(500).send({ error: 'Failed to save session' });
  }
});

Router.get('/session/:token', (req, res) => {
  const { token } = req.params;
  try {
      const [results] = db.query(
          'SELECT user_data, department, `group` FROM user_sessions WHERE token = ?',
          [token]
      );
      if (results.length > 0) {
          res.status(200).send(results[0]);
      } else {
          res.status(404).send({ error: 'Session not found' });
      }
  } catch (error) {
      res.status(500).send({ error: 'Failed to retrieve session' });
  }
});

Router.delete('/session/:token', (req, res) => {
  const { token } = req.params;
  try {
      db.query('DELETE FROM user_sessions WHERE token = ?', [token]);
      res.status(200).send({ message: 'Session cleared' });
  } catch (error) {
      res.status(500).send({ error: 'Failed to clear session' });
  }
});

module.exports = Router;
