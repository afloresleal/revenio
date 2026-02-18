/**
 * Revenio Caller - Servicio standalone para llamadas VAPI
 * Deploy: Droplet Marina (138.68.28.244:3003)
 * 
 * Validado por Codex: 2026-02-18
 * 
 * FLUJOS:
 * - CON nombre: firstMessage con {{name}}, tool message original
 * - SIN nombre: firstMessage genérico, tool message diferente
 */

require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

// === CONFIG ===
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const API_KEY = process.env.API_KEY || 'revenio-test-key-2026';
const TRANSFER_NUMBER = process.env.TRANSFER_NUMBER || '+525527326714';

// === MENSAJES ===
// SIN nombre - saludo dinámico por hora (CST = America/Mexico_City)
function getGreeting() {
  const now = new Date();
  const cstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  const hour = cstTime.getHours();
  
  if (hour >= 7 && hour < 12) {
    return "Hola, buenos días.";
  } else if (hour >= 12 && hour < 18) {
    return "Hola, buenas tardes.";
  } else {
    return "Hola, linda noche.";
  }
}

// SIN nombre - tool message con presentación completa
const TOOL_MESSAGE_NO_NAME = "Habla Marina de Casalba, asistente virtual. Nos dejaste tus datos sobre propiedades en Los Cabos. Un asesor lo atenderá de manera personal, por favor deme unos segundos que le estoy transfiriendo su llamada.";

// === MIDDLEWARE AUTH ===
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];
  const providedKey = apiKey || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
  
  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized', message: 'API key required' });
  }
  next();
};

// === RATE LIMIT SIMPLE ===
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 10;

const rateLimitMiddleware = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }
  
  const record = rateLimitMap.get(ip);
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + RATE_LIMIT_WINDOW_MS;
    return next();
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'rate_limit', message: 'Too many requests' });
  }
  
  record.count++;
  next();
};

// === HELPERS ===
function sanitizeName(name) {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 50);
}

function validatePhoneNumber(number) {
  if (!number) return false;
  const cleaned = number.replace(/\s/g, '');
  return /^\+\d{10,15}$/.test(cleaned);
}

// === ENDPOINTS ===
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    service: 'revenio-caller',
    vapi_configured: Boolean(VAPI_API_KEY && VAPI_PHONE_NUMBER_ID && VAPI_ASSISTANT_ID)
  });
});

app.post('/call/vapi', authMiddleware, rateLimitMiddleware, async (req, res) => {
  const { to_number, lead_name } = req.body;
  
  if (!to_number) {
    return res.status(400).json({ error: 'to_number_required' });
  }
  if (!validatePhoneNumber(to_number)) {
    return res.status(400).json({ error: 'invalid_phone_number', hint: 'Format: +521234567890' });
  }

  if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID || !VAPI_ASSISTANT_ID) {
    return res.status(500).json({ error: 'vapi_not_configured' });
  }

  const safeName = sanitizeName(lead_name);

  // Base payload
  const payload = {
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    assistantId: VAPI_ASSISTANT_ID,
    customer: { number: to_number },
  };

  if (safeName) {
    // CON nombre: solo pasar la variable, usar config default del assistant
    payload.assistantOverrides = {
      variableValues: { name: safeName }
    };
  } else {
    // SIN nombre: override completo - firstMessage Y tool message diferentes
    payload.assistantOverrides = {
      firstMessage: getGreeting(),
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{
          role: "system",
          content: "Eres Marina de Casalba. Cuando el usuario responda, ejecuta transferCall inmediatamente. No digas nada, solo ejecuta el tool."
        }],
        tools: [{
          type: "transferCall",
          messages: [{
            type: "request-start",
            content: TOOL_MESSAGE_NO_NAME,
            blocking: true
          }],
          destinations: [{
            type: "number",
            number: TRANSFER_NUMBER
          }]
        }]
      }
    };
  }

  console.log('[call/vapi]', { to_number, safeName, hasName: Boolean(safeName) });

  try {
    const resp = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VAPI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error('[call/vapi] VAPI error:', resp.status, data);
      return res.status(502).json({ error: 'vapi_error', status: resp.status, data });
    }

    console.log('[call/vapi] Success:', data.id);
    return res.json({ 
      ok: true, 
      call_id: data.id,
      used_name: safeName,
      message_type: safeName ? 'with_name' : 'generic'
    });

  } catch (err) {
    console.error('[call/vapi] Network error:', err.message);
    return res.status(500).json({ error: 'network_error', message: err.message });
  }
});

// === START ===
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`[revenio-caller] Running on :${PORT}`);
  console.log(`[revenio-caller] VAPI configured: ${Boolean(VAPI_API_KEY)}`);
});
