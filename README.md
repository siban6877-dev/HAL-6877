# HAL-6877 Mission Intelligence

A digital autonomous rover training simulator with A* safe path planning, obstacle detection, sample collection, reference information about the eight planets and Pluto, live NOAA Earth geomagnetic Kp observations, and optional Gemini AI mission briefings.

## Windows startup

1. Extract the ZIP and open Command Prompt in the HAL-6877-Mission folder.
2. Optional: copy `.env.example` to `.env` and insert your Gemini API key from https://aistudio.google.com/apikey .
3. Run `npm start` (Node.js 20+ required; no npm install needed).
4. Open http://127.0.0.1:3000 .

## Demo

Select Mars; start autonomous mission; click **ADD SURPRISE HAZARD** while the rover is moving. The A* algorithm recalculates the path. Click **AI PLANET BRIEFING** or **MISSION REPORT** to use Gemini when configured. NOAA feed refreshes every 5 minutes and reports Earth geomagnetic activity only.

## Important scientific limitations

The rover map, terrain, hazards, sample targets, and battery are generated simulations, not live rover imagery or planetary observations. Planet descriptions are static reference facts, not live measurements. Gas giants do not have a solid rover-drivable surface; their training maps are hypothetical. Gemini does not control the rover; A* handles route decisions. The model's text may contain errors and should be checked against primary sources.

## Security

The API key stays server-side in `.env`. Never commit `.env` to a public repository. This example server binds to localhost and is NOT suitable for direct public exposure. Before public hosting, add user authentication, origin checks, CSRF protections, server-side request quotas, key/budget limits, and HTTPS hosting.
