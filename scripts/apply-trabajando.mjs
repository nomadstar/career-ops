#!/usr/bin/env node

/**
 * scripts/apply-trabajando.mjs
 * Interactive application assistant for Trabajando.cl jobs via visible Camoufox.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import readline from 'readline';

const argv = process.argv.slice(2);
const url = argv.find(a => a.startsWith('http'));

if (!url) {
  console.error(JSON.stringify({
    error: 'Missing job URL operand',
    usage: 'node scripts/apply-trabajando.mjs <url> [--cv <path>]'
  }));
  process.exit(1);
}

const customCv = argv.find((a, i) => argv[i - 1] === '--cv');

function runCamoufox(cmd, ...args) {
  try {
    const stdout = execFileSync('camoufox-browser', [cmd, ...args], {
      timeout: 35000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return stdout ? stdout.trim() : '';
  } catch (err) {
    throw new Error(`camoufox-browser ${cmd} failed: ${err.stderr || err.message}`);
  }
}

function evaluate(jsCode) {
  return runCamoufox('evaluate', jsCode);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function askUser(questionPrompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(questionPrompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function selectCvPath(jobTitle, jobDescription) {
  if (customCv && existsSync(customCv)) return customCv;
  const text = (jobTitle + ' ' + jobDescription).toLowerCase();
  const l = 'es';

  if (text.includes('data') || text.includes('datos') || text.includes('etl') || text.includes('pipeline')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_data_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  if (text.includes('ai') || text.includes('ia') || text.includes('inference')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_ai-systems_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  if (text.includes('devops') || text.includes('sre') || text.includes('infra') || text.includes('linux') || text.includes('cloud')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_infrastructure_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  if (text.includes('cyber') || text.includes('seguridad') || text.includes('security') || text.includes('redes') || text.includes('telecom')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_cybersecurity_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  return join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_backend_${l}.pdf`);
}

async function main() {
  console.log(`[Trabajando.cl] Abriendo vacante en Camoufox: ${url}`);
  runCamoufox('open', url);
  await sleep(3000);

  const pageInfo = JSON.parse(evaluate(`() => {
    const body = document.body.innerText;
    const isClosed = body.includes('Esta oferta no está disponible') ||
                     body.includes('El aviso ya finalizó') ||
                     body.includes('Oferta cerrada');
    
    const titleEl = document.querySelector('h1, .job-title, [class*=\"title\"]');
    const companyEl = document.querySelector('.company-name, [class*=\"company\"]');
    const descEl = document.querySelector('.job-description, [class*=\"description\"]');
    const applyBtn = Array.from(document.querySelectorAll('button, a')).find(e => {
      const t = e.innerText.trim();
      return t === 'Postular' || t === 'Postularme' || t.includes('Postular');
    });

    return JSON.stringify({
      title: titleEl ? titleEl.innerText.trim() : document.title,
      company: companyEl ? companyEl.innerText.trim() : '',
      description: descEl ? descEl.innerText.slice(0, 1000) : '',
      isClosed,
      hasApplyBtn: !!applyBtn
    });
  }`));

  console.log(`[Cargo] ${pageInfo.title}`);
  if (pageInfo.company) console.log(`[Empresa] ${pageInfo.company}`);

  if (pageInfo.isClosed) {
    console.log(`[Estado] ⛔ Vacante cerrada en Trabajando.cl.`);
    process.exit(0);
  }

  const targetCv = selectCvPath(pageInfo.title, pageInfo.description);
  console.log(`[CV Router] CV asignado: ${targetCv.replace(process.cwd() + '/', '')}`);

  evaluate(`() => {
    const btn = Array.from(document.querySelectorAll('button, a')).find(e => {
      const t = e.innerText.trim();
      return t === 'Postular' || t === 'Postularme' || t.includes('Postular');
    });
    if (btn) btn.click();
  }`);
  await sleep(2000);

  const questions = JSON.parse(evaluate(`() => {
    const inputs = Array.from(document.querySelectorAll('textarea, input[type=\"text\"], input[type=\"number\"]')).filter(el => {
      return el.offsetParent !== null && !el.id.includes('search');
    }).map(el => {
      const lbl = document.querySelector(\`label[for=\"\${el.id}\"]\`) || el.closest('div')?.querySelector('label');
      return {
        id: el.id,
        name: el.name,
        label: lbl ? lbl.innerText.trim() : (el.placeholder || el.name),
        value: el.value
      };
    });
    return JSON.stringify(inputs);
  }`));

  for (const q of questions) {
    if (!q.value || q.value === '') {
      console.log(`\nPregunta: ${q.label}`);
      const ans = await askUser('Respuesta: ');
      evaluate(`() => {
        const el = document.getElementById('${q.id}') || document.querySelector('[name=\"${q.name}\"]');
        if (el) {
          el.value = \`${ans}\`;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`[Listo para enviar] Formulario de Trabajando.cl preparado en Camoufox.`);
  console.log(`Revisa la pantalla visible y confirma tu postulación.`);
  console.log(`======================================================\n`);
  runCamoufox('screenshot');
}

main();
