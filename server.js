const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

// ─── Firebase Admin Setup ────────────────────────────────
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json');   // 🔒 Never commit!
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ─── Middleware ──────────────────────────────────────────
app.use(express.json());
app.use(express.static('static'));

// ─── NIN Verification Provider ──────────────────────────
const API_KEY = 'ninbvn_e4ce715a19852fa0b0515f9e';
const PROVIDER_URL = 'https://ninbvnportal.com.ng/api/nin-verification';
const BALANCE_URL = 'https://ninbvnportal.com.ng/api/balance';

// ══════════════════════════════════════════════════════════
//  POST /api/lookup  –  Verify NIN & save to history
// ══════════════════════════════════════════════════════════
app.post('/api/lookup', async (req, res) => {
  const { nin, consent } = req.body;

  if (!nin || !/^\d{11}$/.test(nin)) {
    return res.status(400).json({ error: 'Invalid NIN — exactly 11 digits required' });
  }
  if (consent !== true) {
    return res.status(400).json({ error: 'User consent is required' });
  }

  try {
    const response = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({ nin, consent: true }),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return res.status(400).json({ error: data.message || 'Verification failed' });
    }

    const d = data.data?.data;
    if (!d) {
      return res.status(500).json({ error: 'Unexpected response structure' });
    }

    const fullname = [d.firstname, d.middlename, d.surname]
      .filter(Boolean)
      .join(' ')
      .toUpperCase();

    // ─── Save to Firebase Firestore ────────────────────────
    await db.collection('lookups').add({
      nin,
      fullname,
      phone: d.telephoneno || d.phone || '', 
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    const addressParts = [
      d.residence_address,
      d.residence_town,
      d.residence_state,
    ].filter(Boolean);
    const address = addressParts.length > 0 ? addressParts.join(', ') : '';

    res.json({
      firstname: d.firstname || '',
      surname: d.surname || '',
      middlename: d.middlename || '',
      fullname,
      photo: d.photo || '',
      signature: d.signature || '',
      birthdate: d.birthdate || '',
      gender: d.gender || '',
      phone: d.telephoneno || d.phone || '',
      maritalstatus: d.maritalstatus || '',
      birthstate: d.birthstate || '',
      birthlga: d.birthlga || '',
      address,
    });
  } catch (err) {
    console.error('Provider error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ══════════════════════════════════════════════════════════
//  GET /api/balance  –  Wallet balance (free provider endpoint)
// ══════════════════════════════════════════════════════════
app.get('/api/balance', async (req, res) => {
  try {
    const response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: {
        'x-api-key': API_KEY,
      },
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return res.status(400).json({ error: data.message || 'Could not fetch balance' });
    }

    res.json({
      balance: data.data?.balance ?? null,
      formatted_balance: data.data?.formatted_balance || '',
      username: data.data?.username || '',
      api_requests_today: data.data?.api_requests_today ?? null,
      api_limit: data.data?.api_limit ?? null,
    });
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ══════════════════════════════════════════════════════════
//  GET /api/history  –  Manager-only lookup history
// ══════════════════════════════════════════════════════════
app.get('/api/history', async (req, res) => {
  const { password } = req.query;

  const MANAGER_PASSWORD = 'dviebi2024';

  if (password !== MANAGER_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  try {
    const snapshot = await db.collection('lookups')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const records = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || null,
    }));

    res.json(records);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Could not load history' });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});