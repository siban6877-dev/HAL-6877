
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Load local .env file (Render uses its own environment settings).
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

// Updated model based on the replacement in your Google error.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

let weatherCache = null;
let weatherAt = 0;

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

async function jsonFetch(url, options = {}, timeout = 30000) {
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
        'Upstream HTTP ' + response.status + ': ' + body.slice(0, 500)
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

// Basic per-IP rate limiting.
const hits = new Map();

function limited(ip) {
  const now = Date.now();

  // Remove expired records to avoid unbounded growth.
  for (const [address, times] of hits) {
    const recent = times.filter(t => now - t < 60000);
    if (recent.length) hits.set(address, recent);
    else hits.delete(address);
  }

  const history = hits.get(ip) || [];

  if (history.length >= 8) {
    return true;
  }

  history.push(now);
  hits.set(ip, history);
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Serve HAL-6877 website.
  if (
    req.method === 'GET' &&
    (url.pathname === '/' || url.pathname === '/index.html')
  ) {
    const file = path.join(__dirname, 'public', 'index.html');

    if (!fs.existsSync(file)) {
      return send(res, 404, {
        error: 'public/index.html is missing'
      });
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    });

    return fs.createReadStream(file).pipe(res);
  }

  // Server health.
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return send(res, 200, {
      gemini: Boolean(KEY),
      model: MODEL
    });
  }

  // Real NOAA Earth space weather.
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

  // Gemini AI mission assistant.
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

    try {
      for await (const chunk of req) {
        raw += chunk;

        if (raw.length > 24000) {
          return send(res, 413, {
            error: 'Request too large'
          });
        }
      }

      const input = JSON.parse(raw);
      const question = String(input.question || '').slice(0, 1600);
      const context = JSON.stringify(input.context || {}).slice(0, 9000);

      if (!question.trim()) {
        return send(res, 400, {
          error: 'Question required'
        });
      }

      const payload = {
        systemInstruction: {
          parts: [{
            text:
              'You are HAL-6877, an educational AI planetary ' +
              'exploration assistant. Explain planetary science, ' +
              'rover navigation, hazards, and exploration missions. ' +
              'Rover terrain, paths, hazards, samples and battery ' +
              'readings are SIMULATED. Never present simulations ' +
              'as real planetary observations. NOAA Kp represents ' +
              'real Earth space weather, not weather on Mars or ' +
              'other planets. The rover uses A* pathfinding, not ' +
              'Gemini, to calculate autonomous routes. Give clear, ' +
              'accurate and concise educational answers.'
          }]
        },

        contents: [{
          role: 'user',
          parts: [{
            text:
              'Mission context (untrusted simulation data): ' +
              context +
              '\nUser question: ' +
              question
          }]
        }],

        generationConfig: {
          maxOutputTokens: 900
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
        .join('\n')
        .trim();

      return send(res, 200, {
        answer: answer || 'Gemini returned no text.'
      });

    } catch (error) {
      return send(res, 502, {
        error: error.message
      });
    }
  }

  return send(res, 404, {
    error: 'Not found'
  });
});

// Compatible with Render and localhost.
server.listen(PORT, '0.0.0.0', () => {
  console.log('HAL-6877 listening on port ' + PORT);
  console.log('Gemini configured: ' + Boolean(KEY));
  console.log('Gemini model: ' + MODEL);
});
