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
// BVN is served by the same provider/host as NIN, on its own endpoint.
const BVN_URL = 'https://ninbvnportal.com.ng/api/bvn-verification';
// Reverse phone search: phone number → identity, same provider.
const NIN_PHONE_URL = 'https://ninbvnportal.com.ng/api/nin-phone';
const BVN_PHONE_URL = 'https://ninbvnportal.com.ng/api/bvn-phone';

// Accepts 0XXXXXXXXXX, 234XXXXXXXXXX, +234XXXXXXXXXX or a bare 10-digit
// number; returns the local 11-digit format the provider expects, or null.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(digits)) return digits;
  if (/^234\d{10}$/.test(digits)) return '0' + digits.slice(3);
  if (/^\d{10}$/.test(digits)) return '0' + digits;
  return null;
}

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
//  POST /api/bvn  –  Verify BVN & save to history
// ══════════════════════════════════════════════════════════
app.post('/api/bvn', async (req, res) => {
  const { bvn, consent } = req.body;

  if (!bvn || !/^\d{11}$/.test(bvn)) {
    return res.status(400).json({ error: 'Invalid BVN — exactly 11 digits required' });
  }
  if (consent !== true) {
    return res.status(400).json({ error: 'User consent is required' });
  }

  try {
    const response = await fetch(BVN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({ bvn, consent: true }),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return res.status(400).json({ error: data.message || 'Verification failed' });
    }

    // Provider wraps the record two levels deep and uses camelCase field names.
    const d = data.data?.data || data.data || data;
    if (!d) {
      return res.status(500).json({ error: 'Unexpected response structure' });
    }

    const fullname = [d.firstName, d.middleName, d.lastName]
      .filter(Boolean)
      .join(' ')
      .toUpperCase();

    // ─── Save to Firebase Firestore (separate collection) ──
    await db.collection('bvn_lookups').add({
      bvn,
      fullname,
      phone: d.phoneNumber1 || d.phoneNumber2 || '',
      type: 'bvn',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      firstname: d.firstName || '',
      middlename: d.middleName || '',
      lastname: d.lastName || '',
      fullname,
      bvn: d.bvn || bvn,
      phone: d.phoneNumber1 || d.phoneNumber2 || '',
      email: d.email || '',
      dob: d.dateOfBirth || '',
      gender: d.gender || '',
      state_of_origin: d.stateOfOrigin || '',
      state_of_residence: d.stateOfResidence || '',
      lga_of_origin: d.lgaOfOrigin || '',
      residential_address: d.residentialAddress || '',
      nationality: d.nationality || '',
      marital_status: d.maritalStatus || '',
      photo: d.base64Image || '',
      reportID: data.reportID || '',
    });
  } catch (err) {
    console.error('BVN provider error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ══════════════════════════════════════════════════
//  POST /api/nin-phone  –  Phone number → NIN identity search
// ══════════════════════════════════════════════════
app.post('/api/nin-phone', async (req, res) => {
  const { phone, consent } = req.body;

  const msisdn = normalizePhone(phone);
  if (!msisdn) {
    return res.status(400).json({ error: 'Invalid phone number — enter a valid Nigerian number (e.g. 08012345678)' });
  }
  if (consent !== true) {
    return res.status(400).json({ error: 'User consent is required' });
  }

  try {
    const response = await fetch(NIN_PHONE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({ phone: msisdn, consent: true }),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return res.status(400).json({ error: data.message || 'Phone search failed' });
    }

    const d = data.data?.data;
    if (!d) {
      return res.status(500).json({ error: 'Unexpected response structure' });
    }

    const fullname = [d.firstname, d.middlename, d.surname]
      .filter(Boolean)
      .join(' ')
      .toUpperCase();

    const address = [
      d.residence_address,
      d.residence_town,
      d.residence_state,
    ].filter(Boolean).join(', ');

    // ─── Save to Firebase Firestore ────────────────────────
    await db.collection('phone_lookups').add({
      type: 'nin-phone',
      phone_searched: msisdn,
      nin: d.nin || '',
      fullname,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      type: 'nin-phone',
      firstname: d.firstname || '',
      middlename: d.middlename || '',
      surname: d.surname || '',
      fullname,
      nin: d.nin || '',
      gender: d.gender || '',
      birthdate: d.birthdate || '',
      phone: d.telephoneno || '',
      birthstate: d.birthstate || '',
      birthlga: d.birthlga || '',
      maritalstatus: d.maritalstatus || '',
      state_of_residence: d.residence_state || '',
      address,
      photo: d.photo || '',
      reportID: data.reportID || '',
    });
  } catch (err) {
    console.error('NIN phone search error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ══════════════════════════════════════════════════
//  POST /api/bvn-phone  –  Phone number → BVN identity search
//  (provider may report this sub-service unavailable — message is passed through)
// ══════════════════════════════════════════════════
app.post('/api/bvn-phone', async (req, res) => {
  const { phone, consent } = req.body;

  const msisdn = normalizePhone(phone);
  if (!msisdn) {
    return res.status(400).json({ error: 'Invalid phone number — enter a valid Nigerian number (e.g. 08012345678)' });
  }
  if (consent !== true) {
    return res.status(400).json({ error: 'User consent is required' });
  }

  try {
    const response = await fetch(BVN_PHONE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify({ phone: msisdn, consent: true }),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
      return res.status(400).json({ error: data.message || 'BVN phone search failed' });
    }

    const d = data.data?.data || data.data || data;
    if (!d) {
      return res.status(500).json({ error: 'Unexpected response structure' });
    }

    const fullname = [d.firstName, d.middleName, d.lastName]
      .filter(Boolean)
      .join(' ')
      .toUpperCase();

    // ─── Save to Firebase Firestore ────────────────────────
    await db.collection('phone_lookups').add({
      type: 'bvn-phone',
      phone_searched: msisdn,
      bvn: d.bvn || '',
      fullname,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      type: 'bvn-phone',
      firstname: d.firstName || '',
      middlename: d.middleName || '',
      surname: d.lastName || '',
      fullname,
      bvn: d.bvn || '',
      gender: d.gender || '',
      birthdate: d.dateOfBirth || '',
      phone: d.phoneNumber1 || d.phoneNumber2 || '',
      maritalstatus: d.maritalStatus || '',
      birthstate: d.stateOfOrigin || '',
      birthlga: d.lgaOfOrigin || '',
      state_of_residence: d.stateOfResidence || '',
      address: d.residentialAddress || '',
      nationality: d.nationality || '',
      photo: d.base64Image || '',
      reportID: data.reportID || '',
    });
  } catch (err) {
    console.error('BVN phone search error:', err);
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