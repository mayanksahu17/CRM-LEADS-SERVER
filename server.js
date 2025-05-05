require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const cors = require('cors');
const cron = require('node-cron');
const fetch = require('node-fetch');
const Stripe = require('stripe')
const bcrypt = require("bcryptjs");
const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} from Origin: ${req.headers.origin}`);
  next();
});
const secrete = "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"


const PORT = process.env.PORT || 5000;


const stripe = Stripe(secrete); // Make sure this env var exists


// use the refresh token 
// MAYANK SAHU@DESKTOP-VFBD9QS MINGW64 ~/Desktop/anish/zify (main)
// $ curl --request POST   --url https://accounts.zoho.com/oauth/v2/token   --header "Content-Type: application/x-www-form-urlencoded"   --data "code=1000.aa010dc47504ac7a8e39c9f41e3b5b04.35bf396e9d8976afde6677088d484fa2&client_id=1000.25F2LVP1EA9QYIEH43C5K0J332KT0W&client_secret=79cdffff82
// c4379f6f49f7bb0eaba08141c443b043&redirect_uri=https://pos.zifypay.com/&grant_type=authorization_code"
// {"access_token":"1000.cd92d6a67c4b8836db4c8f356e8aae73.e0da65af844223de7363ba5fee0fa0aa","refresh_token":"1000.1d009fbe92667e5050aa6665c614aad4.16d8fdfdcad131b7e1ef70669ee113ae","scope":"ZohoCRM.modules.leads.ALL","api_domain":"https://www.zohoapis.com","token_type":"Bearer","expires_in":3600}
let currentAccessToken = null;
let accessTokenExpiry = 0; // Unix timestamp

 const getAccessToken = async () => {
  const now = Date.now();

  // Refresh if expired or not available
  if (!currentAccessToken || now >= accessTokenExpiry) {
    console.log("🔁 Refreshing Zoho access token...");

    const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.access_token) {
      console.error("❌ Failed to refresh token:", data);
      throw new Error("Could not refresh Zoho token");
    }

    currentAccessToken = data.access_token;
    accessTokenExpiry = now + (data.expires_in - 60) * 1000; // refresh 1 min before expiry

    console.log("✅ Refreshed Zoho access token");
  }

  return currentAccessToken;
};

  




const ACCESS_TOKEN = '1000.1d009fbe92667e5050aa6665c614aad4.16d8fdfdcad131b7e1ef70669ee113ae'; // Use env var in production

app.get('/',async (req, res)=>{

res.send("server is up 🚀🚀🚀");
})




app.post('/api/v1/submit-lead/crm', async (req, res) => {
  const lead = req.body.data?.[0];

  if (!lead) {
    return res.status(400).json({ error: 'Invalid data format' });
  }

  const leadPayload = {
    data: [
      {
        Last_Name: lead.Last_Name || "Unknown",
        Email: lead.Email,
        Phone: lead.Phone,
        Company: lead.Company,
        City: lead.City,
        Description: lead.Description,
        Lead_Source: lead.Lead_Source
      }
    ]
  };

  console.log("Lead Payload:", leadPayload);

  try {
    const token = await getAccessToken();

    // Send to Zoho API 
    const response = await fetch('https://www.zohoapis.com/crm/v2/Leads', {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leadPayload),
    });

    const result = await response.json();

   

    res.status(200).json(result);
  } catch (err) {
    console.error("Zoho API Error:", err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.get('/api/v1/verify_number', async (req, res) => {
  const number = req.query.number ;
  const countryCode = req.query.countryCode ;
  const apiKey = process.env.NUMVERIFY_ACCESS_TOKEN;

  if (!number || !countryCode) {
    return res.status(400).json({ error: "Missing number or countryCode" });
  }

  const url = `https://apilayer.net/api/validate?access_key=${apiKey}&number=${number}&country_code=${countryCode}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log("API Response:", data);
    
    if (data.valid) {
      res.status(200).json({
        valid: true,
        carrier: data.carrier,
        location: data.location,
        number: data.international_format,
        line_type: data.line_type,
      });
    } else {
      res.status(400).json({ valid: false });
    }
  } catch (error) {
    console.error("Error verifying number:", error);
    res.status(500).json({ error: 'Failed to verify number' });
  }
});


// New Route: Form + Stripe Checkout Integration 🔥
app.post('/api/v1/submit-lead-and-checkout', async (req, res) => {
  // const { name, email, phone, companyName, location, businessType, acceptsCards } = req.body;
  const lead = req.body.data?.[0];

  // if (!email || !name || !phone) {
  //   return res.status(400).json({ error: "Missing required fields" });
  // }

  try {
    const token = await getAccessToken();
    const leadPayload = {
      data: [
        {
          Last_Name: lead.Last_Name || "Unknown",
          Email: lead.Email,
          Phone: lead.Phone,
          Company: lead.Company,
          City: lead.City,
          Description: lead.Description,
          Lead_Source: lead.Lead_Source
        }
      ]
    };

    const crmResponse = await fetch('https://www.zohoapis.com/crm/v2/Leads', {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leadPayload),
    });

    const crmData = await crmResponse.json();
    if (!crmData?.data?.[0]?.code || crmData.data[0].code !== "SUCCESS") {
      console.error("CRM Error:", crmData);
      return res.status(500).json({ error: 'Failed to submit lead to CRM' });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'ZifyPay $1 Demo Booking',
            },
            unit_amount: 100, // $1
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://pos.zifypay.com/thankyou', // after success
      cancel_url: 'https://pos.zifypay.com/', // on cancel
      metadata: {
        email : lead.Email,
      }
    });

    return res.status(200).json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("Error during submit-lead-and-checkout:", err);
    res.status(500).json({ error: 'Internal server error' });
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
app.listen(5000,'0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

