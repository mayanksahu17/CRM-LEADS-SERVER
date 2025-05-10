require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const cors = require('cors');
const cron = require('node-cron');
const fetch = require('node-fetch');
const Stripe = require('stripe')
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");


// Add this route to handle Excel file uploads and data processing
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });



const app = express();
app.use(cors());
app.use(express.json());
app.use("/output", express.static(path.join(__dirname, "output")));

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



app.get("/api/entries", (req, res) => {
  try {
    const filePath = path.join(__dirname, "data.xlsx");
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Excel file not found." });
    }

    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets["Sheet1"];
    const data = XLSX.utils.sheet_to_json(worksheet);

    res.status(200).json({ entries: data });
  } catch (err) {
    console.error("❌ Error fetching entries:", err);
    res.status(500).json({ error: "Failed to get entries." });
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


// Updated add-entry API to include Amount field
app.post("/api/add-entry", async (req, res) => {
  const { name, email, insuranceNumber, address, number, amount, userId } = req.body;

  try {
    const filePath = path.join(__dirname, "data.xlsx");

    // Load or create workbook
    let workbook, worksheet;
    if (fs.existsSync(filePath)) {
      workbook = XLSX.readFile(filePath);
      worksheet = workbook.Sheets["Sheet1"];
    } else {
      workbook = XLSX.utils.book_new();
      worksheet = XLSX.utils.aoa_to_sheet([["Name", "Email", "InsuranceNumber", "Address", "Number", "Amount", "UserId"]]);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    }

    const data = XLSX.utils.sheet_to_json(worksheet);

    // Check for duplicate insurance number
    const exists = data.find(d => d.InsuranceNumber === insuranceNumber);
    if (exists) {
      return res.status(409).json({ error: "Entry with this Insurance Number already exists." });
    }

    // Append new row
    data.push({ 
      Name: name, 
      Email: email, 
      InsuranceNumber: insuranceNumber, 
      Address: address, 
      Number: number,
      Amount: amount || 0,
      UserId: userId || ''
    });
    
    const newSheet = XLSX.utils.json_to_sheet(data, { 
      header: ["Name", "Email", "InsuranceNumber", "Address", "Number", "Amount", "UserId"] 
    });
    
    workbook.Sheets["Sheet1"] = newSheet;
    XLSX.writeFile(workbook, filePath);

    res.status(200).json({ message: "Entry added successfully." });
  } catch (err) {
    console.error("Error adding entry:", err);
    res.status(500).json({ error: "Failed to add entry." });
  }
});

// Updated generate-certificate API to include Amount
app.post("/api/generate-certificate", async (req, res) => {
  const { insuranceNumber } = req.body;
  const stepLogs = [];

  try {
    stepLogs.push("✅ Request received.");

    if (!insuranceNumber) {
      stepLogs.push("❌ Insurance number missing.");
      return res.status(400).json({ error: "Insurance number is required.", logs: stepLogs });
    }

    stepLogs.push("🔍 Insurance number provided: " + insuranceNumber);

    const filePath = path.join(__dirname, "data.xlsx");
    if (!fs.existsSync(filePath)) {
      stepLogs.push("❌ Excel file not found.");
      return res.status(404).json({ error: "Data sheet not found.", logs: stepLogs });
    }

    stepLogs.push("📄 Excel file located, reading contents...");
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets["Sheet1"];
    const data = XLSX.utils.sheet_to_json(worksheet);

    stepLogs.push("📊 Excel data parsed. Searching for matching record...");
    const match = data.find(entry => entry.InsuranceNumber === insuranceNumber);

    if (!match) {
      stepLogs.push("❌ No matching insurance number found.");
      return res.status(403).json({ error: "No matching insurance record found.", logs: stepLogs });
    }

    const { Name: name, Email: email, Address: address, Number: number, Amount: amount, UserId: userId } = match;
    stepLogs.push(`✅ Record found for: ${name}`);

    // Load and modify PDF
    const templatePath = path.join(__dirname, "certificate_template.pdf");
    if (!fs.existsSync(templatePath)) {
      stepLogs.push("❌ PDF template not found.");
      return res.status(500).json({ error: "PDF template missing.", logs: stepLogs });
    }

    stepLogs.push("📄 PDF template found. Loading...");
    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    if (!pages.length) {
      stepLogs.push("❌ PDF has no pages.");
      return res.status(500).json({ error: "PDF template is empty.", logs: stepLogs });
    }

    const lastPage = pages[pages.length - 1];
    stepLogs.push("🖋️ Drawing user info on the certificate...");

    const today = new Date();
    const oneYearLater = new Date();
    oneYearLater.setFullYear(today.getFullYear() + 1);
    
    const monthNames = ["January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"];
    
    const daySuffix = (day) => {
      if (day > 3 && day < 21) return 'th';
      switch (day % 10) {
        case 1: return "st";
        case 2: return "nd";
        case 3: return "rd";
        default: return "th";
      }
    };
    
    const formatDate = (date) => {
      const day = date.getDate();
      const monthName = monthNames[date.getMonth()];
      const year = date.getFullYear();
      return `${monthName} ${day}${daySuffix(day)}, ${year}`;
    };
    
    const coverageStart = formatDate(today);
    const coverageEnd = formatDate(oneYearLater);
    
    const CoveragePeriod = `${coverageStart} - ${coverageEnd}`;
    lastPage.drawText(`${insuranceNumber}`, { x: 320, y: 2520, size: 25, font, color: rgb(0, 0, 0) });
    lastPage.drawText(`${name}`, { x: 320, y: 2460, size: 25, font, color: rgb(0, 0, 0) });
    lastPage.drawText(`${"+" + number}`, { x: 320, y: 2400, size: 25, font, color: rgb(0, 0, 0) });
    lastPage.drawText(`${email}`, { x: 320, y: 2340, size: 25, font, color: rgb(0, 0, 0) });
    lastPage.drawText(`${address}`, { x: 320, y: 2280, size: 18, font, color: rgb(0, 0, 0) });

    // Display the amount with proper formatting
    const formattedAmount = amount ? `$${Number(amount).toLocaleString('en-US')}` : "$0";
    lastPage.drawText(`${formattedAmount}`, { x: 350, y: 1720, size: 23, font, color: rgb(0, 0, 0) });

    lastPage.drawText(`${CoveragePeriod}`, { x: 350, y: 1680, size: 23, font, color: rgb(0, 0, 0) });

    stepLogs.push("✅ Certificate data injected. Saving PDF in memory...");
    const pdfBytes = await pdfDoc.save();

    stepLogs.push("📤 Sending generated certificate as response...");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=CERTIFICATE_${insuranceNumber}.pdf`);
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error("❌ Error generating certificate:", err);
    stepLogs.push("❌ Exception thrown: " + err.message);
    return res.status(500).json({ error: "Internal Server Error", logs: stepLogs });
  }
});

// Updated edit-entry API to include Amount field
app.put("/api/edit-entry/:insuranceNumber", (req, res) => {
  const insuranceNumber = req.params.insuranceNumber;
  const { name, email, address, number, amount, userId } = req.body;

  try {
    const filePath = path.join(__dirname, "data.xlsx");
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets["Sheet1"];
    const data = XLSX.utils.sheet_to_json(worksheet);

    const index = data.findIndex(entry => entry.InsuranceNumber === insuranceNumber);
    if (index === -1) {
      return res.status(404).json({ error: "Entry not found." });
    }

    data[index] = {
      Name: name,
      Email: email,
      InsuranceNumber: insuranceNumber,
      Address: address,
      Number: number,
      Amount: amount !== undefined ? amount : (data[index].Amount || 0),
      UserId: userId !== undefined ? userId : (data[index].UserId || '')
    };

    const updatedSheet = XLSX.utils.json_to_sheet(data, { 
      header: ["Name", "Email", "InsuranceNumber", "Address", "Number", "Amount", "UserId"] 
    });
    
    workbook.Sheets["Sheet1"] = updatedSheet;
    XLSX.writeFile(workbook, filePath);

    res.status(200).json({ message: "Entry updated successfully." });
  } catch (err) {
    console.error("❌ Error updating entry:", err);
    res.status(500).json({ error: "Failed to update entry." });
  }
});
app.delete("/api/delete-entry/:insuranceNumber", (req, res) => {
  const insuranceNumber = req.params.insuranceNumber;

  try {
    const filePath = path.join(__dirname, "data.xlsx");
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets["Sheet1"];
    let data = XLSX.utils.sheet_to_json(worksheet);

    const newData = data.filter(entry => entry.InsuranceNumber !== insuranceNumber);

    if (newData.length === data.length) {
      return res.status(404).json({ error: "Entry not found to delete." });
    }

    const newSheet = XLSX.utils.json_to_sheet(newData, { header: ["Name", "Email", "InsuranceNumber", "Address", "Number"] });
    workbook.Sheets["Sheet1"] = newSheet;
    XLSX.writeFile(workbook, filePath);

    res.status(200).json({ message: "Entry deleted successfully." });
  } catch (err) {
    console.error("❌ Error deleting entry:", err);
    res.status(500).json({ error: "Failed to delete entry." });
  }
});






app.post("/api/upload-excel", upload.single('file'), async (req, res) => {
  const stepLogs = [];

  try {
    stepLogs.push("✅ File upload request received");

    if (!req.file) {
      stepLogs.push("❌ No file uploaded");
      return res.status(400).json({ error: "Please upload an Excel file", logs: stepLogs });
    }

    stepLogs.push(`📄 File received: ${req.file.originalname}`);

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });

    if (!workbook.SheetNames.length) {
      stepLogs.push("❌ Excel file has no sheets");
      return res.status(400).json({ error: "Excel file has no sheets", logs: stepLogs });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const uploadedData = XLSX.utils.sheet_to_json(worksheet);

    stepLogs.push(`📊 Processing sheet: ${sheetName}`);

    if (!uploadedData.length) {
      stepLogs.push("❌ No data found in Excel file");
      return res.status(400).json({ error: "No data found in Excel file", logs: stepLogs });
    }

    stepLogs.push(`✅ Found ${uploadedData.length} records in the Excel file`);

    const possibleMappings = {
      insuranceNumber: ["Alchemy pay number", "InsuranceNumber", "Insurance Number", "ALCHP-INS"],
      userId: ["user id", "UserId", "User ID", "CROWN"],
      name: ["name", "Name", "Full Name"],
      email: ["email", "Email", "email address"],
      mobileNumber: ["mobile number", "Mobile Number", "Number", "Phone", "Contact"],
      investedAmount: ["Invested amount", "Invested Amount", "Amount", "InvestedAmount"],
      address: ["address", "Address", "Full Address"]
    };

    const detectedFields = {};
    const firstRow = uploadedData[0];
    const columnHeaders = Object.keys(firstRow);

    stepLogs.push(`📋 Detected columns: ${columnHeaders.join(', ')}`);

    for (const [targetField, possibleNames] of Object.entries(possibleMappings)) {
      const matchedField = columnHeaders.find(header =>
        possibleNames.some(name =>
          header.toLowerCase().replace(/\s+/g, '') === name.toLowerCase().replace(/\s+/g, '')
        )
      );
      if (matchedField) {
        detectedFields[targetField] = matchedField;
      }
    }

    stepLogs.push(`🔄 Field mapping: ${JSON.stringify(detectedFields)}`);

    const requiredFields = ['name', 'email', 'insuranceNumber'];
    const missingRequiredFields = requiredFields.filter(field => !detectedFields[field]);

    if (missingRequiredFields.length > 0) {
      stepLogs.push(`❌ Missing required fields: ${missingRequiredFields.join(', ')}`);
      return res.status(400).json({ 
        error: `Missing required fields: ${missingRequiredFields.join(', ')}`, 
        logs: stepLogs 
      });
    }

    const processedEntries = [];
    const skippedEntries = [];
    const errorEntries = [];

    for (let i = 0; i < uploadedData.length; i++) {
      const row = uploadedData[i];
      try {
        const entry = {
          Name: row[detectedFields.name] || '',
          Email: row[detectedFields.email] || '',
          InsuranceNumber: row[detectedFields.insuranceNumber] || '',
          Address: row[detectedFields.address] || '',
          Number: row[detectedFields.mobileNumber] || '',
          Amount: row[detectedFields.investedAmount]
            ? parseInt(row[detectedFields.investedAmount].toString().replace(/[^0-9]/g, ''))
            : 0,
          UserId: row[detectedFields.userId] || ''
        };

        if (!entry.Name || !entry.Email || !entry.InsuranceNumber) {
          skippedEntries.push({ rowIndex: i + 1, reason: "Missing required fields", data: entry });
          continue;
        }

        processedEntries.push(entry);
      } catch (err) {
        errorEntries.push({ rowIndex: i + 1, error: err.message, data: row });
      }
    }

    stepLogs.push(`✅ Processed ${processedEntries.length} valid entries`);
    if (skippedEntries.length) stepLogs.push(`⚠️ Skipped ${skippedEntries.length} entries`);
    if (errorEntries.length) stepLogs.push(`❌ Errors in ${errorEntries.length} entries`);

    const filePath = path.join(__dirname, "data.xlsx");
    let existingData = [];
    let workbookToUpdate;

    if (fs.existsSync(filePath)) {
      workbookToUpdate = XLSX.readFile(filePath);
      const worksheet = workbookToUpdate.Sheets["Sheet1"];
      existingData = XLSX.utils.sheet_to_json(worksheet);
      stepLogs.push(`📊 Loaded existing DB with ${existingData.length} records`);
    } else {
      workbookToUpdate = XLSX.utils.book_new();
      stepLogs.push(`📊 Creating new database file`);
    }

    const addedEntries = [];
    const duplicateEntries = [];

    for (const entry of processedEntries) {
      const exists = existingData.find(e => e.InsuranceNumber === entry.InsuranceNumber);
      if (exists) {
        duplicateEntries.push({ insuranceNumber: entry.InsuranceNumber, name: entry.Name });
      } else {
        existingData.push(entry);
        addedEntries.push({ insuranceNumber: entry.InsuranceNumber, name: entry.Name });
      }
    }

    stepLogs.push(`✅ Added ${addedEntries.length} new entries`);
    if (duplicateEntries.length) {
      stepLogs.push(`⚠️ Skipped ${duplicateEntries.length} duplicates`);
    }

    const updatedSheet = XLSX.utils.json_to_sheet(existingData, {
      header: ["Name", "Email", "InsuranceNumber", "Address", "Number", "Amount", "UserId"]
    });

    if (workbookToUpdate.SheetNames.includes("Sheet1")) {
      workbookToUpdate.Sheets["Sheet1"] = updatedSheet;
    } else {
      XLSX.utils.book_append_sheet(workbookToUpdate, updatedSheet, "Sheet1");
    }

    XLSX.writeFile(workbookToUpdate, filePath);
    stepLogs.push(`💾 Database updated`);

    return res.status(200).json({
      message: "Excel processed successfully",
      totalProcessed: processedEntries.length,
      added: addedEntries.length,
      duplicates: duplicateEntries.length,
      skipped: skippedEntries.length,
      errors: errorEntries.length,
      addedEntries,
      duplicateEntries,
      skippedEntries,
      errorEntries,
      logs: stepLogs
    });

  } catch (err) {
    stepLogs.push(`❌ Exception: ${err.message}`);
    return res.status(500).json({ 
      error: "Failed to process Excel file", 
      message: err.message,
      logs: stepLogs 
    });
  }
});


// Start Server
app.listen(5000,'0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

