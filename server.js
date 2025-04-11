require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const cors = require('cors');
const cron = require('node-cron');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

    const ACCESS_TOKEN = '1000.fa3a2cd1668c7e5bd655fda18b099901.b05c737fac8cf205d210441f24db8dbc'; // Use env var in production






app.post('/api/v1/submit-lead/crm', async (req, res) => {
  const leadPayload = {
    data: [
      {
        Last_Name: req.body.name || "Anonymous",
        First_Name: req.body.firstName || "Unknown",
        Email: req.body.email,
        Phone: req.body.phone,
        Company: req.body.companyName,
        City: req.body.location,
        Description: `Business Type: ${req.body.businessType}, Accepts Cards: ${req.body.acceptsCards}`,
        Lead_Source: "Website Form"
      }
    ]
  };

  try {
    const response = await fetch('https://www.zohoapis.com/crm/v2/Leads', {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leadPayload),
    });

    const result = await response.json();
    res.status(response.status).json(result);
  } catch (err) {
    console.error("Zoho API Error:", err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});


// Ping your own server every 5 minutes to keep it awake
cron.schedule('*/5 * * * *', async () => {
  try {
    const res = await fetch(`https://pos.zifypay.com/`);
    console.log(`[CRON] Pinged server at ${new Date().toISOString()} - Status: ${res.status}`);
  } catch (err) {
    console.error("[CRON] Failed to ping server:", err.message);
  }
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

