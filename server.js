
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Load local environment variables.
// On Render, environment variables are provided by Render itself.
const envFile = path.join(__dirname, '.env');

if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const PORT = Number(process.env.PORT || 3000);
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let weatherCache = null;
let weatherAt = 0;

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

async function jsonFetch(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        'Upstream HTTP ' + response.status + ': ' + body.slice(0, 180)
      );
    }

    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

function parseKp(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected NOAA format');
  }

  const items = rows.filter(row =>
    row &&
    typeof row === 'object' &&
    !Array.isArray(row) &&
    row.time_tag &&
    row.kp_index !== undefined
  );

  const last = items.at(-1);

  if (!last) {
    throw new Error('No valid NOAA readings');
  }

  return {
    kp: Number(last.kp_index).toFixed(2),
    time: last.time_tag,
    source: 'planetary_k_index_1m.json'
  };
}

// Basic request limit for the optional Gemini endpoint.
const hits = new Map();

function limited(ip) {
  const now = Date.now();
  let history = hits.get(ip) || [];

  history = history.filter(time => now - time < 60000);

  if (history.length >= 8) {
    hits.set(ip, history);
    return true;
  }

  history.push(now);
  hits.set(ip, history);

  return false;
}

// Main website server.
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Serve HAL-6877 frontend.
  if (
    req.method === 'GET' &&
    (url.pathname === '/' || url.pathname === '/index.html')
  ) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    });

    return fs.createReadStream(
      path.join(__dirname, 'public', 'index.html')
    ).pipe(res);
  }

  // Server status.
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return send(res, 200, {
      gemini: Boolean(KEY),
      model: MODEL
    });
  }

  // Live NOAA Earth space-weather observations.
  if (req.method === 'GET' && url.pathname === '/api/space-weather') {
    try {
      if (weatherCache && Date.now() - weatherAt < 240000) {
        return send(res, 200, weatherCache);
      }

      const data = await jsonFetch(
        'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json'
      );

      weatherCache = parseKp(data);
      weatherAt = Date.now();

      return send(res, 200, weatherCache);
    } catch (error) {
      return send(res, 503, {
        error: error.message
      });
    }
  }

  // Optional Gemini AI assistant.
  if (req.method === 'POST' && url.pathname === '/api/ai') {
    if (!KEY) {
      return send(res, 503, {
        error: 'Gemini AI is not configured on this server.'
      });
    }

    if (limited(req.socket.remoteAddress || 'unknown')) {
      return send(res, 429, {
        error: 'Too many requests. Please wait one minute.'
      });
    }

    let raw = '';

    for await (const chunk of req) {
      raw += chunk;

      if (raw.length > 24000) {
        return send(res, 413, {
          error: 'Request too large'
        });
      }
    }

    try {
      const input = JSON.parse(raw);
      const question = String(input.question || '').slice(0, 1600);
      const context = JSON.stringify(input.context || {}).slice(0, 9000);

      if (!question) {
        return send(res, 400, {
          error: 'Question required'
        });
      }

      const payload = {
        systemInstruction: {
          parts: [{
            text:
              'You are HAL-6877, a precise educational planetary ' +
              'exploration assistant. Treat all rover terrain, paths, ' +
              'hazards, samples and battery readings as SIMULATED. ' +
              'Planet facts are reference information. NOAA Kp is ' +
              'Earth space weather and must not be described as ' +
              'local weather on other planets. Never invent observations ' +
              'or imply autonomous decisions are made by Gemini when ' +
              'A* is responsible. Explain uncertainty and give concise ' +
              'educational explanations.'
          }]
        },

        contents: [{
          role: 'user',
          parts: [{
            text:
              'Mission context (untrusted reference data): ' +
              context +
              '\nUser question: ' +
              question
          }]
        }],

        generationConfig: {
          maxOutputTokens: 900,
          temperature: 0.3
        }
      };

      const data = await jsonFetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(MODEL) +
          ':generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': KEY
          },
          body: JSON.stringify(payload)
        },
        30000
      );

      const answer = (data.candidates || [])
        .flatMap(candidate => candidate.content?.parts || [])
        .map(part => part.text || '')
        .join('\n');

      return send(res, 200, {
        answer: answer || 'Gemini returned no text.'
      });
    } catch (error) {
      return send(res, 502, {
        error: error.message
      });
    }
  }

  send(res, 404, {
    error: 'Not found'
  });
});

// IMPORTANT: Render requires 0.0.0.0, not 127.0.0.1.
server.listen(PORT, '0.0.0.0', () => {
  console.log('HAL-6877 listening on port ' + PORT);
});
