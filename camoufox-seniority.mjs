#!/usr/bin/env node
/**
 * camoufox-seniority.mjs
 * 
 * Audits active job postings for true seniority level using visible Camoufox.
 * Detects explicit portal badges (e.g. Get on Board "Semi Senior" / "Senior"),
 * title keywords, and required years of experience in requirements text.
 */

import fs from 'fs';
import { execSync } from 'child_process';

const inputFile = process.argv[2] || '/tmp/notion-prio-a-consolidated.jsonl';
const outputFile = process.argv[3] || '/tmp/notion-seniority-audit.jsonl';

if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

const lines = fs.readFileSync(inputFile, 'utf8').trim().split('\n');
const activePostings = lines
  .map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  })
  .filter((r) => r && r.status === 'active');

console.log(`Auditing seniority for ${activePostings.length} active postings...`);

const evaluateScript = `() => {
  const text = document.body?.innerText || "";
  const lower = text.toLowerCase();
  const title = document.title || "";

  // 1. Get on Board explicit metadata line
  let gobSeniority = null;
  const rawLines = text.split("\\n").map(l => l.trim()).filter(Boolean);
  for (const line of rawLines) {
    if (line.includes("| Full time") || line.includes("| Part time") || line.includes("| Freelance") || line.includes("| Temporal")) {
      const parts = line.split("|").map(p => p.trim());
      for (const p of parts) {
        if (/^(no experience|sin experiencia|entry|trainee|junior|semi senior|semi-senior|senior|expert|lead)$/i.test(p)) {
          gobSeniority = p;
          break;
        }
      }
    }
    if (gobSeniority) break;
  }

  // 2. Title keywords
  let titleSeniority = null;
  if (/\\b(junior|jr\\.?|trainee|practicante|pasant[ií]a|reci[eé]n egresad[oa]|reci[eé]n titulad[oa]|entry|graduate)\\b/i.test(title)) {
    titleSeniority = "Junior";
  } else if (/\\b(senior|sr\\.?|lead|principal|staff|arquitecto|architect)\\b/i.test(title)) {
    titleSeniority = "Senior";
  } else if (/\\b(semi[- ]?senior|ssr\\.?|mid[- ]?level|intermedio)\\b/i.test(title)) {
    titleSeniority = "Semi-Senior";
  }

  // 3. Scan years of experience
  const expSnippets = [];
  const expRegex = /(?:al menos|m[ií]nimo|experiencia de|requerid[ao]s?|contar con|poseer)?\\s*(\\d+)(?:\\s*(?:a|-)\\s*(\\d+))?\\s*(?:\\+|m[aá]s)?\\s*a[ñn]os(?:\\s*de\\s*experiencia)?/gi;
  let m;
  while ((m = expRegex.exec(text)) !== null) {
    const num = parseInt(m[1], 10);
    if (num >= 1 && num <= 15) {
      expSnippets.push({ match: m[0].trim(), years: num });
    }
  }

  const maxYears = expSnippets.length > 0 ? Math.max(...expSnippets.map(e => e.years)) : 0;
  const minYears = expSnippets.length > 0 ? Math.min(...expSnippets.map(e => e.years)) : 0;

  // 4. Determine final classification
  let level = "Indeterminada";
  let feasibleForJunior = true;
  let reason = "";

  if (gobSeniority) {
    const gLower = gobSeniority.toLowerCase();
    if (gLower.includes("senior") && !gLower.includes("semi")) {
      level = "Senior";
      feasibleForJunior = false;
      reason = "Badge explícito en Get on Board: Senior";
    } else if (gLower.includes("semi senior") || gLower.includes("semi-senior")) {
      level = "Semi-Senior";
      feasibleForJunior = false;
      reason = "Badge explícito en Get on Board: Semi Senior";
    } else if (gLower.includes("expert") || gLower.includes("lead")) {
      level = "Senior / Expert";
      feasibleForJunior = false;
      reason = "Badge explícito en Get on Board: " + gobSeniority;
    } else if (gLower.includes("junior") || gLower.includes("no experience") || gLower.includes("sin experiencia")) {
      level = "Junior";
      feasibleForJunior = true;
      reason = "Badge explícito en Get on Board: " + gobSeniority;
    }
  }

  if (level === "Indeterminada" && titleSeniority) {
    level = titleSeniority;
    if (titleSeniority === "Senior") {
      feasibleForJunior = false;
      reason = "Marcador en el título: Senior";
    } else if (titleSeniority === "Semi-Senior") {
      feasibleForJunior = false;
      reason = "Marcador en el título: Semi-Senior";
    } else if (titleSeniority === "Junior") {
      feasibleForJunior = true;
      reason = "Marcador en el título: Junior";
    }
  }

  if (level === "Indeterminada" || level === "Junior") {
    if (maxYears >= 4) {
      level = "Senior (" + maxYears + "+ años)";
      feasibleForJunior = false;
      reason = "Texto exige al menos " + maxYears + " años de experiencia";
    } else if (maxYears >= 3) {
      level = "Semi-Senior / Senior (3 años)";
      feasibleForJunior = false;
      reason = "Texto exige al menos " + maxYears + " años de experiencia";
    } else if (maxYears <= 2 && maxYears > 0) {
      level = "Junior (0-2 años)";
      feasibleForJunior = true;
      reason = "Acepta hasta " + maxYears + " años o perfil inicial";
    }
  }

  if (level === "Indeterminada") {
    if (/sin experiencia|reci[eé]n titulad[oa]|reci[eé]n egresad[oa]/i.test(text)) {
      level = "Junior (Sin experiencia previa)";
      feasibleForJunior = true;
      reason = "Texto menciona explícitamente sin experiencia / recién titulado";
    } else {
      level = "No especificada (evaluar requisitos)";
      feasibleForJunior = true;
      reason = "No indica nivel explícito";
    }
  }

  return {
    title,
    gobSeniority,
    titleSeniority,
    maxYears,
    expSnippets: expSnippets.slice(0, 3),
    level,
    feasibleForJunior,
    reason
  };
}`;

const results = [];
fs.writeFileSync(outputFile, ''); // truncate

for (let i = 0; i < activePostings.length; i++) {
  const p = activePostings[i];
  process.stderr.write(`[${i + 1}/${activePostings.length}] Checking ${p.label}... `);

  try {
    // Open URL
    execSync(`timeout 15 camoufox-browser open "${p.url}"`, { stdio: 'ignore' });
    // Evaluate
    const rawOut = execSync(`camoufox-browser evaluate ${JSON.stringify(evaluateScript)}`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
    const parsed = JSON.parse(rawOut);
    const item = {
      page_id: p.page_id,
      url: p.url,
      label: p.label,
      ...parsed
    };
    results.push(item);
    fs.appendFileSync(outputFile, JSON.stringify(item) + '\n');
    console.error(`=> ${item.level} (Junior feasible: ${item.feasibleForJunior})`);
  } catch (err) {
    const fallback = {
      page_id: p.page_id,
      url: p.url,
      label: p.label,
      level: "Error al evaluar",
      feasibleForJunior: true,
      reason: err.message
    };
    results.push(fallback);
    fs.appendFileSync(outputFile, JSON.stringify(fallback) + '\n');
    console.error(`=> Error`);
  }
}

console.log(`\nAudit completed! Wrote results to ${outputFile}`);
